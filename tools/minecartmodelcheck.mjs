#!/usr/bin/env node
// minecartmodelcheck.mjs -- #1564 (G25): the minecart model + renderer, headless.
//
//   node tools/minecartmodelcheck.mjs
//
//   1. MinecartEntityModel.getTexturedModelData (.decomp, re-parsed here) == the five boxes of every one of the seven
//      loaded layers (minecart, chest/furnace/hopper/tnt/spawner/command_block _minecart), 64x32.
//   2. MinecartEntityRenderer.render's PoseStack (src/07zzs_minecartrender.js) re-derived independently: rail
//      yaw/pitch (atan2 / atan * 73), damage wobble, the display block's offset/scale/rotY(90), the 64-bit jitter,
//      TntMinecartEntityRenderer's fuse scale.
// Every section breaks its own data and must notice ("N breaks caught": the suite counts them).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { parseBoat } from './extract-boat.mjs';
import { deflateRawSync } from 'node:zlib';

let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const brk = (c, m) => { if (c) { pass++; caught++; console.log('   ✓ break caught: ' + m); } else fails.push('break NOT caught: ' + m); };
const near = (a, b, t = 1e-5) => Math.abs(a - b) <= t;

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
  '10_gfx.js', '15h_bemodel.js', '07zzr_minecart.js', '07zzs_minecartrender.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
}
const geo = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geo).toString('base64'), mobGeometryBytes: geo.length,
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const MR = M.MinecartRender, ER = M.EntityRender;

console.log('minecartmodelcheck -- #1564, minecart model / pose / display block');
const src = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/model/MinecartEntityModel.java'), 'utf8');
const rows = parseBoat(src);                     // same addChild(...) grammar
ok(rows.length === 5, 'MinecartEntityModel has 5 cuboids (' + rows.length + ')');
const matches = (L, rs) => !!L && L.parts.length === rs.length && rs.every((r, i) => {
  const p = L.parts.find((q) => q.n === r[1]);
  return p && p.tu === +r[2] && p.tv === +r[3] && near(p.x, r[4]) && near(p.y, r[5]) && near(p.z, r[6]) && near(p.w, r[7]) &&
    near(p.h, r[8]) && near(p.d, r[9]) && near(p.px, r[10]) && near(p.py, r[11]) && near(p.pz, r[12]) &&
    near(p.rx, r[13]) && near(p.ry, r[14]) && near(p.rz, r[15]);
});
ok(MR.TYPES.length === 7, 'seven cart types');
for (const t of MR.TYPES) {
  const L = M.BEModel.layer(t);
  ok(matches(L, rows), t + ' layer == MinecartEntityModel');
  ok(!!L && L.tw === 64 && L.th === 32, t + ' sheet is 64x32');
}
{ const bad = rows.map((r) => r.slice()); bad[0][7] = 21;
  brk(!matches(M.BEModel.layer('minecart'), bad), 'a 21-wide bottom no longer matches the layer');
  brk(parseBoat(src.replace('20.0F, 16.0F, 2.0F', '20.0F, 16.0F, 3.0F'))[0][9] === 3, 'the parser sees an edited box (d 2 -> 3)'); }
ok(ER.mobLayerFor('chest_minecart') === 'chest_minecart', 'a chest_minecart entity draws through the mob path');
ok(ER.basePoseFor('chest_minecart').flip === false, 'a minecart gets no LivingEntityRenderer flip');

// ---- 2. the PoseStack, re-derived from the Java ----
const Rs = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/client/render/entity/MinecartEntityRenderer.java'), 'utf8');
ok(/translate\(0\.0, 0\.375, 0\.0\)/.test(Rs) && /getDegreesQuaternion\(180\.0F - \$\$1\)/.test(Rs) && /\$\$15 = \(float\)\(Math\.atan\(\$\$18\.y\) \* 73\.0\)/.test(Rs), 'the Java still says lift .375 / rotY(180-yaw) / atan*73');
const mm3 = (a, b) => { const r = []; for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]); return r; };
const Ry = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
const Rx = (d) => { const t = d * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const eq9 = (a, b) => a.every((v, i) => near(v, b[i], 1e-9));

const e = { type: 'minecart', cartYaw: 90, cartPitch: 20, id: 0, cartDamageWobble: { ticks: 6, strength: 8, side: -1 } };
const P = MR.pose(e, 0.5, [0, 0, 0]);
{ const wt = 6 - 0.5, ws = 8 - 0.5;
  const R = mm3(mm3(Ry(180 - 90), Rz(-20)), Rx(Math.sin(wt) * wt * ws / 10 * -1));
  ok(eq9(P.R, R), 'pose R = rotY(180-yaw) rotZ(-pitch) rotX(wobble)');
  ok(eq9(P.RM, mm3(R, [-1, 0, 0, 0, -1, 0, 0, 0, 1])), 'model matrix ends in scale(-1,-1,1)');
  ok(near(P.dy, 0.375 + MR.jitter(0)[1]), 'lifted .375');
  brk(!eq9(MR.pose(Object.assign({}, e, { cartDamageWobble: null }), 0.5, [0, 0, 0]).R, R), 'no wobble gives a different matrix'); }
// rail: direction (1,0.5,0) -> yaw atan2(0,1)=0, pitch atan(.4472)*73
{ const rail = { type: 'minecart', cartYaw: 33, cartPitch: 0, id: 0, cartSnap: (x, y, z, o) => o === undefined ? [x, y + 0.1, z] : [x + o, y + 0.5 * o / 0.3 * 0.3, z] };
  const Q = MR.pose(rail, 1, [1, 2, 3]);
  const d = [-0.6, -0.3, 0], l = Math.hypot(d[0], d[1]);   // b - a, a=+0.3, b=-0.3
  const yaw = Math.atan2(0, d[0] / l) * 180 / Math.PI, pitch = Math.atan(d[1] / l) * 73;
  ok(eq9(Q.R, mm3(Ry(180 - yaw), Rz(-pitch))), 'rail snap sets yaw = atan2(dz,dx), pitch = atan(dy)*73');
  ok(near(Q.dy - MR.jitter(0)[1], 0.375 + (2.15 + 1.85) / 2 - 2), 'rail snap lifts to the mean of the two offset points');
  brk(!eq9(MR.pose(Object.assign({}, rail, { cartSnap: null }), 1, [1, 2, 3]).R, Q.R), 'without cartSnap the heading is the entity yaw instead'); }
// jitter: Java long arithmetic
{ const j = MR.jitter(7); let a = 7n * 493286711n; a = BigInt.asIntN(64, a); a = BigInt.asIntN(64, BigInt.asIntN(64, a * a * 4392167121n) + a * 98761n);
  const f = (s) => ((Number((a >> s) & 7n)) + 0.5) / 8 - 0.5;
  ok(near(j[0], f(16n) * 0.004) && near(j[1], f(20n) * 0.004) && near(j[2], f(24n) * 0.004), 'render jitter is the 64-bit hash');
  ok(j.every((v) => Math.abs(v) <= 0.002), 'jitter stays within +-0.002');
  brk(MR.jitter(7).join() !== MR.jitter(8).join(), 'a different entity id gives a different jitter'); }
// display block: offset, 0.75 scale, rotY(90), tnt fuse
{ const c0 = { type: 'chest_minecart', cartYaw: 180, cartPitch: 0, displayBlockState: M.States.stateOf('stone') | 0, id: 0 };
  const B = MR.blockFor(c0, 1, [0, 0, 0]);
  ok(!!B && B.state > 0, 'a cart with a display block yields one');
  const jit = MR.jitter(0), off = 8;   // chest cart default offset 8 -> translate y 0
  ok(near(B.c[1], 0.375 + jit[1] + 0.75 * (0.5 + (off - 8) / 16)) && near(B.c[0], jit[0], 1e-6) && near(B.c[2], jit[2], 1e-6), 'block centre = lift + .75*(.5 + (offset-8)/16), centred over the cart');
  ok(near(B.m[0], 0) && near(Math.abs(B.m[2]), 0.75), 'block linear part is .75 * rotY(90)');
  const h = MR.blockFor(Object.assign({}, c0, { type: 'hopper_minecart', displayBlockState: undefined }), 1, [0, 0, 0]);
  ok(!!h && near(h.c[1], 0.375 + jit[1] + 0.75 * (0.5 + (1 - 8) / 16)), 'hopper cart default offset is 1');
  ok(MR.blockFor({ type: 'minecart', id: 0, cartYaw: 0 }, 1, [0, 0, 0]) === null, 'a bare minecart draws no block (air)');
  const t1 = MR.blockFor({ type: 'tnt_minecart', id: 0, cartYaw: 180, cartFuse: 0 }, 1, [0, 0, 0]);
  const k = 1 + Math.pow(1 - (0 - 1 + 1) / 10, 4) * 0.3;
  ok(near(Math.hypot(t1.m[0], t1.m[2]) / 0.75, k, 1e-6), 'tnt cart swells with the fuse (1 + f^4 * 0.3)');
  brk(near(MR.blockFor({ type: 'tnt_minecart', id: 0, cartYaw: 180 }, 1, [0, 0, 0]).m[2] / 0.75, k, 1e-3) === false, 'an unlit tnt cart does not swell');
  const W = f => MR.blockFor({ type: 'tnt_minecart', id: 0, cartYaw: 180, cartFuse: f }, 1, [0, 0, 0]).white;
  ok(W(80) === 1 && W(75) === 0 && W(74) === 1 && W(70) === 1 && W(69) === 0 && W(0) === 1, 'tnt cart flashes white when fuse/5%2==0 (80, 74..70, 64..60, ...)');
  { const Mc = M.Minecart, c = { type: 'tnt_minecart', id: 0, cartYaw: 180, x: 0, y: 0, z: 0 }; Mc.init(c); Mc.prime(c); c.cartFuse = 1;
    const sc = MR.blockFor(c, 0, [0, 0, 0]);
    ok(Math.hypot(sc.m[0], sc.m[2]) / 0.75 > 1.05, 'a REAL primed NS.Minecart cart (cartFuse 1) swells in blockFor');
    c.cartFuse = 80; brk(!(Math.hypot(MR.blockFor(c, 0, [0, 0, 0]).m[0], MR.blockFor(c, 0, [0, 0, 0]).m[2]) / 0.75 > 1.05), 'a fresh fuse-80 real cart does not swell'); }
  brk(W(72) === 1, 'fuse 72 (72/5=14 even) flashes'); brk(W(77) === 0, 'fuse 77 (odd) does not'); brk(W(-1) === 0, 'an unlit cart never flashes'); }
// the engine draws it
{ const a = MR.animOf(e, 1, [0, 0, 0]);
  ok(!!a.sleepPose && a.sleepPose.dy > 0.37, 'anim carries the sleepPose slot');
  ok(ER.animOf({ type: 'furnace_minecart', cartYaw: 0, id: 1, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0 }, 1).sleepPose.R.length === 9, 'ER.animOf routes carts to the minecart pose'); }

console.log('minecartmodelcheck: ' + caught + ' breaks caught');
for (const f of fails) console.log('  ✗ ' + f);
console.log(' assertions passed .... ' + pass);
console.log(' failures ........... ' + fails.length);
process.exit(fails.length ? 1 : 0);
