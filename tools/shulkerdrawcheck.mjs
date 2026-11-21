#!/usr/bin/env node
// shulkerdrawcheck.mjs — D-773 cloud unit (tender-carson-7zokog): the shulker as vanilla DRAWS it
// (src/07zzl_shulkerdraw.js + its hooks in 07j_entityrender.js / 07i_entitylist.js / 07k_goals.js).
//
//   node tools/shulkerdrawcheck.mjs [--verbose]
//
// Sections (every one drives the REAL code; numbers the code owns are never retyped here):
//   1. the face rotation — every attached face's matrix is a proper rotation (orthonormal, det +1)
//      and turns the model's "lid up" axis to point AWAY from the wall it hangs on (the fact
//      `Direction.getRotationQuaternion` of the OPPOSITE face exists to produce)
//   2. open progress — tickOpenProgress walks toward peek*0.01 and stops there, both directions;
//      getOpenProgress is the lerp between the last two ticks
//   3. the lid/head pose — a closed lid is exactly the REST pose; opening raises it
//   4. THE PICTURE — the real `ER.emitMobLayer` fed `ER.animOf`: a closed floor shulker fills its
//      own block; an OPEN floor shulker's lid rises above it; an OPEN north-wall shulker's lid
//      pushes out SOUTH, not up (anti-vacuity: the same wall shulker drawn with the identity
//      matrix pushes up — the bug this unit fixes, caught)
//   4b. no-cull (ShulkerEntityModel's getEntityCutoutNoCullZOffset): each quad has its reversed back
//   5. ShulkerBodyControl — ticking the head never turns a shulker's body
//   6. the teleport slide — a moved shulker is drawn at the block it left, sliding in over 6 ticks
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b, e = 1e-5) => Math.abs(a - b) <= e;

console.log('shulkerdrawcheck — D-773 cloud unit: shulker lid/head pose, attached-face rotation, teleport slide');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '14b_physics.js',
  '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07zzk_shulker.js', '07zzl_shulkerdraw.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
if (initRegistry) initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
{ const mm = rdj('models.meta.json'); M.BEModel.init({ models: b64('models.bin'), modelsBytes: mm.rawBytes }); }
M.Entities.init(); M.EntityList.init();
M.World.init(1);
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
if (M.Ai && M.Ai.init && !M.Ai.ready) M.Ai.init();
M.Shulker.init();
M.EntityRender.init();

const SD = M.ShulkerDraw, ER = M.EntityRender, BE = M.BEModel, Sh = M.Shulker, CFG = M.CFG;
ok(SD && SD.ready, 'NS.ShulkerDraw loaded and ready');

// ============ 1. the face rotation ==========================================================
{
  const mul = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
                         R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];
  for (let f = 0; f < 6; f++) {
    const R = SD.faceMatrix(f);
    const c0 = [R[0], R[3], R[6]], c1 = [R[1], R[4], R[7]], c2 = [R[2], R[5], R[8]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]);
    ok(near(dot(c0, c0), 1) && near(dot(c1, c1), 1) && near(dot(c2, c2), 1) && near(dot(c0, c1), 0) &&
       near(dot(c1, c2), 0) && near(dot(c0, c2), 0) && near(det, 1), `face ${f}: a proper rotation (det ${det.toFixed(6)})`);
    // lid "up" in the flipped model frame is +y; it must point AWAY from the wall: -DIR(attached)
    const up = mul(R, [0, 1, 0]);
    const away = [-Sh.DX[f], -Sh.DY[f], -Sh.DZ[f]];
    ok(near(up[0], away[0]) && near(up[1], away[1]) && near(up[2], away[2]),
      `attached face ${f}: the lid opens toward ${JSON.stringify(away)} (got ${up.map((v) => +v.toFixed(4))})`);
  }
  okAv(!near(SD.faceMatrix(2)[4], 1), 'a NORTH-wall shulker is NOT the identity (the old "every shulker upright" picture)');
}

// ============ 2. open progress ==============================================================
{
  const e = { shulkerPeek: 30 };
  let steps = 0;
  while (SD.tickOpenProgress(e) && steps < 100) steps++;
  ok(near(e.shulkerOpen, 0.3, 1e-9), `peek 30 opens to exactly 0.3 and stops (${e.shulkerOpen})`);
  ok(steps >= 5 && steps <= 7, `…in about 0.3/0.05 = 6 ticks (${steps})`);
  e.shulkerPeek = 0; SD.tickOpenProgress(e);
  ok(near(e.shulkerOpenO, 0.3) && e.shulkerOpen < 0.3, 'closing starts from where it was');
  ok(near(SD.openProgress(e, 0.5), (e.shulkerOpenO + e.shulkerOpen) / 2), 'getOpenProgress is the lerp of the last two ticks');
  while (SD.tickOpenProgress(e)) {}
  okAv(e.shulkerOpen === 0, 'peek 0 closes it fully (a stuck-open lid would be caught)');
}

// ============ 3. the lid/head pose ==========================================================
{
  const closed = SD.delta('lid', { open: 0, age: 0, headYaw: 0 }, 0);
  ok(near(closed.dpy, 0) && closed.ry === 0 && closed.rx === 0, 'a closed lid is exactly the REST pose');
  const half = SD.delta('lid', { open: 0.3, age: 0, headYaw: 0 }, 0);
  const full = SD.delta('lid', { open: 1, age: 0, headYaw: 0 }, 0);
  ok(half.dpy < 0 && full.dpy < half.dpy, `opening raises the lid (model y is down): 0 → ${half.dpy.toFixed(3)} → ${full.dpy.toFixed(3)}`);
  ok(SD.delta('base', { open: 1, age: 5, headYaw: 1 }, 30) === null, 'the base is never posed');
  const h = SD.delta('head', { open: 0, age: 0, headYaw: 0.7 }, 45);
  ok(near(h.ry, 0.7) && near(h.rx, Math.PI / 4), 'head yaw is the raw head heading, pitch the look pitch');
}

// ============ 4. THE PICTURE ================================================================
{
  const U = CFG.MODEL_UNITS_PER_BLOCK;
  const n = ER.mobQuadCount('shulker');
  ok(ER.mobLayerFor('shulker') === 'shulker', 'the shulker layer is drawn through the mob path');
  function bounds(face, open, hide, forceR) {
    const e = { type: 'shulker', maxHealth: 30, age: 10, yaw: 0, yHeadRot: 0, xHeadRot: 0,
                shulkerFace: face, shulkerOpen: open, shulkerOpenO: open };
    const anim = ER.animOf(e, 1);
    if (forceR) anim.shulker.R = forceR;
    const out = new Uint32Array(n * 16);
    const end = ER.emitMobLayer(out, 0, 'shulker', 0, 0, 0, 1, 0, 15, 0, 3, anim, undefined, undefined, false,
                                null, null, hide || null);
    const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (let o = 0; o < end; o += 4) {
      const v = M.Mesher.unpackModelVertex(out[o], out[o + 1], out[o + 2], out[o + 3]);
      b.minX = Math.min(b.minX, v.px / U); b.maxX = Math.max(b.maxX, v.px / U);
      b.minY = Math.min(b.minY, v.py / U); b.maxY = Math.max(b.maxY, v.py / U);
      b.minZ = Math.min(b.minZ, v.pz / U); b.maxZ = Math.max(b.maxZ, v.pz / U);
    }
    return b;
  }
  ok(ER.animOf({ type: 'shulker', maxHealth: 30, shulkerFace: 0 }, 1).shulker, 'ER.animOf carries the shulker pose');
  const tol = 0.01;
  const floorClosed = bounds(0, 0);
  ok(near(floorClosed.minY, 0, tol) && near(floorClosed.maxY, 1, tol) && near(floorClosed.minX, -0.5, tol) &&
     near(floorClosed.maxX, 0.5, tol) && near(floorClosed.minZ, -0.5, tol) && near(floorClosed.maxZ, 0.5, tol),
     `a closed floor shulker fills its own block (${JSON.stringify(floorClosed)})`);
  const lidOnly = { base: 1, head: 1 };
  const floorOpen = bounds(0, 1, lidOnly);
  ok(floorOpen.maxY > 1.4, `an open floor shulker's lid rises above its block (top ${floorOpen.maxY.toFixed(3)})`);
  const ceil = bounds(1, 1, lidOnly);
  ok(ceil.minY < -0.4 && ceil.maxY <= 1 + tol, `an open ceiling shulker's lid drops below its block (bottom ${ceil.minY.toFixed(3)})`);
  const northOpen = bounds(2, 1, lidOnly);
  ok(northOpen.maxZ > 0.9 && northOpen.maxY <= 1 + tol && northOpen.minY >= -tol,
     `an open NORTH-wall shulker's lid pushes out SOUTH, staying in its block's height (${JSON.stringify(northOpen)})`);
  const eastOpen = bounds(5, 1, lidOnly);
  ok(eastOpen.minX < -0.9 && eastOpen.maxY <= 1 + tol, `an open EAST-wall shulker's lid pushes out WEST (minX ${eastOpen.minX.toFixed(3)})`);
  const northClosed = bounds(2, 0);
  ok(near(northClosed.minY, 0, tol) && near(northClosed.maxY, 1, tol) && near(northClosed.maxZ, 0.5, tol),
     'a closed wall shulker still fills exactly its own block (rotation is about the block centre)');
  const wrong = bounds(2, 1, lidOnly, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  okAv(wrong.maxY > 1.4 && !(wrong.maxZ > 0.9), 'the identity matrix (no face rotation) draws the wall lid opening UP — caught');
}

// ============ 4b. no-cull: the shell is drawn from inside too ===============================
{
  const n = ER.mobQuadCount('shulker');
  const e = { type: 'shulker', maxHealth: 30, age: 10, yaw: 0, yHeadRot: 0, xHeadRot: 0, shulkerFace: 0 };
  const out = new Uint32Array(n * 16 + 64);
  const end = ER.emitMobLayer(out, 0, 'shulker', 0, 0, 0, 1, 0, 15, 0, 3, ER.animOf(e, 1));
  ok(end === n * 16, `emitMobLayer writes exactly mobQuadCount quads (${end / 16} of ${n}) -- the buffer is sized for the back faces`);
  // every front quad is followed by its own back: same four corners, reversed order, opposite face bucket
  let paired = 0, quads = end / 16;
  for (let q = 0; q + 1 < quads; q += 2) {
    const A = [], B = [];
    for (let c = 0; c < 4; c++) {
      A.push(M.Mesher.unpackModelVertex(out[q * 16 + c * 4], out[q * 16 + c * 4 + 1], out[q * 16 + c * 4 + 2], out[q * 16 + c * 4 + 3]));
      B.push(M.Mesher.unpackModelVertex(out[(q + 1) * 16 + c * 4], out[(q + 1) * 16 + c * 4 + 1], out[(q + 1) * 16 + c * 4 + 2], out[(q + 1) * 16 + c * 4 + 3]));
    }
    let same = true;
    for (let c = 0; c < 4; c++) if (A[c].px !== B[3 - c].px || A[c].py !== B[3 - c].py || A[c].pz !== B[3 - c].pz || A[c].u !== B[3 - c].u) same = false;
    if (same && (A[0].face ^ 1) === B[0].face) paired++;
  }
  ok(paired === quads / 2, `every shulker quad has its reversed back quad (${paired} of ${quads / 2})`);
  {
    const nc = ER.mobQuadCount('cow'), co = new Uint32Array(nc * 32);
    const cend = ER.emitMobLayer(co, 0, 'cow', 0, 0, 0, 1, 0, 15, 0, 3, null);
    okAv(cend === nc * 16 && !ER.NO_CULL.cow, `a cow stays single-sided (${cend / 16} quads) -- the rule is per-layer, not global`);
  }
}

// ============ 5. ShulkerBodyControl ==========================================================
{
  const e = { type: 'shulker', x: 0.5, y: 5, z: 0.5, yaw: 1.0, yHeadRot: 1.0 };
  M.Ai.tickHead(e);
  e.yHeadRot = 2.5;
  for (let i = 0; i < 40; i++) { e.yHeadRot = 2.5; M.Ai.tickHead(e); M.Ai.tickBody(e); }
  ok(e.yaw === 1.0, `a shulker's body never turns toward its head (${e.yaw})`);
  const cow = { type: 'cow', x: 0.5, y: 5, z: 0.5, yaw: 1.0, yHeadRot: 1.0 };
  M.Ai.tickHead(cow);
  for (let i = 0; i < 40; i++) { cow.yHeadRot = 2.5; cow.xOld = cow.x; cow.zOld = cow.z; M.Ai.tickHead(cow); M.Ai.tickBody(cow); }
  okAv(cow.yBodyRot !== 1.0, `a cow's body DOES follow its head (${cow.yBodyRot.toFixed(3)}) — the control is per-type, not dead`);
}

// ============ 6. the teleport slide ==========================================================
{
  const e = { type: 'shulker', x: 3.5, y: 5, z: 3.5, age: 10 };
  SD.tick(e);
  ok(SD.lerpOffset(e, 0) === null, 'a shulker that has not moved draws where it is');
  e.x = 7.5; e.y = 6; e.z = 3.5; e.age++;
  SD.tick(e);
  const o0 = SD.lerpOffset(e, 0);
  ok(o0 && near(o0[0], -4) && near(o0[1], -1) && near(o0[2], 0), `right after a teleport it is drawn at the block it left (${JSON.stringify(o0)})`);
  const o5 = SD.lerpOffset(e, 0.5);
  ok(o5 && Math.abs(o5[0]) < 4 && Math.abs(o5[0]) > 0, 'and slides in within the tick');
  let ticks = 0;
  while (SD.lerpOffset(e, 0) && ticks < 20) { e.age++; SD.tick(e); ticks++; }
  ok(ticks === 6, `…arriving after exactly SD.LERP_TICKS ticks (${ticks})`);
  okAv(SD.lerpOffset(e, 0) === null, 'no offset left once it has arrived (a stuck slide would be caught)');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
