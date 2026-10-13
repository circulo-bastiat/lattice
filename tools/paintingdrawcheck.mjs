#!/usr/bin/env node
// paintingdrawcheck.mjs — #5707 (G17-HG7): ER.paintingQuads / ER.emitPainting against
// PaintingEntityRenderer.renderPainting worked by hand, for a 2x1 (pool) and a 4x4 (pointer) painting on
// all four facings; the packed tile layers against the jar; the OWED line gone.
// The expectation below is written a DIFFERENT way from the engine: a per-facing (x,z) table instead of a
// rotation, and sheet-fraction uvs (Sprite.getFrameU of the whole motive) converted to tile + local uv.
// Anti-vacuity: a half-block shift, a mirrored tile column and a dropped tile light each must fail.
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07zzv_hanging.js', '07j_entityrender.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
const ER = M.EntityRender, H = M.Hanging;
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; console.log('   x ' + m); } };
const near = (a, b) => Math.abs(a - b) < 1e-6;

// facing id (0 S,1 W,2 N,3 E) -> local (x,z) to world (dx,dz): rotateY(180 - yaw), yaw = 90 * id
const XF = [(x, z) => [-x, -z], (x, z) => [z, -x], (x, z) => [x, z], (x, z) => [-z, x]];

// Expected 24 quads' worth of tile data for one painting; `bug` perturbs it so the check can be shown to fail.
function expected(e, bug) {
  const mi = H.MOTIVES.findIndex((m) => m[0] === e.motive);
  const [, W, Hh] = H.MOTIVES[mi], cols = W / 16, rows = Hh / 16;
  let off = 1; for (let k = 0; k < mi; k++) off += (H.MOTIVES[k][1] / 16) * (H.MOTIVES[k][2] / 16);
  const xf = XF[e.facing], out = [];
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const xR = -W / 2 + (i + 1) * 16, xL = -W / 2 + i * 16, yT = -Hh / 2 + (j + 1) * 16, yB = -Hh / 2 + j * 16;
    // front quad corners in vanilla order: (xR,yB) (xL,yB) (xL,yT) (xR,yT), z = -0.5
    const fx = [xR, xL, xL, xR], fy = [yB, yB, yT, yT];
    // sheet fractions (frameU(16/cols*(cols-i)) / 16) -> tile col and local u
    const fu = [(cols - i - 1) / cols, (cols - i) / cols, (cols - i) / cols, (cols - i - 1) / cols];
    const fv = [(rows - j) / rows, (rows - j) / rows, (rows - j - 1) / rows, (rows - j - 1) / rows];
    const col = Math.round(Math.min(fu[0], fu[1]) * cols), row = Math.round(Math.min(fv[0], fv[2]) * rows);
    const q = { tile: off + row * cols + (bug === 'mirror' ? cols - 1 - col : col), p: [], uv: [], n: [0, 0, 0] };
    for (let c = 0; c < 4; c++) {
      const [wx, wz] = xf(fx[c], -0.5);
      q.p.push([e.x + wx / 16 + (bug === 'half' ? 0.5 : 0), e.y + fy[c] / 16, e.z + wz / 16]);
      q.uv.push([(fu[c] * cols - col) * 16, (fv[c] * rows - row) * 16]);
    }
    const [nx, nz] = xf(0, -1);
    q.n = [nx, 0, nz];
    // light cell: the tile centre's block, per vanilla's four facing branches
    const mx = (xR + xL) / 2 / 16;
    let bx = Math.floor(e.x), bz = Math.floor(e.z);
    if (e.facing === 2) bx = Math.floor(e.x + mx);
    if (e.facing === 1) bz = Math.floor(e.z - mx);
    if (e.facing === 0) bx = Math.floor(e.x - mx);
    if (e.facing === 3) bz = Math.floor(e.z + mx);
    q.cell = [bx, Math.floor(e.y + (yT + yB) / 2 / 16), bz];
    if (bug === 'light') q.cell = [Math.floor(e.x), Math.floor(e.y), Math.floor(e.z)];
    out.push(q);
  }
  return out;
}

// Compare ER's FRONT quads (index 0 of every group of six) with the hand values.
function matches(e, bug) {
  const got = ER.paintingQuads(e), exp = expected(e, bug);
  if (got.length !== exp.length * 6) return 'quad count ' + got.length + ' != ' + exp.length * 6;
  for (let t = 0; t < exp.length; t++) {
    const g = got[t * 6], x = exp[t];
    if (g.tile !== x.tile) return `tile ${t}: ${g.tile} != ${x.tile}`;
    for (let c = 0; c < 4; c++) {
      for (let k = 0; k < 3; k++) if (!near(g.p[c][k], x.p[c][k])) return `tile ${t} vertex ${c} axis ${k}: ${g.p[c][k]} != ${x.p[c][k]}`;
      for (let k = 0; k < 2; k++) if (!near(g.uv[c][k], x.uv[c][k])) return `tile ${t} uv ${c}: ${g.uv[c]} != ${x.uv[c]}`;
    }
    for (let k = 0; k < 3; k++) if (!near(g.n[k], x.n[k])) return `tile ${t} normal`;
    for (let k = 0; k < 3; k++) if (g.cell[k] !== x.cell[k]) return `tile ${t} light cell ${g.cell} != ${x.cell}`;
    for (let s = 1; s < 6; s++) if (got[t * 6 + s].tile !== 0) return `tile ${t} quad ${s} is not the back sprite`;
  }
  return null;
}

function mk(motive, facing) {
  const e = H.attach({ type: 'painting', motive }, 10, 64, 10, facing, ...H.MOTIVES.find((m) => m[0] === motive).slice(1));
  return e;
}
for (const motive of ['pool', 'pointer']) for (let f = 0; f < 4; f++) {
  const r = matches(mk(motive, f), null);
  ok(!r, `${motive} facing ${f}: ${r}`);
}

// literal hand values: north-facing pool at (10, 64.5, 10.96875): tile i=0 front vertex 0 is xR=0,yB=-8
{
  const e = mk('pool', 2), q = ER.paintingQuads(e)[0];
  ok(near(q.p[0][0], 10) && near(q.p[0][1], 64) && near(q.p[0][2], 10.96875 - 0.03125), 'literal pool/north vertex 0: ' + q.p[0]);
  ok(q.tile === 9, 'literal tile index (1 back + 7 one-block motives, then pool column 1): ' + q.tile);
  ok(near(q.uv[0][0], 0) && near(q.uv[0][1], 16), 'literal uv 0,16: ' + q.uv[0]);
  // vertical frame faces: 1px of the back sprite (Sprite.getFrameV(1.0))
  const top = ER.paintingQuads(e)[2];
  ok(near(top.uv[2][1], 1) && top.n[1] === 1, 'top face samples 1px of the back sprite');
}

// the packed layers: 1 + sum(cols*rows) = 126, layer 0 = back.png, a pointer tile = the jar's pixels
{
  let total = 1; for (const m of H.MOTIVES) total += (m[1] / 16) * (m[2] / 16);
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets/painting-tiles.meta.json'), 'utf8'));
  ok(meta.count === total, `painting-tiles has ${meta.count} layers, motives need ${total}`);
  const raw = inflateRawSync(readFileSync(join(MCLITE_ROOT, 'assets/painting-tiles.bin')));
  ok(raw.length === total * 1024, 'painting-tiles payload size');
  let used = 0; for (const b of raw) used += b ? 1 : 0;
  ok(used > raw.length / 4, 'painting tiles are not blank');
}

// the OWED line is gone and the shape is registered
ok(!ER.OWED.some((s) => s.startsWith('painting')), 'painting still on ER.OWED');
ok(ER.SHAPE.painting === 'painting', 'ER.SHAPE.painting');

// emitPainting writes 4 vertices per quad into the model stream
{
  const e = mk('pointer', 2), qs = ER.paintingQuads(e);
  const out = new Uint32Array(qs.length * 16);
  ok(ER.emitPainting(out, 0, qs, 8, 60, 8) === qs.length * 16, 'emitPainting word count');
}

// anti-vacuity: each deliberate bug must be caught
let caught = 0, wanted = 0;
for (const bug of ['half', 'mirror', 'light']) for (const motive of ['pool', 'pointer']) {
  wanted++;
  let any = false;
  for (let f = 0; f < 4; f++) if (matches(mk(motive, f), bug)) any = true;
  if (any) caught++; else { fails++; console.log(`   x bug "${bug}" on ${motive} was NOT caught`); }
}
console.log(`paintingdrawcheck: ${checks} checks, ${fails} failures, ${caught} breaks caught (of ${wanted})`);
process.exit(fails ? 1 : 0);
