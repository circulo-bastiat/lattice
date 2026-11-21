// tools/timestages.mjs - #9529: time check stages one by one and record seconds in tools/stage-times.json ({id: [seconds, ...]}, the
// shape the shard planner and fullsuitecost read). Resumable: stages already timed are skipped, so a call under the 10-minute cap
// is repeated until it prints "timestages: done". Usage: node tools/timestages.mjs <id-regex | families> [budgetSeconds=480]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyse } from './fullsuitecost.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const tf = join(root, 'tools', 'stage-times.json');
const arg = process.argv[2] || '^$', budget = +(process.argv[3] || 480) * 1000;
const times = (() => { try { return JSON.parse(readFileSync(tf, 'utf8')); } catch { return {}; } })();
const all = []; for (const f of readdirSync(join(root, 'tools', 'stages.d')).sort()) if (f.endsWith('.json')) for (const s of [].concat(JSON.parse(readFileSync(join(root, 'tools', 'stages.d', f), 'utf8')))) if (s.kind === 'check') all.push(s);
// 'families' = the lockstep name families that overlap (fullsuitecost), the ones #9529 must measure before deleting any
const fam = new Set(arg === 'families' ? analyse(all, {}, {}, {}).families.flat() : []);
const stages = all.filter((s) => (arg === 'families' ? fam.has(s.id) : new RegExp(arg).test(s.id)));
const t0 = Date.now(); let ran = 0, left = 0;
for (const s of stages) {
  if (times[s.id]) continue;
  if (Date.now() - t0 > budget) { left++; continue; }
  const t = Date.now(); const r = spawnSync('node', [s.file, ...(s.args || [])], { cwd: root, encoding: 'utf8', timeout: 40000 });
  if (r.status !== 0) { console.log(`  ✗ ${s.id} exit ${r.status} (not recorded)`); continue; }
  times[s.id] = [Math.round((Date.now() - t) / 100) / 10]; ran++;
  writeFileSync(tf, JSON.stringify(times, null, 1) + '\n');
}
console.log(`timestages: ${ran} timed this call, ${left} left of ${stages.length} matching`);
console.log(left ? '{"timestages":"partial"}' : 'timestages: done');
