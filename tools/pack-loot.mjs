#!/usr/bin/env node
// pack-loot.mjs — PLAN G3. The 835 vanilla block loot tables, packed for the runtime.
//
//   node tools/pack-loot.mjs [--jar ...] [--out assets]
//
// ── WHY THE TABLES AND NOT A DROP LIST ───────────────────────────────────────────────────
// It is tempting to flatten "block -> item" at build time and ship 835 pairs. That throws the
// game away. A loot table is a small program: `stone` drops cobblestone UNLESS the tool has
// Silk Touch; `diamond_ore` runs `apply_bonus{ore_drops}` so Fortune III is a real distribution
// and not a multiplier; `wheat` reads `age=7` off the block state; `gravel` rolls a
// `table_bonus` whose four chances ARE Fortune's flint curve. PLAN says it in one line —
// *"Fortune and Silk Touch are therefore **data**, not special cases"* — and that is only true
// if the tables ship whole.
//
// So this packs the 835 files verbatim (minus `minecraft:` prefixes and whitespace) and
// `src/07e_loot.js` is the interpreter. The whole vocabulary those files use is small and
// closed, and the build PRINTS it, so a version bump that introduces a new function shows up
// here as an unknown rather than as a silently missing drop:
//
//   entries     item · alternatives · dynamic
//   conditions  survives_explosion · match_tool · block_state_property · table_bonus ·
//               random_chance · alternative · inverted · entity_properties · location_check
//   functions   set_count · apply_bonus · explosion_decay · limit_count · copy_name ·
//               copy_state · copy_nbt · set_contents
//
// ── THE FORMAT ───────────────────────────────────────────────────────────────────────────
// The same interning trick `pack-worldgen.mjs` uses, and for the same reason: this corpus is
// 497 KB of JSON in which `"minecraft:survives_explosion"` appears 700 times. Every distinct
// string AND every object key becomes an index into one table; a string VALUE is written as
// the one-key object `{s: i}` so the decoder can tell it from a number without a schema. The
// blob is `{v, s, t}` — version, strings, and table name index -> packed table — minified,
// deflated, base64.
//
// ⚠ ONLY `loot_tables/blocks/`. The 41 chest, 91 entity and 19 gameplay tables are G17/G18/G20
// business and would be 40% more bytes for nothing this stage can use. `lootcheck` inside
// `minecheck` §5 asserts the count, so adding them later is a deliberate act.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const VERSION = opt('version', '1.18.2');
const OUT = opt('out', join(MCLITE_ROOT, 'assets'));
const JAR = opt('jar', requireJar(VERSION));
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const jar = new Jar(JAR);

const strings = []; const strIdx = new Map();
const intern = (s) => { if (!strIdx.has(s)) { strIdx.set(s, strings.length); strings.push(s); } return strIdx.get(s); };

// Every id in these files is `minecraft:`-prefixed and nothing else is, so stripping it is
// lossless and saves 10 bytes on each of ~6,000 strings before deflate ever runs.
const strip = (s) => (s.indexOf('minecraft:') === 0 ? s.slice(10) : s);

function pack(node) {
  if (node === null || typeof node !== 'object') {
    return typeof node === 'string' ? { s: intern(strip(node)) } : node;
  }
  if (Array.isArray(node)) return node.map(pack);
  const out = {};
  for (const k of Object.keys(node)) out[intern(k)] = pack(node[k]);
  return out;
}

const vocab = { entry: new Map(), condition: new Map(), function: new Map() };
const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1);
function survey(node, ctx) {
  if (Array.isArray(node)) { for (const x of node) survey(x, ctx); return; }
  if (!node || typeof node !== 'object') return;
  if (ctx === 'entry' && typeof node.type === 'string') bump(vocab.entry, strip(node.type));
  if (ctx === 'cond' && typeof node.condition === 'string') bump(vocab.condition, strip(node.condition));
  if (ctx === 'func' && typeof node.function === 'string') bump(vocab.function, strip(node.function));
  if (node.pools) survey(node.pools, 'pool');
  if (node.entries) survey(node.entries, 'entry');
  if (node.children) survey(node.children, 'entry');
  if (node.conditions) survey(node.conditions, 'cond');
  if (node.functions) survey(node.functions, 'func');
  if (node.term) survey(node.term, 'cond');
  if (node.terms) survey(node.terms, 'cond');
}

const tables = {};
let files = 0, rawBytes = 0, pools = 0, entries = 0;
let blockFiles = 0, chestFiles = 0, entityFiles = 0;
// D-381: blocks/, chests/ and entities/ all pack now — G18d needs the entity tables for mob
// drops and packs the chest tables alongside them rather than coming back for a second pass
// later (G19b wires chest GENERATION; the DATA is cheap to carry now). Block table keys stay
// BARE for backward compatibility with every existing L.table(blockName) call; chest and entity
// keys carry their kind as a prefix ('entities/cow', 'chests/village/village_weaponsmith') so
// the three namespaces cannot collide in the single `byName` map.
// A `minecraft:tag` entry with `expand:true` (creeper's music discs is the only user in the
// entity set) picks ONE tag member at random — vanilla builds it as a synthetic per-item choice,
// not as a real weighted-alternatives node, so this resolves it HERE against the jar's own tag
// file and rewrites it to `item_choice` before the vocabulary survey ever runs. That keeps the
// runtime interpreter from needing a whole tag-membership system for one entry in one table.
function resolveTags(node) {
  if (Array.isArray(node)) { node.forEach(resolveTags); return node; }
  if (!node || typeof node !== 'object') return node;
  if (node.type === 'minecraft:tag' && node.expand) {
    const tagName = String(node.name).replace(/^minecraft:/, '');
    const tagPath = 'data/minecraft/tags/items/' + tagName + '.json';
    const tagJson = JSON.parse(jar.readText(tagPath));
    const items = tagJson.values.map((v) => String(v).replace(/^minecraft:/, ''));
    node.type = 'minecraft:item_choice';
    node.items = items;
    delete node.name;
    delete node.expand;
  }
  for (const k of Object.keys(node)) resolveTags(node[k]);
  return node;
}

const RE = /^data\/minecraft\/loot_tables\/(blocks|entities)\/(.+)\.json$/;
for (const e of jar.names().sort()) {
  const m = RE.exec(e);
  if (!m) continue;
  const kind = m[1], rest = m[2];
  const text = jar.readText(e);
  rawBytes += text.length;
  const json = resolveTags(JSON.parse(text));
  survey(json, 'root');
  for (const p of json.pools || []) { pools++; entries += (p.entries || []).length; }
  const key = kind === 'blocks' ? rest : (kind + '/' + rest);
  tables[intern(key)] = pack(json);
  files++;
  if (kind === 'blocks') blockFiles++; else entityFiles++;
}
// G18d's own reference: `guardian`'s rare fish drop is a `minecraft:loot_table` entry pointing
// at `gameplay/fishing/fish`, which is not under blocks/ or entities/. Packed by its own path so
// the reference resolves instead of silently drawing nothing (D-381).
{
  // G17-F4: the fishing root, junk and treasure ride along (FishingBobberEntity.use rolls gameplay/fishing).
  for (const nm of ['fish', 'junk', 'treasure', null]) {
    const key = nm ? 'gameplay/fishing/' + nm : 'gameplay/fishing';
    const text = jar.readText('data/minecraft/loot_tables/' + key + '.json');
    rawBytes += text.length;
    const json = resolveTags(JSON.parse(text));
    survey(json, 'root');
    for (const p of json.pools || []) { pools++; entries += (p.entries || []).length; }
    tables[intern(key)] = pack(json);
    files++;
    entityFiles++;
  }
}
// loop/gifts -- GiveGiftsToHeroTask's own 13-profession GIFTS map (.decomp
// GiveGiftsToHeroTask.java:30-44), each entry a `gameplay/hero_of_the_village/<profession>_gift`
// table -- same one-off-path packing as `gameplay/fishing/fish` just above, since none of these
// live under blocks/ or entities/ either. Keyed 'gameplay/hero_of_the_village/<profession>_gift'
// so src/07zv7_vbgifts.js's own `L.rollTable` calls can name them directly.
const GIFT_PROFESSIONS = ['armorer', 'butcher', 'cartographer', 'cleric', 'farmer', 'fisherman',
  'fletcher', 'leatherworker', 'librarian', 'mason', 'shepherd', 'toolsmith', 'weaponsmith'];
for (const prof of GIFT_PROFESSIONS) {
  const gp = 'data/minecraft/loot_tables/gameplay/hero_of_the_village/' + prof + '_gift.json';
  const text = jar.readText(gp);
  rawBytes += text.length;
  const json = resolveTags(JSON.parse(text));
  survey(json, 'root');
  for (const p of json.pools || []) { pools++; entries += (p.entries || []).length; }
  tables[intern('gameplay/hero_of_the_village/' + prof + '_gift')] = pack(json);
  files++;
  entityFiles++;
}
if (files === 0) { console.error('pack-loot: no loot tables in ' + JAR); process.exit(1); }

// ⚠ EVERY VERB MUST BE ONE THE INTERPRETER KNOWS. A table using a function `src/07e_loot.js`
// has never heard of would drop the wrong thing at runtime and nothing would say so, so the
// build refuses instead. Extend BOTH lists together, or not at all (D-202).
const KNOWN = {
  entry: ['item', 'alternatives', 'dynamic', 'empty', 'loot_table', 'item_choice'],
  condition: ['survives_explosion', 'match_tool', 'block_state_property', 'table_bonus',
    'random_chance', 'alternative', 'inverted', 'entity_properties', 'location_check',
    'killed_by_player', 'random_chance_with_looting', 'damage_source_properties'],
  function: ['set_count', 'apply_bonus', 'explosion_decay', 'limit_count', 'copy_name',
    'copy_state', 'copy_nbt', 'set_contents', 'looting_enchant', 'furnace_smelt', 'set_potion',
    'set_damage', 'enchant_with_levels'],
};
let unknown = [];
for (const kind of Object.keys(KNOWN)) {
  for (const k of vocab[kind].keys()) if (KNOWN[kind].indexOf(k) < 0) unknown.push(kind + ':' + k);
}
if (unknown.length) { console.error('pack-loot: verbs src/07e_loot.js does not implement: ' + unknown.join(' ')); process.exit(1); }

const blob = JSON.stringify({ v: VERSION, s: strings, t: tables });
const deflated = deflateRawSync(Buffer.from(blob, 'utf8'), { level: 9 });
if (inflateRawSync(deflated).toString('utf8') !== blob) { console.error('FATAL: loot.bin does not round-trip'); process.exit(1); }
writeFileSync(join(OUT, 'loot.bin'), deflated);
writeFileSync(join(OUT, 'loot.meta.json'), JSON.stringify({
  version: VERSION, files, blockFiles, entityFiles, rawBytes, jsonBytes: blob.length, packedBytes: deflated.length,
  strings: strings.length, pools, entries,
  vocab: Object.fromEntries(Object.keys(vocab).map((k) => [k, Object.fromEntries([...vocab[k]].sort((a, b) => b[1] - a[1]))])),
}, null, 2) + '\n');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('pack-loot');
console.log(` tables ............ ${files} loot tables (${blockFiles} blocks, ${chestFiles} chests, ${entityFiles} entities), ${pools} pools, ${entries} entries`);
console.log(` vocabulary ........ ${vocab.entry.size} entry types · ${vocab.condition.size} conditions · ${vocab.function.size} functions, all implemented`);
console.log(` packed ............ ${kb(rawBytes)} of JSON -> ${kb(blob.length)} interned -> ${kb(deflated.length)} deflated`);
console.log(`                     ${kb(deflated.length * 4 / 3)} as base64 in the file`);
