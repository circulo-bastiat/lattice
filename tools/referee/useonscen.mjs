// useonscen.mjs — the USE-ON-BLOCK referee pack (infra I6, s146, 25 Sept 2026): a real player's right-click on a block with a tool
// or block item — hoe tilling, shovel paths + campfire dousing, axe stripping + wax scraping, honeycomb waxing, flint and steel on
// stone / TNT / a campfire, placing a torch, a slab onto a slab, a block into the player's own cell, shears carving a pumpkin, a
// glass bottle filled from water, and creative's no-damage hoe. Same harness as the BUCKET pack (runbucket.mjs --pack useon,
// bucketrefcheck.mjs --pack useon): the growbot at (0.5, F, 0.5) looking straight down, the target cell (0, F-1, 0), face UP,
// cursor (0.5, 1, 0.5). `via`: 'block' sends Player Block Placement (0x2e, what a client sends for any right-click on a block —
// block use, then ItemStack.useOnBlock); 'item' sends Use Item (0x2f, Item.use — its own raycast). Held keys carry damage (@n).
// Vanilla sources (.decomp): HoeItem.useOnBlock (TILLING_ACTIONS: dirt/grass_block/dirt_path -> farmland, coarse_dirt -> dirt;
// needs air above), ShovelItem.useOnBlock (PATH_STATES, needs air above; a lit campfire -> extinguished), AxeItem.useOnBlock
// (STRIPPED_BLOCKS keeping axis; waxed -> unwaxed; oxidised -> one step back), HoneycombItem.useOnBlock, FlintAndSteelItem
// (CampfireBlock.canBeLit, else fire on the face if AbstractFireBlock.canPlaceAt), TntBlock.onUse (flint -> primed, item damaged),
// BlockItem.place (World.canPlace: the new block's collision shape must not hit an entity — the player's own cell), SlabBlock
// .canReplace, PumpkinBlock.onUse (a vertical face turns to the player's horizontal facing, opposite), GlassBottleItem.use
// (SOURCE_ONLY raycast, water -> a water potion via ItemUsage.exchangeStack).
export const REPS = 3;
export const SCEN = [
  { id: 'hoe_dirt', via: 'block', item: 'iron_hoe', n: 1, set: { '-1': 'dirt' }, test: ['-1:farmland', '-1:dirt'] },
  { id: 'hoe_grass', via: 'block', item: 'iron_hoe', n: 1, set: { '-1': 'grass_block' }, test: ['-1:farmland', '-1:grass_block'] },
  { id: 'hoe_coarse_dirt', via: 'block', item: 'iron_hoe', n: 1, set: { '-1': 'coarse_dirt' }, test: ['-1:dirt', '-1:coarse_dirt'] },
  { id: 'hoe_dirt_creative', mode: 'creative', via: 'block', item: 'iron_hoe', n: 1, set: { '-1': 'dirt' }, test: ['-1:farmland'] },
  { id: 'shovel_grass', via: 'block', item: 'iron_shovel', n: 1, set: { '-1': 'grass_block' }, test: ['-1:dirt_path', '-1:grass_block'] },
  { id: 'shovel_lit_campfire', via: 'block', item: 'iron_shovel', n: 1, set: { '-1': 'campfire[lit=true]' }, test: ['-1:campfire[lit=false]', '-1:campfire[lit=true]'] },
  { id: 'axe_oak_log', via: 'block', item: 'iron_axe', n: 1, set: { '-1': 'oak_log[axis=y]' }, test: ['-1:stripped_oak_log[axis=y]', '-1:oak_log'] },
  { id: 'axe_oak_log_x', via: 'block', item: 'iron_axe', n: 1, set: { '-1': 'oak_log[axis=x]' }, test: ['-1:stripped_oak_log[axis=x]', '-1:oak_log'] },
  { id: 'axe_waxed_copper', via: 'block', item: 'iron_axe', n: 1, set: { '-1': 'waxed_copper_block' }, test: ['-1:copper_block', '-1:waxed_copper_block'] },
  { id: 'axe_exposed_copper', via: 'block', item: 'iron_axe', n: 1, set: { '-1': 'exposed_copper' }, test: ['-1:copper_block', '-1:exposed_copper'] },
  { id: 'honeycomb_copper', via: 'block', item: 'honeycomb', n: 4, set: { '-1': 'copper_block' }, test: ['-1:waxed_copper_block', '-1:copper_block'] },
  { id: 'flint_on_stone', via: 'block', item: 'flint_and_steel', n: 1, test: ['0:fire', '0:air'] },
  { id: 'flint_on_tnt', via: 'block', item: 'flint_and_steel', n: 1, set: { '-1': 'tnt' }, test: ['-1:air', '-1:tnt'], count: ['tnt'] },
  { id: 'flint_on_unlit_campfire', via: 'block', item: 'flint_and_steel', n: 1, set: { '-1': 'campfire[lit=false]' }, test: ['-1:campfire[lit=true]', '0:fire'] },
  { id: 'torch_on_stone', via: 'block', item: 'torch', n: 4, test: ['0:torch', '0:air'] },
  { id: 'slab_on_bottom_slab', via: 'block', item: 'oak_slab', n: 4, set: { '-1': 'oak_slab[type=bottom]' }, test: ['-1:oak_slab[type=double]', '-1:oak_slab[type=bottom]', '0:oak_slab'] },
  { id: 'cobblestone_into_own_cell', via: 'block', item: 'cobblestone', n: 4, test: ['0:cobblestone', '0:air'] },
  { id: 'shears_pumpkin_top', via: 'block', item: 'shears', n: 1, set: { '-1': 'pumpkin' }, test: ['-1:carved_pumpkin[facing=north]', '-1:carved_pumpkin', '-1:pumpkin'] },
  { id: 'glass_bottle_water', via: 'item', item: 'glass_bottle', n: 4, set: { '-1': 'water' }, gets: ['potion', 'glass_bottle'], test: ['-1:water'] },
];
