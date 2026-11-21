#!/usr/bin/env node
// dragonfightfullcheck.mjs -- #265: EnderDragonFight.respawnDragon() with REAL end_crystal entities (default gather, no
// opts.crystalsNear), ring aliveness following real crystal entities, and the destroyed-crystal abort of a respawn.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('dragonfightfullcheck -- #265 fight with real crystal entities');

function build() {
  const M = loadEngine({ extra: ['02g_items.js', '02f_tags.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '07y_equip.js',
    '07i_entitylist.js', '14b_physics.js', '14d_survival.js', '14f_inventory.js', '14i_hand.js', '07q_effects.js',
    '14j_combat.js', '07k_goals.js', '07zzl_enderdragon.js', '07zzn_endcrystal.js', '07za_explosion.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Combat.init(); M.EnderDragon.init(); M.Explosion.init();
  M.World.init(1);
  M.EntityList.list.length = 0;
  return M;
}
function fightWithPortalCrystals(M, skip) {
  const ED = M.EnderDragon, EL = M.EntityList;
  const fight = new ED.EnderDragonFight({ seed: 1, dragonKilled: true, heightAt: () => 64 });
  EL.list.length = 0;
  const p = fight.exitPortalLocation, ys = p.y + 1;
  const spots = [[2, 0], [-2, 0], [0, 2], [0, -2]];
  const cs = spots.map((s, i) => i === skip ? null : EL.spawn('end_crystal', p.x + s[0] + 0.5, ys, p.z + s[1] + 0.5, {}));
  return { fight, cs, EL };
}
{
  const M = build();
  const { fight, cs } = fightWithPortalCrystals(M, -1);
  ok(cs.every(Boolean), 'four real crystals spawned');
  ok(fight.respawnDragon() === true, 'default gather finds the 4 real crystals and starts the sequence');
  ok(fight.dragonSpawnStateIndex === 0 && fight.spawnCrystals.length === 4, 'state 0 with 4 ceremony crystals');
}
{
  const M = build();
  const { fight } = fightWithPortalCrystals(M, 2);
  okAv(fight.respawnDragon() === false && fight.dragonSpawnStateIndex < 0, 'only 3 of 4 portal crystals -> no respawn');
}
{
  const M = build();
  const { fight, cs, EL } = fightWithPortalCrystals(M, -1);
  EL.remove(cs[1]);
  okAv(fight.respawnDragon() === false, 'a removed crystal no longer counts');
}
{
  const M = build();
  const { fight, cs } = fightWithPortalCrystals(M, -1);
  fight.respawnDragon();
  fight.crystalDestroyed(cs[0], {});
  okAv(fight.dragonSpawnStateIndex === -1 || fight.dragonSpawnStateIndex < 0, 'destroying a ceremony crystal aborts the respawn');
}
{
  const M = build();
  const ED = M.EnderDragon, EL = M.EntityList;
  const fight = new ED.EnderDragonFight({ seed: 1 });
  const before = fight.getAliveEndCrystals();
  const live = EL.list.filter((e) => e.type === 'end_crystal');
  ok(before === 10 && live.length >= 10, 'ring of 10 real crystals alive');
  M.EndCrystal.damage(live[0], {});
  okAv(fight.getAliveEndCrystals() === 9, 'killing one real ring crystal drops the alive count to 9');
}
console.log(fails.length ? fails.map((f) => '  x ' + f).join('\n') : '');
console.log('assertions passed ......... ' + pass + '\nfailures ......... ' + fails.length);
console.log(breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
