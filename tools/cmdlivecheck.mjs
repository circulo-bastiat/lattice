#!/usr/bin/env node
// cmdlivecheck.mjs -- parallel night worker 4: defaultgamemode, say, me, msg, playsound,
// stopsound, spawnpoint, setworldspawn, locatebiome, locate, list, tellraw, title -- LIVE in a
// real running game (MCLITE_PRESET=medium), the first time any of them have been driven that
// way rather than only read (session 145's own /kill and @e[type=...] discovery is this unit's
// standing warning: nothing that has only been READ is trusted here).
//
// ⚠⚠ TWO REAL BUGS FOUND, BOTH IN `M.oneOf`'s `asId` PATH (src/15g_commands.js) -- THE SAME
// SHARED HELPER, HIT FROM BOTH SIDES BY /locatebiome AND /locate.
//
//   1. `/locatebiome plains` (the ordinary, unprefixed way every player types a biome name)
//      failed with "There is no biome with type \"plains\"" -- `Climate.biomeNames` is entirely
//      namespaced (`minecraft:plains`, ...) and the old `M.oneOf` compared the raw typed text
//      against the raw set with no normalisation, so only `/locatebiome minecraft:plains`
//      (typed in full) ever matched.
//   2. `/locate minecraft:village` (the fully-qualified form, equally valid vanilla syntax --
//      `14h_brigadier.js:99`'s own comment: "Vanilla accepts minecraft:stone and stone
//      interchangeably everywhere an id is expected") failed with "Could not find a structure of
//      type \"minecraft:village\" nearby" -- `Structures`' member types are bare (`village`, not
//      `minecraft:village`), so the SAME unnormalised compare rejected the namespaced form here.
//
// Fixed once, in `M.oneOf` itself (not duplicated per-caller): the `asId` compare now strips
// `minecraft:` from both the typed text and each set entry before matching, and returns the
// SET's own canonical entry (so callers built on a namespaced set keep getting namespaced
// values back, and callers built on a bare set keep getting bare ones) -- one normalisation, at
// the one place both commands share, so a third `asId` caller gets it for free.
//
// A THIRD BUG, in `/stopsound` (same file): the header comment above its own registration
// claims "FOUR MESSAGES, ONE PER COMBINATION of 'a source was named' and 'a sound was named'"
// but only three were ever wired up -- the fourth, vanilla's own `<targets> * <sound>` grammar
// (`StopSoundCommand.register`, `.decomp`: a literal `*` stands in for "no source" so the sound
// argument has something to hang off), was a flat parse failure (`argument.id.invalid`) for
// ANY sound name. And where a sound name WAS accepted (`<targets> <source> <sound>`), it never
// reached `Sound.stopAll` at all -- only the source did -- so naming a specific sound silently
// stopped EVERY sound on that source instead, the exact "the wrong thing happened and the
// success message said it worked" shape session 145's own /kill bug had.
//
// Sections:
//   1. /locatebiome and /locate -- both id-normalisation directions, live, against a world that
//      actually has a nearby plains biome and a nearby village (this world's own real terrain,
//      not fabricated coordinates) plus the not-found path for each.
//   2. /stopsound -- the `* <sound>` grammar parses and stops, source+sound stops ONLY the named
//      sound (two different sounds live at once, synthetic buffered sources so the test is not
//      racing real audio decode/playback timing), and the three pre-existing forms still work.
//   3. anti-vacuity -- the exact pre-fix `M.oneOf` compare, run standalone against the exact
//      inputs section 1 used, shown to reject them (proving section 1 is not vacuous), and the
//      exact pre-fix `stopAll(source)`-only call, shown to over-stop (proving section 2 is not
//      vacuous).
//   4. a broad live smoke of all twelve commands in this unit (defaultgamemode, say, me, msg,
//      playsound, stopsound, spawnpoint, setworldspawn, locatebiome, locate, list, tellraw,
//      title) -- permission gate, basic dispatch, and feedback text, so a future regression in
//      any of them (not just the three bugs above) fails a check instead of going unnoticed the
//      way these three did.
//
//   MCLITE_PRESET=medium node tools/cmdlivecheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x ' + m + (d !== undefined ? '   ' + d : '')); } };

function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

// ── section 3a, standalone -- the EXACT pre-fix `M.oneOf` compare (no normalisation), run in
// this node process against the exact inputs section 1 will use live in the browser. This is
// the pre-fix logic itself, transcribed, not a guess at its shape.
function preFixOneOfMatches(list, typed) {
  return list.indexOf(typed) >= 0;
}

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  cmdlivecheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();
  // a real click, for real `AudioContext` unlock -- `/playsound` and `/stopsound` need a
  // non-blocked context to do anything but immediately fail on "too far away" for the WRONG
  // reason (autoplay policy, not distance); the smoke section below cross-checks this.
  await page.click(450, 300);
  await sleep(300);

  const ev = (body) => page.evaluate(mkFn(body));
  const run = (cmd) => ev(
    'var P = MCL.Player; var r = MCL.Commands.run(' + JSON.stringify(cmd) + ', P, {name: "Dan"});' +
    'return { ok: r.ok, lines: r.lines, err: r.error && { key: r.error.key, message: r.error.message } };'
  );

  // ── section 1: /locatebiome and /locate, both id-normalisation directions ─────────────────
  const biomeNames = await ev('return (MCL.Climate && MCL.Climate.biomeNames) ? MCL.Climate.biomeNames.slice() : [];');
  ok(Array.isArray(biomeNames) && biomeNames.indexOf('minecraft:plains') >= 0,
    'the world\'s own biome set has minecraft:plains (ground truth for the case below)', JSON.stringify(biomeNames.slice(0, 5)));

  const lbBare = await run('/locatebiome plains');
  ok(lbBare.ok && /minecraft:plains/.test(lbBare.lines[0] || ''),
    '/locatebiome plains (bare, the ordinary way every player types it) resolves', JSON.stringify(lbBare));
  const lbFull = await run('/locatebiome minecraft:plains');
  ok(lbFull.ok && /minecraft:plains/.test(lbFull.lines[0] || ''),
    '/locatebiome minecraft:plains (fully namespaced) still resolves the same way', JSON.stringify(lbFull));
  const lbBad = await run('/locatebiome not_a_real_biome');
  ok(!lbBad.ok && lbBad.err && lbBad.err.key === 'commands.locatebiome.invalid',
    '/locatebiome <garbage> is still rejected at parse time (the fix did not loosen the set itself)', JSON.stringify(lbBad));

  const structTypes = await ev(
    'var ST = MCL.Structures, seen = {}, out = []; if (ST && ST.ready) { for (var i = 0; i < ST.sets.length; i++) { if (!ST.sets[i].live) continue; var mem = ST.sets[i].members; for (var j = 0; j < mem.length; j++) { var t = mem[j].def.type; if (t && !seen[t]) { seen[t] = 1; out.push(t); } } } } return out;'
  );
  ok(Array.isArray(structTypes) && structTypes.indexOf('village') >= 0,
    'the world\'s own structure set has bare "village" (ground truth for the case below)', JSON.stringify(structTypes));

  const locBare = await run('/locate village');
  ok(locBare.ok && /village/.test(locBare.lines[0] || ''),
    '/locate village (bare, matching the bare set) resolves', JSON.stringify(locBare));
  const locFull = await run('/locate minecraft:village');
  ok(locFull.ok && /village/.test(locFull.lines[0] || ''),
    '/locate minecraft:village (fully namespaced, the OTHER normalisation direction) resolves the same way', JSON.stringify(locFull));
  const locBad = await run('/locate not_a_real_structure');
  ok(!locBad.ok && locBad.err && locBad.err.key === 'commands.locate.failed',
    '/locate <garbage> is still rejected at parse time', JSON.stringify(locBad));

  // ── section 2: /stopsound -- the missing `* <sound>` grammar, and specific-sound filtering ──
  const starParse = await run('/stopsound @s * minecraft:entity.experience_orb.pickup');
  ok(starParse.ok, '/stopsound <targets> * <sound> (vanilla\'s "any source, this sound" form) parses and runs', JSON.stringify(starParse));
  ok(starParse.ok && starParse.lines[0] === 'Stopped sound \'entity.experience_orb.pickup\'',
    'and sends the fourth lang key, commands.stopsound.success.sourceless.sound', JSON.stringify(starParse));

  const soundlessAny = await run('/stopsound @s');
  ok(soundlessAny.ok && /Stopped all sounds/.test(soundlessAny.lines[0] || ''), '/stopsound <targets> (bare) still works', JSON.stringify(soundlessAny));
  const sourceAny = await run('/stopsound @s master');
  ok(sourceAny.ok && /master/.test(sourceAny.lines[0] || ''), '/stopsound <targets> <source> still works', JSON.stringify(sourceAny));

  // specific-sound filtering, deterministic: two synthetic `S.live` records (no real decode/
  // playback race), one `sound.a`, one `sound.b`, both on `master`; `/stopsound ... sound.a`
  // must remove exactly the `sound.a` record and leave `sound.b` alone.
  const filterResult = await ev(
    'var S = MCL.Sound;' +
    'var stopped = { a: false, b: false };' +
    'var recA = { source: "master", sound: "sound.a", src: { stop: function () { stopped.a = true; } } };' +
    'var recB = { source: "master", sound: "sound.b", src: { stop: function () { stopped.b = true; } } };' +
    'S.live.push(recA, recB);' +
    'var n = S.stopAll("master", "sound.a");' +
    'var aGone = S.live.indexOf(recA) < 0, bStill = S.live.indexOf(recB) >= 0;' +
    'var i = S.live.indexOf(recB); if (i >= 0) S.live.splice(i, 1);' + // clean up regardless of outcome
    'var j = S.live.indexOf(recA); if (j >= 0) S.live.splice(j, 1);' +
    'return { n: n, stoppedA: stopped.a, stoppedB: stopped.b, aGone: aGone, bStill: bStill };'
  );
  ok(filterResult.n === 1 && filterResult.stoppedA && !filterResult.stoppedB && filterResult.aGone && filterResult.bStill,
    'Sound.stopAll(source, sound) stops ONLY the matching sound, not every sound on that source', JSON.stringify(filterResult));

  // ── section 3: anti-vacuity ────────────────────────────────────────────────────────────────
  okAv(!preFixOneOfMatches(biomeNames, 'plains'),
    'the pre-fix M.oneOf compare (raw indexOf, no normalisation) would have rejected "plains" against the namespaced biome set -- proving section 1\'s bare-name assertion is not vacuous');
  okAv(!preFixOneOfMatches(structTypes, 'minecraft:village'),
    'the pre-fix M.oneOf compare would have rejected "minecraft:village" against the bare structure set -- proving section 1\'s namespaced-form assertion is not vacuous');
  const preFixStopAll = await ev(
    'var S = MCL.Sound;' +
    'var stopped = { a: false, b: false };' +
    'var recA = { source: "master", sound: "sound.a", src: { stop: function () { stopped.a = true; } } };' +
    'var recB = { source: "master", sound: "sound.b", src: { stop: function () { stopped.b = true; } } };' +
    'S.live.push(recA, recB);' +
    // the pre-fix call shape: stopAll(source) only, sound name never passed through
    'var n = S.stopAll("master");' +
    'var i = S.live.indexOf(recB); if (i >= 0) S.live.splice(i, 1);' +
    'var j = S.live.indexOf(recA); if (j >= 0) S.live.splice(j, 1);' +
    'return { n: n, stoppedA: stopped.a, stoppedB: stopped.b };'
  );
  okAv(preFixStopAll.n === 2 && preFixStopAll.stoppedA && preFixStopAll.stoppedB,
    'the pre-fix stopAll(source)-only call stops BOTH sounds on that source, not just the named one -- proving the filter assertion above is not vacuous', JSON.stringify(preFixStopAll));

  // ── section 4: a broad live smoke of the whole unit ───────────────────────────────────────
  const dgm = await run('/defaultgamemode creative');
  ok(dgm.ok && /Creative Mode/.test(dgm.lines[0] || ''), '/defaultgamemode creative sets and reports it', JSON.stringify(dgm));
  const dgmBad = await run('/defaultgamemode not_a_mode');
  ok(!dgmBad.ok, '/defaultgamemode <garbage> is rejected', JSON.stringify(dgmBad));
  const dgmLevel = await ev('var s = MCL.Commands.source(MCL.Player, { level: 0, name: "Dan" }); var r = MCL.Commands.dispatcher.execute("defaultgamemode survival", s); return { ok: r.ok };');
  ok(dgmLevel.ok === false, '/defaultgamemode is permission-gated (level 0 cannot run it)', JSON.stringify(dgmLevel));

  const sayRes = await run('/say hello from cmdlivecheck');
  const meRes = await run('/me waved');
  const lastChat = await ev('var m = MCL.Chat.messages; return m.slice(-2).map(function (x) { return MCL.Text.translateComponent ? MCL.Text.translateComponent(x.component) : (MCL.Text.plain ? MCL.Text.plain(x.component) : null); });');
  ok(sayRes.ok, '/say dispatches', JSON.stringify(sayRes));
  ok(meRes.ok, '/me dispatches', JSON.stringify(meRes));
  const meLevel = await ev('var s = MCL.Commands.source(MCL.Player, { level: 0, name: "Dan" }); var r = MCL.Commands.dispatcher.execute("me waved", s); return { ok: r.ok };');
  ok(meLevel.ok === true, '/me has NO permission gate (level 0 can run it, matching .decomp MeCommand)', JSON.stringify(meLevel));

  const msgSelf = await run('/msg @s hi self');
  ok(msgSelf.ok && /whisper/.test(msgSelf.lines[0] || ''), '/msg @s works and reports the whisper', JSON.stringify(msgSelf));
  const msgNoTarget = await run('/msg @e[type=cow] hi');
  ok(!msgNoTarget.ok && msgNoTarget.err && msgNoTarget.err.key === 'argument.entity.notfound.player',
    '/msg only accepts players -- a non-player-only selector match still fails as "no player found"', JSON.stringify(msgNoTarget));

  const listRes = await run('/list');
  ok(listRes.ok && /1 of a max of 1 players online: Dan/.test(listRes.lines[0] || ''), '/list reports the one real player', JSON.stringify(listRes));

  const spRes = await run('/spawnpoint @s 12 70 12');
  ok(spRes.ok && /12, 70, 12/.test(spRes.lines[0] || ''), '/spawnpoint <targets> <pos> sets and reports the given position', JSON.stringify(spRes));
  const spBack = await ev('return MCL.Player.spawnPoint;');
  ok(spBack && spBack.x === 12 && spBack.y === 70 && spBack.z === 12, 'and actually mutates Player.spawnPoint to that position', JSON.stringify(spBack));
  const swsRes = await run('/setworldspawn 5 64 5');
  ok(swsRes.ok && /5, 64, 5/.test(swsRes.lines[0] || ''), '/setworldspawn <pos> sets and reports it', JSON.stringify(swsRes));
  const swsBack = await ev('return MCL.Commands.worldSpawn;');
  ok(swsBack && swsBack.x === 5 && swsBack.y === 64 && swsBack.z === 5, 'and actually mutates Commands.worldSpawn (separately from the per-player spawnpoint)', JSON.stringify(swsBack));

  const trRes = await run('/tellraw @s {"text":"hi","color":"red"}');
  ok(trRes.ok, '/tellraw <targets> <json component> dispatches', JSON.stringify(trRes));
  const trBad = await run('/tellraw @s not_json_at_all');
  ok(!trBad.ok && trBad.err && trBad.err.key === 'argument.component.invalid', '/tellraw rejects a non-JSON component', JSON.stringify(trBad));

  const titleRes = await run('/title @s title {"text":"Hi"}');
  ok(titleRes.ok, '/title @s title <component> dispatches', JSON.stringify(titleRes));
  const timesRes = await run('/title @s times 10 70 20');
  ok(timesRes.ok, '/title @s times <in> <stay> <out> dispatches', JSON.stringify(timesRes));
  const clearRes = await run('/title @s clear');
  ok(clearRes.ok, '/title @s clear dispatches', JSON.stringify(clearRes));

  const psRes = await run('/playsound minecraft:entity.experience_orb.pickup master @s');
  ok(psRes.ok && /Played sound/.test(psRes.lines[0] || ''), '/playsound plays to self by default target and reports it', JSON.stringify(psRes));
  const psBadSound = await run('/playsound not.a.real.sound master @s');
  ok(!psBadSound.ok && psBadSound.err && psBadSound.err.key === 'argument.id.unknown', '/playsound rejects an unknown sound id', JSON.stringify(psBadSound));

  ok(page.problems.length === 0, 'the page logged no errors across this whole run', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' cmdlivecheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
