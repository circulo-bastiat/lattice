#!/usr/bin/env node
// infocmdcheck.mjs -- worker 3, session 150: /list, /seed, /say, /me, /msg, /tell, /w
// vanilla-parity audit, LIVE in a real running game (MCLITE_PRESET=medium).
//
// Ground truth: .decomp/net/minecraft/server/command/{ListCommand,SeedCommand,SayCommand,
// MeCommand,MessageCommand}.java, and assets/lang.bin (inflated) for the exact format strings.
//
// ⚠⚠ ONE REAL BUG FOUND, in the `/msg` handler (src/15g_commands.js): the INCOMING whisper line
// (the one delivered to the recipient over `toChat`, a real component tree) carried no style at
// all. `.decomp` MessageCommand.execute wraps BOTH the outgoing and incoming `TranslatableText`
// in `.formatted(Formatting.GRAY, Formatting.ITALIC)` (field_1080/field_1056, confirmed by name
// in `.decomp/net/minecraft/util/Formatting.java`) -- a whisper that renders identically to
// ordinary chat loses the one visual cue that says "this was private." Fixed by passing
// `{ color: 'gray', italic: true }` as `T.translatable`'s third (style) argument on the incoming
// message; `drawRuns` (src/15_hud.js) already resolves `style.color` to an RGB paint colour, so
// the fix is visible the moment it renders (italic itself has no shear implementation in
// `drawRuns` yet -- a separate, pre-existing gap in a file this unit does not own, named, not
// built). The OUTGOING line cannot get the same treatment without rebuilding `c.source.send`'s
// flat-string feedback pipe (every command's feedback line is a plain string project-wide, not
// just this one) -- out of scope for a testing+fixing pass, named in `still_owed`.
//
// Section 3 is the anti-vacuity proof: the exact pre-fix call (no style argument) is replayed
// standalone and shown to produce an unstyled component, so section 2's colour assertion is not
// vacuous.
//
// Everything else in the unit -- /list's player-count/name format, /seed's feedback string,
// /say's announcement format and permission gate, /me's emote format and (lack of a) permission
// gate, and /msg=/tell=/w truly being the same command (redirect, not a re-registration) -- was
// found to already match `.decomp` and is asserted here as a live smoke so a future regression
// in any of them fails loud instead of unnoticed.
//
//   MCLITE_PRESET=medium node tools/infocmdcheck.mjs [dist/mclite.html]

import { open, sleep } from './cdp.mjs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILE = args[0] ? (args[0].startsWith('/') ? args[0] : ROOT + args[0]) : ROOT + 'dist/mclite.html';

let pass = 0;
const fails = [];
const ok = (c, m, d) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m + (d !== undefined ? ' (' + d + ')' : '')); console.log('FAIL  ' + m + (d !== undefined ? '   ' + d : '')); } return c; };
const okAv = (c, m, d) => { if (c) { pass++; console.log('   ok ' + m); } else { fails.push('anti-vacuity: ' + m + (d !== undefined ? ' (' + d + ')' : '')); console.log('   x  ' + m + (d !== undefined ? '   ' + d : '')); } };

function mkFn(body) { return { toString: function () { return 'function(){' + body + '}'; } }; }

const page = await open(FILE, { width: 900, height: 600 });
if (!page) { console.log('SKIP  infocmdcheck: no Chromium found'); process.exit(0); }

try {
  await sleep(1200);
  await page.evaluate(function () { if (window.MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play({}); });
  const up = await page.waitFor(function () {
    return !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20);
  }, 60000);
  if (!ok(up, 'the world came up', page.lastThrow)) throw new Error('never reached the game');
  await sleep(800);

  const ev = (body) => page.evaluate(mkFn(body));
  const run = (cmd) => ev(
    'var P = MCL.Player; var r = MCL.Commands.run(' + JSON.stringify(cmd) + ', P, {name: "Dan"});' +
    'return { ok: r.ok, lines: r.lines, err: r.error && { key: r.error.key, message: r.error.message } };'
  );

  // ── section 1: /list, /seed, /say, /me -- format strings and permission gates ─────────────
  const listRes = await run('/list');
  ok(listRes.ok && listRes.lines[0] === 'There are 1 of a max of 1 players online: Dan',
    '/list reports the one real player in vanilla\'s exact commands.list.players format', JSON.stringify(listRes));

  const seedRes = await run('/seed');
  const seedNum = await ev('return (MCL.Main && MCL.Main.seed !== undefined) ? MCL.Main.seed : 0;');
  ok(seedRes.ok && seedRes.lines[0] === ('Seed: ' + seedNum),
    '/seed reports the real world seed in vanilla\'s commands.seed.success format', JSON.stringify({ seedRes, seedNum }));

  const sayRes = await run('/say hello from infocmdcheck');
  ok(sayRes.ok, '/say dispatches', JSON.stringify(sayRes));
  const sayLevel = await ev('var s = MCL.Commands.source(MCL.Player, { level: 0, name: "Dan" }); var r = MCL.Commands.dispatcher.execute("say nope", s); return { ok: r.ok };');
  ok(sayLevel.ok === false, '/say is permission-gated at level 2 (level 0 cannot run it, matching .decomp SayCommand)', JSON.stringify(sayLevel));
  const sayChat = await ev('var m = MCL.Chat.messages; var last = m[m.length - 1]; return MCL.Text.runs(last.component, null).map(function (r) { return r.text; }).join("");');
  ok(sayChat === '[Dan] hello from infocmdcheck', '/say broadcasts vanilla\'s chat.type.announcement format ([name] message)', JSON.stringify(sayChat));

  const meRes = await run('/me waved');
  ok(meRes.ok, '/me dispatches', JSON.stringify(meRes));
  const meChat = await ev('var m = MCL.Chat.messages; var last = m[m.length - 1]; return MCL.Text.runs(last.component, null).map(function (r) { return r.text; }).join("");');
  ok(meChat === '* Dan waved', '/me broadcasts vanilla\'s chat.type.emote format (* name action)', JSON.stringify(meChat));
  const meLevel = await ev('var s = MCL.Commands.source(MCL.Player, { level: 0, name: "Dan" }); var r = MCL.Commands.dispatcher.execute("me nope", s); return { ok: r.ok };');
  ok(meLevel.ok === true, '/me has NO permission gate (level 0 can run it, matching .decomp MeCommand)', JSON.stringify(meLevel));

  // ── section 2: /msg, /tell, /w -- true aliasing, private-message formatting, and the fix ────
  const msgRes = await run('/msg @s hi self');
  ok(msgRes.ok && msgRes.lines[0] === 'You whisper to Dan: hi self',
    '/msg @s reports vanilla\'s exact commands.message.display.outgoing format', JSON.stringify(msgRes));

  const msgIncoming = await ev('var m = MCL.Chat.messages; var last = m[m.length - 1]; return { text: MCL.Text.runs(last.component, null).map(function (r) { return r.text; }).join(""), style: last.component.style };');
  ok(msgIncoming.text === 'Dan whispers to you: hi self',
    '/msg\'s incoming line reaches chat in vanilla\'s exact commands.message.display.incoming format', JSON.stringify(msgIncoming));
  // ⚠ THE FIX: vanilla wraps the whisper in Formatting.GRAY + Formatting.ITALIC (.decomp
  // MessageCommand.execute; field_1080/field_1056 confirmed GRAY/ITALIC by name in
  // .decomp/net/minecraft/util/Formatting.java). A whisper that renders as plain white/unstyled
  // chat is the exact "loses the one thing that says private" miss this check exists to catch.
  ok(msgIncoming.style && msgIncoming.style.color === 'gray' && msgIncoming.style.italic === true,
    'and it is styled gray+italic, matching vanilla\'s Formatting.GRAY + Formatting.ITALIC', JSON.stringify(msgIncoming.style));
  const msgColorRgb = await ev('return MCL.Text.colorOf("' + (msgIncoming.style ? msgIncoming.style.color : 'white') + '");');
  ok(msgColorRgb === 0xAAAAAA, 'and that color name actually resolves to a visibly different RGB than default white', JSON.stringify(msgColorRgb));

  // /tell and /w must be the exact same command (a redirect), not independent re-implementations
  // that could drift -- run each and diff against /msg's own behaviour above.
  const tellRes = await run('/tell @s hi via tell');
  ok(tellRes.ok && tellRes.lines[0] === 'You whisper to Dan: hi via tell', '/tell behaves identically to /msg (outgoing)', JSON.stringify(tellRes));
  const tellIncoming = await ev('var m = MCL.Chat.messages; var last = m[m.length - 1]; return { text: MCL.Text.runs(last.component, null).map(function (r) { return r.text; }).join(""), style: last.component.style };');
  ok(tellIncoming.text === 'Dan whispers to you: hi via tell' && tellIncoming.style && tellIncoming.style.color === 'gray' && tellIncoming.style.italic === true,
    '/tell\'s incoming line is styled the same as /msg\'s', JSON.stringify(tellIncoming));

  const wRes = await run('/w @s hi via w');
  ok(wRes.ok && wRes.lines[0] === 'You whisper to Dan: hi via w', '/w behaves identically to /msg (outgoing)', JSON.stringify(wRes));
  const wIncoming = await ev('var m = MCL.Chat.messages; var last = m[m.length - 1]; return { text: MCL.Text.runs(last.component, null).map(function (r) { return r.text; }).join(""), style: last.component.style };');
  ok(wIncoming.text === 'Dan whispers to you: hi via w' && wIncoming.style && wIncoming.style.color === 'gray' && wIncoming.style.italic === true,
    '/w\'s incoming line is styled the same as /msg\'s', JSON.stringify(wIncoming));

  const msgNoTarget = await run('/msg @e[type=cow] hi');
  ok(!msgNoTarget.ok && msgNoTarget.err && msgNoTarget.err.key === 'argument.entity.notfound.player',
    '/msg only accepts players -- a non-player selector match still fails as "no player found"', JSON.stringify(msgNoTarget));
  const msgLevel = await ev('var s = MCL.Commands.source(MCL.Player, { level: 0, name: "Dan" }); var r = MCL.Commands.dispatcher.execute("msg @s hi", s); return { ok: r.ok };');
  ok(msgLevel.ok === true, '/msg has NO permission gate (level 0 can run it, matching .decomp MessageCommand)', JSON.stringify(msgLevel));

  // ── section 3: anti-vacuity -- the exact pre-fix call, replayed standalone ────────────────
  const preFixIncoming = await ev(
    'return MCL.Text.translatable("commands.message.display.incoming", ["Dan", "hi"]);' // no 3rd (style) argument -- the pre-fix call shape
  );
  okAv(!preFixIncoming.style,
    'the pre-fix call (no style argument passed to T.translatable) produces an unstyled component -- proving section 2\'s color/italic assertions are not vacuous', JSON.stringify(preFixIncoming));

  // A second, independent break: prove the colour-equality assertion above (msgColorRgb === 0xAAAAAA)
  // actually discriminates -- a DIFFERENTLY named colour must resolve to a DIFFERENT RGB, or that
  // assertion could pass no matter what colour the fix actually applied.
  const whiteRgb = await ev('return MCL.Text.colorOf("white");');
  okAv(whiteRgb !== 0xAAAAAA,
    'a different colour name ("white") resolves to a different RGB than "gray" -- proving section 2\'s colour-equality check is not trivially true regardless of which colour the fix applies', JSON.stringify(whiteRgb));

  console.log('');
  console.log(pass + ' passed, ' + fails.length + ' failed');
  if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
} finally {
  await page.close();
}
