import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
// lootingscen.mjs — the PLAYER-KILL / LOOTING loot pack (infra I6, s142, 25 Sept 2026), shared by runlooting.mjs (the real
// 1.18.2 server) and lootingrefcheck.mjs (the engine). mob-loot.json (runloot.mjs) rolled every entity table with NO killer;
// this pack rolls the context a real kill by the player has: `execute as <player> run loot ... kill <mob>`
// (LootCommand.executeKill, .decomp LootCommand.java:451-473 — the source player becomes KILLER_ENTITY, DIRECT_KILLER_ENTITY
// and LAST_DAMAGE_PLAYER, so `killed_by_player` passes and `looting_enchant` / `random_chance_with_looting` read the Looting
// level of the player's MAIN HAND). Two lanes: L0 = a plain netherite sword, L3 = the same sword with Looting III.
export const ROLLS = 300;
export const LANES = { L0: 0, L3: 3 };
export const TABLES = ['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'wither_skeleton', 'spider', 'cave_spider', 'creeper',
  'enderman', 'blaze', 'ghast', 'witch', 'vindicator', 'pillager', 'evoker', 'guardian', 'cow', 'chicken', 'pig', 'rabbit',
  'squid', 'zombified_piglin', 'piglin_brute', 'sheep'];

// #7859: the roster pack (mobdropsproofcheck) - every tools/mobl3-mobs.json mob that has an entities/ table in mob-loot.json, Looting 0..3.
export const ROSTER_LANES = { L0: 0, L1: 1, L2: 2, L3: 3 };
export function rosterTables() {
  const T = new URL('..', import.meta.url).pathname;
  const roster = Object.keys(JSON.parse(readFileSync(T + 'mobl3-mobs.json', 'utf8')).mobs);
  const f = join(process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2'), 'golden', 'mob-loot.json');
  const have = JSON.parse(readFileSync(f, 'utf8')).tables;
  return roster.filter((m) => have[m] && m !== 'player');   // `summon player` is unknown to the server
}
