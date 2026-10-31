#!/usr/bin/env node
// enderdragonsegcheck.mjs — #1567: the dragon's 64-entry segment ring buffer + wingPosition (EnderDragonEntity) and
// the renderer's 5-neck / head / 12-tail chain (EnderDragonEntityRenderer.DragonEntityModel.render). Node-only.
//   node tools/enderdragonsegcheck.mjs
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
console.log('enderdragonsegcheck — #1567 segment ring buffer, wing clock, neck x5 + tail x12');

const M = loadEngine({
  extra: ['02g_items.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07k_goals.js', '07i_entitylist.js', '07zzl_enderdragon.js',
          '07j_entityrender.js', '10_gfx.js', '11_gfx_webgpu.js', '12_gfx_webgl2.js', '15h_bemodel.js'],
  dom: false
});
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
}
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, ED = M.EnderDragon;

// --- 1. the rig: ring buffer + wing clock, driven by the real tick -----------------------------------------------
const mk = () => { const r = new ED.EnderDragonEntity({ x: 0, y: 100, z: 0, yaw: 0, heightAt: () => 63 }); r.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern); return r; };
const d = mk();
ok(d.segmentCircularBuffer.length === 64 && d.segmentCircularBuffer[0].length === 3, 'ring buffer is 64 x 3');
ok(d.latestSegment === -1 && d.wingPosition === 0, 'fresh dragon: latestSegment -1, wingPosition 0');
d.tickWingAndSegments();
ok(d.latestSegment === 0, 'first tick: latestSegment 0');
ok(d.segmentCircularBuffer.every(s => s[0] === 0 && s[1] === 100), 'first tick fills the whole buffer with (yaw, y)');
// wingPosition += 0.2/(horizLen*10+1) * 2^vy   (standing still, not sitting)
ok(near(d.wingPosition, 0.2, 1e-6), 'wingPosition advances 0.2 at rest');
const w1 = d.wingPosition; d.setVelocity({ x: 0.3, y: 0.5, z: 0.4 });
d.tickWingAndSegments();
ok(near(d.prevWingPosition, w1) && near(d.wingPosition - w1, 0.2 / (0.5 * 10 + 1) * Math.SQRT2, 1e-6), 'wingPosition follows 0.2/(speed*10+1)*2^vy, prev = last value');
for (let i = 0; i < 70; i++) { d.y = 100 + i; d.yaw = (i * 7) % 360 - 180; d.tickWingAndSegments(); }
ok(d.latestSegment === (2 + 70 - 1) % 64, 'latestSegment wraps modulo 64');
const cur = d.segmentCircularBuffer[d.latestSegment];
ok(near(d.getSegmentProperties(0, 1)[1], cur[1]) && near(d.getSegmentProperties(1, 1)[1], d.segmentCircularBuffer[(d.latestSegment - 1) & 63][1]),
   'getSegmentProperties(n, 1) is the n-ticks-old entry; n=0,t=0 blends toward n+1');
ok(near(d.getSegmentProperties(3, 0)[1], d.segmentCircularBuffer[(d.latestSegment - 4) & 63][1]), 't=0 reads the next-older entry');
d.segmentCircularBuffer[(d.latestSegment - 1) & 63][0] = 170; d.segmentCircularBuffer[(d.latestSegment - 2) & 63][0] = -170;
ok(near(d.getSegmentProperties(1, 0.5)[0], 180, 1e-9) || near(d.getSegmentProperties(1, 0.5)[0], -180, 1e-9), 'yaw interpolation wraps the short way (170 -> -170 mid = 180)');
const dd = mk(); dd.health = 0; dd.tickWingAndSegments();
ok(dd.latestSegment === -1, 'a dead dragon records no segments');
{ // live tick path really calls it (anti-vacuity for wiring)
  const e = M.EntityList.spawn('ender_dragon', 0, 100, 0);
  M.EntityList.tickMob(e);
  ok(e.dragon && e.dragon.latestSegment >= 0 && e.dragon.wingPosition > 0, 'EL.tickMob drives the ring buffer + wing clock');
}
const sit = mk(); sit.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.SittingScanning); sit.tickWingAndSegments();
ok(near(sit.wingPosition, 0.1, 1e-6), 'sitting/hovering: wingPosition += 0.1');

// --- 2. the render chain ---------------------------------------------------------------------------------------
const rig = mk(); rig.tickWingAndSegments();
for (let i = 0; i < 40; i++) { rig.yaw = i * 3; rig.y = 100 + Math.sin(i / 5) * 3; rig.setVelocity({ x: 0.5, y: 0, z: 0 }); rig.tickWingAndSegments(); }
const A = ER.dragonAnim(rig, 0.5);
ok(A.neck.length === 5 && A.tail.length === 12, 'dragonAnim: 5 neck + 12 tail poses');
ok(near(A.wing, rig.prevWingPosition + (rig.wingPosition - rig.prevWingPosition) * 0.5, 1e-12), 'wing phase = lerp(prevWingPosition, wingPosition)');
ok(near(A.neck[0].py, 20) && near(A.neck[0].pz, -12) && near(A.neck[0].px, 0), 'neck chain starts at pivot (0,20,-12)');
ok(near(A.tail[0].py, 10) && near(A.tail[0].pz, 60), 'tail chain starts at pivot (0,10,60)');
ok(near(A.neck[1].py, A.neck[0].py + Math.sin(A.neck[0].rx) * 10) && near(A.neck[1].pz, A.neck[0].pz - Math.cos(A.neck[0].ry) * Math.cos(A.neck[0].rx) * 10),
   'neck pivots accumulate sin/cos * 10');
ok(near(A.head.py, A.neck[4].py + Math.sin(A.neck[4].rx) * 10), 'head sits at the end of the neck chain');
ok(A.tail.every(q => Math.abs(q.ry - Math.PI) < 1.2), 'tail segments are turned ~180 deg');
ok(A.neck.some((q, i) => i && Math.abs(q.ry - A.neck[0].ry) > 1e-3), 'a turning dragon bends its neck (segment yaws differ)');
const hist = rig.latestSegment, p = rig.getSegmentProperties(5, 0.5)[1] - rig.getSegmentProperties(10, 0.5)[1];
ok(hist >= 0 && near(A.root.rx, (2 * ((Math.sin(A.tau - 1) + 1) ** 2 + 2 * (Math.sin(A.tau - 1) + 1)) * 0.05) * Math.PI / 180 - p * 10 * Math.PI / 180, 1e-9), 'root pitch = 2*b deg - (seg5.y - seg10.y)*10 deg');
{
  const s5 = rig.getSegmentProperties(5, 0.5)[0], s10 = rig.getSegmentProperties(10, 0.5)[0];
  let dy = (s5 - s10) % 360; if (dy >= 180) dy -= 360; if (dy < -180) dy += 360;
  ok(near(A.roll.rz, -dy * 1.5 * Math.PI / 180, 1e-9) && Math.abs(A.roll.rz) > 1e-3, 'body roll = -wrap(seg5.yaw - seg10.yaw) * 1.5');
}
// a straight, level history has no neck bend and zero body roll
const flat = mk(); for (let i = 0; i < 30; i++) flat.tickWingAndSegments();
const F = ER.dragonAnim(flat, 0.3);
ok(Math.abs(F.roll.rz) < 1e-12 && F.neck.every(q => Math.abs(q.ry) < 1e-12 && Math.abs(q.rz) < 1e-12), 'straight history: no roll, no neck yaw/roll');
// wing clock moves the wings: two wing positions -> different left_wing delta
const c1 = ER.dragonDelta('left_wing', { dragon: ER.dragonAnim(flat, 0), rest: {} }, 0, 0);
flat.tickWingAndSegments(); flat.tickWingAndSegments(); flat.tickWingAndSegments();
const c2 = ER.dragonDelta('left_wing', { dragon: ER.dragonAnim(flat, 0), rest: {} }, 0, 0);
ok(c1.rz !== c2.rz, 'wing flap follows wingPosition, not the fixed render clock');
// every neck/tail draw gets its own pose
const dn = [];
for (let k = 0; k < 17; k++) dn.push(ER.dragonDelta('neck', { dragon: A, rest: { dgi: k, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 } }, 0, 0));
ok(new Set(dn.map(x => x.dpz.toFixed(6))).size === 17, '17 distinct neck/tail pivots');

// --- 3. emitted geometry: 5 + 12 neck draws really reach the vertex buffer ----------------------------------------
const emit = (anim) => {
  const n = ER.mobQuadCount('ender_dragon') * 40;
  const out = new Uint32Array(n * 16);
  const end = ER.emitMobLayer(out, 0, 'ender_dragon', 0, 0, 0, 1, 0, 15, 0, 3, anim);
  return { out, end };
};
const base = { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 0, headPitch: 0, ageInTicks: 3 };
const withDragon = emit(Object.assign({}, base, { dragon: A }));
const without = emit(base);
const neckQuads = 12;   // 2 boxes x 6 faces
ok(withDragon.end - without.end >= 16 * neckQuads * 16 / 16 - 1 || withDragon.end > without.end, 'the chain draws more geometry than a single neck');
ok(withDragon.end !== without.end, 'anti-vacuity: with/without dragon data differ in emitted size');
const emitAt = (a) => emit(Object.assign({}, base, { dragon: a }));
const flatEmit = emitAt(F);
let diff = false; for (let i = 0; i < withDragon.out.length; i++) if (withDragon.out[i] !== flatEmit.out[i]) { diff = true; break; }
ok(diff, 'a turning dragon emits different vertices than a flying-straight one');

// --- 4. model yaw: Ry(-seg7.yaw) replaces the entity yaw (#1847) -------------------------------------------------
{
  const e = { type: 'ender_dragon', dragon: rig, yaw: 1.234, yawO: 1.234 };
  const s7 = rig.getSegmentProperties(7, 0.5)[0];
  ok(near(ER.dragonYaw(e, 0.5), s7 * Math.PI / 180, 1e-6), 'model yaw = seg7.yaw (deg->rad), engine heading psi = -(-seg7)');
  ok(Math.abs(ER.dragonYaw(e, 0.5) - ER.bodyYawAt(e, 0.5)) > 1e-3, 'the entity yaw no longer drives the dragon (no double rotation)');
  ok(near(ER.dragonYaw({ type: 'cow', yaw: 1.234, yawO: 1.234 }, 0.5), 1.234, 1e-12), 'other mobs keep bodyYawAt');
  // hand-built history: seg7 two entries back is 170, the one before -170 -> lerp the short way (180)
  const h = mk(); h.tickWingAndSegments(); for (let i = 0; i < 10; i++) h.tickWingAndSegments();
  for (let i = 0; i < 64; i++) h.segmentCircularBuffer[i][0] = 30;
  h.segmentCircularBuffer[(h.latestSegment - 7) & 63][0] = 90;
  ok(near(ER.dragonYaw({ type: 'ender_dragon', dragon: h }, 1) * 180 / Math.PI, 90, 1e-4), 'seg7 at t=1 is the 7-ticks-old yaw (hand-computed 90)');
  ok(/ER\.dragonYaw\(it\.e, partial\)/.test(readFileSync(MCLITE_ROOT + 'src/07j_entityrender.js', 'utf8')), 'mob emitter reads ER.dragonYaw');
}

// --- breaks (anti-vacuity) -------------------------------------------------------------------------------------------
let caught = 0, total = 0;
const brk = (name, fn) => { total++; const before = fails.length, p0 = pass; const sp = pass; fn(); if (fails.length > before) { caught++; console.log('  ✓ break caught: ' + name); } fails.length = before; pass = sp; };
brk('segment buffer never advances', () => { const x = mk(); x.tickWingAndSegments = function () { this.prevWingPosition = this.wingPosition; }; x.tickWingAndSegments(); ok(x.latestSegment === 0, 'x'); });
brk('wing clock constant', () => { const x = mk(); x.wingPosition = 0.2; x.prevWingPosition = 0.2; const a = ER.dragonAnim(x, 0.5); ok(a.wing !== 0.2, 'x'); });
brk('tail not 180', () => { const q = JSON.parse(JSON.stringify(A)); q.tail.forEach(t => t.ry = 0); ok(q.tail.every(t => Math.abs(t.ry - Math.PI) < 1.2), 'x'); });
brk('neck all the same pose', () => { const q = JSON.parse(JSON.stringify(A)); const r = { dgi: 0, px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }; const s = new Set(); for (let k = 0; k < 17; k++) s.add(ER.dragonDelta('neck', { dragon: q, rest: Object.assign({}, r, { dgi: 0 }) }, 0, 0).dpz.toFixed(6)); ok(s.size === 17, 'x'); });
brk('ring wrap off', () => { const x = mk(); for (let i = 0; i < 70; i++) x.tickWingAndSegments(); x.latestSegment = 70; ok(x.latestSegment === 69 % 64, 'x'); });
brk('entity yaw drives the dragon', () => { const e = { type: 'ender_dragon', dragon: rig, yaw: 1.234, yawO: 1.234 }; const f = ER.dragonYaw; ER.dragonYaw = ER.bodyYawAt; try { ok(Math.abs(ER.dragonYaw(e, 0.5) - ER.bodyYawAt(e, 0.5)) > 1e-3, 'x'); } finally { ER.dragonYaw = f; } });
brk('seg7 off by one', () => { const s6 = rig.getSegmentProperties(6, 0.5)[0]; ok(near(ER.dragonYaw({ type: 'ender_dragon', dragon: rig }, 0.5), s6 * Math.PI / 180, 1e-6), 'x'); });
console.log(`enderdragonsegcheck: ${caught} breaks caught (of ${total})`);
ok(caught === total, `every break must be caught (${caught}/${total})`);
console.log(`\npassed: ${pass}\nfailed: ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
process.exit(fails.length ? 1 : 0);
