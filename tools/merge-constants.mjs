#!/usr/bin/env node
// merge-constants.mjs — PLAN F7. Turn the block registry into a registry that knows physics.
//
//   node tools/merge-constants.mjs [--jar ...] [--pc <project>/.mcdata/pc] [--out assets]
//
// The registry from extract-blocks.mjs knows what every block LOOKS like. It knows nothing
// about how hard it is, what breaks it, what it drops, how much light it lets through, or
// what shape you bump into. This merges that in, from four sources, and — more importantly —
// it makes those sources CHECK EACH OTHER.
//
// ⚠ THE FINDING THAT SHAPES THIS FILE (PLAN §1.3 / D-29):
//   Blockstates JSON describes only what is VISUAL. `waterlogged` on a slab and `powered`
//   on a door are absent from it, because neither changes the model. So the state space in
//   block-registry.json is a LOWER BOUND, not the truth.
//   `minecraft-data`'s blocks.json carries the REAL state space. Therefore:
//     - the authoritative property list per block comes from blocks.json
//     - the visual state space is a PROJECTION of it
//     - every real state maps to exactly one visual state, never the reverse
//   Getting this backwards means waterlogged slabs share one collision shape with dry ones
//   (harmless) but also means `powered` doors silently collapse into one state (not harmless).
//
// ⚠ THE SECOND FINDING (PLAN §1.5):
//   Real VoxelShapes are available per state — 898 blocks, 4105 distinct shapes. An earlier
//   plan budgeted a hand-written exception table of ~60 blocks over a union-of-elements
//   derivation. That work is unnecessary and is NOT done here.
//
// What is still derived rather than fetched is the OCCLUSION MASK: a 6-bit per visual state
// saying which faces present a full 16x16 surface. It is derived from the model elements,
// because occlusion is a question about the VISUAL geometry, not the collision geometry —
// a fence's collision box is 1.5 blocks tall and occludes nothing.
// It is then CROSS-EXAMINED against the collision data, which is the only place these two
// independent sources can catch each other for free.

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Jar } from './jarlib.mjs';
import { resolveModel, groupsFor, parseBlockstate, rotateBox, DIRS } from './models.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator
// Jars are Dan's own copies of the game and are NOT in the repo (D-6), so their location is a
// property of the machine, not the project. `--jar` still wins; MCLITE_JARS moves the default.
import { existsSync } from 'node:fs';
import { JARS as MCLITE_JARS, MCDATA_PC } from './paths.mjs';
/* MCLITE_JARS now comes from tools/paths.mjs (session 5) */
// Two layouts are accepted, because Dan's jars live in a launcher directory and the build
// machine's live in a flat one: <JARS>/1.18.2.jar and <JARS>/1.18.2/1.18.2.jar. Point
// MCLITE_JARS at a .minecraft `versions` folder and it just works.
const jarPath = (v) => {
  const flat = MCLITE_JARS + '/' + v + '.jar';
  const nested = MCLITE_JARS + '/' + v + '/' + v + '.jar';
  return existsSync(flat) ? flat : (existsSync(nested) ? nested : flat);
};


const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const JAR = opt('jar', jarPath('1.18.2'));
const PC = opt('pc', MCDATA_PC);
const OUT = opt('out', MCLITE_ROOT + 'assets');
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jar = new Jar(JAR);
const rj = (p) => JSON.parse(readFileSync(join(PC, p), 'utf8'));
const pcBlocks = rj('blocks.json');
const pcShapes = rj('blockCollisionShapes.json');
const pcItems = rj('items.json');
const pcMaterials = rj('materials.json');
// See the long note in fetch-vanilla-data.mjs: 1.18's blocks.json zeroes hardness and
// resistance for the 122 blocks added in 1.17. 1.19's has them and agrees with 1.18 on all
// 658 blocks where 1.18 has a value, so it is read ONLY as a patch and only for a 0/null.
const pc119 = new Map(rj('blocks119.json').map((b) => [b.name, b]));

const byName = new Map(pcBlocks.map((b) => [b.name, b]));

// ---------------------------------------------------------------- hardness patch (D-108)
// `unbreakable` is `null` in 1.18 and `-1` in 1.19; both mean the same thing and neither is a
// number a break timer can divide by, so the merged form is an explicit `null`.
const patchStats = { patched: [], leftZero: [], agree: 0, disagree: [] };
function hardnessOf(pc) {
  const later = pc119.get(pc.name);
  const norm = (v) => (v === null || v === undefined || v === -1 ? null : v);
  const mine = norm(pc.hardness), theirs = later ? norm(later.hardness) : undefined;
  // The agreement check that licenses the patch — recomputed every run, not trusted.
  // ⚠ `mine === 0` is excluded: zero is the HOLE, not a value, so comparing it would count
  // every block the patch exists for as a disagreement and hide a real one among them.
  if (mine !== null && mine !== 0 && theirs !== undefined) {
    if (mine === theirs) patchStats.agree++;
    else patchStats.disagree.push(`${pc.name} 1.18=${mine} 1.19=${theirs}`);
  }
  if (mine === null && pc.hardness === null) return { hardness: null, resistance: pc.resistance };
  if (mine === 0 && theirs) {
    patchStats.patched.push(`${pc.name} 0 -> ${theirs}`);
    return { hardness: theirs, resistance: later.resistance ?? pc.resistance };
  }
  // Blocks whose real hardness IS zero (flower pots, tnt, lily pad, sea pickle, slime and
  // honey blocks, comparators, scaffolding, azalea). Recorded so the count is a fact rather
  // than an assumption; constcheck pins it.
  if (mine === 0) patchStats.leftZero.push(pc.name);
  return { hardness: mine, resistance: pc.resistance };
}

// ---------------------------------------------------------------- the harvest bracket
// ⚠ THIS IS THE NUMBER `docs/archive/NEXT.md` CALLED HOMEWORK (D-102), and the answer was in the data all
// along under a name nobody had looked at.
//
// Vanilla's break time by hand is `hardness * (the tool can harvest it ? 30 : 100) / 20`
// seconds. The bracket is vanilla's `requiresCorrectToolForDrops`, which is set in Java and
// is NOT `needsTier` (null for stone, dirt and oak_log alike) and NOT `mineable/pickaxe`
// (which contains rails and ice, both of which drop bare-handed).
//
// minecraft-data carries it as `harvestTools`: the map is PRESENT exactly when the block
// requires a correct tool for drops, and absent otherwise. Checked block by block:
//   stone yes · iron_bars yes · coal_ore yes · obsidian yes · cobweb yes
//   dirt no · oak_log no · rail no · ICE NO · GLASS NO
// — including both blocks NEXT.md named as the ones a `mineable/pickaxe` proxy gets wrong.
//
// It is proven, not assumed: with this bracket the derived break time reproduces the
// hand-written legacy table for all 12 blocks that previously disagreed (stone 7.5 s,
// cobblestone 10 s, deepslate 15 s, coal_ore 15 s, deepslate_coal_ore 22.5 s ...), which is
// twelve independent confirmations from a table written months earlier by hand.
const requiresTool = (pc) => !!(pc.harvestTools && Object.keys(pc.harvestTools).length);
const registry = JSON.parse(readFileSync(join(OUT, 'block-registry.json'), 'utf8'));

// ---------------------------------------------------------------- tool tags
// These ARE in the jar and are exact, so they are preferred over minecraft-data's
// `material` string, which is a lossy summary of the same thing.
function tagSet(path) {
  if (!jar.has(path)) return new Set();
  const out = new Set();
  const walk = (p) => {
    if (!jar.has(p)) return;
    for (const v of jar.readJson(p).values || []) {
      const s = typeof v === 'string' ? v : v.id;
      if (!s) continue;
      if (s.startsWith('#')) walk(`data/minecraft/tags/blocks/${s.slice(1).replace('minecraft:', '')}.json`);
      else out.add(s.replace('minecraft:', ''));
    }
  };
  walk(path);
  return out;
}
const T = (n) => tagSet(`data/minecraft/tags/blocks/${n}.json`);
const mineable = {
  pickaxe: T('mineable/pickaxe'), axe: T('mineable/axe'),
  shovel: T('mineable/shovel'), hoe: T('mineable/hoe'),
};
const needs = { stone: T('needs_stone_tool'), iron: T('needs_iron_tool'), diamond: T('needs_diamond_tool') };

// ---------------------------------------------------------------- lang
let lang = {};
if (jar.has('assets/minecraft/lang/en_us.json')) lang = jar.readJson('assets/minecraft/lang/en_us.json');

// ---------------------------------------------------------------- state maths
// Vanilla state ordering: properties in declaration order, LAST property varies fastest.
// Boolean properties enumerate as [true, false] — that order is not arbitrary and getting
// it backwards silently swaps every waterlogged shape with its dry twin.
function pcValues(st) {
  if (st.type === 'bool') return ['true', 'false'];
  if (st.type === 'enum') return st.values.map(String);
  if (st.type === 'int') return Array.from({ length: st.num_values }, (_, i) => String(i));
  throw new Error('unknown property type ' + st.type);
}
function enumeratePc(states) {
  let rows = [{}];
  for (const st of states) {
    const vals = pcValues(st);
    const next = [];
    for (const r of rows) for (const v of vals) next.push({ ...r, [st.name]: v });
    rows = next;
  }
  return rows;                        // index === the block's local state index
}

// ---------------------------------------------------------------- occlusion
// A face is occluding iff the union of element faces on that plane covers the full 16x16.
// Computed with an exact 16x16 boolean grid rather than an interval test, because unions of
// several partial boxes (a wall's post plus its arms) are exactly the case an interval test
// gets wrong.
// ⚠ The max-side plane is 16, NOT 15. Model space is 0..16 across a block; a full cube's
// `to` is [16,16,16]. Writing 15 here silently makes up/south/east never occlude, which
// showed up as `fully-occluding = 0 states` on the first run of this file — a number that
// is obviously wrong for a game made of stone, and the only reason it was caught.
const AXIS = { down: [1, 0], up: [1, 16], north: [2, 0], south: [2, 16], west: [0, 0], east: [0, 16] };
function occlusionMask(parts) {
  let mask = 0;
  for (let d = 0; d < 6; d++) {
    const dir = DIRS[d];
    const [ax, plane] = AXIS[dir];
    const grid = new Uint8Array(256);
    for (const { model, x, y } of parts) {
      for (const el of model.elements) {
        // an element with a non-axis-aligned rotation cannot be trusted to tile a face
        if (el.rotation && el.rotation.angle) continue;
        const [lo, hi] = rotateBox(el.from, el.to, x || 0, y || 0);
        const at = plane === 0 ? lo[ax] : hi[ax];
        if (Math.abs(at - plane) > 1e-6) continue;         // does not touch this face
        const o = [0, 1, 2].filter((i) => i !== ax);
        const u0 = Math.max(0, Math.round(lo[o[0]])), u1 = Math.min(16, Math.round(hi[o[0]]));
        const v0 = Math.max(0, Math.round(lo[o[1]])), v1 = Math.min(16, Math.round(hi[o[1]]));
        for (let v = v0; v < v1; v++) for (let u = u0; u < u1; u++) grid[v * 16 + u] = 1;
      }
    }
    let full = true;
    for (let i = 0; i < 256; i++) if (!grid[i]) { full = false; break; }
    if (full) mask |= 1 << d;
  }
  return mask;
}

// ---------------------------------------------------------------- merge
const modelCache = new Map();
// #577: literal .luminance(n) in Blocks.java that the PrismarineJS data lacks (lightluminancecheck compares all)
const LUMINANCE_FIX = { enchanting_table: 7 };
const out = {};
const report = {
  blocks: 0, statesReal: 0, statesVisual: 0,
  noPcEntry: [], noCollision: [], noHardness: [],
  occlusionFullCubes: 0, occlusionDisagreements: [], occlusionByMask: {},
  toolCounts: {}, unmapped: [],
};

for (const entry of registry) {
  const name = entry.name;
  const pc = byName.get(name);
  if (!pc) { report.noPcEntry.push(name); continue; }

  const pcStates = enumeratePc(pc.states || []);
  const coll = pcShapes.blocks[name];
  if (coll === undefined) report.noCollision.push(name);
  const HR = hardnessOf(pc);
  if (HR.hardness === null) report.noHardness.push(name);

  // visual states, keyed canonically so a real state can find its visual twin
  const visKeys = Object.keys(entry.properties);
  const key = (st) => visKeys.map((k) => `${k}=${st[k]}`).join(',');
  const visIndex = new Map();
  entry.states.forEach((s, i) => visIndex.set(key(s.state), i));

  // occlusion per VISUAL state (occlusion is a question about visible geometry)
  const bs = parseBlockstate(jar.readJson(`assets/minecraft/blockstates/${name}.json`));
  // ⚠ ONE alternative per group, not all of them. A `variants` list is a random one-of
  // (stone has four), and unioning them would let a block claim occlusion it only has in
  // some of its random forms. See groupsFor() in models.mjs. Harmless for stone, which is
  // a full cube four ways; not harmless in general, and free to get right.
  const occl = entry.states.map((s) => {
    const parts = groupsFor(bs, s.state).map((g) => g[0]).map((p) => ({
      model: resolveModel(jar, p.model, modelCache), x: p.x || 0, y: p.y || 0,
    }));
    return occlusionMask(parts);
  });

  // map every REAL state onto its visual twin
  const toVisual = pcStates.map((rs) => {
    const k = visKeys.map((vk) => `${vk}=${rs[vk]}`).join(',');
    const i = visIndex.get(k);
    if (i === undefined) { report.unmapped.push(`${name}[${JSON.stringify(rs)}]`); return 0; }
    return i;
  });

  const tools = Object.entries(mineable).filter(([, s]) => s.has(name)).map(([t]) => t);
  for (const t of tools) report.toolCounts[t] = (report.toolCounts[t] || 0) + 1;
  const tier = needs.diamond.has(name) ? 'diamond' : needs.iron.has(name) ? 'iron'
    : needs.stone.has(name) ? 'stone' : null;

  out[name] = {
    id: pc.id,
    displayName: lang[`block.minecraft.${name}`] || pc.displayName,
    hardness: HR.hardness, resistance: HR.resistance,
    // true = does not drop bare-handed, and therefore breaks at the 100-tick rate (see above)
    requiresTool: requiresTool(pc),
    emitLight: LUMINANCE_FIX[name] ?? pc.emitLight, filterLight: pc.filterLight,
    transparent: pc.transparent, boundingBox: pc.boundingBox,
    stackSize: pc.stackSize, material: pc.material, diggable: pc.diggable,
    tools, needsTier: tier,
    lootTable: jar.has(`data/minecraft/loot_tables/blocks/${name}.json`) ? name : null,
    props: (pc.states || []).map((s) => ({ name: s.name, type: s.type, values: pcValues(s) })),
    stateCount: pcStates.length,
    defaultState: pc.defaultState - pc.minStateId,
    collision: Array.isArray(coll) ? coll : new Array(pcStates.length).fill(coll ?? 0),
    toVisual,
    occlusion: occl,
  };

  // ---- the cross-examination. Two independent sources, one question.
  for (let i = 0; i < pcStates.length; i++) {
    const shape = pcShapes.shapes[String(out[name].collision[i])] || [];
    const isFullCollision = shape.length === 1 && shape[0][0] === 0 && shape[0][1] === 0
      && shape[0][2] === 0 && shape[0][3] === 1 && shape[0][4] === 1 && shape[0][5] === 1;
    const mask = occl[toVisual[i]];
    if (isFullCollision && mask !== 0b111111) {
      // a solid 1x1x1 collision box that the model does not fill on all six sides.
      // Legitimate for translucent blocks (glass, ice, leaves) — those occlude nothing by
      // material, not by geometry. Anything else is a defect worth reading.
      if (!pc.transparent) report.occlusionDisagreements.push(`${name}[${i}] solid collision, mask=${mask.toString(2).padStart(6, '0')}`);
    }
    if (mask === 0b111111) report.occlusionFullCubes++;
  }
  for (const m of occl) report.occlusionByMask[m] = (report.occlusionByMask[m] || 0) + 1;

  report.blocks++;
  report.statesReal += pcStates.length;
  report.statesVisual += entry.states.length;
}

// shapes are shared across every block; carry only the ones actually referenced
const usedShapes = new Set();
for (const b of Object.values(out)) for (const c of b.collision) usedShapes.add(String(c));
const shapes = {};
for (const k of usedShapes) shapes[k] = pcShapes.shapes[k];

// ---------------------------------------------------------------- G4 physics (D-250)
// ⚠ FRICTION, speedFactor AND jumpFactor ARE COMPILED JAVA — they are fields on
// `BlockBehaviour`, in no JSON and in no `minecraft-data` file, and the project's rule is that a
// constant comes from vanilla's data, bytecode or golden world and never from memory. They are
// reflected out of the verified 1.18.2 server jar through Mojang's official mappings, the same
// route D-229 opened for the noise stack, and the dump is committed at
// `tools/golden/physics-1.18.2.tsv`. Seven blocks of 898 differ from the defaults; the point of
// sourcing them is not the seven values but that nobody has to trust this file about them.
// The same dump carries each block's SoundType by name — G13's hand-table, already solved — and
// it is written into the JSON here without being shipped in the runtime until G13 wants it.
const physReport = { rows: 0, matched: 0, missing: [], exceptions: 0, soundTypes: 0 };
{
  const GOLD = join(MCLITE_ROOT, 'tools', 'golden', 'physics-1.18.2.tsv');
  const raw = readFileSync(GOLD, 'utf8');
  const gold = new Map(), sound = {}, soundNames = [];
  for (const line of raw.split(/\r?\n/)) {
    const c = line.split('\t');
    if (c[0] !== 'BLOCK') continue;
    physReport.rows++;
    const name = c[1].replace(/^minecraft:/, '');
    gold.set(name, { friction: +c[2], speedFactor: +c[3], jumpFactor: +c[4], sound: c[5] });
  }
  const exceptions = {};
  for (const name of Object.keys(out)) {
    const g = gold.get(name);
    if (!g) { physReport.missing.push(name); continue; }
    physReport.matched++;
    out[name].friction = g.friction;
    out[name].speedFactor = g.speedFactor;
    out[name].jumpFactor = g.jumpFactor;
    if (g.friction !== 0.6 || g.speedFactor !== 1 || g.jumpFactor !== 1) {
      const e = {};
      if (g.friction !== 0.6) e.friction = g.friction;
      if (g.speedFactor !== 1) e.speedFactor = g.speedFactor;
      if (g.jumpFactor !== 1) e.jumpFactor = g.jumpFactor;
      exceptions[name] = e;
    }
    let si = soundNames.indexOf(g.sound);
    if (si < 0) { si = soundNames.length; soundNames.push(g.sound); }
    sound[name] = si;
  }
  physReport.exceptions = Object.keys(exceptions).length;
  physReport.soundTypes = soundNames.length;
  // ⚠ COVERAGE IS THE ASSERTION, not the seven values. A golden file that has drifted from the
  // roster would otherwise silently give every unmatched block the defaults — which is exactly
  // what "ice is not slippery" looks like from the outside.
  if (physReport.missing.length > 4) {
    console.error(`merge-constants: ${physReport.missing.length} blocks are missing from the physics golden file` +
      ` (${physReport.missing.slice(0, 8).join(' ')}) — regenerate it from the jar`);
    process.exit(1);
  }
  const poses = raw.split(/\r?\n/).filter((l) => l.startsWith('POSE\t')).map((l) => {
    const c = l.split('\t'); return { ordinal: +c[1], name: c[2], width: +c[3], height: +c[4], fixed: c[5] === 'true' };
  });
  const attrs = raw.split(/\r?\n/).filter((l) => l.startsWith('ATTR\t')).map((l) => l.split('\t').slice(1));
  writeFileSync(join(OUT, 'block-physics.json'), JSON.stringify({
    source: 'tools/golden/physics-1.18.2.tsv (1.18.2 server jar, Mojang mappings — D-250)',
    defaults: { friction: 0.6, speedFactor: 1, jumpFactor: 1 },
    exceptions, poses, attrs, soundNames, sound,
  }));
}

// ------------------------------------------------------- G-phase placement: canBeReplaced (D-263)
// ⚠ `Material.isReplaceable()` IS COMPILED JAVA, and guessing it is what D-263 is about. Until
// session 9 `14_player.js` derived it from geometry — "a model, no collision, no light" — which
// made 139 blocks replaceable where vanilla has 28: fence gates, buttons, pressure plates, rails,
// levers, saplings, flowers, corals, cobweb, sugar cane, crops. Placing a block on any of them
// deleted it. The table now comes out of the jar's bytecode, through
// `tools/extract-materials.mjs`, and COVERAGE IS THE ASSERTION — the same argument the physics
// block above makes, because a golden file that has drifted would quietly give every unmatched
// block the default and that reads exactly like the bug it replaced.
const matReport = { rows: 0, matched: 0, missing: [], replaceable: 0 };
{
  const GOLD = join(MCLITE_ROOT, 'tools', 'golden', 'block-materials-1.18.2.tsv');
  const gold = new Map();
  for (const line of readFileSync(GOLD, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length < 3) continue;
    matReport.rows++;
    gold.set(c[0].replace(/^minecraft:/, ''), { material: c[1], replaceable: c[2] === '1' });
  }
  for (const name of Object.keys(out)) {
    const g = gold.get(name);
    if (!g) { matReport.missing.push(name); continue; }
    matReport.matched++;
    // ⚠ NOT `material`. That key is already minecraft-data's own, and `pack-runtime.mjs`'s
    // support class (D-140) reads it — `material` containing "plant" is what makes a flower a
    // FLOOR-supported block. Session 9 overwrote it with the obfuscated Material field name for
    // one build and the suite caught it as 25 floating plants in `floatcheck` and three refused
    // placements that wrote anyway in `fuzzcheck`. A new fact gets a new key.
    out[name].vanillaMaterial = g.material;
    out[name].replaceable = g.replaceable;
    if (g.replaceable) matReport.replaceable++;
  }
  if (matReport.missing.length > 4) {
    console.error(`merge-constants: ${matReport.missing.length} blocks are missing from the material golden file` +
      ` (${matReport.missing.slice(0, 8).join(' ')}) — run tools/extract-materials.mjs`);
    process.exit(1);
  }
  // The count is not a magic number: it is what the extractor's own two-directional assertion
  // produced, and a build that silently moved it has changed what a placed block destroys.
  if (matReport.replaceable !== 28) {
    console.error(`merge-constants: ${matReport.replaceable} replaceable blocks, expected 28 (D-263)`);
    process.exit(1);
  }
}

writeFileSync(join(OUT, 'block-constants.json'), JSON.stringify({ blocks: out, shapes }));
const summary = {
  ...report,
  noPcEntryCount: report.noPcEntry.length,
  noCollisionCount: report.noCollision.length,
  noHardnessCount: report.noHardness.length,
  unmappedCount: report.unmapped.length,
  unmapped: report.unmapped.slice(0, 30),
  occlusionDisagreementsCount: report.occlusionDisagreements.length,
  occlusionDisagreements: report.occlusionDisagreements.slice(0, 40),
  shapesUsed: usedShapes.size, shapesTotal: Object.keys(pcShapes.shapes).length,
  hardnessPatched: patchStats.patched.length,
  hardnessPatchedList: patchStats.patched,
  hardnessLeftZero: patchStats.leftZero.length,
  hardnessLeftZeroList: patchStats.leftZero,
  hardnessAgree: patchStats.agree,
  hardnessDisagree: patchStats.disagree,
  requiresToolCount: Object.values(out).filter((b) => b.requiresTool).length,
  materialRows: matReport.rows, materialMatched: matReport.matched,
  materialMissing: matReport.missing.length, replaceableBlocks: matReport.replaceable,
  items: pcItems.length, materials: Object.keys(pcMaterials).length,
  ms: Date.now() - t0,
};
writeFileSync(join(OUT, 'constants-report.json'), JSON.stringify(summary, null, 2));

console.log('');
console.log('================ merge-constants ================');
console.log(` blocks merged ....... ${report.blocks} / ${registry.length}`);
console.log(` real states ......... ${report.statesReal}   (visual: ${report.statesVisual})`);
console.log(` collision shapes .... ${usedShapes.size} used of ${Object.keys(pcShapes.shapes).length}`);
console.log('');
console.log(` no minecraft-data ... ${report.noPcEntry.length}  ${report.noPcEntry.slice(0, 6).join(' ')}`);
console.log(` no collision ........ ${report.noCollision.length}  ${report.noCollision.slice(0, 6).join(' ')}`);
console.log(` no hardness ......... ${report.noHardness.length}  ${report.noHardness.slice(0, 6).join(' ')}`);
console.log(` unmapped states ..... ${report.unmapped.length}`);
console.log('');
console.log(` hardness patched .... ${patchStats.patched.length} from 1.19  (agree on ${patchStats.agree}, disagree ${patchStats.disagree.length})`);
console.log(` still 0 hardness .... ${patchStats.leftZero.length}  (real zeros: pots, tnt, lily pad ...)`);
console.log(` requires a tool ..... ${Object.values(out).filter((b) => b.requiresTool).length} blocks`);
console.log(` tool tags ........... ${Object.entries(report.toolCounts).map(([k, v]) => `${k}:${v}`).join('  ')}`);
console.log(` fully-occluding ..... ${report.occlusionFullCubes} states`);
console.log(` occlusion vs collision disagreements: ${report.occlusionDisagreements.length}`);
for (const d of report.occlusionDisagreements.slice(0, 12)) console.log('    ! ' + d);
console.log('');
console.log(` ${summary.ms} ms  ->  ${OUT}/block-constants.json`);
console.log('=================================================');
