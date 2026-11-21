#!/usr/bin/env node
// vbpanic11662check.mjs — #11662: proves 07zv3_vbpanic.js's NearestLivingEntitiesSensor (nearbyLivingNow/SenseTick),
// NearestVisibleLivingEntitySensor (findNearestHostileNow), FindWalkTargetTask (panic fuzzyFind wander),
// FollowMobTask (nearestOfType/tickBusyFollow), MobVisibilityCache (canSeeEntity) and HitResult (Ray.cast hit == occluded)
// are REACHED from 07zv_villagerbrain.js VB.tick (-> VBP.tick, VBP.canSee) and that cutting each breaks a scenario.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const FILES = ['07m_breed.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js'];
function trial(patch) {
  const M = loadEngine({ extra: FILES, dom: false, patch: patch ? (f, s) => (f === '07zv3_vbpanic.js' ? patch(s) : s) : undefined });
  const VB = M.VB, VBP = M.VBPanic, o = {};
  let list = [], occluded = false, rolls = 0; const walks = [];
  M.EntityList = { list };
  M.Ray = { targetable: () => true, cast: () => (occluded ? { hit: true } : null) };
  VB.rand = () => rolls;
  VB.fuzzyFind = (e, h, v, t) => { walks.push([h, v, t]); return { x: 3, y: 64, z: 3 }; };
  const mk = (type, x, z) => ({ type, x, y: 64, z, height: 1.8 });
  const V = () => ({ type: 'villager', x: 0, y: 64, z: 0, height: 1.8, vbActivity: 'idle' });
  // HitResult / MobVisibilityCache: a MISS is visible, a block hit hides; >128 never visible
  const a = V(), b = mk('zombie', 5, 0);
  o.seeClear = VBP.canSee(a, b) === true;
  occluded = true; o.seeBlocked = VBP.canSee(a, b) === false; occluded = false;
  o.seeFar = VBP.canSee(a, mk('zombie', 200, 0)) === false;
  // NearestVisibleLivingEntitySensor: nearest visible hostile in its OWN danger distance triggers panic
  list.length = 0; list.push(mk('zombie', 3, 0), mk('zombie', 7, 0), mk('cow', 1, 0));
  const e1 = V(); const r1 = VBP.tick(e1, 0, 100);
  o.hostileNearest = r1 === true && e1.vbHostileCache && e1.vbHostileCache.x === 3;
  list.length = 0; list.push(mk('zombie', 3, 0), mk('zombie', 7, 0));
  list[0].dead = true;
  const e1b = V(); VBP.tick(e1b, 0, 100); o.hostileSkipsDead = e1b.vbHostileCache && e1b.vbHostileCache.x === 7;
  list.length = 0; list.push(mk('zombie', 3, 0)); occluded = true;
  o.hostileNeedsSight = VBP.tick(V(), 0, 100) === false; occluded = false;
  list.length = 0; list.push(mk('zombie', 12, 0));
  o.hostileRange = VBP.tick(V(), 0, 100) === false;   // zombie danger distance is 8
  // cadence: cached for SENSE_INTERVAL ticks, resensed on the gate
  list.length = 0; list.push(mk('zombie', 3, 0));
  const e2 = V(); VBP.tick(e2, 0, 100); list[0].x = 100;
  VBP.tick(e2, 0, 101); o.hostileCached = !!e2.vbHostileCache;
  for (let i = 0; i < 20; i++) VBP.tick(e2, 0, 102 + i);
  o.hostileResensed = !e2.vbHostileCache;
  // FindWalkTargetTask: hostile at 7 (inside 8, outside FLEE_RANGE 6) -> no flee, small wander (2,2) range 0, panic speed
  list.length = 0; list.push(mk('zombie', 7, 0)); walks.length = 0;
  const e3 = V(); VBP.tick(e3, 0, 100);
  o.wander = walks.length === 1 && walks[0][0] === 2 && walks[0][1] === 2 && e3.vbWalkTarget && e3.vbWalkTarget.range === 0
    && e3.vbWalkTarget.speedMul === VBP.PANIC_SPEED_MUL && e3.vbWalkTarget.x === 3;
  // FollowMobTask over NearestLivingEntitiesSensor: roll<2 cat, <4 wolf, else WaitTask; within 8, visible, own list within 16
  const follow = (roll, ents) => { rolls = roll / 12 + 0.001; list.length = 0; list.push(mk('zombie', 7, 0), ...ents); const e = V(); VBP.tick(e, 0, 100); return e; };
  o.followCat = (() => { const e = follow(0, [mk('cat', 4, 4), mk('cat', 0, 6)]); return e.vbLookTarget && e.vbLookTarget.x === 4 && e.vbLookTarget.z === 4; })();
  o.followWolf = (() => { const e = follow(3, [mk('wolf', 0, 5)]); return e.vbLookTarget && e.vbLookTarget.z === 5; })();
  o.followWrongType = !follow(0, [mk('wolf', 0, 5)]).vbLookTarget;
  o.followWait = !follow(8, [mk('cat', 0, 5)]).vbLookTarget;
  o.followFar = !follow(0, [mk('cat', 0, 9)]).vbLookTarget;      // beyond FollowMobTask's 8
  occluded = false;
  // NearestLivingEntitiesSensor: 16-block box, 20-tick cadence
  list.length = 0; list.push(mk('zombie', 7, 0)); rolls = 0.001;
  const e4 = V(); VBP.tick(e4, 0, 100);
  o.nearbyEmpty = Array.isArray(e4.vbNearbyCache) && e4.vbNearbyCache.length === 1 && e4.vbNearbyCache[0].type === 'zombie';
  list.push(mk('cat', 0, 5)); VBP.tick(e4, 0, 101);
  o.nearbyCached = !e4.vbLookTarget;
  for (let i = 0; i < 20; i++) VBP.tick(e4, 0, 102 + i);
  o.nearbyResensed = !!e4.vbLookTarget;
  list.length = 0; list.push(mk('zombie', 7, 0), mk('cat', 0, 15), mk('cat', 0, 17));
  const e5 = V(); VBP.tick(e5, 0, 100);
  o.nearbyRadius = e5.vbNearbyCache.length === 2;   // zombie + cat@15, not cat@17
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const vb = readFileSync(join(MCLITE_ROOT, 'src', '07zv_villagerbrain.js'), 'utf8');
ok(/NS\.VBPanic\.tick\(e, now, tnow\)/.test(vb), 'reach: VB.tick -> VBPanic.tick (sensors, FindWalkTask, FollowMobTask)');
ok(/NS\.VBPanic\.canSee\(e, o\)/.test(vb), 'reach: villager sensor -> VBPanic.canSee (MobVisibilityCache/HitResult)');
const BR = [
  ['raymiss', "return !hit;", "return true;", ['seeBlocked', 'hostileNeedsSight']],
  ['rayfar', "if (dist > 128) return false;", "", ['seeFar']],
  ['hostilenearest', "d < bestD && canSeeEntity(e, o)) { bestD = d; best = o; }\n    }\n    return best;\n  }\n\n  /** VillagerHostilesSensor's", "canSeeEntity(e, o)) { bestD = d; best = o; }\n    }\n    return best;\n  }\n\n  /** VillagerHostilesSensor's", ['hostileNearest']],
  ['hostiledead', "if (o === e || o.dead || o.removed) continue;\n      var dist", "if (o === e) continue;\n      var dist", ['hostileSkipsDead']],
  ['hostilerange', "if (d <= dist * dist && d < bestD", "if (d < bestD", ['hostileRange']],
  ['hostilecd', "e.vbHostileSenseCD = VBP.SENSE_INTERVAL;", "e.vbHostileSenseCD = 0;", ['hostileCached']],
  ['wander', "VB.fuzzyFind(e, VBP.FIND_WALK_H, VBP.FIND_WALK_V, null);", "VB.fuzzyFind(e, 9, 9, null);", ['wander']],
  ['wanderrange', "range: 0, speedMul: VBP.PANIC_SPEED_MUL };\n    }\n    tickBusyFollow", "range: 3, speedMul: VBP.PANIC_SPEED_MUL };\n    }\n    tickBusyFollow", ['wander']],
  ['followtype', "o.type !== type ||", "", ['followWrongType']],
  ['followdist', "d <= maxDistSq && d < bestD", "d < bestD", ['followFar']],
  ['followwait', "      return;   // WaitTask drawn", "      nearby = nearbyLivingSenseTick(e); target = nearestOfType(nearby, e, 'cat', maxDSq);", ['followWait']],
  ['followwolf', "target = nearestOfType(nearby, e, 'wolf', maxDSq);", "target = null;", ['followWolf']],
  ['nearbyradius', "<= 256) out.push(o)", "<= 100000) out.push(o)", ['nearbyRadius']],
  ['nearbycd', "e.vbNearbySenseCD = VBP.SENSE_INTERVAL;", "e.vbNearbySenseCD = 0;", ['nearbyCached']],
];
for (const [key, a, b, expect] of BR) {
  if (!expect.length) continue;
  breaks++; let hit = false, X;
  const pf = (s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; };
  try { X = trial(pf); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`vbpanic11662check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
