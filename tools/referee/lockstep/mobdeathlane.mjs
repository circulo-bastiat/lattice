// lockstep/mobdeathlane.mjs -- #9217 (MOBPROOF-DAMAGE-3): the ENGINE side of the mobdeath lane. A zombie with 1 HP and Fire:32767 burns to death
// (ON_FIRE, bypasses armour) and Cb.dropLoot drops its loot. Rows from engineZombieTrace({mob:'zombie'}) plus the spawn tick (t after the world tick, as
// runchase's ent walk sees it with Age:0s) and Pos of every item entity, in spawn order; `dead` = the tick the zombie died.
import { engineZombieTrace } from './zombielane.mjs';

export const DEATH_FIELDS = ['pos'];
export function engineDeathTrace(salt) {
  const seen = new Set(), ent = { itemTick: [], itemPos: [], count: [] };
  let diedAt = null, z = null;
  const rows = engineZombieTrace(salt, { mob: 'zombie', build: ({ M }) => { const orig = M.EntityList.spawn; M.EntityList.spawn = function () { const e = orig.apply(this, arguments); if (e && e.type === 'zombie') { z = e; e.health = 1; e.remainingFireTicks = 32767; } M.EntityList.spawn = orig; return e; }; },
    onTick: (t, EL) => {
      if (diedAt === null && z && (z.dead || z.removed)) diedAt = t;
      for (const f of EL.list) if (f.type === 'item' && !seen.has(f)) { seen.add(f); ent.itemTick.push(t); ent.itemPos.push([f.x, f.y, f.z]); ent.count.push(f.count); }
    } });
  return { rows, ent, diedAt };
}
