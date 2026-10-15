// phazardscen.mjs — the PLAYER HAZARDS + PLAYER FALLS referee pack (infra I6, s143, 25 Sept 2026), shared by runphazard.mjs
// (the real 1.18.2 server, one growbot PLAYER per lane) and phazardrefcheck.mjs (the engine's player through 14_player.js's
// own per-tick joins: Physics.tick -> updateArmor -> pendingFallDamage -> Survival.tick).
// Hazards (hazardscen.mjs's blocks, on a survival player): what the block does to a player standing IN/ON it, per tick —
// MagmaBlock.onSteppedOn, CampfireBlock / WitherRoseBlock / AbstractFireBlock .onEntityCollision (all reached through
// Entity.checkBlockCollision, which for a SERVER player runs inside ServerPlayNetworkHandler.onPlayerMove -> player.move, so the
// bot must keep sending Player Position packets and must confirm the join/tp teleports — growbot's `confirmTeleports`), lava
// (baseTick), powder snow (freeze), suffocation (baseTick isInsideWall). Plus Fire Protection IV (x4) in lava and fire.
// Falls: the bot's CLIENT drives the fall (a real client's physics: vy = (vy - 0.08) * 0.98 each tick, one Player Position per
// tick, onGround only on the landing packet); the server's fallDistance is what the client reported
// (Entity.fall / LivingEntity.computeFallDamage: ceil(fd - 3) * 1, then armour/Feather Falling/Protection).
export const REPS = 2;
export const PITCH = 5;
export const T = 200;
const SET = (mat, ench) => [`${mat}_boots`, `${mat}_leggings`, `${mat}_chestplate`, `${mat}_helmet`].map((it, slot) => ({ slot, item: it, ench }));
// floor = block under the feet cell; at = block IN the feet cell; head = block in the cell above; fall = start this many blocks
// above the floor's top (feet y = floor top + fall).
export const SCEN = [
  { id: 'p_magma', floor: 'magma_block', armor: [] },
  { id: 'p_campfire', floor: 'stone', at: 'campfire', armor: [] },
  { id: 'p_soul_campfire', floor: 'stone', at: 'soul_campfire', armor: [] },
  { id: 'p_unlit_campfire', floor: 'stone', at: 'campfire[lit=false]', armor: [] },
  { id: 'p_wither_rose', floor: 'grass_block', at: 'wither_rose', armor: [] },
  { id: 'p_fire', floor: 'netherrack', at: 'fire', armor: [] },
  { id: 'p_fire_fireprot4', floor: 'netherrack', at: 'fire', armor: SET('iron', [['fire_protection', 4]]) },
  { id: 'p_lava', floor: 'stone', at: 'lava', armor: [] },
  { id: 'p_lava_fireprot4', floor: 'stone', at: 'lava', armor: SET('iron', [['fire_protection', 4]]) },
  { id: 'p_powder_snow', floor: 'stone', at: 'powder_snow', head: 'powder_snow', armor: [] },
  { id: 'p_head_in_stone', floor: 'stone', head: 'stone', armor: [] },
  { id: 'p_stone_control', floor: 'stone', armor: [] },
  { id: 'fall5_bare', floor: 'stone', fall: 5, armor: [] },
  { id: 'fall10_bare', floor: 'stone', fall: 10, armor: [] },
  { id: 'fall23_bare', floor: 'stone', fall: 23, armor: [] },
  { id: 'fall10_ff4', floor: 'stone', fall: 10, armor: [{ slot: 0, item: 'iron_boots', ench: [['feather_falling', 4]] }] },
  { id: 'fall23_ff4', floor: 'stone', fall: 23, armor: [{ slot: 0, item: 'iron_boots', ench: [['feather_falling', 4]] }] },
  { id: 'fall23_iron', floor: 'stone', fall: 23, armor: SET('iron') },
  { id: 'fall23_prot4', floor: 'stone', fall: 23, armor: SET('iron', [['protection', 4]]) },
];
// The client-side fall a real 1.18.2 client performs with no input (LivingEntity.travel, no drag change in air):
// each tick y += vy, then vy = (vy - 0.08) * 0.98; stops at `floorTop`. Returns the per-tick feet y list, last = floorTop.
export function clientFall(startY, floorTop) {
  const ys = [];
  let y = startY, vy = 0;
  for (let t = 0; t < 400; t++) {
    vy = (vy - 0.08) * 0.98;
    y += vy;
    if (y <= floorTop) { ys.push(floorTop); break; }
    ys.push(y);
  }
  return ys;
}
