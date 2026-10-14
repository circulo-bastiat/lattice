#!/usr/bin/env node
// dolphinmovecheck.mjs — #717: DolphinEntity.travel (water: *0.9 drag, -0.005 sink w/o target) + AquaticMoveControl
// (body yaw follows the motion target, 10 deg/tick) against .decomp DolphinEntity/AquaticMoveControl.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js',
  '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '14j_combat.js', '07q_effects.js', '07zjd_dolphin.js', '07zj2_dolphin.js', '07zz2_dolphin.js'] });
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Dolphin.init();
const EL = M.EntityList, W = M.World, S = M.States;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) for (let y = 0; y <= 14; y++)
  W.setBlock(x, y, z, (Math.abs(x) === 9 || Math.abs(z) === 9 || y === 0 || y === 14) ? stone : water);
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
EL.random = () => 0.5;
console.log('dolphinmovecheck — #717: DolphinEntity.travel + AquaticMoveControl');

const mk = () => { EL.list.length = 0; const e = EL.spawn('dolphin', 0.5, 7.5, 0.5); e.inWater = true; return e; };
// §1 travel: drag 0.9 and -0.005 sink with no target (no nav: moveControl adds +0.005 buoyancy first)
{
  const e = mk(); e.vx = 0.2; e.vy = 0; e.vz = 0; e.yaw = 0;
  const x0 = e.x; M.Dolphin.travelMob(e);
  ok(Math.abs(e.x - x0 - 0.2) < 1e-9, 'moves by the pre-drag velocity');
  ok(Math.abs(e.vx - 0.18) < 1e-9, `vx *= 0.9 (got ${e.vx})`);
  ok(Math.abs(e.vy - (0.005 * 0.9 - 0.005)) < 1e-9, `vy = (0+0.005 buoyancy)*0.9 - 0.005 with no target (got ${e.vy})`);
  const f = mk(); f.vy = 0; f.target = { x: 1 }; M.Dolphin.travelMob(f);
  ok(Math.abs(f.vy - 0.0045) < 1e-9, 'no sink while a target is set (only the buoyancy, damped)');
  const g = mk(); g.vx = 0.2; g.vy = 0; g.yaw = 0; M.Physics.travelMob(g);
  okAv(Math.abs(g.vx - 0.18) > 0.005 || Math.abs(g.vy + 0.005) > 0.001, 'the generic ground travel (master behaviour) does NOT give 0.9 drag / -0.005 sink');
}
// §2 move control: body yaw turns toward the nav target, <=10 deg/tick, and the dolphin swims that way
{
  const e = mk(); e.yaw = 0; e.dolphinNav = { x: 8.5, y: 7.5, z: 0.5, speed: 1 };   // +x => yaw = atan2(8,0) = 90 deg
  const x0 = e.x; let firstStep = 0;
  let yaw20 = 0;
  for (let t = 0; t < 60; t++) {
    const y0 = e.yaw; M.EntityList.tickOne(e);
    if (t === 0) firstStep = Math.abs(e.yaw - y0);
    if (t === 11) yaw20 = e.yaw;
  }
  ok(Math.abs(firstStep - 10 * Math.PI / 180) < 1e-6, `yaw step limited to 10 deg (got ${firstStep * 180 / Math.PI})`);
  ok(Math.abs(e.bodyYaw - e.yaw) < 1e-9, 'bodyYaw follows yaw');
  ok(e.x - x0 > 1, `swims toward +x (moved ${(e.x - x0).toFixed(2)})`);
    ok(Math.abs(yaw20 - Math.PI / 2) < 0.15, `faces the target after 12 ticks (yaw ${yaw20})`);
  const h = mk(); h.yaw = 0; for (let t = 0; t < 60; t++) M.EntityList.tickOne(h);
  okAv(Math.abs(h.yaw) < 1e-9 && h.x - 0.5 < 0.5, 'a dolphin with no nav target neither turns nor swims sideways');
  ok(M.Combat.eyeHeightOf(e) === 0.3, 'eye height 0.3');
}
// §3 anti-vacuity (D-30): sabotage the implementation and prove the SAME predicates fail
{
  const dragOk = () => { const e = mk(); e.vx = 0.2; e.vy = 0; e.vz = 0; M.Dolphin.travelMob(e); return Math.abs(e.vx - 0.18) < 1e-9 && Math.abs(e.vy - (0.005 * 0.9 - 0.005)) < 1e-9; };
  const yawOk = () => { const e = mk(); e.yaw = 0; e.dolphinNav = { x: 8.5, y: 7.5, z: 0.5, speed: 1 }; const y0 = e.yaw; EL.tickOne(e); return Math.abs(Math.abs(e.yaw - y0) - 10 * Math.PI / 180) < 1e-6; };
  ok(dragOk() && yawOk(), 'unsabotaged predicates hold');
  const trav = M.Dolphin.travelMob, mc = M.Dolphin.moveControlTick;
  M.Dolphin.travelMob = (e) => { trav(e); e.vx *= 0.8 / 0.9; };                         // wrong drag
  okAv(!dragOk(), 'BROKEN drag (0.8) is caught by the travel predicate');
  M.Dolphin.travelMob = (e) => { trav(e); e.vy += 0.005; };                             // no sink
  okAv(!dragOk(), 'BROKEN sink (none) is caught by the travel predicate');
  M.Dolphin.travelMob = trav;
  M.Dolphin.moveControlTick = (e) => { const n = e.dolphinNav; if (n) e.yaw = Math.atan2(n.x - e.x, -(n.z - e.z)); };   // instant snap
  okAv(!yawOk(), 'BROKEN yaw (no 10 deg limit) is caught by the yaw predicate');
  M.Dolphin.moveControlTick = () => {};                                                  // no move control
  okAv(!yawOk(), 'BROKEN move control (no-op) is caught by the yaw predicate');
  M.Dolphin.moveControlTick = mc;
  ok(dragOk() && yawOk(), 'restored predicates hold');
}
// §4 jump goal path: mid-jump pitch (radians, e.pitch) = atan2(-vy, horizontal speed)
{
  const pitchOk = () => { const e = mk(); const g = new M.Dolphin.DolphinJumpGoal(e, 10); e.vx = 0.3; e.vy = 0.4; e.vz = 0; e.pitch = 0; g.tick(); return Math.abs(e.pitch - Math.atan2(-0.4, 0.3)) < 1e-9; };
  ok(pitchOk(), 'DolphinJumpGoal.tick sets e.pitch = atan2(-vy, h)');
  const gt = M.Dolphin.DolphinJumpGoal.prototype.tick; M.Dolphin.DolphinJumpGoal = function (e) { this.tick = () => {}; };
  okAv(!pitchOk(), 'BROKEN jump goal (no pitch) is caught by the pitch predicate');
}
// §5 idle: pitch eases to 0 by 5 deg/tick (YawAdjustingLookControl)
{
  const idleOk = () => { const e = mk(); e.pitch = 20 * Math.PI / 180; M.Dolphin.travelMob(e); M.Ai.tickHead(e); return Math.abs(e.pitch - 15 * Math.PI / 180) < 1e-9; };
  ok(idleOk(), 'idle dolphin eases pitch toward 0 by 5 deg/tick');
  const th = M.Ai.tickHead; M.Ai.tickHead = () => {};
  okAv(!idleOk(), 'BROKEN idle pitch ease is caught');
  M.Ai.tickHead = th;
}
// §6 goal path (no dolphinNav): travel input is forwardSpeed*0.98 (LivingEntity.tickMovement), delta = 0.02*0.98 per tick, then *0.9 drag
{
  const fwdOk = () => { const e = mk(); e.vx = e.vy = e.vz = 0; e.yaw = 0; e.pitch = 0; e.mobSpeed = 1; e.navigating = true; e.navNode = { x: 0, y: 7.5, z: -8 };
    M.Dolphin.travelMob(e); return Math.abs(e.dolFwd - 0.98) < 1e-9 && Math.abs(Math.hypot(e.vx, e.vz) - 0.02 * 0.98 * 0.9) < 1e-9; };
  ok(fwdOk(), 'goal-path swim input is cos(pitch)*speed*0.98 (velocity delta 0.0196/tick)');
  const tm = M.Dolphin.travelMob; M.Dolphin.travelMob = (e) => { tm(e); e.dolFwd /= 0.98; };
  okAv(!fwdOk(), 'BROKEN unscaled forwardSpeed is caught');
  M.Dolphin.travelMob = tm;
}
// §7 YawAdjustingLookControl(10): head -> target yaw+20 deg, body +-4 deg/tick once head-body > 10 deg (#4313)
{
  const D = Math.PI / 180;
  const run = () => { const e = mk(); e.yaw = 0; e.yBodyRot = 0; e.yHeadRot = 0; e.pitch = 0; M.Ai.tickHead(e);
    e.yHeadRot = 15 * D; e.look.cooldown = 0; M.Ai.tickHead(e); return e; };
  const e = run();
  ok(Math.abs(e.yBodyRot) < 1e-9 || Math.abs(Math.abs(e.yBodyRot) - 4 * D) < 1e-9, 'body turns exactly 4 deg or not at all');
  const f = mk(); f.yaw = 0; f.yBodyRot = 0; f.yHeadRot = 0; M.Ai.tickHead(f);
  f.yHeadRot = 12 * D; f.look.cooldown = 0; f.look.ySpeed = 0; M.Ai.tickHead(f);
  ok(Math.abs(f.yBodyRot - 4 * D) < 1e-9, `body +4 deg when head-body=12 (got ${f.yBodyRot / D})`);
  const g = mk(); g.yaw = 0; g.yBodyRot = 0; g.yHeadRot = 8 * D; M.Ai.tickHead(g); g.look.ySpeed = 0; g.look.cooldown = 0; M.Ai.tickHead(g);
  ok(g.yBodyRot === 0, 'no body turn inside 10 deg');
  const h = mk(); h.yaw = 0; h.yBodyRot = 0; h.yHeadRot = 0; M.Ai.tickHead(h);
  h.look.setLookAt(h.x + 5, h.y, h.z, 1e9, 1e9);   // due east: engine yaw 90 deg
  M.Ai.tickHead(h);
  ok(Math.abs(h.yHeadRot - 110 * D) < 1e-6, `head aims target yaw + 20 (got ${h.yHeadRot / D})`);
  ok(Math.abs(h.yBodyRot - 4 * D) < 1e-9, 'body follows head by 4');
  const w = mk(); w.yaw = 0; w.yBodyRot = 0; w.yHeadRot = 12 * D; w.look = new M.Ai.LookControl(w); w.look.cooldown = 0; w.look.tick();
  okAv(w.yBodyRot === 0, 'BROKEN generic LookControl never turns the body (check would catch it)');
}
// §6 out of water: AquaticMoveControl only sets movementSpeed (s*0.1); forwardSpeed keeps the last in-water value
{
  const airOk = () => { const e = mk(); e.dolphinNav = { x: 8.5, y: 7.5, z: 0.5, speed: 1 }; M.Dolphin.moveControlTick(e); const z = e.zza; e.inWater = false; M.Dolphin.moveControlTick(e); return z > 0.5 && e.zza === z && e.mobSpeed > 0; };
  ok(airOk(), 'out of water forwardSpeed stays at its last in-water value');
  const mc6 = M.Dolphin.moveControlTick;
  M.Dolphin.moveControlTick = (e) => { mc6(e); if (!e.inWater) e.zza = e.mobSpeed; };   // the old bug
  okAv(!airOk(), 'BROKEN air tick (zza = movementSpeed) is caught');
  M.Dolphin.moveControlTick = mc6;
}
console.log('================ dolphinmovecheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==================================================');
process.exit(fails.length ? 1 : 0);
