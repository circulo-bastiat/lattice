// tools/workermodelcheck.mjs - #5017 (Dan, 10 Oct: "haiku is not permitted for workers, sonnet 5 low is"). A worker runs Sonnet at LOW effort,
// and a dispatch reason such as `model=claude-haiku-5-5` can never put a Haiku on the worker role. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { roles: rd('./brain/roles.json'), route: rd('./brain/route.mjs'), launch: rd('./brain/launch.mjs') };
const fnOf = (route) => { const m = /export function workerModelFor\([^)]*\) \{[^\n]*\}/.exec(route); if (!m) return null; try { return new Function(m[0].replace('export function', 'function') + '; return workerModelFor;')(); } catch { return null; } };
const verdict = (S) => {
  const bad = []; let C; try { C = JSON.parse(S.roles); } catch { return ['roles.json is not valid JSON']; }
  const w = (C.roles || {}).worker || {};
  if (w.model !== 'sonnet') bad.push(`worker model is ${w.model} (must be sonnet)`);
  if (w.effort !== 'low') bad.push(`worker effort is ${w.effort} (must be low)`);
  const f = fnOf(S.route);
  if (!f) bad.push('route.mjs has no workerModelFor');
  else {
    if (f('worker', 'claude-haiku-5-5', 'sonnet') !== 'sonnet') bad.push('a worker can still be given claude-haiku-5-5');
    if (f('worker', 'Haiku', 'sonnet') !== 'sonnet') bad.push('a worker can still be given Haiku (case)');
    if (f('worker', 'claude-sonnet-5-5', 'sonnet') !== 'claude-sonnet-5-5') bad.push('a worker can no longer be given Sonnet by name');
    if (f('chore', 'haiku', 'haiku') !== 'haiku') bad.push('the chore role lost its Haiku');
    if (f('tester', 'claude-haiku-5-5', 'sonnet') !== 'claude-haiku-5-5') bad.push('workerModelFor touches roles other than worker');
  }
  if (!/workerModelFor\(role, modelFor\(reason,/.test(S.launch)) bad.push('launch.mjs does not apply workerModelFor to the chosen MODEL');
  return bad;
};
const mut = (fn) => (S) => { const C = JSON.parse(S.roles); fn(C); return { ...S, roles: JSON.stringify(C) }; };
const BREAKS = [
  ['worker effort medium', mut((C) => { C.roles.worker.effort = 'medium'; })],
  ['worker model haiku', mut((C) => { C.roles.worker.model = 'haiku'; })],
  ['guard never blocks', (S) => ({ ...S, route: S.route.replace("role === 'worker' && /haiku/i.test(String(model || ''))", 'false') })],
  ['guard is case sensitive', (S) => ({ ...S, route: S.route.replace('/haiku/i', '/haiku/') })],
  ['guard blocks every model for a worker', (S) => ({ ...S, route: S.route.replace("&& /haiku/i.test(String(model || ''))", '') })],
  ['guard blocks every role', (S) => ({ ...S, route: S.route.replace("role === 'worker' && ", '') })],
  ['guard function removed', (S) => ({ ...S, route: S.route.replace('export function workerModelFor', 'export function somethingElse') })],
  ['launch no longer applies it', (S) => ({ ...S, launch: S.launch.replace('workerModelFor(role, modelFor(reason,', 'modelFor(reason,') })],
  ['roles.json broken', (S) => ({ ...S, roles: '{' })],
];
const real = verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { if (verdict(mk(SRC)).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`workermodelcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
