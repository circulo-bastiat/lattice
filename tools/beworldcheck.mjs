#!/usr/bin/env node
// beworldcheck.mjs — D-421: THE BLOCK ENTITIES IN THE WORLD.
//
//   node tools/beworldcheck.mjs [--verbose]
//
// ⚠⚠ **WHAT THIS EXISTS TO CATCH.** For nine units of G19b this engine built chest SCREENS —
// the chest, the barrel, the ender chest, the shulker, the double chest, the furnace family,
// the hopper, the dispenser — and every one of them was opened by right-clicking a block that
// **was not drawn at all**. `chest`'s model is `builtin/entity` and bakes zero quads; nothing
// else drew it; every check stayed green because not one of them ever asked what the WORLD
// looks like where a chest stands. §1 states that class on the world and keeps stating it:
// the set of block-entity blocks that bake no quads is measured here, and every member must be
// either DRAWN (`ER.BE_WORLD`) or NAMED (`ER.BE_WORLD_OWED`). A tenth container screen cannot
// be built over an invisible block again without this file going red.
//
// The vanilla law it holds the renderer to was disassembled from the 1.18.2 jar this session
// (`esu` = ChestRenderer, `cmx` = ChestLidController, `ceo.g` = ChestBlock.getBlockType):
//   * `translate(.5,.5,.5); mulPose(YP.rotationDegrees(-facing.toYRot())); translate(-.5,-.5,-.5)`
//   * `o = getOpenness(partial); o = 1-o; o = 1-o*o*o; lid.xRot = lock.xRot = -(o*PI/2)`
//   * `tickLid`: latch = openness, then ±0.1 clamped to [0,1] — ten ticks each way
//   * `ChestType.LEFT -> DOUBLE_CHEST_LEFT`, anything else -> `DOUBLE_CHEST_RIGHT`
//
// ANTI-VACUITY: every section breaks its own input and asserts the break is caught (D-30/D-305).

import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('beworldcheck — the block entities in the world (D-421)');

const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
          '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'),
                   modelsBytes: mm.rawBytes });
}
{
  // The real `mob-geometry.json`, deflated into `NS.DATA` exactly as `gen-data.mjs` writes it,
  // so `ER.mobGeomFor`'s own unpack path runs rather than being skipped (mobboxcheck's note).
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, {
    mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length
  });
}
M.EntityList.init();
M.EntityRender.init();
M.BlockEntities.init();

const ER = M.EntityRender, BEM = M.BEModel, BEs = M.BlockEntities, SR = M.States, R = M.Reg;
const Me = M.Mesher, CFG = M.CFG, P_ = R.PROP, V = R.PVAL;
ok(ER.ready, 'the entity renderer is up');
ok(BEs.ready, 'the block-entity store is up');
ok(BEM.ready, 'the model payload decodes');

// a world that answers getBlock from a map, and a constant light
const CELLS = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
M.World = M.World || {};
M.World.getBlock = (x, y, z) => CELLS.get(key(x, y, z)) || 0;
M.World.getLight = () => 0xF0;
const put = (x, y, z, st, type) => {
  CELLS.set(key(x, y, z), st);
  BEs.remove(x, y, z);
  const e = BEs.create(x, y, z, type);
  return e;
};

// ═══════════════ 1. the hole is real, and it is a CLOSED list ══════════════════════════════
console.log('\n 1. which block-entity blocks bake no quads, and who draws them');
{
  const quads = (name) => {
    const st = SR.stateOf(name);
    return st ? Me.modelQuadCount(SR.vis[st], 0, 0, 0, 0, 0, 70, 0) : -1;
  };
  ok(quads('stone') > 0, `a control block bakes quads (stone: ${quads('stone')})`);
  const HOLES = ['chest', 'trapped_chest', 'ender_chest', 'white_bed', 'white_banner',
                 'shulker_box', 'oak_sign'];
  for (const n of HOLES) {
    ok(quads(n) === 0, `${n} bakes NO quads — nothing but a block-entity renderer can draw it`);
  }
  say(`the measured holes: ${HOLES.join(', ')}`);

  // ⚠ THE CLOSED LIST. Every block type the block-entity store knows, whose block bakes no
  // quads, must be either drawn here or named as owed — never silently absent.
  const owedText = ER.BE_WORLD_OWED.join(' | ');
  const missing = [];
  for (const n of HOLES) {
    const st = SR.stateOf(n);
    const type = BEs.typeOf(SR.block[st]);
    if (!type) continue;
    const drawn = !!ER.BE_WORLD[type];
    const named = owedText.indexOf(type) >= 0 || owedText.indexOf(type.replace(/^.*_/, '')) >= 0;
    if (!drawn && !named) missing.push(n + ' (' + type + ')');
  }
  ok(missing.length === 0,
     'every un-bakeable block-entity block is drawn or named owed — missing: ' + missing.join(', '));
  ok(ER.BE_WORLD_OWED.length > 0, 'the owed list is not empty (this session did not close them all)');

  okAv(ER.BE_WORLD.chest && ER.BE_WORLD.chest.layer === 'chest',
       'anti-vacuity: the chest is on the DRAWN table, not the owed one');
}

// ═══════════════ 2. the lid — the controller, the curve, the rest angle ════════════════════
console.log('\n 2. the chest lid (ChestLidController + ChestRenderer, off the jar)');
{
  const L = BEM.layer('chest');
  ok(!!L, 'the chest layer is in the model payload');
  const lid = L.parts.filter((p) => p.n === 'lid')[0];
  const lock = L.parts.filter((p) => p.n === 'lock')[0];
  ok(!!lid && !!lock, 'it has a lid and a lock part');
  // ⚠ WHY THIS ASSERTION EXISTS: vanilla ASSIGNS lid.xRot; this engine ADDS a delta to the rest
  // angle. The two are the same thing only while the rest angle is zero. Assert it, don't say it.
  ok(lid.rx === 0 && lock.rx === 0, `lid and lock rest at xRot 0 (${lid.rx}/${lock.rx})`);
  ok(lid.py === 9 && lid.pz === 1, `the lid pivots at y=9 z=1 as the jar's CubeListBuilder says (${lid.py}/${lid.pz})`);

  // the controller: ten ticks open, ten closed, and the latch is the PREVIOUS value
  const e = { type: 'chest', open: 1, lid: 0 };
  let ticks = 0;
  while ((e.lid || 0) < 1 && ticks < 50) { BEs.tickLid(e); ticks++; }
  ok(ticks === 10, `a chest lid opens in exactly ten ticks (${ticks})`);
  e.open = 0; ticks = 0;
  while ((e.lid || 0) > 0 && ticks < 50) { BEs.tickLid(e); ticks++; }
  ok(ticks === 10, `and closes in ten (${ticks})`);
  // the latch: mid-tick interpolation must land BETWEEN the two tick values, not on either
  const f = { type: 'chest', open: 1, lid: 0 };
  BEs.tickLid(f);
  ok(Math.abs(BEs.lidOpenness(f, 0) - 0) < 1e-9, 'at partial 0 the lid reads the PREVIOUS tick');
  // ⚠ `Math.fround(0.1)`, not `0.1`: the controller accumulates in float32 the way Java's own
  // `float` does (07c's header — it is the difference between a ten-tick lid and an eleven-tick
  // one), so the value a frame reads back is the float32 step, and a check that insisted on the
  // double would be asserting the BUG.
  const STEP = Math.fround(0.1);
  ok(Math.abs(BEs.lidOpenness(f, 1) - STEP) < 1e-9, 'at partial 1 it reads this one');
  ok(Math.abs(BEs.lidOpenness(f, 0.5) - STEP / 2) < 1e-9, 'and halfway between at partial 0.5');

  // the curve, at THREE values — a linear lid passes two and fails the third (D-241/D-296)
  const ang = (o) => ER.beLidAngle(o);
  const want = (o) => -((1 - Math.pow(1 - o, 3)) * Math.PI / 2);
  for (const o of [0, 0.25, 0.5, 0.75, 1]) {
    ok(Math.abs(ang(o) - want(o)) < 1e-9, `the lid angle at openness ${o} is the jar's cubic`);
  }
  ok(Math.abs(ang(0)) < 1e-9, 'a shut chest has a flat lid');
  ok(Math.abs(ang(1) + Math.PI / 2) < 1e-9, 'a fully open chest has a lid at exactly -90 degrees');
  // the cubic leaves the closed position FAST — that is the whole character of the motion
  ok(Math.abs(ang(0.5)) > Math.abs(ang(1)) * 0.8,
     'and it is a CUBIC, not a ramp: half open is already more than 80% of the way round');

  const d = ER.beLidAnim(0.5).deltaFor;
  ok(d('lid') && Math.abs(d('lid').rx - ang(0.5)) < 1e-9, 'the lid delta carries that angle');
  ok(d('lock') && Math.abs(d('lock').rx - ang(0.5)) < 1e-9, 'the lock takes the same angle as the lid');
  ok(d('bottom') === null, 'and the bottom of the chest does not move');

  okAv(Math.abs(ang(0.5) - (-0.5 * Math.PI / 2)) > 1e-6,
       'anti-vacuity: a LINEAR lid angle differs from the shipped one at half open, so this can fail');
}

// ═══════════════ 3. the facing — the lock ends up on the side the chest faces ══════════════
console.log('\n 3. which way a chest is turned (the sign of the rotation)');
{
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  // Where does the LOCK (the chest's front fitting, at z=15..16 unrotated) end up? Emit the
  // layer and take the centroid of the lock's own quads. A chest faces the way its lock points.
  const lockCentre = (facing) => {
    const st0 = SR.stateOf('chest');
    const st = SR.withProp(st0, P_.facing, facing);
    CELLS.clear(); BEs.clear();
    const e = put(0, 70, 0, st, 'chest');
    e.open = 0; e.lid = 0; e.lidLatch = 0;
    const built = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
    if (!built) return null;
    // the lock is the only geometry that reaches outside the 1..15 inset the bottom and lid share
    const words = new Uint32Array(built.buf, M.Mesher.readHeader(built.buf).modelOff[0]);
    let sx = 0, sz = 0, n = 0;
    for (let q = 0; q < built.quads[CFG.LAYER_OPAQUE]; q++) {
      for (let v = 0; v < 4; v++) {
        const o = q * 16 + v * 4;
        // i16 x and z out of the packed vertex — the mesher's own model-vertex layout
        const x = (words[o] << 16) >> 16, z = (words[o + 1] << 16) >> 16;
        sx += x; sz += z; n++;
      }
    }
    return n ? { x: sx / n / U, z: sz / n / U } : null;
  };
  // the whole model's centroid barely moves under rotation (it is nearly symmetric), so the
  // lock is found instead by asking which cell face the OUTERMOST vertex sits against.
  const outermost = (facing) => {
    const st = SR.withProp(SR.stateOf('chest'), P_.facing, facing);
    CELLS.clear(); BEs.clear();
    const e = put(0, 70, 0, st, 'chest');
    e.open = 0; e.lid = 0; e.lidLatch = 0;
    const built = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
    if (!built) return null;
    const words = new Uint32Array(built.buf, M.Mesher.readHeader(built.buf).modelOff[0]);
    let best = null, bestD = -1;
    const nq = built.quads[CFG.LAYER_OPAQUE];
    for (let q = 0; q < nq; q++) {
      for (let v = 0; v < 4; v++) {
        const o = q * 16 + v * 4;
        const x = ((words[o] << 16) >> 16) / U, z = ((words[o + 1] << 16) >> 16) / U;
        const d = Math.max(Math.abs(x - 0.5), Math.abs(z - 0.5));
        if (d > bestD) { bestD = d; best = { x: x, z: z }; }
      }
    }
    return best;
  };
  const CASES = [[V.north, 0, -1], [V.south, 0, 1], [V.east, 1, 0], [V.west, -1, 0]];
  for (const [facing, dx, dz] of CASES) {
    const p = outermost(facing);
    ok(!!p, 'a chest with that facing draws something at all');
    if (!p) continue;
    const ox = p.x - 0.5, oz = p.z - 0.5;
    const along = ox * dx + oz * dz;
    ok(along > 0.45,
       `the lock of a chest facing (${dx},${dz}) sticks out on that side (${along.toFixed(3)})`);
  }
  okAv((() => {
    // anti-vacuity: with the sign of the yaw flipped, a north-facing chest's lock points SOUTH
    const real = ER.beYRot;
    ER.beYRot = (Vv, f) => real(Vv, f) + Math.PI;
    const p = outermost(V.north);
    ER.beYRot = real;
    return p && (p.z - 0.5) > 0.45;
  })(), 'anti-vacuity: flipping the rotation puts the lock on the wrong side, and §3 sees it');
}

// ═══════════════ 4. the pass actually draws, and a double chest is two models ═══════════════
console.log('\n 4. the frame buffer has a chest in it');
{
  CELLS.clear(); BEs.clear();
  const st = SR.stateOf('chest');
  const e = put(3, 70, 3, st, 'chest');
  e.open = 0; e.lid = 0; e.lidLatch = 0;
  const built = ER.build(3, 70, 3, 3.5, 70.5, 3.5, 1);
  ok(!!built, 'a world with ONE chest and no entities at all still builds a frame');
  ok(built && built.drawn === 1, `and exactly one thing is drawn (${built && built.drawn})`);
  ok(built && built.quads[CFG.LAYER_OPAQUE] === ER.mobQuadCount('chest'),
     `with the chest layer's own quad count (${built && built.quads[CFG.LAYER_OPAQUE]} vs ${ER.mobQuadCount('chest')})`);

  // the double chest: each half is its OWN model, and they are not the same one
  const stL = SR.withProp(SR.stateOf('chest'), P_.type, V.left);
  const stR = SR.withProp(SR.stateOf('chest'), P_.type, V.right);
  CELLS.clear(); BEs.clear();
  const l = put(0, 70, 0, stL, 'chest'); l.open = 0; l.lid = 0;
  const itL = ER.beWorldItem(l, 1);
  CELLS.clear(); BEs.clear();
  const r = put(0, 70, 0, stR, 'chest'); r.open = 0; r.lid = 0;
  const itR = ER.beWorldItem(r, 1);
  ok(itL && itL.layer === 'double_chest_left', `type=left draws DOUBLE_CHEST_LEFT (${itL && itL.layer})`);
  ok(itR && itR.layer === 'double_chest_right', `type=right draws DOUBLE_CHEST_RIGHT (${itR && itR.layer})`);
  ok(ER.mobQuadCount('double_chest_left') > 0 && ER.mobQuadCount('double_chest_right') > 0,
     'and both halves have real geometry');

  // the lid REACHES the geometry: an open chest is not the same picture as a shut one
  const pic = (openness) => {
    CELLS.clear(); BEs.clear();
    const c = put(0, 70, 0, SR.stateOf('chest'), 'chest');
    c.open = openness > 0 ? 1 : 0; c.lid = openness; c.lidLatch = openness;
    const b = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
    if (!b) return '';
    const w = new Uint32Array(b.buf, M.Mesher.readHeader(b.buf).modelOff[0]);
    return Array.from(w.slice(0, b.quads[CFG.LAYER_OPAQUE] * 16)).join(',');
  };
  const shut = pic(0), open = pic(1);
  ok(shut.length > 0 && shut !== open, 'an OPEN chest draws different geometry from a shut one');
  ok(pic(0.5) !== shut && pic(0.5) !== open, 'and a half-open one is a third picture again');

  okAv((() => {
    const saved = ER.BE_WORLD.chest;
    delete ER.BE_WORLD.chest;
    const b = ER.build(3, 70, 3, 3.5, 70.5, 3.5, 1);
    ER.BE_WORLD.chest = saved;
    return b === null;
  })(), 'anti-vacuity: take the chest off the drawn table and the frame is empty again');
}

// ═══════════════ 5. the chest MATERIAL (D-651) ═════════════════════════════════════════════
// `TexturedRenderLayers.getChestTexture` picks the sheet off the block entity's type: a trapped
// chest and an ender chest are the SAME geometry in a DIFFERENT sheet. Before D-651 all three drew
// the normal chest's sheet, so their frame buffers were byte-identical — which is what this asks.
console.log('\n 5. trapped and ender chests wear their own sheets');
{
  ER.christmasOverride = false;
  const picT = (type, half) => {
    CELLS.clear(); BEs.clear();
    let st = SR.stateOf(type);
    if (half) st = SR.withProp(st, P_.type, half);
    const c = put(0, 70, 0, st, type); c.open = 0; c.lid = 0; c.lidLatch = 0;
    const b = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
    if (!b) return '';
    const w = new Uint32Array(b.buf, M.Mesher.readHeader(b.buf).modelOff[0]);
    return Array.from(w.slice(0, b.quads[CFG.LAYER_OPAQUE] * 16)).join(',');
  };
  const nrm = picT('chest'), trp = picT('trapped_chest'), end = picT('ender_chest');
  ok(nrm.length > 0 && trp.length > 0 && end.length > 0, 'all three chests draw');
  ok(trp !== nrm, 'a trapped chest is NOT drawn in the normal chest\'s sheet');
  ok(end !== nrm && end !== trp, 'an ender chest is its own third sheet');
  ok(ER.mobGeomFor('chest', 'chest#1') !== ER.mobGeomFor('chest', null), 'chest#1 is packed (not the fallback)');
  ok(ER.mobGeomFor('chest', 'chest#2') !== ER.mobGeomFor('chest', null), 'chest#2 is packed (not the fallback)');
  const nL = picT('chest', V.left), tL = picT('trapped_chest', V.left);
  const nR = picT('chest', V.right), tR = picT('trapped_chest', V.right);
  ok(nL.length > 0 && tL !== nL && tR !== nR, 'both halves of a trapped DOUBLE chest wear the trapped double sheet');
  // both directions: a plain chest must still draw the BASE sheet, byte-for-byte, with no texKey
  ok(ER.beWorldItem(put(0, 70, 0, SR.stateOf('chest'), 'chest'), 1).texKey === null, 'a plain chest asks for no family member');
  // the Christmas swap: every chest but the ender one, singles and doubles, off the calendar
  ER.christmasOverride = true;
  const xN = picT('chest'), xT = picT('trapped_chest'), xE = picT('ender_chest'), xL = picT('chest', V.left);
  ER.christmasOverride = false;
  ok(xN !== nrm && xN === xT, 'at Christmas a chest and a trapped chest wear the SAME Christmas sheet');
  ok(xE === end, 'but an ender chest stays an ender chest (getChestTexture asks ender FIRST)');
  ok(xL !== nL && ER.beWorldItem(put(0, 70, 0, SR.withProp(SR.stateOf('chest'), P_.type, V.left), 'chest'), 1).texKey === null,
     'a Christmas double half differs, and outside Christmas asks for no member');
  const sameDay = (m, d) => ER.isChristmasDate(new Date(2026, m - 1, d));
  ok(sameDay(12, 24) && sameDay(12, 26) && !sameDay(12, 23) && !sameDay(12, 27), 'the window is 24..26 December inclusive');
  okAv((() => {
    const saved = ER.BE_WORLD.trapped_chest.variant;
    ER.BE_WORLD.trapped_chest.variant = 0;
    const same = picT('trapped_chest') === nrm;
    ER.BE_WORLD.trapped_chest.variant = saved;
    return same;
  })(), 'anti-vacuity: drop the trapped chest\'s material and it draws the normal sheet again');
}

// ═══════════════ 6. the banner (#1172): pose, dye, patterns, per-instance atlas slice ═══════
console.log('\n 6. a banner stands and hangs, wears its dye and its patterns');
{
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  // an Atlas stand-in with the real pool contract (06_atlas.js dynTake/dynFree/dynWrite; dyncheck holds the real one)
  const POOL = 64, written = new Map(), used = new Set();
  M.Atlas = {
    dynTile0: 9000, dynTiles: POOL,
    dynTake() { for (let i = 0; i < POOL; i++) if (!used.has(9000 + i)) { used.add(9000 + i); return 9000 + i; } return -1; },
    dynFree(t) { used.delete(t); },
    dynWrite(t, rgba) { written.set(t, Uint8Array.from(rgba)); }
  };
  M.Behave = M.Behave || {};
  // no DOM here, so no Gui sheets: synthetic 64x64 sheets stand in for entity/banner_base and entity/banner/<name>
  // (the composite maths is BE.composite's own, which becheck/bemodelcheck hold to the real sheets)
  const sheet = (fill) => { const d = new Uint8ClampedArray(64 * 64 * 4); for (let i = 0; i < 4096; i++) { const c = fill(i % 64, (i / 64) | 0); d.set(c, i * 4); } return { w: 64, h: 64, data: d }; };
  const SHEETS = { be_banner: sheet(() => [200, 200, 200, 255]) };
  for (const [i, n] of Object.keys(BEM.PATTERN_CODES).entries())
    SHEETS['bp_' + BEM.PATTERN_CODES[n]] = sheet((x, y) => ((x * 3 + y * (i + 2)) % 5 < 2) ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  BEM.texData = (n) => SHEETS[n] || null;
  BEM.dye = BEM.dye || Object.fromEntries(BEM.DYE_IDS.map((n, i) => [n, 0x101010 * (i + 1) + i]));
  ok(ER.BE_WORLD.banner && ER.BE_WORLD.banner.layer === 'banner', 'the banner is on the DRAWN table');
  ok(!ER.BE_WORLD_OWED.some((t) => /^banner\b/.test(t)), 'and no longer on the owed list');

  const draw = (name, props, patterns) => {
    ER.bannerClear(); written.clear(); used.clear();
    CELLS.clear(); BEs.clear();
    let st = SR.stateOf(name);
    for (const [k, v] of props) st = SR.withProp(st, P_[k], v);
    const e = put(0, 70, 0, st, 'banner');
    e.patterns = patterns || [];
    const b = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
    return { e, b };
  };
  const verts = (b) => {
    const w = new Uint32Array(b.buf, M.Mesher.readHeader(b.buf).modelOff[0]);
    const out = [];
    for (let q = 0; q < b.quads[CFG.LAYER_OPAQUE]; q++) for (let v = 0; v < 4; v++) {
      const o = q * 16 + v * 4;
      out.push([((w[o] << 16) >> 16) / U, (w[o] >> 16) / U, ((w[o + 1] << 16) >> 16) / U, w[o + 1] >>> 16]);
    }
    return out;
  };
  // the flag's front plane juts out past the pole and bar's: max + min of the extent along (dx,dz) about the
  // model origin (the cell centre, shifted `back` against the facing for a wall banner) is positive when it faces that way
  const front = (b, dx, dz, back) => {
    const d = verts(b).map((p) => (p[0] - 0.5) * dx + (p[2] - 0.5) * dz + back);
    return Math.max(...d) + Math.min(...d);
  };
  const mean = (b) => { const v = verts(b); let x = 0, y = 0, z = 0; for (const p of v) { x += p[0]; y += p[1]; z += p[2]; } return [x / v.length, y / v.length, z / v.length]; };
  const rotName = (n) => V && R.valueNames ? String(n) : String(n);
  const rv = (n) => R.valueNames.indexOf(String(n));

  // standing: rotation 0 faces south, 4 west, 8 north, 12 east (the flag sits in FRONT of the pole)
  const FACE = [[0, 0, 1], [4, -1, 0], [8, 0, -1], [12, 1, 0]];
  for (const [rot, dx, dz] of FACE) {
    const { b } = draw('white_banner', [['rotation', rv(rot)]]);
    ok(!!b && b.drawn === 1, `a standing banner (rotation ${rot}) is drawn`);
    if (!b) continue;
    const lean = front(b, dx, dz, 0);
    ok(lean > 0.02, `rotation ${rot}: the flag stands in front of the pole on the (${dx},${dz}) side (${lean.toFixed(3)})`);
  }
  const stand = draw('white_banner', [['rotation', rv(0)]]);
  const ys = verts(stand.b).map((p) => p[1]), ymin = Math.min(...ys), ymax = Math.max(...ys);
  ok(ymax - ymin > 1.7 && ymax - ymin < 1.9, `the standing banner is 1.75 blocks tall (${(ymax - ymin).toFixed(3)})`);
  // wall: hangs against the wall it is on, pole hidden
  const WALL = [['south', 0, 1], ['north', 0, -1], ['east', 1, 0], ['west', -1, 0]];
  for (const [f, dx, dz] of WALL) {
    const { b } = draw('white_wall_banner', [['facing', V[f]]]);
    ok(!!b && b.drawn === 1, `a wall banner facing ${f} is drawn`);
    if (!b) continue;
    const lean = front(b, dx, dz, 0.4375);
    ok(lean > 0.02, `facing ${f}: its flag faces (${dx},${dz}), hung 7/16 back from the cell centre (${lean.toFixed(3)})`);
    const wy = verts(b).map((p) => p[1]), span = Math.max(...wy) - Math.min(...wy);
    ok(span > 1.6 && span < 1.72, `facing ${f}: no pole - bar to flag foot is 1.667 blocks, not the pole's 1.833 (${span.toFixed(3)})`);
  }

  // the dye reaches the pixels, and the patterns do too
  const px = (name, pats) => { draw(name, [['rotation', 0]].map(([k]) => [k, rv(0)]), pats); return [...written.values()].map((a) => Array.from(a).join(',')).join('|'); };
  const white = px('white_banner'), red = px('red_banner'), blue = px('blue_banner');
  ok(white.length > 0 && red !== white && blue !== red, 'each dye writes its own pixels');
  const striped = px('white_banner', [{ Pattern: 'cr', Color: 14 }]);
  ok(striped !== white, 'a pattern layer changes the flag pixels');
  const two = px('white_banner', [{ Pattern: 'cr', Color: 14 }, { Pattern: 'bo', Color: 11 }]);
  ok(two !== striped, 'a second layer changes them again');
  ok(px('white_banner', [{ Pattern: 'nonsense', Color: 3 }]) === white, 'an unknown pattern id is ignored');
  ok(Math.max(...[...written.keys()]) >= 9000, 'the pixels land on dynamic atlas tiles');

  // the geometry is the packed banner's, with the flag re-pointed at the dynamic tiles
  const key = ER.beWorldItem(draw('red_banner', [['rotation', rv(0)]]).e, 1).texKey;
  const GP = ER.mobGeomFor('banner', null), GD = ER.mobGeomFor('banner', key);
  ok(GD !== GP && GD[0] === GP[0] && GD[2] === GP[2] && GD[1] !== GP[1], 'only the flag is cloned; the pole and bar keep their packed slices');
  ok(GD[1].every((f) => f.every((s) => s.tile >= 9000)), 'every flag slice points at a dynamic tile');
  ok(ER.mobQuadCount('banner', key) === ER.mobQuadCount('banner', null), 'the clone costs the same quads');

  // sharing, recycling, exhaustion
  ER.bannerClear(); used.clear();
  const eA = put(0, 70, 0, SR.stateOf('red_banner'), 'banner'); eA.patterns = [];
  const k1 = ER.bannerTexKey('red', []), n1 = used.size, k2 = ER.bannerTexKey('red', []);
  ok(k1 === k2 && used.size === n1, 'the same look is one slice, not two');
  ER.bannerClear();
  ok(used.size === 0, 'clearing hands every dynamic tile back');
  let got = 0; ER.bannerBeginFrame();
  for (let i = 0; i < 16; i++) if (ER.bannerTexKey(BEM.DYE_IDS[i], [])) got++;
  ok(got >= 6 && got <= 16, `a pool of ${POOL} holds several looks at once (${got})`);
  ER.bannerBeginFrame();
  ok(!!ER.bannerTexKey('red', [{ Pattern: 'cr', Color: 3 }]), 'a look from an earlier frame is recycled for a new one');
  ER.bannerClear();
  const fill = []; while (M.Atlas.dynTake() >= 0) fill.push(1);
  ok(ER.bannerTexKey('red', []) === null && used.size === POOL, 'with the pool exhausted a banner is skipped and leaks no tiles');
  used.clear();

  // the sway: rest values, and the cycle moves
  const fl = BEM.layer('banner').parts.find((q) => q.n === 'flag');
  ok(fl.rx === 0 && fl.py === 0, `the flag's rest pitch and pivotY are 0 (${fl.rx}, ${fl.py}), so the delta is vanilla's assignment`);
  const a0 = ER.beBannerAnim({ x: 0, y: 0, z: 0 }, 0).deltaFor('flag'), a1 = ER.beBannerAnim({ x: 0, y: 0, z: 0 }, 25).deltaFor('flag');
  ok(Math.abs(a0.rx - (-0.0125 + 0.01) * Math.PI) < 1e-9 && a0.dpy === -32, 'phase 0: pitch (-0.0125+0.01)pi, pivotY -32');
  ok(Math.abs(a1.rx - (-0.0125) * Math.PI) < 1e-9, 'phase 25: the cosine is zero');

  okAv((() => {
    const saved = ER.BE_WORLD.banner; delete ER.BE_WORLD.banner;
    const { b } = draw('white_banner', [['rotation', rv(0)]]);
    ER.BE_WORLD.banner = saved; return b === null;
  })(), 'anti-vacuity: take the banner off the drawn table and the frame is empty again');
  okAv((() => {
    const real = ER.beBannerAnim;
    const { b } = draw('white_wall_banner', [['facing', V.south]]);
    const m = mean(b);
    const savedS = ER.BANNER_SCALE; ER.BANNER_SCALE = 1;
    const { b: b2 } = draw('white_wall_banner', [['facing', V.south]]);
    ER.BANNER_SCALE = savedS;
    return JSON.stringify(mean(b2)) !== JSON.stringify(m) && real === ER.beBannerAnim;
  })(), 'anti-vacuity: the banner scale reaches the geometry');
  okAv((() => {
    const saved = BEM.composite; BEM.composite = (base, tint) => saved(base, tint, []);
    const a = px('white_banner', [{ Pattern: 'cr', Color: 14 }]); BEM.composite = saved;
    return a === white;
  })(), 'anti-vacuity: drop the pattern layers and the flag is the plain dyed one again');
  okAv((() => {
    const sb = draw('white_wall_banner', [['facing', V.south]]).b, nb = draw('white_wall_banner', [['facing', V.north]]).b;
    return front(sb, 0, 1, 0.4375) > 0.02 && front(sb, 0, -1, -0.4375) < 0 && front(nb, 0, -1, 0.4375) > 0.02;
  })(), 'anti-vacuity: south and north wall banners hang on opposite sides');
}

// ═══════════════ 7. the campfire (#5501): up to four items lying on the grill ═══════════════
console.log('\n 7. a campfire shows what it is cooking');
{
  if (!M.Items.ready) {
    const A = MCLITE_ROOT + 'assets/';
    M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'),
                   itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes });
  }
  const beef = M.Items.of('beef');
  const mk = (facing, slots) => {
    CELLS.clear(); BEs.clear();
    const st = SR.withProp(SR.stateOf('campfire'), P_.facing, facing);
    const e = put(0, 70, 0, st, 'campfire');
    slots.forEach((n, i) => { if (n) e.items[i] = { i: beef, n: 1 }; });
    return { e, st };
  };
  const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  const { e, st } = mk(V.north, [1]);
  const it = ER.campfireItems(e, st);
  ok(it.length === 1 && it[0].campfireSlot === 0, 'one cooking item draws one entry; empty slots draw nothing');
  // hand-computed: north, slot 0 -> dir north (180): Ry(-180) Rx(90) = [-1,0,0, 0,0,-1, 0,-1,0]; times 0.375 * 0.5
  const want = [-1, 0, 0, 0, 0, -1, 0, -1, 0].map((v) => v * 0.1875);
  ok(it.length && near(it[0].m, want), 'slot 0 facing north: the quad matrix is the hand-computed vanilla one');
  ok(it.length && near([it[0].x, it[0].y, it[0].z], [0.8125, 70.44921875, 0.765625]),
     'and it sits at (0.5,0.44921875,0.5) + B*(-0.3125,-0.3125+0.375*2/16,0)');
  const f4 = mk(V.north, [1, 1, 1, 1]), all = ER.campfireItems(f4.e, f4.st);
  ok(all.length === 4 && new Set(all.map((q) => q.m.join())).size === 4, 'four items face four different ways');
  ok((() => { const f0 = mk(V.north, [0, 0, 0, 0]); return ER.campfireItems(f0.e, f0.st).length === 0; })(), 'an empty campfire draws nothing');
  mk(V.north, [1]);
  const built = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
  ok(!!built && built.drawn === 1, 'the frame builder draws it');
  ok(!ER.BE_WORLD_OWED.some((t) => /campfire/.test(t)), 'and the campfire is off the owed list');
  okAv((() => {
    const saved = ER.CAMPFIRE_ROT; ER.CAMPFIRE_ROT = [0, 0, 0, 0];
    const f = mk(V.north, [1]), bad = ER.campfireItems(f.e, f.st); ER.CAMPFIRE_ROT = saved;
    return bad.length === 1 && !near(bad[0].m, want);
  })(), 'anti-vacuity: break the slot direction table and the matrix is no longer the vanilla one');
  okAv((() => {
    const saved = ER.campfireItems; ER.campfireItems = () => [];
    mk(V.north, [1]); const b = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1); ER.campfireItems = saved;
    return !b;
  })(), 'anti-vacuity: delete the rule and the campfire draws nothing');
}

// ═══════════════ 8. the book (#5502): lectern HAS_BOOK, the table's book tracks the player ═══════
console.log('\n 8. the lectern shows its book, the enchanting table book turns to the player');
{
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  const verts = (b) => {
    const w = new Uint32Array(b.buf, Me.readHeader(b.buf).modelOff[0]);
    const out = [];
    for (let q = 0; q < b.quads[CFG.LAYER_OPAQUE]; q++) for (let v = 0; v < 4; v++) {
      const o = q * 16 + v * 4;
      out.push([((w[o] << 16) >> 16) / U, (w[o] >> 16) / U, ((w[o + 1] << 16) >> 16) / U]);
    }
    return out;
  };
  const rv = (n) => R.valueNames.indexOf(String(n));
  const drawBook = (name, props, type) => {
    CELLS.clear(); BEs.clear();
    let st = SR.stateOf(name);
    for (const [k, v] of props) st = SR.withProp(st, P_[k], v);
    put(0, 70, 0, st, type);
    return ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
  };
  ok(ER.BE_WORLD.lectern && ER.BE_WORLD.enchanting_table, 'the lectern and the enchanting table are on the DRAWN table');
  ok(!ER.BE_WORLD_OWED.some((t) => /lectern|enchanting/.test(t)), 'and off the owed list');
  const empty = drawBook('lectern', [['has_book', rv('false')], ['facing', V.north]], 'lectern');
  const full = drawBook('lectern', [['has_book', rv('true')], ['facing', V.north]], 'lectern');
  ok(!empty || empty.drawn === 0 || !empty.quads[CFG.LAYER_OPAQUE], 'a lectern without HAS_BOOK draws no book');
  ok(!!full && full.drawn === 1 && full.quads[CFG.LAYER_OPAQUE] > 0, 'a lectern with HAS_BOOK draws the book quads');
  const lv = verts(full);
  const top = Math.max(...lv.map((p) => p[1])), bot = Math.min(...lv.map((p) => p[1]));
  say('lectern book y ' + bot + '..' + top);
  ok(bot > 0.85 && top < 1.7, `the book rests on the lectern top (y ${bot.toFixed(2)}..${top.toFixed(2)})`);
  const mean = (vs, i) => vs.reduce((a, p) => a + p[i], 0) / vs.length;
  // the matrix: the facing turns the book about the block centre (Ry(-rotateYClockwise)): north vs south mirror
  const south = verts(drawBook('lectern', [['has_book', rv('true')], ['facing', V.south]], 'lectern'));
  ok(Math.abs((mean(lv, 2) - 0.5) + (mean(south, 2) - 0.5)) < 0.02 && Math.abs(mean(lv, 2) - mean(south, 2)) > 0.01, 'north and south lecterns put the book on opposite sides of the cell centre');

  // the table: the book yaw follows the player (EnchantingTableBlockEntity.tick eases field_11964 to the angle)
  const lookAt = (px, pz) => {
    const st = SR.stateOf('enchanting_table');
    CELLS.clear(); BEs.clear();
    const e = put(0, 70, 0, st, 'enchanting_table');
    M.Player = { ex: px, ey: 70, ez: pz };
    for (let i = 0; i < 12; i++) { M.Behave.gameTime = i; ER.beWorldItem(e, 0); }
    delete M.Player;
    return e;
  };
  M.Behave = M.Behave || {};
  const ea = lookAt(2.5, 0.5), eb = lookAt(0.5, 2.5);
  const want = (px, pz) => Math.atan2(pz - 0.5, px - 0.5);
  ok(Math.abs(ea.fl2 - want(2.5, 0.5)) < 1e-6 && Math.abs(eb.fl2 - want(0.5, 2.5)) < 1e-6, 'the target angle is atan2(dz, dx) to the player');
  ok(Math.abs(ea.fl4 - ea.fl2) < 0.01 && Math.abs(eb.fl4 - eb.fl2) < 0.01 && Math.abs(ea.fl4 - eb.fl4) > 1, 'the book yaw eases onto the player and differs for two players');
  ok(ea.nextPageTurningSpeed === 1, 'the cover opens (turning speed 1) with a player in range');
  const tb = drawBook('enchanting_table', [], 'enchanting_table');
  ok(!!tb && tb.drawn === 1 && tb.quads[CFG.LAYER_OPAQUE] > 0, 'an enchanting table draws its book');
  const tv = verts(tb);
  ok(Math.min(...tv.map((p) => p[1])) > 0.7 && Math.max(...tv.map((p) => p[1])) < 1.5, 'and it hovers above the table top');

  okAv((() => { const s = ER.BE_WORLD.lectern; delete ER.BE_WORLD.lectern;
    const b = drawBook('lectern', [['has_book', rv('true')], ['facing', V.north]], 'lectern'); ER.BE_WORLD.lectern = s; return !b || b.drawn === 0; })(),
    'anti-vacuity: take the lectern off the drawn table and the book is gone');
  okAv((() => { const s = ER.bookItem; ER.bookItem = () => null;
    const b = drawBook('enchanting_table', [], 'enchanting_table'); ER.bookItem = s; return !b || b.drawn === 0; })(),
    'anti-vacuity: delete the book rule and the table book is gone');
  okAv((() => { const s = ER.bookTick; ER.bookTick = function (e) { e.bticks++; };
    const e = lookAt(0.5, 2.5); ER.bookTick = s; return Math.abs(e.fl4 - want(0.5, 2.5)) > 0.1; })(),
    'anti-vacuity: without the tick rule the book does not track the player');
}

// ═══════════════ 9. the conduit (#5499): shell when inactive; cage + 2 wind + eye when active ═════
console.log('\n 9. the conduit draws its shell, or cage + wind + eye when active');
{
  ok(ER.BE_WORLD.conduit && !ER.BE_WORLD_OWED.some((t) => /conduit/.test(t)), 'the conduit is on the DRAWN table and off the owed list');
  const mkc = (active, eyeOpen, ticks) => {
    CELLS.clear(); BEs.clear();
    put(0, 70, 0, SR.stateOf('conduit'), 'conduit');
    const e = BEs.get(0, 70, 0);
    e.active = active; e.eyeOpen = eyeOpen; e.ticks = ticks; e.ticksActive = ticks;
    return e;
  };
  const keys = (e) => ER.conduitParts(e, 0, { yaw: 0, pitch: 0 }).map((q) => q.key + ':' + q.layer + ':' + q.texKey).join(' ');
  const inact = mkc(false, false, 0);
  ok(keys(inact) === 'base:conduit:null', 'inactive: just the base shell (' + keys(inact) + ')');
  const act = mkc(true, false, 0);
  ok(keys(act) === 'cage:conduit_cage:null wind:conduit_wind:null wind2:conduit_wind:null eye:conduit_eye:conduit_eye#1', 'active, eye closed: cage + 2 wind + closed eye');
  ok(/eye:conduit_eye:null$/.test(keys(mkc(true, true, 0))), 'eye open: the open_eye sheet');
  ok(/wind:conduit_wind:conduit_wind#1/.test(keys(mkc(true, false, 66))), 'ticks 66..131: the vertical wind sheet');
  const b = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
  ok(!!b && b.drawn === 4, 'an active conduit draws four parts (' + (b && b.drawn) + ')');
  const m0 = ER.conduitParts(mkc(true, false, 10), 0, null)[0].m, m1 = ER.conduitParts(mkc(true, false, 12), 0, null)[0].m;
  const tr = (m) => m[0] + m[4] + m[8];
  const ang = (m) => Math.acos(Math.max(-1, Math.min(1, (tr(m) - 1) / 2)));
  ok(Math.abs(ang(m1) - ang(m0) - 2 * 0.0375) < 1e-4, 'two ticks later the cage has turned by exactly 2 * 0.0375 rad (getRotation)');
  okAv((() => { const s = BEs.conduitRotation; BEs.conduitRotation = () => 0;
    const a = ER.conduitParts(mkc(true, false, 10), 0, null)[0].m, c = ER.conduitParts(mkc(true, false, 12), 0, null)[0].m;
    BEs.conduitRotation = s; return Math.abs(ang(c) - ang(a)) < 1e-9; })(), 'anti-vacuity: delete the rotation and the cage stands still');
  okAv((() => { const s = ER.BE_WORLD.conduit; delete ER.BE_WORLD.conduit; const v = ER.beWorldItem(mkc(true, false, 0), 0);
    ER.BE_WORLD.conduit = s; return !v; })(), 'anti-vacuity: take the conduit off the drawn table and it has no rule');
}

// ═══════════════ 11. #6373 the sign: 8 woods x 16 rotations + 4 wall facings ═════════════════
console.log('\n 11. placed standing and wall signs (SignBlockEntityRenderer model)');
{
  const U = CFG.MODEL_UNITS_PER_BLOCK, P_ = R.PROP;
  const WOODS = ['oak', 'spruce', 'birch', 'acacia', 'jungle', 'dark_oak', 'crimson', 'warped'];
  const rv = (n) => R.valueNames.indexOf(String(n));
  const sign = (name, props) => {
    CELLS.clear(); BEs.clear();
    let st = SR.stateOf(name);
    for (const [k, v] of props) st = SR.withProp(st, P_[k], v);
    put(0, 70, 0, st, 'sign');
    return ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
  };
  const verts = (b) => {
    const w = new Uint32Array(b.buf, M.Mesher.readHeader(b.buf).modelOff[0]);
    const out = [];
    for (let q = 0; q < b.quads[CFG.LAYER_OPAQUE]; q++) for (let v = 0; v < 4; v++) {
      const o = q * 16 + v * 4;
      out.push([((w[o] << 16) >> 16) / U, (w[o] >> 16) / U, ((w[o + 1] << 16) >> 16) / U]);
    }
    const real = [];
    for (let q = 0; q < out.length; q += 4) if (out.slice(q, q + 4).some((p) => p[0] || p[1] || p[2])) real.push(...out.slice(q, q + 4));
    return real;
  };
  ok(!ER.BE_WORLD_OWED.some((t) => /^sign\b/.test(t)) && ER.BE_WORLD.sign && ER.BE_WORLD.sign.layer === 'sign', 'the sign is on the DRAWN table, off the owed list');
  const geomOk = (w) => !!ER.mobGeomFor('sign', ER.SIGN_WOODS.indexOf(w) ? 'sign#' + ER.SIGN_WOODS.indexOf(w) : null);
  for (const w of WOODS) {
    ok(geomOk(w), `${w}: the sign layer has its packed sheet`);
    let bad = 0, first = null;
    for (let r = 0; r < 16; r++) {
      const b = sign(w + '_sign', [['rotation', rv(r)]]);
      if (!b || b.drawn !== 1) { bad++; continue; }
      const v = verts(b), ys = v.map((p) => p[1]);
      // board + stick: 14/16*2/3 + ... the stick runs to the cell's floor-ish; span 1.33 blocks stays within one cell
      if (!(Math.max(...ys) - Math.min(...ys) > 0.9)) bad++;
      if (r === 0) first = v;
    }
    ok(bad === 0, `${w}_sign: all 16 rotations draw a board and stick`);
  }
  // rotation 0 faces south: the board's broad face juts toward +Z; rotation 8 toward -Z
  const lean = (b) => { const z = verts(b).map((p) => p[2] - 0.5); return Math.max(...z) + Math.min(...z); };
  const l0 = lean(sign('oak_sign', [['rotation', rv(0)]])), l8 = lean(sign('oak_sign', [['rotation', rv(8)]]));
  ok(Math.abs(l0) < 1e-6 && Math.abs(l8) < 1e-6, 'standing: board and stick are symmetric about the cell centre plane');
  const spanX = (b) => { const x = verts(b).map((p) => p[0]); return Math.max(...x) - Math.min(...x); };
  const spanZ = (b) => { const z = verts(b).map((p) => p[2]); return Math.max(...z) - Math.min(...z); };
  ok(Math.abs(spanX(sign('oak_sign', [['rotation', rv(0)]])) - 1) < 0.01 && spanZ(sign('oak_sign', [['rotation', rv(0)]])) < 0.2, 'rotation 0: the 24-wide board runs along X');
  ok(Math.abs(spanZ(sign('oak_sign', [['rotation', rv(4)]])) - 1) < 0.01, 'rotation 4: a quarter turn, the board runs along Z');
  for (const w of WOODS) for (const f of ['south', 'west', 'north', 'east']) {
    const b = sign(w + '_wall_sign', [['facing', V[f]]]);
    ok(!!b && b.drawn === 1, `${w}_wall_sign facing ${f} is drawn`);
  }
  // wall: stick hidden (board only, 12/16*2/3 = 0.5 tall), hung 7/16 back against the wall
  for (const [f, dx, dz] of [['south', 0, 1], ['north', 0, -1], ['east', 1, 0], ['west', -1, 0]]) {
    const b = sign('oak_wall_sign', [['facing', V[f]]]);
    const v = verts(b), ys = v.map((p) => p[1]);
    ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 0.5) < 0.07, `wall ${f}: no stick, the board is 0.5 tall`);
    const c = v.reduce((a, p) => a + (p[0] - 0.5) * dx + (p[2] - 0.5) * dz, 0) / v.length;
    ok(Math.abs(c + 0.4375) < 0.05, `wall ${f}: the board sits 7/16 back against the wall behind it (${c.toFixed(3)})`);
  }
  okAv((() => { const s = ER.BE_WORLD.sign; delete ER.BE_WORLD.sign; const b = sign('oak_sign', [['rotation', rv(0)]]); ER.BE_WORLD.sign = s; return !b || b.drawn === 0; })(),
       'anti-vacuity: take the sign off the drawn table and nothing is drawn');
  okAv((() => { const g = ER.mobGeomFor; ER.mobGeomFor = (l, t) => (t === 'sign#6' ? null : g(l, t)); const bad = !geomOk('crimson'); ER.mobGeomFor = g; return bad; })(),
       'anti-vacuity: a wood whose layer is missing fails the sheet check');
}

// ═══════════════ 10. the placed bed (#6372): facing x part x 16 dyes ════════════════════════════
console.log('\n 10. a placed bed is drawn: bed_head / bed_foot, dye sheet, facing, 9/16 high');
{
  ok(ER.BE_WORLD.bed && !ER.BE_WORLD_OWED.some((t) => /^bed\b/.test(t)), 'the bed is on the DRAWN table and off the owed list');
  const DYES = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
                'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
  const ROT = { south: 0, west: 90, north: 180, east: 270 };
  const bedAt = (dye, facing, part) => {
    CELLS.clear(); BEs.clear();
    const b = M.Reg.id[DYES[dye] + '_bed'];
    let st = 0;
    for (let q = M.Reg.realFirst[b]; q < M.Reg.realFirst[b + 1]; q++) {
      if (M.Reg.valueNames[SR.propValue(q, M.Reg.PROP.facing)] === facing && M.Reg.valueNames[SR.propValue(q, M.Reg.PROP.part)] === part) { st = q; break; }
    }
    put(0, 70, 0, st, 'bed');
    return ER.beWorldItem(BEs.get(0, 70, 0), 0);
  };
  const ext = (it) => {   // the head/foot main box (16 x 16 x 6 px) through the item's own matrix + origin
    const R = it.anim.sleepPose.R, lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 0.375]) for (let a = 0; a < 3; a++) {
      const w = it.raw[a] - [0, 70, 0][a] + R[a * 3] * x + R[a * 3 + 1] * y + R[a * 3 + 2] * z;
      lo[a] = Math.min(lo[a], w); hi[a] = Math.max(hi[a], w);
    }
    return { lo, hi };
  };
  let bad = [], n = 0;
  for (let d = 0; d < 16; d++) for (const f of Object.keys(ROT)) for (const part of ['head', 'foot']) {
    const it = bedAt(d, f, part); n++;
    const want = (part === 'head' ? 'bed_head' : 'bed_foot');
    if (!it) { bad.push(DYES[d] + ' ' + f + ' ' + part + ': no item'); continue; }
    const x = ext(it), tag = DYES[d] + ' ' + f + ' ' + part;
    if (it.layer !== want) bad.push(tag + ' layer ' + it.layer);
    if (it.texKey !== (d ? want + '#' + d : null)) bad.push(tag + ' texKey ' + it.texKey);
    if (Math.abs(x.hi[1] - 0.5625) > 1e-6 || Math.abs(x.lo[1] - 0.1875) > 1e-6) bad.push(tag + ' height ' + x.lo[1] + '..' + x.hi[1]);
    if (x.lo[0] < -1e-6 || x.hi[0] > 1 + 1e-6 || x.lo[2] < -1e-6 || x.hi[2] > 1 + 1e-6 || Math.abs(x.hi[0] - x.lo[0] - 1) > 1e-6 || Math.abs(x.hi[2] - x.lo[2] - 1) > 1e-6) bad.push(tag + ' cell ' + x.lo + '..' + x.hi);
    const R = it.anim.sleepPose.R, W = ER.bedPose(ROT[f]).R;
    if (R.some((v, i) => Math.abs(v - W[i]) > 1e-9)) bad.push(tag + ' rotation');
  }
  ok(bad.length === 0, n + ' beds (16 dyes x 4 facings x head/foot): layer, sheet, cell, 9/16 height, rotation - ' + bad.slice(0, 3).join('; '));
  // the four facings are four DIFFERENT rotations (a pillow end faces a different way each time)
  const rots = new Set(Object.keys(ROT).map((f) => ER.bedPose(ROT[f]).R.map((v) => v.toFixed(3)).join()));
  ok(rots.size === 4, 'four facings give four distinct rotations');
  const b = (() => { bedAt(14, 'east', 'head'); return ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1); })();
  ok(!!b && b.drawn === 1, 'a placed bed draws one part through ER.build (' + (b && b.drawn) + ')');
  const items = (() => { bedAt(3, 'north', 'foot'); return ER.beWorldVisible(0.5, 70.5, 0.5, 0); })();
  ok(items.length === 1 && items[0].layer === M.CFG.LAYER_OPAQUE, 'the bed is on the solid (no cutout) pass');
  okAv((() => { const s = ER.BE_WORLD.bed; delete ER.BE_WORLD.bed; const v = bedAt(0, 'south', 'head');
    ER.BE_WORLD.bed = s; return !v; })(), 'anti-vacuity: take the bed off the drawn table and nothing is drawn');
  okAv((() => { const s = ER.bedPose; ER.bedPose = (r) => s(0); const a = bedAt(0, 'east', 'head');
    ER.bedPose = s; return Math.abs(a.anim.sleepPose.R[0] - ER.bedPose(270).R[0]) > 0.5; })(), 'anti-vacuity: ignore the facing and the rotation check fails');
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` beworldcheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' a chest is a thing you can see.');
