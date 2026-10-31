#!/usr/bin/env node
// chickenanimcheck.mjs -- #1895: the MOVING-pose audit (L5) for the chicken, against ChickenEntityModel.setAngles,
// ChickenEntityRenderer.method_3893 and ChickenEntity.tickMovement (.decomp).
//
//   node tools/chickenanimcheck.mjs
//
// Sweeps (limbSwing, limbSwingAmount, head yaw/pitch, flap state) through the SAME path the renderer uses
// (`ER.posedPart` over `BE.layers.chicken`) and compares every part's pitch/yaw/roll with the Java formulas;
// replays `Passive.tickChickenFlap` against a line-by-line port of tickMovement over a walk / fall / land
// sequence; checks the baby (AnimalModel: head parts translate (0,5,2) unscaled, body parts scale 1/2 + (0,24,0)).
// Anti-vacuity (D-30): each family is re-run against a corrupted pose / state and must be caught.
import { deflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { vanillaRoot, posedBoxes } from './vanillamodel.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07w_passive.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length });
}
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel, Ps = M.Passive;
ok(ER.ready && BE.ready, 'engine up');
const D = Math.PI / 180, f = Math.fround;
const rest = {}; for (const p of BE.layers.chicken.parts) rest[p.n] = p;

// ── 1. pose: ChickenEntityModel.setAngles over a sweep ──────────────────────────────────────
// `bug` corrupts the expectation (anti-vacuity); returns the number of mismatches.
function poseSweep(bug) {
  let bad = 0, n = 0;
  for (const ls of [0, 3.7, 10, 25.1]) for (const amt of [0, 0.3, 1]) for (const hy of [-60, 0, 35]) for (const hp of [-40, 0, 25])
    for (const roll of [0, 0.6, 2]) {
      const anim = { limbSwing: ls, limbSwingAmount: amt, netHeadYaw: hy, headPitch: hp, riding: false, chickenWingRoll: roll, ageInTicks: 0 };
      const want = {
        head: [hp * D, hy * D, 0], beak: [hp * D, hy * D, 0], red_thing: [hp * D, hy * D, 0],
        right_leg: [Math.cos(ls * 0.6662) * 1.4 * amt * (bug === 'leg' ? -1 : 1), 0, 0],
        left_leg: [Math.cos(ls * 0.6662 + Math.PI) * 1.4 * amt, 0, 0],
        right_wing: [0, 0, roll], left_wing: [0, 0, bug === 'wing' ? roll : -roll],
        body: [0, 0, 0],
      };
      for (const name in want) {
        const q = ER.posedPart(rest[name], anim, 'chicken');
        // posedPart ADDS the delta to the rest rotation; vanilla ASSIGNS, and rest is 0 except the body (PI/2, never animated)
        const [ex, ey, ez] = want[name], b = rest[name];
        const base = name === 'body' ? [b.rx, b.ry, b.rz] : [0, 0, 0];
        n++;
        
        if (Math.abs(q.rx - (ex + base[0])) > 1e-5 || Math.abs(q.ry - (ey + base[1])) > 1e-5 || Math.abs(q.rz - (ez + base[2])) > 1e-5) bad++;
        if (name !== 'body' && (q.px !== b.px || q.py !== b.py || q.pz !== b.pz)) bad++;   // no pivot moves in setAngles
      }
    }
  return { bad, n };
}
const base = poseSweep();
ok(base.n === 4 * 3 * 3 * 3 * 3 * 8 && base.bad === 0, 'pose sweep: ' + base.n + ' part poses match setAngles, ' + base.bad + ' differ');
ok(Math.abs(rest.body.rx - f(Math.PI / 2)) < 1e-6, 'body rest pitch is PI/2');
ok(rest.left_leg.px === 1 && rest.right_leg.px === -2 && rest.left_leg.py === 19, 'legs share one box, pivots (1,19,1) and (-2,19,1)');
// legs are opposite phase by exactly PI
{ const a = { limbSwing: 2, limbSwingAmount: 1, netHeadYaw: 0, headPitch: 0, riding: false, chickenWingRoll: 0 };
  ok(Math.abs(ER.posedPart(rest.right_leg, a, 'chicken').rx + ER.posedPart(rest.left_leg, a, 'chicken').rx) < 1e-6, 'right and left leg swing are mirror images'); }
let breaks = 0;
for (const bug of ['leg', 'wing']) if (ok(poseSweep(bug).bad > 0, 'sweep catches corrupt ' + bug)) breaks++;

// ── 2. wing roll curve (renderer) ───────────────────────────────────────────────────────────
function rollOf(e, t) { return ER.chickenWingRoll(e, t); }
{
  let bad = 0;
  for (const t of [0, 0.25, 1]) for (const [pf, cf, pd, cd] of [[0, 1.8, 0, 0.3], [5, 6.4, 1, 1], [9, 9.9, 0.6, 0]]) {
    const e = { type: 'chicken', prevFlapProgress: pf, flapProgress: cf, prevMaxWingDeviation: pd, maxWingDeviation: cd };
    const w = (Math.sin(pf + (cf - pf) * t) + 1) * (pd + (cd - pd) * t);
    if (Math.abs(rollOf(e, t) - w) > 1e-9) bad++;
  }
  ok(bad === 0, 'chickenWingRoll = (sin(lerp flap)+1)*lerp(dev), 9 samples');
  const e = { type: 'chicken', prevFlapProgress: 0, flapProgress: 2, prevMaxWingDeviation: 0, maxWingDeviation: 1 };
  ok(Math.abs(rollOf(e, 0.5) - (Math.sin(1) + 1) * 0.5) < 1e-9, 'wing roll sample at t=0.5');
  ok(Math.abs(rollOf(e, 0.5) - (Math.sin(1) + 1) * 1) > 1e-3, 'anti-vacuity: wrong deviation lerp is distinguishable');
  breaks++;
}

// ── 3. flap state: Passive.tickChickenFlap vs ChickenEntity.tickMovement ────────────────────
function javaTick(s, onGround) {
  s.pf = s.f; s.pd = s.d;
  s.d = Math.min(1, Math.max(0, s.d + (onGround ? -1 : 4) * 0.3));
  if (!onGround && s.s < 1) s.s = 1;
  s.s *= 0.9;
  s.f = s.f + s.s * 2;
}
function stateRun(bug) {
  const e = { type: 'chicken', onGround: true, flapProgress: 0, prevFlapProgress: 0, maxWingDeviation: 0, prevMaxWingDeviation: 0, flapSpeed: 0, ticksAlive: 1 };
  const s = { f: 0, pf: 0, d: 0, pd: 0, s: 0 };
  let bad = 0;
  for (let t = 0; t < 120; t++) {
    const g = !(t >= 10 && t < 60) && !(t >= 80 && t < 85);   // idle, fall 50 ticks, land, short hop
    e.onGround = g; e.ticksAlive = 1; if (bug === 'ground') e.onGround = true;
    Ps.tickChickenFlap(e); javaTick(s, g);
    if (Math.abs(e.flapProgress - s.f) > 1e-4 || Math.abs(e.prevFlapProgress - s.pf) > 1e-4 ||
        Math.abs(e.maxWingDeviation - s.d) > 1e-5 || Math.abs(e.prevMaxWingDeviation - s.pd) > 1e-5 || Math.abs(e.flapSpeed - s.s) > 1e-5) bad++;
  }
  return bad;
}
ok(stateRun() === 0, 'flap state matches tickMovement for 120 ticks (idle, fall, land, hop)');
ok(stateRun('ground') > 0, 'anti-vacuity: ignoring onGround is caught'); breaks++;
{
  // a rider changes nothing for a chicken (only the parrot has the !vehicle clause)
  const e = { type: 'chicken', onGround: false, vehicle: {}, flapProgress: 0, maxWingDeviation: 0, flapSpeed: 0, ticksAlive: 1 };
  Ps.tickChickenFlap(e);
  ok(Math.abs(e.maxWingDeviation - 1) < 1e-6, 'a chicken in the air flaps even when riding (ChickenEntity has no vehicle check)');
}
ok(Ps.CHICKEN_FALL_MULT === 0.6, 'slow-fall multiplier 0.6');

// ── 4. baby: AnimalModel(false, 5, 2, 2, 2, 24) ─────────────────────────────────────────────
function babyRun(bug) {
  let bad = 0;
  for (const n of ['head', 'beak', 'red_thing']) { const t = ER.babyTransform('chicken', n); if (!t || t.s !== (bug ? 0.5 : 1) || t.oy !== 5 || t.oz !== 2) bad++; }
  for (const n of ['body', 'right_leg', 'left_leg', 'right_wing', 'left_wing']) { const t = ER.babyTransform('chicken', n); if (!t || t.s !== 0.5 || t.oy !== 24 || t.oz !== 0) bad++; }
  return bad;
}
ok(babyRun() === 0, 'baby: head parts (1, +5, +2), body parts (0.5, +24, 0)');
ok(babyRun(true) > 0, 'anti-vacuity: scaling the baby head is caught'); breaks++;

// ── 5. EMITTED quads in a moving pose vs the .decomp model posed by its own setAngles (L5, geometry level) ─────
// ENGINE: ER.emitMobLayer(chicken, anim) unpacked (what the GPU is handed). REFERENCE: ChickenEntityModel.getTexturedModelData()
// evaluated from .decomp, each Part's rotation ASSIGNED as setAngles does, corners composed by posedBoxes, then the
// LivingEntityRenderer frame at yaw 180 (x/16, 1.501 - y/16, -z/16). Every reference box corner must be an engine vertex and back.
{
  const MS = M.Mesher, U = M.CFG.MODEL_UNITS_PER_BLOCK;
  const root = vanillaRoot('ChickenEntityModel');
  const setAngles = (r, a, bug) => {
    r.kids.forEach((k, i) => {
      const n = r.names[i], x = k.xf.r;
      if (n === 'head' || n === 'beak' || n === 'red_thing') { x[0] = a.hp * D; x[1] = a.hy * D; }
      else if (n === 'right_leg') x[0] = Math.cos(a.ls * 0.6662) * 1.4 * a.amt * (bug === 'leg' ? -1 : 1);
      else if (n === 'left_leg') x[0] = Math.cos(a.ls * 0.6662 + Math.PI) * 1.4 * a.amt;
      else if (n === 'right_wing') x[2] = a.roll;
      else if (n === 'left_wing') x[2] = bug === 'wing' ? a.roll : -a.roll;
    });
  };
  const refPts = (a, bug) => {
    const r = vanillaRoot('ChickenEntityModel'); setAngles(r, a, bug);
    return posedBoxes(r).flatMap((b) => b.corners.map((c) => [c[0] / 16, 1.501 - c[1] / 16, -c[2] / 16]));
  };
  const engPts = (a) => {
    const n = ER.mobQuadCount('chicken'), buf = MS.allocBuffer(0, 0, 0, [n, 0, 0]), hdr = MS.readHeader(buf), w = new Uint32Array(buf, hdr.modelOff[0], n * 16);
    const anim = { limbSwing: a.ls, limbSwingAmount: a.amt, netHeadYaw: a.hy, headPitch: a.hp, riding: false, chickenWingRoll: a.roll, ageInTicks: 0 };
    const end = ER.emitMobLayer(w, 0, 'chicken', 0, 0, 0, Math.cos(Math.PI), Math.sin(Math.PI), 15, 0, 3, anim, ER.basePoseFor('chicken'), undefined, 0, null, null, undefined);
    const out = [];
    for (let q = 0; q < end / 16; q++) for (let c = 0; c < 4; c++) { const o = q * 16 + c * 4, v = MS.unpackModelVertex(w[o], w[o + 1], w[o + 2], w[o + 3]); out.push([v.px / U, v.py / U, v.pz / U]); }
    return out;
  };
  const near = (p, set) => set.some((q) => Math.abs(p[0] - q[0]) < 0.012 && Math.abs(p[1] - q[1]) < 0.012 && Math.abs(p[2] - q[2]) < 0.012);
  const run = (bug) => {
    let bad = 0, n = 0;
    for (const a of [{ ls: 0, amt: 0, hy: 0, hp: 0, roll: 0 }, { ls: 3.7, amt: 0.8, hy: 35, hp: -25, roll: 0.9 }, { ls: 10, amt: 1, hy: -60, hp: 40, roll: 1.8 }, { ls: 25.1, amt: 0.4, hy: 10, hp: 15, roll: 0.3 }]) {
      const R = refPts(a, bug), E = engPts(a);
      for (const p of R) { n++; if (!near(p, E)) bad++; }
      for (const p of E) { n++; if (!near(p, R)) bad++; }
    }
    return { bad, n };
  };
  const r0 = run();
  ok(r0.n > 1000 && r0.bad === 0, 'emitted chicken quads match the posed .decomp model over 4 moving poses: ' + r0.n + ' vertex tests, ' + r0.bad + ' off');
  for (const bug of ['leg', 'wing']) if (ok(run(bug).bad > 0, 'emitted-quad sweep catches corrupt ' + bug)) breaks++;
}

console.log(fails.map(x => '  FAIL ' + x).join('\n'));
console.log(`chickenanimcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
