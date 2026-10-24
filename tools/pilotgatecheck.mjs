#!/usr/bin/env node
// pilotgatecheck.mjs - #9725: a lockstep pilot never queues mirror jobs while the 16-shard full run is in progress (the lander's ci would wait behind them,
// 22 Oct 21:31Z). fullRunBusy cases, waitForFullRun CALLED with stubs (#9768), runPilot wiring. Breaks: rule, wait, wiring.
import { readFileSync } from 'node:fs';
import { fullRunBusy, waitForFullRun } from './infra/mirror.mjs';
const SRC = readFileSync(new URL('./infra/mirror.mjs', import.meta.url), 'utf8');
let asserts = 0, fails = 0, breaks = 0; const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const cases = (f) => { const bad = []; const t = (n, c) => { let v = false; try { v = !!c(); } catch { v = false; } if (!v) bad.push(n); };
  t('a full run in progress holds pilots', () => f([{ name: 'ci', status: 'in_progress' }, { name: 'ci-full', status: 'in_progress' }]) === true);
  t('no full run lets pilots go', () => f([{ name: 'ci', status: 'in_progress' }, { name: 'ci-pilot', status: 'in_progress' }]) === false);
  t('a finished full run lets pilots go', () => f([{ name: 'ci-full', status: 'completed' }]) === false);
  t('an empty list lets pilots go', () => f([]) === false && f(null) === false);
  return bad; };
const r = cases(fullRunBusy); ok(r.length === 0, 'fullRunBusy: ' + r.join('; '));
for (const [n, f] of [['never busy', () => false], ['any run busy', (rs) => (rs || []).some((x) => x.status === 'in_progress')]]) { const b = cases(f); ok(b.length > 0, `cases cannot tell "${n}"`); if (b.length) { breaks++; console.log(`  ✓ "${n}" caught: ${b[0]}`); } }
// #9768: the wait is CALLED here with stubs (a source regex stayed green while `let runs` sat inside a // comment and every pilot threw for 2 h)
const busy = { workflow_runs: [{ name: 'ci-full', status: 'in_progress' }] }, free = { workflow_runs: [] };
const sim = async (W, script, workflow = 'worker-pack', maxMs = 45 * 60e3) => { let t = 0, gets = 0, naps = 0; const seq = [...script];
  const min = await W('o/r', { lane: 'x', workflow, maxMs, clock: () => t, nap: async (ms) => { naps++; t += ms; }, log: () => {},
    get: async () => { gets++; const v = seq.length ? seq.shift() : free; if (v === 'throw') throw new Error('api down'); return v; } });
  return { min, gets, naps }; };
const waitCases = async (W) => { const bad = []; const t = async (n, f) => { let v = false; try { v = await f(); } catch (e) { v = false; bad.push(n + ' (threw ' + e.message + ')'); return; } if (!v) bad.push(n); };
  await t('busy twice then free: waits 2 naps, then goes', async () => { const r = await sim(W, [busy, busy, free]); return r.naps === 2 && r.gets === 3 && r.min === 2; });
  await t('free at once: no wait', async () => { const r = await sim(W, [free]); return r.naps === 0 && r.min === 0; });
  await t('inside ci / ci-full / ci-pilot: no GET, no wait', async () => { for (const w of ['ci', 'ci-full', 'ci-pilot']) { const r = await sim(W, [busy], w); if (r.gets || r.naps) return false; } return true; });
  await t('an unreadable runs list never blocks', async () => { const r = await sim(W, ['throw', busy]); return r.naps === 0; });
  await t('bounded: always busy stops at maxMs', async () => { const r = await sim(W, Array(100).fill(busy), 'worker-pack', 5 * 60e3); return r.naps === 5; });
  return bad; };
const wb = await waitCases(waitForFullRun); ok(wb.length === 0, 'waitForFullRun: ' + wb.join('; '));
for (const [n, f] of [['never waits', async () => 0], ['waits without bound', async (repo, o) => { for (let i = 0; i < 1000; i++) await o.nap(60e3); return 0; }],
  ['the swallowed declaration (#9768)', async (repo, o) => { if (!/^ci/.test(o.workflow)) { await o.get('x'); if (!fullRunBusy(runs__undeclared)) return 0; } return 0; }]]) {   // eslint-disable-line no-undef
  const b = await waitCases(f); ok(b.length > 0, `waitCases cannot tell "${n}"`); if (b.length) { breaks++; console.log(`  \u2713 "${n}" caught: ${b[0]}`); } }
const W = /export async function runPilot[\s\S]{0,900}await waitForFullRun\(repo, \{ lane \}\);[\s\S]{0,200}const id = randomBytes\(5\)\.toString\('hex'\), dir = snapshot\(ROOT, \['pilot'\]\);/;
ok(W.test(SRC), 'runPilot calls waitForFullRun before it snapshots and pushes');
if (!W.test(SRC.replace('await waitForFullRun(repo, { lane });', ''))) { breaks++; console.log('  \u2713 runPilot without the wait is caught'); }
console.log(`pilotgatecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
