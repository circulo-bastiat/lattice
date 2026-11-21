#!/usr/bin/env node
// lockstepconvertcheck -- #6330 (G17-L69): engine side of the villager-kill conversion by difficulty (lanes villagerkill_easy / _normal, plus hard from #9263), 20 salts.
// easy never converts, hard always, normal on the killer's own random.nextBoolean() (Zombie.killedEntity: true = skip). Per-tick 'entities' through compareTraces.
// Server comparison = the pilot (lane json carries diff; runchase sets the server difficulty from it).
import { engineVillagerKillTrace, VK_FIELDS } from './referee/lockstep/villagerkilllane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { harnessM } from './referee/lockstep/zombielane.mjs';
import { LOCKSTEP_ONLY } from './referee/chasescen.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
for (const [id, d] of [['villagerkill_easy', 'easy'], ['villagerkill_normal', 'normal']]) {
  const l = LOCKSTEP_ONLY.find((x) => x.id === id); ok(l && l.vk && l.diff === d, `lanes.d/${id}.json carries diff ${d}`);
}
const last = (R) => R[R.length - 1].entities[0] ? R[R.length - 1].entities[0][0] : 'none';
const run = (d) => SALTS.map((s) => engineVillagerKillTrace(s, { difficulty: d }));
const easy = run('easy'), normal = run('normal'), hard = run('hard');
easy.forEach((R, s) => ok(last(R) === 'villager' || last(R) === 'none', `easy salt ${s}: never a zombie_villager`));
hard.forEach((R, s) => ok(last(R) === 'zombie_villager', `hard salt ${s}: converts`));
const conv = normal.map((R) => last(R) === 'zombie_villager');
ok(conv.some((x) => x) && conv.some((x) => !x), `normal: both outcomes occur over 20 salts (${conv.filter((x) => x).length} convert)`);
normal.forEach((R, s) => ok(compareTraces(R, engineVillagerKillTrace(s, { difficulty: 'normal' }), { fields: VK_FIELDS }) === null, `normal salt ${s}: same salt, same trace`));
const M = harnessM();
caught(normal.some((R, s) => compareTraces(R, engineVillagerKillTrace(s, { difficulty: 'easy' }), { fields: VK_FIELDS })), 'normal differs from easy');
{ const o = M.ZVillager.KILL_SKIP_ON_NORMAL;   // the gate sees 0 (skip) or 1 per draw; a threshold of -1 never skips
  try { M.ZVillager.KILL_SKIP_ON_NORMAL = -1; caught(normal.some((R, s) => compareTraces(R, engineVillagerKillTrace(s, { difficulty: 'normal' }), { fields: VK_FIELDS })?.field === 'entities'), 'normal roll never skips'); } finally { M.ZVillager.KILL_SKIP_ON_NORMAL = o; } }
{ const o = M.ZVillager.shouldConvertOnKill; M.ZVillager.shouldConvertOnKill = (d, r) => o(d === 'easy' ? 'normal' : d, r);
  try { caught(easy.some((R, s) => compareTraces(R, engineVillagerKillTrace(s, { difficulty: 'easy' }), { fields: VK_FIELDS })?.field === 'entities'), 'easy converts'); } finally { M.ZVillager.shouldConvertOnKill = o; } }
console.log(`${SALTS.length * 3 + 5} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad || breaks !== 3 ? 1 : 0);
