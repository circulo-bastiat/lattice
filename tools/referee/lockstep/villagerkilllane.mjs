// lockstep/villagerkilllane.mjs -- #9263 (G17-L69a-1): the ENGINE side of the 'villagerkill' lane (chasescen lanes.d/villagerkill.json): hard difficulty,
// an AI zombie and a NoAI villager 4 blocks ahead, the player far away. The zombie targets the villager (ActiveTargetGoal<Merchant>), kills it and
// ZombieEntity.onKilledOther leaves a zombie_villager. Per tick: pos + entities = the victim [[kind, 0, -1]] (the server's entity id is not compared).
import { engineZombieTrace, harnessM, agentSeed, ZOMBIE_KEY } from './zombielane.mjs';
import { startX } from '../chasescen.mjs';
import { vkEntities } from './run.mjs';

export const VK_FIELDS = ['pos', 'entities'];
export const VK_TICKS = 300;
export function engineVillagerKillTrace(salt, opts = {}) {   // opts.difficulty: the lane's difficulty (default hard)
  const M = harnessM();
  let v = null;
  try {
    return engineZombieTrace(salt, { mob: 'zombie', T: VK_TICKS, dist: 200 - startX(),
      onStart: (EL) => {
        M.Diff.set(opts.difficulty || 'hard');
        const z = EL.list.find((x) => x.type === 'zombie');
        EL.random = null; z.random = new M.JRandom(agentSeed(salt, ZOMBIE_KEY, 1));
        v = EL.spawn('villager', startX() + 4, 0, 0.5); v.persistent = true; v.aiDisabled = true;
        EL.random = null;
      },
      extra: (EL) => {
        const k = EL.list.some((x) => x.type === 'zombie_villager' && !x.removed) ? 2 : EL.list.some((x) => x.type === 'villager' && !x.removed) ? 1 : 0;
        return { entities: vkEntities(k) };
      } });
  } finally { M.Diff.set('normal'); }
}
