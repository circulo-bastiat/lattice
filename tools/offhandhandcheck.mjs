#!/usr/bin/env node
// offhandhandcheck.mjs — #10747 G19d-a: the first-person OFFHAND item (HeldItemRenderer offhand half).
// Equip curve (equipProgressOffHand: +-0.4/tick toward 1 when the drawn ref IS the slot-40 stack, swap below 0.1),
// pose (renderFirstPersonItem OFF_HAND, i=-1, swing only when swingArm==1) vs an independent matrix implementation,
// and Hand3D.build adds the offhand draw when slot 40 holds a stack.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const MCL = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '14k_hand3d.js'], dom: false });
const H = MCL.Hand, H3 = MCL.Hand3D, Iv = MCL.Inventory;
const near = (a, b) => Math.abs(a - b) < 1e-4;

// ── independent column-major matrices
const I4 = () => [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
const mul = (a, b) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o; };
const T = (x,y,z) => { const m = I4(); m[12]=x; m[13]=y; m[14]=z; return m; };
const D = Math.PI / 180;
const RX = a => { const m = I4(), c = Math.cos(a*D), s = Math.sin(a*D); m[5]=c; m[6]=s; m[9]=-s; m[10]=c; return m; };
const RY = a => { const m = I4(), c = Math.cos(a*D), s = Math.sin(a*D); m[0]=c; m[2]=-s; m[8]=s; m[10]=c; return m; };
const RZ = a => { const m = I4(), c = Math.cos(a*D), s = Math.sin(a*D); m[0]=c; m[1]=s; m[4]=-s; m[5]=c; return m; };
const chain = (...ms) => ms.reduce(mul, I4());
function vanillaOff(swing, equipped) {   // renderFirstPersonItem, OFF_HAND, not using: i = -1
  const i = -1, sq = Math.sqrt(swing), PI = Math.PI;
  const f1 = Math.sin(sq * PI);
  return chain(
    T(i * -0.4 * Math.sin(sq * PI), 0.2 * Math.sin(sq * PI * 2), -0.2 * Math.sin(swing * PI)),
    T(i * 0.56, -0.52 + equipped * -0.6, -0.72),
    RY(i * (45 + Math.sin(swing * swing * PI) * -20)), RZ(i * f1 * -20), RX(f1 * -80), RY(i * -45));
}

const P = { inventory: Iv.create ? Iv.create() : null, ex: 0, ey: 0, ez: 0, pitch: 0, yaw: 0, heldItem: () => null,
            xBob: 0, yBob: 0, xBobO: 0, yBobO: 0 };
const mk = (i, n) => ({ i, n: n || 1, d: 0 });

console.log('1. equip curve');
{
  ok(H.offHandHeight === 1 && H.offHandItem === -1, 'starts raised, nothing drawn');
  if (P.inventory) {
    Iv.setItem(P.inventory, Iv.OFFHAND, mk(5, 1));
    H.tickEquip(P);   // new stack: ref differs -> target 0, height 1 -> 0.6
    ok(near(H.offHandHeight, 0.6) && near(H.oOffHandHeight, 1), 'step 1 of the dip: 1 -> 0.6 (got ' + H.offHandHeight + ')');
    H.tickEquip(P); ok(near(H.offHandHeight, 0.2), 'step 2: 0.2');
    H.tickEquip(P); ok(H.offHandHeight < 0.1 && H.offHandItem === 5, 'step 3: below 0.1 swaps the drawn item to 5 (' + H.offHandHeight + ',' + H.offHandItem + ')');
    H.tickEquip(P); ok(near(H.offHandHeight, 0.4), 'rises again at 0.4/tick');
    for (let k = 0; k < 4; k++) H.tickEquip(P);
    ok(near(H.offHandHeight, 1), 'back to 1');
  } else fails.push('no inventory to put slot 40 in');
}

console.log('2. pose vs independent implementation');
{
  const m = new Float32Array(16);
  P.xBob = P.yBob = 0;
  for (const [sw, eq] of [[0, 1], [0, 0.4], [0.5, 1], [0.8, 0.7]]) {
    H3.poseOffhand(m, P, 1, sw, eq);
    const want = vanillaOff(sw, eq);
    let good = true; for (let k = 0; k < 16; k++) if (!near(m[k], want[k])) good = false;
    ok(good, 'pose swing=' + sw + ' equipped=' + eq);
  }
  H3.poseOffhand(m, P, 1, 0, 1);
  ok(m[12] < -0.3, 'offhand sits on the LEFT (x ' + m[12].toFixed(3) + ')');
}

console.log('3. Hand3D.build draws the offhand');
{
  // stub the item geometry: one part, emitPart records the matrix and writes one marker float
  const seen = [];
  H3.partsOf = () => ({ parts: [1], tints: [null] });
  H3.emitPart = (out, o, part, m, tint, light) => { seen.push(Array.from(m)); out[o] = 7; return o + H3.FLOATS_PER_VERTEX * H3.VERTS_PER_QUAD; };
  H3.applyDisplay = (m) => m;
  H.mainHandItem = -1; H.swingArm = 0; H.swinging = false;
  const fr = H3.build(P, 1);
  ok(!!fr && fr.quads === 1, 'slot 40 stack with an empty main hand yields an offhand quad (' + (fr && fr.quads) + ')');
  ok(seen.length === 1 && seen[0][12] < 0, 'offhand pose reached emitPart');
  // swing only when swingArm==1
  H.prevAttackAnim = 0.3; H.attackAnim = 0.5; H.swingArm = 0;
  const a = H3.buildOffhand(P, 1, 1).pose.slice();
  H.swingArm = 1;
  const b = H3.buildOffhand(P, 1, 1).pose.slice();
  let diff = false; for (let k = 0; k < 16; k++) if (!near(a[k], b[k])) diff = true;
  ok(diff, 'offhand swings only when swingArm == 1');
  H.prevAttackAnim = H.attackAnim = 0;
  // main-hand-only result fails: the empty slot 40 draws nothing
  Iv.setItem(P.inventory, Iv.OFFHAND, null);
  for (let k = 0; k < 8; k++) H.tickEquip(P);
  ok(H3.build(P, 1) === null, 'empty offhand: nothing drawn');
}

console.log('4. anti-vacuity');
{
  // drop the offhand branch -> main-hand-only result
  Iv.setItem(P.inventory, Iv.OFFHAND, mk(5, 1));
  for (let k = 0; k < 10; k++) H.tickEquip(P);
  const real = H3.buildOffhand;
  okAv(!!H3.build(P, 1), 'with the offhand branch a slot-40 stack draws');
  H3.buildOffhand = () => null;
  okAv(H3.build(P, 1) === null, 'offhand branch dropped -> main-hand-only result is empty');
  H3.buildOffhand = real;
  const m = new Float32Array(16), w = vanillaOff(0, 1);
  const rm = H3.poseOffhand; H3.poseOffhand = (o) => { o.set(chain(T(0.56, -0.52, -0.72))); return o; };
  H3.poseOffhand(m, P, 1, 0, 1);
  let same = true; for (let k = 0; k < 16; k++) if (!near(m[k], w[k])) same = false;
  okAv(!same, 'a right-hand-mirrored pose differs from vanilla');
  H3.poseOffhand = rm;
  const h0 = H.offHandHeight; H.EQUIP_STEP = 0.2; Iv.setItem(P.inventory, Iv.OFFHAND, mk(6, 1)); H.tickEquip(P);
  okAv(!near(H.offHandHeight, h0 - 0.4), 'a wrong equip step changes the curve'); H.EQUIP_STEP = 0.4;
}
console.log(`\n=== offhandhandcheck ===\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}\n====================`);
for (const f of fails) console.log('FAIL ' + f);
process.exit(fails.length ? 1 : 0);
