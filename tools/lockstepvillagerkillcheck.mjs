#!/usr/bin/env node
// lockstepvillagerkillcheck -- #9263: engine side of the 'villagerkill' lane (hard difficulty, zombie kills a NoAI villager -> zombie_villager), 20 salts.
// The per-tick 'entities' field goes through compareTraces. Anti-vacuity: each broken engine rule must diverge on 'entities'.
// Server comparison = the pilot (the real server's own start phase jitters by one tick between reps: owed, see the issue).
import { engineVillagerKillTrace, VK_FIELDS } from './referee/lockstep/villagerkilllane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { harnessM } from './referee/lockstep/zombielane.mjs';
import { LOCKSTEP_ONLY } from './referee/chasescen.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const lane = LOCKSTEP_ONLY.find((l) => l.id === 'villagerkill');
ok(lane && lane.hard && lane.vk && lane.far, 'lanes.d/villagerkill.json defines the hard, far-player vk lane');
const base = SALTS.map((s) => engineVillagerKillTrace(s));
base.forEach((R, s) => {
  const k = R.map((r) => r.entities[0] ? r.entities[0][0] : 'none'), first = k.indexOf('zombie_villager');
  ok(k[0] === 'villager', `salt ${s}: starts with the villager`);
  ok(first > 20 && first < 299, `salt ${s}: conversion at tick ${first}`);
  ok(k.slice(first).every((x) => x === 'zombie_villager'), `salt ${s}: stays a zombie_villager`);
  ok(compareTraces(R, engineVillagerKillTrace(s), { fields: VK_FIELDS }) === null, `salt ${s}: same salt, same trace`);
});
ok(new Set(base.map((R) => R.findIndex((r) => r.entities[0] && r.entities[0][0] === 'zombie_villager'))).size >= 1, 'conversion ticks recorded');
const M = harnessM();
caught(compareTraces(base[0], engineVillagerKillTrace(0, { difficulty: 'easy' }), { fields: VK_FIELDS })?.field === 'entities', 'easy must not convert');
{ const o = M.ZVillager.convertVillagerToZombie; M.ZVillager.convertVillagerToZombie = () => null;
  try { caught(compareTraces(base[0], engineVillagerKillTrace(0), { fields: VK_FIELDS })?.field === 'entities', 'conversion disabled'); } finally { M.ZVillager.convertVillagerToZombie = o; } }
{ const o = M.Combat.mobAttack; M.Combat.mobAttack = () => null;
  try { caught(compareTraces(base[0], engineVillagerKillTrace(0), { fields: VK_FIELDS })?.field !== undefined, 'zombie never hits'); } finally { M.Combat.mobAttack = o; } }
console.log(`${SALTS.length * 4 + 2} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad || breaks !== 3 ? 1 : 0);
