#!/usr/bin/env node
// skullcheck.mjs -- #591 (KW-49-1): THE SIX SKULLS, IN EVERY VIEW.
//
//   node tools/skullcheck.mjs
//
// Dan: the zombie head's hotbar icon, its placed block and its hand were all wrong. One vanilla routine
// draws all of them -- `SkullBlockEntityRenderer.renderSkull(dir, yaw, ..)` (.decomp, read whole):
//     standing:  translate(0.5, 0, 0.5)                                yaw = 22.5 * state.ROTATION
//     wall:      translate(0.5 - fx * 0.25, 0.25, 0.5 - fz * 0.25)     yaw = 22.5 * (2 + facing.getHorizontal()) * 4
//     then       scale(-1, -1, 1); head.yaw = yaw
//   and an ITEM (`BuiltinModelItemRenderer`) is the standing case with yaw 180. `DragonHeadEntityModel.render`
//   wraps translate(0, -0.374375, 0) + scale(0.75) around its head.
// The oracle below is that matrix chain, multiplied out per point, and never the engine's own yaw sign.
//
//   1. the GUI icon (BE.render, `turn`): the FRONT face, the top and one side are visible -- not the back
//   2. the baked item geometry (be-geometry.json, used by the hand, the ground and the third person)
//      sits in the block, face outward, and every quad's direction matches its winding
//   3. the placed block (ER.build): all 16 standing rotations and the 4 wall facings put a marker on the
//      front of the head where the matrix chain puts it, at the wall's offset origin, dragon scaled
//   4. the roster: every skull block is drawn, and nothing else is claimed
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { decodePng } from './png.mjs';

const BREAK = process.argv.includes('--break');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
// a deliberate break: the same claim, run against data corrupted on purpose, must FAIL
const caught = (thunk, m) => { breaks++; let r = false; try { r = thunk(); } catch (e) { r = true; } ok(r, 'anti-vacuity: ' + m); if (r) console.log('   ✓ ' + m); };

console.log('skullcheck -- #591: the six skulls in the GUI, the hand and the world');

const M = loadEngine({
  extra: ['02g_items.js', '02f_tags.js', '07b_behaviour.js', '07c_blockentity.js',
          '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
          '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
}
M.EntityList.init();
M.EntityRender.init();
M.BlockEntities.init();
const ER = M.EntityRender, BE = M.BEModel, BEs = M.BlockEntities, SR = M.States, R = M.Reg, CFG = M.CFG;
const P_ = R.PROP, V = R.PVAL, Me = M.Mesher;
ok(ER.ready && BEs.ready && BE.ready, 'the renderer, the block-entity store and the model payload are up');

const LAYERS = ['player_head', 'zombie_head', 'creeper_head', 'skeleton_skull', 'wither_skeleton_skull', 'dragon_head'];
const BLOCKS = ['skeleton_skull', 'wither_skeleton_skull', 'zombie_head', 'player_head', 'creeper_head', 'dragon_head'];
const DEG = Math.PI / 180;

// ── the vanilla matrix chain, one point at a time (model pixels -> block-relative blocks) ────────
// head.render: pivot 0 -> Ry(yaw); dragon: p = 0.75 p + (0, -0.374375 * 16, 0); scale(-1,-1,1); translate(origin)
function vanilla(p, yawDeg, dragon, origin) {
  const h = yawDeg * DEG, c = Math.cos(h), s = Math.sin(h);
  let x = p[0] * c + p[2] * s, y = p[1], z = -p[0] * s + p[2] * c;
  if (dragon) { x *= 0.75; y = y * 0.75 - 0.374375 * 16; z *= 0.75; }
  return [origin[0] - x / 16, origin[1] - y / 16, origin[2] + z / 16];
}

// ═══════════════ 4. the roster ══════════════════════════════════════════════════════════════════
console.log('\n 4. every skull block is drawn');
{
  const want = [];
  for (const b of BLOCKS) want.push(b);
  for (const b of ['skeleton_wall_skull', 'wither_skeleton_wall_skull', 'zombie_wall_head', 'player_wall_head', 'creeper_wall_head', 'dragon_wall_head']) want.push(b);
  for (const n of want) {
    const st = SR.stateOf(n);
    ok(st > 0, `${n} is a block`);
    ok(!!ER.SKULL_BLOCKS && !!ER.SKULL_BLOCKS[n], `${n} is drawn by ER.SKULL_BLOCKS`);
    ok(!!ER.skullPose && !!ER.skullPose(st), `${n}'s state has a skull pose`);
  }
  ok(ER.SKULL_BLOCKS && Object.keys(ER.SKULL_BLOCKS).length === 12, 'and exactly twelve blocks are claimed');
  ok(!(ER.BE_WORLD_OWED || []).some((t) => /^skull/.test(t)), 'skulls are not on the owed list any more');
}

// ═══════════════ 3. the placed block ════════════════════════════════════════════════════════════
console.log('\n 3. the placed block: rotation, wall offset, dragon scale (ER.build vs the matrix chain)');
const CELLS = new Map();
M.World = M.World || {};
M.World.getBlock = (x, y, z) => CELLS.get(x + ',' + y + ',' + z) || 0;
M.World.getLight = () => 0xF0;
const U = CFG.MODEL_UNITS_PER_BLOCK;
// which part of a layer is "the head" whose front face we follow: the first undilated, unrotated cube
const headIdx = { skeleton_skull: 0, wither_skeleton_skull: 0, creeper_head: 0, zombie_head: 1, player_head: 1, dragon_head: 1 };
// the FRONT face (model -Z, ARCH face 5) of that part, found by its own atlas tile + uv rectangle, as the
// centre of its four vertices in blocks relative to the block corner; null when nothing drew
function placed(blockName, props, layer) {
  let st = SR.stateOf(blockName);
  for (const k of Object.keys(props || {})) st = SR.withProp(st, P_[k], V[String(props[k])]);
  CELLS.clear(); BEs.clear();
  CELLS.set('0,70,0', st);
  BEs.create(0, 70, 0, 'skull');
  const built = ER.build(0, 70, 0, 0.5, 70.5, 0.5, 1);
  if (!built) return null;
  const words = new Uint32Array(built.buf, Me.readHeader(built.buf).modelOff[0]);
  const nq = built.quads[CFG.LAYER_OPAQUE];
  const k = headIdx[layer], part = BE.layer(layer).parts[k];
  const sl = ER.mobGeomFor(layer)[k][5][0];
  for (let q = 0; q < nq; q++) {
    const vs = [];
    for (let v = 0; v < 4; v++) { const o = q * 16 + v * 4; vs.push(Me.unpackModelVertex(words[o], words[o + 1], words[o + 2], words[o + 3])); }
    const mu = vs.reduce((a, v) => a + v.u, 0) / 4, mv = vs.reduce((a, v) => a + v.v, 0) / 4;
    if (vs[0].tile !== sl.tile || Math.abs(mu - (sl.ox + sl.w / 2) * 16) > 1 || Math.abs(mv - (sl.oy + sl.h / 2) * 16) > 1) continue;
    return [vs.reduce((a, v) => a + v.px, 0) / 4 / U, vs.reduce((a, v) => a + v.py, 0) / 4 / U, vs.reduce((a, v) => a + v.pz, 0) / 4 / U];
  }
  return null;
}
const frontModel = (layer) => { const p = BE.layer(layer).parts[headIdx[layer]]; return [p.px + p.x + p.w / 2, p.py + p.y + p.h / 2, p.pz + p.z]; };
{
  // find the draw-origin's Y once, from a skull we can predict
  const p0 = placed('skeleton_skull', { rotation: 0 }, 'skeleton_skull');
  ok(!!p0, 'a standing skeleton skull draws something at all');
  if (p0) {
    const yBase = p0[1] - vanilla(frontModel('skeleton_skull'), 0, false, [0.5, 0, 0.5])[1];   // draw origin -> block corner offset in Y
    const near = (a, b) => Math.abs(a - b) < 0.02;
    const sweep = (label, name, props, layer, yawDeg, origin, dragon) => {
      const got = placed(name, props, layer);
      if (!ok(!!got, `${label} draws`)) return false;
      const want = vanilla(frontModel(layer), yawDeg, dragon, origin);
      const good = near(got[0], want[0]) && near(got[1] - yBase, want[1]) && near(got[2], want[2]);
      ok(good, `${label}: front face at (${got[0].toFixed(3)}, ${(got[1] - yBase).toFixed(3)}, ${got[2].toFixed(3)}), vanilla (${want.map((v) => v.toFixed(3)).join(', ')})`);
      return good;
    };
    for (let r = 0; r < 16; r++) {
      sweep(`standing skeleton_skull rotation ${r}`, 'skeleton_skull', { rotation: r }, 'skeleton_skull', 22.5 * r, [0.5, 0, 0.5], false);
    }
    for (const b of BLOCKS) {
      const layer = b;
      sweep(`${b} rotation 4`, b, { rotation: 4 }, layer, 90, [0.5, 0, 0.5], b === 'dragon_head');
    }
    // the wall variants: south 0, west 1, north 2, east 3 -> (2 + h) * 4 * 22.5
    const WALL = { south: [0, 1, 8], west: [-1, 0, 12], north: [0, -1, 0], east: [1, 0, 4] };
    for (const f of Object.keys(WALL)) {
      const [fx, fz, idx] = WALL[f];
      for (const b of ['zombie_wall_head', 'dragon_wall_head']) {
        const layer = b.replace('_wall', '');
        sweep(`${b} facing ${f}`, b, { facing: f }, layer, 22.5 * idx, [0.5 - fx * 0.25, 0.25, 0.5 - fz * 0.25], b.startsWith('dragon'));
      }
    }
    // the deliberate breaks
    caught(() => { const s = ER.SKULL_YAW_SIGN; ER.SKULL_YAW_SIGN = -s; const g = placed('skeleton_skull', { rotation: 4 }, 'skeleton_skull'); ER.SKULL_YAW_SIGN = s; const w = vanilla(frontModel('skeleton_skull'), 90, false, [0.5, 0, 0.5]); return !(near(g[0], w[0]) && near(g[2], w[2])); },
           'a mirrored yaw sign puts the front face on the wrong side of the head');
    caught(() => { const real = ER.SKULL_HORIZONTAL; ER.SKULL_HORIZONTAL = { south: 0, west: 3, north: 2, east: 1 }; const g = placed('zombie_wall_head', { facing: 'west' }, 'zombie_head'); ER.SKULL_HORIZONTAL = real; const w = vanilla(frontModel('zombie_head'), 22.5 * 12, false, [0.75, 0.25, 0.5]); return !(near(g[0], w[0]) && near(g[2], w[2])); },
           'swapping east/west in the wall table is seen');
    caught(() => { const real = ER.SKULL_DRAGON_SCALE; ER.SKULL_DRAGON_SCALE = null; const g = placed('dragon_head', { rotation: 4 }, 'dragon_head'); ER.SKULL_DRAGON_SCALE = real; const w = vanilla(frontModel('dragon_head'), 90, true, [0.5, 0, 0.5]); return !near(g[0], w[0]); },
           'a dragon head drawn at scale 1 instead of 0.75 is seen');
  }
}

// ═══════════════ 1. the GUI icon ════════════════════════════════════════════════════════════════
console.log('\n 1. the GUI icon shows the front, the top and one side');
{
  // a sheet whose six faces of the head box are six flat colours, in the engine's own ARCH face order
  const COL = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 0], [255, 0, 255], [0, 255, 255]];   // +X -X +Y -Y +Z -Z (model)
  const box = BE.layer('skeleton_skull').parts[0];
  const W = 64, H = 32, data = new Uint8ClampedArray(W * H * 4);
  const rects = BE.faceRects(box);
  for (let f = 0; f < 6; f++) {
    const [u, v, w, h] = rects[f];
    for (let y = v; y < v + h; y++) for (let x = u; x < u + w; x++) {
      const i = (y * W + x) * 4; data[i] = COL[f][0]; data[i + 1] = COL[f][1]; data[i + 2] = COL[f][2]; data[i + 3] = 255;
    }
  }
  M.Gui = M.Gui || {};
  M.Gui.sheets = { be_marker: { w: W, h: H, canvas: { getContext: () => ({ getImageData: () => ({ data }) }) } } };
  BE.clearCache();
  const seen = (opts) => {
    const buf = BE.render('skeleton_skull', 'be_marker', 96, Object.assign({ parts: [box], rotX: 30, rotY: 45, rotZ: 0 }, opts));
    const found = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < buf.length; i += 4) {
      if (!buf[i + 3]) continue;
      const m = Math.max(buf[i], buf[i + 1], buf[i + 2]);
      if (m < 40) continue;
      const c = [buf[i] > m * 0.5 ? 1 : 0, buf[i + 1] > m * 0.5 ? 1 : 0, buf[i + 2] > m * 0.5 ? 1 : 0];
      for (let f = 0; f < 6; f++) if (c[0] === (COL[f][0] ? 1 : 0) && c[1] === (COL[f][1] ? 1 : 0) && c[2] === (COL[f][2] ? 1 : 0)) found[f]++;
    }
    return found;
  };
  // vanilla item: x, -y, -z. Seen from [30, 45]: world +X, +Y, +Z face the viewer = model +X, -Y, -Z.
  const good = (f) => f[0] > 200 && f[3] > 200 && f[5] > 200 && f[1] === 0 && f[2] === 0 && f[4] === 0;
  ok(BE.TURN && LAYERS.every((l) => BE.TURN[l]), 'every skull layer is on BE.TURN');
  const turned = seen({ turn: true });
  ok(good(turned), `turned: front (-Z), top (-Y) and the +X side show, the back and underside do not (${turned.join('/')})`);
  const raw = seen({ turn: false });
  caught(() => !good(raw), `drawn raw (no turn) the icon is wrong: ${raw.join('/')}`);
  ok(turned[5] > 200, 'the front face texture (the one with the eyes) is on the screen');
}

// ═══════════════ 2. the baked item geometry (hand, ground, third person) ════════════════════════
console.log('\n 2. the baked item parts sit in the block, face outward');
{
  const g = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/be-geometry.json', 'utf8'));
  const DIRN = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];   // DIRS = down up north south west east
  const normalOf = (p) => {
    const a = [p[3] - p[0], p[4] - p[1], p[5] - p[2]], b = [p[6] - p[0], p[7] - p[1], p[8] - p[2]];
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  };
  const check = (name, tweak, quiet) => {
    const ok2 = quiet ? (c) => c : ok;
    const idx = g.names[name];
    if (!ok2(idx !== undefined, `${name} is a baked item`)) return false;
    const quads = tweak ? tweak(JSON.parse(JSON.stringify(g.parts[idx]))) : g.parts[idx];
    const L = BE.layer(name), dragon = name === 'dragon_head';
    // oracle bounds: every box corner through the matrix chain at yaw 180, origin (0.5, 0, 0.5), in pixels
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9], c8 = new Float64Array(24);
    for (const part of L.parts) {
      BE.poseBoxCorners(part, c8);
      for (let i = 0; i < 8; i++) {
        const w = vanilla([c8[i * 3], c8[i * 3 + 1], c8[i * 3 + 2]], 180, dragon, [0.5, 0, 0.5]);
        for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], w[a] * 16); hi[a] = Math.max(hi[a], w[a] * 16); }
      }
    }
    const qlo = [1e9, 1e9, 1e9], qhi = [-1e9, -1e9, -1e9];
    let dirsOk = 0;
    for (const q of quads) {
      for (let i = 0; i < 12; i += 3) for (let a = 0; a < 3; a++) { qlo[a] = Math.min(qlo[a], q.p[i + a]); qhi[a] = Math.max(qhi[a], q.p[i + a]); }
      const n = normalOf(q.p), m = Math.hypot(n[0], n[1], n[2]) || 1, dn = DIRN[q.d];
      // the engine's item bake winds so that cross(v1-v0, v2-v0) points AGAINST the face direction (the chest's
      // 18 quads all do); the skulls must agree with that, or the culling turns them inside out
      if ((n[0] * dn[0] + n[1] * dn[1] + n[2] * dn[2]) / m < -0.95) dirsOk++;   // 0.95: the dragon jaw is pitched 0.2 rad
    }
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.15);
    ok2(near(qlo, lo) && near(qhi, hi), `${name}: baked bounds [${qlo.map((v) => v.toFixed(2))}]..[${qhi.map((v) => v.toFixed(2))}] vs vanilla [${lo.map((v) => v.toFixed(2))}]..[${hi.map((v) => v.toFixed(2))}]`);
    ok2(dirsOk === quads.length, `${name}: every quad's direction names the way its winding faces (${dirsOk}/${quads.length})`);
    return near(qlo, lo) && near(qhi, hi) && dirsOk === quads.length;
  };
  for (const l of LAYERS) check(l);
  caught(() => !check('zombie_head', (qs) => { for (const q of qs) for (let i = 1; i < 12; i += 3) q.p[i] = -q.p[i]; return qs; }, true),
         'the raw (unturned, y-down) bake is off the vanilla bounds');
  caught(() => !check('creeper_head', (qs) => { for (const q of qs) if (q.d < 4) q.d ^= 1; return qs; }, true),
         'a bake that swaps the shade directions is seen');
}

console.log('\n' + '='.repeat(78));
console.log(` skullcheck: ${pass} assertions, ${fails.length} failed, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('   x ' + f); process.exit(1); }
