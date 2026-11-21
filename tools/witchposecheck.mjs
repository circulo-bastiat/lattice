#!/usr/bin/env node
// witchposecheck.mjs — #4002 "witch hat is visibly glitched". The EMITTED quads of a witch with her head turned
// (yaw 40, pitch 25) must sit where the vanilla parent chain head -> hat -> hat2 -> hat3 -> hat4 (and nose -> mole)
// puts them. mobl3check/mobshapecheck only draw the REST pose, and hatnosecheck reads `fullyPosedPart`, not the
// emit path: the emit path's own setupAnimDelta call omitted `hatComposed`, so `hat` was turned by the head
// twice (direct shortcut + PART_PARENT) while hat2..hat4 (composed from rest parts) were right: the hat sheared off
// its own cone. Every box corner of every chain part must coincide with an emitted vertex.
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

const A = MCLITE_ROOT + 'assets/', TOL = 0.04, D = Math.PI / 180;
const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
const mm = JSON.parse(readFileSync(A + 'models.meta.json', 'utf8'));
M.BEModel.init({ models: readFileSync(A + 'models.bin').toString('base64'), modelsBytes: mm.rawBytes });
const geom = readFileSync(A + 'mob-geometry.json');
M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geom, { level: 9 }).toString('base64'), mobGeometryBytes: geom.length,
  entities: JSON.parse(readFileSync(A + 'entities.json', 'utf8')) });
M.Entities.init(); M.EntityList.init();
const ER = M.EntityRender; ER.init();
const U = M.CFG.MODEL_UNITS_PER_BLOCK, L = M.BEModel.layer('witch');
const byN = (n) => L.parts.find((p) => p.n === n);
const mul = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o; };
const mv = (m, v) => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]);
const PAR = { hat: 'head', hat2: 'hat', hat3: 'hat2', hat4: 'hat3', hat_rim: 'hat', nose: 'head', mole: 'nose' };   // nose is animated (own delta): only its REST pose is the parent of mole here
function expected(n) {   // vanilla: world = parent.pos + parent.R * pivot; R = parent.R * rot(own)
  const p = byN(n);
  if (n === 'head') return { pos: [p.px, p.py, p.pz], R: ER.rotMatrix(25 * D, 40 * D, 0) };
  const P = expected(PAR[n]), l = mv(P.R, [p.px, p.py, p.pz]);
  return { pos: [P.pos[0] + l[0], P.pos[1] + l[1], P.pos[2] + l[2]], R: mul(P.R, ER.rotMatrix(p.rx, p.ry, p.rz)) };
}
function emitted() {
  const n = ER.mobQuadCount('witch'), buf = M.Mesher.allocBuffer(0, 0, 0, [n, 0, 0]), hdr = M.Mesher.readHeader(buf);
  const w = new Uint32Array(buf, hdr.modelOff[0], n * 16), vs = [];
  ER.emitMobLayer(w, 0, 'witch', 0, 0, 0, Math.cos(Math.PI), Math.sin(Math.PI), 15, 0, 3,
    { limbSwing: 0, limbSwingAmount: 0, netHeadYaw: 40, headPitch: 25, riding: false }, ER.basePoseFor('witch'), undefined, 0, null, null);
  for (let i = 0; i < n * 4; i++) { const v = M.Mesher.unpackModelVertex(w[i * 4], w[i * 4 + 1], w[i * 4 + 2], w[i * 4 + 3]); vs.push([v.px / U, v.py / U, v.pz / U]); }
  return vs;
}
function run() {   // -> worst corner distance per part, in blocks
  const vs = emitted(), out = {};
  for (const n of ['head', 'hat', 'hat2', 'hat3', 'hat4', 'hat_rim', 'mole']) {
    const p = byN(n), e = expected(n), g = p.g || 0; let worst = 0;
    for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) {
      const r = mv(e.R, [p.x - g + sx * p.w, p.y - g + sy * p.h, p.z - g + sz * p.d]);
      const t = [(e.pos[0] + r[0]) / 16, 1.501 - (e.pos[1] + r[1]) / 16, -(e.pos[2] + r[2]) / 16];
      worst = Math.max(worst, Math.min(...vs.map((v) => Math.hypot(v[0] - t[0], v[1] - t[1], v[2] - t[2]))));
    }
    out[n] = worst;
  }
  return out;
}
const bad = (r) => Object.entries(r).filter(([, d]) => d > TOL).map(([n, d]) => n + ' ' + d.toFixed(3));
console.log('witchposecheck — head turned yaw 40 / pitch 25: emitted hat chain vs vanilla parent chain (#4002)');
const good = bad(run());
if (good.length) { console.log('✗ posed witch off the vanilla chain: ' + good.join(', ')); process.exit(1); }
console.log('   ✓ head, hat, hat2, hat3, hat4, hat_rim, mole corners within ' + TOL + ' block');
// anti-vacuity: restore the old bug (emit path forgets hatComposed) and the check must fail
const orig = ER.setupAnimDelta;
ER.setupAnimDelta = function (a, b, c, d, e, f, g, ctx) { if (ctx) ctx = Object.assign({}, ctx, { hatComposed: false }); return orig.call(this, a, b, c, d, e, f, g, ctx); };
const broken = bad(run());
ER.setupAnimDelta = orig;
if (!broken.length) { console.log('✗ anti-vacuity: the double-rotated hat went unnoticed'); process.exit(1); }
console.log('   ✓ a double-turned hat fails (' + broken.join(', ') + ')');
console.log('PASS witchposecheck: 2 assertions, 0 failures, 1 break caught');
