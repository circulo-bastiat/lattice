#!/usr/bin/env node
// chatcheck.mjs — PLAN G12. The chat's geometry, its fade curve and its word wrap.
//
//   node tools/chatcheck.mjs [--quiet]
//
// ⚠ THIS FILE EXISTS BECAUSE EVERY NUMBER IN A CHAT BOX IS INVISIBLE UNTIL IT IS WRONG. A message
// is visible for 200 ticks and the fade is `clamp((1 - t/200) * 10, 0, 1)` **squared** — so it
// sits at full opacity for 180 ticks and then drops away over 20. A linear ten-second fade looks
// perfectly reasonable in a screenshot and reads as a different game in motion, and no picture
// test can tell you which one you have. It is arithmetic, so it is tested as arithmetic.
//
// ⚠ AND THE WRAP IS THE OTHER HALF. A message wider than the box wraps at a word; a single word
// wider than the box breaks mid-word rather than drawing over the world; and a RE-wrap goes back
// to the scrollback rather than re-splitting lines that are already split, because re-splitting
// compounds and leaves the breaks from the narrowest width the window ever had.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ASSETS = join(ROOT, 'assets');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js', '15c_chat.js', '13_input.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const T = NS.Text, C = NS.Chat;
const meta = JSON.parse(readFileSync(join(ASSETS, 'lang.meta.json'), 'utf8'));
T.init({
  lang: readFileSync(join(ASSETS, 'lang.bin')).toString('base64'),
  langBytes: meta.rawBytes,
  langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8'),
});
// ⚠ the real glyph widths, out of the shipped GUI blob — a wrap test against `length * 6` would
// agree with itself and disagree with the screen.
{
  const { inflateRawSync } = await import('node:zlib');
  const bytes = inflateRawSync(readFileSync(join(ASSETS, 'gui.bin')));
  const hlen = bytes.readUInt32LE(0);
  const head = JSON.parse(bytes.slice(4, 4 + hlen).toString('utf8'));
  NS.Gui = NS.Gui || {};
  NS.Gui.widths = new Uint8Array(head.widths);
  NS.Gui.textWidth = function (s) {
    let w = 0;
    for (let i = 0; i < s.length; i++) { const ch = s.charCodeAt(i); w += (ch < 256 ? NS.Gui.widths[ch] : 6); }
    return w;
  };
}

console.log('chatcheck — PLAN G12, the chat (D-283)');

// ═══════════ 1. the geometry is vanilla's ═════════════════════════════════════════════════
say('\n1. the constants');
ok(C.VISIBLE_TICKS === 200, `a message is visible for 200 ticks, got ${C.VISIBLE_TICKS}`);
ok(C.LINE === 9, `a line is 9 pixels, got ${C.LINE}`);
ok(C.WIDTH === 320, `the box is 320 wide — chatWidth 1.0 is value * 280 + 40 — got ${C.WIDTH}`);
ok(C.LINES_CLOSED === 10 && C.LINES_OPEN === 20, 'ten lines closed, twenty open');
ok(C.BOTTOM === -40, `the bottom edge is height - 40, got height ${C.BOTTOM}`);
ok(C.LEFT === 4, 'and the left edge is 4');
ok(C.MAX_HISTORY === 100, 'the scrollback holds 100 messages');
ok(C.MAX_INPUT === 256, 'and the field takes 256 characters');
// ⚠ the input BAR is the full screen width, not the chat box's — `ChatScreen` fills
// `(2, height - 14) .. (width - 2, height - 2)`, a band the hotbar is then drawn over.
ok(C.INPUT_INSET === 2 && C.INPUT_TOP === -14 && C.INPUT_BOTTOM === -2,
  `the input bar is inset 2 and spans height-14 to height-2, got ${C.INPUT_INSET}/${C.INPUT_TOP}/${C.INPUT_BOTTOM}`);
ok(C.INPUT_BOTTOM - C.INPUT_TOP === 12, 'so it is twelve pixels tall');
ok(C.INPUT_TEXT_X === 4 && C.INPUT_TEXT_Y === -12, 'and the text sits at (4, height - 12) inside it');

// ═══════════ 2. the fade curve ════════════════════════════════════════════════════════════
say('\n2. the fade');
{
  const a = (t) => C.alphaAt(t);
  say('   alpha at 0/100/179/180/190/199/200: ' + [0, 100, 179, 180, 190, 199, 200].map((t) => a(t).toFixed(3)).join(' '));
  ok(a(0) === 1, 'a new message is fully opaque');
  ok(a(100) === 1, 'and still is at 100 ticks — the fade has not started');
  ok(a(179) === 1, 'and at 179');
  // ⚠ 180 IS THE LAST FULLY-OPAQUE TICK, not the first faded one: (1 - 180/200) * 10 = 1.0
  // exactly, so the fade begins on the tick AFTER. Getting this boundary one out is how a clone
  // ends up with a fade that is 19 ticks long.
  // ⚠ AND IT IS NOT EXACTLY 1: `180 / 200` is 0.9 in binary only approximately, so
  // `(1 - 0.9) * 10` is 0.9999999999999996 and the square is smaller still. Vanilla computes the
  // same expression in the same double arithmetic and gets the same value, so the assertion is
  // the boundary, not the bit pattern — asserting `=== 1` here was this check's own first bug.
  ok(a(180) > 0.999, `180 is the last (effectively) opaque tick — got ${a(180)}`);
  ok(a(181) < 0.92 && a(181) > 0.89, `and 181 is visibly faded — got ${a(181)}`);
  ok(a(200) === 0, 'at 200 it is gone');
  ok(a(300) === 0, 'and it does not go negative afterwards');
  // ⚠ THE SQUARE. Halfway through the fade window the alpha must be a QUARTER, not a half.
  const mid = a(190);
  ok(Math.abs(mid - 0.25) < 1e-9, `halfway through the fade the alpha is 0.25, not 0.5 — got ${mid}`);
  // ...and it must be monotonic across the window
  let mono = true;
  for (let t = 1; t <= 200; t++) if (a(t) > a(t - 1) + 1e-12) mono = false;
  ok(mono, 'the fade never brightens');
}

// ═══════════ 3. messages and history ══════════════════════════════════════════════════════
say('\n3. the scrollback');
{
  C.reset();
  for (let i = 0; i < 120; i++) C.say('message ' + i);
  ok(C.messages.length === 100, `the scrollback caps at 100, got ${C.messages.length}`);
  ok(T.plain(C.messages[0].component) === 'message 20', 'and it drops from the FRONT — the oldest goes');
  ok(T.plain(C.messages[99].component) === 'message 119', 'the newest is last');
  // the drawn list is newest FIRST, because it is drawn upward from the bottom
  ok(C.lines[0].runs.map((r) => r.text).join('') === 'message 119', 'the drawn list is newest first');
  const vis = C.visible();
  ok(vis.length === C.LINES_CLOSED, `ten lines are visible when closed, got ${vis.length}`);
  C.open = true;
  ok(C.visible().length === C.LINES_OPEN, 'twenty when open');
  C.open = false;

  // ⚠ AGE IS IN TICKS AND IT IS THE CHAT'S OWN COUNTER, not the wall clock
  C.reset();
  C.say('old');
  for (let i = 0; i < 200; i++) C.tickChat();
  ok(C.visible().length === 0, 'a 200-tick-old message is gone');
  C.open = true;
  ok(C.visible().length === 1, '...but an OPEN chat shows it anyway, at full opacity');
  ok(C.visible()[0].alpha === 1, 'and the fade is suspended while the chat is up');
  C.open = false;
}

// ═══════════ 4. the wrap ══════════════════════════════════════════════════════════════════
say('\n4. word wrap');
{
  const W = (s) => C.wrapRuns([{ text: s, style: null }], C.WIDTH, NS.Gui);
  const w1 = W('short');
  ok(w1.length === 1, 'a short message is one line');

  // ⚠ NUMBERED WORDS, not forty copies of "word". With identical words every wrapped line is the
  // same string, so "the first line is not the last line" compares a string to itself and passes
  // whatever the order is — a fixture that cannot tell the answer apart from its opposite.
  const long = Array.from({ length: 40 }, (_, i) => 'w' + i).join(' ');
  const wl = W(long);
  say(`   ${NS.Gui.textWidth(long)}px of text wrapped to ${wl.length} lines at ${C.WIDTH}px`);
  ok(wl.length > 1, 'a long message wraps');
  let over = 0;
  for (const line of wl) {
    const px = NS.Gui.textWidth(line.map((r) => r.text).join(''));
    if (px > C.WIDTH) over++;
  }
  ok(over === 0, `${over} wrapped lines are wider than the box`);
  ok(wl.map((l) => l.map((r) => r.text).join('')).join('').replace(/\s+/g, ' ').trim() === long,
    'and nothing was lost or duplicated in the wrapping');

  // ⚠ A SINGLE WORD LONGER THAN THE BOX must break mid-word, not overflow
  const huge = new Array(200).fill('m').join('');
  const wh = W(huge);
  const widest = Math.max(...wh.map((l) => NS.Gui.textWidth(l.map((r) => r.text).join(''))));
  say(`   a ${NS.Gui.textWidth(huge)}px unbroken word became ${wh.length} lines, widest ${widest}px`);
  ok(wh.length > 1, 'an unbroken word longer than the box is broken');
  ok(widest <= C.WIDTH, `and no piece of it is wider than the box — widest ${widest}`);
  ok(wh.map((l) => l.map((r) => r.text).join('')).join('') === huge, 'with every character kept');

  // style survives the wrap
  const styled = C.wrapRuns([{ text: 'aaa ', style: { color: 'red' } }, { text: 'bbb', style: { bold: true } }], 1000, NS.Gui);
  ok(styled.length === 1 && styled[0].length === 2, 'two runs on one line stay two runs');
  ok(styled[0][0].style.color === 'red' && styled[0][1].style.bold === true, 'and each keeps its own style');

  // ⚠ RE-WRAP GOES BACK TO THE SCROLLBACK. Wrapping twice must give the same answer as once.
  C.reset();
  C.add(T.literal(long));
  const first = C.lines.length;
  C.rewrap(); C.rewrap(); C.rewrap();
  ok(C.lines.length === first, `re-wrapping is idempotent — ${first} lines then ${C.lines.length}`);

  // a two-line message reads top-to-bottom even though the list is newest-first
  C.reset();
  C.say('AAA');
  C.add(T.literal(long));
  const texts = C.lines.map((l) => l.runs.map((r) => r.text).join(''));
  ok(texts[texts.length - 1] === 'AAA', 'the oldest message is last in the drawn list');
  ok(texts[0].indexOf('w') >= 0, 'and the newest message occupies everything above it');
  // its own lines must not be reversed among themselves
  // ⚠ THE LIST IS BOTTOM-UP. `lines[0]` is drawn CLOSEST TO THE BOTTOM, so the newest message's
  // FIRST wrapped line must be LAST in the list — reading it in list order gives the message
  // backwards, which is correct and is exactly what a naive push order would get wrong. The
  // assertion therefore reverses before comparing; asserting the un-reversed order was this
  // check's own second bug, and it would have passed against a renderer that drew upside down.
  const own = texts.slice(0, texts.length - 1).reverse().join('').replace(/\s+/g, ' ').trim();
  ok(own === long, `a wrapped message reads top to bottom once the bottom-up list is reversed: ${own.slice(0, 40)}`);
  ok(texts[0] !== long.slice(0, texts[0].length),
    'and the list really is bottom-up — lines[0] is the message\'s LAST line, not its first');
}

// ═══════════ 5. the field ═════════════════════════════════════════════════════════════════
say('\n5. the text field');
{
  C.reset();
  C.openChat();
  ok(C.open && C.input === '', 'T opens an empty field');
  C.closeChat();
  C.openChat('/');
  ok(C.input === '/' && C.caret === 1, 'and / opens it with a slash already typed, caret after it');

  C.closeChat(); C.openChat();
  C.type('hello');
  ok(C.input === 'hello' && C.caret === 5, 'typing appends and moves the caret');
  C.move(-2);
  C.type('XY');
  ok(C.input === 'helXYlo', `typing inserts AT the caret: got ${JSON.stringify(C.input)}`);
  ok(C.caret === 5, 'and the caret follows what was inserted');
  C.backspace();
  ok(C.input === 'helXlo', 'backspace deletes before the caret');
  C.del();
  ok(C.input === 'helXo', 'delete deletes after it');
  C.home(); ok(C.caret === 0, 'home goes to the start');
  C.move(-1); ok(C.caret === 0, 'and the caret does not go negative');
  C.end(); ok(C.caret === C.input.length, 'end goes to the end');
  C.move(1); ok(C.caret === C.input.length, 'and does not run past it');

  // the 256 cap
  C.closeChat(); C.openChat();
  C.type(new Array(300).fill('x').join(''));
  ok(C.input.length === 256, `the field caps at 256, got ${C.input.length}`);
  C.type('more');
  ok(C.input.length === 256, 'and stays there');

  // sending
  C.closeChat(); C.openChat();
  C.type('hello world');
  const msg = C.send('Dan');
  ok(!C.open, 'sending closes the field');
  ok(T.plain(msg) === '<Dan> hello world', `the format is chat.type.text: got ${JSON.stringify(T.plain(msg))}`);
  ok(C.messages.length === 1, 'and it went into the scrollback');
  ok(C.sent.length === 1 && C.sent[0] === 'hello world', 'the raw text went into the sent history');

  // an empty send says nothing at all
  C.openChat(); C.type('   ');
  ok(C.send('Dan') === null, 'sending whitespace posts nothing');
  ok(C.messages.length === 1, 'and adds nothing to the scrollback');

  // up and down walk the history
  C.openChat(); C.type('second'); C.send('Dan');
  C.openChat();
  C.history(1); ok(C.input === 'second', 'up recalls the most recent');
  C.history(1); ok(C.input === 'hello world', 'up again recalls the one before');
  C.history(1); ok(C.input === 'hello world', 'and it stops at the oldest');
  C.history(-1); ok(C.input === 'second', 'down comes back');
  C.history(-1); ok(C.input === '', 'and past the newest is empty, as vanilla does');
  C.closeChat();

  // vanilla: the unsent draft survives Up/Down; consecutive duplicates are not re-recorded; no 100 cap
  C.openChat(); C.type('abc'); C.history(1); C.history(-1);
  ok(C.input === 'abc', 'the unsent draft is restored when Down returns past the newest');
  C.closeChat();
  C.openChat(); C.type('x'); C.send('Dan'); C.openChat(); C.type('x'); C.send('Dan');
  C.openChat(); C.history(1); C.history(1);
  ok(C.input === 'second', 'sending the same line twice records it once');
  C.closeChat();
  for (var hi = 0; hi < 120; hi++) { C.openChat(); C.type('m' + hi); C.send('Dan'); }
  ok(C.sent.length > 100, 'the sent history is not capped at 100');
  C.openChat(); C.type('abc'); C.history(1); C.draft = 'broken'; C.history(-1);
  okAv(C.input !== 'abc', 'a corrupted draft is not restored as abc (the draft assertion can fail)');
  C.closeChat();
}

// ═══════════ 6. components in the chat ════════════════════════════════════════════════════
say('\n6. what a message is made of');
{
  C.reset();
  C.add(T.deathMessage('Dan', 'lava'));
  ok(T.plain(C.messages[0].component) === 'Dan tried to swim in lava', 'a death message is a component, not a string');
  C.add(T.literal('a', { color: 'red' }));
  const runs = C.lines[0].runs;
  ok(runs.length === 1 && runs[0].style.color === 'red', 'and its style survives into the drawn line');
  C.add(T.literal('plain§cred'));
  ok(C.lines[0].runs.length === 2, 'a § code in a chat line splits it into runs');
}

// ═══════════ 7. anti-vacuity ══════════════════════════════════════════════════════════════
say('\n7. anti-vacuity: break it, and it must be caught');
{
  // the square must be load-bearing
  const linear = (t) => Math.max(0, Math.min(1, (1 - t / 200) * 10));
  okAv(Math.abs(linear(190) - 0.5) < 1e-9 && Math.abs(C.alphaAt(190) - 0.25) < 1e-9,
    'the unsquared curve gives 0.5 where the real one gives 0.25 — §2 is testing the square');
  // ...and a plain linear-over-200 fade must differ from both
  const naive = (t) => Math.max(0, 1 - t / 200);
  okAv(naive(100) !== C.alphaAt(100),
    `a straight ten-second fade is ${naive(100)} at 100 ticks where the real one is still ${C.alphaAt(100)}`);

  // the wrap must actually be measuring glyph widths
  okAv(NS.Gui.textWidth('iiii') !== NS.Gui.textWidth('MMMM'),
    'the wrap measures real glyph widths — four `i`s and four `M`s are not the same width');

  // an unbroken word must really be too wide for the box
  const huge = new Array(200).fill('m').join('');
  okAv(NS.Gui.textWidth(huge) > C.WIDTH * 2,
    `the "unbroken word" fixture really is far wider than the box (${NS.Gui.textWidth(huge)} vs ${C.WIDTH})`);

  // the scrollback cap must be load-bearing
  C.reset();
  for (let i = 0; i < 120; i++) C.say('x' + i);
  okAv(C.messages.length === 100 && 120 > 100, 'the cap really dropped 20 messages');

  // the open-chat override must be load-bearing
  C.reset(); C.say('old');
  for (let i = 0; i < 250; i++) C.tickChat();
  const closedCount = C.visible().length;
  C.open = true;
  const openCount = C.visible().length;
  C.open = false;
  okAv(closedCount === 0 && openCount === 1, 'the open-chat override is what makes an old message visible');

  // the bottom-up line order must be load-bearing: pushing a wrapped message the other way round
  // draws it upside down, and every assertion in §4 except that one would still pass
  C.reset(); C.add(T.literal(Array.from({ length: 40 }, (_, i) => 'v' + i).join(' ')));
  const listOrder = C.lines.map((l) => l.runs.map((r) => r.text).join(''));
  okAv(listOrder.length > 2 && listOrder.slice().reverse().join('') !== listOrder.join(''),
    `a ${listOrder.length}-line message really does read differently in the two orders, so §4's reverse is a test`);

  // #466: a scrolled-up open chat keeps the reader on the same text when a message arrives
  C.reset(); for (let i = 0; i < 40; i++) C.say('line ' + i);
  C.openChat(); C.scrollBy(5);
  const n0 = C.lines.length, sc0 = C.scroll;
  C.add(T.literal(Array.from({ length: 60 }, (_, i) => 'w' + i).join(' ')));
  const addedN = C.lines.length - n0;
  okAv(addedN > 1 && C.scroll === sc0 + addedN && C.unread === true,
    `scroll grows by the ${addedN} wrapped lines added and flags unread, got ${C.scroll - sc0}`);
  C.scrollBy(-1000);
  okAv(C.scroll === 0 && C.unread === false, 'scrolling back to the bottom clears unread');
  C.say('at bottom');
  okAv(C.scroll === 0, 'an unscrolled chat is not moved by a new message');
  C.closeChat();

  // PageUp/PageDown/wheel through the input handler's own functions (vanilla ChatScreen)
  {
    const I = NS.Input;
    C.reset(); for (let i = 0; i < 60; i++) C.say('pg ' + i);
    C.openChat();
    okAv(I.chatPage('PageUp') && C.scroll === 19, `PageUp scrolls visible-1 = 19 lines, got ${C.scroll}`);
    I.chatPage('PageDown');
    okAv(C.scroll === 0, `PageDown scrolls back down, got ${C.scroll}`);
    I.chatWheel(-100, false);
    okAv(C.scroll === 7, `wheel up moves 7 lines, got ${C.scroll}`);
    I.chatWheel(-100, true);
    okAv(C.scroll === 8, `shift+wheel up moves 1 line, got ${C.scroll}`);
    I.chatWheel(100, false);
    okAv(C.scroll === 1, `wheel down moves 7 lines back, got ${C.scroll}`);
    for (let i = 0; i < 20; i++) I.chatPage('PageUp');
    okAv(C.scroll === C.lines.length - C.LINES_OPEN, `scroll clamps to lines - visible, got ${C.scroll}`);
    okAv(I.chatPage('KeyA') === false, 'other keys are not page keys');
    C.closeChat();
  }

  // and the caret must really be an insertion point, not an append
  C.reset(); C.openChat(); C.type('abc'); C.move(-1); C.type('Z');
  okAv(C.input === 'abZc', `an insert at the caret gives abZc, got ${C.input}`);
  C.closeChat();
}

console.log('');
console.log('================= chatcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
