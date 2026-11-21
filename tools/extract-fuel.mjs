#!/usr/bin/env node
// extract-fuel.mjs — vanilla's FURNACE BURN TIMES, read out of the 1.18.2 client jar's BYTECODE.
//
//   node tools/extract-fuel.mjs [--if-missing]        -> tools/golden/fuel-1.18.2.tsv
//
// ⚠ WHY THIS EXISTS. `AbstractFurnaceBlockEntity.getFuel()` is a hand-written
// `LinkedHashMap<Item,Integer>` of sixty-two `add(...)` calls. It is compiled Java: in no JSON,
// in no `minecraft-data` file, in no tag and in no recipe. G9 in `docs/archive/PLAN.md` says
// "hand-table them", and a hand table is exactly the D-263 mistake — a constant derived from
// nothing, right until the day it is wrong and nothing notices. Burn times are the survival
// loop, which the charter puts under ABSOLUTE FULL PARITY, so they get a generated table with
// the same standing as `block-materials-1.18.2.tsv` and `item-equipment-1.18.2.tsv`.
//
// ⚠ AND IT NEEDS NO MAPPINGS, exactly as D-263 established. Mojang's mapping host is outside
// this container's egress allowlist, so the obfuscated jar is read STRUCTURALLY. Nothing below
// trusts a name:
//
//   1. `Items` is the class with 1000-1200 static finals of one Item type; `Blocks` is the class
//      with 850-1000 static finals of one Block type. (The technique `extract-equipment.mjs`
//      and `extract-materials.mjs` already use.)
//   2. `ItemTags` is the class whose static finals are declared `TagKey<Item>` — it is the only
//      one of the four tag holders parameterised by the Item type found in step 1, so it is
//      picked by its GENERIC SIGNATURE, not by how many constants it has.
//   3. `AbstractFurnaceBlockEntity` is the one class in all 6,399 that declares a
//      `public static Map<Item,Integer> x()` taking no arguments. That is the whole search: the
//      integer literals 20000/16000/2400 only CONFIRM it (section 4's guard), they do not find it.
//   4. The method body is a flat run of `getstatic <field>; push <int>; invokestatic <helper>`.
//      There are two helpers and they are told apart by DESCRIPTOR: the one whose middle
//      parameter is the TagKey type of step 2 adds a tag, the other adds an ItemLike. An
//      ItemLike field is either an `Items` field or a `Blocks` field, and both `<clinit>`s name
//      their constants with string literals in registry order.
//   5. The tag helper skips any item in one tag, read out of its own guard predicate — that is
//      `#minecraft:non_flammable_wood`, and it is why crimson and warped planks, stems, doors,
//      slabs, stairs, fences, signs and buttons are members of #planks / #logs / #signs and
//      still are not fuel. A consumer of this table MUST apply that exclusion; the header names
//      it, and section 7 asserts it against the jar's own tag JSON.
//
// ⚠ dried_kelp_block is 4001, not 4000. That is vanilla's own off-by-one and it is in the
// bytecode as `sipush 4001`. It is not a typo here.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { requireJar } from './paths.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(MCLITE_ROOT, 'tools', 'golden', 'fuel-1.18.2.tsv');

const say = (...a) => console.log(...a);
let failures = 0;
const ok = (c, m) => { if (!c) { failures++; say('   x ' + m); } };

// ⚠ `tools/golden/` IS GITIGNORED (D-6 — it is Mojang's compiled code), so this file is a
// required input a fresh clone does not have, exactly like `block-materials-1.18.2.tsv`. The
// suite runs this stage with `--if-missing`, a no-op when the table is already there.
if (process.argv.includes('--if-missing') && existsSync(OUT)) {
  say(' fuel-1.18.2.tsv is present — nothing to do (--if-missing)');
  process.exit(0);
}

const JAR = requireJar('1.18.2');
try { execFileSync('javap', ['-version'], { stdio: 'ignore' }); }
catch { say('SKIP - no javap on this machine. Install a JDK, or keep the committed TSV.'); process.exit(0); }

const work = mkdtempSync(join(tmpdir(), 'mclite-fuel-'));
try {
  execFileSync('unzip', ['-o', '-q', JAR, '-d', work]);
  const all = execFileSync('bash', ['-c',
    'cd ' + JSON.stringify(work) + " && find . -name '*.class' | sed 's|^\\./||; s|\\.class$||' | tr '/' '.'"],
    { maxBuffer: 1 << 28 }).toString().trim().split('\n');
  say(' classes ............ ' + all.length);

  const javap = (args, names) => {
    let out = '';
    for (let i = 0; i < names.length; i += 300) {
      out += execFileSync('javap', [...args, '-cp', work, ...names.slice(i, i + 300)],
        { maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    }
    return out.split('\n').filter((l) => !l.startsWith('Picked up'));
  };

  // ------------------------------------------------------------ 1. Items and Blocks, by shape
  const sigs = javap(['-p'], all);
  let cur = null;
  const plainCount = new Map();     // "<class> <type>"     -> n static finals of that plain type
  const genericCount = new Map();   // "<class> <raw><arg>" -> n static finals of that generic type
  const declares = new Map();       // <class> -> [raw member lines]
  for (const line of sigs) {
    const d = line.trim().match(/^(?:public |final |abstract |)*(?:class|interface|enum) ([\w.$]+)/);
    if (d && line.trimEnd().endsWith('{')) { cur = d[1]; declares.set(cur, []); continue; }
    if (!cur) continue;
    declares.get(cur).push(line.trim());
    const g = line.match(/static final ([\w.$]+)<([\w.$]+)> \w+;/);
    if (g) { const k = cur + ' ' + g[1] + ' ' + g[2]; genericCount.set(k, (genericCount.get(k) || 0) + 1); continue; }
    const f = line.match(/static final ([\w.$[\]]+) /);
    if (!f || f[1] === cur) continue;
    const k = cur + ' ' + f[1];
    plainCount.set(k, (plainCount.get(k) || 0) + 1);
  }
  const pick = (lo, hi, what) => {
    const c = [...plainCount].filter(([, n]) => n >= lo && n <= hi).sort((a, b) => b[1] - a[1])[0];
    ok(!!c, 'no ' + what + ' candidate: no class with ' + lo + '-' + hi + ' static finals of one type');
    return c;
  };
  const itemsCand = pick(1000, 1200, 'Items');
  const blocksCand = pick(850, 1000, 'Blocks');
  if (failures) { say('\n aborted'); process.exit(1); }
  const [ITEMS, ITEMTYPE] = itemsCand[0].split(' ');
  const [BLOCKS, BLOCKTYPE] = blocksCand[0].split(' ');
  say(' Items class ........ ' + ITEMS + ' of ' + ITEMTYPE + ' (' + itemsCand[1] + ' fields)');
  say(' Blocks class ....... ' + BLOCKS + ' of ' + BLOCKTYPE + ' (' + blocksCand[1] + ' fields)');

  // ------------------------------------------------------------ 2. ItemTags, by generic signature
  // ⚠ FOUR classes hold tag constants (blocks, items, fluids, entity types) and all four are the
  // same raw type with the same shape. Only ONE is parameterised by the Item type of step 1, so
  // the generic signature — which javap prints and the obfuscator does not erase — separates them
  // where a count of constants could not.
  const tagCands = [...genericCount].filter(([k, n]) => k.endsWith(' ' + ITEMTYPE) && n >= 40)
    .sort((a, b) => b[1] - a[1]);
  ok(tagCands.length === 1,
    tagCands.length + ' classes have 40+ static finals of some Generic<' + ITEMTYPE + '> — expected exactly one (ItemTags)');
  if (failures) { say('\n aborted'); process.exit(1); }
  const [TAGS, TAGTYPE] = tagCands[0][0].split(' ');
  say(' ItemTags class ..... ' + TAGS + ' of ' + TAGTYPE + '<' + ITEMTYPE + '> (' + tagCands[0][1] + ' fields)');

  // ------------------------------------------------------------ 3. the furnace, by return type
  // The one class in the jar that declares `public static Map<Item,Integer> x()` with no args.
  const WANT = new RegExp('^public static java\\.util\\.Map<' + ITEMTYPE + ', java\\.lang\\.Integer> (\\w+)\\(\\);$');
  const furnaces = [];
  for (const [cls, members] of declares) {
    for (const m of members) { const g = m.match(WANT); if (g) furnaces.push([cls, g[1]]); }
  }
  ok(furnaces.length === 1,
    furnaces.length + ' classes declare a no-arg `public static Map<' + ITEMTYPE
    + ',Integer>` method — expected exactly one (AbstractFurnaceBlockEntity.getFuel)');
  if (failures) { say('\n aborted'); process.exit(1); }
  const [FUEL, GETFUEL] = furnaces[0];
  say(' furnace class ...... ' + FUEL + '  getFuel() = ' + FUEL + '.' + GETFUEL + '()');

  // ------------------------------------------------------------ 4. read the map
  const code = javap(['-c', '-p'], [FUEL]);
  // split the disassembly into methods: a member line at two-space indent starts a new one
  const methods = new Map();
  let head = null, body = [];
  for (const l of code) {
    const isHead = /^ {2}\S/.test(l) && l.trimEnd().endsWith(');');
    if (isHead) { if (head) methods.set(head, body); head = l.trim(); body = []; continue; }
    if (head) body.push(l);
  }
  if (head) methods.set(head, body);
  const bodyOf = (pred) => { for (const [h, b] of methods) if (pred(h)) return b; return null; };

  const fuelBody = bodyOf((h) => WANT.test(h) && h.includes(' ' + GETFUEL + '();'));
  ok(!!fuelBody, 'could not isolate ' + GETFUEL + '() in the disassembly');
  if (failures) { say('\n aborted'); process.exit(1); }

  const RE_GET = /getstatic\s+#\d+\s+\/\/ Field (\w+)\.(\w+):L(\w+);/;
  const RE_ADD = new RegExp('invokestatic\\s+#\\d+\\s+// Method (\\w+):\\(Ljava/util/Map;L(\\w+);I\\)V');
  const intOf = (l) => {
    let m;
    if ((m = l.match(/:\s+(?:sipush|bipush)\s+(-?\d+)\s*$/))) return +m[1];
    if ((m = l.match(/:\s+iconst_(\d)\s*$/))) return +m[1];
    if ((m = l.match(/:\s+ldc(?:_w)?\s+#\d+\s+\/\/ int (-?\d+)\s*$/))) return +m[1];
    return null;
  };
  const entries = [];
  const addHelpers = new Set();
  let pendField = null, pendVal = null;
  for (const l of fuelBody) {
    let m;
    if ((m = l.match(RE_GET))) { pendField = [m[1], m[2], m[3]]; continue; }
    const v = intOf(l); if (v !== null) { pendVal = v; continue; }
    if ((m = l.match(RE_ADD))) {
      addHelpers.add(m[1] + ':(Ljava/util/Map;L' + m[2] + ';I)V');
      ok(pendField && pendVal !== null, 'an add() call in ' + GETFUEL + '() had no field or no literal before it');
      if (pendField && pendVal !== null) {
        entries.push({ cls: pendField[0], field: pendField[1], ticks: pendVal, isTag: m[2] === TAGTYPE });
      }
      pendField = null; pendVal = null;
    }
  }
  ok(addHelpers.size === 2, addHelpers.size + ' distinct add() helpers in ' + GETFUEL
    + '() — expected two (one ItemLike, one ' + TAGTYPE + ')');
  ok(entries.some((e) => e.isTag) && entries.some((e) => !e.isTag),
    'the two overloads did not both fire — the descriptor split is wrong');
  say(' map entries ........ ' + entries.length
    + '  (' + entries.filter((e) => e.isTag).length + ' tag, ' + entries.filter((e) => !e.isTag).length + ' item-like)');

  // the exclusion: the TAG helper's guard predicate reads exactly one ItemTags field
  let EXCLUDE = null;
  {
    const tagHelper = bodyOf((h) => new RegExp('\\(java\\.util\\.Map<' + ITEMTYPE
      + ', java\\.lang\\.Integer>, ' + TAGTYPE + '<' + ITEMTYPE + '>, int\\)').test(h));
    ok(!!tagHelper, 'could not isolate the tag add() helper');
    const g = (tagHelper || []).map((l) => l.match(new RegExp('invokestatic\\s+#\\d+\\s+// Method (\\w+):\\(L' + ITEMTYPE + ';\\)Z')))
      .filter(Boolean)[0];
    ok(!!g, 'the tag add() helper calls no boolean(Item) guard — the exclusion derivation is stale');
    if (g) {
      const guard = bodyOf((h) => h.includes(' ' + g[1] + '(' + ITEMTYPE + ');'));
      ok(!!guard, 'could not isolate guard ' + g[1] + '(' + ITEMTYPE + ')');
      const fields = (guard || []).map((l) => l.match(RE_GET)).filter(Boolean)
        .filter((m) => m[1] === TAGS && m[3] === TAGTYPE).map((m) => m[2]);
      ok(fields.length === 1, 'guard ' + g[1] + ' reads ' + fields.length + ' ItemTags fields — expected exactly one');
      if (fields.length === 1) EXCLUDE = fields[0];
    }
  }
  if (failures) { say('\n aborted'); process.exit(1); }

  // ------------------------------------------------------------ 5. name the constants
  // Every one of the three <clinit>s registers its constants from a string literal in registry
  // order; a block ITEM takes the name of the block it was built from.
  const clinitOf = (cls) => {
    const lines = javap(['-c', '-p'], [cls]);
    const i = lines.findIndex((l) => l.trim().startsWith('static {}'));
    ok(i >= 0, cls + ' has no <clinit>');
    return lines.slice(i < 0 ? 0 : i);
  };
  const RE_STR = /ldc(?:_w)?\s+#\d+\s+\/\/ String (\S+)$/;
  const RE_PUT = /putstatic\s+#\d+\s+\/\/ Field (\w+):L(\w+);/;
  // ⚠ FIRST STRING WINS, not last. `register(String, T)` evaluates its name argument BEFORE it
  // constructs the thing, and some constructors take a string of their own — `HorseArmorItem`
  // takes a texture name, so "diamond_horse_armor" is followed by a second literal "diamond"
  // before the putstatic. Taking the last literal silently renames two items onto names that
  // already exist, which is what the duplicate assertion below catches.
  const simpleNames = (cls, type) => {
    const out = new Map(); let first = null;
    for (const l of clinitOf(cls)) {
      let m;
      if ((m = l.match(RE_STR))) { if (first === null) first = m[1]; continue; }
      if ((m = l.match(RE_PUT)) && m[2] === type) { if (first !== null) out.set(m[1], first); first = null; }
    }
    return out;
  };
  const blockName = simpleNames(BLOCKS, BLOCKTYPE);
  const tagName = simpleNames(TAGS, TAGTYPE);
  say(' blocks named ....... ' + blockName.size);
  say(' item tags named .... ' + tagName.size);

  // Items: the register helper's DESCRIPTOR says whether this constant was named by a string
  // literal of its own or takes the name of the block it was built from, so nothing here has to
  // guess which of the two most recent values applies. There are two block-item shapes —
  // `register(Blocks.X, ...)` and `register(new SomeBlockItem(Blocks.X, ...))` (scaffolding,
  // the buckets-in-blocks, the standing/wall pairs) — and BOTH take the block's name, which is
  // why the rule is "not a String first parameter" rather than "a Block first parameter".
  const itemName = new Map(), itemOfBlockField = new Map();
  {
    let lastStr = null, lastBlk = null, lastDesc = null;
    for (const l of clinitOf(ITEMS)) {
      let m;
      if ((m = l.match(RE_STR))) { if (lastStr === null) lastStr = m[1]; continue; }
      if ((m = l.match(RE_GET))) { if (m[1] === BLOCKS && m[3] === BLOCKTYPE && lastBlk === null) lastBlk = m[2]; continue; }
      if ((m = l.match(/invokestatic\s+#\d+\s+\/\/ Method \w+:(\([^)]*\)L\w+;)$/))) { lastDesc = m[1]; continue; }
      if ((m = l.match(RE_PUT)) && m[2] === ITEMTYPE) {
        if (lastDesc && lastDesc.startsWith('(Ljava/lang/String;') && lastStr) itemName.set(m[1], lastStr);
        else if (lastBlk) {
          const n = blockName.get(lastBlk);
          if (n) { itemName.set(m[1], n); itemOfBlockField.set(lastBlk, m[1]); }
        }
        lastStr = null; lastBlk = null; lastDesc = null;
      }
    }
  }
  ok(new Set(itemName.values()).size === itemName.size,
    'two Items fields resolved to the same name — the <clinit> walk has slipped');
  say(' items named ........ ' + itemName.size);

  const rows = [];
  for (const e of entries) {
    if (e.isTag) {
      ok(e.cls === TAGS, 'a tag entry reads ' + e.cls + '.' + e.field + ', not a field of ' + TAGS);
      const n = tagName.get(e.field);
      ok(!!n, 'tag field ' + e.cls + '.' + e.field + ' has no name in ' + TAGS + '.<clinit>');
      if (n) rows.push([ '#minecraft:' + n, e.ticks, 'tag' ]);
      continue;
    }
    if (e.cls === ITEMS) {
      const n = itemName.get(e.field);
      ok(!!n, 'item field ' + e.cls + '.' + e.field + ' has no name in ' + ITEMS + '.<clinit>');
      if (n) rows.push([ n, e.ticks, 'item' ]);
      continue;
    }
    if (e.cls === BLOCKS) {
      const n = blockName.get(e.field);
      ok(!!n, 'block field ' + e.cls + '.' + e.field + ' has no name in ' + BLOCKS + '.<clinit>');
      // a Block is only fuel through its BlockItem — if no item was registered from it the
      // resolution is wrong, and this is where that shows up rather than in the game.
      ok(itemOfBlockField.has(e.field),
        'block ' + (n || e.field) + ' has no BlockItem in ' + ITEMS + '.<clinit> — cannot be a fuel');
      if (n) rows.push([ n, e.ticks, 'item' ]);
      continue;
    }
    ok(false, 'fuel entry reads ' + e.cls + '.' + e.field + ', which is neither Items, Blocks nor ItemTags');
  }
  const EXCLUDE_TAG = EXCLUDE ? 'minecraft:' + tagName.get(EXCLUDE) : null;
  ok(!!EXCLUDE_TAG, 'the exclusion tag has no name in ' + TAGS + '.<clinit>');
  say(' tag exclusion ...... #' + EXCLUDE_TAG);

  // ------------------------------------------------------------ 6. expand the tags, from the jar
  // ⚠ The tags are NOT expanded into the output — the table stays as vanilla writes it, because
  // a datapack may change a tag and must not need this tool re-run. They are expanded HERE, out
  // of the jar's own `data/minecraft/tags/items/*.json`, purely so section 7 can check both
  // directions on cases that cannot be in doubt.
  const TAGDIR = join(work, 'data', 'minecraft', 'tags', 'items');
  const seen = new Set();
  const expand = (tag) => {
    if (seen.has(tag)) return new Set();
    seen.add(tag);
    const f = join(TAGDIR, tag.replace(/^minecraft:/, '') + '.json');
    if (!existsSync(f)) { ok(false, 'tag #' + tag + ' has no JSON in the jar — the tag name is wrong'); return new Set(); }
    const out = new Set();
    for (const v of (JSON.parse(readFileSync(f, 'utf8')).values || [])) {
      const id = typeof v === 'string' ? v : v.id;
      if (!id) continue;
      if (id.startsWith('#')) { for (const x of expand(id.slice(1))) out.add(x); }
      else out.add(id.replace(/^minecraft:/, ''));
    }
    return out;
  };
  const members = new Map();
  for (const [name, ticks, kind] of rows) {
    if (kind !== 'tag') continue;
    seen.clear();
    members.set(name, expand(name.slice(1)));
  }
  seen.clear();
  const excluded = expand(EXCLUDE_TAG);
  ok(excluded.size > 0, 'the exclusion tag expanded to nothing');

  /** ticks for a plain item name, or 0 — vanilla's own lookup order: direct hit, then tags. */
  const burn = (item) => {
    for (const [name, ticks, kind] of rows) if (kind === 'item' && name === item) return ticks;
    if (excluded.has(item)) return 0;
    for (const [name, ticks, kind] of rows) if (kind === 'tag' && members.get(name).has(item)) return ticks;
    return 0;
  };

  // ------------------------------------------------------------ 7. ANTI-VACUITY
  // ⚠ BOTH DIRECTIONS, on cases nobody has to look up. A table that is merely self-consistent is
  // worthless: these are the numbers a player would notice within one furnace.
  const MUST = {
    lava_bucket: 20000, coal_block: 16000, blaze_rod: 2400, coal: 1600, charcoal: 1600,
    stick: 100, bowl: 100, dried_kelp_block: 4001, scaffolding: 400, bamboo: 50,
    // through tags, so the tag rows cannot be silently empty or misnamed
    oak_planks: 300, oak_log: 300, oak_slab: 150, oak_door: 200, white_wool: 100,
    oak_boat: 1200, oak_sign: 200, white_banner: 300, oak_sapling: 100, white_carpet: 67,
  };
  for (const [item, want] of Object.entries(MUST)) {
    const got = burn(item);
    ok(got === want, item + ' burns for ' + got + ' ticks, expected ' + want);
  }
  // NOT fuel, and not by accident: four of these are the commonest items in the game and the
  // fifth is one bucket away from the longest-burning fuel there is.
  const MUSTNOT = ['stone', 'dirt', 'iron_ingot', 'diamond', 'water_bucket', 'cobblestone',
    'sand', 'bucket', 'oak_leaves', 'stone_slab', 'iron_door', 'iron_sword'];
  for (const item of MUSTNOT) {
    const got = burn(item);
    ok(got === 0, item + ' is not a fuel in vanilla, but this table burns it for ' + got + ' ticks');
  }
  // the exclusion has to BITE: crimson and warped wood are members of #planks, #logs, #signs and
  // the rest, and are still not fuel. If the guard derivation went stale this is what says so.
  for (const item of ['warped_planks', 'crimson_planks', 'warped_stem', 'crimson_stem',
    'warped_door', 'crimson_slab', 'warped_sign', 'crimson_fence']) {
    ok(excluded.has(item), item + ' is not in #' + EXCLUDE_TAG + ' — the exclusion derivation is stale');
    ok(burn(item) === 0, item + ' is #' + EXCLUDE_TAG + ' and must not burn, but this table burns it');
  }
  // and it must not over-reach: ordinary wood is NOT in the exclusion tag
  for (const item of ['oak_planks', 'oak_log', 'spruce_door']) {
    ok(!excluded.has(item), item + ' is in #' + EXCLUDE_TAG + ' — the exclusion tag is the wrong one');
  }
  // shape: vanilla's map is sixty-odd entries of six-ish distinct values, and every tick count is
  // a positive multiple of nothing in particular but is certainly in range.
  ok(rows.length >= 55 && rows.length <= 70, rows.length + ' fuel rows — vanilla 1.18.2 has 62');
  ok(new Set(rows.map((r) => r[0])).size === rows.length, 'the table has a duplicate key');
  for (const [name, ticks] of rows) ok(ticks > 0 && ticks <= 20000, name + ' has an impossible burn time ' + ticks);

  if (failures) { say('\n x ' + failures + ' failures - NOT written'); process.exit(1); }

  mkdirSync(dirname(OUT), { recursive: true });
  // ⚠ COMMENT LINES AND TAG ROWS BOTH BEGIN WITH `#`. Every comment here begins with HASH-SPACE
  // and a tag row begins with `#minecraft:`, so `line.startsWith('# ')` separates them; the
  // column header is deliberately space-separated so that no comment line contains a TAB and a
  // naive "three tab-separated fields" parser cannot mistake one for data either.
  const lines = [
    '# columns: item-or-tag / burn-ticks / kind, TAB separated',
    '# comment lines begin with "# " (hash SPACE); a tag row begins with "#minecraft:"',
    '# Generated by tools/extract-fuel.mjs from ' + JAR,
    '# AbstractFurnaceBlockEntity=' + FUEL + '  getFuel()=' + FUEL + '.' + GETFUEL + '()'
      + '  Items=' + ITEMS + '  Blocks=' + BLOCKS + '  ItemTags=' + TAGS,
    '# Identified WITHOUT mappings: ' + FUEL + ' is the only class in the jar declaring a no-arg',
    '# `public static java.util.Map<' + ITEMTYPE + ', java.lang.Integer>` method; ' + ITEMS + ' is the class with',
    '# 1000-1200 static finals of one type, ' + BLOCKS + ' the one with 850-1000, and ' + TAGS + ' the only',
    '# class with 40+ static finals of a generic parameterised by ' + ITEMTYPE + '. Names come from each',
    '# <clinit>\'s string literals; a block item takes its block\'s name.',
    '# Rows are in vanilla\'s own insertion order (getFuel builds a LinkedHashMap).',
    '# LOOKUP ORDER, which a consumer must follow: an exact item row wins; otherwise the item is',
    '# NOT fuel if it is in #' + EXCLUDE_TAG + '; otherwise the first matching tag row wins.',
    '# ⚠ THE EXCLUSION IS NOT OPTIONAL. crimson/warped planks, stems, doors, slabs, stairs, fences,',
    '# signs, buttons, pressure plates and trapdoors are all members of the tag rows below and are',
    '# all NOT fuel, because getFuel\'s tag helper skips every item in #' + EXCLUDE_TAG + '.',
    '# ⚠ dried_kelp_block is 4001, not 4000. That is vanilla\'s own literal.',
    '# Tag rows are deliberately NOT expanded: a datapack may change a tag\'s membership, and the',
    '# burn time attaches to the tag, not to today\'s members.',
  ];
  for (const [name, ticks, kind] of rows) lines.push(name + '\t' + ticks + '\t' + kind);
  writeFileSync(OUT, lines.join('\n') + '\n');
  say('\n wrote ' + OUT);
  say(' ' + rows.filter((r) => r[2] === 'item').length + ' item rows - '
    + rows.filter((r) => r[2] === 'tag').length + ' tag rows - '
    + Object.keys(MUST).length + '+' + MUSTNOT.length + ' assertions - 0 failures');
} finally {
  rmSync(work, { recursive: true, force: true });
}
