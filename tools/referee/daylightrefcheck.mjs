#!/usr/bin/env node
// daylightrefcheck.mjs — infra I6 (24 Sept 2026): DAYLIGHT DETECTOR output, the engine against the REAL 1.18.2 server.
//
//   node tools/referee/rundaylight.mjs      # once per machine/store (~2 min, the real server)
//   node tools/referee/daylightrefcheck.mjs [--verbose]
//
// For every time of day in the golden (0..24000 by 500, plus dusk/dawn quarter points), clear weather, full sky
// light: the engine's `Redstone.daylightSignal(15, inverted, t, 0, 0)` (sunAngle from 09b_sky.js, skyDarken, the
// cos/round/clamp of DaylightDetectorBlock.updateState) must equal the server's `power` for a normal AND an inverted
// detector. Anti-vacuity (D-30/D-305): the golden shifted by one time step, a detector that ignores skyDarken, and an
// inverted detector that is not inverted must each be caught; the golden must span 0..15 (normal) and move. No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'daylight.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'daylight.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('daylightrefcheck: SKIP (golden not generated -- run node tools/referee/rundaylight.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function engine(hook) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07f_redstone.js', '09b_sky.js'], dom: false });
  const w = { get: () => 0, set: () => {} };
  w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15 << 4;
  M.Behave.init(w);
  M.Redstone.init();
  // Sky.ready is set by Sky.init (the renderer's, WebGL); the arithmetic (sunAngle/timeOfDay) needs none of it --
  // without the flag Redstone falls back to angle 0 (noon) and every reading is 15/0.
  M.Sky.ready = true;
  if (hook) hook(M);
  const Rs = M.Redstone;
  return { normal: golden.times.map((t) => Rs.daylightSignal(15, false, t, 0, 0)), inverted: golden.times.map((t) => Rs.daylightSignal(15, true, t, 0, 0)) };
}
function compare(g, e) {
  const bad = [];
  for (const k of ['normal', 'inverted']) golden.times.forEach((t, i) => { if (g[k][i] !== e[k][i]) bad.push(`${k} @ time ${t}: server ${g[k][i]} | engine ${e[k][i]}`); });
  return bad;
}

console.log(`daylightrefcheck — daylight detector vs the real 1.18.2 server (${golden.times.length} times, ${golden.generatedAt})`);
ok(golden.normal.every((v) => v >= 0) && golden.inverted.every((v) => v >= 0), 'every golden reading was found (no -1)');
ok(Math.min(...golden.normal) === 0 && Math.max(...golden.normal) === 15, `the normal detector spans 0..15 (${Math.min(...golden.normal)}..${Math.max(...golden.normal)})`);
let E;
try { E = engine(); } catch (e) { ok(false, 'engine threw ' + e.message); }
if (E) {
  const bad = compare(golden, E);
  for (const b of bad) ok(false, b);
  pass += golden.times.length * 2 - bad.length;
  if (VERBOSE) golden.times.forEach((t, i) => console.log(`   ${String(t).padStart(5)}  S ${golden.normal[i]}/${golden.inverted[i]}  E ${E.normal[i]}/${E.inverted[i]}`));
  const breakCaught = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
  breakCaught('the golden shifted one time step is a mismatch',
    compare({ normal: [golden.normal[0], ...golden.normal.slice(0, -1)], inverted: golden.inverted }, E).length > 0);
  breakCaught('a detector that ignores skyDarken is a mismatch', compare(golden, engine((M) => { M.Redstone.skyDarken = () => 0; })).length > 0);
  breakCaught('an inverted detector that is not inverted is a mismatch', compare(golden, { normal: E.normal, inverted: E.normal }).length > 0);
}
console.log(`daylightrefcheck: ${fails.length} fail, ${breaks} breaks`);
for (const f of fails.slice(0, 60)) console.log('  ✗ ' + f);
console.log('');
console.log('================ daylightrefcheck (I6) ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
