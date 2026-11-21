#!/usr/bin/env node
// textcheck.mjs — PLAN G12. The formatter, against Mojang's own test vectors.
//
//   node tools/textcheck.mjs [--quiet]
//
// ⚠⚠ THE FIXTURES ARE NOT THIS PROJECT'S. `en_us.json` carries seven `translation.test.*` strings
// that exist for one reason: Mojang's own unit tests use them. They pin exactly the cases a
// hand-written `%s` substituter gets wrong — a template mixing bare `%s` with indexed `%N$s`,
// doubled `%%` escapes, and two malformed templates that must survive rather than throw. Grading
// the formatter against them is the same discipline as D-263's bytecode referee, for free: the
// answer comes from the game, not from this project's reading of the rule.
//
// ⚠ THE ONE THAT MATTERS IS `translation.test.complex`:
//     "Prefix, %s%2$s again %s and %1$s lastly %s and also %1$s again!"
// with (a, b, c, d) it is "Prefix, ab again b and a lastly c and also a again!" — note the THIRD
// placeholder is `b`. An indexed `%N$s` does NOT advance the sequential counter, so the bare `%s`
// after `%2$s` is still only the second argument. Every naive implementation gets `c` there.

import { readFileSync, existsSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
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
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const T = NS.Text;

// the payload, decoded here the way the runtime does
// ⚠ `lang.bin` IS THE DEFLATED FORM and `Text.init` inflates it, so it is handed over as it
// sits on disk. Inflating here first and then base64-ing the result is how this file failed on
// its first run — the runtime path must be the path under test.
const meta = JSON.parse(readFileSync(join(ASSETS, 'lang.meta.json'), 'utf8'));
const overrides = readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8');
T.init({
  lang: readFileSync(join(ASSETS, 'lang.bin')).toString('base64'),
  langBytes: meta.rawBytes, langOverrides: overrides,
});
// and the check's own decode must agree with the runtime's, which is what this line proves
const langRaw = inflateRawSync(readFileSync(join(ASSETS, 'lang.bin')));

console.log('textcheck — PLAN G12, the text pipeline (D-282)');

// ═══════════ 1. the table ═════════════════════════════════════════════════════════════════
say('\n1. the language table');
ok(T.ready, 'the table decoded');
ok(T.keys === meta.keys, `${T.keys} keys at runtime, ${meta.keys} packed`);
ok(T.keys > 5000, `${T.keys} keys is the whole file, not a subset`);
ok(T.template('translation.test.world') === 'world', 'a key resolves to its template');
// ⚠ vanilla renders the KEY when there is no string, and so must this — a blank would hide it
ok(T.template('this.key.does.not.exist') === 'this.key.does.not.exist',
  'an unknown key renders as itself, which is what vanilla shows you');
ok(T.has('block.minecraft.stone') && !T.has('block.minecraft.not_a_block'), '`has` tells them apart');
// ⚠ UTF-8 really survived the decode: the file has non-ASCII in it and a byte-wise read mangles it
// ⚠ EXACTLY TWO, AND THEY ARE THE STRUCTURE-BLOCK ARROWS: `mirror.left_right` is "← →" and
// `mirror.front_back` is "↑ ↓". The first version of this line asserted "more than twenty"
// non-ASCII strings on the assumption that a 5,163-key file must be full of them; `en_us.json`
// is English and it is not. Two is a thin but real test — those four arrows are three bytes each
// in UTF-8, so a byte-wise `String.fromCharCode` read turns every one of them into mojibake.
const nonAscii = Object.keys(T.map).filter((k) => /[^\x00-\x7F]/.test(T.map[k]));
say(`   ${nonAscii.length} strings carry non-ASCII: ${nonAscii.map((k) => k + ' ' + JSON.stringify(T.map[k])).join(' · ')}`);
ok(nonAscii.length === 2, `${nonAscii.length} non-ASCII strings, expected the two structure-block mirror arrows`);
ok(T.template('mirror.left_right') === '\u2190 \u2192', `the left-right arrows decoded: ${JSON.stringify(T.template('mirror.left_right'))}`);
ok(T.template('mirror.front_back') === '\u2191 \u2193', `the front-back arrows decoded: ${JSON.stringify(T.template('mirror.front_back'))}`);
ok(!Object.keys(T.map).some((k) => /\u00C3[\u0080-\u00BF]/.test(T.map[k])), 'and nothing shows the mojibake of a mis-decoded UTF-8 pair');

// ═══════════ 2. MOJANG'S OWN FIXTURES ═════════════════════════════════════════════════════
say('\n2. the formatter, against `translation.test.*`');
{
  const V = (n) => T.template('translation.test.' + n);
  ok(T.format(V('none'), []) === 'Hello, world!', 'a template with no placeholders is itself');

  // ⚠ THE ONE. See this file's header.
  const complex = T.format(V('complex'), ['a', 'b', 'c', 'd']);
  say('   complex -> ' + JSON.stringify(complex));
  ok(complex === 'Prefix, ab again b and a lastly c and also a again!',
    `translation.test.complex is wrong: ${JSON.stringify(complex)}`);
  // spelled out, so a failure says WHICH placeholder drifted rather than just "the string differs"
  ok(complex.indexOf('again b and a') >= 0,
    'the bare %s after an indexed %2$s is the SECOND argument — the indexed form does not advance the counter');
  ok(complex.indexOf('lastly c') >= 0, 'the NEXT bare %s after that is the third argument');
  ok(complex.indexOf('also a again') >= 0, 'and a repeated %1$s is the first, however many times it appears');
  // ⚠ re-run with arguments that cannot collide with the template's own words: `indexOf('d')`
  // here matched the word "and", which is a test measuring English rather than the formatter.
  const distinct = T.format(V('complex'), ['<1>', '<2>', '<3>', '<4>']);
  say('   complex with distinct args -> ' + JSON.stringify(distinct));
  ok(distinct.indexOf('<4>') < 0, 'the fourth argument is never reached — the template has three sequential slots');
  ok(distinct === 'Prefix, <1><2> again <2> and <1> lastly <3> and also <1> again!',
    `the substitution positions are wrong: ${JSON.stringify(distinct)}`);

  const esc = T.format(V('escape'), ['a', 'b']);
  say('   escape  -> ' + JSON.stringify(esc) + '   from ' + JSON.stringify(V('escape')));
  ok(esc === '%s %a %%s %%b', `translation.test.escape is wrong: ${JSON.stringify(esc)}`);
  ok(esc.indexOf('%s') === 0, '`%%s` is the two literal characters `%s` and consumes no argument');

  // ⚠ the two malformed ones must SURVIVE. Vanilla throws and the caller falls back to the raw
  // template, which comes to the same picture; what must not happen is a crash or a blank line.
  ok(T.format(V('invalid'), ['a']) === 'hi %', '"hi %" renders as itself');
  ok(T.format(V('invalid2'), ['a']) === 'hi %  s', '"hi %  s" renders as itself');
  ok(T.format(V('args'), ['x', 'y']) === 'x y', 'two bare placeholders take two arguments in order');

  // missing arguments are empty, not "undefined"
  ok(T.format(V('args'), ['x']) === 'x ', 'a placeholder with no argument is empty, not the word undefined');
  ok(T.format(V('args'), []) === ' ', 'and so are both of them');
  ok(T.format('%3$s', ['a']) === '', 'an index past the end is empty too');
}

// ═══════════ 3. names ═════════════════════════════════════════════════════════════════════
say('\n3. every block and every item has a name');
{
  const reg = JSON.parse(readFileSync(join(ASSETS, 'block-registry.json'), 'utf8'));
  const blocks = Array.isArray(reg) ? reg.map((b) => b.name) : Object.keys(reg.blocks || reg);
  let named = 0; const bad = [];
  for (const b of blocks) {
    const n = T.blockName(b);
    if (n && n.indexOf('minecraft.') < 0) named++; else bad.push(b);
  }
  say(`   ${named}/${blocks.length} blocks named`);
  ok(named === blocks.length, `every block resolves — ${bad.slice(0, 5).join(', ')}`);

  const items = JSON.parse(readFileSync(join(ASSETS, 'item-registry.json'), 'utf8')).items;
  const real = Object.keys(items).filter((n) => items[n].real);
  let inamed = 0; const ibad = [];
  for (const i of real) {
    const n = T.itemName(i);
    if (n && n.indexOf('minecraft.') < 0) inamed++; else ibad.push(i);
  }
  say(`   ${inamed}/${real.length} items named`);
  ok(inamed === real.length, `every real item resolves — ${ibad.slice(0, 5).join(', ')}`);

  // ⚠ the names must be the GAME's, not a prettified id — the whole point of the stage
  ok(T.itemName('diamond_sword') === 'Diamond Sword', `diamond_sword is "${T.itemName('diamond_sword')}"`);
  ok(T.blockName('grass_block') === 'Grass Block', `grass_block is "${T.blockName('grass_block')}"`);
  ok(T.itemName('stone') === 'Stone', 'a BLOCK ITEM takes the block key — there is no item.minecraft.stone');
  ok(T.itemName('tnt') === 'TNT', 'and the name is not a title-cased id: TNT, not Tnt');
  ok(T.blockName('minecraft:oak_log') === 'Oak Log', 'a namespaced id works too');

  // the 18 overrides, by name and by rule
  ok(T.blockName('red_wall_banner') === T.blockName('red_banner'),
    'a wall banner is named by its standing banner, as vanilla names it');
  ok(T.blockName('red_wall_banner') === 'Red Banner', `and that is "Red Banner", got "${T.blockName('red_wall_banner')}"`);
  ok(T.itemName('item_frame') === 'Item Frame', 'the item frame is named by its item — it is an entity');
  ok(Object.keys(T.overrides).length === 18, `${Object.keys(T.overrides).length} overrides, expected 18`);

  // ...and the override table must not be a licence to paper over a miss
  ok(T.blockName('not_a_real_block') === 'block.minecraft.not_a_real_block',
    'a block with no key still renders as its key rather than being invented');
}

// ═══════════ 4. components ════════════════════════════════════════════════════════════════
say('\n4. components');
{
  ok(T.plain(T.literal('hello')) === 'hello', 'a literal is its text');
  ok(T.plain(T.translatable('translation.test.none')) === 'Hello, world!', 'a translatable resolves');
  ok(T.plain(T.translatable('translation.test.args', ['a', 'b'])) === 'a b', 'and substitutes its `with`');
  // a component ARGUMENT, which is what death messages and chat are made of
  const nested = T.translatable('translation.test.args', [T.literal('x'), T.translatable('translation.test.world')]);
  ok(T.plain(nested) === 'x world', 'an argument may itself be a component');

  const parent = T.literal('a', { bold: true });
  T.append(parent, T.literal('b'));
  T.append(parent, T.literal('c', { bold: false }));
  const runs = T.runs(parent);
  say('   runs: ' + JSON.stringify(runs));
  ok(runs.length === 3, `three runs, got ${runs.length}`);
  ok(runs[0].style.bold === true, 'the parent is bold');
  // ⚠ INHERITANCE: a child that says nothing about bold IS bold; one that says false is not.
  ok(runs[1].style.bold === true, 'a child that says nothing about bold inherits it');
  ok(runs[2].style.bold === false, 'and a child that says false overrides it — undefined is not false');

  const coloured = T.literal('x', { color: 'red' });
  ok(T.runs(coloured)[0].style.color === 'red', 'a colour survives to the run');
  ok(T.colorOf('red') === 0xFF5555, `red is 0xFF5555, got 0x${T.colorOf('red').toString(16).toUpperCase()}`);
  ok(T.colorOf('dark_red') === 0xAA0000, 'and dark_red is 0xAA0000 — the two are not the same colour');
  ok(T.colorOf('#12ab34') === 0x12AB34, 'a #rrggbb literal works');
  ok(T.colorOf('not_a_colour') === -1 && T.colorOf('#xyz') === -1, 'and a bad colour is -1, not black');
  ok(Object.keys(T.COLORS).length === 16, `sixteen named colours, got ${Object.keys(T.COLORS).length}`);
}

// ═══════════ 5. the legacy § codes ════════════════════════════════════════════════════════
say('\n5. the § codes, which are a second style system and still live');
{
  const r = T.runs(T.literal('plain§cred§rback'));
  say('   ' + JSON.stringify(r.map((x) => [x.text, x.style && x.style.color])));
  ok(r.length === 3, `three runs, got ${r.length}`);
  ok(r[0].text === 'plain' && !r[0].style, 'the first run is unstyled');
  ok(r[1].text === 'red' && r[1].style.color === 'red', 'the middle run is red');
  ok(r[2].text === 'back' && !r[2].style, '§r resets to the INHERITED style, not to a colour');
  ok(T.plain(T.literal('a§cb')) === 'ab', 'the codes themselves never reach the text');

  // ⚠ a COLOUR CODE CLEARS THE DECORATIONS — vanilla's rule, and it surprises everyone
  // ⚠ `§e` IS YELLOW. `§c` is red. Asserting "red" here for `§e` was this file's own first bug,
  // and it is the exact drift the sixteen-colour table exists to stop — the codes are not
  // mnemonic and `e` looks like it ought to be something else.
  const r2 = T.runs(T.literal('§lbold§eyellow'));
  ok(r2.length === 2 && r2[0].style.bold === true, 'the first run is bold');
  ok(!r2[1].style.bold, 'and the colour code after it CLEARED the bold — vanilla does this');
  ok(r2[1].style.color === 'yellow', `while setting the colour: got ${JSON.stringify(r2[1].style.color)}`);
  ok(T.runs(T.literal('§ca'))[0].style.color === 'red', 'and §c really is red, so the two are told apart');

  // an unknown code is literal text, not a swallowed character
  ok(T.plain(T.literal('a§zb')) === 'a§zb', 'an unknown § code stays in the text');
}

// ═══════════ 6. death messages, both directions ═══════════════════════════════════════════
say('\n6. death messages');
{
  // ⚠ THE SOURCE OF TRUTH IS G5'S OWN TABLE, read out of the module rather than retyped — a
  // list copied here would agree with itself for ever while the game grew an eleventh source.
  const sv = readFileSync(join(SRC, '14d_survival.js'), 'utf8');
  const block = sv.slice(sv.indexOf('DAMAGE: {'), sv.indexOf('// ── experience'));
  const ids = [...block.matchAll(/^\s{6}(\w+):\s*\{([^\n]*)/gm)].map((m) => (/key: '(\w+)'/.exec(m[2]) || m)[1]);
  say('   G5 damage sources: ' + ids.join(' '));
  ok(ids.length >= 10, `${ids.length} damage sources found in 14d_survival.js`);
  let resolved = 0; const unresolved = [];
  for (const id of ids) {
    if (T.has('death.attack.' + id) || T.has('death.attack.' + id + '.message')) resolved++; else unresolved.push(id);
  }
  ok(resolved === ids.length, `every damage source has a death message — missing: ${unresolved.join(', ')}`);
  const msg = T.plain(T.deathMessage('Dan', 'fall'));
  say('   fall -> ' + JSON.stringify(msg));
  ok(msg === 'Dan hit the ground too hard', `the fall message is wrong: ${JSON.stringify(msg)}`);
  ok(T.plain(T.deathMessage('Dan', 'lava')) === 'Dan tried to swim in lava', 'and lava is vanilla\'s own line');
  ok(T.plain(T.deathMessage('Dan', 'not_a_source')) === 'Dan died',
    'an unknown source falls back to death.attack.generic rather than showing a key');
  // the `.player` variant when a killer is named
  ok(T.has('death.attack.generic.player') ? T.plain(T.deathMessage('Dan', 'generic', 'a zombie')).indexOf('zombie') > 0 : true,
    'a named killer uses the .player variant where vanilla has one');
}

// ═══════════ 7. anti-vacuity ══════════════════════════════════════════════════════════════
say('\n7. anti-vacuity: break it, and it must be caught');
{
  // §2's complex vector must distinguish the right answer from the plausible wrong one
  // ⚠ THIS IS THE IMPLEMENTATION EVERYONE WRITES: one counter, advanced by BOTH forms.
  const naive = (tpl, args) => {
    let i = 0;
    return tpl.replace(/%(\d+\$)?s/g, (m, d) => { const idx = d ? +d.slice(0, -1) - 1 : i; i++; return args[idx]; });
  };
  const wrong = naive(T.template('translation.test.complex'), ['a', 'b', 'c', 'd']);
  say('   the naive implementation gives: ' + JSON.stringify(wrong));
  okAv(wrong !== 'Prefix, ab again b and a lastly c and also a again!',
    'the obvious implementation — one counter advanced by BOTH forms — gives a different answer, so §2 is a real test');
  okAv(wrong.indexOf('again c') >= 0, `and specifically it puts \`c\` where \`b\` belongs: ${JSON.stringify(wrong)}`);
  okAv(naive('%%s', ['a']) !== T.format('%%s', ['a']),
    'the naive one also mishandles `%%`, which is the second thing the fixtures are for');

  // §5's colour-clears-decoration rule must be load-bearing
  const r = T.runs(T.literal('§lbold§ered'));
  okAv(r.length === 2 && r[0].style.bold === true && !r[1].style.bold,
    'the colour code really does clear the bold — a merge-everything implementation would keep it');

  // §4's inheritance must distinguish undefined from false
  const p2 = T.literal('a', { bold: true });
  T.append(p2, T.literal('b'));
  T.append(p2, T.literal('c', { bold: false }));
  const rr = T.runs(p2);
  okAv(rr[1].style.bold === true && rr[2].style.bold === false,
    'undefined inherits and false overrides — collapsing them would make these two runs identical');

  // §3 must fail on a block that has no key rather than inventing one
  okAv(T.blockName('definitely_not_a_block').indexOf('minecraft.') >= 0,
    'an unknown block returns its key, so §3 counting "no minecraft. in the name" really is counting hits');

  // the override table must be load-bearing: without it 18 blocks fail §3
  const saved = T.overrides;
  T.overrides = Object.create(null);
  let lost = 0;
  for (const b of ['red_wall_banner', 'item_frame', 'glow_item_frame', 'white_wall_banner']) {
    if (T.blockName(b).indexOf('minecraft.') >= 0) lost++;
  }
  T.overrides = saved;
  okAv(lost === 4, `without the override table those four blocks show a key — ${lost} of 4`);

  // and the escape test must distinguish %% from %
  okAv(T.format('%%s', ['a']) !== T.format('%s', ['a']),
    '`%%s` and `%s` really do give different answers');
}

console.log('');
console.log('================= textcheck ================');
console.log(` language keys ...... ${T.keys}`);
console.log(` blocks named ....... ${meta.blocksNamed} of ${meta.blocksChecked}`);
console.log(` items named ........ ${meta.itemsNamed} of ${meta.itemsChecked}`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
