#!/usr/bin/env node
// timeweathercheck.mjs — worker3/mobcommand-s146: /time, /weather, /seed and /gamerule LIVE
// in the browser (MCLITE_PRESET=medium), against a real running game, the same way
// mobcmdkillcheck.mjs drove /kill and found it silently broken. tools/commandcheck.mjs already
// covers these four commands node-side (a headless dispatcher over a headless NS); this check
// exists to prove the same fixes hold once a real Main.play() loop, a real Sky.tick() and a
// real render frame are involved, and that nothing prints to the console doing it.
//
//   MCLITE_PRESET=medium node tools/timeweathercheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  timeweathercheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(600);

  const ev = (body) => page.evaluate(mkFn(body));
  const run = (cmd) => ev('var r = MCL.Commands.run(' + JSON.stringify(cmd) + ', MCL.Player, {name:"Dan"}); return {ok:r.ok, result:r.result, lines:r.lines||[]};');

  // -- /seed -- the real generator's own seed, not a copy --------------------------------
  const seedResp = await run('/seed');
  const realSeed = await ev('return MCL.Main.seed;');
  ok(seedResp.ok, '/seed runs live');
  ok(String(realSeed) !== '' && seedResp.lines[0].indexOf(String(realSeed)) >= 0,
     `/seed reports the SAME seed the world was actually generated with ("${seedResp.lines[0]}" vs ${realSeed})`);

  // -- /time set / add -- feedback vs. return value, live, against a real ticking Sky ----
  await ev('MCL.Sky.daylightCycle = true; MCL.Sky.dayTime = 20000; return 1;');
  const tset = await run('/time set 30000');
  ok(tset.ok && tset.lines[0].indexOf('30000') >= 0, `live /time set 30000 feedback is the raw value: "${tset.lines[0]}"`);
  ok(tset.result === 6000, `...but the live RETURN is wrapped mod 24000 (${tset.result})`);
  const dtAfterSet = await ev('return MCL.Sky.dayTime;');
  ok(dtAfterSet === 30000, `...and the actual clock (Sky.dayTime) stores the RAW value, unwrapped (${dtAfterSet})`);

  const tadd = await run('/time add 4000');
  ok(tadd.ok && tadd.result === 10000, `live /time add wraps its return too (34000 % 24000 = ${tadd.result})`);
  ok(tadd.lines[0].indexOf('10000') >= 0, `...and its feedback matches the wrapped value: "${tadd.lines[0]}"`);

  // -- /time query gametime -- Main.ticks, independent of dayTime and of doDaylightCycle -
  const realTicks1 = await ev('return MCL.Main.ticks;');
  const gt1 = await run('/time query gametime');
  ok(gt1.ok && gt1.result === realTicks1, `gametime matches the real Main.ticks counter (${gt1.result} vs ${realTicks1})`);
  okAv(gt1.result !== (await ev('return MCL.Sky.dayTime;')),
       `anti-vacuity: the pre-fix bug read Sky.dayTime here, a different number from Main.ticks`);
  await ev('MCL.Sky.daylightCycle = false; return 1;');
  await sleep(1000);   // real frames tick MCL.Main.ticks; the daylight-cycle gate must not touch it
  // read Main.ticks and run /time query gametime in the SAME evaluate call -- two separate
  // round-trips race against the real 20Hz loop still advancing Main.ticks between them.
  const together = await ev(
    'var before = MCL.Main.ticks; var r = MCL.Commands.run("/time query gametime", MCL.Player, {name:"Dan"}); ' +
    'return {before: before, result: r.result, after: MCL.Main.ticks};'
  );
  ok(together.after >= realTicks1, `time actually passed in the real loop (${realTicks1} -> ${together.after})`);
  ok(together.result >= together.before && together.result <= together.after,
     `gametime kept advancing with doDaylightCycle OFF, live, and stayed in lockstep with Main.ticks (${together.before} <= ${together.result} <= ${together.after})`);
  await ev('MCL.Sky.daylightCycle = true; return 1;');

  // -- /weather -- flat default, seconds*20, shared rain/thunder timer, all live ---------
  await ev('if (!MCL.Sky.weather) MCL.Sky.weather = MCL.Sky.newWeather(); return 1;');
  const wDefault = await run('/weather rain');
  const wxAfterDefault = await ev('return {r: MCL.Sky.weather.rainTime, t: MCL.Sky.weather.thunderTime, raining: MCL.Sky.weather.raining};');
  ok(wDefault.ok && wxAfterDefault.r === 6000, `live /weather rain with no duration is a flat 6000 ticks, not a random draw (${wxAfterDefault.r})`);
  ok(wxAfterDefault.raining === true, '...and it is actually raining now, live');

  const w600 = await run('/weather rain 600');
  const wx600 = await ev('return {r: MCL.Sky.weather.rainTime, t: MCL.Sky.weather.thunderTime};');
  ok(w600.ok && wx600.r === 12000, `live /weather rain 600 is 600 SECONDS = 12000 ticks, not 600 (${wx600.r})`);
  ok(wx600.t === 12000, `...and thunderTime shares the exact same value, live (${wx600.t})`);
  okAv(wx600.r !== 600, 'anti-vacuity: parsing <duration> as bare ticks would have left rainTime at 600, not 12000');

  const wClear = await run('/weather clear 10');
  const wxClear = await ev('return {r: MCL.Sky.weather.rainTime, t: MCL.Sky.weather.thunderTime, c: MCL.Sky.weather.clearTime, raining: MCL.Sky.weather.raining};');
  ok(wClear.ok && wxClear.c === 200, `live /weather clear 10 is 10s = 200 ticks of clear (${wxClear.c})`);
  ok(wxClear.r === 0 && wxClear.t === 0, `...and zeroes BOTH the rain and thunder timers, live (${wxClear.r}/${wxClear.t})`);
  ok(wxClear.raining === false, '...and it is actually not raining anymore, live');

  // let the real weather machine run a few real ticks to prove nothing it touched is dead code
  await sleep(500);
  const settled = await ev('return {r: MCL.Sky.weather.rainTime, gl: (MCL.Weather && (MCL.Weather.glError || MCL.Weather.gpuError)) || null};');
  ok(!settled.gl, `no GPU/weather-pass error after real ticks with the fixed state (${settled.gl})`);

  // -- /gamerule doDaylightCycle -- real live wiring, driven through the real command ----
  await ev('MCL.Sky.daylightCycle = true; MCL.Sky.dayTime = 12345; return 1;');
  await run('/gamerule doDaylightCycle false');
  const dcOff1 = await ev('return MCL.Sky.dayTime;');
  await sleep(500);
  const dcOff2 = await ev('return MCL.Sky.dayTime;');
  ok(dcOff1 === dcOff2, `live /gamerule doDaylightCycle false actually freezes the real clock (${dcOff1} == ${dcOff2})`);
  await run('/gamerule doDaylightCycle true');
  await sleep(500);
  const dcOn = await ev('return MCL.Sky.dayTime;');
  ok(dcOn > dcOff2, `...and /gamerule doDaylightCycle true starts it again, live (${dcOff2} -> ${dcOn})`);

  const consoleErrs = page.problems || [];
  ok(consoleErrs.length === 0, `the page console stayed clean (${consoleErrs.length} errors)`, consoleErrs.slice(0, 5).join(' | '));
} catch (e) {
  fails.push('EXCEPTION: ' + (e && e.stack || e));
  console.log('EXCEPTION', e);
} finally {
  await page.close();
}

console.log('==============================================================================');
console.log(' timeweathercheck: ' + (pass + fails.length) + ' assertions, ' + fails.length + ' failed');
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
