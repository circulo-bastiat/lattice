#!/usr/bin/env node
// meleenavcheck.mjs — #3665: MeleeAttackGoal.tick's lookAt + repath countdown (Ai.meleeNavTick, shared by
// Ai.MeleeAttackGoal and Ai.SpiderAttackGoal) against .decomp MeleeAttackGoal.java tick().
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07k_goals.js', '07zj_polarbear.js'], dom: false });
const Ai = MCL.Ai;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
let paths = 0, looks = 0, found = true;
Ai.findPath = () => { paths++; return found ? [{}, {}] : null; };
Ai.canSee = () => true;
const mk = () => ({ x: 0, y: 64, z: 0, look: { setLookAt() { looks++; } } });
const fresh = () => ({ cd: 0, tx: 0, ty: 0, tz: 0, path: null, idx: 1 });
const rnd = (v) => () => v;   // 0 -> nextInt 0, nextFloat 0 (<0.05 repath); 0.5 -> nextInt(7)=3, no random repath
{
  const e = mk(), t = { x: 5, y: 64, z: 0 }, st = fresh();
  Ai.meleeNavTick(e, t, st, 25, true, rnd(0.5));
  ok(looks === 1 && paths === 1 && st.cd === 7, 'first tick: lookAt, repath, countdown 4+nextInt(7)=7');
  for (let i = 0; i < 6; i++) Ai.meleeNavTick(e, t, st, 25, true, rnd(0.5));
  ok(paths === 1 && st.cd === 1, 'no repath while countdown runs');
  Ai.meleeNavTick(e, t, st, 25, true, rnd(0.5));
  ok(paths === 1 && st.cd === 0, 'countdown hit 0 but target did not move >=1 block and rand>=0.05: no repath');
  t.x = 6.5; Ai.meleeNavTick(e, t, st, 42, true, rnd(0.5));
  ok(paths === 2, 'target moved >=1 block: repath');
  st.cd = 0; Ai.meleeNavTick(e, t, st, 25, true, rnd(0));
  ok(paths === 3, 'rand<0.05 repaths a stationary target');
  st.cd = 0; Ai.meleeNavTick(e, t, st, 300, true, rnd(0.5)); st.cd = 0; paths = 0;
  Ai.meleeNavTick(e, { x: 20, y: 64, z: 0 }, st, 300, true, rnd(0.5));
  ok(st.cd === 7 + 5, 'distSq>256 adds 5');
  Ai.meleeNavTick(e, { x: 40, y: 64, z: 0 }, Object.assign(st, { cd: 0 }), 1100, true, rnd(0.5));
  ok(st.cd === 7 + 10, 'distSq>1024 adds 10');
  found = false; Ai.meleeNavTick(e, { x: 60, y: 64, z: 0 }, Object.assign(st, { cd: 0 }), 25, true, rnd(0.5));
  ok(st.cd === 7 + 15, 'failed path adds 15'); found = true;
  Ai.canSee = () => false;
  paths = 0; Ai.meleeNavTick(e, { x: 90, y: 64, z: 0 }, Object.assign(st, { cd: 0 }), 25, false, rnd(0.5));
  ok(paths === 0, 'pauseWhenMobIdle=false needs canSee'); Ai.canSee = () => true;
  okAv(paths === 0 && looks > 0, 'a goal that never looks/repaths would fail the counts above');
}
{ // goal wiring: the goals must route through meleeNavTick
  const src = (Ai.MeleeAttackGoal.__orig || Ai.MeleeAttackGoal).toString() + (Ai.SpiderAttackGoal.__orig || Ai.SpiderAttackGoal).toString();
  ok((src.match(/meleeNavTick/g) || []).length === 2, 'both goals call Ai.meleeNavTick');
  okAv(!/repathIn/.test(src), 'neither goal keeps the fixed 10-tick repathIn');
}
{ // polar bear's AttackGoal extends MeleeAttackGoal: same look/repath cadence (#4428)
  const src = MCL.PolarBear.AttackGoal.toString();
  ok(/meleeNavTick/.test(src), 'Pb.AttackGoal calls Ai.meleeNavTick');
  okAv(!/repathIn|MELEE_REACH/.test(src), 'Pb.AttackGoal keeps no fixed repath / in-reach path drop');
}
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
