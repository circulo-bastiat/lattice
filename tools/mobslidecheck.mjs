#!/usr/bin/env node
// mobslidecheck.mjs — #582 (KW-51): "chickens slide from side to side".
// A headless trace of wandering mobs through the real EL.tick() loop. Vanilla's
// BodyControl.tick() (.decomp BodyControl.java) runs in turnHead, AFTER tickMovement, so a mob that
// moved this tick gets bodyYaw = yaw, and yaw follows the motion (MoveControl, 90deg/tick cap).
// Rule: while a mob is walking (>0.05 b/tick, steady), its body yaw stays within 20deg of its
// motion direction, and its head within maxHeadYaw of the body. On the broken tree the body froze
// ~30deg off the motion (BodyRotationControl.isMoving() saw a zero displacement for ever).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07k_goals.js', '07l_spawn.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Hand.init(); M.Combat.init(); M.Ai.init();
const EL = M.EntityList, W = M.World, CH = M.CH, Ai = M.Ai;
const stone = M.States.stateOf('stone') | 0;
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

/** Max body-vs-motion error (deg) over the steady walking ticks, and how many such ticks there were. */
function trace(type) {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  // #1495: solid ground under the plate, as in any real world -- FuzzyTargeting (WanderAroundFarGoal) only keeps a
  // candidate with an opaque block under it, and its vertical fuzz reaches 7 below the mob.
  for (let x = -15; x <= 15; x++) for (let z = -15; z <= 15; z++) for (let y = 1; y <= 8; y++) W.setBlock(x, y, z, stone);
  const orig = Math.random; Math.random = () => 0.001;   // #3325: mobs draw from their own seeded RNG now (Ai.rndOf), so this is inert; 600 ticks lets every type start a wander
  const e = EL.spawn(type, 0, 9, 0);
  let worst = 0, walking = 0, headWorst = 0, prevDir = null;
  for (let t = 0; t < 600; t++) {
    EL.tick();
    const dx = e.x - e.px, dz = e.z - e.pz;
    if (Math.hypot(dx, dz) < 0.05 || t < 30) continue;
    walking++;
    // #1495: the ENGINE's heading of the motion (D-415: yaw 0 looks north, `atan2(dx, -dz)`). The old
    // `min(|b - d|, |b + d|)` against vanilla's atan2(-dx, dz) only held for motion along x; once the mobs had
    // ground to wander on (FuzzyTargeting) a walk along -z read a correct body as 180deg off.
    const dirYaw = Math.atan2(dx, -dz);
    // STEADY: at a path corner vanilla snaps the body to the new heading at once while the velocity swings round over
    // a few ticks -- those ticks are not "walking in a direction" and are skipped.
    const turning = prevDir !== null && Math.abs(wrap(dirYaw - prevDir)) > 0.05;
    prevDir = dirYaw;
    if (turning) continue;
    const err = Math.abs(wrap(e.yBodyRot - dirYaw));
    worst = Math.max(worst, err * 180 / Math.PI);
    headWorst = Math.max(headWorst, Math.abs(wrap(e.yHeadRot - e.yBodyRot)) * 180 / Math.PI);
  }
  Math.random = orig; EL.clear();
  return { worst, walking, headWorst };
}

const TYPES = ['chicken', 'cow', 'pig', 'zombie', 'skeleton'];
for (const t of TYPES) {
  const r = trace(t);
  ok(r.walking > 20, `${t}: walked (${r.walking} steady walking ticks)`);
  ok(r.worst <= 20, `${t}: body yaw stays within 20deg of the motion direction while walking (worst ${r.worst.toFixed(0)}deg)`);
  ok(r.headWorst <= 75.5, `${t}: head within 75deg of the body (worst ${r.headWorst.toFixed(0)}deg)`);
}

// ANTI-VACUITY: break the body control (never ticked) and the same rule must fail.
{
  const saved = Ai.tickBody;
  Ai.tickBody = function (e) { e.yBodyRot = 1.0; };   // a body stuck facing the wrong way
  const r = trace('chicken');
  breaks++; if (r.worst > 20) pass++; else fails.push('anti-vacuity: a body stuck off the motion direction still passed');
  Ai.tickBody = saved;
  // and a body control blind to movement (the pre-fix behaviour: displacement read as zero)
  const B = Ai.BodyRotationControl;
  Ai.BodyRotationControl = function (e) { const b = new B(e); const t = b.tick; b.tick = function () { e.xOld = e.x; e.zOld = e.z; t(); }; return b; };
  const r2 = trace('chicken');
  breaks++; if (r2.worst > 20) pass++; else fails.push('anti-vacuity: a body control that never sees movement still passed');
  Ai.BodyRotationControl = B;
}

console.log(`\n${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
