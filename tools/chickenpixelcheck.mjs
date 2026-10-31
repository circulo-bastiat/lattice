#!/usr/bin/env node
// chickenpixelcheck.mjs -- #1895 L5, PIXEL level: the chicken in MOVING poses, six axis views, drawn by the mobl3check
// rasteriser from (a) the .decomp ChickenEntityModel posed the way setAngles ASSIGNS its rotations, texels from the jar PNG,
// and (b) ER.emitMobLayer with the same animation state, texels from the packed mob tiles (what the GPU is handed).
// Outside the measured edge band every pixel must be identical. Anti-vacuity (D-30): a wrong leg phase / mirrored wing in
// the reference must produce mismatching pixels.
import { Jar } from './jarlib.mjs';
import { decodePng } from './png.mjs';
import { requireJar, skipCheck } from './paths.mjs';
import { vanillaRoot } from './vanillamodel.mjs';

let L3;
try { L3 = await import('./mobl3check.mjs'); } catch (e) { skipCheck('chickenpixelcheck', String(e.message || e)); }
const { compare, tilesReal } = L3;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };

const jar = new Jar(requireJar('1.18.2'));
const d = decodePng(jar.read('assets/minecraft/textures/entity/chicken.png'));
const img = { w: d.width, h: d.height, data: d.data };
const D = Math.PI / 180;

const POSES = [
  { name: 'rest', ls: 0, amt: 0, hy: 0, hp: 0, roll: 0 },
  { name: 'walk', ls: 3.7, amt: 0.8, hy: 35, hp: -25, roll: 0.9 },
  { name: 'fall', ls: 10, amt: 1, hy: -60, hp: 40, roll: 1.8 },
  { name: 'turn', ls: 25.1, amt: 0.4, hy: 10, hp: 15, roll: 0.3 },
];
function refQuads(a, bug) {
  const r = vanillaRoot('ChickenEntityModel');
  r.kids.forEach((k, i) => {
    const n = r.names[i], x = k.xf.r;
    if (n === 'head' || n === 'beak' || n === 'red_thing') { x[0] = a.hp * D; x[1] = a.hy * D; }
    else if (n === 'right_leg') x[0] = Math.cos(a.ls * 0.6662) * 1.4 * a.amt * (bug === 'leg' ? -1 : 1);
    else if (n === 'left_leg') x[0] = Math.cos(a.ls * 0.6662 + Math.PI) * 1.4 * a.amt;
    else if (n === 'right_wing') x[2] = a.roll;
    else if (n === 'left_wing') x[2] = bug === 'wing' ? a.roll : -a.roll;
  });
  return L3.vanillaQuads(r, img, L3.hiddenOf ? L3.hiddenOf('chicken') : undefined);
}
function engQuads(a) {
  const { ER, MS, U, geom } = L3.engineHandles;
  const n = ER.mobQuadCount('chicken'), buf = MS.allocBuffer(0, 0, 0, [n, 0, 0]), hdr = MS.readHeader(buf), w = new Uint32Array(buf, hdr.modelOff[0], n * 16);
  const anim = { limbSwing: a.ls, limbSwingAmount: a.amt, netHeadYaw: a.hy, headPitch: a.hp, riding: false, chickenWingRoll: a.roll, ageInTicks: 0 };
  const end = ER.emitMobLayer(w, 0, 'chicken', 0, 0, 0, Math.cos(Math.PI), Math.sin(Math.PI), 15, 0, 3, anim, ER.basePoseFor('chicken'), undefined, 0, null, null, undefined);
  const out = [];
  for (let q = 0; q < end / 16; q++) {
    const p = [], uv = []; let tile = 0;
    for (let c = 0; c < 4; c++) { const o = q * 16 + c * 4, v = MS.unpackModelVertex(w[o], w[o + 1], w[o + 2], w[o + 3]); p.push([v.px / U, v.py / U, v.pz / U]); uv.push([v.u / 16, v.v / 16]); tile = v.tile; }
    out.push({ p, uv, tile, tiles: tilesReal });
  }
  return out;
}
let breaks = 0;
const total = {};
for (const a of POSES) {
  const eng = engQuads(a), R = compare(refQuads(a), eng);
  ok(R.px > 500 && R.mism === 0, `${a.name}: ${R.px} px, ${R.mism} mismatching (${R.band} in the edge band)`);
}
for (const bug of ['leg', 'wing']) {
  let mism = 0;
  for (const a of POSES.slice(1)) mism += compare(refQuads(a, bug), engQuads(a)).mism;
  if (ok(mism > 0, `sweep catches corrupt ${bug} (${mism} px)`)) { breaks++; console.log(`  ✓ break caught: ${bug}`); }
}
console.log(fails.map((x) => '  FAIL ' + x).join('\n'));
console.log(`chickenpixelcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
