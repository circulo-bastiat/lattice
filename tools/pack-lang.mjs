#!/usr/bin/env node
// pack-lang.mjs — PLAN G12. Vanilla's `en_us.json`, whole, and the names that come out of it.
//
//   node tools/pack-lang.mjs [--jar ...] [--out assets]
//
// ── WHY THE WHOLE FILE ──────────────────────────────────────────────────────────────────────
// 5,163 keys, 285 KB of JSON, **57.8 KB deflated** — 77 KB once base64 has taken its third, which
// is 0.5% of D-12's 15 MB ceiling. A curated subset saves about 25 KB and costs a list that has
// to be revisited at every stage that adds a screen, and that goes stale silently when it is not.
// ⚠ The alternative was measured, not assumed: dropping the command, advancement, world-creation,
// multiplayer, statistics and options trees leaves 3,839 keys and 37.6 KB. **Not worth a
// maintenance decision.** So: the whole file, and G13's screens find their strings already here.
//
// ── ⚠ MOJANG SHIPS THE FORMATTER'S OWN TEST VECTORS, AND THEY ARE THE REFEREE ────────────────
// `translation.test.*` are seven strings that exist in `en_us.json` for one reason: Mojang's own
// unit tests use them. They pin exactly the cases a hand-written `%s` substituter gets wrong —
// a template mixing bare `%s` with indexed `%N$s` (the indexed form must NOT advance the
// sequential counter), doubled `%%` escapes, and two malformed templates. They are asserted
// present here and evaluated in `textcheck`, so the formatter is graded against the game's own
// fixtures rather than against what this project thinks the rule is.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { JARS as MCLITE_JARS } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : nested;
};
const JAR = opt('jar', jarPath('1.18.2'));
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jar = new Jar(JAR);
const LANG_PATH = 'assets/minecraft/lang/en_us.json';
if (!jar.has(LANG_PATH)) { console.error('pack-lang: ' + LANG_PATH + ' is not in ' + JAR); process.exit(1); }
const lang = JSON.parse(jar.read(LANG_PATH).toString('utf8'));
const keys = Object.keys(lang);

const fail = [];

// ── 1. the formatter's fixtures must be here ────────────────────────────────────────────────
const VECTORS = ['none', 'complex', 'escape', 'invalid', 'invalid2', 'args', 'world'];
for (const v of VECTORS) {
  if (typeof lang['translation.test.' + v] !== 'string') fail.push(`translation.test.${v} is missing — the formatter has no referee`);
}
if (lang['translation.test.complex'] !== 'Prefix, %s%2$s again %s and %1$s lastly %s and also %1$s again!') {
  fail.push('translation.test.complex is not the string this build was written against: ' + JSON.stringify(lang['translation.test.complex']));
}

// ── 2. every block and every item must have a display name ──────────────────────────────────
// ⚠ BOTH DIRECTIONS. The registry is the list of things the game can show you; `en_us.json` is
// the list of things it can name. A block with no key renders as `block.minecraft.x` on screen,
// and an `item.minecraft.*` key with no item is a name for something that does not exist —
// usually a spelling drift between the two files, which is the failure this catches.
const regPath = join(OUT, 'block-registry.json');
const itemPath = join(OUT, 'item-registry.json');
let blockNames = 0, itemNames = 0, blocksChecked = 0, itemsChecked = 0;

/**
 * ⚠ THE 18 BLOCKS WHOSE KEY IS NOT THEIR OWN NAME, and the rule is vanilla's, not a fallback.
 * `WallBannerBlock.getDescriptionId()` returns the STANDING banner's id — the wall form has no
 * string of its own and never had — and `item_frame`/`glow_item_frame` are ENTITIES, so their
 * player-facing name is the item's. Both are derived by rule below and the rule is asserted: the
 * count must be exactly 18, and every block must resolve after them.
 * ⚠ This is an OVERRIDE TABLE, computed once, and not a chain of runtime fallbacks. D-280 is why:
 * a lookup that tries three spellings until one works hides the day a fourth is needed.
 */
const nameKey = {};
function deriveKey(bare) {
  if (typeof lang['block.minecraft.' + bare] === 'string') return null;      // its own key; no entry
  if (typeof lang['item.minecraft.' + bare] === 'string') return 'item.minecraft.' + bare;
  const dewalled = bare.replace('_wall_', '_');
  if (dewalled !== bare && typeof lang['block.minecraft.' + dewalled] === 'string') {
    return 'block.minecraft.' + dewalled;
  }
  return undefined;                                                          // unresolvable
}

if (existsSync(regPath)) {
  const reg = JSON.parse(readFileSync(regPath, 'utf8'));
  const names = Array.isArray(reg) ? reg.map((b) => b.name) : Object.keys(reg.blocks || reg);
  const missing = [];
  for (const n of names) {
    blocksChecked++;
    const bare = String(n).replace(/^minecraft:/, '');
    const alt = deriveKey(bare);
    if (alt === null) { blockNames++; continue; }
    if (alt === undefined) { missing.push(bare); continue; }
    nameKey[bare] = alt; blockNames++;
  }
  if (missing.length) fail.push(`${missing.length} blocks have no display name, e.g. ${missing.slice(0, 5).join(', ')}`);
  // ⚠ BOTH DIRECTIONS on the override table itself: it must be exactly the wall banners and the
  // two item frames. One more, and something in the registry drifted; one fewer, and a name that
  // used to resolve has silently started rendering as `block.minecraft.x` on screen.
  const over = Object.keys(nameKey).sort();
  const expected = ['black', 'blue', 'brown', 'cyan', 'gray', 'green', 'light_blue', 'light_gray',
    'lime', 'magenta', 'orange', 'pink', 'purple', 'red', 'white', 'yellow']
    .map((c) => c + '_wall_banner').concat(['glow_item_frame', 'item_frame']).sort();
  if (over.join(',') !== expected.join(',')) {
    fail.push(`the display-name override table is ${over.length} entries and should be the 16 wall `
      + `banners plus the two item frames — got ${over.join(', ')}`);
  }
}
else fail.push('assets/block-registry.json is missing — run extract-blocks first');

if (existsSync(itemPath)) {
  const reg = JSON.parse(readFileSync(itemPath, 'utf8'));
  const all = reg.items || reg;
  // ⚠ `real` IS LOAD-BEARING HERE. The item registry carries 1,235 MODEL names and only 1,100 of
  // them are items a player can hold: `bow_pulling_0`, `clock_01`, `broken_elytra` and
  // `amethyst_bud` are model variants, and `air` is the empty stack. None has a display name in
  // any language file, and none should — asking for one and then relaxing the check to make the
  // question pass would have hidden the 1,100 that must have one.
  const list = Object.keys(all).filter((n) => all[n] && all[n].real);
  const missing = [];
  for (const bare of list) {
    itemsChecked++;
    // ⚠ A BLOCK ITEM IS NAMED BY ITS BLOCK KEY, not an item one — `item.minecraft.stone` does not
    // exist and never has. Accepting either is not laxness; it is vanilla's own rule.
    if (typeof lang['item.minecraft.' + bare] === 'string' || typeof lang['block.minecraft.' + bare] === 'string') itemNames++;
    else missing.push(bare);
  }
  if (missing.length) fail.push(`${missing.length} items have no display name, e.g. ${missing.slice(0, 8).join(', ')}`);
}
else fail.push('assets/item-registry.json is missing — run extract-items first');

// ── 3. the death messages, which G12 wires to G5's damage sources plus G18b's `mob` (D-394) ──
// ⚠ Each of these must have `death.attack.<id>`; `textcheck` asserts the OTHER direction (that
// the runtime maps each source to a key that resolves), because the runtime table is not
// readable from here. `mob` is G18b's own addition (`Cb.mobAttack`'s death source), not G5's.
const DAMAGE_IDS = ['generic', 'fall', 'starve', 'drown', 'inFire', 'onFire', 'lava', 'cactus', 'outOfWorld', 'magic', 'mob'];
const deathMissing = DAMAGE_IDS.filter((d) => typeof lang['death.attack.' + d] !== 'string');
if (deathMissing.length) fail.push(`no death message for: ${deathMissing.join(', ')}`);
const deathKeys = keys.filter((k) => k.startsWith('death.')).length;

if (fail.length) {
  console.error('pack-lang: ' + fail.length + ' failures — NOTHING written');
  for (const f of fail) console.error('   x ' + f);
  process.exit(1);
}

// ── pack ────────────────────────────────────────────────────────────────────────────────────
const whole = Buffer.from(JSON.stringify(lang), 'utf8');
const deflated = deflateRawSync(whole, { level: 9 });
if (Buffer.compare(inflateRawSync(deflated), whole) !== 0) {
  console.error('pack-lang: deflate round trip did not match');
  process.exit(1);
}
writeFileSync(join(OUT, 'lang.bin'), deflated);
writeFileSync(join(OUT, 'lang-overrides.json'), JSON.stringify(nameKey, null, 0));

// a few counts worth having in the report rather than recomputed by every reader
const prefixes = {};
for (const k of keys) { const p = k.split('.')[0]; prefixes[p] = (prefixes[p] || 0) + 1; }
writeFileSync(join(OUT, 'lang.meta.json'), JSON.stringify({
  jar: JAR, keys: keys.length, rawBytes: whole.length, deflated: deflated.length,
  blocksNamed: blockNames, blocksChecked, itemsNamed: itemNames, itemsChecked,
  overrides: Object.keys(nameKey).length,
  deathKeys, topPrefixes: Object.entries(prefixes).sort((a, b) => b[1] - a[1]).slice(0, 12),
}, null, 2));

console.log('================== pack-lang ==================');
console.log(' keys ............... ' + keys.length);
console.log(' block names ........ ' + blockNames + ' of ' + blocksChecked
  + '  (' + Object.keys(nameKey).length + ' named by another block\'s key — vanilla\'s own rule)');
console.log(' item names ......... ' + itemNames + ' of ' + itemsChecked + ' (block items use the block key)');
console.log(' death messages ..... ' + deathKeys + ', all ' + DAMAGE_IDS.length + ' damage sources covered');
console.log(' formatter vectors .. ' + VECTORS.length + ' of Mojang\'s own, present');
console.log(' lang.bin ........... ' + (whole.length / 1024).toFixed(1) + ' KB raw -> '
  + (deflated.length / 1024).toFixed(1) + ' KB deflated');
console.log(' ' + (Date.now() - t0) + ' ms  ->  ' + join(OUT, 'lang.bin'));
console.log('==============================================');
