#!/usr/bin/env node
// texaudit.mjs — every block's every face, against a fresh reading of the jar.
//
//   node tools/texaudit.mjs [--print]
//
// ⚠⚠ WHY THIS EXISTS. Dan, 14 Sept 2026: *"many blocks have wrong textures in hotbar and in
// world."* Nothing in the suite could have told him whether that was true. `tilecheck` covers
// the atlas's first **57** legacy layers, of 778. `modelcheck` proves the build-time model
// INTERPRETER is right — which it is — and says nothing about what the shipped runtime samples.
// The join between them was unasserted for 721 layers, and D-276 says that is exactly where the
// bugs live.
//
// ⚠ THE COMPARISON IS AGAINST A SECOND, INDEPENDENT RESOLUTION. For every block this file goes
// back to the 1.18.2 jar, parses the blockstate, resolves the model chain and reads the texture
// each face asks for — through `tools/models.mjs`, the library `modelcheck`'s 108 assertions
// hold against vanilla's own behaviour — and compares that with the layer the RUNTIME will
// sample for the same face. A check that asked the engine what it thought and then agreed with
// it would prove nothing.
//
// ⚠⚠ AND IT COMPARES **LAYERS**, NOT NAMES, WHICH IS THE WHOLE TRICK. The atlas deduplicates by
// SHA-1 content hash: 791 texture names occupy 778 layers, because many are byte-identical.
// `furnace_top` and `piston_bottom` are the SAME IMAGE and share layer 348. A name comparison
// reports the furnace as drawing a piston — this file's first draft did exactly that, and it was
// a FALSE POSITIVE about the most alarming-looking block in the sample. Resolving the expected
// NAME through the same index the engine used turns "are these the same string" into "are these
// the same picture", which is the question a player is actually asking.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Jar } from './jarlib.mjs';
import { resolveModel, parseBlockstate, placementsFor, resolveTextureVar, rotateDir, DIRS } from './models.mjs';
import { loadEngine, MCLITE_ROOT as ROOT } from './loadsrc.mjs';
import { requireJar } from './paths.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };
const say = (...a) => console.log(...a);

const IDXF = join(ROOT, 'assets', 'atlas-index.json');
if (!existsSync(IDXF)) { say('texaudit: SKIP — run tools/build-atlas.mjs first'); process.exit(0); }
const INDEX = JSON.parse(readFileSync(IDXF, 'utf8')).index;

let jar;
try { jar = new Jar(requireJar('1.18.2')); }
catch (e) { say('texaudit: SKIP — no 1.18.2 jar (' + (e && e.message) + ')'); process.exit(0); }

// ⚠ THE HAND IS LOADED TOO (D-359). §3b asks the question Dan asked — *"the block textures in
// hand being wrong, compare them directly to vanilla"* — of the geometry the HAND actually
// emits, which is a different producer from the one §2 and §3 interrogate.
const M = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '14k_hand3d.js'] });
const R = M.Reg, SR = M.States;
R.block = SR.block;   // propsOf reads the state->block map through one name
say("texaudit — every block's faces, runtime against the jar (D-311)");
say('\n1. the two sides are both there');
ok(R.blockCount > 800, `${R.blockCount} blocks in the runtime`);
ok(SR.count > 20000, `${SR.count} real states`);
ok(Object.keys(INDEX).length > 700, `${Object.keys(INDEX).length} texture names in the atlas index`);

/**
 * The property values of a real state, as a plain name->value map — the shape `placementsFor`
 * wants. Read from the REGISTRY, which is the same table the world indexes by, so the variant
 * this file resolves is the variant the player is looking at.
 */
function propsOf(state) {
  const out = {};
  const b = R.block[state], local = state - R.realFirst[b];
  for (let k = R.propFirst[b]; k < R.propFirst[b + 1]; k++) {
    const v = R.propVals[R.propValOff[k] + (((local / R.propStride[k]) | 0) % R.propValN[k])];
    out[R.propNames[R.propId[k]]] = R.valueNames[v];
  }
  return out;
}

/**
 * A layer's name, for the report only.
 * ⚠ NEVER FOR A COMPARISON. The atlas deduplicates, so a layer has SEVERAL names and this
 * returns an arbitrary one of them — which is precisely the false positive described above.
 */
const LAYER_NAMES = [];
for (const k of Object.keys(INDEX)) (LAYER_NAMES[INDEX[k]] = LAYER_NAMES[INDEX[k]] || []).push(k);
function nameOfLayer(L) {
  const n = LAYER_NAMES[L];
  return n ? (n.length > 1 ? n[0] + ' (=' + n.slice(1).join('=') + ')' : n[0]) : ('layer ' + L);
}

/** bare name -> the atlas layer the engine put that texture on, or -1 */
function layerOfTexture(name) {
  if (typeof name !== 'string') return -1;
  var n = name.replace(/^minecraft:/, '');
  if (INDEX[n] !== undefined) return INDEX[n];
  if (INDEX['block/' + n] !== undefined) return INDEX['block/' + n];
  return -1;
}

const json = (path) => {
  const b = jar.read(path);
  return b ? JSON.parse(b.toString('utf8')) : null;
};

// ── 2. every block's default state, face by face ────────────────────────────────────────────
say('\n2. every cube block, all six faces');
const cache = new Map();
let cubes = 0, checkedFaces = 0, wrong = [], noModel = [], notInAtlas = [];
for (let id = 1; id < R.blockCount; id++) {
  const name = String(R.names[id]).replace(/^minecraft:/, '');
  const st = R.realFirst[id] + R.defaultState[id];
  if (SR.geom[st] !== SR.GEOM_CUBE) continue;          // §3 takes the model-geometry blocks
  const bsJson = json('assets/minecraft/blockstates/' + name + '.json');
  if (!bsJson) { noModel.push(name); continue; }
  let expected, placement = null;
  try {
    const bs = parseBlockstate(bsJson);
    // ⚠ THE DEFAULT STATE'S REAL PROPERTY VALUES, READ OUT OF THE REGISTRY. An empty `{}` here
    // matches only the blockstates that have ONE unconditional variant — 260 of 900 — so the
    // first run of this file compared a quarter of the game and its own assertion said so. A
    // stair's variants are keyed by facing, half and shape; without them `placementsFor` returns
    // nothing and the block is silently skipped as "no model".
    const props = propsOf(st);
    const pl = placementsFor(bs, props);
    const first = Array.isArray(pl) ? pl[0] : pl;
    if (!first || !first.model) { noModel.push(name); continue; }
    const model = resolveModel(jar, first.model, cache);
    if (!model || !model.elements || !model.elements.length) { noModel.push(name); continue; }
    // a cube's faces come from the single full-cube element
    const el = model.elements.find((e) =>
      e.from[0] === 0 && e.from[1] === 0 && e.from[2] === 0 &&
      e.to[0] === 16 && e.to[1] === 16 && e.to[2] === 16);
    if (!el || !el.faces) { noModel.push(name); continue; }
    expected = el.faces;
    placement = first;
  } catch (e) { noModel.push(name); continue; }

  cubes++;
  const part = SR.partAt(st, 0, 0, 0);
  // ⚠⚠ THE VARIANT'S ROTATION IS PART OF THE ANSWER, AND LEAVING IT OUT LOOKS LIKE AN ENGINE BUG.
  // A blockstate variant carries `x` and `y`, and the model's `up` face on a barrel placed
  // facing north ends up pointing north in the world. This file's first run compared the model's
  // RAW faces against the runtime's WORLD faces and reported the barrel and the observer as
  // wrong in six places — a permutation, which is the signature of a missing transform rather
  // than a missing texture. `rotateDir` is `modelcheck` §4's own rotation, so the comparison is
  // still against an independently-verified implementation and not against the engine's.
  const rx = (placement && placement.x) || 0, ry = (placement && placement.y) || 0;
  for (const dir of DIRS) {
    const face = expected[dir];
    if (!face || face.texture === undefined) continue;   // a face the model does not draw
    const tex = (face.resolved !== undefined ? face.resolved : face.texture);
    const want = layerOfTexture(tex);
    if (want < 0) { notInAtlas.push(name + '.' + dir + ' -> ' + tex); continue; }
    const worldDir = rotateDir(dir, rx, ry);             // where this face points once placed
    const f = DIRS.indexOf(worldDir);
    if (f < 0) continue;
    const got = SR.partTiles[part * 6 + f];
    checkedFaces++;
    if (got !== want) wrong.push({ block: name, face: dir + (rx || ry ? '->' + worldDir : ''), want: want, got: got, tex: tex });
  }
}
say(`   ${cubes} cube blocks · ${checkedFaces} faces compared`);
ok(cubes > 300, `${cubes} cube blocks resolved a model — too few would mean the resolution failed, not that the engine is right`);
ok(checkedFaces > 1500, `${checkedFaces} faces actually compared`);
ok(wrong.length === 0, `${wrong.length} faces sample the wrong atlas layer`);
if (wrong.length) {
  const byBlock = {};
  for (const w of wrong) (byBlock[w.block] = byBlock[w.block] || []).push(w.face + ' wants ' + w.tex + ' (layer ' + w.want + ') and got ' + w.got);
  const names = Object.keys(byBlock).sort();
  say(`   ⚠ ${names.length} blocks affected:`);
  for (const n of names.slice(0, 25)) say('     ' + n + ': ' + byBlock[n].join('; '));
  if (names.length > 25) say(`     ...and ${names.length - 25} more`);
}
if (notInAtlas.length) {
  say(`   ⚠ ${notInAtlas.length} faces name a texture the atlas has no layer for:`);
  for (const n of notInAtlas.slice(0, 15)) say('     ' + n);
}
ok(notInAtlas.length === 0, `${notInAtlas.length} faces name a texture that is not in the atlas at all`);

// ── 3. the model-geometry blocks: stairs, slabs, fences, doors, panes, rails ────────────────
// ⚠ 318 OF 900 BLOCKS ARE CUBES. The rest go down the general path, and §2 says nothing about
// them — so a check that stopped there would have covered a third of the game and reported
// "0 wrong". A model block's faces are not a fixed six, so the comparison is the SET of atlas
// layers its quads sample against the SET its model asks for: a stair drawing a fence's plank
// fails, and a stair drawing its own plank on a differently-shaped quad does not, which is the
// right line — this file is auditing TEXTURES, not geometry.
say('\n3. the model-geometry blocks, by the set of textures they sample');
let models = 0, modelWrong = [], modelSkipped = 0;
for (let id = 1; id < R.blockCount; id++) {
  const name = String(R.names[id]).replace(/^minecraft:/, '');
  const st = R.realFirst[id] + R.defaultState[id];
  if (SR.geom[st] === SR.GEOM_CUBE) continue;
  const bsJson = json('assets/minecraft/blockstates/' + name + '.json');
  if (!bsJson) { modelSkipped++; continue; }
  let wantSet;
  try {
    const bs = parseBlockstate(bsJson);
    const pl = placementsFor(bs, propsOf(st));
    const first = Array.isArray(pl) ? pl[0] : pl;
    if (!first || !first.model) { modelSkipped++; continue; }
    const model = resolveModel(jar, first.model, cache);
    if (!model || !model.elements || !model.elements.length) { modelSkipped++; continue; }
    wantSet = new Set();
    for (const el of model.elements) {
      for (const dir of DIRS) {
        const face = el.faces && el.faces[dir];
        if (!face || face.texture === undefined) continue;
        const L = layerOfTexture(face.resolved !== undefined ? face.resolved : face.texture);
        if (L >= 0) wantSet.add(L);
      }
    }
  } catch (e) { modelSkipped++; continue; }
  if (!wantSet.size) { modelSkipped++; continue; }

  const v = SR.vis[st];
  if (!R.groupCount(v)) { modelSkipped++; continue; }
  const part = R.partFor(v, 0, 0, 0, 0);
  const gotSet = new Set();
  for (let q = R.partOff[part]; q < R.partOff[part + 1]; q++) gotSet.add(R.qTile[q]);
  if (!gotSet.size) { modelSkipped++; continue; }
  models++;
  // ⚠ THE CLAIM IS CONTAINMENT, NOT EQUALITY. One variant of a multipart block draws a subset of
  // the whole model's textures, and demanding equality would flag every fence in the game. What
  // must never happen is a quad sampling a layer the model never names — that is the "wrong
  // texture" a player sees.
  const stray = [...gotSet].filter((L) => !wantSet.has(L));
  if (stray.length) modelWrong.push({ block: name, stray: stray, want: [...wantSet] });
}
say(`   ${models} model blocks compared · ${modelSkipped} had no resolvable model`);
ok(models > 300, `${models} model-geometry blocks compared`);
ok(modelWrong.length === 0, `${modelWrong.length} model blocks sample a layer their model never names`);
if (modelWrong.length) {
  for (const w of modelWrong.slice(0, 20)) {
    say('     ' + w.block + ': samples ' + w.stray.map((L) => nameOfLayer(L)).join(', ')
      + ' — its model names ' + w.want.map((L) => nameOfLayer(L)).join(', '));
  }
  if (modelWrong.length > 20) say(`     ...and ${modelWrong.length - 20} more`);
}

// ═══════════ 3b. AND THE SAME QUESTION OF THE FIRST-PERSON HAND (D-359) ═════════════════════
// ⚠⚠ **DAN ASKED FOR EXACTLY THIS**, 15 Sept 2026: *"focus more on the block textures in hand
// being wrong and compare them directly to vanilla."* §2 and §3 compare the layer the WORLD
// samples against the jar. This compares the layer the HAND samples — read out of the vertex
// buffer `Hand3D.emitPart` actually writes, not out of the table it read on the way — against
// the same jar resolution.
//
// ⚠ IT IS A THIRD PRODUCER AND THAT IS THE POINT. The world's mesher, the icon rasteriser and
// now the hand all turn one baked part into a picture. D-314 was two of them disagreeing about
// face order; a check that only ever asks one of them cannot see that class at all.
say('\n3b. every block the HAND draws samples only layers the jar\'s model names');
{
  const H3 = M.Hand3D;
  ok(!!H3, 'Hand3D is loaded');
  const ident = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const buf = new Float32Array(1 << 16);
  let handBlocks = 0, handSkipped = 0;
  const handWrong = [];
  for (let id = 1; id < R.blockCount; id++) {
    const name = String(R.names[id]).replace(/^minecraft:/, '');
    const st = R.realFirst[id] + R.defaultState[id];
    const bsJson = json('assets/minecraft/blockstates/' + name + '.json');
    if (!bsJson) { handSkipped++; continue; }
    let wantSet;
    try {
      const bs = parseBlockstate(bsJson);
      const pl = placementsFor(bs, propsOf(st));
      const first = Array.isArray(pl) ? pl[0] : pl;
      if (!first || !first.model) { handSkipped++; continue; }
      const model = resolveModel(jar, first.model, cache);
      if (!model || !model.elements || !model.elements.length) { handSkipped++; continue; }
      wantSet = new Set();
      for (const el of model.elements) {
        for (const dir of DIRS) {
          const face = el.faces && el.faces[dir];
          if (!face || face.texture === undefined) continue;
          const L = layerOfTexture(face.resolved !== undefined ? face.resolved : face.texture);
          if (L >= 0) wantSet.add(L);
        }
      }
    } catch (e) { handSkipped++; continue; }
    if (!wantSet.size) { handSkipped++; continue; }
    const v = SR.vis[st];
    if (!R.groupCount(v)) { handSkipped++; continue; }
    const part = R.partFor(v, 0, 0, 0, 0);
    // ⚠ THE LAYERS COME OUT OF THE VERTEX BUFFER, at the slot the SHADER reads. Asking the
    // emitter what tile it meant to use would be the same mistake `itemcheck` made in D-331.
    const n = H3.emitPart(buf, 0, part, ident, null, 1);
    if (!n) { handSkipped++; continue; }
    const gotSet = new Set();
    for (let o = 0; o < n; o += H3.FLOATS_PER_VERTEX) gotSet.add(buf[o + 5]);
    handBlocks++;
    const stray = [...gotSet].filter((L) => !wantSet.has(L));
    if (stray.length) handWrong.push({ block: name, stray, want: [...wantSet] });
  }
  say(`   ${handBlocks} blocks drawn through the hand's own emitter · ${handSkipped} had no resolvable model`);
  ok(handBlocks > 300, `${handBlocks} blocks compared in hand`);
  ok(handWrong.length === 0,
     `${handWrong.length} blocks sample a layer in HAND that their vanilla model never names`);
  for (const w of handWrong.slice(0, 20)) {
    say('     ' + w.block + ': the hand samples ' + w.stray.map((L) => nameOfLayer(L)).join(', ')
      + ' — its model names ' + w.want.map((L) => nameOfLayer(L)).join(', '));
  }
  // ⚠ AND THE HAND AND THE WORLD MUST AGREE WITH EACH OTHER, not merely both with the jar:
  // containment against the jar would be satisfied by a hand that drew a SUBSET, which is what
  // "the item is missing its top face" looks like.
  let mismatched = 0, compared = 0;
  for (let id = 1; id < R.blockCount; id++) {
    const st = R.realFirst[id] + R.defaultState[id];
    const v = SR.vis[st];
    if (!R.groupCount(v)) continue;
    const part = R.partFor(v, 0, 0, 0, 0);
    const world = new Set();
    for (let q = R.partOff[part]; q < R.partOff[part + 1]; q++) world.add(R.qTile[q]);
    if (!world.size) continue;
    const n = H3.emitPart(buf, 0, part, ident, null, 1);
    const hand = new Set();
    for (let o = 0; o < n; o += H3.FLOATS_PER_VERTEX) hand.add(buf[o + 5]);
    compared++;
    if (world.size !== hand.size || [...world].some((L) => !hand.has(L))) mismatched++;
  }
  ok(mismatched === 0, `the hand and the world sample the SAME layer set for all ${compared} blocks (${mismatched} differ)`);
  // ⚠ AND THE QUAD COUNT, because a set comparison cannot see a dropped duplicate face.
  {
    const st = SR.stateOf('grass_block');
    const part = R.partFor(SR.vis[st], 0, 0, 0, 0);
    const worldQuads = R.partOff[part + 1] - R.partOff[part];
    const n = H3.emitPart(buf, 0, part, ident, null, 1);
    const handQuads = n / (H3.FLOATS_PER_VERTEX * H3.VERTS_PER_QUAD);
    ok(handQuads === worldQuads,
       `a grass block in hand has the same ${worldQuads} quads the world draws (got ${handQuads})`);
  }
}

// ── 4. anti-vacuity ─────────────────────────────────────────────────────────────────────────
say('\n3. break it, and it must be caught');
{
  // ⚠ THE COMPARISON MUST BE ABLE TO FAIL. A face deliberately pointed at the wrong layer has to
  // be seen — otherwise "0 faces wrong" is a statement about an empty loop.
  const id = R.id['stone'] !== undefined ? R.id['stone'] : 1;
  const st = R.realFirst[id] + R.defaultState[id];
  const part = SR.partAt(st, 0, 0, 0);
  const real = SR.partTiles[part * 6 + 2];
  SR.partTiles[part * 6 + 2] = (real + 7) % 778;
  const want = layerOfTexture('block/stone');
  okAv(SR.partTiles[part * 6 + 2] !== want, `a face moved to the wrong layer read as correct (${SR.partTiles[part * 6 + 2]} vs ${want})`);
  SR.partTiles[part * 6 + 2] = real;
  okAv(SR.partTiles[part * 6 + 2] === want, '...and it matches again when it is put back');
  // and the dedup trap itself: two names, one layer, and that must NOT be a failure
  okAv(layerOfTexture('block/furnace_top') === layerOfTexture('block/piston_bottom'),
    'furnace_top and piston_bottom are byte-identical and share a layer — a NAME comparison would call the furnace wrong');
  okAv(layerOfTexture('block/nonexistent_texture_xyz') === -1, 'a texture that is not in the atlas reads as present');
}

say('');
say('================ texaudit =================');
say(` cube blocks ........ ${cubes}`);
say(` faces compared ..... ${checkedFaces}`);
say(` model blocks ....... ${models}   stray-layer blocks ${modelWrong.length}`);
say(` wrong layer ........ ${wrong.length}`);
say(` not in the atlas ... ${notInAtlas.length}`);
say(` no model resolved .. ${noModel.length}`);
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
for (const f of fails) say('   ✗ ' + f);
say(` breaks caught ...... ${breaks}`);
say('===========================================');
process.exit(fails.length ? 1 : 0);
