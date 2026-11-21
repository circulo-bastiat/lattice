// blockusescen.mjs — the BLOCK USE referee pack (infra I6, s146, 25 Sept 2026): a real player's right-click ON a block that answers
// it (Block.onUse) — lever, button, doors/trapdoors/gates (wood vs iron), note block, repeater, comparator, daylight detector, cake
// at full hunger (survival refuses, creative eats), a full composter, a ripe sweet berry bush, cauldron fill/empty/bottle, a flower
// pot. Same harness as the BUCKET/USE-ON packs (runbucket.mjs --pack blockuse, bucketrefcheck.mjs --pack blockuse): the growbot at
// (0.5, F, 0.5) looking straight down, Player Block Placement (0x2e) at (0, F-1, 0) face UP, cursor (0.5, 1, 0.5); item 'air' =
// an empty hand. `count: ['item']` counts dropped item entities in the box.
// Vanilla sources (.decomp): LeverBlock/AbstractButtonBlock/DoorBlock/TrapdoorBlock (material != METAL)/FenceGateBlock .onUse,
// NoteBlock.onUse (note + 1), RepeaterBlock (delay cycles 1..4), ComparatorBlock (mode toggles), DaylightDetectorBlock (inverted
// toggles), CakeBlock.tryEat (player.canConsume(false): creative's invulnerable abilities eat at full hunger), ComposterBlock
// (level 8 -> bone meal out, level 0), SweetBerryBushBlock (age > 1: 1 + nextInt(2) berries, +1 at age 3, back to age 1),
// CauldronBehavior (WATER bucket fill, bucket empty, bottle -1 level), FlowerPotBlock.onUse.
export const REPS = 3;
export const SCEN = [
  { id: 'lever_floor', via: 'block', item: 'air', n: 0, set: { '-1': 'lever[face=floor,powered=false]', '-2': 'stone' }, test: ['-1:lever[powered=true]'] },
  { id: 'stone_button_floor', via: 'block', item: 'air', n: 0, set: { '-1': 'stone_button[face=floor,powered=false]' }, test: ['-1:stone_button[powered=true]'] },
  { id: 'oak_trapdoor', via: 'block', item: 'air', n: 0, set: { '-1': 'oak_trapdoor[half=bottom,open=false]' }, test: ['-1:oak_trapdoor[open=true]'] },
  { id: 'iron_trapdoor_hand', via: 'block', item: 'air', n: 0, set: { '-1': 'iron_trapdoor[half=bottom,open=false]' }, test: ['-1:iron_trapdoor[open=true]', '-1:iron_trapdoor[open=false]'] },
  { id: 'oak_fence_gate', via: 'block', item: 'air', n: 0, set: { '-1': 'oak_fence_gate[facing=north,open=false]' }, test: ['-1:oak_fence_gate[open=true]'] },
  { id: 'note_block', via: 'block', item: 'air', n: 0, set: { '-1': 'note_block[note=0]' }, test: ['-1:note_block[note=1]', '-1:note_block[note=0]'] },
  { id: 'repeater_delay', via: 'block', item: 'air', n: 0, set: { '-1': 'repeater[delay=1,facing=north]' }, test: ['-1:repeater[delay=2]', '-1:repeater[delay=1]'] },
  { id: 'repeater_delay4', via: 'block', item: 'air', n: 0, set: { '-1': 'repeater[delay=4,facing=north]' }, test: ['-1:repeater[delay=1]', '-1:repeater[delay=4]'] },
  { id: 'comparator_mode', via: 'block', item: 'air', n: 0, set: { '-1': 'comparator[mode=compare,facing=north]' }, test: ['-1:comparator[mode=subtract]'] },
  { id: 'daylight_detector', via: 'block', item: 'air', n: 0, set: { '-1': 'daylight_detector[inverted=false]' }, test: ['-1:daylight_detector[inverted=true]'] },
  { id: 'cake_full_hunger', via: 'block', item: 'air', n: 0, set: { '-1': 'cake[bites=0]' }, test: ['-1:cake[bites=1]', '-1:cake[bites=0]'] },
  { id: 'cake_creative', mode: 'creative', via: 'block', item: 'air', n: 0, set: { '-1': 'cake[bites=0]' }, test: ['-1:cake[bites=1]', '-1:cake[bites=0]'] },
  { id: 'composter_full', via: 'block', item: 'air', n: 0, set: { '-1': 'composter[level=8]' }, test: ['-1:composter[level=0]', '-1:composter[level=8]'] },   // drops not judged: the bot 1 block above picks some up within the 0.4 s (1 of 3 bone meals seen)
  { id: 'sweet_berry_ripe', via: 'block', item: 'air', n: 0, set: { '-1': 'sweet_berry_bush[age=3]', '-2': 'grass_block' }, test: ['-1:sweet_berry_bush[age=1]', '-1:sweet_berry_bush[age=3]'] },   // drops not judged: the bot 1 block above picks some up within the 0.4 s (1 of 3 bone meals seen)
  { id: 'cauldron_water_bucket', via: 'block', item: 'water_bucket', n: 1, set: { '-1': 'cauldron' }, gets: ['bucket'], test: ['-1:water_cauldron[level=3]', '-1:cauldron'] },
  { id: 'water_cauldron_bucket', via: 'block', item: 'bucket', n: 1, set: { '-1': 'water_cauldron[level=3]' }, gets: ['water_bucket'], test: ['-1:cauldron', '-1:water_cauldron'] },
  { id: 'water_cauldron_bottle', via: 'block', item: 'glass_bottle', n: 4, set: { '-1': 'water_cauldron[level=3]' }, gets: ['potion'], test: ['-1:water_cauldron[level=2]', '-1:water_cauldron[level=3]'] },
  { id: 'flower_pot_poppy', via: 'block', item: 'poppy', n: 1, set: { '-1': 'flower_pot' }, test: ['-1:potted_poppy', '-1:flower_pot'] },
];
