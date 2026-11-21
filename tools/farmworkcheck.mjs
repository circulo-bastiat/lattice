// farmworkcheck (22 Oct): RUNS tools/infra/farmwork.mjs on fixtures - a green mob closes its lockstep rollout issues, a diverging mob gets ONE divergence issue
// (earliest tick first, capped), a recovered mob's divergence issue is resolved, and nothing else is touched. Prints '<n> breaks caught'.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url)), SRC = readFileSync(join(TOOLS, 'infra', 'farmwork.mjs'), 'utf8');
let ASSERTS = 0;
async function load(mut) {
  let src = SRC;
  if (mut) { if (!src.includes(mut[0])) throw new Error('no-op break: not found in farmwork.mjs: ' + mut[0]); src = src.replace(mut[0], mut[1]); }
  const d = mkdtempSync(join(tmpdir(), 'fwc-')); mkdirSync(join(d, 'infra')); writeFileSync(join(d, 'infra', 'farmwork.mjs'), src);
  return { m: await import(pathToFileURL(join(d, 'infra', 'farmwork.mjs')).href + '?' + Math.random()), d };
}
async function run(mut) {
  let fails = 0; const ok = (c, msg) => { ASSERTS++; if (!c) { fails++; if (!mut) console.log('FAIL: ' + msg); } };
  const { m, d } = await load(mut);
  const rows = { cow: { pass: true, checked: 20, failed: {} }, pig: { pass: false, checked: 20, failed: { 3: 40, 7: 12 } }, sheep: { pass: false, checked: 20, failed: { 1: 5 } }, owl: { pass: false, checked: 20, failed: { 2: 90 } }, wolf: { pass: true, checked: 12, failed: {} }, bat: { pass: false, checked: 20, failed: { 4: 3 } }, player_slim: { pass: true, checked: 20, failed: {} } };
  ok(m.rolloutMob('G17-L4 lockstep cow: 20 seeds to zero divergences vs the real server', rows) === 'cow', 'rolloutMob: "G17-L4 lockstep cow: 20 seeds ..."');
  ok(m.rolloutMob('G17-L4-pig: lockstep re-credit - pig x20 credited seeds, zero divergences', rows) === 'pig', 'rolloutMob: "G17-L4-pig: lockstep re-credit - pig x20"');
  ok(m.rolloutMob('G17-L4 lockstep player_slim: 20 seeds to zero divergences vs the real serve', rows) === 'player_slim', 'rolloutMob keeps underscores');
  ok(m.rolloutMob('Fix cow lockstep x20 notes', rows) === null && m.rolloutMob('G17-L4 lockstep zombie: 20 seeds', rows) === null, 'not a rollout title / unknown mob = null');
  const issues = [{ number: 1, title: 'G17-L4 lockstep cow: 20 seeds to zero divergences' }, { number: 2, title: 'G17-L4 lockstep pig: 20 seeds to zero divergences' }, { number: 3, title: 'G17-L4 lockstep wolf: 20 seeds' }, { number: 4, title: m.DIV_PREFIX + 'sheep' }, { number: 5, title: m.DIV_PREFIX + 'cow' }, { number: 6, title: 'unrelated cow thing' }];
  const p = m.plan(issues, rows, 2);
  ok(p.close.map((x) => x.number).join() === '1', 'closes only the green mob with 20 checked salts (not the diverging pig, not wolf with 12)');
  ok(p.resolve.map((x) => x.number).join() === '5', 'resolves the divergence issue of a mob that turned green');
  ok(p.open.map((x) => x.mob).join() === 'bat,pig', 'opens divergence issues earliest tick first, capped at 2, and none for sheep (already has one)');
  ok(p.open.find((x) => x.mob === 'pig')?.tick === 12 && p.open.find((x) => x.mob === 'pig')?.salts.join() === '3,7', 'tick is the earliest of the failing salts');
  ok(/pilot\.mjs pig 3/.test(m.divBody(p.open.find((x) => x.mob === 'pig') || { mob: '?', salts: [0], tick: 0 })), 'the body carries a repro line');
  rmSync(d, { recursive: true, force: true });
  return fails;
}
const base = await run();
let wf = ''; try { wf = readFileSync(join(TOOLS, '..', '.github', 'workflows', 'pilot-farm.yml'), 'utf8'); } catch {}
let wfail = 0; for (const [msg, c] of [['the farm workflow runs farmwork.mjs --apply', /farmwork\.mjs --apply/.test(wf)]]) { ASSERTS++; if (!c) { wfail++; console.log('FAIL: ' + msg); } }
const breaks = [
  ['close-pass', ["rows[m].pass && rows[m].checked >= 20", "rows[m].checked >= 20"]],
  ['close-checked', ["rows[m].pass && rows[m].checked >= 20", "rows[m].pass"]],
  ['cap', [".slice(0, cap)", ""]],
  ['dedupe', ["!r.pass && salts.length && !divIssue.has(mob)", "!r.pass && salts.length"]],
  ['resolve', ["if (r.pass && divIssue.has(mob))", "if (divIssue.has(mob))"]],
  ['order', ["a.tick - b.tick || ", ""]],
  ['tick', ["tick: Math.min(", "tick: Math.max("]],
  ['title', ["if (!/^G\\d+[a-z]?-L4\\b/i.test(t) || ", "if ("]],
];
let caught = 0; for (const [id, mut] of breaks) { if (await run(mut).catch(() => 1)) caught++; else console.log('NOT CAUGHT: ' + id); }
if (base || wfail || caught < breaks.length) { console.log(`farmworkcheck: FAIL (${base} rule(s), ${wfail} wiring, ${caught}/${breaks.length} breaks caught)`); process.exit(1); }
console.log(`farmworkcheck: ${caught} breaks caught, ${ASSERTS} assertions`);
