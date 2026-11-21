// minescen.mjs — the MINING referee pack (infra I6, s147, 25 Sept 2026): a real player's LEFT-click join — break time, drops,
// tool wear, creative — judged end to end. Runner: runmine.mjs (golden mine.json). Check: minerefcheck.mjs.
// Harness: ONE growbot player at (0.5, F, 0.5) looking straight down; target cell (0, F-1, 0), face UP. Per rep the runner sends
// Player Digging START_DESTROY then STOP_DESTROY in the same instant (0x1a, status 0 then 2), which is what a client does for an
// instant break and, for a slower block, makes the SERVER finish the break itself on the exact tick its own progress reaches 1:
// .decomp ServerPlayerInteractionManager.processBlockBreakingAction (STOP: `delta * (ticks + 1) >= 0.7F` -> break now, else
// `failedToMine`) and .update() (`continueMining(...) >= 1.0F` -> tryBreakBlock). So `k` = server ticks from START to the break =
// 0 when delta >= 0.7, else ceil(1/delta) - 1 (float32). tryBreakBlock: `Item.canMine` (a sword in creative refuses),
// creative -> no drops and no wear, survival -> `ItemStack.postMine` (MiningToolItem/ShearsItem: 1 damage when hardness != 0;
// SwordItem: 2) and `Block.afterBreak` drops only when `player.canHarvest(state)`. Delta = `AbstractBlock.calcBlockBreakingDelta`
// -> PlayerEntity.getBlockBreakingSpeed (tool speed, + Efficiency level^2+1 when the tool is suitable, Haste x(1+0.2(amp+1)),
// Mining Fatigue x0.3^(amp+1), /5 in water without Aqua Affinity, /5 off the ground) / hardness / (canHarvest ? 30 : 100).
// Scene keys: block (set at F-1), item (+ ench [[id,lvl]]), effect [id, amplifier], mode, gets (item ids counted in the whole
// inventory after the break — the bot stands right above the drop and picks it up), wait (s, max per rep).
export const REPS = 3;
export const SCEN = [
  { id: 'dirt_hand', block: 'dirt', item: 'air', gets: ['dirt'] },
  { id: 'stone_hand', block: 'stone', item: 'air', gets: ['cobblestone', 'stone'], wait: 10 },
  { id: 'stone_wooden_pickaxe', block: 'stone', item: 'wooden_pickaxe', gets: ['cobblestone'] },
  { id: 'stone_iron_pickaxe', block: 'stone', item: 'iron_pickaxe', gets: ['cobblestone'] },
  { id: 'stone_iron_pickaxe_eff1', block: 'stone', item: 'iron_pickaxe', ench: [['efficiency', 1]], gets: ['cobblestone'] },
  { id: 'stone_diamond_pickaxe_eff5', block: 'stone', item: 'diamond_pickaxe', ench: [['efficiency', 5]], gets: ['cobblestone'] },
  { id: 'stone_iron_pickaxe_haste2', block: 'stone', item: 'iron_pickaxe', effect: ['haste', 1], gets: ['cobblestone'] },
  { id: 'stone_iron_pickaxe_fatigue1', block: 'stone', item: 'iron_pickaxe', effect: ['mining_fatigue', 0], gets: ['cobblestone'] },
  { id: 'iron_ore_wooden_pickaxe', block: 'iron_ore', item: 'wooden_pickaxe', gets: ['raw_iron', 'iron_ore'] },
  { id: 'iron_ore_stone_pickaxe', block: 'iron_ore', item: 'stone_pickaxe', gets: ['raw_iron', 'iron_ore'] },
  { id: 'diamond_ore_iron_pickaxe_silk', block: 'diamond_ore', item: 'iron_pickaxe', ench: [['silk_touch', 1]], gets: ['diamond', 'diamond_ore'] },
  { id: 'glass_hand', block: 'glass', item: 'air', gets: ['glass'] },
  { id: 'glass_silk_pickaxe', block: 'glass', item: 'iron_pickaxe', ench: [['silk_touch', 1]], gets: ['glass'] },
  { id: 'torch_iron_pickaxe', block: 'torch', item: 'iron_pickaxe', gets: ['torch'] },
  { id: 'dirt_iron_sword', block: 'dirt', item: 'iron_sword', gets: ['dirt'] },
  { id: 'cobweb_iron_sword', block: 'cobweb', item: 'iron_sword', gets: ['string', 'cobweb'] },
  { id: 'oak_leaves_shears', block: 'oak_leaves[persistent=true]', item: 'shears', gets: ['oak_leaves'] },
  { id: 'oak_log_iron_axe', block: 'oak_log', item: 'iron_axe', gets: ['oak_log'] },
  { id: 'creative_stone_hand', mode: 'creative', block: 'stone', item: 'air', gets: ['stone', 'cobblestone'] },
  { id: 'creative_stone_iron_pickaxe', mode: 'creative', block: 'stone', item: 'iron_pickaxe', gets: ['stone', 'cobblestone'] },
  { id: 'creative_stone_diamond_sword', mode: 'creative', block: 'stone', item: 'diamond_sword', gets: ['stone', 'cobblestone'], wait: 1.5 },
];
// "block[prop=v,...]" -> { name, props }
export function parseState(str) {
  const m = /^([a-z_]+)(?:\[(.*)\])?$/.exec(str);
  const props = {};
  if (m && m[2]) for (const kv of m[2].split(',')) { const [k, v] = kv.split('='); props[k] = v; }
  return { name: m ? m[1] : str, props };
}
