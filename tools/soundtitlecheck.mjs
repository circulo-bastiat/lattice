#!/usr/bin/env node
// soundtitlecheck.mjs -- session 150 worker 2: /playsound, /tellraw, /title vanilla-parity
// audit, LIVE in the browser (MCLITE_PRESET=medium).
//
// ⚠⚠ ONE REAL BUG FOUND AND FIXED, in `src/15g_commands.js`'s `/playsound` registration:
//
//   `.decomp` `PlaySoundCommand.makeArgumentsForCategory` hangs NO `.executes()` off the
//   category (`source`) node itself -- `targets` is a required argument in vanilla, so
//   `/playsound <sound> <source>` with nothing after it is an incomplete command there. The
//   pre-fix grammar here attached an extra `.executes(function (c) { return playsound(c, 1, 1); })`
//   directly onto the `source` argument node, so that same incomplete command silently
//   SUCCEEDED, defaulting `targets` to `[ctx.source]` (self) -- a real, observable parity gap
//   (`/playsound minecraft:entity.pig.ambient master` played to self instead of failing with
//   "Unknown or incomplete command"). Fixed by removing that one `.executes()` call; the
//   `targets` node's own default-to-self `.executes()` (which vanilla's grammar also lacks
//   directly, but the CALLER always supplies `EntityArgumentType.getPlayers` there, so a bare
//   `<targets>` executes IS vanilla's real grammar) is untouched.
//
// Section 3 is the anti-vacuity pass: the exact pre-fix shape is reproduced by reattaching a
// stub executor to the live dispatcher's `source` node and the no-targets command is shown to
// succeed again under it, then the node is restored and shown to fail once more -- so this
// check is not passing by coincidence of some unrelated parse error.
//
// Everything else in the unit (categories, volume/pitch/minVolume argument handling and
// falloff, tellraw JSON component delivery, title/subtitle/actionbar/clear/reset/times) was
// read against `.decomp` (`PlaySoundCommand.java`, `TellRawCommand.java`, `TitleCommand.java`)
// and driven live; no other discrepancy survived. `minVolume` (`PlaySoundCommand`'s fifth
// argument, `.decomp` lines 96-109) is a genuinely missing argument FORM -- not built here,
// named in this run's still_owed instead, per the standing testing+fixing-only rule.
//
//   MCLITE_PRESET=medium node tools/soundtitlecheck.mjs [dist/mclite.html]

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

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  soundtitlecheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);
  await page.settleWorld();
  // a real click, for real `AudioContext` unlock -- same reasoning as cmdlivecheck.mjs
  await page.click(450, 300);
  await sleep(300);

  const ev = (body) => page.evaluate(mkFn(body));
  const run = (cmd) => ev(
    'var P = MCL.Player; var r = MCL.Commands.run(' + JSON.stringify(cmd) + ', P, {name: "Dan"});' +
    'return { ok: r.ok, lines: r.lines, err: r.error && { key: r.error.key, message: r.error.message } };'
  );

  // build the dispatcher (lazy) before we go poking at its tree
  await run('/list');

  // ── section 1: /playsound -- the missing "targets is required" grammar ────────────────────
  const noTargets = await run('/playsound minecraft:entity.experience_orb.pickup master');
  ok(!noTargets.ok && noTargets.err && noTargets.err.key === 'command.unknown.command',
    '/playsound <sound> <source> with NO targets is an incomplete command (.decomp: targets is required, not optional)',
    JSON.stringify(noTargets));

  const withTargets = await run('/playsound minecraft:entity.experience_orb.pickup master @s');
  ok(withTargets.ok && /Played sound/.test(withTargets.lines[0] || ''),
    '/playsound <sound> <source> <targets> still plays and reports it', JSON.stringify(withTargets));

  const withPos = await run('/playsound minecraft:entity.experience_orb.pickup master @s ~ ~1 ~');
  ok(withPos.ok && /Played sound/.test(withPos.lines[0] || ''),
    '/playsound ... <targets> <pos> (relative) still works', JSON.stringify(withPos));

  const withVolPitch = await run('/playsound minecraft:entity.experience_orb.pickup master @s ~ ~ ~ 2 1.5');
  ok(withVolPitch.ok && /Played sound/.test(withVolPitch.lines[0] || ''),
    '/playsound ... <volume> <pitch> still works', JSON.stringify(withVolPitch));

  const badSound = await run('/playsound not.a.real.sound master @s');
  ok(!badSound.ok && badSound.err && badSound.err.key === 'argument.id.unknown',
    '/playsound rejects an unknown sound id (unrelated failure mode stays intact)', JSON.stringify(badSound));

  // ── section 2: /tellraw and /title -- read against .decomp, driven live ───────────────────
  await ev('MCL.Chat.reset();');
  await run('/tellraw @s {"text":"soundtitlecheckMARK","color":"green","bold":true}');
  const chatLine = await ev('var arr = MCL.Chat.lines; return JSON.stringify(arr[arr.length - 1]);');
  ok(/soundtitlecheckMARK/.test(chatLine) && /"color":"green"/.test(chatLine) && /"bold":true/.test(chatLine),
    '/tellraw delivers the parsed JSON component (text+color+bold) into chat, verbatim', chatLine);
  const trNoFeedback = await run('/tellraw @s {"text":"x"}');
  ok(trNoFeedback.ok && trNoFeedback.lines.length === 0,
    '/tellraw sends NO command feedback line (.decomp TellRawCommand never calls sendFeedback)', JSON.stringify(trNoFeedback));

  const titleRes = await run('/title @s title {"text":"Hi"}');
  ok(titleRes.ok && titleRes.lines[0] === 'Showing new title for Dan', '/title title dispatches + feedback', JSON.stringify(titleRes));
  const subOnly = await ev('MCL.Hud.clearTitles(); MCL.Commands.run("/title @s subtitle {\\"text\\":\\"sub\\"}", MCL.Player, {name:"Dan"}); return MCL.Hud.titles.time;');
  ok(subOnly === 0, '/title subtitle alone leaves titles.time at 0 (a subtitle with no title shows nothing, .decomp Gui.render\'s own guard)', String(subOnly));
  const timesRes = await run('/title @s times 5 10 15');
  ok(timesRes.ok, '/title times dispatches', JSON.stringify(timesRes));
  const badTimes = await run('/title @s times -1 10 15');
  ok(!badTimes.ok && badTimes.err && badTimes.err.key === 'argument.integer.low',
    '/title times rejects a negative fade tick (.decomp IntegerArgumentType.integer(0))', JSON.stringify(badTimes));
  const clearRes = await run('/title @s clear');
  ok(clearRes.ok && clearRes.lines[0] === 'Cleared titles for Dan', '/title clear dispatches + feedback', JSON.stringify(clearRes));
  const resetRes = await run('/title @s reset');
  ok(resetRes.ok && resetRes.lines[0] === 'Reset title options for Dan', '/title reset dispatches + feedback', JSON.stringify(resetRes));

  // ── section 3: anti-vacuity -- reattach the exact pre-fix executor, live, on the real tree ─
  const preFix = await ev(
    'var d = MCL.Commands.dispatcher; var ps = d.root.byName["playsound"];' +
    'var sound = ps.children.filter(function(c){return c.kind==="argument";})[0];' +
    'var source = sound.children.filter(function(c){return c.kind==="argument";})[0];' +
    'window.__stcSaved = source.command;' +
    'source.command = function (ctx) { return 1; };' + // the exact pre-fix shape: a bare default-to-self executor
    'var r = MCL.Commands.run("/playsound minecraft:entity.experience_orb.pickup master", MCL.Player, {name:"Dan"});' +
    'source.command = window.__stcSaved;' + // restore immediately, whatever happens
    'return { ok: r.ok };'
  );
  okAv(preFix.ok === true,
    'reattaching the pre-fix bare executor to the live "source" node makes the no-targets command succeed again -- proving the fixed grammar (not some unrelated parse quirk) is what rejects it',
    JSON.stringify(preFix));

  const postRestore = await run('/playsound minecraft:entity.experience_orb.pickup master');
  okAv(!postRestore.ok && postRestore.err && postRestore.err.key === 'command.unknown.command',
    'and the live tree is restored to the fixed shape immediately after -- rejecting the same command again',
    JSON.stringify(postRestore));

  ok(page.problems.length === 0, 'the page logged no errors across this whole run', page.problems.slice(0, 3).join(' | '));
} catch (e) {
  fails.push('harness: ' + (e && e.message));
  console.log('FAIL  harness: ' + (e && (e.stack || e.message)));
} finally {
  await page.close();
}

console.log('\n===========================================');
console.log(' soundtitlecheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks');
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
