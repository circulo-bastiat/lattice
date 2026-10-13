// chasescen.mjs — the MOB CHASE SPEED scenarios (infra I6, 25 Sept 2026), shared by runchase.mjs (the real 1.18.2 server)
// and chaserefcheck.mjs (the engine). QUEUE 0.0 (Dan, 25 Sept: every mob's "speed in blocks/s vs .decomp"; the brute
// "too fast" report). One LANE per mob: a stone floor strip 3 wide (z -1..1), stone walls at z = -2 and +2
// (2 high) so the path is a straight corridor; the mob is summoned at local x = START + 0.5 (AI on, persistent), a survival
// player (the growbot on the server, M.Player in the engine) stands still at local x = DIST + 0.5 on the same floor.
// Both sides log the mob's x/z every tick for T ticks from the summon (log[0] = the summon tick). The check derives the
// cruising speed from the log (see chaserefcheck.mjs); every number it compares is the SERVER's (D-329).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
export const T = 160;
export const DIST = 22;        // local x of the player's block
export const START = 11;       // local x of the mob's block: 11 blocks from the player, inside every chaser's
                               // generic.follow_range (the smallest is the vindicator's 12)
export const WIN = [1, 6];     // the cruise window: blocks travelled from the start (see chaserefcheck.mjs)
export const PITCH = 24;       // lanes along z, far enough that each mob's nearest player is its own lane's
export const REPS = 3;
export const SCEN = [
  { id: 'zombie', mob: 'zombie' },
  { id: 'baby_zombie', mob: 'zombie', nbt: 'IsBaby:1b' },
  { id: 'husk', mob: 'husk' },
  { id: 'drowned', mob: 'drowned' },
  { id: 'zombie_villager', mob: 'zombie_villager' },
  { id: 'vindicator', mob: 'vindicator' },
  { id: 'spider', mob: 'spider' },
  { id: 'cave_spider', mob: 'cave_spider' },
  { id: 'piglin_brute', mob: 'piglin_brute' },
  { id: 'piglin', mob: 'piglin' },
  { id: 'hoglin', mob: 'hoglin' },
  { id: 'zoglin', mob: 'zoglin' },
  { id: 'silverfish', mob: 'silverfish' },
  { id: 'endermite', mob: 'endermite' },
  { id: 'wither_skeleton', mob: 'wither_skeleton' },
  { id: 'creeper', mob: 'creeper' },
  { id: 'ravager', mob: 'ravager' },
  // Both directions (rule 6, D-684: 'i am being pursued in creative'): the SAME chasers with a CREATIVE player --
  // vanilla's attackable-target predicate refuses it, so nothing closes in. Compared as a yes/no (see the check).
  { id: 'zombie_vs_creative', mob: 'zombie', creative: true },
  { id: 'spider_vs_creative', mob: 'spider', creative: true },
  { id: 'vindicator_vs_creative', mob: 'vindicator', creative: true },
  { id: 'brute_vs_creative', mob: 'piglin_brute', creative: true },
  // s137 widening (infra I6): the zombie family's other babies (vanilla's BABY_SPEED_BONUS is ZombieEntity's, so every
  // subclass inherits it -- ZombieEntity.java:69-71,179-181), and the creative refusal for EVERY remaining chaser
  // (D-684 was found half done: 3 of 4 creative cases closed in -- rule 6, both directions, for the whole list).
  { id: 'baby_husk', mob: 'husk', nbt: 'IsBaby:1b' },
  { id: 'baby_drowned', mob: 'drowned', nbt: 'IsBaby:1b' },
  { id: 'baby_zombie_villager', mob: 'zombie_villager', nbt: 'IsBaby:1b' },
  { id: 'husk_vs_creative', mob: 'husk', creative: true },
  { id: 'drowned_vs_creative', mob: 'drowned', creative: true },
  { id: 'zombie_villager_vs_creative', mob: 'zombie_villager', creative: true },
  { id: 'cave_spider_vs_creative', mob: 'cave_spider', creative: true },
  { id: 'piglin_vs_creative', mob: 'piglin', creative: true },
  { id: 'hoglin_vs_creative', mob: 'hoglin', creative: true },
  { id: 'zoglin_vs_creative', mob: 'zoglin', creative: true },
  { id: 'silverfish_vs_creative', mob: 'silverfish', creative: true },
  { id: 'endermite_vs_creative', mob: 'endermite', creative: true },
  { id: 'wither_skeleton_vs_creative', mob: 'wither_skeleton', creative: true },
  { id: 'creeper_vs_creative', mob: 'creeper', creative: true },
  { id: 'ravager_vs_creative', mob: 'ravager', creative: true },
];
export const LIVE = SCEN.filter((s) => !s.skip);
export const startX = () => START + 0.5;
export const playerX = () => DIST + 0.5;
// #5094 (G17-L3b): lockstep-only lanes -- not chasers, so NOT in LIVE (chaserefcheck compares speed); runchase adds them
// only when MCLITE_CHASE_ONLY names them. The cow wanders (no target), so its trace is pure RandomStroll/look RNG.
// #6356 (G17-L67a): the 'chicken' pen lane has ent:true -- runchase also walks the server's entities each tick: the chicken's
// EggLayTime/Age (ent) and every fresh item entity's spawn tick + Pos (eggs; Age:0s the first tick it is seen) -- cases[id].ent.
// #6952: zombie_wall = the zombie lane with a 1-high stone block across z -1..0 at local x START+5 (z 1 stays open): the path goes round it.
// #6989: ONE FILE PER LANE in tools/referee/lanes.d/<id>.json ({ id, mob, ...options, note? }) -- the tools/stages.d pattern. A lane PR adds its own
// file and never edits a line another PR edits (the old single-line array conflicted every two lane PRs). Sorted by id; `note` is documentation only.
/** What is wrong with a lanes.d directory (empty = fine): unreadable JSON, an id that is not the file name, a lane without a mob. */
export function lanesProblems(dir = fileURLToPath(new URL('./lanes.d/', import.meta.url))) {
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    let l; try { l = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { bad.push(`${f}: not JSON`); continue; }
    if (!l || l.id !== f.slice(0, -5)) bad.push(`${f}: id must be the file name`);
    if (!l || typeof l.mob !== 'string' || !l.mob) bad.push(`${f}: no mob`);
  }
  return bad;
}
export function loadLanes(dir = fileURLToPath(new URL('./lanes.d/', import.meta.url))) {
  const bad = lanesProblems(dir); if (bad.length) throw new Error('lanes.d: ' + bad.join('; '));
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => { const { note, ...lane } = JSON.parse(readFileSync(join(dir, f), 'utf8')); return lane; });
}
export const LOCKSTEP_ONLY = loadLanes();
// #5361: blaze has proj:true -- runchase logs every fresh small_fireball (spawn tick, Pos, Motion) -> cases.blaze.proj[rep] = {tick:[], pos:[], motion:[]}.
// #5375: guardian = the lane flooded with water (FLOOR..FLOOR+1, walls 2 high): water move control, no ground navigation; runchase also logs Motion/Rotation/Air (cases[id].extra).
