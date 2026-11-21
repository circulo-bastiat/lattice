// farmclockcheck (22 Oct): RUNS tools/infra/farmclock.mjs on fixtures and checks the brain wires it (dispatch in the health pass, `farm-stale` finding). Prints '<n> breaks caught'.
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url)), SRC = readFileSync(join(TOOLS, 'infra', 'farmclock.mjs'), 'utf8');
let ASSERTS = 0;
async function run(mut) {
  let fails = 0; const ok = (c, msg) => { ASSERTS++; if (!c) { fails++; if (!mut) console.log('FAIL: ' + msg); } };
  let src = SRC; if (mut) { if (!src.includes(mut[0])) throw new Error('no-op break: ' + mut[0]); src = src.replace(mut[0], mut[1]); }
  const d = mkdtempSync(join(tmpdir(), 'fcc-')); writeFileSync(join(d, 'farmclock.mjs'), src);
  const m = await import(pathToFileURL(join(d, 'farmclock.mjs')).href + '?' + Math.random()); rmSync(d, { recursive: true, force: true });
  const now = Date.parse('2026-10-22T12:00:00Z'), ago = (min, st = 'completed') => ({ created_at: new Date(now - min * 60e3).toISOString(), status: st });
  ok(m.farmAgeMin([ago(95)], now) === 95 && m.farmAgeMin([], now) === null, 'farmAgeMin = minutes since the newest run, null when none');
  ok(m.farmDispatchDue([ago(250)], now, 0) === true, 'a 250 min old farm run is due');
  ok(m.farmDispatchDue([ago(120)], now, 0) === false, 'a 120 min old run is not due');
  ok(m.farmDispatchDue([ago(200, 'in_progress')], now, 0) === false, 'never while a run is in progress');
  ok(m.farmDispatchDue([ago(200, 'queued')], now, 0) === false, 'never while a run is queued');
  ok(m.farmDispatchDue([ago(1320, 'queued')], now, 0) === true && m.farmDispatchDue([ago(300, 'in_progress')], now, 0) === true, '#10540: a run queued/in progress past the stale limit is stuck, so the farm is due');
  ok(m.farmDispatchDue([ago(250)], now, now - 30 * 60e3) === false, 'at most one dispatch per 60 min');
  ok(m.farmDispatchDue([], now, 0) === true, 'no run ever = due (the farm never started)');
  ok(m.farmDispatchDue(null, now, 0) === false && m.farmDispatchDue(undefined, now, 0) === false, 'an unreadable listing never dispatches');
  return fails;
}
const base = await run();
const brain = readFileSync(join(TOOLS, 'brain', 'brain.mjs'), 'utf8'), route = readFileSync(join(TOOLS, 'brain', 'route.mjs'), 'utf8');
let wfail = 0; for (const [msg, c] of [
  ['brain.mjs dispatches pilot-farm.yml from the health pass', /farmDispatchDue\(/.test(brain) && /workflows\/pilot-farm\.yml\/dispatches/.test(brain)],
  ['brain.mjs puts farmAgeMin on the health snapshot', /farmAgeMin/.test(brain.slice(brain.indexOf('const snap = {')))],
  ['route.mjs raises farm-stale', /key: 'farm-stale'/.test(route) && /snap\.farmAgeMin/.test(route)],
]) { ASSERTS++; if (!c) { wfail++; console.log('FAIL: ' + msg); } }
const breaks = [
  ['age', ["age > maxAgeMin", "age >= 0"]],
  ['running', ["r.status === 'in_progress' || r.status === 'queued'", "false"]],
  ['stale', ["!((now - Date.parse(r.created_at)) > staleMin * 60e3)", "true"]],
  ['rate', ["now - lastDispatch < everyMin * 60e3", "false"]],
  ['none', ["age === null || age > maxAgeMin", "age > maxAgeMin"]],
  ['blind', ["if (!Array.isArray(runs)) return false;", ""]],
];
let caught = 0; for (const [id, mut] of breaks) { if (await run(mut).catch(() => 1)) caught++; else console.log('NOT CAUGHT: ' + id); }
if (base || wfail || caught < breaks.length) { console.log(`farmclockcheck: FAIL (${base} rule(s), ${wfail} wiring, ${caught}/${breaks.length} breaks caught)`); process.exit(1); }
console.log(`farmclockcheck: ${caught} breaks caught, ${ASSERTS} assertions`);
