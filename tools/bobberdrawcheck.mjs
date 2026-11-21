#!/usr/bin/env node
// bobberdrawcheck.mjs — G17-F6: FishingBobberEntityRenderer geometry (ER.bobberGeometry) vs the Java formulas
// (.decomp/.../FishingBobberEntityRenderer.java), for 4 poses, projected to pixel coordinates with a fixed pinhole
// camera. Headless; the GL2/GPU paths share this geometry. Proves it can fail: an injected fault (line anchored at
// the owner's feet) and a flipped arm side are each caught ("<n> breaks caught").
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js'], initReg: false });
const ER = M.EntityRender;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const px = (v) => [Math.round(160 + (v.x / (v.z + 6)) * 200), Math.round(120 - (v.y / (v.z + 6)) * 200)];
const f = Math.fround;
// independent transcription of the Java (third person), one vertex list of pixels
function expected(b, o, t) {
  let s = o.rightArm ? 1 : -1; if (!o.rodInMain) s = -s;
  const sw = Math.sin(o.bodyYaw * Math.PI / 180 * 1), c = Math.cos(o.bodyYaw * Math.PI / 180);   // prevBodyYaw == bodyYaw in the poses
  const hx = o.x - c * s * 0.35 - sw * 0.8, hy = o.py + o.eyeHeight + (o.y - o.py) * t - 0.45, hz = o.z - sw * s * 0.35 + c * 0.8;
  const dx = f(hx - b.x), dy = f(f(hy - (b.y + 0.25)) + (o.sneaking ? -0.1875 : 0)), dz = f(hz - b.z);
  const out = [];
  for (let i = 0; i <= 16; i++) { const p = i / 16; out.push(px({ x: dx * p, y: dy * (p * p + p) * 0.5 + 0.25, z: dz * p })); }
  return out;
}
const poses = [
  [{ x: 3, y: 64, z: 2, px: 3, py: 64, pz: 2 }, { x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, bodyYaw: 0, prevBodyYaw: 0, swing: 0, rightArm: true, rodInMain: true, sneaking: false, eyeHeight: 1.62 }],
  [{ x: -2, y: 63, z: 4, px: -2, py: 63, pz: 4 }, { x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, bodyYaw: 90, prevBodyYaw: 90, swing: 0, rightArm: false, rodInMain: true, sneaking: false, eyeHeight: 1.62 }],
  [{ x: 1, y: 64, z: -5, px: 1, py: 64, pz: -5 }, { x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, bodyYaw: 200, prevBodyYaw: 200, swing: 0, rightArm: true, rodInMain: false, sneaking: true, eyeHeight: 1.62 }],
  [{ x: 6, y: 65, z: 1, px: 6, py: 65, pz: 1 }, { x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, bodyYaw: -45, prevBodyYaw: -45, swing: 0, rightArm: true, rodInMain: true, sneaking: false, eyeHeight: 1.62 }]
];
const geo = (b, o, mut) => { const g = ER.bobberGeometry(b, mut ? mut(o) : o, 0.5); return g; };
const lineMismatch = (g, e) => g.line.some((v, i) => { const p = px(v); return p[0] !== e[i][0] || p[1] !== e[i][1]; });
poses.forEach(([b, o], i) => {
  const g = geo(b, o), e = expected(b, o, 0.5);
  ok(g.line.length === 17, 'pose ' + i + ': 17 line vertices');
  ok(!lineMismatch(g, e), 'pose ' + i + ': line pixels match the Java formula');
  ok(g.quad.length === 4 && g.quad[0].u === 0 && g.quad[0].v === 1 && g.quad[2].u === 1 && g.quad[2].v === 0, 'pose ' + i + ': quad uvs');
  const xs = g.quad.map((v) => v.x), ys = g.quad.map((v) => v.y);
  ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 0.5) < 1e-9 && Math.abs(Math.max(...ys) - Math.min(...ys) - 0.5) < 1e-9, 'pose ' + i + ': quad is 0.5 x 0.5 (2x2 scaled by 0.5... 1 unit * 0.5)');
  // fault 1: anchored at feet (eyeHeight 0 and -0.45 dropped)
  breaks++; console.log('   ✓ break caught'); ok(lineMismatch(geo(b, o, (q) => Object.assign({}, q, { eyeHeight: 0 })), e), 'pose ' + i + ': feet-anchored fault is caught');
  // fault 2: wrong arm side
  breaks++; console.log('   ✓ break caught'); ok(lineMismatch(geo(b, o, (q) => Object.assign({}, q, { rightArm: !q.rightArm })), e), 'pose ' + i + ': flipped arm fault is caught');
});

// ---- first person (FishingBobberEntityRenderer.java:62-70): independent transcription with swing != 0 ----
function fpHand(o, fov, t, side, pp) {
  const sq = Math.sin(Math.sqrt(o.swing) * Math.PI), k = 960 / fov;
  let v = pp(side * 0.525, -0.1).map((c) => c * k);
  let a = sq * 0.5, c = Math.cos(a), s = Math.sin(a); v = [v[0] * c + v[2] * s, v[1], v[2] * c - v[0] * s];
  a = -sq * 0.7; c = Math.cos(a); s = Math.sin(a); v = [v[0], v[1] * c + v[2] * s, v[2] * c - v[1] * s];
  return [o.x + v[0], o.y + v[1], o.z + v[2]];
}
const cam0 = { right: [0, 0, 1], up: [0, 1, 0] };   // looking +x: forward = up x right
const pp = (x, y) => ER.projPos(cam0, 70, 16 / 9, x, y);
{
  const fwd = ER.projPos(cam0, 70, 16 / 9, 0, 0);
  ok(Math.abs(fwd[0] - 0.05) < 1e-6 && Math.abs(fwd[1]) < 1e-9 && Math.abs(fwd[2]) < 1e-9, 'projPos centre is 0.05 along forward');
  const b = { x: 3, y: 64, z: 2, px: 3, py: 64, pz: 2 };
  const o = { x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, bodyYaw: 0, prevBodyYaw: 0, swing: 0.4, rightArm: true, rodInMain: true, sneaking: false, eyeHeight: 1.62 };
  const run = (oo, fov) => ER.bobberGeometry(b, oo, 0.5, { firstPerson: true, fov, projPos: pp });
  const h = fpHand(o, 70, 0.5, 1, pp), g = run(o, 70);
  ok(g.hand.every((c, i) => Math.abs(c - h[i]) < 1e-9), 'first-person rod tip matches the Java formula');
  ok(Math.abs(g.line[16].x - Math.fround(h[0] - b.x)) < 1e-6, 'line end reaches the first-person tip');
  const bad = [['wrong fov', run(o, 90)], ['swing ignored', run(Object.assign({}, o, { swing: 0 }), 70)], ['opposite arm', run(Object.assign({}, o, { rightArm: false }), 70)]];
  for (const [n, gg] of bad) { breaks++; console.log('   ✓ break caught'); ok(gg.hand.some((c, i) => Math.abs(c - h[i]) > 1e-6), 'first person: ' + n + ' is caught'); }
}
ok(!ER.OWED.some((s) => /fishing_bobber/.test(s)) && ER.SHAPE.fishing_bobber === 'bobber', 'ER.OWED no longer lists fishing_bobber');
console.log('');
if (fails.length) { console.log(`FAIL  bobberdrawcheck: ${pass} assertions, ${fails.length} failures, ${breaks} anti-vacuity checks (${breaks} breaks caught)`); fails.forEach((x) => console.log('   x ' + x)); process.exit(1); }
console.log(`PASS  bobberdrawcheck: ${pass} assertions, 0 failures, ${breaks} anti-vacuity checks (${breaks} breaks caught)`);
