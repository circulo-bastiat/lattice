#!/usr/bin/env node
// blockclassescheck.mjs — #11721: net/minecraft/block/* Yarn classes -> the engine's real-state tables.
// MC-Lite has no class per block: a Yarn block class is DATA (a registry block + its property set, 02b/02c) plus rules
// (src/07b_behaviour.js, 07f_redstone.js, 07g_piston.js, 07c_blockentity.js). For every class this check names the block(s)
// it governs and asserts the engine registers each with exactly the property names the vanilla class declares.
// Anti-vacuity (D-30): a renamed block and a dropped/added property are each caught.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({});
const R = M.Reg;
const props = (n) => { const b = R.id[n]; if (b === undefined) return null; const o = []; for (let k = R.propFirst[b]; k < R.propFirst[b + 1]; k++) o.push(R.propNames[R.propId[k]]); return o.sort(); };
const FACE6 = ['down', 'east', 'north', 'south', 'up', 'west'], SIDES4 = ['east', 'north', 'south', 'west'];
const sorted = (a) => [...a].sort();
// class -> [[block, [properties]]...]
const CLASSES = {
  AbstractBannerBlock: [['white_banner', ['rotation']], ['white_wall_banner', ['facing']]], BannerBlock: [['white_banner', ['rotation']]],
  AbstractChestBlock: [['chest', ['facing', 'type', 'waterlogged']], ['trapped_chest', ['facing', 'type', 'waterlogged']], ['ender_chest', ['facing', 'waterlogged']]],
  DoubleBlockProperties: [['chest', ['facing', 'type', 'waterlogged']]],
  AbstractGlassBlock: [['glass', []]], GlassBlock: [['glass', []]], TransparentBlock: [['glass', []]], Stainable: [['white_stained_glass', []]],
  TintedGlassBlock: [['tinted_glass', []]],
  PaneBlock: [['glass_pane', [...SIDES4, 'waterlogged']], ['iron_bars', [...SIDES4, 'waterlogged']]],
  StainedGlassPaneBlock: [['white_stained_glass_pane', [...SIDES4, 'waterlogged']]],
  HorizontalConnectingBlock: [['oak_fence', [...SIDES4, 'waterlogged']]],
  ConnectingBlock: [['chorus_plant', FACE6]],
  AbstractLichenBlock: [['glow_lichen', [...FACE6, 'waterlogged']]], GlowLichenBlock: [['glow_lichen', [...FACE6, 'waterlogged']]],
  AbstractSignBlock: [['oak_sign', ['rotation', 'waterlogged']]], WallSignBlock: [['oak_wall_sign', ['facing', 'waterlogged']]],
  AbstractSkullBlock: [['skeleton_skull', ['rotation']]], SkullBlock: [['skeleton_skull', ['rotation']]], WallSkullBlock: [['skeleton_wall_skull', ['facing']]],
  PlayerSkullBlock: [['player_head', ['rotation']]], WallPlayerSkullBlock: [['player_wall_head', ['facing']]], WallWitherSkullBlock: [['wither_skeleton_wall_skull', ['facing']]],
  AirBlock: [['air', []]], AzaleaBlock: [['azalea', []]], BarrierBlock: [['barrier', []]],
  BlastFurnaceBlock: [['blast_furnace', ['facing', 'lit']]], FurnaceBlock: [['furnace', ['facing', 'lit']]], SmokerBlock: [['smoker', ['facing', 'lit']]],
  BlockEntityProvider: [['furnace', ['facing', 'lit']], ['chest', ['facing', 'type', 'waterlogged']]], BlockWithEntity: [['furnace', ['facing', 'lit']]],
  HorizontalFacingBlock: [['furnace', ['facing', 'lit']]],
  CarpetBlock: [['white_carpet', []]], ChainBlock: [['chain', ['axis', 'waterlogged']]], ConduitBlock: [['conduit', ['waterlogged']]],
  CoralFanBlock: [['tube_coral_fan', ['waterlogged']]], CoralWallFanBlock: [['tube_coral_wall_fan', ['facing', 'waterlogged']]],
  DeadCoralBlock: [['dead_tube_coral', ['waterlogged']]], DeadCoralFanBlock: [['dead_tube_coral_fan', ['waterlogged']]],
  DeadCoralWallFanBlock: [['dead_tube_coral_wall_fan', ['facing', 'waterlogged']]],
  CryingObsidianBlock: [['crying_obsidian', []]], DirtPathBlock: [['dirt_path', []]], EndGatewayBlock: [['end_gateway', []]],
  EndPortalFrameBlock: [['end_portal_frame', ['eye', 'facing']]],
  FacingBlock: [['end_rod', ['facing']]], RodBlock: [['end_rod', ['facing']], ['lightning_rod', ['facing', 'powered', 'waterlogged']]],
  FletchingTableBlock: [['fletching_table', []]], GlazedTerracottaBlock: [['white_glazed_terracotta', ['facing']]],
  GourdBlock: [['melon_stem', ['age']], ['pumpkin_stem', ['age']]], MelonBlock: [['melon', []]], GravelBlock: [['gravel', []]],
  HangingRootsBlock: [['hanging_roots', ['waterlogged']]], InventoryProvider: [['composter', ['level']]],
  JigsawBlock: [['jigsaw', ['orientation']]], LadderBlock: [['ladder', ['facing', 'waterlogged']]], LanternBlock: [['lantern', ['hanging', 'waterlogged']]],
  MossBlock: [['moss_block', []]], MyceliumBlock: [['mycelium', ['snowy']]], NetherWartBlock: [['nether_wart', ['age']]], NetherrackBlock: [['netherrack', []]],
  OperatorBlock: [['command_block', ['conditional', 'facing']]], PillarBlock: [['oak_log', ['axis']]],
  PistonExtensionBlock: [['moving_piston', ['facing', 'type']]], PistonHeadBlock: [['piston_head', ['facing', 'short', 'type']]],
  PlantBlock: [['dandelion', []]], PowderSnowCauldronBlock: [['powder_snow_cauldron', ['level']]],
  RedstoneBlock: [['redstone_block', []]], RedstoneOreBlock: [['redstone_ore', ['lit']]], RootedDirtBlock: [['rooted_dirt', []]],
  RootsBlock: [['crimson_roots', []]], RotatedInfestedBlock: [['infested_deepslate', ['axis']]],
  SpongeBlock: [['sponge', []]], WetSpongeBlock: [['wet_sponge', []]], SporeBlossomBlock: [['spore_blossom', []]], SproutsBlock: [['nether_sprouts', []]],
  StoneButtonBlock: [['stone_button', ['face', 'facing', 'powered']]], WoodenButtonBlock: [['oak_button', ['face', 'facing', 'powered']]],
  WallMountedBlock: [['lever', ['face', 'facing', 'powered']]],
  StructureBlock: [['structure_block', ['mode']]], StructureVoidBlock: [['structure_void', []]],
  TorchBlock: [['torch', []]], WallTorchBlock: [['wall_torch', ['facing']]], WallRedstoneTorchBlock: [['redstone_wall_torch', ['facing', 'lit']]],
  TwistingVinesPlantBlock: [['twisting_vines_plant', []]], WeepingVinesPlantBlock: [['weeping_vines_plant', []]],
  StairsBlock: [['oak_stairs', ['facing', 'half', 'shape', 'waterlogged']]],
};
// classes that are engine machinery, not a block: the function/constant that carries them
const MACHINERY = {
  ShapeContext: () => typeof R.shapeOf === 'object' && typeof R.interactionShape === 'function',
  EntityShapeContext: () => typeof R.interactionShape === 'function',
  SideShapeType: () => typeof M.States.faceSturdy === 'function' && M.States.SUPPORT_FULL !== undefined && M.States.SUPPORT_CENTER !== undefined && M.States.SUPPORT_RIGID !== undefined,
  BlockRenderType: () => M.States.GEOM_NONE !== undefined && M.States.GEOM_CUBE !== undefined && M.States.GEOM_MODEL !== undefined,
};
let pass = 0, breaks = 0; const fails = [];
const verify = (table) => { const bad = []; for (const [c, bl] of Object.entries(table)) for (const [n, p] of bl) { const got = props(n); if (!got) bad.push(c + ': no block ' + n); else if (got.join() !== sorted(p).join()) bad.push(c + ': ' + n + ' props [' + got + '] != [' + sorted(p) + ']'); } return bad; };
const bad = verify(CLASSES); bad.forEach((b) => fails.push(b)); pass += Object.keys(CLASSES).length - bad.length;
for (const [c, f] of Object.entries(MACHINERY)) { if (f()) pass++; else fails.push(c + ': engine machinery missing'); }
const brk = (name, mut) => { const t = JSON.parse(JSON.stringify(CLASSES)); mut(t); breaks++; if (verify(t).length) { pass++; console.log('  ✓ break caught: ' + name); } else fails.push('anti-vacuity: ' + name + ' not caught'); };
brk('renamed block', (t) => { t.LadderBlock[0][0] = 'ladderx'; });
brk('dropped property', (t) => { t.StairsBlock[0][1].pop(); });
brk('extra property', (t) => { t.GravelBlock[0][1].push('lit'); });
for (const f of fails) console.log('  FAIL ' + f);
console.log('\n blockclassescheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
