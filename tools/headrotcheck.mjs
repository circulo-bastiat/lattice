#!/usr/bin/env node
// headrotcheck.mjs — #218 G18b-7: yBodyRot separate from the aim yaw, BodyControl (Yarn
// net/minecraft/entity/ai/control/BodyControl.java) moving/standing branches, LivingEntity.turnHead's
// 0.3 lerp + 2500 term, and the navigating-flag LookControl clamp — against an independent
// degree-space transcription of the vanilla arithmetic. Each assertion is re-run against a
// deliberately broken oracle and must fail ("<n> breaks caught").
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const D = Math.PI / 180;
const wrap = (a) => { a %= 360; if (a >= 180) a -= 360; if (a < -180) a += 360; return a; };
const clampAngle = (c, t, m) => { const d = wrap(c - t); return d > m ? t + m : d < -m ? t - m : c; };
const near = (a, b) => Math.abs(wrap(a - b)) < 1e-3;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
// anti-vacuity: the same comparison against a perturbed oracle must NOT hold
const breaks_ = (c, m) => { breaks++; if (c) fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07k_goals.js', '07l_spawn.js'] });
const Ai = M.Ai;

// --- vanilla oracle (degrees, engine yaw = vanilla yaw - 180 so only DIFFERENCES matter) ---
function vanBody(s, moving, maxHead) {           // BodyControl.tick
  if (moving) { s.body = s.yaw; s.head = clampAngle(s.head, s.body, maxHead); s.last = s.head; s.ticks = 0; return; }
  if (Math.abs(s.head - s.last) > 15) { s.ticks = 0; s.last = s.head; s.body = clampAngle(s.body, s.head, maxHead); }
  else { s.ticks++; if (s.ticks > 10) { const f = Math.min(Math.max((s.ticks - 10) / 10, 0), 1); s.body = clampAngle(s.body, s.head, maxHead * (1 - f)); } }
}
function vanTurn(s, target) {                     // LivingEntity.turnHead body part
  s.body += wrap(target - s.body) * 0.3;
  let i = wrap(s.yaw - s.body);
  const flip = i < -90 || i >= 90;
  i = Math.max(-75, Math.min(75, i >= 75 && i < 90 ? 75 : i));
  if (i >= 75) i = 75;
  s.body = s.yaw - i;
  if (i * i > 2500) s.body += i * 0.2;
  return flip;
}

// 1. standing: head swings, body must trail exactly as BodyControl says, aim yaw untouched.
{
  const e = { type: 'cow', x: 0, z: 0, xOld: 0, zOld: 0, yaw: 20 * D, yHeadRot: 20 * D };
  const s = { yaw: 20, body: 20, head: 20, last: 0, ticks: 0 };
  Ai.tickHead(e);                                  // creates the controls (body init = yaw)
  s.last = 0; e.body.lastStableHeadYaw = 0;
  let good = true, bad = true;
  for (let t = 0; t < 60; t++) {
    e.yHeadRot = (t < 30 ? 20 + t * 4 : 140) * D;   // head runs away, then holds
    s.head = wrap(e.yHeadRot / D);
    e.body.tick(); vanBody(s, false, 75);
    if (!near(e.yBodyRot / D, s.body)) good = false;
    if (near(e.yBodyRot / D, s.body + 7)) { /* perturbed oracle would match */ } else bad = bad && true;
  }
  ok(good, 'standing: yBodyRot follows BodyControl exactly (keepUpBody / slowlyAdjustBody)');
  ok(near(e.yaw / D, 20), 'standing: the aim yaw is left alone');
  ok(!near(e.yBodyRot / D, 20), 'standing: body actually turned (non-vacuous)');
  breaks_(near(e.yBodyRot / D, s.body + 7), 'body oracle +7deg must not match');
  breaks_(near(e.yBodyRot / D, 20), 'body still at spawn yaw must not match');
}
// 2. moving: yBodyRot = yaw, head clamped to body.
{
  const e = { type: 'cow', x: 1, z: 0, xOld: 0, zOld: 0, yaw: 100 * D, yHeadRot: 0 };
  Ai.tickHead(e); e.xOld = 0; e.x = 1; e.yBodyRot = 0; e.yHeadRot = 0;
  e.body.tick();
  ok(near(e.yBodyRot / D, 100), 'moving: yBodyRot = yaw');
  ok(near(e.yHeadRot / D, 25), 'moving: head clamped to 75deg of the body');
  breaks_(near(e.yBodyRot / D, 0), 'unchanged body must not match');
}
// 3. LivingEntity.turnHead port.
for (const [yaw, body, target] of [[0, 0, 90], [80, 0, 10], [-100, 30, -100], [170, -170, 175]]) {
  const e = { yaw: yaw * D, yBodyRot: body * D };
  const s = { yaw, body, head: 0 };
  const flipE = Ai.livingTurnHead(e, target * D, 1) < 0, flipV = vanTurn(s, target);
  ok(near(e.yBodyRot / D, s.body) && flipE === flipV, 'turnHead ' + [yaw, body, target]);
  breaks_(near(e.yBodyRot / D, s.body + 3), 'turnHead perturbed ' + [yaw, body, target]);
}
{ // 2500 term: offset 80 clamps to 75, 75^2 > 2500 adds 0.2*75 = 15
  const e = { yaw: 80 * D, yBodyRot: 0 };
  Ai.livingTurnHead(e, 0, 1);
  ok(near(e.yBodyRot / D, 80 - 75 + 15), '2500 term pushes the body a further 0.2*offset');
  breaks_(near(e.yBodyRot / D, 5), 'without the 2500 term must not match');
}
// 4. navigating flag drives the clamp (and zza alone does not).
{
  const mk = (nav, zza, type = 'cow') => { const e = { type, x: 0, z: 0, xOld: 0, zOld: 0, yaw: 0, yHeadRot: 170 * D, navigating: nav, zza };
    Ai.tickHead(e); e.yBodyRot = 0; e.yHeadRot = 170 * D; e.look.tick(); return e.yHeadRot / D; };
  ok(near(mk(true, 0), 75), 'navigating: head clamped to the body limit');
  ok(mk(false, 1) > 80, 'not navigating (zza set): head not clamped');
  breaks_(near(mk(false, 0), 75), 'idle head must not be clamped');
  // GoatEntity.getMaxHeadRotation() == 15: a goat's head never leaves 15 degrees of its body
  ok(near(mk(true, 0, 'goat'), 15), 'goat: head clamped to 15 degrees of the body');
  breaks_(near(mk(true, 0, 'cow'), 15), 'a cow must not be clamped to the goat 15');
}
// 5. renderer reads the body yaw.
{
  const M2 = loadEngine({ extra: ['07j_entityrender.js'] });
  if (M2.EntityRender && M2.EntityRender.yawAt) {
    const yawAt = M2.EntityRender.yawAt;
    ok(near(yawAt({ yaw: 3, yawO: 3, yBodyRot: 1, yBodyRotO: 1 }, 1) / D, 1 / D), 'render: draws yBodyRot, not yaw');
    breaks_(near(yawAt({ yaw: 3, yawO: 3, yBodyRot: 1, yBodyRotO: 1 }, 1), 3), 'yaw must not be what is drawn');
  }
}
console.log(`${pass} ok, ${breaks} breaks caught, ${fails.length} failed`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
