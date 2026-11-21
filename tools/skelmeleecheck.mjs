#!/usr/bin/env node
// skelmeleecheck.mjs — #1291: SkeletonEntityModel.setAngles melee pose (isAttacking && no bow) and
// AbstractSkeletonEntity.meleeAttackGoal start/stop -> setAttacking. Needs no assets.
import { loadEngine, initRegistry } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07j_entityrender.js'], dom: false });
if (initRegistry) initRegistry(M);
const ER = M.EntityRender, Ai = M.Ai;
const rest = { rx: 0, ry: 0, rz: 0 };
const arm = (name, c) => ER.setupAnimDelta(name, 0, 0, 0, 0, false, 'biped', Object.assign({ biped: true, ageInTicks: 0, attackTime: 0, rest }, c));
const r = arm('right_arm', { skelMelee: true }), l = arm('left_arm', { skelMelee: true });
ok(r && Math.abs(r.rx + Math.PI / 2) < 1e-9 && Math.abs(r.ry + 0.1) < 1e-9 && Math.abs(r.rz - 0.1) < 1e-9, 'right arm pitch -PI/2, yaw -0.1, roll 0 + swingArms bob 0.1');
ok(l && Math.abs(l.rx + Math.PI / 2) < 1e-9 && Math.abs(l.ry - 0.1) < 1e-9, 'left arm pitch -PI/2, yaw +0.1');
const b = arm('right_arm', { skelMelee: true, ageInTicks: 20 });
const want = -Math.PI / 2 + Math.sin(20 * 0.067) * 0.05;
ok(Math.abs(b.rx - want) < 1e-9 && Math.abs(b.rz - (Math.cos(20 * 0.09) * 0.05 + 0.05)) < 1e-9, 'swingArms bob follows ageInTicks');
const s = arm('right_arm', { skelMelee: true, attackTime: 0.5 });
const a = Math.sin(0.5 * Math.PI), bb = Math.sin((1 - 0.25) * Math.PI);
ok(Math.abs(s.rx - (-Math.PI / 2 - (a * 1.2 - bb * 0.4))) < 1e-9 && Math.abs(s.ry + (0.1 - a * 0.6)) < 1e-9, 'swing progress shapes pitch/yaw');
const g = (Ai.SkeletonMeleeFallbackGoal.__orig || Ai.SkeletonMeleeFallbackGoal).toString();
ok(/attacking\s*=\s*true/.test(g) && /attacking\s*=\s*false/.test(g), 'melee goal start/stop set e.attacking');
{
  const mk = (t) => ({ x: 0, y: 64, z: 0, age: 100, target: t, inventory: [], dead: false });
  const far = { x: 500, y: 64, z: 0 };
  M.Equip = { getEquipped: () => null }; M.Items = Object.assign(M.Items || {}, { nameOf: () => '' });   // bowless
  Ai.findPath = () => null;
  const g1 = new Ai.SkeletonMeleeFallbackGoal(mk(far), 1.2);
  ok(!g1.canUse(), 'unreachable target out of reach: canUse false');
  Ai.findPath = () => [{}, {}];
  const g2 = new Ai.SkeletonMeleeFallbackGoal(mk(far), 1.2);
  ok(g2.canUse(), 'reachable path: canUse true');
  ok(!g2.canUse(), 'second call inside 20 ticks is throttled');
  const e3 = mk({ x: 1, y: 64, z: 0, invulnerableGamemode: true });
  ok(!new Ai.SkeletonMeleeFallbackGoal(e3, 1.2).canContinueToUse(), 'creative/spectator target: canContinueToUse false');
  const gone = new Ai.SkeletonMeleeFallbackGoal(mk({ x: 1, y: 64, z: 0, dead: true }), 1.2);
  okAv(!gone.canContinueToUse(), 'dead target: canContinueToUse false (base gate, not just !!target)');
}
const off = arm('right_arm', { skelMelee: false });
okAv(!off || Math.abs(off.rx + Math.PI / 2) > 0.1, 'without skelMelee the arm is NOT raised (dropping the branch is caught)');
okAv(!/attacking\s*=\s*true/.test(g.replace(/e\.attacking\s*=\s*true/g, '')), 'goal source with the setAttacking removed fails the goal assertion');
console.log(`\n${pass}  assertions, ${fails.length} failures, ${breaks} breaks caught`);

if (fails.length) { fails.forEach((f) => console.log('  FAIL: ' + f)); process.exit(1); }
