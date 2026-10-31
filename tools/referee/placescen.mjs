// placescen.mjs — the BLOCK PLACEMENT STATE referee pack (infra I6, s146, 25 Sept 2026): which block STATE a real player's right-click
// places — facing from the player, half from the click height, axis from the face, wall vs floor variants, the second cell of a
// door or bed. Shared by runplace.mjs (the real 1.18.2 server) and placerefcheck.mjs (the engine's own join: P.retarget() +
// Use.rightClick(P), aimed at the same point).
// Geometry (both sides): the player's feet at (0.5, F, 0.5), a stone floor at y = F-1 over x,z in -3..3. 'side' scenes put a stone
// at (0, F, 2) and click its NORTH face (z = 2, facing the player) at height cy -> the block lands in (0, F, 1); 'floor' scenes click
// the floor's top face at (0.5, F, 2.5) -> the block lands in (0, F, 2). The look is the exact eye->point vector (server: /tp
// yaw/pitch from it; engine: P.yaw/P.pitch from it), so the player faces SOUTH (+z) — or EAST (+x) in the `_east` copies below. Every block state property is
// read back (server: `execute if block` per value of each property from .mcdata/pc/blocks.json; engine: Behave.propName).
// Vanilla sources (.decomp): the block's own getPlacementState (StairsBlock, PillarBlock, SlabBlock, WallStandingBlock/TorchBlock,
// WallMountedBlock, LadderBlock, AbstractFurnaceBlock/ChestBlock/PistonBlock/ObserverBlock/DispenserBlock (getPlayerLookDirection),
// HopperBlock, SignBlock/WallSignBlock, DoorBlock, BedBlock, AbstractRailBlock, CarvedPumpkinBlock, AnvilBlock, TrapdoorBlock,
// FenceGateBlock, EndRodBlock, LanternBlock, ChainBlock, GrindstoneBlock, BellBlock) via ItemPlacementContext.
export const REPS = 2;
const S = (id, item, at, extra) => Object.assign({ id, item, at }, extra || {});
export const SCEN = [
  S('stairs_side_low', 'oak_stairs', 'side', { cy: 0.25 }),
  S('stairs_side_high', 'oak_stairs', 'side', { cy: 0.75 }),
  S('stairs_floor', 'oak_stairs', 'floor'),
  S('log_side', 'oak_log', 'side', { cy: 0.5 }),
  S('log_floor', 'oak_log', 'floor'),
  S('quartz_pillar_side', 'quartz_pillar', 'side', { cy: 0.5 }),
  S('slab_side_low', 'oak_slab', 'side', { cy: 0.25 }),
  S('slab_side_high', 'oak_slab', 'side', { cy: 0.75 }),
  S('slab_floor', 'oak_slab', 'floor'),
  S('torch_side', 'torch', 'side', { cy: 0.5, names: ['torch', 'wall_torch'] }),
  S('torch_floor', 'torch', 'floor', { names: ['torch', 'wall_torch'] }),
  S('button_side', 'stone_button', 'side', { cy: 0.5 }),
  S('button_floor', 'stone_button', 'floor'),
  S('lever_side', 'lever', 'side', { cy: 0.5 }),
  S('ladder_side', 'ladder', 'side', { cy: 0.5 }),
  S('furnace_floor', 'furnace', 'floor'),
  S('chest_floor', 'chest', 'floor'),
  S('piston_floor', 'piston', 'floor'),
  S('observer_floor', 'observer', 'floor'),
  S('dispenser_side', 'dispenser', 'side', { cy: 0.5 }),
  S('hopper_side', 'hopper', 'side', { cy: 0.5 }),
  S('hopper_floor', 'hopper', 'floor'),
  S('sign_side', 'oak_sign', 'side', { cy: 0.5, names: ['oak_sign', 'oak_wall_sign'] }),
  S('sign_floor', 'oak_sign', 'floor', { names: ['oak_sign', 'oak_wall_sign'] }),
  S('door_floor', 'oak_door', 'floor', { cells: [[0, 0, 2], [0, 1, 2]] }),
  S('bed_floor', 'red_bed', 'floor', { cells: [[0, 0, 2], [0, 0, 3]] }),
  S('rail_floor', 'rail', 'floor'),
  S('carved_pumpkin_floor', 'carved_pumpkin', 'floor'),
  S('anvil_floor', 'anvil', 'floor'),
  S('trapdoor_side_low', 'oak_trapdoor', 'side', { cy: 0.25 }),
  S('trapdoor_side_high', 'oak_trapdoor', 'side', { cy: 0.75 }),
  S('trapdoor_floor', 'oak_trapdoor', 'floor'),
  S('fence_gate_floor', 'oak_fence_gate', 'floor'),
  S('end_rod_side', 'end_rod', 'side', { cy: 0.5 }),
  S('end_rod_floor', 'end_rod', 'floor'),
  S('lantern_side', 'lantern', 'side', { cy: 0.5 }),
  S('chain_side', 'chain', 'side', { cy: 0.5 }),
  S('grindstone_side', 'grindstone', 'side', { cy: 0.5 }),
  S('grindstone_floor', 'grindstone', 'floor'),
  S('bell_floor', 'bell', 'floor'),
  S('vine_side', 'vine', 'side', { cy: 0.5 }),
];
// The same geometry turned to face EAST (x and z swapped: the side stone at (2, F, 0), its WEST face clicked; the floor point
// (2.5, F, 0.5)) for every scene whose answer depends on the player's facing — a facing table that is right for south and wrong
// for east (or mirrored) shows up only here.
for (const id of ['stairs_side_low', 'stairs_floor', 'log_side', 'torch_side', 'button_side', 'button_floor', 'ladder_side', 'furnace_floor',
  'chest_floor', 'observer_floor', 'hopper_side', 'sign_side', 'sign_floor', 'door_floor', 'bed_floor', 'rail_floor', 'anvil_floor',
  'trapdoor_side_high', 'fence_gate_floor', 'grindstone_floor', 'bell_floor', 'vine_side']) {
  const base = SCEN.find((q) => q.id === id);
  SCEN.push(Object.assign({}, base, { id: id + '_east', dir: 'east', cells: base.cells ? base.cells.map(([x, y, z]) => [z, y, x]) : undefined }));
}
/** The cell(s) a scene's placement lands in, relative to (0, F, 0). */
const swap = (s, v) => (s.dir === 'east' ? [v[2], v[1], v[0]] : v);
export const cellsOf = (s) => s.cells || [swap(s, s.at === 'side' ? [0, 0, 1] : [0, 0, 2])];
/** The clicked block, face (protocol ids: 1 up, 2 north), the cursor inside it, and the world point aimed at (relative to F). */
export function clickOf(s) {
  if (s.at === 'side') return { block: swap(s, [0, 0, 2]), face: s.dir === 'east' ? 4 : 2, cursor: swap(s, [0.5, s.cy, 0]), point: swap(s, [0.5, s.cy, 2.0]) };
  return { block: swap(s, [0, -1, 2]), face: 1, cursor: [0.5, 1, 0.5], point: swap(s, [0.5, 0, 2.5]) };
}
/** The support stone of a 'side' scene. */
export const sideStoneOf = (s) => swap(s, [0, 0, 2]);
export const EYE = 1.62;
