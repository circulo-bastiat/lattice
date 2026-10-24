// golemwanderdetcheck (#9440): the real-server golemwander arena is DETERMINISTIC: >= 20 credited pilot salts (two fresh real-server runs each) have same:true,
// and the SeedAgent keeps the rule that makes it so (World.random re-based at the golem's first tick). Prints '<n> breaks caught'.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentInputs, sameInputs } from './referee/lockstep/inputs.mjs';
const HERE = dirname(fileURLToPath(import.meta.url)), PR = join(HERE, 'referee', 'lockstep', 'pilot-results');
const LANE = 'golemwander', NEED = 20;
const agentSrc = readFileSync(join(HERE, 'referee', 'lockstep', 'SeedAgent.java'), 'utf8');
function load(inputs) {
  const out = {};
  if (existsSync(PR)) for (const d of readdirSync(PR)) for (const f of readdirSync(join(PR, d))) {
    if (!f.startsWith(LANE + '-') || !f.endsWith('.json')) continue;
    let r; try { r = JSON.parse(readFileSync(join(PR, d, f), 'utf8')); } catch { continue; }
    if (r && r.lane === LANE && Number.isInteger(r.salt) && sameInputs(r.inputs, inputs) && !(out[r.salt] && out[r.salt].same)) out[r.salt] = r;
  }
  return Object.values(out);
}
/** the rule: returns the list of problems */
function verdict(rs, src) {
  const p = [], good = rs.filter((r) => r.same === true && r.a && r.a === r.b);
  if (good.length < NEED) p.push(`only ${good.length} credited same:true salts (< ${NEED})`);
  if (!/static void golemSeed/.test(src) || !/if \(POIOCC\) golemSeed\(e\)/.test(src)) p.push('SeedAgent lost the golem World.random re-base');
  if (!/hookNavClock/.test(src) || !/chunkLeave/.test(src)) p.push('SeedAgent lost the nav clock / tickChunk rollback hooks');
  return p;
}
const rs = load(currentInputs(LANE)), base = verdict(rs, agentSrc);
if (base.length) { console.log('golemwanderdetcheck: FAIL ' + base.join('; ')); process.exit(1); }
const breaks = [
  ['one salt missing', verdict(rs.slice(0, NEED - 1), agentSrc)],
  ['one salt differs (a != b)', verdict(rs.map((r, i) => i < Math.max(1, rs.length - NEED + 1) ? { ...r, same: false, b: 'x' } : r), agentSrc)],
  ['stale inputs credited nothing', verdict(load({ 'referee/lockstep/SeedAgent.java': 'stale' }), agentSrc)],
  ['golem re-base removed', verdict(rs, agentSrc.replace('if (POIOCC) golemSeed(e);', ''))],
  ['tickChunk rollback removed', verdict(rs, agentSrc.replace(/chunkLeave/g, 'chunkL3ave'))],
];
let caught = 0;
for (const [n, p] of breaks) { if (p.length) caught++; else console.log('FAIL: break not caught: ' + n); }
if (caught !== breaks.length) process.exit(1);
console.log(`golemwanderdetcheck: ${caught} breaks caught (${rs.filter((r) => r.same).length}/${rs.length} salts same)`);
