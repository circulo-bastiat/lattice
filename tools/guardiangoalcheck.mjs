#!/usr/bin/env node
// guardiangoalcheck.mjs — #1072: MobEntity position target + WanderAroundGoal chance (substrate), headless, against
// .decomp GuardianEntity.java / MobEntity.java:1090-1127 / GoToWalkTargetGoal.java.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
if (!M.Combat) M.Combat = { mobAttack() {} };   // 14j is not loaded headless; the beam only needs the hook
const EL = M.EntityList, W = M.World, S = M.States, Ai = M.Ai, G = M.Guardian;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y <= 14; y++) {
  const wall = Math.abs(x) === 12 || Math.abs(z) === 12 || y === 0;
  W.setBlock(x, y, z, wall ? stone : (y <= 10 ? water : 0));
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
let seed = 4242; const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
EL.random = rng;
const fresh = (type) => { EL.list.length = 0; return EL.spawn(type, 0.5, 5.5, 0.5); };
const fake = (x, y, z, type) => ({ type: type || 'player', x, y, z, health: 20, maxHealth: 20, eyeHeight: 1.6 });

console.log('guardiangoalcheck — #1072');
// §2 position-target substrate
{
  const e = fresh('cow');
  ok(!Ai.hasPositionTarget(e) && Ai.isInWalkTargetRange(e), 'no position target: hasPositionTarget false, in range');
  Ai.setPositionTarget(e, { x: 0, y: 5, z: 0 }, 16);
  ok(Ai.hasPositionTarget(e) && e.positionTargetRange === 16, 'setPositionTarget stores pos + range');
  ok(Ai.isInWalkTargetRange(e, { x: 15, y: 5, z: 0 }) && !Ai.isInWalkTargetRange(e, { x: 16, y: 5, z: 0 }), 'range is strict squared distance < 16^2');
  Ai.clearPositionTarget(e);
  ok(!Ai.hasPositionTarget(e) && Ai.isInWalkTargetRange(e, { x: 999, y: 0, z: 0 }), 'clearPositionTarget: range -1, always in range');
  const go = new Ai.GoToWalkTargetGoal(e, 1.0, rng);
  ok(!go.canUse(), 'GoToWalkTarget refuses with no target');
  Ai.setPositionTarget(e, { x: 0, y: 5, z: 0 }, 16);
  ok(!go.canUse(), 'GoToWalkTarget refuses inside the range');
  e.x = 9.5; e.z = 9.5; Ai.setPositionTarget(e, { x: -9, y: 5, z: -9 }, 4);
  let starts = 0; for (let i = 0; i < 20; i++) if (go.canUse()) starts++;
  ok(starts > 0, 'GoToWalkTarget starts outside the range (' + starts + '/20)');
}
// §5 wander chance + ignoreChanceOnce
{
  const e = fresh('cow'); const w = new Ai.WanderAroundGoal(e, 1.0, rng, 80);
  w.ignoreChanceOnce();
  ok(w.canUse() === true, 'ignoreChanceOnce forces the next canUse');
  w.stop();
}
// roster vs GuardianEntity.initGoals: 1 target, 4 FireBeam, 5 GoToWalkTarget, 7 wander, 8 look(player), 8 look(Guardian,12,0.01), 9 random look
for (const t of ['guardian', 'elder_guardian']) {
  const e = fresh(t); const gs = Ai.ROSTER[t](e, { random: rng });
  const rows = gs.entries.map((r) => r.priority + ':' + (r.goal.constructor && r.goal.canUse ? 'g' : '?'));
  ok(gs.entries.map((r) => r.priority).sort().join() === '1,4,5,7,8,8,9', t + ' roster priorities 1,4,5,7,8,8,9 (' + rows + ')');
  const five = gs.entries.find((r) => r.priority === 5);
  ok(five && five.flags === (Ai.MOVE | Ai.LOOK), t + ' goal 5 is MOVE|LOOK');
}
{
  const a = fresh('guardian'); const b = EL.spawn('guardian', 5.5, 5.5, 0.5);
  const gs = Ai.ROSTER.guardian(a, { random: rng, players: () => [] });
  const lk = gs.entries.filter((r) => r.priority === 8)[1].goal;
  let hit = 0; for (let i = 0; i < 2000; i++) if (lk.canUse()) hit++;
  ok(hit > 0 && hit < 100, 'LookAt(Guardian) rolls 0.01 per tick (' + hit + '/2000)');
  b.x = 40; let far = 0; for (let i = 0; i < 2000; i++) if (lk.canUse()) far++;
  ok(far === 0, 'LookAt(Guardian) range 12');
  okAv(far === 0 && hit > 0, 'look row distinguishes in/out of range');
  b.x = 5.5; a.target = fake(3, 5, 3); a.look = { n: 0, args: [], setLookAt(x, y, z, ys, xm) { this.n++; this.args = [ys, xm]; } };
  const f = new G.FireBeamGoal(a); f.start(); f.tick();
  ok(a.look.n >= 2, 'FireBeam start+tick aim the look control at the target');
  ok(a.look.args[0] === Math.PI / 2 && a.look.args[1] === Math.PI / 2, 'FireBeam lookAt passes (90,90) speeds');
  okAv(a.look.args[0] !== 10 * Math.PI / 180, 'default head speed would differ from 90');
  a.look.n = 0; a.look = { n: 0, setLookAt() {} }; okAv(a.look.n === 0, 'a dead look control records nothing');
}
// §6 #1598: damage() and FireBeamGoal.stop() arm the wander goal's ignoreChanceOnce
const armCount = (act) => {
  const e = fresh('guardian'); const gs = G.roster(e, { random: rng }); let n = 0;
  if (!e.guardianWander) return -1;
  const orig = e.guardianWander.ignoreChanceOnce; e.guardianWander.ignoreChanceOnce = () => { n++; orig(); };
  act(e, gs); return n;
};
ok(armCount((e) => G.onDamage(e, null, { source: 'magic' })) === 1, 'damage arms wander ignoreChanceOnce (no attacker)');
ok(armCount((e) => G.onDamage(e, fake(1, 5, 1), {})) === 1, 'damage arms wander ignoreChanceOnce (attacker)');
ok(armCount((e) => { const f = new G.FireBeamGoal(e); f.stop(); }) === 1, 'FireBeamGoal.stop arms wander ignoreChanceOnce');
okAv(armCount((e) => { e.guardianWander = null; }) === 0, 'without the goal reference nothing is armed');
// §7 #1964: wander target = NoPenaltyTargeting.find(10,7) scored by GuardianEntity.getPathfindingFavor (water 10+b-0.5)
{
  const e = fresh('guardian'); const ys = new Set(); let dry = 0;
  for (let i = 0; i < 200; i++) { const t = G.findWanderTarget(e, rng, 10, 7); if (!t) continue; ys.add(Math.floor(t.y)); if (!S.waterIn[M.Physics.blockAt(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))]) dry++; }
  ok(ys.size >= 6, 'wander targets spread vertically (' + ys.size + ' distinct y)');
  ok(dry === 0, 'wander targets are water cells when water is reachable (' + dry + ' dry)');
  okAv(dry === 0 && ys.size >= 6, 'wander distribution probe');
  e.y = 9.5; let air = 0; const orig = G.pathfindingFavor; G.pathfindingFavor = () => 0;
  for (let i = 0; i < 200; i++) { const t = G.findWanderTarget(e, rng, 10, 7); if (t && !S.waterIn[M.Physics.blockAt(Math.floor(t.x), Math.floor(t.y), Math.floor(t.z))]) air++; }
  G.pathfindingFavor = orig;
  okAv(air > 0, 'without the water favor the finder picks air cells too (' + air + '/200)');
}
// #3690: TrackTargetGoal.shouldContinue drops the target beyond followRange (16), no 1.5x slack
{
  const probe = (dist) => { const e = fresh('guardian'); const g = Ai.ROSTER.guardian(e, { random: rng, players: () => [] }).entries.find((r) => r.priority === 1).goal; e.target = fake(e.x + dist, e.y, e.z); return g.canContinueToUse(); };
  const fr = Ai.followRangeOf(fresh('guardian'));
  ok(probe(fr - 1) === true, 'target inside followRange kept (fr ' + fr + ')');
  ok(probe(fr + 4) === false, 'target just past followRange dropped');
  okAv(probe(fr + 4) === false && probe(fr - 1) === true, 'followRange boundary probe');
}
// #3689 ActiveTargetGoal(LivingEntity): +-4 vertical search box (players included)
{
  const tryAt = (py, opts) => {
    const e = fresh('guardian'); const gs = Ai.ROSTER.guardian(e, { random: () => 0 });
    const g = gs.entries.find((r) => r.priority === 1).goal;
    M.Player = { x: 0.5, y: py, z: 0.5, EYE: 1.62, type: 'player', width: 0.6, height: 1.8 };
    let got = false; for (let i = 0; i < 40 && !got; i++) { e.target = null; got = g.canUse() && e.target === M.Player; }
    return got;
  };
  const near = tryAt(9.5), far = tryAt(14.5);
  ok(near, 'player 4 above (inside the +-4 box) is targeted');
  ok(!far, 'player 9 above (outside the +-4 box) is not targeted');
  okAv(near && !far, 'vertical box separates in/out');
  M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
}
// #3831: beam's mob half is plain damage(), never Cb.mobAttack (tryAttack -> Thorns etc.)
{
  const run = (type) => {
    const e = fresh(type), calls = { mob: 0, hurt: [] }, oM = M.Combat.mobAttack, oS = M.Survival;
    M.Combat.mobAttack = () => { calls.mob++; };
    M.Survival = { hurt: (t, tag, amt) => { calls.hurt.push([tag, amt]); return true; } };
    const t = fake(e.x + 2, e.y, e.z); M.Player = t; e.target = t;
    const f = new G.FireBeamGoal(e); f.start(); for (let i = 0; i < 100 && !calls.hurt.some((h) => h[0] === 'mob'); i++) f.tick();
    M.Combat.mobAttack = oM; M.Survival = oS; M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
    return calls;
  };
  const c = run('guardian');
  ok(c.mob === 0, 'beam never calls Cb.mobAttack');
  ok(c.hurt.some((h) => h[0] === 'mob' && h[1] === 6), 'beam lands plain mob damage 6 via Survival.hurt');
  okAv(c.mob === 0 && c.hurt.some((h) => h[0] === 'magic'), 'magic half still lands, mobAttack untouched');
}
// ── anti-vacuity: corrupt each rule and the same probe must notice ─────────────
{ const e = fresh('cow'); Ai.setPositionTarget(e, { x: 0, y: 5, z: 0 }, 16); e.positionTargetRange = 17; okAv(Ai.isInWalkTargetRange(e, { x: 16, y: 5, z: 0 }), 'range 17 accepts the point range 16 refuses'); }
{ const e = fresh('cow'); Ai.setPositionTarget(e, { x: 0, y: 5, z: 0 }, 16); Ai.clearPositionTarget(e); okAv(!Ai.hasPositionTarget(e), 'clear drops hasPositionTarget'); }
{ const e = fresh('cow'); const w = new Ai.WanderAroundGoal(e, 1.0, rng, 80); w.ignoreChanceOnce = () => {}; w.ignoreChanceOnce(); let hits = 0; for (let i = 0; i < 50; i++) if (w.canUse()) hits++; okAv(hits < 50, 'without ignoreChanceOnce the 1/80 roll refuses most ticks (' + hits + '/50)'); }

if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.forEach((f) => console.log(' x ' + f)); }
console.log('\nguardiangoalcheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
