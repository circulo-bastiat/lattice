#!/usr/bin/env node
// pack-worldgen.mjs — PLAN W1. The 766 vanilla worldgen files into one compact runtime blob.
//
//   node tools/pack-worldgen.mjs [--data <mcdata>] [--out assets]
//
// ⚠ DATA ONLY. Nothing here evaluates anything. W2 ports the noise, W3 the column function,
// W5 the biomes, W7 the carvers, W8 the features — all of them hand-written against the
// numbers this file carries. That split is deliberate: a generated evaluator would be a
// second implementation of Minecraft hidden inside a build tool, and no test could read it.
//
// ── WHAT "COMPACT RUNTIME FORM" MEANS HERE ───────────────────────────────────────────────
// The source is 4.2 MB of pretty-printed JSON across eleven registries, and it is thick with
// repetition: `"minecraft:sequence"` appears hundreds of times, every spline node repeats the
// keys `location`, `value`, `derivative`, and the same block state object appears in dozens of
// features. So:
//
//   1. every distinct STRING in the whole corpus is interned into one table and replaced by
//      its index — which turns every id, every type and every block name into an integer, and
//      makes the reference graph flat by construction;
//   2. every distinct OBJECT KEY is interned into the same table;
//   3. the result is minified, deflated, and shipped as base64 beside the block registry.
//
// The engine gets `NS.WG` — the string table plus one map per registry from name index to the
// parsed value — and reads it the same way on the main thread and in every worker.
//
// ── THE ACCEPTANCE TEST, IN PLAN's WORDS ─────────────────────────────────────────────────
// *"every id referenced by any file resolves; count of dangling references is zero, and a
// non-zero count fails the build."*
//
// The hard part of that sentence is deciding what counts as a reference, because a `minecraft:`
// string in these files is one of three quite different things:
//
//   * a REFERENCE to another entry in one of these registries — `minecraft:plains`,
//     `minecraft:ore_diamond`, `minecraft:village/plains/town_centers`. These must resolve.
//   * a TYPE naming a Java class — `minecraft:noise`, `minecraft:sequence`, `minecraft:ore`,
//     `minecraft:count`. There is nothing for these to resolve TO; they are the evaluator's
//     switch cases, and they are reported as a histogram instead, because that histogram is
//     the work list for W2, W3, W7 and W8.
//   * a BLOCK, ITEM, ENTITY, TAG or SOUND id — `minecraft:stone`, `minecraft:iron_ore`. Blocks
//     are checked against the 900-block registry, which is the one cross-source check
//     available here and worth having: a feature that places a block this build does not have
//     is a feature that will place air.
//
// Anything left over is reported by name rather than swept up, because "dangling" has to mean
// something specific for "zero" to mean anything.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Jar } from './jarlib.mjs';
import { readRawTags, makeTagResolver } from './taglib.mjs';
import { JARS as MCLITE_JARS, MCDATA } from './paths.mjs';
import { makeResolver } from './statelib.mjs';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const VERSION = opt('version', '1.18.2');
const DATA = join(opt('data', MCDATA), VERSION, 'data', 'minecraft', 'worldgen');
const OUT = opt('out', MCLITE_ROOT + 'assets');

// The jar is needed for ONE thing here: the list of `.nbt` structure templates, which is what
// a template pool's `element.location` points at. See the note on REF_FIELDS below.
/* MCLITE_JARS now comes from tools/paths.mjs (session 5) */
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : (existsSync(nested) ? nested : flat);
};
const JAR = opt('jar', jarPath(VERSION));

if (!existsSync(DATA)) {
  console.error('no worldgen cache at ' + DATA + '\n  run: node tools/fetch-vanilla-data.mjs');
  process.exit(1);
}

const t0 = Date.now();

// The eleven registries, in the order they are packed. `worldgen/` is stripped from the name.
const REGISTRIES = [
  'noise', 'noise_settings', 'density_function', 'biome',
  'configured_carver', 'configured_feature', 'placed_feature',
  'structure_set', 'configured_structure_feature', 'template_pool', 'processor_list',
];

// ---------------------------------------------------------------- read
function walk(dir, prefix = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...walk(join(dir, e.name), prefix + e.name + '/'));
    else if (e.name.endsWith('.json')) out.push([prefix + e.name.replace(/\.json$/, ''), join(dir, e.name)]);
  }
  return out;
}

const registry = {};             // reg -> { name -> parsed }
let files = 0, rawBytes = 0;
for (const reg of REGISTRIES) {
  const dir = join(DATA, reg);
  registry[reg] = {};
  if (!existsSync(dir)) continue;
  for (const [name, path] of walk(dir)) {
    registry[reg][name] = JSON.parse(readFileSync(path, 'utf8'));
    rawBytes += statSync(path).size;
    files++;
  }
}

// ---------------------------------------------------------------- the reference graph
// A field is a REFERENCE field if its value names an entry in one of the registries above.
// The set is written out rather than inferred, because inferring it is how a check quietly
// stops checking: a field nobody listed is a field nobody validates.
const REF_FIELDS = {
  // field name            -> which registry it points into
  feature: ['placed_feature', 'configured_feature'],
  biome: ['biome'],
  parent: ['biome'],
  noise: ['noise'],
  start_pool: ['template_pool'],
  element: ['template_pool'],
  processors: ['processor_list'],
  default_block: [], default_fluid: [],     // block states, handled separately
};

// ⚠ `location` is NOT a template-pool reference, which is what the first draft of this file
// assumed and what produced 773 "dangling" ids on its first run. Inside a
// `minecraft:single_pool_element` it names an **NBT STRUCTURE TEMPLATE** —
// `data/minecraft/structures/<path>.nbt` in the jar — and those are a different registry
// living in a different place. Checking them is worth more than skipping them: a village pool
// that names a piece this build cannot load is a village with a hole in it, and PLAN W15 is
// the stage that will have to load them.
//
// (`location` is also a spline node's key, where the value is a NUMBER and never reaches the
// string branch. Two unrelated meanings for one field name is exactly the hazard of a check
// driven by field names, so it is written down rather than left to be rediscovered.)
const NBT_FIELDS = new Set(['location']);
// Fields whose `minecraft:` value is a TYPE, not a reference.
const TYPE_FIELDS = new Set(['type', 'predicate_type', 'processor_type', 'rule_type',
  'block_state_provider_type', 'int_provider_type', 'float_provider_type', 'height_provider_type',
  'placement_type', 'projection', 'location_type']);

// every .nbt template the jar carries, by the id a template pool would name it with
const nbtTemplates = (() => {
  if (!existsSync(JAR)) return null;
  const jar = new Jar(JAR);
  const set = new Set();
  for (const e of jar.names()) {
    const m = /^data\/minecraft\/structures\/(.+)\.nbt$/.exec(e);
    if (m) set.add(m[1]);
  }
  return set;
})();

// ── THE BIOME TAGS (PLAN W13) ─────────────────────────────────────────────────────────────
//
// ⚠ A `configured_structure_feature`'s `biomes` field is a TAG, not a list — `mineshaft.json`
// says `"#minecraft:has_structure/mineshaft"` and nothing else — so a structure registry that
// carries the 31 configured structures and not the tags they point at knows every structure's
// spacing and no structure's biomes. W13 needs both. (D-183)
//
// ⚠ THEY ARE NOT IN THE WORLDGEN CACHE, AND THAT IS NOT AN OVERSIGHT. `.mcdata/<v>/data/
// minecraft/worldgen/` is the eleven BUILT-IN REGISTRIES; tags live in `data/minecraft/tags/`
// and are a different thing that happens to name the same entries. They are read straight out
// of the jar here — the same jar this file already opens for the .nbt template list — so they
// need no cache, no re-fetch, and no change to the 766-file count `wgcheck` pins.
//
// A tag value is either a biome id or `#`-prefixed another tag, so resolution is a fixed point
// over the whole set. `replace` is honoured for completeness even though no vanilla tag uses
// it, and a cycle is reported rather than hung on.
const tagCycles = [];
const tagDangling = [];
const biomeTags = (() => {
  if (!existsSync(JAR)) return null;
  const jar = new Jar(JAR);
  const raw = new Map();                    // "has_structure/mineshaft" -> {replace, values}
  for (const e of jar.names()) {
    const m = /^data\/minecraft\/tags\/worldgen\/biome\/(.+)\.json$/.exec(e);
    if (m) raw.set(m[1], JSON.parse(jar.readText(e)));
  }
  const done = new Map();
  const inFlight = new Set();
  const resolve = (name) => {
    if (done.has(name)) return done.get(name);
    if (inFlight.has(name)) { tagCycles.push(name); return []; }
    const node = raw.get(name);
    if (!node) { tagDangling.push(name); return []; }
    inFlight.add(name);
    const out = [];
    for (const v of node.values || []) {
      if (typeof v !== 'string') { tagDangling.push(`${name}: non-string value`); continue; }
      if (v[0] === '#') { for (const b of resolve(v.replace(/^#(minecraft:)?/, ''))) out.push(b); }
      else out.push(v.replace(/^minecraft:/, ''));
    }
    inFlight.delete(name);
    // deduplicate, keep first-seen order: a biome named twice through two nested tags is one
    // biome, and the order is what a check compares against the source files.
    const seen = new Set(); const uniq = [];
    for (const b of out) if (!seen.has(b)) { seen.add(b); uniq.push(b); }
    done.set(name, uniq);
    return uniq;
  };
  for (const name of raw.keys()) resolve(name);
  return done;
})();

// ── THE PLACEMENT SETS (PLAN G2, D-197) ───────────────────────────────────────────────────
//
// ⚠ A GRAPHICS SETTING WAS AN INPUT TO WORLDGEN, AND THE FLOOR RULE WAS A WHOLE CLASS TOO WIDE.
// `States.floorOk` read "the block below is OPAQUE" and vanilla reads `BushBlock.mayPlaceOn`,
// which is `#minecraft:dirt` or farmland. Measured in 81 chunks at seed 1337: 891 grass on
// SAND, 216 on GRAVEL, 2 on stone, 21 tall_grass on sand, and poppies, dandelions and lilies of
// the valley on both. Worse, `SR.setFastLeaves(true)` writes `SR.opaque[leaf] = 1`, so the same
// seed grew 2,050 plants at one graphics setting and 1,993 at the other — `poppy ON oak_leaves`
// among them. See D-197.
//
// ⚠ THEY RIDE `worldgen.bin` AND NOT `tags.bin`, and that is the whole reason this lives here.
// The rule is consulted by `Features.supported` — which runs on the CHUNK WORKERS — and by
// `World.canSurvive` on the main thread. `src/02f_tags.js` is main-thread only by design, so the
// workers can never see it. `src/02d_wgdata.js` is the module both threads already load, and
// D-183 already put the 42 biome tags there for exactly this reason.
//
// ── THE MAPPING IS INTERPRETIVE, SO IT IS A NAMED TABLE ───────────────────────────────────
// Which vanilla `canSurvive` a block has is compiled Java: `BushBlock`, `DeadBushBlock`,
// `MushroomBlock`, `SugarCaneBlock` and the rest override it, and no data file says which. So
// the mapping below is WRITTEN OUT, in the same spirit as `NO_RULE_BLOCKS` and `CEILING_BLOCKS`
// in `tools/pack-runtime.mjs`: a wrong list should be a visible wrong list rather than a silent
// rule. The SETS themselves are not interpretive — every one of them is a vanilla block tag,
// read out of the jar and flattened by `tools/taglib.mjs`, so a version bump moves them.
//
// `anyOpaque` is the one place a set is not the whole rule. `MushroomBlock.mayPlaceOn` is
// `#mushroom_grow_block` OR any block whose face is solid-render AND light <= 12. Worldgen
// cannot ask about light at write time (the light pass has not run), so the opaque half of the
// disjunction is kept as a fallback and the light gate is not applied. That is deliberately
// LOOSER than vanilla and is named here rather than hidden.
const PLACEMENT_SETS = {
  bush:           { tags: ['dirt'], blocks: ['farmland'] },                       // BushBlock.mayPlaceOn
  wither_rose:    { tags: ['dirt'], blocks: ['farmland', 'soul_sand', 'soul_soil', 'netherrack'] },
  dead_bush:      { tags: ['sand', 'terracotta', 'dirt'], blocks: [] },
  mushroom:       { tags: ['mushroom_grow_block'], blocks: [], anyOpaque: true },
  sugar_cane:     { tags: ['sand', 'dirt'], blocks: [] },
  cactus:         { tags: ['sand'], blocks: [] },
  bamboo:         { tags: ['bamboo_plantable_on'], blocks: [] },
  azalea:         { tags: ['azalea_grows_on'], blocks: [] },
  big_dripleaf:   { tags: ['big_dripleaf_placeable'], blocks: [] },
  small_dripleaf: { tags: ['small_dripleaf_placeable', 'dirt'], blocks: ['farmland'] },
  nether_wart:    { tags: [], blocks: ['soul_sand'] },
};
// Which blocks obey which set. `bush` is the DEFAULT for the floor-class plant family and is
// therefore given by tag — every sapling, every small flower, every tall flower — minus the
// members that have a rule of their own. `azalea` and `flowering_azalea` are in
// `#minecraft:saplings` in 1.18.2 and `wither_rose` is in `#minecraft:small_flowers`, which is
// exactly why the exclusions are listed rather than assumed.
//
// ⚠ NOT LISTED HERE, DELIBERATELY: the class-1 blocks that are not plants — torches, signs,
// banners, skulls, coral fans, the standing halves of D-167 — and the crops, the two nether
// fungi and `moss_carpet`, whose vanilla rules this table does not yet state. They carry NO
// placement set and keep the opaque floor test they have always had. Narrowing a block without
// stating its rule would delete blocks from the world, which is the failure D-152 and D-178 are.
const PLACEMENT_USERS = {
  bush:           { tags: ['saplings', 'small_flowers', 'tall_flowers'],
                    exclude: ['azalea', 'flowering_azalea', 'wither_rose'],
                    blocks: ['grass', 'fern', 'tall_grass', 'large_fern', 'sweet_berry_bush'] },
  wither_rose:    { blocks: ['wither_rose'] },
  dead_bush:      { blocks: ['dead_bush'] },
  mushroom:       { blocks: ['brown_mushroom', 'red_mushroom'] },
  sugar_cane:     { blocks: ['sugar_cane'] },
  cactus:         { blocks: ['cactus'] },
  bamboo:         { blocks: ['bamboo', 'bamboo_sapling'] },
  azalea:         { blocks: ['azalea', 'flowering_azalea'] },
  big_dripleaf:   { blocks: ['big_dripleaf', 'big_dripleaf_stem'] },
  small_dripleaf: { blocks: ['small_dripleaf'] },
  nether_wart:    { blocks: ['nether_wart'] },
};
// ── THE RULE TAGS (#19, KW-25) ────────────────────────────────────────────────────────────
// `Survive`'s rules ask ELEVEN block-tag questions and the chunk workers have no tag registry
// (02f is main-only), so worldgen answered "cannot tell" to every rule that asked one and fell
// back to the material class. These are those eleven tags, flattened out of the jar exactly as
// the placement sets are and shipped in the same payload, so a worker can answer them by block.
// A NAMED LIST, and it is asserted against the rules' own source by tools/survivegatecheck.mjs.
const RULE_TAGS = ['dirt', 'sand', 'terracotta', 'nylium', 'mushroom_grow_block', 'bamboo_plantable_on',
  'jungle_logs', 'soul_fire_base_blocks', 'big_dripleaf_placeable', 'small_dripleaf_placeable', 'fence_gates'];
const placementFails = [];
const placement = (() => {
  if (!existsSync(JAR)) return null;
  // the same reader and the same flattener `pack-tags.mjs` uses — one implementation (D-197)
  const { raw } = readRawTags(new Jar(JAR), ['blocks']);
  const { resolve } = makeTagResolver(raw);
  const tag = (n) => {
    if (!raw.has('blocks/' + n)) { placementFails.push(`#minecraft:${n} is not in the jar`); return []; }
    return resolve('blocks/' + n);
  };
  const out = {};
  for (const [rule, def] of Object.entries(PLACEMENT_SETS)) {
    const set = new Set(def.blocks);
    for (const t of def.tags) for (const b of tag(t)) set.add(b);
    if (set.size === 0 && !def.anyOpaque) placementFails.push(`placement set ${rule} is empty`);
    const users = new Set(PLACEMENT_USERS[rule].blocks || []);
    for (const t of (PLACEMENT_USERS[rule].tags || [])) for (const b of tag(t)) users.add(b);
    for (const x of (PLACEMENT_USERS[rule].exclude || [])) users.delete(x);
    if (users.size === 0) placementFails.push(`placement rule ${rule} governs no block`);
    out[rule] = { members: [...set].sort(), users: [...users].sort(), anyOpaque: !!def.anyOpaque };
  }
  // ⚠ ONE RULE PER BLOCK. Two rules claiming the same block is a table that reads one way and
  // behaves another, and the runtime would silently keep whichever it decoded last.
  const claimed = new Map();
  for (const [rule, r] of Object.entries(out)) for (const b of r.users) {
    if (claimed.has(b)) placementFails.push(`${b} is claimed by both ${claimed.get(b)} and ${rule}`);
    claimed.set(b, rule);
  }
  return out;
})();

const ruleTags = (() => {
  if (!existsSync(JAR)) return null;
  const { raw } = readRawTags(new Jar(JAR), ['blocks']);
  const { resolve } = makeTagResolver(raw);
  const out = {};
  for (const n of RULE_TAGS) {
    if (!raw.has('blocks/' + n)) { placementFails.push(`rule tag #minecraft:${n} is not in the jar`); continue; }
    out[n] = [...resolve('blocks/' + n)].sort();
    if (!out[n].length) placementFails.push(`rule tag #minecraft:${n} is empty`);
  }
  return out;
})();

const blockNames = (() => {
  const p = join(OUT, 'block-registry.json');
  if (!existsSync(p)) return null;
  return new Set(JSON.parse(readFileSync(p, 'utf8')).map((e) => e.name));
})();

// ── THE BLOCK-STATE RESOLVER (PLAN W6) ────────────────────────────────────────────────────
// The worldgen data names block STATES, not blocks: a surface rule places
// `{Name: "minecraft:deepslate", Properties: {axis: "y"}}` and a feature places an oak log on
// its side. The runtime cannot resolve that itself — the registry deliberately does not carry
// property NAMES (900 blocks of them is 40 KB nobody else needs, see States.withLocal) — so the
// name-plus-properties to LOCAL STATE INDEX map is resolved here and shipped beside the tree.
//
// Vanilla's state ordering, which this arithmetic has to match exactly: properties in
// DECLARATION order with the LAST varying fastest, and each property's values in the order the
// block declares them — which for a boolean is [true, false], not alphabetical. That ordering
// comes from `block-constants.json`'s `props`, which is minecraft-data's and is vanilla's.
// ⚠ It is NOT `block-registry.json`'s `properties`, which are the BLOCKSTATES file's and are
// alphabetically sorted — using those would resolve `powered=false` to index 0 instead of 1 and
// place a subtly wrong state everywhere a property appears.
//
// The arithmetic is proved rather than asserted by inspection: every block's full property
// space is enumerated and its size must equal the block's own `stateCount`, which is only true
// if the strides are right, and every default state resolved back must equal `defaultState`.
const blockProps = (() => {
  const p = join(OUT, 'block-constants.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')).blocks;
})();

// ⚠ THE RESOLVER MOVED TO `tools/statelib.mjs` (D-186). It is the same arithmetic, in one
// place, because PLAN W15's structure templates name 1,047 block states of their own and need
// exactly this answer — and D-164's lesson is that a rule with two implementations is a rule
// with two answers. `assets/worldgen.bin` is byte-for-byte what it was before the move, which
// is the only evidence that matters for a refactor of a build stage.
const RES = makeResolver(blockProps);
const stateKey = RES.stateKey;
const stateFails = RES.fails;
const resolveLocal = RES.resolveLocal;
const strideChecked = RES.verify();

const blockStates = new Map();    // canonical key -> local state index

const types = {};                 // registry -> { type -> count }
const dangling = [];
const unknownBlocks = new Map();
const refCounts = { resolved: 0, blocks: 0, types: 0, other: 0, nbt: 0, nbtUnchecked: 0 };
const otherIds = new Map();

const short = (s) => (s.startsWith('minecraft:') ? s.slice(10) : s);

function scan(reg, name, node, key, path) {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) scan(reg, name, node[i], key, path + '[' + i + ']');
    return;
  }
  if (node && typeof node === 'object') {
    if (typeof node.type === 'string') {
      const t = short(node.type);
      (types[reg] || (types[reg] = {}))[t] = ((types[reg] || {})[t] || 0) + 1;
    }
    // a block STATE: `{Name, Properties?}`. Resolved to a local index here — see the note above
    // the resolver on why the runtime cannot do it.
    if (typeof node.Name === 'string' && node.Name.indexOf(':') > 0) {
      const k = stateKey(node);
      if (!blockStates.has(k)) blockStates.set(k, resolveLocal(node));
    }
    for (const k of Object.keys(node)) scan(reg, name, node[k], k, path + '.' + k);
    return;
  }
  if (typeof node !== 'string') return;

  // ⚠ A spline node's `location` is a NUMBER, and a template pool element's is a STRUCTURE
  // NAME, and both are spelled `location`. Only the string form reaches here, so the collision
  // is harmless — but it is exactly the kind of thing that makes a field-name-driven check
  // wrong, so it is written down rather than left to be rediscovered.
  if (TYPE_FIELDS.has(key)) { refCounts.types++; return; }
  if (!node.startsWith('minecraft:') && !REF_FIELDS[key] && !NBT_FIELDS.has(key)) return;

  const id = short(node);

  if (NBT_FIELDS.has(key)) {
    if (!nbtTemplates) { refCounts.nbtUnchecked++; return; }
    if (nbtTemplates.has(id)) { refCounts.nbt++; return; }
    dangling.push(`${reg}/${name}${path}: "${node}" is not a structure template in the jar`);
    return;
  }

  const targets = REF_FIELDS[key];

  if (targets && targets.length) {
    for (const r of targets) if (registry[r] && registry[r][id] !== undefined) { refCounts.resolved++; return; }
    // an inline definition rather than a reference is legal in several of these fields
    if (!node.startsWith('minecraft:')) return;
    dangling.push(`${reg}/${name}${path}: "${node}" does not resolve in ${targets.join(' or ')}`);
    return;
  }

  if (!node.startsWith('minecraft:')) return;
  if (blockNames && blockNames.has(id)) { refCounts.blocks++; return; }
  // anything else: an item, an entity, a tag, a sound, a structure id. Counted by name so the
  // report says what they are rather than how many there were.
  refCounts.other++;
  otherIds.set(id, (otherIds.get(id) || 0) + 1);
  if (key === 'Name' || key === 'block' || key === 'state') {
    unknownBlocks.set(id, (unknownBlocks.get(id) || 0) + 1);
  }
}

for (const reg of REGISTRIES) {
  for (const [name, value] of Object.entries(registry[reg])) scan(reg, name, value, '', '');
}

// ---------------------------------------------------------------- intern and pack
// One table for every distinct string in the corpus, keys included. Values become
// `["$", index]` — a two-element array with a sentinel — so the decoder can tell an interned
// string from a real one without a second pass.
const pool = new Map();
const intern = (s) => {
  let i = pool.get(s);
  if (i === undefined) { i = pool.size; pool.set(s, i); }
  return i;
};

function packNode(node) {
  if (Array.isArray(node)) return node.map(packNode);
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) out[intern(k)] = packNode(node[k]);
    return out;
  }
  if (typeof node === 'string') return { s: intern(node) };
  return node;
}

const packed = {};
for (const reg of REGISTRIES) {
  packed[reg] = {};
  for (const [name, value] of Object.entries(registry[reg])) packed[reg][intern(name)] = packNode(value);
}
// The state table rides in the blob as two parallel arrays: the interned key and the local
// index. `NS.WG` turns it back into a map at init.
const bsKeys = [...blockStates.keys()].sort();
const bsLocal = bsKeys.map((k) => blockStates.get(k));
const bs = { k: bsKeys.map((k) => intern(k)), l: bsLocal };
if (bsLocal.some((v) => v < 0)) stateFails.push(`${bsLocal.filter((v) => v < 0).length} block states did not resolve`);

// ⚠ THE TAGS RIDE IN THE SAME STRING POOL (D-183). A tag's values are biome ids that are
// already interned by the biome registry, so 32 tags and their 270 entries cost indices and
// not bytes. `tg` is name index -> array of biome-name indices, fully resolved: the runtime
// never sees a `#` and never walks a tag graph.
const tg = {};
if (biomeTags) for (const [name, list] of biomeTags) tg[intern(name)] = list.map((b) => intern(b));

// ⚠ AND SO DO THE PLACEMENT SETS (D-197), in the same pool and for the same reason: every one
// of their members is a block name the feature registry already interned. `pm` is rule -> the
// block names it accepts as a floor, `pu` is rule -> the blocks that obey it, `po` the rules
// that also accept any opaque block. Three flat arrays of indices; the runtime never sees a `#`.
const pm = {}, pu = {}, po = [];
if (placement) for (const [rule, r] of Object.entries(placement)) {
  const ri = intern(rule);
  pm[ri] = r.members.map((b) => intern(b));
  pu[ri] = r.users.map((b) => intern(b));
  if (r.anyOpaque) po.push(ri);
}

const rt = {};
if (ruleTags) for (const [n, l] of Object.entries(ruleTags)) rt[intern(n)] = l.map((b) => intern(b));

const strings = [...pool.keys()];
const blob = JSON.stringify({ v: VERSION, s: strings, r: packed, bs: bs, tg: tg, pm: pm, pu: pu, po: po, rt: rt });
const deflated = deflateRawSync(Buffer.from(blob, 'utf8'), { level: 9 });

// ⚠ Round trip before writing. A blob that does not inflate back to itself is a blob that
// fails at boot on a player's machine instead of here.
const back = inflateRawSync(deflated).toString('utf8');
if (back !== blob) { console.error('FATAL: worldgen blob does not round-trip through deflate'); process.exit(1); }

writeFileSync(join(OUT, 'worldgen.bin'), deflated);
writeFileSync(join(OUT, 'worldgen.meta.json'), JSON.stringify({
  version: VERSION, files, rawBytes, jsonBytes: blob.length, packedBytes: deflated.length,
  strings: strings.length, blockStates: bsKeys.length,
  blockStatesWithProps: bsKeys.filter((k) => k.indexOf('|') >= 0).length,
  biomeTags: biomeTags ? biomeTags.size : 0,
  biomeTagEntries: biomeTags ? [...biomeTags.values()].reduce((a, l) => a + l.length, 0) : 0,
  placementRules: placement ? Object.keys(placement).length : 0,
  placementMembers: placement ? Object.values(placement).reduce((a, r) => a + r.members.length, 0) : 0,
  placementUsers: placement ? Object.values(placement).reduce((a, r) => a + r.users.length, 0) : 0,
  counts: Object.fromEntries(REGISTRIES.map((r) => [r, Object.keys(registry[r]).length])),
}));

const report = {
  version: VERSION, files, rawBytes, jsonBytes: blob.length, packedBytes: deflated.length,
  strings: strings.length,
  counts: Object.fromEntries(REGISTRIES.map((r) => [r, Object.keys(registry[r]).length])),
  refs: refCounts,
  nbtTemplatesInJar: nbtTemplates ? nbtTemplates.size : null,
  biomeTags: biomeTags ? biomeTags.size : 0,
  biomeTagEntries: biomeTags ? [...biomeTags.values()].reduce((a, l) => a + l.length, 0) : 0,
  biomeTagCycles: tagCycles,
  biomeTagDangling: tagDangling,
  placement: placement
    ? Object.fromEntries(Object.entries(placement).map(([k, r]) =>
        [k, { members: r.members, users: r.users, anyOpaque: r.anyOpaque }]))
    : null,
  placementFails,
  ruleTags: ruleTags ? Object.fromEntries(Object.entries(ruleTags).map(([k, l]) => [k, l.length])) : null,
  danglingCount: dangling.length,
  dangling: dangling.slice(0, 40),
  types,
  // the ids that are not blocks and not references: items, entities, tags, sounds, structures
  otherIds: Object.fromEntries([...otherIds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 60)),
  otherIdCount: otherIds.size,
  ms: Date.now() - t0,
};
writeFileSync(join(OUT, 'worldgen-report.json'), JSON.stringify(report, null, 2));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ pack-worldgen ================');
console.log(` files ............. ${files}   ${kb(rawBytes)} of source JSON`);
for (const r of REGISTRIES) console.log(`   ${r.padEnd(30)} ${String(Object.keys(registry[r]).length).padStart(4)}`);
console.log('');
console.log(` interned strings .. ${strings.length}`);
console.log(` packed ............ ${kb(blob.length)} minified -> ${kb(deflated.length)} deflated`);
console.log(`                     ${kb(deflated.length * 4 / 3)} as base64 in the file`);
console.log('');
console.log(` block states ...... ${bsKeys.length} distinct  (${bsKeys.filter((k) => k.indexOf('|') >= 0).length} with properties, ${strideChecked} blocks' state spaces verified)`);
for (const f of stateFails.slice(0, 10)) console.log('   ! ' + f);
console.log(` references ........ ${refCounts.resolved} into these registries · ${refCounts.blocks} block ids · ${refCounts.types} types`);
console.log(` biome tags ........ ${biomeTags ? biomeTags.size : 0} resolved, ${biomeTags ? [...biomeTags.values()].reduce((a, l) => a + l.length, 0) : 0} biome entries (W13)`);
for (const d of tagDangling.slice(0, 5)) console.log('   ! tag names ' + d);
for (const c of tagCycles.slice(0, 5)) console.log('   ! tag cycle at ' + c);
console.log(` placement sets .... ${placement ? Object.keys(placement).length : 0} rules, ${placement ? Object.values(placement).reduce((a, r) => a + r.members.length, 0) : 0} floor members, ${placement ? Object.values(placement).reduce((a, r) => a + r.users.length, 0) : 0} blocks governed (D-197)`);
for (const f of placementFails.slice(0, 8)) console.log('   ! ' + f);
console.log(` other ids ......... ${otherIds.size} distinct (items, entities, tags, sounds)`);
console.log(` DANGLING .......... ${dangling.length}`);
for (const d of dangling.slice(0, 10)) console.log('   ! ' + d);
console.log('');
for (const r of REGISTRIES) {
  const t = types[r];
  if (!t) continue;
  const n = Object.keys(t).length;
  console.log(` ${r.padEnd(30)} ${String(n).padStart(3)} distinct types`);
}
console.log('');
console.log(` ${Date.now() - t0} ms  ->  ${join(OUT, 'worldgen.bin')}`);
console.log('===============================================');

// PLAN W1: "a non-zero count fails the build."
process.exit(dangling.length + stateFails.length + tagDangling.length + tagCycles.length + placementFails.length ? 1 : 0);
