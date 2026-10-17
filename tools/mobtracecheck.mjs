#!/usr/bin/env node
// mobtracecheck.mjs — KW-51-1 (#598, part of #582): a per-tick TRACE of wandering mobs against
// vanilla's body/head rules.
//
//   node tools/mobtracecheck.mjs
//
// A chicken, a cow and a zombie wander a stone plate under their real goals. Every tick the trace
// records position, velocity, aim yaw, body yaw (yBodyRot), head yaw (yHeadRot) and limb swing, and
// asserts vanilla's rules:
//   A. |head - body| never exceeds getMaxHeadYRot (75 deg) + the 15 deg drift BodyRotationControl tolerates between clamps
//   B. a tick that MOVED the mob leaves yBodyRot == the aim yaw                  (BodyRotationControl, moving branch)
//   C. no sideways drift: while walking, the displacement points along the body   (>= 85% of walking ticks within 45 deg)
//   D. limb swing runs while the mob moves and is ~0 while it stands
// The bug this caught: `Ai.tickHead` ran the body control BEFORE the travel, so "did I move" was
// always false and yBodyRot never followed a walking mob - it was drawn sideways/backwards.
// Anti-vacuity: each rule is broken in the source text (body control before travel again; a
// head that is never clamped; a dead limb clock; a body that never follows) and must be caught.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = ['chicken', 'cow', 'zombie'];
const M_SLACK = 15 * Math.PI / 180;   // bcr: the body is re-clamped only once the head drifted >15 deg from its last stable yaw
const TICKS = 1500, PLAT_Y = 8;

function trace(patch) {
  let seed = 12345;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const M = loadEngine({ patch,
    extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
            '07i_entitylist.js', '14j_combat.js', '07k_goals.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
  const realRandom = Math.random; Math.random = rnd;
  const out = [];
  try {
    M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
    const W = M.World, EL = M.EntityList, STONE = M.States.stateOf('stone') | 0;
    for (const type of TYPES) {
      W.init(1);
      for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) {
        const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
      for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) W.setBlock(x, PLAT_Y, z, STONE);
      EL.init(); EL.pushPlayer = () => null;
      const e = EL.spawn(type, 0.5, PLAT_Y + 1, 0.5);
      const st = { type, ticks: 0, walking: 0, aligned: 0, maxOff: 0, bodyMiss: 0, limbDead: 0, limbLive: 0, standSwing: 0, moved: 0 };
      const lim = M.Ai.maxHeadYaw(e);
      for (let t = 0; t < TICKS; t++) {
        const x0 = e.x, z0 = e.z;
        EL.tickOne(e);
        const dx = e.x - x0, dz = e.z - z0, d = Math.hypot(dx, dz);
        st.ticks++;
        if (e.yBodyRot !== undefined && e.yHeadRot !== undefined)
          st.maxOff = Math.max(st.maxOff, Math.abs(M.Ai.wrapRad(e.yHeadRot - e.yBodyRot)));
        if (d * d > M.Ai.MOVE_ARRIVED_SQ) {
          st.moved++;
          if (Math.abs(M.Ai.wrapRad((e.yBodyRot === undefined ? 1e9 : e.yBodyRot) - e.yaw)) > 1e-6) st.bodyMiss++;
          if (d > 0.05) {
            st.walking++;
            // the mob's forward is (sin yaw, -cos yaw) in this engine
            const ang = Math.abs(M.Ai.wrapRad(Math.atan2(dx, -dz) - (e.yBodyRot === undefined ? 1e9 : e.yBodyRot)));
            if (ang < Math.PI / 4) st.aligned++;
            if ((e.animSpeed || 0) > 0.05) st.limbLive++; else st.limbDead++;
          }
        } else if ((e.animSpeed || 0) > 0.5) st.standSwing++;
      }
      st.lim = lim; out.push(st);
    }
  } finally { Math.random = realRandom; }
  return out;
}

function judge(rows) {
  const f = [];
  for (const s of rows) {
    if (s.walking < 30) f.push(`${s.type}: only ${s.walking} walking ticks in ${s.ticks} - the trace proved nothing`);
    if (s.maxOff > s.lim + M_SLACK + 1e-6) f.push(`${s.type}: head-body offset reached ${(s.maxOff * 57.2958).toFixed(0)} deg, limit ${((s.lim + M_SLACK) * 57.2958).toFixed(0)}`);
    if (s.bodyMiss > 0) f.push(`${s.type}: body yaw != aim yaw on ${s.bodyMiss}/${s.moved} moving ticks`);
    if (s.walking && s.aligned / s.walking < 0.85) f.push(`${s.type}: sideways drift - only ${s.aligned}/${s.walking} walking ticks moved along the body`);
    if (s.limbDead > s.walking * 0.1) f.push(`${s.type}: limb swing dead on ${s.limbDead}/${s.walking} walking ticks`);
    if (s.standSwing > 0) f.push(`${s.type}: limb swing running on ${s.standSwing} standing ticks`);
  }
  return f;
}

console.log('mobtracecheck - KW-51-1, per-tick body/head/limb trace of wandering mobs');
const base = trace();
for (const s of base) console.log(`   ${s.type.padEnd(8)} walking ${String(s.walking).padStart(4)}  aligned ${s.aligned}  maxOff ${(s.maxOff * 57.2958).toFixed(0)} deg  bodyMiss ${s.bodyMiss}`);
const fails = judge(base);

// anti-vacuity: each break edits the real source and must make judge() complain
const breaks = [
  ['body control before the travel', (f, s) => f === '07i_entitylist.js'
      ? s.replace("if (NS.Ai && NS.Ai.tickBody) NS.Ai.tickBody(e);", '') : f === '07k_goals.js'
      ? s.replace('e.look.tick();\n', 'e.look.tick(); e.body.tick();\n') : s],
  ['head never clamped to the body', (f, s) => f === '07k_goals.js' ? s.replace('var d = Ai.wrapRad(current - target);', 'return current; var d = 0;') : s],
  ['dead limb clock', (f, s) => f === '07i_entitylist.js' ? s.replace('e.animSpeed = (e.animSpeed || 0) + (af', 'e.animSpeed = (e.animSpeed || 0) + (0*af') : s],
  ['body never follows', (f, s) => f === '07k_goals.js' ? s.replace('e.yBodyRot = e.yaw || 0;\n        e.yHeadRot = Ai.rotateIfNecessary', 'e.yHeadRot = Ai.rotateIfNecessary') : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let n = 0;
  const probe = (f, s) => { const r = patch(f, s); if (r !== s) n++; return r; };
  let got;
  try { got = judge(trace(probe)); } catch (err) { got = ['threw ' + err.message]; }
  if (n === 0) fails.push(`anti-vacuity: break "${name}" matched no source text`);
  else if (!got.length) fails.push(`anti-vacuity: break "${name}" was NOT caught`);
  else { caught++; console.log(`   ✓ break caught: ${name}`); }
}
console.log(`   ${caught} breaks caught`);
if (fails.length) { for (const m of fails) console.log('   x ' + m); console.log(` mobtracecheck: ${base.length * 6} assertions, ${fails.length} failed, ${caught} breaks caught`); process.exit(1); }
console.log(` mobtracecheck: ${base.length * 6} assertions, 0 failed, ${caught} breaks caught`);
