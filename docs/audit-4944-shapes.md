# #4944 — outline / interaction / visual shape audit (1.18.2, from the bytecode)

Vanilla = `tools/golden/blockshapes-1.18.2.tsv` (`node tools/extract-shapes.mjs` boots the real 1.18.2 classes and asks every state for getShape / getCollisionShape / getVisualShape / getInteractionShape). Boxes are x1024.

**Cause.** The registry blob carries only the *collision* shape, and the crosshair/wireframe read it as the outline (plus a hand list for vine, lichen and bamboo). Wherever vanilla's outline differs from its collision shape the engine was wrong: snow layers=1 (no collision) outlined as a full cube, fences/walls/gates 1.5 tall or empty, every no-collision block (torches, buttons, signs, banners, rails, plates, flowers, crops, corals, fire, ...) as a full cube, cactus, composter, lectern, big dripleaf, ...

**Fix.** `tools/shapetable.mjs` joins the vanilla table to engine states and ships only the OVERRIDES (outline / interaction / visual differing from collision) in `19_data.gen.js`; `Reg.outlineShape/interactionShape/visualShape` read them and `Ray` selects/outlines from them. Collision already matched vanilla in all 20,342 states.

**Check.** `tools/shapecheck.mjs` (stage `shapecheck`): all states x {outline, collision, visual, interaction, what the crosshair selects}; 0 mismatches, 5 breaks caught.

States where vanilla differs from collision (= were mismatched before this fix), per block:

| block | states | outline≠collision | interaction≠collision | visual≠collision | example state: vanilla outline vs collision |
|---|---|---|---|---|---|
| acacia_button | 24 | 24 | 0 | 0 | acacia_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| acacia_door | 64 | 0 | 64 | 0 |  |
| acacia_fence | 32 | 32 | 32 | 32 | acacia_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| acacia_fence_gate | 32 | 32 | 16 | 0 | acacia_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| acacia_leaves | 14 | 0 | 14 | 0 |  |
| acacia_log | 3 | 0 | 3 | 0 |  |
| acacia_planks | 1 | 0 | 1 | 0 |  |
| acacia_pressure_plate | 2 | 2 | 0 | 0 | acacia_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| acacia_sapling | 2 | 2 | 0 | 0 | acacia_sapling[stage=0]: 128,0,128,896,768,896 vs (empty) |
| acacia_sign | 32 | 32 | 0 | 0 | acacia_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| acacia_slab | 6 | 0 | 6 | 0 |  |
| acacia_stairs | 80 | 0 | 80 | 0 |  |
| acacia_trapdoor | 64 | 0 | 64 | 0 |  |
| acacia_wall_sign | 8 | 8 | 0 | 0 | acacia_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| acacia_wood | 3 | 0 | 3 | 0 |  |
| activator_rail | 24 | 24 | 0 | 0 | activator_rail[powered=true,shape=north_south,waterlogged=true]: 0,0,0,1024,128,1024 vs (empty) |
| allium | 1 | 1 | 0 | 0 | allium: 64,0,64,448,640,448 vs (empty) |
| amethyst_block | 1 | 0 | 1 | 0 |  |
| amethyst_cluster | 12 | 0 | 12 | 0 |  |
| ancient_debris | 1 | 0 | 1 | 0 |  |
| andesite | 1 | 0 | 1 | 0 |  |
| andesite_slab | 6 | 0 | 6 | 0 |  |
| andesite_stairs | 80 | 0 | 80 | 0 |  |
| andesite_wall | 324 | 322 | 322 | 0 | andesite_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| anvil | 4 | 0 | 4 | 0 |  |
| attached_melon_stem | 4 | 4 | 0 | 0 | attached_melon_stem[facing=north]: 384,0,0,640,640,640 vs (empty) |
| attached_pumpkin_stem | 4 | 4 | 0 | 0 | attached_pumpkin_stem[facing=north]: 384,0,0,640,640,640 vs (empty) |
| azalea | 1 | 0 | 1 | 0 |  |
| azalea_leaves | 14 | 0 | 14 | 0 |  |
| azure_bluet | 1 | 1 | 0 | 0 | azure_bluet: 64,0,64,448,640,448 vs (empty) |
| bamboo | 12 | 12 | 12 | 0 | bamboo[age=0,leaves=none,stage=0]: 64,0,64,448,1024,448 vs 160,0,160,352,1024,352 |
| bamboo_sapling | 1 | 1 | 0 | 0 | bamboo_sapling: 0,0,0,512,768,512 vs (empty) |
| barrel | 12 | 0 | 12 | 0 |  |
| barrier | 1 | 0 | 1 | 0 |  |
| basalt | 3 | 0 | 3 | 0 |  |
| beacon | 1 | 0 | 1 | 0 |  |
| bedrock | 1 | 0 | 1 | 0 |  |
| bee_nest | 24 | 0 | 24 | 0 |  |
| beehive | 24 | 0 | 24 | 0 |  |
| beetroots | 4 | 4 | 0 | 0 | beetroots[age=0]: 0,0,0,1024,128,1024 vs (empty) |
| bell | 32 | 0 | 32 | 0 |  |
| big_dripleaf | 32 | 32 | 24 | 0 | big_dripleaf[facing=north,tilt=none,waterlogged=true]: 5 boxes vs 0,704,0,1024,960,1024 |
| big_dripleaf_stem | 8 | 8 | 0 | 0 | big_dripleaf_stem[facing=north,waterlogged=true]: 320,0,576,704,1024,960 vs (empty) |
| birch_button | 24 | 24 | 0 | 0 | birch_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| birch_door | 64 | 0 | 64 | 0 |  |
| birch_fence | 32 | 32 | 32 | 32 | birch_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| birch_fence_gate | 32 | 32 | 16 | 0 | birch_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| birch_leaves | 14 | 0 | 14 | 0 |  |
| birch_log | 3 | 0 | 3 | 0 |  |
| birch_planks | 1 | 0 | 1 | 0 |  |
| birch_pressure_plate | 2 | 2 | 0 | 0 | birch_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| birch_sapling | 2 | 2 | 0 | 0 | birch_sapling[stage=0]: 128,0,128,896,768,896 vs (empty) |
| birch_sign | 32 | 32 | 0 | 0 | birch_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| birch_slab | 6 | 0 | 6 | 0 |  |
| birch_stairs | 80 | 0 | 80 | 0 |  |
| birch_trapdoor | 64 | 0 | 64 | 0 |  |
| birch_wall_sign | 8 | 8 | 0 | 0 | birch_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| birch_wood | 3 | 0 | 3 | 0 |  |
| black_banner | 16 | 16 | 0 | 0 | black_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| black_bed | 16 | 0 | 16 | 0 |  |
| black_candle | 16 | 0 | 16 | 0 |  |
| black_candle_cake | 2 | 0 | 2 | 0 |  |
| black_carpet | 1 | 0 | 1 | 0 |  |
| black_concrete | 1 | 0 | 1 | 0 |  |
| black_concrete_powder | 1 | 0 | 1 | 0 |  |
| black_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| black_shulker_box | 6 | 0 | 6 | 0 |  |
| black_stained_glass | 1 | 0 | 1 | 1 |  |
| black_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| black_terracotta | 1 | 0 | 1 | 0 |  |
| black_wall_banner | 4 | 4 | 0 | 0 | black_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| black_wool | 1 | 0 | 1 | 0 |  |
| blackstone | 1 | 0 | 1 | 0 |  |
| blackstone_slab | 6 | 0 | 6 | 0 |  |
| blackstone_stairs | 80 | 0 | 80 | 0 |  |
| blackstone_wall | 324 | 322 | 322 | 0 | blackstone_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| blast_furnace | 8 | 0 | 8 | 0 |  |
| blue_banner | 16 | 16 | 0 | 0 | blue_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| blue_bed | 16 | 0 | 16 | 0 |  |
| blue_candle | 16 | 0 | 16 | 0 |  |
| blue_candle_cake | 2 | 0 | 2 | 0 |  |
| blue_carpet | 1 | 0 | 1 | 0 |  |
| blue_concrete | 1 | 0 | 1 | 0 |  |
| blue_concrete_powder | 1 | 0 | 1 | 0 |  |
| blue_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| blue_ice | 1 | 0 | 1 | 0 |  |
| blue_orchid | 1 | 1 | 0 | 0 | blue_orchid: 64,0,64,448,640,448 vs (empty) |
| blue_shulker_box | 6 | 0 | 6 | 0 |  |
| blue_stained_glass | 1 | 0 | 1 | 1 |  |
| blue_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| blue_terracotta | 1 | 0 | 1 | 0 |  |
| blue_wall_banner | 4 | 4 | 0 | 0 | blue_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| blue_wool | 1 | 0 | 1 | 0 |  |
| bone_block | 3 | 0 | 3 | 0 |  |
| bookshelf | 1 | 0 | 1 | 0 |  |
| brain_coral | 2 | 2 | 0 | 0 | brain_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| brain_coral_block | 1 | 0 | 1 | 0 |  |
| brain_coral_fan | 2 | 2 | 0 | 0 | brain_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| brain_coral_wall_fan | 8 | 8 | 0 | 0 | brain_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| brewing_stand | 8 | 0 | 8 | 0 |  |
| brick_slab | 6 | 0 | 6 | 0 |  |
| brick_stairs | 80 | 0 | 80 | 0 |  |
| brick_wall | 324 | 322 | 322 | 0 | brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| bricks | 1 | 0 | 1 | 0 |  |
| brown_banner | 16 | 16 | 0 | 0 | brown_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| brown_bed | 16 | 0 | 16 | 0 |  |
| brown_candle | 16 | 0 | 16 | 0 |  |
| brown_candle_cake | 2 | 0 | 2 | 0 |  |
| brown_carpet | 1 | 0 | 1 | 0 |  |
| brown_concrete | 1 | 0 | 1 | 0 |  |
| brown_concrete_powder | 1 | 0 | 1 | 0 |  |
| brown_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| brown_mushroom | 1 | 1 | 0 | 0 | brown_mushroom: 320,0,320,704,384,704 vs (empty) |
| brown_mushroom_block | 64 | 0 | 64 | 0 |  |
| brown_shulker_box | 6 | 0 | 6 | 0 |  |
| brown_stained_glass | 1 | 0 | 1 | 1 |  |
| brown_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| brown_terracotta | 1 | 0 | 1 | 0 |  |
| brown_wall_banner | 4 | 4 | 0 | 0 | brown_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| brown_wool | 1 | 0 | 1 | 0 |  |
| bubble_coral | 2 | 2 | 0 | 0 | bubble_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| bubble_coral_block | 1 | 0 | 1 | 0 |  |
| bubble_coral_fan | 2 | 2 | 0 | 0 | bubble_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| bubble_coral_wall_fan | 8 | 8 | 0 | 0 | bubble_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| budding_amethyst | 1 | 0 | 1 | 0 |  |
| cactus | 16 | 16 | 16 | 0 | cactus[age=0]: 64,0,64,960,1024,960 vs 64,0,64,960,960,960 |
| cake | 7 | 0 | 7 | 0 |  |
| calcite | 1 | 0 | 1 | 0 |  |
| campfire | 32 | 0 | 32 | 0 |  |
| candle | 16 | 0 | 16 | 0 |  |
| candle_cake | 2 | 0 | 2 | 0 |  |
| carrots | 8 | 8 | 0 | 0 | carrots[age=0]: 0,0,0,1024,128,1024 vs (empty) |
| cartography_table | 1 | 0 | 1 | 0 |  |
| carved_pumpkin | 4 | 0 | 4 | 0 |  |
| cauldron | 1 | 0 | 1 | 0 |  |
| cave_vines | 52 | 52 | 0 | 0 | cave_vines[age=0,berries=true]: 64,0,64,960,1024,960 vs (empty) |
| cave_vines_plant | 2 | 2 | 0 | 0 | cave_vines_plant[berries=true]: 64,0,64,960,1024,960 vs (empty) |
| chain | 6 | 0 | 6 | 0 |  |
| chain_command_block | 12 | 0 | 12 | 0 |  |
| chest | 24 | 0 | 24 | 0 |  |
| chipped_anvil | 4 | 0 | 4 | 0 |  |
| chiseled_deepslate | 1 | 0 | 1 | 0 |  |
| chiseled_nether_bricks | 1 | 0 | 1 | 0 |  |
| chiseled_polished_blackstone | 1 | 0 | 1 | 0 |  |
| chiseled_quartz_block | 1 | 0 | 1 | 0 |  |
| chiseled_red_sandstone | 1 | 0 | 1 | 0 |  |
| chiseled_sandstone | 1 | 0 | 1 | 0 |  |
| chiseled_stone_bricks | 1 | 0 | 1 | 0 |  |
| chorus_flower | 6 | 0 | 6 | 0 |  |
| chorus_plant | 64 | 0 | 64 | 0 |  |
| clay | 1 | 0 | 1 | 0 |  |
| coal_block | 1 | 0 | 1 | 0 |  |
| coal_ore | 1 | 0 | 1 | 0 |  |
| coarse_dirt | 1 | 0 | 1 | 0 |  |
| cobbled_deepslate | 1 | 0 | 1 | 0 |  |
| cobbled_deepslate_slab | 6 | 0 | 6 | 0 |  |
| cobbled_deepslate_stairs | 80 | 0 | 80 | 0 |  |
| cobbled_deepslate_wall | 324 | 322 | 322 | 0 | cobbled_deepslate_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| cobblestone | 1 | 0 | 1 | 0 |  |
| cobblestone_slab | 6 | 0 | 6 | 0 |  |
| cobblestone_stairs | 80 | 0 | 80 | 0 |  |
| cobblestone_wall | 324 | 322 | 322 | 0 | cobblestone_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| cobweb | 1 | 1 | 0 | 0 | cobweb: 0,0,0,1024,1024,1024 vs (empty) |
| cocoa | 12 | 0 | 12 | 0 |  |
| command_block | 12 | 0 | 12 | 0 |  |
| comparator | 16 | 0 | 16 | 0 |  |
| composter | 9 | 8 | 9 | 0 | composter[level=1]: 5 boxes vs 5 boxes |
| conduit | 2 | 0 | 2 | 0 |  |
| copper_block | 1 | 0 | 1 | 0 |  |
| copper_ore | 1 | 0 | 1 | 0 |  |
| cornflower | 1 | 1 | 0 | 0 | cornflower: 64,0,64,448,640,448 vs (empty) |
| cracked_deepslate_bricks | 1 | 0 | 1 | 0 |  |
| cracked_deepslate_tiles | 1 | 0 | 1 | 0 |  |
| cracked_nether_bricks | 1 | 0 | 1 | 0 |  |
| cracked_polished_blackstone_bricks | 1 | 0 | 1 | 0 |  |
| cracked_stone_bricks | 1 | 0 | 1 | 0 |  |
| crafting_table | 1 | 0 | 1 | 0 |  |
| creeper_head | 16 | 0 | 16 | 0 |  |
| creeper_wall_head | 4 | 0 | 4 | 0 |  |
| crimson_button | 24 | 24 | 0 | 0 | crimson_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| crimson_door | 64 | 0 | 64 | 0 |  |
| crimson_fence | 32 | 32 | 32 | 32 | crimson_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| crimson_fence_gate | 32 | 32 | 16 | 0 | crimson_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| crimson_fungus | 1 | 1 | 0 | 0 | crimson_fungus: 256,0,256,768,576,768 vs (empty) |
| crimson_hyphae | 3 | 0 | 3 | 0 |  |
| crimson_nylium | 1 | 0 | 1 | 0 |  |
| crimson_planks | 1 | 0 | 1 | 0 |  |
| crimson_pressure_plate | 2 | 2 | 0 | 0 | crimson_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| crimson_roots | 1 | 1 | 0 | 0 | crimson_roots: 128,0,128,896,832,896 vs (empty) |
| crimson_sign | 32 | 32 | 0 | 0 | crimson_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| crimson_slab | 6 | 0 | 6 | 0 |  |
| crimson_stairs | 80 | 0 | 80 | 0 |  |
| crimson_stem | 3 | 0 | 3 | 0 |  |
| crimson_trapdoor | 64 | 0 | 64 | 0 |  |
| crimson_wall_sign | 8 | 8 | 0 | 0 | crimson_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| crying_obsidian | 1 | 0 | 1 | 0 |  |
| cut_copper | 1 | 0 | 1 | 0 |  |
| cut_copper_slab | 6 | 0 | 6 | 0 |  |
| cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| cut_red_sandstone | 1 | 0 | 1 | 0 |  |
| cut_red_sandstone_slab | 6 | 0 | 6 | 0 |  |
| cut_sandstone | 1 | 0 | 1 | 0 |  |
| cut_sandstone_slab | 6 | 0 | 6 | 0 |  |
| cyan_banner | 16 | 16 | 0 | 0 | cyan_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| cyan_bed | 16 | 0 | 16 | 0 |  |
| cyan_candle | 16 | 0 | 16 | 0 |  |
| cyan_candle_cake | 2 | 0 | 2 | 0 |  |
| cyan_carpet | 1 | 0 | 1 | 0 |  |
| cyan_concrete | 1 | 0 | 1 | 0 |  |
| cyan_concrete_powder | 1 | 0 | 1 | 0 |  |
| cyan_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| cyan_shulker_box | 6 | 0 | 6 | 0 |  |
| cyan_stained_glass | 1 | 0 | 1 | 1 |  |
| cyan_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| cyan_terracotta | 1 | 0 | 1 | 0 |  |
| cyan_wall_banner | 4 | 4 | 0 | 0 | cyan_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| cyan_wool | 1 | 0 | 1 | 0 |  |
| damaged_anvil | 4 | 0 | 4 | 0 |  |
| dandelion | 1 | 1 | 0 | 0 | dandelion: 64,0,64,448,640,448 vs (empty) |
| dark_oak_button | 24 | 24 | 0 | 0 | dark_oak_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| dark_oak_door | 64 | 0 | 64 | 0 |  |
| dark_oak_fence | 32 | 32 | 32 | 32 | dark_oak_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| dark_oak_fence_gate | 32 | 32 | 16 | 0 | dark_oak_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| dark_oak_leaves | 14 | 0 | 14 | 0 |  |
| dark_oak_log | 3 | 0 | 3 | 0 |  |
| dark_oak_planks | 1 | 0 | 1 | 0 |  |
| dark_oak_pressure_plate | 2 | 2 | 0 | 0 | dark_oak_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| dark_oak_sapling | 2 | 2 | 0 | 0 | dark_oak_sapling[stage=0]: 128,0,128,896,768,896 vs (empty) |
| dark_oak_sign | 32 | 32 | 0 | 0 | dark_oak_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| dark_oak_slab | 6 | 0 | 6 | 0 |  |
| dark_oak_stairs | 80 | 0 | 80 | 0 |  |
| dark_oak_trapdoor | 64 | 0 | 64 | 0 |  |
| dark_oak_wall_sign | 8 | 8 | 0 | 0 | dark_oak_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| dark_oak_wood | 3 | 0 | 3 | 0 |  |
| dark_prismarine | 1 | 0 | 1 | 0 |  |
| dark_prismarine_slab | 6 | 0 | 6 | 0 |  |
| dark_prismarine_stairs | 80 | 0 | 80 | 0 |  |
| daylight_detector | 32 | 0 | 32 | 0 |  |
| dead_brain_coral | 2 | 2 | 0 | 0 | dead_brain_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| dead_brain_coral_block | 1 | 0 | 1 | 0 |  |
| dead_brain_coral_fan | 2 | 2 | 0 | 0 | dead_brain_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| dead_brain_coral_wall_fan | 8 | 8 | 0 | 0 | dead_brain_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| dead_bubble_coral | 2 | 2 | 0 | 0 | dead_bubble_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| dead_bubble_coral_block | 1 | 0 | 1 | 0 |  |
| dead_bubble_coral_fan | 2 | 2 | 0 | 0 | dead_bubble_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| dead_bubble_coral_wall_fan | 8 | 8 | 0 | 0 | dead_bubble_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| dead_bush | 1 | 1 | 0 | 0 | dead_bush: 128,0,128,896,832,896 vs (empty) |
| dead_fire_coral | 2 | 2 | 0 | 0 | dead_fire_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| dead_fire_coral_block | 1 | 0 | 1 | 0 |  |
| dead_fire_coral_fan | 2 | 2 | 0 | 0 | dead_fire_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| dead_fire_coral_wall_fan | 8 | 8 | 0 | 0 | dead_fire_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| dead_horn_coral | 2 | 2 | 0 | 0 | dead_horn_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| dead_horn_coral_block | 1 | 0 | 1 | 0 |  |
| dead_horn_coral_fan | 2 | 2 | 0 | 0 | dead_horn_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| dead_horn_coral_wall_fan | 8 | 8 | 0 | 0 | dead_horn_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| dead_tube_coral | 2 | 2 | 0 | 0 | dead_tube_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| dead_tube_coral_block | 1 | 0 | 1 | 0 |  |
| dead_tube_coral_fan | 2 | 2 | 0 | 0 | dead_tube_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| dead_tube_coral_wall_fan | 8 | 8 | 0 | 0 | dead_tube_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| deepslate | 3 | 0 | 3 | 0 |  |
| deepslate_brick_slab | 6 | 0 | 6 | 0 |  |
| deepslate_brick_stairs | 80 | 0 | 80 | 0 |  |
| deepslate_brick_wall | 324 | 322 | 322 | 0 | deepslate_brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| deepslate_bricks | 1 | 0 | 1 | 0 |  |
| deepslate_coal_ore | 1 | 0 | 1 | 0 |  |
| deepslate_copper_ore | 1 | 0 | 1 | 0 |  |
| deepslate_diamond_ore | 1 | 0 | 1 | 0 |  |
| deepslate_emerald_ore | 1 | 0 | 1 | 0 |  |
| deepslate_gold_ore | 1 | 0 | 1 | 0 |  |
| deepslate_iron_ore | 1 | 0 | 1 | 0 |  |
| deepslate_lapis_ore | 1 | 0 | 1 | 0 |  |
| deepslate_redstone_ore | 2 | 0 | 2 | 0 |  |
| deepslate_tile_slab | 6 | 0 | 6 | 0 |  |
| deepslate_tile_stairs | 80 | 0 | 80 | 0 |  |
| deepslate_tile_wall | 324 | 322 | 322 | 0 | deepslate_tile_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| deepslate_tiles | 1 | 0 | 1 | 0 |  |
| detector_rail | 24 | 24 | 0 | 0 | detector_rail[powered=true,shape=north_south,waterlogged=true]: 0,0,0,1024,128,1024 vs (empty) |
| diamond_block | 1 | 0 | 1 | 0 |  |
| diamond_ore | 1 | 0 | 1 | 0 |  |
| diorite | 1 | 0 | 1 | 0 |  |
| diorite_slab | 6 | 0 | 6 | 0 |  |
| diorite_stairs | 80 | 0 | 80 | 0 |  |
| diorite_wall | 324 | 322 | 322 | 0 | diorite_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| dirt | 1 | 0 | 1 | 0 |  |
| dirt_path | 1 | 0 | 1 | 0 |  |
| dispenser | 12 | 0 | 12 | 0 |  |
| dragon_egg | 1 | 0 | 1 | 0 |  |
| dragon_head | 16 | 0 | 16 | 0 |  |
| dragon_wall_head | 4 | 0 | 4 | 0 |  |
| dried_kelp_block | 1 | 0 | 1 | 0 |  |
| dripstone_block | 1 | 0 | 1 | 0 |  |
| dropper | 12 | 0 | 12 | 0 |  |
| emerald_block | 1 | 0 | 1 | 0 |  |
| emerald_ore | 1 | 0 | 1 | 0 |  |
| enchanting_table | 1 | 0 | 1 | 0 |  |
| end_gateway | 1 | 1 | 0 | 0 | end_gateway: 0,0,0,1024,1024,1024 vs (empty) |
| end_portal | 1 | 1 | 0 | 0 | end_portal: 0,384,0,1024,768,1024 vs (empty) |
| end_portal_frame | 8 | 0 | 8 | 0 |  |
| end_rod | 6 | 0 | 6 | 0 |  |
| end_stone | 1 | 0 | 1 | 0 |  |
| end_stone_brick_slab | 6 | 0 | 6 | 0 |  |
| end_stone_brick_stairs | 80 | 0 | 80 | 0 |  |
| end_stone_brick_wall | 324 | 322 | 322 | 0 | end_stone_brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| end_stone_bricks | 1 | 0 | 1 | 0 |  |
| ender_chest | 8 | 0 | 8 | 0 |  |
| exposed_copper | 1 | 0 | 1 | 0 |  |
| exposed_cut_copper | 1 | 0 | 1 | 0 |  |
| exposed_cut_copper_slab | 6 | 0 | 6 | 0 |  |
| exposed_cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| farmland | 8 | 0 | 8 | 0 |  |
| fern | 1 | 1 | 0 | 0 | fern: 128,0,128,896,832,896 vs (empty) |
| fire | 512 | 512 | 0 | 0 | fire[age=0,east=true,north=true,south=true,up=true,west=true]: 5 boxes vs (empty) |
| fire_coral | 2 | 2 | 0 | 0 | fire_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| fire_coral_block | 1 | 0 | 1 | 0 |  |
| fire_coral_fan | 2 | 2 | 0 | 0 | fire_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| fire_coral_wall_fan | 8 | 8 | 0 | 0 | fire_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| fletching_table | 1 | 0 | 1 | 0 |  |
| flower_pot | 1 | 0 | 1 | 0 |  |
| flowering_azalea | 1 | 0 | 1 | 0 |  |
| flowering_azalea_leaves | 14 | 0 | 14 | 0 |  |
| frosted_ice | 4 | 0 | 4 | 0 |  |
| furnace | 8 | 0 | 8 | 0 |  |
| gilded_blackstone | 1 | 0 | 1 | 0 |  |
| glass | 1 | 0 | 1 | 1 |  |
| glass_pane | 32 | 0 | 32 | 32 |  |
| glow_lichen | 128 | 128 | 0 | 0 | glow_lichen[down=true,east=true,north=true,south=true,up=true,waterlogged=true,west=true]: 6 boxes vs (empty) |
| glowstone | 1 | 0 | 1 | 0 |  |
| gold_block | 1 | 0 | 1 | 0 |  |
| gold_ore | 1 | 0 | 1 | 0 |  |
| granite | 1 | 0 | 1 | 0 |  |
| granite_slab | 6 | 0 | 6 | 0 |  |
| granite_stairs | 80 | 0 | 80 | 0 |  |
| granite_wall | 324 | 322 | 322 | 0 | granite_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| grass | 1 | 1 | 0 | 0 | grass: 128,0,128,896,832,896 vs (empty) |
| grass_block | 2 | 0 | 2 | 0 |  |
| gravel | 1 | 0 | 1 | 0 |  |
| gray_banner | 16 | 16 | 0 | 0 | gray_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| gray_bed | 16 | 0 | 16 | 0 |  |
| gray_candle | 16 | 0 | 16 | 0 |  |
| gray_candle_cake | 2 | 0 | 2 | 0 |  |
| gray_carpet | 1 | 0 | 1 | 0 |  |
| gray_concrete | 1 | 0 | 1 | 0 |  |
| gray_concrete_powder | 1 | 0 | 1 | 0 |  |
| gray_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| gray_shulker_box | 6 | 0 | 6 | 0 |  |
| gray_stained_glass | 1 | 0 | 1 | 1 |  |
| gray_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| gray_terracotta | 1 | 0 | 1 | 0 |  |
| gray_wall_banner | 4 | 4 | 0 | 0 | gray_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| gray_wool | 1 | 0 | 1 | 0 |  |
| green_banner | 16 | 16 | 0 | 0 | green_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| green_bed | 16 | 0 | 16 | 0 |  |
| green_candle | 16 | 0 | 16 | 0 |  |
| green_candle_cake | 2 | 0 | 2 | 0 |  |
| green_carpet | 1 | 0 | 1 | 0 |  |
| green_concrete | 1 | 0 | 1 | 0 |  |
| green_concrete_powder | 1 | 0 | 1 | 0 |  |
| green_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| green_shulker_box | 6 | 0 | 6 | 0 |  |
| green_stained_glass | 1 | 0 | 1 | 1 |  |
| green_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| green_terracotta | 1 | 0 | 1 | 0 |  |
| green_wall_banner | 4 | 4 | 0 | 0 | green_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| green_wool | 1 | 0 | 1 | 0 |  |
| grindstone | 12 | 0 | 12 | 0 |  |
| hanging_roots | 2 | 2 | 0 | 0 | hanging_roots[waterlogged=true]: 128,640,128,896,1024,896 vs (empty) |
| hay_block | 3 | 0 | 3 | 0 |  |
| heavy_weighted_pressure_plate | 16 | 16 | 0 | 0 | heavy_weighted_pressure_plate[power=0]: 64,0,64,960,64,960 vs (empty) |
| honey_block | 1 | 1 | 1 | 0 | honey_block: 0,0,0,1024,1024,1024 vs 64,0,64,960,960,960 |
| honeycomb_block | 1 | 0 | 1 | 0 |  |
| hopper | 10 | 0 | 10 | 0 |  |
| horn_coral | 2 | 2 | 0 | 0 | horn_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| horn_coral_block | 1 | 0 | 1 | 0 |  |
| horn_coral_fan | 2 | 2 | 0 | 0 | horn_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| horn_coral_wall_fan | 8 | 8 | 0 | 0 | horn_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| ice | 1 | 0 | 1 | 0 |  |
| infested_chiseled_stone_bricks | 1 | 0 | 1 | 0 |  |
| infested_cobblestone | 1 | 0 | 1 | 0 |  |
| infested_cracked_stone_bricks | 1 | 0 | 1 | 0 |  |
| infested_deepslate | 3 | 0 | 3 | 0 |  |
| infested_mossy_stone_bricks | 1 | 0 | 1 | 0 |  |
| infested_stone | 1 | 0 | 1 | 0 |  |
| infested_stone_bricks | 1 | 0 | 1 | 0 |  |
| iron_bars | 32 | 0 | 32 | 32 |  |
| iron_block | 1 | 0 | 1 | 0 |  |
| iron_door | 64 | 0 | 64 | 0 |  |
| iron_ore | 1 | 0 | 1 | 0 |  |
| iron_trapdoor | 64 | 0 | 64 | 0 |  |
| jack_o_lantern | 4 | 0 | 4 | 0 |  |
| jigsaw | 12 | 0 | 12 | 0 |  |
| jukebox | 2 | 0 | 2 | 0 |  |
| jungle_button | 24 | 24 | 0 | 0 | jungle_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| jungle_door | 64 | 0 | 64 | 0 |  |
| jungle_fence | 32 | 32 | 32 | 32 | jungle_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| jungle_fence_gate | 32 | 32 | 16 | 0 | jungle_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| jungle_leaves | 14 | 0 | 14 | 0 |  |
| jungle_log | 3 | 0 | 3 | 0 |  |
| jungle_planks | 1 | 0 | 1 | 0 |  |
| jungle_pressure_plate | 2 | 2 | 0 | 0 | jungle_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| jungle_sapling | 2 | 2 | 0 | 0 | jungle_sapling[stage=0]: 128,0,128,896,768,896 vs (empty) |
| jungle_sign | 32 | 32 | 0 | 0 | jungle_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| jungle_slab | 6 | 0 | 6 | 0 |  |
| jungle_stairs | 80 | 0 | 80 | 0 |  |
| jungle_trapdoor | 64 | 0 | 64 | 0 |  |
| jungle_wall_sign | 8 | 8 | 0 | 0 | jungle_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| jungle_wood | 3 | 0 | 3 | 0 |  |
| kelp | 26 | 26 | 0 | 0 | kelp[age=0]: 0,0,0,1024,576,1024 vs (empty) |
| kelp_plant | 1 | 1 | 0 | 0 | kelp_plant: 0,0,0,1024,1024,1024 vs (empty) |
| ladder | 8 | 0 | 8 | 0 |  |
| lantern | 4 | 0 | 4 | 0 |  |
| lapis_block | 1 | 0 | 1 | 0 |  |
| lapis_ore | 1 | 0 | 1 | 0 |  |
| large_amethyst_bud | 12 | 0 | 12 | 0 |  |
| large_fern | 2 | 2 | 0 | 0 | large_fern[half=upper]: 0,0,0,1024,1024,1024 vs (empty) |
| lava_cauldron | 1 | 0 | 1 | 0 |  |
| lectern | 16 | 16 | 16 | 0 | lectern[facing=north,has_book=true,powered=true]: 9 boxes vs 0,0,0,1024,128,1024;256,128,256,768,896,768 |
| lever | 24 | 24 | 0 | 0 | lever[face=floor,facing=north,powered=true]: 320,0,256,704,384,768 vs (empty) |
| light_blue_banner | 16 | 16 | 0 | 0 | light_blue_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| light_blue_bed | 16 | 0 | 16 | 0 |  |
| light_blue_candle | 16 | 0 | 16 | 0 |  |
| light_blue_candle_cake | 2 | 0 | 2 | 0 |  |
| light_blue_carpet | 1 | 0 | 1 | 0 |  |
| light_blue_concrete | 1 | 0 | 1 | 0 |  |
| light_blue_concrete_powder | 1 | 0 | 1 | 0 |  |
| light_blue_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| light_blue_shulker_box | 6 | 0 | 6 | 0 |  |
| light_blue_stained_glass | 1 | 0 | 1 | 1 |  |
| light_blue_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| light_blue_terracotta | 1 | 0 | 1 | 0 |  |
| light_blue_wall_banner | 4 | 4 | 0 | 0 | light_blue_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| light_blue_wool | 1 | 0 | 1 | 0 |  |
| light_gray_banner | 16 | 16 | 0 | 0 | light_gray_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| light_gray_bed | 16 | 0 | 16 | 0 |  |
| light_gray_candle | 16 | 0 | 16 | 0 |  |
| light_gray_candle_cake | 2 | 0 | 2 | 0 |  |
| light_gray_carpet | 1 | 0 | 1 | 0 |  |
| light_gray_concrete | 1 | 0 | 1 | 0 |  |
| light_gray_concrete_powder | 1 | 0 | 1 | 0 |  |
| light_gray_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| light_gray_shulker_box | 6 | 0 | 6 | 0 |  |
| light_gray_stained_glass | 1 | 0 | 1 | 1 |  |
| light_gray_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| light_gray_terracotta | 1 | 0 | 1 | 0 |  |
| light_gray_wall_banner | 4 | 4 | 0 | 0 | light_gray_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| light_gray_wool | 1 | 0 | 1 | 0 |  |
| light_weighted_pressure_plate | 16 | 16 | 0 | 0 | light_weighted_pressure_plate[power=0]: 64,0,64,960,64,960 vs (empty) |
| lightning_rod | 24 | 0 | 24 | 0 |  |
| lilac | 2 | 2 | 0 | 0 | lilac[half=upper]: 0,0,0,1024,1024,1024 vs (empty) |
| lily_of_the_valley | 1 | 1 | 0 | 0 | lily_of_the_valley: 64,0,64,448,640,448 vs (empty) |
| lily_pad | 1 | 0 | 1 | 0 |  |
| lime_banner | 16 | 16 | 0 | 0 | lime_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| lime_bed | 16 | 0 | 16 | 0 |  |
| lime_candle | 16 | 0 | 16 | 0 |  |
| lime_candle_cake | 2 | 0 | 2 | 0 |  |
| lime_carpet | 1 | 0 | 1 | 0 |  |
| lime_concrete | 1 | 0 | 1 | 0 |  |
| lime_concrete_powder | 1 | 0 | 1 | 0 |  |
| lime_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| lime_shulker_box | 6 | 0 | 6 | 0 |  |
| lime_stained_glass | 1 | 0 | 1 | 1 |  |
| lime_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| lime_terracotta | 1 | 0 | 1 | 0 |  |
| lime_wall_banner | 4 | 4 | 0 | 0 | lime_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| lime_wool | 1 | 0 | 1 | 0 |  |
| lodestone | 1 | 0 | 1 | 0 |  |
| loom | 4 | 0 | 4 | 0 |  |
| magenta_banner | 16 | 16 | 0 | 0 | magenta_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| magenta_bed | 16 | 0 | 16 | 0 |  |
| magenta_candle | 16 | 0 | 16 | 0 |  |
| magenta_candle_cake | 2 | 0 | 2 | 0 |  |
| magenta_carpet | 1 | 0 | 1 | 0 |  |
| magenta_concrete | 1 | 0 | 1 | 0 |  |
| magenta_concrete_powder | 1 | 0 | 1 | 0 |  |
| magenta_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| magenta_shulker_box | 6 | 0 | 6 | 0 |  |
| magenta_stained_glass | 1 | 0 | 1 | 1 |  |
| magenta_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| magenta_terracotta | 1 | 0 | 1 | 0 |  |
| magenta_wall_banner | 4 | 4 | 0 | 0 | magenta_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| magenta_wool | 1 | 0 | 1 | 0 |  |
| magma_block | 1 | 0 | 1 | 0 |  |
| medium_amethyst_bud | 12 | 0 | 12 | 0 |  |
| melon | 1 | 0 | 1 | 0 |  |
| melon_stem | 8 | 8 | 0 | 0 | melon_stem[age=0]: 448,0,448,576,128,576 vs (empty) |
| moss_block | 1 | 0 | 1 | 0 |  |
| moss_carpet | 1 | 0 | 1 | 0 |  |
| mossy_cobblestone | 1 | 0 | 1 | 0 |  |
| mossy_cobblestone_slab | 6 | 0 | 6 | 0 |  |
| mossy_cobblestone_stairs | 80 | 0 | 80 | 0 |  |
| mossy_cobblestone_wall | 324 | 322 | 322 | 0 | mossy_cobblestone_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| mossy_stone_brick_slab | 6 | 0 | 6 | 0 |  |
| mossy_stone_brick_stairs | 80 | 0 | 80 | 0 |  |
| mossy_stone_brick_wall | 324 | 322 | 322 | 0 | mossy_stone_brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| mossy_stone_bricks | 1 | 0 | 1 | 0 |  |
| mushroom_stem | 64 | 0 | 64 | 0 |  |
| mycelium | 2 | 0 | 2 | 0 |  |
| nether_brick_fence | 32 | 32 | 32 | 32 | nether_brick_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| nether_brick_slab | 6 | 0 | 6 | 0 |  |
| nether_brick_stairs | 80 | 0 | 80 | 0 |  |
| nether_brick_wall | 324 | 322 | 322 | 0 | nether_brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| nether_bricks | 1 | 0 | 1 | 0 |  |
| nether_gold_ore | 1 | 0 | 1 | 0 |  |
| nether_portal | 2 | 2 | 0 | 0 | nether_portal[axis=x]: 0,0,384,1024,1024,640 vs (empty) |
| nether_quartz_ore | 1 | 0 | 1 | 0 |  |
| nether_sprouts | 1 | 1 | 0 | 0 | nether_sprouts: 128,0,128,896,192,896 vs (empty) |
| nether_wart | 4 | 4 | 0 | 0 | nether_wart[age=0]: 0,0,0,1024,320,1024 vs (empty) |
| nether_wart_block | 1 | 0 | 1 | 0 |  |
| netherite_block | 1 | 0 | 1 | 0 |  |
| netherrack | 1 | 0 | 1 | 0 |  |
| note_block | 800 | 0 | 800 | 0 |  |
| oak_button | 24 | 24 | 0 | 0 | oak_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| oak_door | 64 | 0 | 64 | 0 |  |
| oak_fence | 32 | 32 | 32 | 32 | oak_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| oak_fence_gate | 32 | 32 | 16 | 0 | oak_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| oak_leaves | 14 | 0 | 14 | 0 |  |
| oak_log | 3 | 0 | 3 | 0 |  |
| oak_planks | 1 | 0 | 1 | 0 |  |
| oak_pressure_plate | 2 | 2 | 0 | 0 | oak_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| oak_sapling | 2 | 2 | 0 | 0 | oak_sapling[stage=0]: 128,0,128,896,768,896 vs (empty) |
| oak_sign | 32 | 32 | 0 | 0 | oak_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| oak_slab | 6 | 0 | 6 | 0 |  |
| oak_stairs | 80 | 0 | 80 | 0 |  |
| oak_trapdoor | 64 | 0 | 64 | 0 |  |
| oak_wall_sign | 8 | 8 | 0 | 0 | oak_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| oak_wood | 3 | 0 | 3 | 0 |  |
| observer | 12 | 0 | 12 | 0 |  |
| obsidian | 1 | 0 | 1 | 0 |  |
| orange_banner | 16 | 16 | 0 | 0 | orange_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| orange_bed | 16 | 0 | 16 | 0 |  |
| orange_candle | 16 | 0 | 16 | 0 |  |
| orange_candle_cake | 2 | 0 | 2 | 0 |  |
| orange_carpet | 1 | 0 | 1 | 0 |  |
| orange_concrete | 1 | 0 | 1 | 0 |  |
| orange_concrete_powder | 1 | 0 | 1 | 0 |  |
| orange_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| orange_shulker_box | 6 | 0 | 6 | 0 |  |
| orange_stained_glass | 1 | 0 | 1 | 1 |  |
| orange_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| orange_terracotta | 1 | 0 | 1 | 0 |  |
| orange_tulip | 1 | 1 | 0 | 0 | orange_tulip: 64,0,64,448,640,448 vs (empty) |
| orange_wall_banner | 4 | 4 | 0 | 0 | orange_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| orange_wool | 1 | 0 | 1 | 0 |  |
| oxeye_daisy | 1 | 1 | 0 | 0 | oxeye_daisy: 64,0,64,448,640,448 vs (empty) |
| oxidized_copper | 1 | 0 | 1 | 0 |  |
| oxidized_cut_copper | 1 | 0 | 1 | 0 |  |
| oxidized_cut_copper_slab | 6 | 0 | 6 | 0 |  |
| oxidized_cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| packed_ice | 1 | 0 | 1 | 0 |  |
| peony | 2 | 2 | 0 | 0 | peony[half=upper]: 0,0,0,1024,1024,1024 vs (empty) |
| petrified_oak_slab | 6 | 0 | 6 | 0 |  |
| pink_banner | 16 | 16 | 0 | 0 | pink_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| pink_bed | 16 | 0 | 16 | 0 |  |
| pink_candle | 16 | 0 | 16 | 0 |  |
| pink_candle_cake | 2 | 0 | 2 | 0 |  |
| pink_carpet | 1 | 0 | 1 | 0 |  |
| pink_concrete | 1 | 0 | 1 | 0 |  |
| pink_concrete_powder | 1 | 0 | 1 | 0 |  |
| pink_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| pink_shulker_box | 6 | 0 | 6 | 0 |  |
| pink_stained_glass | 1 | 0 | 1 | 1 |  |
| pink_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| pink_terracotta | 1 | 0 | 1 | 0 |  |
| pink_tulip | 1 | 1 | 0 | 0 | pink_tulip: 64,0,64,448,640,448 vs (empty) |
| pink_wall_banner | 4 | 4 | 0 | 0 | pink_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| pink_wool | 1 | 0 | 1 | 0 |  |
| piston | 12 | 0 | 12 | 0 |  |
| piston_head | 24 | 0 | 24 | 0 |  |
| player_head | 16 | 0 | 16 | 0 |  |
| player_wall_head | 4 | 0 | 4 | 0 |  |
| podzol | 2 | 0 | 2 | 0 |  |
| pointed_dripstone | 20 | 0 | 20 | 0 |  |
| polished_andesite | 1 | 0 | 1 | 0 |  |
| polished_andesite_slab | 6 | 0 | 6 | 0 |  |
| polished_andesite_stairs | 80 | 0 | 80 | 0 |  |
| polished_basalt | 3 | 0 | 3 | 0 |  |
| polished_blackstone | 1 | 0 | 1 | 0 |  |
| polished_blackstone_brick_slab | 6 | 0 | 6 | 0 |  |
| polished_blackstone_brick_stairs | 80 | 0 | 80 | 0 |  |
| polished_blackstone_brick_wall | 324 | 322 | 322 | 0 | polished_blackstone_brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| polished_blackstone_bricks | 1 | 0 | 1 | 0 |  |
| polished_blackstone_button | 24 | 24 | 0 | 0 | polished_blackstone_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| polished_blackstone_pressure_plate | 2 | 2 | 0 | 0 | polished_blackstone_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| polished_blackstone_slab | 6 | 0 | 6 | 0 |  |
| polished_blackstone_stairs | 80 | 0 | 80 | 0 |  |
| polished_blackstone_wall | 324 | 322 | 322 | 0 | polished_blackstone_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| polished_deepslate | 1 | 0 | 1 | 0 |  |
| polished_deepslate_slab | 6 | 0 | 6 | 0 |  |
| polished_deepslate_stairs | 80 | 0 | 80 | 0 |  |
| polished_deepslate_wall | 324 | 322 | 322 | 0 | polished_deepslate_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| polished_diorite | 1 | 0 | 1 | 0 |  |
| polished_diorite_slab | 6 | 0 | 6 | 0 |  |
| polished_diorite_stairs | 80 | 0 | 80 | 0 |  |
| polished_granite | 1 | 0 | 1 | 0 |  |
| polished_granite_slab | 6 | 0 | 6 | 0 |  |
| polished_granite_stairs | 80 | 0 | 80 | 0 |  |
| poppy | 1 | 1 | 0 | 0 | poppy: 64,0,64,448,640,448 vs (empty) |
| potatoes | 8 | 8 | 0 | 0 | potatoes[age=0]: 0,0,0,1024,128,1024 vs (empty) |
| potted_acacia_sapling | 1 | 0 | 1 | 0 |  |
| potted_allium | 1 | 0 | 1 | 0 |  |
| potted_azalea_bush | 1 | 0 | 1 | 0 |  |
| potted_azure_bluet | 1 | 0 | 1 | 0 |  |
| potted_bamboo | 1 | 0 | 1 | 0 |  |
| potted_birch_sapling | 1 | 0 | 1 | 0 |  |
| potted_blue_orchid | 1 | 0 | 1 | 0 |  |
| potted_brown_mushroom | 1 | 0 | 1 | 0 |  |
| potted_cactus | 1 | 0 | 1 | 0 |  |
| potted_cornflower | 1 | 0 | 1 | 0 |  |
| potted_crimson_fungus | 1 | 0 | 1 | 0 |  |
| potted_crimson_roots | 1 | 0 | 1 | 0 |  |
| potted_dandelion | 1 | 0 | 1 | 0 |  |
| potted_dark_oak_sapling | 1 | 0 | 1 | 0 |  |
| potted_dead_bush | 1 | 0 | 1 | 0 |  |
| potted_fern | 1 | 0 | 1 | 0 |  |
| potted_flowering_azalea_bush | 1 | 0 | 1 | 0 |  |
| potted_jungle_sapling | 1 | 0 | 1 | 0 |  |
| potted_lily_of_the_valley | 1 | 0 | 1 | 0 |  |
| potted_oak_sapling | 1 | 0 | 1 | 0 |  |
| potted_orange_tulip | 1 | 0 | 1 | 0 |  |
| potted_oxeye_daisy | 1 | 0 | 1 | 0 |  |
| potted_pink_tulip | 1 | 0 | 1 | 0 |  |
| potted_poppy | 1 | 0 | 1 | 0 |  |
| potted_red_mushroom | 1 | 0 | 1 | 0 |  |
| potted_red_tulip | 1 | 0 | 1 | 0 |  |
| potted_spruce_sapling | 1 | 0 | 1 | 0 |  |
| potted_warped_fungus | 1 | 0 | 1 | 0 |  |
| potted_warped_roots | 1 | 0 | 1 | 0 |  |
| potted_white_tulip | 1 | 0 | 1 | 0 |  |
| potted_wither_rose | 1 | 0 | 1 | 0 |  |
| powder_snow | 1 | 1 | 0 | 0 | powder_snow: 0,0,0,1024,1024,1024 vs (empty) |
| powder_snow_cauldron | 3 | 0 | 3 | 0 |  |
| powered_rail | 24 | 24 | 0 | 0 | powered_rail[powered=true,shape=north_south,waterlogged=true]: 0,0,0,1024,128,1024 vs (empty) |
| prismarine | 1 | 0 | 1 | 0 |  |
| prismarine_brick_slab | 6 | 0 | 6 | 0 |  |
| prismarine_brick_stairs | 80 | 0 | 80 | 0 |  |
| prismarine_bricks | 1 | 0 | 1 | 0 |  |
| prismarine_slab | 6 | 0 | 6 | 0 |  |
| prismarine_stairs | 80 | 0 | 80 | 0 |  |
| prismarine_wall | 324 | 322 | 322 | 0 | prismarine_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| pumpkin | 1 | 0 | 1 | 0 |  |
| pumpkin_stem | 8 | 8 | 0 | 0 | pumpkin_stem[age=0]: 448,0,448,576,128,576 vs (empty) |
| purple_banner | 16 | 16 | 0 | 0 | purple_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| purple_bed | 16 | 0 | 16 | 0 |  |
| purple_candle | 16 | 0 | 16 | 0 |  |
| purple_candle_cake | 2 | 0 | 2 | 0 |  |
| purple_carpet | 1 | 0 | 1 | 0 |  |
| purple_concrete | 1 | 0 | 1 | 0 |  |
| purple_concrete_powder | 1 | 0 | 1 | 0 |  |
| purple_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| purple_shulker_box | 6 | 0 | 6 | 0 |  |
| purple_stained_glass | 1 | 0 | 1 | 1 |  |
| purple_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| purple_terracotta | 1 | 0 | 1 | 0 |  |
| purple_wall_banner | 4 | 4 | 0 | 0 | purple_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| purple_wool | 1 | 0 | 1 | 0 |  |
| purpur_block | 1 | 0 | 1 | 0 |  |
| purpur_pillar | 3 | 0 | 3 | 0 |  |
| purpur_slab | 6 | 0 | 6 | 0 |  |
| purpur_stairs | 80 | 0 | 80 | 0 |  |
| quartz_block | 1 | 0 | 1 | 0 |  |
| quartz_bricks | 1 | 0 | 1 | 0 |  |
| quartz_pillar | 3 | 0 | 3 | 0 |  |
| quartz_slab | 6 | 0 | 6 | 0 |  |
| quartz_stairs | 80 | 0 | 80 | 0 |  |
| rail | 20 | 20 | 0 | 0 | rail[shape=north_south,waterlogged=true]: 0,0,0,1024,128,1024 vs (empty) |
| raw_copper_block | 1 | 0 | 1 | 0 |  |
| raw_gold_block | 1 | 0 | 1 | 0 |  |
| raw_iron_block | 1 | 0 | 1 | 0 |  |
| red_banner | 16 | 16 | 0 | 0 | red_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| red_bed | 16 | 0 | 16 | 0 |  |
| red_candle | 16 | 0 | 16 | 0 |  |
| red_candle_cake | 2 | 0 | 2 | 0 |  |
| red_carpet | 1 | 0 | 1 | 0 |  |
| red_concrete | 1 | 0 | 1 | 0 |  |
| red_concrete_powder | 1 | 0 | 1 | 0 |  |
| red_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| red_mushroom | 1 | 1 | 0 | 0 | red_mushroom: 320,0,320,704,384,704 vs (empty) |
| red_mushroom_block | 64 | 0 | 64 | 0 |  |
| red_nether_brick_slab | 6 | 0 | 6 | 0 |  |
| red_nether_brick_stairs | 80 | 0 | 80 | 0 |  |
| red_nether_brick_wall | 324 | 322 | 322 | 0 | red_nether_brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| red_nether_bricks | 1 | 0 | 1 | 0 |  |
| red_sand | 1 | 0 | 1 | 0 |  |
| red_sandstone | 1 | 0 | 1 | 0 |  |
| red_sandstone_slab | 6 | 0 | 6 | 0 |  |
| red_sandstone_stairs | 80 | 0 | 80 | 0 |  |
| red_sandstone_wall | 324 | 322 | 322 | 0 | red_sandstone_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| red_shulker_box | 6 | 0 | 6 | 0 |  |
| red_stained_glass | 1 | 0 | 1 | 1 |  |
| red_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| red_terracotta | 1 | 0 | 1 | 0 |  |
| red_tulip | 1 | 1 | 0 | 0 | red_tulip: 64,0,64,448,640,448 vs (empty) |
| red_wall_banner | 4 | 4 | 0 | 0 | red_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| red_wool | 1 | 0 | 1 | 0 |  |
| redstone_block | 1 | 0 | 1 | 0 |  |
| redstone_lamp | 2 | 0 | 2 | 0 |  |
| redstone_ore | 2 | 0 | 2 | 0 |  |
| redstone_torch | 2 | 2 | 0 | 0 | redstone_torch[lit=true]: 384,0,384,640,640,640 vs (empty) |
| redstone_wall_torch | 8 | 8 | 0 | 0 | redstone_wall_torch[facing=north,lit=true]: 352,192,704,672,832,1024 vs (empty) |
| redstone_wire | 1296 | 1296 | 0 | 0 | redstone_wire[east=up,north=up,power=0,south=up,west=up]: 7 boxes vs (empty) |
| repeater | 64 | 0 | 64 | 0 |  |
| repeating_command_block | 12 | 0 | 12 | 0 |  |
| respawn_anchor | 5 | 0 | 5 | 0 |  |
| rooted_dirt | 1 | 0 | 1 | 0 |  |
| rose_bush | 2 | 2 | 0 | 0 | rose_bush[half=upper]: 0,0,0,1024,1024,1024 vs (empty) |
| sand | 1 | 0 | 1 | 0 |  |
| sandstone | 1 | 0 | 1 | 0 |  |
| sandstone_slab | 6 | 0 | 6 | 0 |  |
| sandstone_stairs | 80 | 0 | 80 | 0 |  |
| sandstone_wall | 324 | 322 | 322 | 0 | sandstone_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| scaffolding | 32 | 16 | 32 | 0 | scaffolding[bottom=true,distance=0,waterlogged=true]: 8 boxes vs 7 boxes |
| sculk_sensor | 96 | 0 | 96 | 0 |  |
| sea_lantern | 1 | 0 | 1 | 0 |  |
| sea_pickle | 8 | 0 | 8 | 0 |  |
| seagrass | 1 | 1 | 0 | 0 | seagrass: 128,0,128,896,768,896 vs (empty) |
| shroomlight | 1 | 0 | 1 | 0 |  |
| shulker_box | 6 | 0 | 6 | 0 |  |
| skeleton_skull | 16 | 0 | 16 | 0 |  |
| skeleton_wall_skull | 4 | 0 | 4 | 0 |  |
| slime_block | 1 | 0 | 1 | 0 |  |
| small_amethyst_bud | 12 | 0 | 12 | 0 |  |
| small_dripleaf | 16 | 16 | 0 | 0 | small_dripleaf[facing=north,half=upper,waterlogged=true]: 128,0,128,896,832,896 vs (empty) |
| smithing_table | 1 | 0 | 1 | 0 |  |
| smoker | 8 | 0 | 8 | 0 |  |
| smooth_basalt | 1 | 0 | 1 | 0 |  |
| smooth_quartz | 1 | 0 | 1 | 0 |  |
| smooth_quartz_slab | 6 | 0 | 6 | 0 |  |
| smooth_quartz_stairs | 80 | 0 | 80 | 0 |  |
| smooth_red_sandstone | 1 | 0 | 1 | 0 |  |
| smooth_red_sandstone_slab | 6 | 0 | 6 | 0 |  |
| smooth_red_sandstone_stairs | 80 | 0 | 80 | 0 |  |
| smooth_sandstone | 1 | 0 | 1 | 0 |  |
| smooth_sandstone_slab | 6 | 0 | 6 | 0 |  |
| smooth_sandstone_stairs | 80 | 0 | 80 | 0 |  |
| smooth_stone | 1 | 0 | 1 | 0 |  |
| smooth_stone_slab | 6 | 0 | 6 | 0 |  |
| snow | 8 | 8 | 7 | 8 | snow[layers=1]: 0,0,0,1024,128,1024 vs (empty) |
| snow_block | 1 | 0 | 1 | 0 |  |
| soul_campfire | 32 | 0 | 32 | 0 |  |
| soul_fire | 1 | 1 | 0 | 0 | soul_fire: 0,0,0,1024,64,1024 vs (empty) |
| soul_lantern | 4 | 0 | 4 | 0 |  |
| soul_sand | 1 | 1 | 1 | 1 | soul_sand: 0,0,0,1024,1024,1024 vs 0,0,0,1024,896,1024 |
| soul_soil | 1 | 0 | 1 | 0 |  |
| soul_torch | 1 | 1 | 0 | 0 | soul_torch: 384,0,384,640,640,640 vs (empty) |
| soul_wall_torch | 4 | 4 | 0 | 0 | soul_wall_torch[facing=north]: 352,192,704,672,832,1024 vs (empty) |
| spawner | 1 | 0 | 1 | 0 |  |
| sponge | 1 | 0 | 1 | 0 |  |
| spore_blossom | 1 | 1 | 0 | 0 | spore_blossom: 128,832,128,896,1024,896 vs (empty) |
| spruce_button | 24 | 24 | 0 | 0 | spruce_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| spruce_door | 64 | 0 | 64 | 0 |  |
| spruce_fence | 32 | 32 | 32 | 32 | spruce_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| spruce_fence_gate | 32 | 32 | 16 | 0 | spruce_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| spruce_leaves | 14 | 0 | 14 | 0 |  |
| spruce_log | 3 | 0 | 3 | 0 |  |
| spruce_planks | 1 | 0 | 1 | 0 |  |
| spruce_pressure_plate | 2 | 2 | 0 | 0 | spruce_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| spruce_sapling | 2 | 2 | 0 | 0 | spruce_sapling[stage=0]: 128,0,128,896,768,896 vs (empty) |
| spruce_sign | 32 | 32 | 0 | 0 | spruce_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| spruce_slab | 6 | 0 | 6 | 0 |  |
| spruce_stairs | 80 | 0 | 80 | 0 |  |
| spruce_trapdoor | 64 | 0 | 64 | 0 |  |
| spruce_wall_sign | 8 | 8 | 0 | 0 | spruce_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| spruce_wood | 3 | 0 | 3 | 0 |  |
| sticky_piston | 12 | 0 | 12 | 0 |  |
| stone | 1 | 0 | 1 | 0 |  |
| stone_brick_slab | 6 | 0 | 6 | 0 |  |
| stone_brick_stairs | 80 | 0 | 80 | 0 |  |
| stone_brick_wall | 324 | 322 | 322 | 0 | stone_brick_wall[east=none,north=none,south=none,up=true,waterlogged=true,west=none]: 256,0,256,768,1024,768 vs 256,0,256,768,1536,768 |
| stone_bricks | 1 | 0 | 1 | 0 |  |
| stone_button | 24 | 24 | 0 | 0 | stone_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| stone_pressure_plate | 2 | 2 | 0 | 0 | stone_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| stone_slab | 6 | 0 | 6 | 0 |  |
| stone_stairs | 80 | 0 | 80 | 0 |  |
| stonecutter | 4 | 0 | 4 | 0 |  |
| stripped_acacia_log | 3 | 0 | 3 | 0 |  |
| stripped_acacia_wood | 3 | 0 | 3 | 0 |  |
| stripped_birch_log | 3 | 0 | 3 | 0 |  |
| stripped_birch_wood | 3 | 0 | 3 | 0 |  |
| stripped_crimson_hyphae | 3 | 0 | 3 | 0 |  |
| stripped_crimson_stem | 3 | 0 | 3 | 0 |  |
| stripped_dark_oak_log | 3 | 0 | 3 | 0 |  |
| stripped_dark_oak_wood | 3 | 0 | 3 | 0 |  |
| stripped_jungle_log | 3 | 0 | 3 | 0 |  |
| stripped_jungle_wood | 3 | 0 | 3 | 0 |  |
| stripped_oak_log | 3 | 0 | 3 | 0 |  |
| stripped_oak_wood | 3 | 0 | 3 | 0 |  |
| stripped_spruce_log | 3 | 0 | 3 | 0 |  |
| stripped_spruce_wood | 3 | 0 | 3 | 0 |  |
| stripped_warped_hyphae | 3 | 0 | 3 | 0 |  |
| stripped_warped_stem | 3 | 0 | 3 | 0 |  |
| structure_block | 4 | 0 | 4 | 0 |  |
| structure_void | 1 | 1 | 0 | 0 | structure_void: 320,320,320,704,704,704 vs (empty) |
| sugar_cane | 16 | 16 | 0 | 0 | sugar_cane[age=0]: 128,0,128,896,1024,896 vs (empty) |
| sunflower | 2 | 2 | 0 | 0 | sunflower[half=upper]: 0,0,0,1024,1024,1024 vs (empty) |
| sweet_berry_bush | 4 | 4 | 0 | 0 | sweet_berry_bush[age=0]: 192,0,192,832,512,832 vs (empty) |
| tall_grass | 2 | 2 | 0 | 0 | tall_grass[half=upper]: 0,0,0,1024,1024,1024 vs (empty) |
| tall_seagrass | 2 | 2 | 0 | 0 | tall_seagrass[half=upper]: 128,0,128,896,1024,896 vs (empty) |
| target | 16 | 0 | 16 | 0 |  |
| terracotta | 1 | 0 | 1 | 0 |  |
| tinted_glass | 1 | 0 | 1 | 1 |  |
| tnt | 2 | 0 | 2 | 0 |  |
| torch | 1 | 1 | 0 | 0 | torch: 384,0,384,640,640,640 vs (empty) |
| trapped_chest | 24 | 0 | 24 | 0 |  |
| tripwire | 128 | 128 | 0 | 0 | tripwire[attached=true,disarmed=true,east=true,north=true,powered=true,south=true,west=true]: 0,64,0,1024,160,1024 vs (empty) |
| tripwire_hook | 16 | 16 | 0 | 0 | tripwire_hook[attached=true,facing=north,powered=true]: 320,0,640,704,640,1024 vs (empty) |
| tube_coral | 2 | 2 | 0 | 0 | tube_coral[waterlogged=true]: 128,0,128,896,960,896 vs (empty) |
| tube_coral_block | 1 | 0 | 1 | 0 |  |
| tube_coral_fan | 2 | 2 | 0 | 0 | tube_coral_fan[waterlogged=true]: 128,0,128,896,256,896 vs (empty) |
| tube_coral_wall_fan | 8 | 8 | 0 | 0 | tube_coral_wall_fan[facing=north,waterlogged=true]: 0,256,320,1024,768,1024 vs (empty) |
| tuff | 1 | 0 | 1 | 0 |  |
| turtle_egg | 12 | 0 | 12 | 0 |  |
| twisting_vines | 26 | 26 | 0 | 0 | twisting_vines[age=0]: 256,0,256,768,960,768 vs (empty) |
| twisting_vines_plant | 1 | 1 | 0 | 0 | twisting_vines_plant: 256,0,256,768,1024,768 vs (empty) |
| vine | 32 | 32 | 0 | 0 | vine[east=true,north=true,south=true,up=true,west=true]: 5 boxes vs (empty) |
| wall_torch | 4 | 4 | 0 | 0 | wall_torch[facing=north]: 352,192,704,672,832,1024 vs (empty) |
| warped_button | 24 | 24 | 0 | 0 | warped_button[face=floor,facing=north,powered=true]: 320,0,384,704,64,640 vs (empty) |
| warped_door | 64 | 0 | 64 | 0 |  |
| warped_fence | 32 | 32 | 32 | 32 | warped_fence[east=true,north=true,south=true,waterlogged=true,west=true]: 3 boxes vs 3 boxes |
| warped_fence_gate | 32 | 32 | 16 | 0 | warped_fence_gate[facing=north,in_wall=true,open=true,powered=true]: 0,0,384,1024,832,640 vs (empty) |
| warped_fungus | 1 | 1 | 0 | 0 | warped_fungus: 256,0,256,768,576,768 vs (empty) |
| warped_hyphae | 3 | 0 | 3 | 0 |  |
| warped_nylium | 1 | 0 | 1 | 0 |  |
| warped_planks | 1 | 0 | 1 | 0 |  |
| warped_pressure_plate | 2 | 2 | 0 | 0 | warped_pressure_plate[powered=true]: 64,0,64,960,32,960 vs (empty) |
| warped_roots | 1 | 1 | 0 | 0 | warped_roots: 128,0,128,896,832,896 vs (empty) |
| warped_sign | 32 | 32 | 0 | 0 | warped_sign[rotation=0,waterlogged=true]: 256,0,256,768,1024,768 vs (empty) |
| warped_slab | 6 | 0 | 6 | 0 |  |
| warped_stairs | 80 | 0 | 80 | 0 |  |
| warped_stem | 3 | 0 | 3 | 0 |  |
| warped_trapdoor | 64 | 0 | 64 | 0 |  |
| warped_wall_sign | 8 | 8 | 0 | 0 | warped_wall_sign[facing=north,waterlogged=true]: 0,288,896,1024,800,1024 vs (empty) |
| warped_wart_block | 1 | 0 | 1 | 0 |  |
| water_cauldron | 3 | 0 | 3 | 0 |  |
| waxed_copper_block | 1 | 0 | 1 | 0 |  |
| waxed_cut_copper | 1 | 0 | 1 | 0 |  |
| waxed_cut_copper_slab | 6 | 0 | 6 | 0 |  |
| waxed_cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| waxed_exposed_copper | 1 | 0 | 1 | 0 |  |
| waxed_exposed_cut_copper | 1 | 0 | 1 | 0 |  |
| waxed_exposed_cut_copper_slab | 6 | 0 | 6 | 0 |  |
| waxed_exposed_cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| waxed_oxidized_copper | 1 | 0 | 1 | 0 |  |
| waxed_oxidized_cut_copper | 1 | 0 | 1 | 0 |  |
| waxed_oxidized_cut_copper_slab | 6 | 0 | 6 | 0 |  |
| waxed_oxidized_cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| waxed_weathered_copper | 1 | 0 | 1 | 0 |  |
| waxed_weathered_cut_copper | 1 | 0 | 1 | 0 |  |
| waxed_weathered_cut_copper_slab | 6 | 0 | 6 | 0 |  |
| waxed_weathered_cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| weathered_copper | 1 | 0 | 1 | 0 |  |
| weathered_cut_copper | 1 | 0 | 1 | 0 |  |
| weathered_cut_copper_slab | 6 | 0 | 6 | 0 |  |
| weathered_cut_copper_stairs | 80 | 0 | 80 | 0 |  |
| weeping_vines | 26 | 26 | 0 | 0 | weeping_vines[age=0]: 256,576,256,768,1024,768 vs (empty) |
| weeping_vines_plant | 1 | 1 | 0 | 0 | weeping_vines_plant: 64,0,64,960,1024,960 vs (empty) |
| wet_sponge | 1 | 0 | 1 | 0 |  |
| wheat | 8 | 8 | 0 | 0 | wheat[age=0]: 0,0,0,1024,128,1024 vs (empty) |
| white_banner | 16 | 16 | 0 | 0 | white_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| white_bed | 16 | 0 | 16 | 0 |  |
| white_candle | 16 | 0 | 16 | 0 |  |
| white_candle_cake | 2 | 0 | 2 | 0 |  |
| white_carpet | 1 | 0 | 1 | 0 |  |
| white_concrete | 1 | 0 | 1 | 0 |  |
| white_concrete_powder | 1 | 0 | 1 | 0 |  |
| white_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| white_shulker_box | 6 | 0 | 6 | 0 |  |
| white_stained_glass | 1 | 0 | 1 | 1 |  |
| white_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| white_terracotta | 1 | 0 | 1 | 0 |  |
| white_tulip | 1 | 1 | 0 | 0 | white_tulip: 64,0,64,448,640,448 vs (empty) |
| white_wall_banner | 4 | 4 | 0 | 0 | white_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| white_wool | 1 | 0 | 1 | 0 |  |
| wither_rose | 1 | 1 | 0 | 0 | wither_rose: 64,0,64,448,640,448 vs (empty) |
| wither_skeleton_skull | 16 | 0 | 16 | 0 |  |
| wither_skeleton_wall_skull | 4 | 0 | 4 | 0 |  |
| yellow_banner | 16 | 16 | 0 | 0 | yellow_banner[rotation=0]: 256,0,256,768,1024,768 vs (empty) |
| yellow_bed | 16 | 0 | 16 | 0 |  |
| yellow_candle | 16 | 0 | 16 | 0 |  |
| yellow_candle_cake | 2 | 0 | 2 | 0 |  |
| yellow_carpet | 1 | 0 | 1 | 0 |  |
| yellow_concrete | 1 | 0 | 1 | 0 |  |
| yellow_concrete_powder | 1 | 0 | 1 | 0 |  |
| yellow_glazed_terracotta | 4 | 0 | 4 | 0 |  |
| yellow_shulker_box | 6 | 0 | 6 | 0 |  |
| yellow_stained_glass | 1 | 0 | 1 | 1 |  |
| yellow_stained_glass_pane | 32 | 0 | 32 | 32 |  |
| yellow_terracotta | 1 | 0 | 1 | 0 |  |
| yellow_wall_banner | 4 | 4 | 0 | 0 | yellow_wall_banner[facing=north]: 0,0,896,1024,800,1024 vs (empty) |
| yellow_wool | 1 | 0 | 1 | 0 |  |
| zombie_head | 16 | 0 | 16 | 0 |  |
| zombie_wall_head | 4 | 0 | 4 | 0 |  |
