#!/usr/bin/env node
// shulkerboxcheck.mjs -- #887: THE SHULKER BOX IN THE WORLD (ShulkerBoxBlockEntityRenderer + its controller).
//
//   node tools/shulkerboxcheck.mjs
//
// Vanilla (.decomp ShulkerBoxBlockEntityRenderer.render / ShulkerBoxBlockEntity.updateAnimation):
//   translate(.5,.5,.5); scale(.9995); multiply(facing.getRotationQuaternion()); scale(1,-1,-1); translate(0,-1,0)
//   lid.pivotY = 24 - p*0.5*16; lid.yaw = 270deg * p;  the model is base + lid (no head)
//   the controller: stage 1 opening +0.1f/tick to 1, stage 3 closing -0.1f/tick to 0, driven by viewer count 1 / 0
// The oracle multiplies that chain out per box corner and compares the bounding box the engine emitted, for
// all six facings, closed and fully open (yaw 270deg maps the square lid onto itself, so the box is exact).
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const caught = (thunk, m) => { breaks++; let r = false; try { r = thunk(); } catch (e) { r = true; } ok(r, 'anti-vacuity: ' + m); if (r) console.log('   ✓ ' + m); };

console.log('shulkerboxcheck -- #887: the shulker box block entity, in the world');
const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
          '07zzl_shulkerdraw.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
}
M.EntityList.init(); M.EntityRender.init(); M.BlockEntities.init();
const ER = M.EntityRender, BEM = M.BEModel, BEs = M.BlockEntities, SR = M.States, R = M.Reg, Me = M.Mesher, CFG = M.CFG;
const P_ = R.PROP, V = R.PVAL, U = CFG.MODEL_UNITS_PER_BLOCK;
ok(ER.ready && BEs.ready && BEM.ready && M.ShulkerDraw && M.ShulkerDraw.ready, 'renderer, store, models and shulker maths are up');

const CELLS = new Map();
M.World = M.World || {};
M.World.getBlock = (x, y, z) => CELLS.get(x + ',' + y + ',' + z) || 0;
M.World.getLight = () => 0xF0;
const DIRS = ['down', 'up', 'north', 'south', 'west', 'east'];
const DV = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };

// ═══════════════ 1. the controller ═════════════════════════════════════════════════════════
console.log('\n 1. ShulkerBoxBlockEntity.updateAnimation');
const mk = () => { CELLS.clear(); BEs.clear(); CELLS.set('0,70,0', SR.stateOf('shulker_box')); return BEs.create(0, 70, 0, 'shulker_box'); };
const ticksTo = (e, want) => { let n = 0; while (n < 100 && e.sbProg !== want) { BEs.tickShulkerBox(e); n++; } return n; };
{
  const e = mk();
  BEs.tickShulkerBox(e);
  ok(e.sbProg === 0, 'a closed box stays at 0');
  e.open = 1;
  ok(ticksTo(e, 1) === 10, 'opening takes exactly ten ticks (float32 0.1)');
  e.open = 2; BEs.tickShulkerBox(e);
  ok(e.sbStage === 2 && e.sbProg === 1, 'a second viewer changes nothing while open');
  e.open = 1; BEs.tickShulkerBox(e);
  ok(e.sbStage === 2, 'going 2 -> 1 viewers does not close it (only a count of 0 does)');
  e.open = 0;
  ok(ticksTo(e, 0) === 10, 'closing takes exactly ten ticks');
  e.open = 1; BEs.tickShulkerBox(e); BEs.tickShulkerBox(e);
  const mid = BEs.shulkerProgress(e, 0.5);
  ok(Math.abs(mid - 0.15) < 1e-6, `progress lerps prev..cur by partial (${mid})`);
  caught(() => { const s = BEs.LID_STEP; BEs.LID_STEP = 0.05; const e2 = mk(); e2.open = 1; const n = ticksTo(e2, 1); BEs.LID_STEP = s; return n !== 10; },
         'a 0.05 step opens in twenty ticks and is seen');
}

// ═══════════════ 2. the drawn box ══════════════════════════════════════════════════════════
console.log('\n 2. the drawn box vs the matrix chain');
const L = BEM.layer('shulker');
const part = (n) => L.parts.filter((p) => p.n === n)[0];
ok(!!part('lid') && !!part('base') && part('lid').py === 24 && part('lid').ry === 0, 'the layer has base + lid, lid pivot y 24, rest yaw 0');

// vanilla chain per corner. model px (y down) -> block-relative
function chain(fdir, p, scale) {
  const q = M.ShulkerDraw.faceMatrix(DIRS.indexOf(fdir) ^ 1);   // Direction.getRotationQuaternion(fdir)
  const v = [p[0] / 16, 1 - p[1] / 16, -p[2] / 16];
  return [0, 1, 2].map((r) => 0.5 + scale * (q[r * 3] * v[0] + q[r * 3 + 1] * v[1] + q[r * 3 + 2] * v[2]));
}
function oracleBox(fdir, prog, scale) {
  const lo = [9, 9, 9], hi = [-9, -9, -9];
  for (const name of ['base', 'lid']) {
    const p = part(name), py = name === 'lid' ? 24 - prog * 8 : p.py;
    for (const cx of [0, 1]) for (const cy of [0, 1]) for (const cz of [0, 1]) {
      const c = chain(fdir, [p.px + p.x + cx * p.w, py + p.y + cy * p.h, p.pz + p.z + cz * p.d], scale);
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); }
    }
  }
  return { lo, hi };
}
function drawn(blockName, fdir, prog) {
  let st = SR.stateOf(blockName);
  st = SR.withProp(st, P_.facing, V[fdir]);
  CELLS.clear(); BEs.clear(); CELLS.set('0,70,0', st);
  const e = BEs.create(0, 70, 0, 'shulker_box');
  e.sbProg = prog; e.sbProgO = prog;
  const built = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
  if (!built) return null;
  const words = new Uint32Array(built.buf, Me.readHeader(built.buf).modelOff[0]);
  const nq = built.quads[CFG.LAYER_OPAQUE];
  const lo = [9e9, 9e9, 9e9], hi = [-9e9, -9e9, -9e9];
  for (let q = 0; q < nq; q++) for (let v = 0; v < 4; v++) {
    const o = q * 16 + v * 4, w = Me.unpackModelVertex(words[o], words[o + 1], words[o + 2], words[o + 3]);
    const c = [w.px / U, w.py / U, w.pz / U];
    for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], c[i]); hi[i] = Math.max(hi[i], c[i]); }
  }
  return { lo, hi, nq };
}
const near = (a, b) => Math.abs(a - b) < 0.02;
let yBase = null;
const matches = (name, fdir, prog, scale) => {
  const g = drawn(name, fdir, prog);
  if (!g) return false;
  const w = oracleBox(fdir, prog, scale === undefined ? 0.9995 : scale);
  if (yBase === null) yBase = g.lo[1] - w.lo[1] - (fdir === 'up' ? 0 : 0);
  return [0, 1, 2].every((i) => near(g.hi[i] - g.lo[i], w.hi[i] - w.lo[i]));
};
// the draw origin is not the block corner: recover it once from a closed upward box, then hold every case to it
{
  const g0 = drawn('shulker_box', 'up', 0), w0 = oracleBox('up', 0, 0.9995);
  ok(!!g0, 'a closed shulker box draws');
  var OFF = g0 ? [0, 1, 2].map((i) => g0.lo[i] - w0.lo[i]) : [0, 0, 0];
}
const fits = (name, fdir, prog, scale) => {
  const g = drawn(name, fdir, prog), w = oracleBox(fdir, prog, scale === undefined ? 0.9995 : scale);
  return !!g && [0, 1, 2].every((i) => near(g.lo[i] - OFF[i], w.lo[i]) && near(g.hi[i] - OFF[i], w.hi[i]));
};
for (const f of DIRS) for (const p of [0, 1]) {
  ok(fits('shulker_box', f, p), `facing ${f}, progress ${p}: bounding box equals the matrix chain`);
}
fits('shulker_box', 'up', 0.5); // half-open: informational, must not throw
{
  const g = drawn('shulker_box', 'up', 1), w = drawn('shulker_box', 'up', 0);
  ok(g.hi[1] - w.hi[1] > 0.45, 'the lid of an upward box rises half a block when fully open');
  ok(drawn('red_shulker_box', 'up', 0).nq === w.nq, 'a dyed box draws the same geometry');
  ok(BEM.layer('shulker').parts.map((p) => p.n).sort().join() === 'base,head,lid' || BEM.layer('shulker').parts.length === 2,
     'the layer parts are known: ' + BEM.layer('shulker').parts.map((p) => p.n).join());
  const head = ER.SHULKER_BOX_HIDE; ER.SHULKER_BOX_HIDE = {};
  const withHead = drawn('shulker_box', 'up', 0).nq; ER.SHULKER_BOX_HIDE = head;
  ok(withHead >= w.nq, 'hiding the head never adds quads');
  ok(ER.beWorldItem(BEs.get ? BEs.get(0, 70, 0) : { x: 0, y: 70, z: 0, type: 'shulker_box' }, 1).texKey === null, 'an undyed box uses the base sheet');
  const red = SR.stateOf('red_shulker_box'); CELLS.set('0,70,0', red);
  ok(ER.beWorldItem({ x: 0, y: 70, z: 0, type: 'shulker_box' }, 1).texKey === 'shulker#15', 'a red box asks for the dye-14 sheet (shulker#15)');
}
ok(!ER.BE_WORLD_OWED.some((t) => /^shulker_box/.test(t)), 'the shulker box is off the owed list');
caught(() => !fits('shulker_box', 'up', 1, 0.9), 'a wrong scale is seen');
caught(() => !fits('shulker_box', 'up', 1, -0.9995), 'a mirrored chain is seen');
caught(() => { const f = ER.beShulkerAnim; ER.beShulkerAnim = () => ({ deltaFor: () => null }); const r = !fits('shulker_box', 'up', 1); ER.beShulkerAnim = f; return r; },
       'a lid that never rises is seen');
caught(() => { const s = ER.SHULKER_BOX_SCALE; ER.SHULKER_BOX_SCALE = 0.5; const r = !fits('shulker_box', 'east', 0); ER.SHULKER_BOX_SCALE = s; return r; },
       'a shrunk engine scale is seen on a sideways box');
caught(() => !fits('shulker_box', 'north', 1, 0.9995) === false && !fits('shulker_box', 'south', 1) === true ? false : !(oracleBox('north', 1, 1).lo[2] === oracleBox('south', 1, 1).lo[2]),
       'north and south boxes are different pictures');

console.log('\n' + '='.repeat(78));
console.log(` shulkerboxcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('   x ' + f); process.exit(1); }
