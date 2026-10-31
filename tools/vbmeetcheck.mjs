#!/usr/bin/env node
// vbmeetcheck.mjs — G18f-M1: createMeetTasks' priority-2 RandomTask[GoToIfNearbyTask(MEETING_POINT,0.4,40) w2,
// MeetVillagerTask w2] (VB.meetRandomTick). MeetVillagerTask: nextInt(100)==0, bell within 4.0, a villager
// within squaredDistance 32 -> INTERACTION_TARGET, LOOK_TARGET, WALK_TARGET(speed 0.3, closeEnough 1).
import { loadEngine } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '07_world.js', '07h_entities.js', '07i_entitylist.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
const VB = M.VB, EL = M.EntityList;
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('vbmeetcheck — MeetVillagerTask + GoToIfNearbyTask(MEETING_POINT, 0.4F, 40)');
if (!VB || !VB.meetRandomTick || !EL) { console.log('FAIL vbmeetcheck — module missing'); process.exit(1); }

let seed = 12345;
VB.rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
VB.fuzzyFind = () => null;   // GoToIfNearby's fuzzy target needs a world; irrelevant here

const mk = (x, z) => ({ type: 'villager', x, y: 64, z, eyeHeight: 1.62, vbMeeting: { x: 0, y: 64, z: 0 }, vbWalkTarget: null });
function rate(a, others, ticks) {
  EL.list = [a, ...others];
  let n = 0;
  for (let t = 0; t < ticks; t++) {
    a.vbWalkTarget = null; a.vbGoIfNearbyNext = 1e9;   // only MeetVillagerTask may set a target
    if (VB.meetRandomTick(a, t) === 'meetVillager') { n++; a.snap = { it: a.vbInteractionTarget, wt: a.vbWalkTarget, lt: a.vbLookTarget }; }
  }
  return n;
}
const N = 20000;
{
  const a = mk(1, 0), b = mk(1, 3);
  const n = rate(a, [b], N);
  // MeetVillagerTask is picked first half the time (weight 2 vs 2) and passes 1/100, else the other wins first
  // but GoToIfNearby always passes (bell < 40) -> expected N * 0.5 * 0.01 = 100
  ok(n > 50 && n < 170, `pair at the bell meets ~once per 200 ticks (got ${n} in ${N})`);
  const sn = a.snap || {};
  ok(sn.it === b && sn.wt && sn.wt.range === 1 && sn.wt.speed === 0.3 && sn.lt && sn.lt.entity === b, 'run writes INTERACTION_TARGET, LOOK_TARGET, WALK_TARGET(0.3, 1)');
  ok(rate(mk(1, 0), [], N) === 0, 'a lone villager never meets');
  ok(rate(mk(1, 0), [mk(1, 7)], N) === 0, 'a villager beyond squaredDistance 32 is not a target');
}
{
  const far = mk(8, 0), b = mk(8, 3);
  ok(rate(far, [b], N) === 0, 'a villager 8 blocks from the bell never approaches');
  const real = VB.MEET_BELL_DISTANCE; VB.MEET_BELL_DISTANCE = 1e9;
  okAv(rate(far, [b], N) > 0, 'dropping the 4.0 bell-distance gate makes a far villager approach');
  VB.MEET_BELL_DISTANCE = real;
}
console.log(fails.length ? 'FAIL vbmeetcheck\n' + fails.join('\n') : `PASS ${pass} checks, 0 failures (${breaks} breaks caught)`);
process.exit(fails.length ? 1 : 0);
