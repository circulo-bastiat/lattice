#!/usr/bin/env node
// guardianbeamcheck.mjs — #1111: the guardian/elder_guardian beam render layer (GuardianEntityRenderer.render's
// beam half, .decomp): ER.guardianBeamQuads geometry + colour-by-progress, ER.pushGuardianBeam's target sync, and
// ER.visible's `beams` output. Geometry only (no GPU draw yet - named in ER.guardianBeamQuads). Node-only.
//   node tools/guardianbeamcheck.mjs
import { loadEngine } from './loadsrc.mjs';

const M = loadEngine({
  extra: ['02g_items.js', '07h_entities.js', '07i_entitylist.js', '07zx_particle.js', '07zzr_guardian.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'],
  dom: false
});
const ER = M.EntityRender, Gd = M.Guardian;
let pass = 0; const fails = [];
const near = (a, b, e = 1e-4) => Math.abs(a - b) < e;

// every assertion about a quad-maker, so a broken maker can be run through the SAME list
function verify(fn, tag) {
  const bad = [];
  const eye = [0, 10, 0], tgt = [6, 10, 0];            // beam straight along +X, length 6
  const q0 = fn(eye, tgt, 0, 100, true), q1 = fn(eye, tgt, 1, 100, true);
  const chk = (c, m) => { if (!c) bad.push(tag + ': ' + m); };
  chk(q0.length === 3, '3 quads (two sides + cap)');
  if (q0.length !== 3) return bad;
  // side quad: vertices 0/3 at the far end (distance len+1 = 7 along +X), 1/2 at the guardian eye
  const s = q0[0];
  chk(near(s.p[0][0], 7) && near(s.p[3][0], 7), 'far end is len+1 = 7 along the beam');
  chk(near(s.p[1][0], 0) && near(s.p[2][0], 0), 'near end sits on the guardian eye');
  const r = Math.hypot(s.p[0][1] - 10, s.p[0][2]);
  chk(near(r, 0.2), 'side column radius 0.2 (got ' + r + ')');
  const rc = Math.hypot(q0[2].p[0][1] - 10, q0[2].p[0][2]);
  chk(near(rc, 0.282), 'cap radius 0.282 (got ' + rc + ')');
  // colour: progress 0 -> (64,32,128); progress 1 -> (255,223,64)
  chk(s.rgba[0].join() === '64,32,128,255', 'colour at progress 0 is 64,32,128');
  chk(q1[0].rgba[0].join() === '255,223,64,255', 'colour at progress 1 is 255,223,64');
  // beam aims at the target, not a fixed axis
  const qy = fn([0, 0, 0], [0, 5, 0], 0, 0, true);
  chk(near(qy[0].p[0][1], 6), 'straight-up beam ends 6 up (got ' + qy[0].p[0][1] + ')');
  // uv: scroll frac = time*0.5 % 1 ; v0 = -1 + frac ; v1 = (len+1)*2.5 + v0
  chk(near(s.uv[1][1], -1 + (100 * 0.5 % 1)) && near(s.uv[0][1], 7 * 2.5 + s.uv[1][1]), 'uv scroll/length');
  // cap flicker: age even -> v 0.5..1, odd -> 0..0.5
  const odd = fn(eye, tgt, 0, 100, false);
  chk(near(q0[2].uv[3][1], 0.5) && near(odd[2].uv[3][1], 0), 'cap flickers with age parity');
  chk(fn(eye, eye, 0, 0, true).length === 0, 'zero-length beam draws nothing');
  return bad;
}
const real = ER.guardianBeamQuads;
const realBad = verify(real, 'real');
fails.push(...realBad); pass += realBad.length ? 0 : 1;

// anti-vacuity: break the maker five ways, each must be caught
const breaks = {
  'colour ignores progress': (e, t, p, ti, a) => real(e, t, 0, ti, a),
  'beam one block short': (e, t, p, ti, a) => real(e, [t[0] - 1 * Math.sign(t[0] - e[0]), t[1], t[2]], p, ti, a),
  'rotation dropped (always +Y)': (e, t, p, ti, a) => real(e, [e[0], e[1] + Math.hypot(t[0] - e[0], t[1] - e[1], t[2] - e[2]), e[2]], p, ti, a),
  'cap never flickers': (e, t, p, ti, a) => real(e, t, p, ti, true),
  'zero-length draws a stub': (e, t, p, ti, a) => (t[0] === e[0] && t[1] === e[1] && t[2] === e[2]) ? real(e, [e[0] + 1, e[1], e[2]], p, ti, a) : real(e, t, p, ti, a)
};
let caught = 0;
for (const [name, fn] of Object.entries(breaks)) {
  if (verify(fn, name).length) { caught++; console.log('  ✓ caught: ' + name); } else fails.push('break NOT caught: ' + name);
}

// ── the sync: a live guardian with a beam target pushes a group; without one, none ──
const mk = (type, x) => ({ type, x, y: 64, z: 0, px: x, py: 64, pz: 0, age: 4, removed: false, health: 20 });
const g = mk('guardian', 0), v = mk('player', 6);
g.beamTargetId = 1; g.beamTicks = 20; g.target = v;
let out = [];
ER.pushGuardianBeam(g, 0.5, out);
if (out.length === 1 && out[0].quads.length === 3 && out[0].texture === ER.GUARDIAN_BEAM_TEXTURE) pass++; else fails.push('pushGuardianBeam did not push one group');
const prog = Gd.getBeamProgress(g, 0.5);
const wantR = 64 + Math.trunc(prog * prog * 191);
if (out.length && out[0].quads[0].rgba[0][0] === wantR) pass++; else fails.push('beam colour not driven by getBeamProgress');
g.beamTargetId = 0; out = [];
ER.pushGuardianBeam(g, 0.5, out);
if (out.length === 0) pass++; else fails.push('beam drawn with no beam target');
g.beamTargetId = 1; g.target = null; out = [];
ER.pushGuardianBeam(g, 0.5, out);
if (out.length === 0) pass++; else fails.push('beam drawn with a null target');

// ── #1601: tickMovement's client particles (2 bubbles trailing a retracted swimmer; beam bubble line) ──
const Px = M.Particle;
const countTick = (tick, e, wet) => {
  const real0 = Px.spawn; let n = 0, bub = 0;
  Px.spawn = (type, ...a) => { n++; if (type === 'bubble') bub++; return real0(type, ...a); };
  try { tick(e, wet); } finally { Px.spawn = real0; }
  return [n, bub];
};
function particleBad(tick, tag) {
  const bad = []; const chk = (c, m) => { if (!c) bad.push(tag + ': ' + m); };
  const e = mk('guardian', 0); e.width = 0.85; e.height = 0.85; e.yaw = 0; e.spikesRetracted = true; e.beamTicks = 0;
  chk(countTick(tick, e, true)[1] === 2, 'retracted + wet emits exactly 2 bubbles');
  chk(countTick(tick, e, false)[0] === 0, 'dry emits none');
  const y0 = e.y; e.xHeadRot = Math.PI / 2; e.y = 10;   // looking straight down: trail is -rot.y*1.5 = 1.5 ABOVE the body
  const ys = []; const r0 = Px.spawn; Px.spawn = (ty, x, y) => { ys.push(y); };
  try { tick(e, true); } finally { Px.spawn = r0; }
  chk(ys.length === 2 && ys.every((y) => y >= 11.5 && y <= 12.4), 'pitched trail uses -rot.y*1.5 (got ' + ys.join(',') + ')');
  e.xHeadRot = 0; e.y = y0;
  e.spikesRetracted = false;
  chk(countTick(tick, e, true)[0] === 0, 'spikes out, no target: none');
  const t = mk('player', 20); t.height = 1.8; e.target = t; e.beamTargetId = 1;
  const nn = countTick(tick, e, true)[1];
  chk(nn >= 5 && nn <= 12, 'beam over 20 blocks at progress 0 emits ~11 bubbles (got ' + nn + ')');
  const sum = () => { let s = 0; for (let i = 0; i < 200; i++) s += countTick(tick, e, true)[1]; return s; };
  const s0 = sum();
  e.beamTicks = 80;
  chk(sum() > s0 * 1.2, 'higher beamProgress packs the bubbles closer');   // averaged: one roll is random
  return bad;
}
Px.init();
const pb = particleBad((e, w) => Gd.tickParticles(e, w), 'real');
fails.push(...pb); if (!pb.length) pass++;
const pbreaks = {
  'no particles': () => 0,
  'trail ignores spikesRetracted': (e, w) => Gd.tickParticles(Object.assign({}, e, { spikesRetracted: true }), w),
  'beam spacing ignores progress': (e, w) => Gd.tickParticles(Object.assign({}, e, { beamTicks: 0 }), w),
  'trail ignores pitch': (e, w) => Gd.tickParticles(Object.assign({}, e, { xHeadRot: 0 }), w),
  'trail emitted dry': (e) => Gd.tickParticles(e, true)
};
for (const [name, fn] of Object.entries(pbreaks)) {
  if (particleBad(fn, name).length) { caught++; console.log('  ✓ caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
// a bubble lives in water only
{
  const px = Px.list.length;
  if (px > 0 && Px.list[px - 1].type === 'bubble') pass++; else fails.push('bubble particles not in Px.list');
}
if (caught === Object.keys(breaks).length + Object.keys(pbreaks).length) pass++;

if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
console.log(`guardianbeamcheck: OK — ${pass} checks passed, 0 failures, ${caught} breaks caught`);
