#!/usr/bin/env node
// hostloadcheck.mjs - #1632: the lander re-runs a red suite that carries a host-load signature (out of memory, the
// game never came up, the local server refused) before it bounces a PR for it.
//   node tools/hostloadcheck.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isHostLoad, HOST_LOAD, withHostRetry } from './infra/hostload.mjs';

let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
// lines copied from the lander's own bounce comments of 2 Oct 2026
const LOAD = [
  'mirror api GET /repos/circulo-bastiat/lattice/actions/runs -> 403',   // #9703
  'FATAL ERROR: Zone Allocation failed - process out of memory',
  '[low_level_alloc.cc : 554] RAW: Check new_pages != nullptr failed: VirtualAlloc failed',
  'FAIL  harness: Error: never reached the game',
  'Error: connect ECONNREFUSED 127.0.0.1:9702',
  'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
];
const REAL = [
  'mirror api GET /repos/o/r/actions/runs -> 404 expected',   // #9703: a 404 is not the host
  'FAIL  and a 64-stack really does submit five times the geometry (218 -> 418)',
  'TypeError: Cannot read properties of undefined (reading \'buildGoals\')',
  'Auto-merging src/07j_entityrender.js\nCONFLICT (content): Merge conflict in tools/mobl3check.mjs',
  '  ✗ modecheck            173 ms  56 assertions, 1 failures, 6 breaks caught',
];
for (const l of LOAD) ok(isHostLoad(l), 'a host-load line is not recognised: ' + l.slice(0, 60));
for (const l of REAL) ok(!isHostLoad(l), 'a real failure is taken for host load: ' + l.slice(0, 60));
ok(!isHostLoad('') && !isHostLoad(undefined), 'empty output is not host load');

// the retry loop itself
const mk = (outs) => { let i = 0; const calls = []; const run = () => { calls.push(i); return outs[Math.min(i++, outs.length - 1)]; }; return { run, calls }; };
const red = (t) => ({ status: 1, stdout: t, stderr: '' }), green = { status: 0, stdout: 'ok', stderr: '' };
const opts = { wait() {}, pause: 0 };
let m = mk([red(LOAD[0]), green]); let r = withHostRetry(m.run, opts);
ok(r.status === 0 && m.calls.length === 2 && r.retries === 1, 'a load red followed by green is retried once and passes');
m = mk([red(LOAD[0])]); r = withHostRetry(m.run, opts);
ok(r.status === 1 && m.calls.length === 3 && r.retries === 2, 'a load red that stays red is tried 3 times then bounces (' + m.calls.length + ')');
m = mk([red(REAL[0]), green]); r = withHostRetry(m.run, opts);
ok(r.status === 1 && m.calls.length === 1, 'a real red bounces at once, no retry');
m = mk([green]); r = withHostRetry(m.run, opts);
ok(r.status === 0 && m.calls.length === 1, 'green runs once');
const waits = []; m = mk([red(LOAD[1]), green]); withHostRetry(m.run, { wait: (ms) => waits.push(ms) });
ok(waits.length === 1 && waits[0] >= 60000, 'it really pauses before the re-run (' + waits + ')');

// land.mjs really uses it for the build and the core suite
const land = readFileSync(fileURLToPath(new URL('./infra/land.mjs', import.meta.url)), 'utf8');
// #6767: the core suite goes through suite() (local, or the public test mirror), still inside retry()
ok(/withHostRetry/.test(land) && /retry\(\(\) => suite\(\['--core'\]\)\)/.test(land), 'land.mjs runs the core suite through the host-load retry');
ok(/retry\(\(\) => sh\('node', \['tools\/suite\.mjs', '--fast', '--to', 'build'\]/.test(land), 'land.mjs runs the build through the host-load retry');

// ---- anti-vacuity: broken detectors / loops must be caught by the same assertions
const detects = (re) => LOAD.every((l) => re.test(l)) && !REAL.some((l) => re.test(l));
for (const [name, re] of [['never matches', /$^/], ['matches everything', /[\s\S]*/], ['only the first line', /Zone Allocation failed/]]) {
  const caught = !detects(re); ok(caught, `the cases cannot tell "${name}" from the real signature`);
  if (caught) { breaks++; console.log(`  ✓ a detector that ${name} fails the cases`); }
}
ok(detects(HOST_LOAD), 'the real signature passes the same test the broken ones fail');
{ // a loop that never retries, and one that retries real reds, both fail the retry cases
  const never = (run) => run();
  m = mk([red(LOAD[0]), green]); const a = never(m.run); const c1 = !(a.status === 0);
  const always = (run) => { let x = run(); for (let i = 0; i < 2 && x.status; i++) x = run(); return x; };
  m = mk([red(REAL[0]), green]); always(m.run); const c2 = m.calls.length !== 1;
  for (const [n, c] of [['never retries', c1], ['retries a real red', c2]]) { ok(c, `the retry cases cannot tell "${n}" from the real loop`); if (c) { breaks++; console.log(`  ✓ a loop that ${n} fails the cases`); } }
}
console.log(`hostloadcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
