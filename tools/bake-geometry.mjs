#!/usr/bin/env node
// bake-geometry.mjs — PLAN F8. Turn 8,929 visual block states into ready-to-upload quads.
//
//   node tools/bake-geometry.mjs [--jar ...] [--out assets]
//
// ⚠ THE NUMBER THAT JUSTIFIES THIS FILE: of 20,622 placements in the roster, only 805 are
// full cubes. 96% of what MC-Lite has to draw is NOT a cube. A cube-only mesher is not
// "most of the way there"; it is 4% of the way there, and that is exactly why the current
// build looks the way it does.
//
// Everything expensive is resolved HERE, once, at build time, so the runtime mesher does no
// per-face maths at all:
//
//   * placement rotation (x, y) applied to positions AND to cullface directions
//   * uvlock applied to UVs, which is the thing that makes rotated stairs and fence posts
//     keep their grain instead of smearing
//   * element rotation (the 22.5/45-degree kind, for crosses and rails)
//   * implicit UVs already derived from element extent
//   * atlas tile index resolved per face
//   * tintindex carried through, because biome colour has nowhere else to attach
//   * per-face shade flag, which is vanilla's fixed directional lighting
//
// ⚠ WHERE THE DEDUPE HAS TO HAPPEN, measured 6 Sept 2026.
// The obvious design bakes one geometry blob per visual STATE and deduplicates identical
// blobs. It was built that way first and measured: 8,933 states, 125,153 quads, 7,549
// unique blobs — only 15.5% deduped, and **11.8 MB of JSON**, which alone is most of D-12's
// 15 MB ceiling for the whole game.
//
// The reason it barely dedupes is that a state's blob is the concatenation of all its
// placements, and multipart blocks make almost every concatenation unique: a fence with
// north+east connected shares no blob with north+west, even though both are built from the
// same four parts. So the repetition is one level down.
//
// The fix is to key on the PLACEMENT — the (model, x, y, uvlock) tuple that a blockstates
// file actually names. A state is then just a short list of indices into a part table, and
// the fence's four arms are stored once each instead of once per combination. Same output,
// same quads, a fraction of the bytes. The numbers for both designs are printed below so
// the claim is measured rather than asserted (D-7's rule).

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Jar } from './jarlib.mjs';
import { resolveModel, groupsFor, parseBlockstate, DIRS, resolveTextureVar } from './models.mjs';
import { bakeModel } from './bakelib.mjs';

// The project root, derived from THIS FILE's location rather than hard-coded. Every tool
// here used to hard-code an absolute path, which meant the whole suite ran
// on exactly one machine — the checks synced to Dan's copy could not be run there at all.
import { fileURLToPath } from 'node:url';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));   // ends with a separator
// Jars are Dan's own copies of the game and are NOT in the repo (D-6), so their location is a
// property of the machine, not the project. `--jar` still wins; MCLITE_JARS moves the default.
import { existsSync } from 'node:fs';
import { JARS as MCLITE_JARS } from './paths.mjs';
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
const OUT = opt('out', MCLITE_ROOT + 'assets');
mkdirSync(OUT, { recursive: true });

const t0 = Date.now();
const jar = new Jar(JAR);
const registry = JSON.parse(readFileSync(join(OUT, 'block-registry.json'), 'utf8'));
const atlas = JSON.parse(readFileSync(join(OUT, 'atlas-index.json'), 'utf8'));

// ---------------------------------------------------------------- bake
const modelCache = new Map();
const parts = [];                 // unique baked placements
const partKey = new Map();        // "model|x|y|uvlock" -> index
// ⚠ D-181. One byte per part: 1 when the placement baked at least one face with a non-zero UV
// rotation — vanilla's per-face `rotation` in the model JSON (`template_glazed_terracotta` puts
// 90/270/0/180 on its four sides, which is the whole block), plus whatever `uvlock` added.
//
// It travels beside the parts rather than inside them because it is not a property of any one
// quad the runtime draws — it is the answer to "can the GREEDY cube path stand in for this
// part?", and the answer is no, because that path regenerates canonical UVs from the corner
// index and has no bit to spare for a rotation (D-177). Deciding it HERE, once, at build time,
// is the whole point: the mesher must not classify UVs on the hot path.
const partUvRot = [];
const out = {};                   // block -> [ [partIndex, ...] per visual state ]
const report = {
  blocks: 0, states: 0, placements: 0, quads: 0, quadsStored: 0,
  uniqueParts: 0, emptyStates: 0,
  missingTile: new Set(), tinted: 0, unshaded: 0, elementRotated: 0, uvlocked: 0,
  perStateBlobs: 0, perStateBytes: 0, alternativeGroups: 0,
  byShape: {}, biggest: [],
};

function bakePlacement(p) {
  const key = `${p.model}|${p.x || 0}|${p.y || 0}|${p.uvlock ? 1 : 0}`;
  const hit = partKey.get(key);
  if (hit !== undefined) return hit;

  const model = resolveModel(jar, p.model, modelCache);
  const quads = bakeModel(model, p.x, p.y, p.uvlock, (tex) => atlas.index[tex], report);

  const idx = parts.length;
  parts.push(quads);
  partUvRot.push(quads.uvRotated ? 1 : 0);          // D-181, set by bakeModel
  partKey.set(key, idx);
  report.quadsStored += quads.length;
  return idx;
}

// G20 (D-659): the state's PARTICLE sprite — `BlockModels.getModelParticleSprite(state)`, which
// `BlockDustParticle` (.decomp client/particle/BlockDustParticle.java:23) draws a 4x4-texel window
// of. The baked model's own `#particle` texture: for a `variants` file the FIRST variant of the
// state's list (`WeightedBakedModel.getParticleSprite` = models.get(0)); for a `multipart` file
// the FIRST selector of the whole file whatever the state (`MultipartBakedModel`'s constructor
// takes `components.iterator().next()`). -1 = no model/particle texture in the atlas.
const ptile = {};                 // block -> tile per visual state (a number when every state agrees)
report.particleMissing = new Set();
function particleTileOf(p) {
  if (!p || !p.model) return -1;
  const m = resolveModel(jar, p.model, modelCache);
  const tex = resolveTextureVar(m.textures || {}, '#particle');
  const t = tex == null ? undefined : atlas.index[tex];
  if (t === undefined) { report.particleMissing.add(p.model + ' ' + tex); return -1; }
  return t;
}

for (const entry of registry) {
  const name = entry.name;
  const bs = parseBlockstate(jar.readJson(`assets/minecraft/blockstates/${name}.json`));
  const perState = [];
  const perParticle = [];
  const multiFirst = bs.kind === 'multipart' && bs.cases.length ? particleTileOf(bs.cases[0].apply[0]) : null;

  for (const s of entry.states) {
    // A state is a list of GROUPS. Every group is drawn; within a group exactly one
    // alternative is chosen, by weight, seeded from the block position. See groupsFor().
    const groups = [];
    let n = 0;
    let pt = multiFirst;
    for (const g of groupsFor(bs, s.state)) {
      if (pt === null) pt = particleTileOf(g[0]);
      const alts = g.map((p) => { report.placements++; return bakePlacement(p); });
      const weights = g.map((p) => p.weight === undefined ? 1 : p.weight);
      if (alts.length > 1) report.alternativeGroups++;
      groups.push(weights.every((w) => w === 1) && alts.length === 1 ? alts[0] : { a: alts, w: weights });
      n += parts[alts[0]].length;                 // cost of ONE alternative, not all of them
    }
    if (!groups.length) report.emptyStates++;
    report.quads += n;
    perState.push(groups);
    perParticle.push(pt === null ? -1 : pt);
    for (const part of s.parts) report.byShape[part.shape] = (report.byShape[part.shape] || 0) + 1;
    report.states++;
  }
  out[name] = perState;
  ptile[name] = perParticle.every((t) => t === perParticle[0]) ? perParticle[0] : perParticle;
  report.biggest.push([name, perState.length]);
  report.blocks++;
}

// For the record: what the per-state design would have cost. Measured, not recalled — this
// is the comparison that justified the redesign and it stays in the build so a future change
// that reverses it is caught by a number rather than by an argument.
{
  const seen = new Map();
  let bytes = 0;
  for (const [name, states] of Object.entries(out)) {
    for (const ids of states) {
      const blob = ids.flatMap((g) => parts[typeof g === 'number' ? g : g.a[0]]);
      const k = createHash('sha1').update(JSON.stringify(blob)).digest('hex');
      if (!seen.has(k)) { seen.set(k, 1); bytes += JSON.stringify(blob).length; }
    }
  }
  report.perStateBlobs = seen.size;
  report.perStateBytes = bytes;
}

report.uniqueParts = parts.length;
report.biggest.sort((a, b) => b[1] - a[1]);
report.biggest = report.biggest.slice(0, 10);

report.uvRotatedParts = partUvRot.reduce((a, b) => a + b, 0);
const doc = { parts, states: out, uvrot: partUvRot, ptile };
writeFileSync(join(OUT, 'block-geometry.json'), JSON.stringify(doc));
const summary = {
  ...report,
  missingTile: [...report.missingTile],
  missingTileCount: report.missingTile.size,
  particleMissing: [...report.particleMissing],
  bytes: JSON.stringify(doc).length,
  quadsPerState: +(report.quads / report.states).toFixed(2),
  dedupe: +(1 - report.quadsStored / report.quads).toFixed(4),
  ms: Date.now() - t0,
};
writeFileSync(join(OUT, 'geometry-report.json'), JSON.stringify(summary, null, 2));

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('');
console.log('================ bake-geometry ================');
console.log(` blocks ............ ${report.blocks}`);
console.log(` visual states ..... ${report.states}`);
console.log(` placements ........ ${report.placements}`);
console.log(` quads (logical) ... ${report.quads}   (${summary.quadsPerState} per state)`);
console.log('');
console.log(` unique parts ...... ${parts.length}   holding ${report.quadsStored} quads`);
console.log(` quad dedupe ....... ${(summary.dedupe * 100).toFixed(1)}%   (${report.quads} -> ${report.quadsStored})`);
console.log(` states with none .. ${report.emptyStates}`);
console.log(` missing atlas tile  ${report.missingTile.size}  ${[...report.missingTile].slice(0, 5).join(' ')}`);
console.log('');
console.log(` tinted faces ...... ${report.tinted}`);
console.log(` unshaded faces .... ${report.unshaded}`);
console.log(` element-rotated ... ${report.elementRotated}`);
console.log(` uvlock corrections  ${report.uvlocked}`);
console.log(` uv-rotated parts .. ${report.uvRotatedParts}   (D-181: these cannot take the greedy cube path)`);
console.log(` one-of groups ..... ${report.alternativeGroups}   (random model variation)`);
console.log('');
console.log(` per-PLACEMENT json  ${kb(summary.bytes)}      <- this design`);
console.log(` per-STATE json .... ${kb(report.perStateBytes)}      (${report.perStateBlobs} blobs) <- the design this replaced`);
console.log(` saved ............. ${(100 - 100 * summary.bytes / report.perStateBytes).toFixed(1)}%`);
console.log('');
console.log(` ${summary.ms} ms  ->  ${OUT}/block-geometry.json`);
console.log('===============================================');
process.exit(report.missingTile.size ? 1 : 0);
