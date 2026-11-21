// models.mjs — a real interpreter for Mojang's block model format.
//
// This is the piece Dan asked to be "literally perfect on looks and rotations", and it is
// the thing MineHTML is currently struggling with. The reason to do it properly rather than
// bucketing blocks into cube/slab/stairs/cross is simple arithmetic: 900 blockstates and
// 1725 models is a data problem if you implement the format, and 900 separate problems if
// you do not.
//
// What the format actually is, in two layers:
//
//   assets/minecraft/blockstates/<block>.json
//       either  "variants": { "<property=value,...>": {model,x,y,uvlock,weight} | [ ... ] }
//       or      "multipart": [ { "when": {...} | {"OR":[...]} | {"AND":[...]}, "apply": ... } ]
//
//   assets/minecraft/models/block/<model>.json
//       "parent"   inherit elements and texture variables from another model
//       "textures" { "<var>": "<texture id or #othervar>" }
//       "elements" [ { from, to, rotation:{origin,axis,angle,rescale},
//                      faces: { <dir>: { texture:"#var", uv, cullface, rotation, tintindex } } } ]
//
// Everything below resolves those two layers into flat, self-contained geometry.

import { Jar, modelPath, parseId } from './jarlib.mjs';

/** Faces, in the order the engine wants them. */
export const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];

// ---------------------------------------------------------------- model resolution

/**
 * Resolve one model id through its whole parent chain.
 *
 * Rules that matter, and that a naive merge gets wrong:
 *  - `textures` MERGE down the chain: a child may add or override individual variables,
 *    and a parent's element referencing "#side" must pick up the child's "#side".
 *  - `elements` do NOT merge: the FIRST definition found walking up wins, entirely.
 *    A child with its own elements replaces the parent's; a child with none inherits.
 *  - texture values may themselves be references ("#var"), possibly chained, so resolution
 *    has to iterate rather than substitute once.
 *  - `display`, `gui_light` and `ambientocclusion` follow the first-wins rule like elements.
 */
export function resolveModel(jar, id, cache = new Map()) {
  if (cache.has(id)) return cache.get(id);

  const chain = [];
  let cur = id;
  const seen = new Set();
  while (cur) {
    if (seen.has(cur)) throw new Error(`cyclic model parent chain at ${cur}`);
    seen.add(cur);
    const p = modelPath(cur);
    if (!jar.has(p)) {
      // Builtin parents (builtin/generated, builtin/entity) have no file; stop cleanly.
      chain.push({ __builtin: cur });
      break;
    }
    const m = jar.readJson(p);
    chain.push(m);
    cur = m.parent || null;
  }

  // textures: merge from the root of the chain downwards, so the child wins
  const textures = {};
  for (let i = chain.length - 1; i >= 0; i--) {
    const t = chain[i].textures;
    if (t) Object.assign(textures, t);
  }

  // elements / flags: first definition walking from the child upwards wins
  let elements = null, ao, guiLight, display, builtin = null;
  for (const m of chain) {
    if (m.__builtin) { builtin = m.__builtin; continue; }
    if (elements === null && Array.isArray(m.elements)) elements = m.elements;
    if (ao === undefined && m.ambientocclusion !== undefined) ao = m.ambientocclusion;
    if (guiLight === undefined && m.gui_light !== undefined) guiLight = m.gui_light;
    if (display === undefined && m.display !== undefined) display = m.display;
  }

  const out = {
    id,
    builtin,
    ambientocclusion: ao === undefined ? true : ao,
    guiLight,
    display,
    textures,
    elements: elements ? elements.map((e) => normaliseElement(e, textures)) : [],
  };
  cache.set(id, out);
  return out;
}

/** Follow "#var" chains in a model's texture map to a concrete texture id. */
export function resolveTextureVar(textures, value) {
  let v = value;
  const seen = new Set();
  while (typeof v === 'string' && v.startsWith('#')) {
    const key = v.slice(1);
    if (seen.has(key)) return null;      // cyclic or unresolved
    seen.add(key);
    v = textures[key];
    if (v === undefined) return null;    // dangling reference - a real thing in vanilla
  }
  // ⚠ NORMALISE THE NAMESPACE. Vanilla's own files are inconsistent: `block/stone` in one
  // model, `minecraft:block/sand` in another, for textures in the same jar. Left alone that
  // produced an atlas index with 810 keys for 764 tiles and two spellings of the same
  // texture — which looks harmless until something joins on the name and silently misses.
  // Measured 6 Sept 2026: 676 of the 810 keys carried the prefix and 134 did not, and the
  // legacy-tile map found 43 of its 57 lookups failing because of it. The default namespace
  // IS minecraft, so the bare form is the canonical one.
  if (typeof v === 'string' && v.startsWith('minecraft:')) v = v.slice('minecraft:'.length);
  return v ?? null;
}

/**
 * Turn one raw element into a normalised one: numbers in blocks (0..16), every face
 * carrying its resolved texture id and its explicit UV.
 *
 * Default UVs are NOT (0,0,16,16) for every face. Vanilla derives them from the element's
 * own extent on the two axes the face spans, which is why a half-height element shows half
 * the texture rather than a squashed whole one. Getting this wrong is subtle and everywhere.
 */
function normaliseElement(e, textures) {
  const from = e.from.map(Number);
  const to = e.to.map(Number);
  const faces = {};
  for (const d of DIRS) {
    const f = e.faces && e.faces[d];
    if (!f) continue;
    faces[d] = {
      texture: resolveTextureVar(textures, f.texture),
      textureVar: f.texture,
      uv: f.uv ? f.uv.map(Number) : defaultUv(d, from, to),
      cullface: f.cullface ?? null,
      rotation: f.rotation ?? 0,
      tintindex: f.tintindex === undefined ? -1 : f.tintindex,
    };
  }
  const out = { from, to, faces, shade: e.shade === undefined ? true : e.shade };
  if (e.rotation) {
    out.rotation = {
      origin: (e.rotation.origin || [8, 8, 8]).map(Number),
      axis: e.rotation.axis,
      angle: Number(e.rotation.angle),
      rescale: !!e.rotation.rescale,
    };
  }
  return out;
}

/** Vanilla's implicit UV for a face, taken from the element's extent. */
function defaultUv(dir, from, to) {
  const [x1, y1, z1] = from;
  const [x2, y2, z2] = to;
  switch (dir) {
    case 'down':  return [x1, 16 - z2, x2, 16 - z1];
    case 'up':    return [x1, z1, x2, z2];
    case 'north': return [16 - x2, 16 - y2, 16 - x1, 16 - y1];
    case 'south': return [x1, 16 - y2, x2, 16 - y1];
    case 'west':  return [z1, 16 - y2, z2, 16 - y1];
    case 'east':  return [16 - z2, 16 - y2, 16 - z1, 16 - y1];
    default:      return [0, 0, 16, 16];
  }
}

// ---------------------------------------------------------------- blockstates

/**
 * Parse a blockstates file into a uniform shape, so the rest of the pipeline never has to
 * care whether a block used "variants" or "multipart".
 *
 * Returns { kind: 'variants', cases: [{when: {prop:val}|null, apply: [placement]}] }
 *      or { kind: 'multipart', cases: [{when: <condition>, apply: [placement]}] }
 *
 * A placement is { model, x, y, uvlock, weight } — x and y are the 90-degree rotations
 * vanilla applies to the whole model, and uvlock decides whether the texture rotates with
 * it. uvlock is exactly the thing that makes rotated stairs and fences look right, and it
 * is the most commonly skipped part of the format.
 */
export function parseBlockstate(json) {
  if (json.multipart) {
    return {
      kind: 'multipart',
      cases: json.multipart.map((m) => ({
        when: m.when ?? null,
        apply: asArray(m.apply).map(normalisePlacement),
      })),
    };
  }
  const cases = [];
  for (const [key, val] of Object.entries(json.variants || {})) {
    cases.push({
      key,
      when: key === '' ? null : parseVariantKey(key),
      apply: asArray(val).map(normalisePlacement),
    });
  }
  return { kind: 'variants', cases };
}

function asArray(v) { return Array.isArray(v) ? v : [v]; }

function normalisePlacement(p) {
  return {
    model: p.model,
    x: p.x || 0,
    y: p.y || 0,
    uvlock: !!p.uvlock,
    weight: p.weight === undefined ? 1 : p.weight,
  };
}

/** "facing=north,half=bottom" -> { facing:'north', half:'bottom' } */
export function parseVariantKey(key) {
  const out = {};
  if (!key) return out;
  for (const part of key.split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/**
 * Evaluate a multipart "when" against a state. Supports the real grammar:
 *   { prop: "value" }                 all listed properties must match
 *   { prop: "a|b" }                   any of the alternatives
 *   { OR: [ cond, ... ] }
 *   { AND: [ cond, ... ] }
 */
export function multipartMatches(when, state) {
  if (!when) return true;
  if (when.OR) return when.OR.some((c) => multipartMatches(c, state));
  if (when.AND) return when.AND.every((c) => multipartMatches(c, state));
  for (const [k, v] of Object.entries(when)) {
    if (k === 'OR' || k === 'AND') continue;
    const actual = state[k];
    const alternatives = String(v).split('|');
    if (!alternatives.includes(String(actual))) return false;
  }
  return true;
}

/**
 * Every property -> the set of values it can take.
 *
 * ⚠ MEASURED DEFECT, found by tools/modelcheck.mjs on its first run, 6 Sept 2026.
 * For "variants" blocks the keys enumerate the full cartesian product, so reading values
 * straight out of the file is complete. For "multipart" blocks it is NOT: a `when` clause
 * only ever names the value that TRIGGERS a part. `oak_fence.json` says `{"north":"true"}`
 * four times and never mentions "false" at all — so a naive reader concludes north has a
 * single possible value and the fence has exactly ONE state instead of sixteen.
 *
 * The fix: when a property's observed values are a subset of {"true","false"}, it is a
 * boolean and both values exist. That is sound because Minecraft has no property whose
 * domain is only-true.
 *
 * ⚠ A SECOND, DEEPER LIMIT that this cannot fix: blockstates files describe only what is
 * VISUAL. Non-visual properties are absent entirely — `waterlogged` on slabs, stairs and
 * fences, `powered` on doors. So `oak_slab` reads as 3 states here and is really 6 in game,
 * and `oak_door` reads as 32 and is really 64. Those are not errors in this function; they
 * are the boundary of what this file knows. The full property domains come from
 * `blocks.json`, emitted by Mojang's data generator - see docs/archive/ASSETS.md. Until that exists,
 * treat these counts as "visual states", which is exactly what the mesher needs.
 */
/**
 * The property domains of a block, as seen from its blockstates file.
 *
 * ⚠ THE DEFECT THIS SIGNATURE EXISTS TO FIX (measured 6 Sept 2026, PLAN D-28):
 * A multipart `when` clause only ever names the value that TRIGGERS a part. `oak_fence.json`
 * says `{"north":"true"}` four times and never mentions `"false"` — so inferring the domain
 * from the file gives ONE state instead of sixteen. Boolean completion below patches that
 * case, but it is only a patch, and `merge-constants.mjs` proved it insufficient: the WALLS
 * take `none|low|tall` per side and their `when` clauses name only `low` and `tall`, never
 * `none`. Result before this fix: 23 blocks (every wall) with 260 of their 324 real states
 * unreachable, and a hole in the roster that no amount of boolean completion would close.
 *
 * The real fix is not a smarter inference. It is to stop inferring: pass `authoritative` —
 * the property domains from `minecraft-data`'s blocks.json, which is Mojang's own state
 * space — and use inference only for the handful of blocks it does not carry (measured: 2,
 * `item_frame` and `glow_item_frame`, both of which are entities wearing a block's clothes).
 *
 * @param bs             a parsed blockstates file
 * @param authoritative  optional Map<propName, string[]> — the true domain of each property
 */
export function propertiesOf(bs, authoritative = null) {
  const props = new Map();
  const note = (k, v) => {
    if (!props.has(k)) props.set(k, new Set());
    for (const alt of String(v).split('|')) props.get(k).add(alt);
  };
  if (bs.kind === 'variants') {
    for (const c of bs.cases) {
      if (!c.when) continue;
      for (const [k, v] of Object.entries(c.when)) note(k, v);
    }
  } else {
    const walk = (w) => {
      if (!w) return;
      if (w.OR) return w.OR.forEach(walk);
      if (w.AND) return w.AND.forEach(walk);
      for (const [k, v] of Object.entries(w)) if (k !== 'OR' && k !== 'AND') note(k, v);
    };
    for (const c of bs.cases) walk(c.when);
  }
  // Boolean domain completion - the partial patch, kept for the no-authority path.
  for (const [, vals] of props) {
    const only = [...vals];
    if (only.length && only.every((v) => v === 'true' || v === 'false')) {
      vals.add('true'); vals.add('false');
    }
  }
  // Authoritative override. Only the property NAMES come from the blockstates file - those
  // are the properties that actually change the model, and they are what makes the visual
  // state space smaller than the real one. Every DOMAIN comes from the authority, because
  // the file is not a reliable witness to its own domains.
  if (authoritative) {
    for (const k of [...props.keys()]) {
      const real = authoritative.get(k);
      if (real) props.set(k, new Set(real));
    }
  }
  return props;
}

/** The cartesian product of a property map — every state a block can be in. */
export function enumerateStates(props) {
  const keys = [...props.keys()].sort();
  if (!keys.length) return [{}];
  let out = [{}];
  for (const k of keys) {
    const vals = [...props.get(k)].sort();
    const next = [];
    for (const base of out) for (const v of vals) next.push({ ...base, [k]: v });
    out = next;
    if (out.length > 20000) throw new Error(`state explosion on ${keys.join(',')}`);
  }
  return out;
}

/** Which placements apply to a given state. */
export function placementsFor(bs, state) {
  if (bs.kind === 'variants') {
    for (const c of bs.cases) {
      if (!c.when) { if (bs.cases.length === 1) return c.apply; continue; }
      let ok = true;
      for (const [k, v] of Object.entries(c.when)) {
        if (String(state[k]) !== String(v)) { ok = false; break; }
      }
      if (ok) return c.apply;
    }
    const empty = bs.cases.find((c) => !c.when);
    return empty ? empty.apply : [];
  }
  const out = [];
  for (const c of bs.cases) if (multipartMatches(c.when, state)) out.push(...c.apply);
  return out;
}

// ---------------------------------------------------------------- geometry classification

/** Is this element exactly the full 0..16 cube? */
function isFullCube(el) {
  return el.from[0] === 0 && el.from[1] === 0 && el.from[2] === 0 &&
         el.to[0] === 16 && el.to[1] === 16 && el.to[2] === 16 && !el.rotation;
}

/**
 * A cheap shape label, for the mesher's fast paths only.
 *
 * ⚠ This is a HINT, never the source of truth. The mesher must be able to render any
 * element list; the label just lets it take a shortcut for the ~70% of blocks that are
 * plain cubes, which is where the greedy mesher earns its keep. Every block that is not a
 * plain cube goes down the general path and comes out correct because the general path
 * reads the real geometry.
 */
export function classify(model) {
  const els = model.elements;
  if (!els.length) return model.builtin ? 'builtin' : 'empty';
  if (els.length === 1 && isFullCube(els[0])) return 'cube';
  if (els.every((e) => e.rotation && Math.abs(e.rotation.angle) === 45)) return 'cross';
  if (els.length === 1) {
    const e = els[0];
    const thin = ['x', 'y', 'z'].map((_, i) => e.to[i] - e.from[i]);
    if (thin[1] === 8 && thin[0] === 16 && thin[2] === 16) return 'slab';
    if (thin.some((d) => d <= 2)) return 'thin';
    return 'box';
  }
  return 'multi';
}

/** Every texture id a model actually uses on a drawn face. */
export function texturesUsed(model) {
  const out = new Set();
  for (const el of model.elements) {
    for (const d of DIRS) {
      const f = el.faces[d];
      if (f && f.texture) out.add(f.texture);
    }
  }
  return out;
}

export { Jar, parseId };

// ═══════════════════════════════════════════════════════════════════════════════
// PLACEMENT ROTATION
//
// ⚠ GROUND TRUTH, established 6 Sept 2026 by reading four blockstates files against their
// models, because the first implementation of this got it backwards and `constcheck.mjs`
// caught it as "an open trapdoor facing east occludes east" when it must occlude west.
//
// Mojang's `x` and `y` in a blockstates variant are the NEGATIVE of the standard
// right-handed rotation — clockwise when looking from the positive axis toward the origin.
// Four independent confirmations, each one a file anyone can re-read:
//
//   stairs         base model's tall step is at x=8..16, i.e. EAST, and `facing=east` has
//                  NO rotation. `facing=south` is `y:90`.        =>  y90 maps east -> south
//   wall_torch     base model leans EAST, `facing=east` has no rotation, `facing=south`
//                  is `y:90`.                                    =>  y90 maps east -> south
//   amethyst_cluster  base points UP, `facing=north` is `x:90`.  =>  x90 maps up -> north
//   amethyst_cluster  `facing=east` is `x:90,y:90` — up -> north -> east, which only works
//                  if BOTH axes use the same handedness.
//
// The standard right-handed +90 about Y maps east -> north, and about X maps up -> south.
// Both are the opposite of the above. So:
//
//     x by +90:   (y, z) -> ( z, -y)
//     y by +90:   (x, z) -> (-z,  x)
//
// Getting this wrong is invisible on stone and wrong on every stair, trapdoor, torch,
// button, lever, log, piston, chest, furnace and door in the game — which is to say, on
// 94% of the roster. Dan: "mchtml is having issues with block rotation ... and i dont even
// want to have to think about that."

/** Number of 90-degree clockwise steps for a degrees value. Handles negatives and 360+. */
export function steps(deg) { return ((((deg || 0) / 90) | 0) % 4 + 4) % 4; }

/** Rotate a point in 0..16 model space about the block centre. */
export function rotatePoint(p, x, y) {
  let [px, py, pz] = [p[0] - 8, p[1] - 8, p[2] - 8];
  for (let i = steps(x); i > 0; i--) { const ny = pz, nz = -py; py = ny; pz = nz; }
  for (let i = steps(y); i > 0; i--) { const nx = -pz, nz = px; px = nx; pz = nz; }
  return [px + 8, py + 8, pz + 8];
}

/** Rotate an axis-aligned box; returns the new [lo, hi]. Corners, because a rotated box
 *  is still axis-aligned only for multiples of 90 and this is the honest way to say so. */
export function rotateBox(from, to, x, y) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const cx of [from[0], to[0]]) for (const cy of [from[1], to[1]]) for (const cz of [from[2], to[2]]) {
    const p = rotatePoint([cx, cy, cz], x, y);
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
  }
  return [lo, hi];
}

const DIR_VEC = {
  down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1],
  south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0],
};
/** Rotate a face direction — this is what `cullface` needs, and forgetting it is why
 *  rotated stairs cull the wrong neighbour. */
export function rotateDir(dir, x, y) {
  let v = DIR_VEC[dir];
  if (!v) return dir;
  v = v.slice();
  for (let i = steps(x); i > 0; i--) { const ny = v[2], nz = -v[1]; v[1] = ny; v[2] = nz; }
  for (let i = steps(y); i > 0; i--) { const nx = -v[2], nz = v[0]; v[0] = nx; v[2] = nz; }
  for (const [k, d] of Object.entries(DIR_VEC)) {
    if (d[0] === v[0] && d[1] === v[1] && d[2] === v[2]) return k;
  }
  return dir;
}

/**
 * The placements for a state, as GROUPS rather than as a flat list.
 *
 * ⚠ MEASURED DEFECT, caught by tools/meshcheck.mjs on its first run, 6 Sept 2026:
 * "stone has 4 south faces, expected 1".
 *
 * `stone.json` is `{"variants": {"": [ stone, stone_mirrored, stone y:180,
 * stone_mirrored y:180 ]}}` — four entries that are ALTERNATIVES. Vanilla picks ONE at
 * random per block position, which is how a stone wall avoids looking tiled. A flat list
 * concatenates all four and draws every one of them, so every stone block in the world
 * ships four coincident copies of itself: 4x the quads, z-fighting, and a mesher budget
 * blown before a single chunk is built.
 *
 * The correct model has two levels, and vanilla has both:
 *   - a GROUP is drawn. Multipart contributes one group per matching `when` case; a
 *     `variants` block contributes exactly one group.
 *   - within a group the entries are ALTERNATIVES, chosen one-of by weight, seeded from
 *     the block position so the choice is stable.
 *
 * `placementsFor` flattens both levels and is kept only for shape classification, where
 * the distinction does not matter. Anything that emits geometry must use this instead.
 */
export function groupsFor(bs, state) {
  if (bs.kind === 'variants') {
    const list = placementsFor(bs, state);
    return list.length ? [list] : [];
  }
  const out = [];
  for (const c of bs.cases) if (multipartMatches(c.when, state)) out.push(c.apply);
  return out;
}
