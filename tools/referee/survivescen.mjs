// survivescen.mjs — the COLUMN-PLANT SURVIVAL scenarios (infra referee-survive pack), shared by
// runsurvive.mjs (the real 1.18.2 server) and surviverefcheck.mjs (the engine). 25 Sept 2026.
//
// Cactus and sugar cane are the only two blocks in the base game whose `scheduledTick`
// unconditionally breaks them the moment `canPlaceAt` goes false (.decomp/net/minecraft/block/
// CactusBlock.java:32-36, SugarCaneBlock.java:33-37) -- and BOTH schedule that check through
// `getStateForNeighborUpdate` -> `createAndScheduleBlockTick(pos, this, 1)`
// (CactusBlock.java:73-79, SugarCaneBlock.java:61-67), i.e. ONE TICK AFTER the neighbour that
// broke support actually changed, never in the same tick. This pack exists to catch an engine
// that instead breaks the block SYNCHRONOUSLY, in the same call that changed the neighbour
// (src/07_world.js's `cascadeFrom`, called from `W.setBlock` before the caller returns) --
// exactly one tick too early, every time. See docs/archive/REFEREE.md's new section for the finding this
// pack found.
//
// canPlaceAt rules read straight from the two files:
//   CACTUS  (CactusBlock.java:82-92): no SOLID-material horizontal neighbour and no LAVA-tagged
//           fluid horizontal neighbour; the block below must be sand, red_sand or cactus itself;
//           the block above must not be a liquid (water OR lava -- `getMaterial().isLiquid()`).
//   SUGAR CANE (SugarCaneBlock.java:71-89): the block below is sugar_cane itself, OR (the block
//           below is in the `dirt` tag, sand or red_sand) AND one of the FOUR HORIZONTAL
//           neighbours of THAT GROUND BLOCK (not of the cane) has a WATER fluidstate (source,
//           flowing or waterlogged all count -- FluidState, not block identity) or IS a
//           frosted_ice block.
//
// Every scenario is ONE plant column, isolated in its own 16x16 chunk (leafscen.mjs's own
// reasoning: forceload keeps scheduled ticks flowing -- growbot.mjs's header confirms scheduled
// ticks, unlike RANDOM ticks, need no player watching, only a loaded chunk -- so no fake player
// is needed here at all). Clock, shared with the server's tick function and the engine's driving
// loop, for k = 1..T:
//   (k == 1: place ground + setup + the plant) (k == TRIGGER: the one support-breaking change)
//   -> sample every probe cell (still the plant, boolean) -> one world tick
// so the sample at tick TRIGGER is taken AFTER the change was written but BEFORE any tick has
// run — the same instant `W.setBlock`'s synchronous cascade would already show broken and the
// real server (whose break is still one tick away) would not.

export const GY = -61;             // the flat world's grass layer (server.mjs)
export const TRIGGER = 10;         // the tick the one support-breaking change happens
export const T = 30;               // TRIGGER + 20: three ticks is the longest real cascade (a
                                    // 3-tall column), so 20 ticks of margin is generous.

export const origin = (i) => ({ x: 16 * i, y: GY, z: 0 });

// setblock state text for a plant cell, always age 0 (age plays no part in canPlaceAt).
const cell = (block) => `minecraft:${block}[age=0]`;

export const SCENARIOS = [
  // ── CACTUS: the four horizontal-neighbour cases (CactusBlock.java:83-88) ────────────────
  { id: 'cactus_beside_stone', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [9, 1, 8], to: 'minecraft:stone' }],
    probes: [[8, 1, 8]], expect: 'breaks: stone is a SOLID material horizontal neighbour' },
  { id: 'cactus_beside_glass', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [9, 1, 8], to: 'minecraft:glass' }],
    probes: [[8, 1, 8]], expect: 'breaks: Material.GLASS has no notSolid() call -> solid=true, even though glass is see-through and non-opaque' },
  { id: 'cactus_beside_fence', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [9, 1, 8], to: 'minecraft:oak_fence' }],
    probes: [[8, 1, 8]], expect: 'breaks: Material.WOOD has no notSolid() call -> solid=true, even though a fence is not a full cube' },
  { id: 'cactus_beside_torch', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [9, 1, 8], to: 'minecraft:torch' }],
    probes: [[8, 1, 8]], expect: 'MUST NOT break: Material.DECORATION calls .notSolid() -> solid=false' },
  { id: 'cactus_beside_sign', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [9, 1, 8], to: 'minecraft:oak_sign' }],
    probes: [[8, 1, 8]], expect: 'breaks: a standing sign is Material.WOOD (solid=true) despite .noCollision() -- noCollision is a SHAPE setting, not the Material.isSolid() this rule reads' },
  { id: 'cactus_beside_lava', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [9, 1, 8], to: 'minecraft:lava' }],
    probes: [[8, 1, 8]], expect: 'breaks: FluidTags.LAVA horizontal neighbour' },
  { id: 'cactus_beside_water', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [9, 1, 8], to: 'minecraft:water' }],
    probes: [[8, 1, 8]], expect: 'MUST NOT break: water is not in FluidTags.LAVA and WATER material is not solid -- only LAVA is checked beside, not "any fluid"' },
  // ── CACTUS: the vertical "no liquid above" case (CactusBlock.java:90-91) ────────────────
  { id: 'cactus_water_above', block: 'cactus', ground: 'sand', plant: [[8, 1, 8]],
    setup: [], change: [{ pos: [8, 2, 8], to: 'minecraft:water' }],
    probes: [[8, 1, 8]], expect: 'breaks: water placed directly above -- the ABOVE cell only, no horizontal-neighbour rule applies here' },
  // ── CACTUS: sand removed under a 3-tall column -- the staggered, tick-by-tick collapse ──
  // (this is the pack's centrepiece: vanilla breaks the BOTTOM cell at TRIGGER+1 via its own
  // scheduled tick; that break is itself a neighbour change, so the MIDDLE cell schedules its
  // own break for TRIGGER+2; that break schedules the TOP cell's break for TRIGGER+3. Three
  // separate one-tick delays, not one instantaneous pop.)
  { id: 'cactus_column3_sand_removed', block: 'cactus', ground: 'sand',
    plant: [[8, 1, 8], [8, 2, 8], [8, 3, 8]], setup: [],
    change: [{ pos: [8, 0, 8], to: 'minecraft:air' }],
    probes: [[8, 1, 8], [8, 2, 8], [8, 3, 8]],
    expect: 'staggered collapse: bottom gone at TRIGGER+1, middle at TRIGGER+2, top at TRIGGER+3 (never all three at once)' },

  // ── SUGAR CANE (SugarCaneBlock.java:71-89) ──────────────────────────────────────────────
  // ⚠ EMPIRICAL FINDING, not the naive guess (this file's own first draft assumed "breaks",
  // and the real server said otherwise -- D-30's "never guess a number the game owns" applies
  // to BEHAVIOUR, not only numbers): removing the water beside the GROUND block sends a
  // neighbour update to the water's six face-neighbours, one of which is the ground block --
  // but the ground block's own state did not change, so it fires nothing onward, and the CANE
  // (diagonal to the removed water, not face-adjacent to it) is never told. A real player who
  // mines that water sees the cane keep standing until something touches the cane or the
  // ground directly (`cane_base_changed`, below, is that direct case). Kept as a scenario
  // because it is the one most people get wrong by intuition, and it is exactly the kind of
  // "transitive support" question `cascadeFrom` (src/07_world.js:892-905) could get wrong in
  // either direction -- it happens to walk only ONE hop from the changed cell too, so it agrees.
  { id: 'cane_water_removed', block: 'sugar_cane', ground: 'sand', plant: [[8, 1, 8]],
    setup: [{ pos: [9, 0, 8], block: 'minecraft:water' }],
    change: [{ pos: [9, 0, 8], to: 'minecraft:air' }],
    probes: [[8, 1, 8]], expect: 'MUST NOT break (verified against the real server, not assumed): the block update from the removed water never reaches the cane, which is diagonal to it, not face-adjacent' },
  { id: 'cane_frosted_ice_survive', block: 'sugar_cane', ground: 'sand', plant: [[8, 1, 8]],
    setup: [{ pos: [9, 0, 8], block: 'minecraft:frosted_ice' }],
    change: [], probes: [[8, 1, 8]],
    expect: 'MUST NOT break, ever: frosted_ice beside the ground block is explicitly accepted (Blocks.field_10110), same as water' },
  { id: 'cane_waterlogged_neighbor_survive', block: 'sugar_cane', ground: 'sand', plant: [[8, 1, 8]],
    setup: [{ pos: [9, 0, 8], block: 'minecraft:oak_fence[waterlogged=true]' }],
    change: [], probes: [[8, 1, 8]],
    expect: 'MUST NOT break, ever: canPlaceAt reads the FluidState (getFluidState), which a waterlogged block also carries -- not the block identity' },
  { id: 'cane_base_changed', block: 'sugar_cane', ground: 'sand', plant: [[8, 1, 8]],
    setup: [{ pos: [9, 0, 8], block: 'minecraft:water' }],
    change: [{ pos: [8, 0, 8], to: 'minecraft:stone' }],
    probes: [[8, 1, 8]], expect: 'breaks: the ground block itself is no longer sand/dirt-tag/cane' },
  { id: 'cane_cut_middle', block: 'sugar_cane', ground: 'sand',
    plant: [[8, 1, 8], [8, 2, 8], [8, 3, 8]],
    setup: [{ pos: [9, 0, 8], block: 'minecraft:water' }],
    change: [{ pos: [8, 2, 8], to: 'minecraft:air' }],
    probes: [[8, 1, 8], [8, 2, 8], [8, 3, 8]],
    expect: 'bottom NEVER breaks (still on sand+water); middle is air from TRIGGER (we cut it); top breaks at TRIGGER+1 (its "below" is no longer cane, and the ground rule fails at that height too)' },
];

// ⚠ CONTAINMENT (found empirically, not guessed): a lone water source placed via `/setblock`
// keeps flowing -- given the ~9 ticks between placement (tick 1) and TRIGGER, it has time to wrap
// AROUND the ground block through the open air on its other three sides and re-touch the ground
// block's horizontal neighbours from a different side, so `cane_water_removed`'s own removal
// stopped mattering (the wrapped water kept the rule satisfied). Every cane scenario gets stone
// on the ground block's other three horizontal sides and a stone floor under its special
// neighbour cell, so the ONE water/frosted_ice/waterlogged-fence cell this scenario is actually
// testing is the only fluid state that can ever reach the ground block. This changes nothing
// about the RULE being tested (sugar cane's `canPlaceAt` never looks at its own horizontal
// neighbours, only the ground block's), only the harness's ability to isolate it.
for (const sc of SCENARIOS) {
  if (sc.block !== 'sugar_cane') continue;
  sc.setup = sc.setup.concat([
    { pos: [7, 0, 8], block: 'minecraft:stone' }, { pos: [8, 0, 7], block: 'minecraft:stone' },
    { pos: [8, 0, 9], block: 'minecraft:stone' }, { pos: [9, -1, 8], block: 'minecraft:stone' },
  ]);
}

const GROUND_BLOCK = 'minecraft:sand';

/**
 * serverPlan() -> { setup, step, probes, T }
 *   setup   RCON commands run once before the run starts
 *   step    the `#minecraft:tick` function body: tick-1 placement, TRIGGER's change, and every
 *           tick's boolean presence sample for every probe cell
 *   probes  [{ key, scenario, cell:[dx,dy,dz] }] in storage-index order (index == array position)
 * Every probe is a direct `execute if block <pos> minecraft:<block> run ...` boolean read -- the
 * same shape columnscen.mjs uses and for the same reason (no swap, no marker, nothing to get
 * wrong between the write and the read).
 */
export function serverPlan() {
  const setup = [], step = [], probes = [];
  setup.push('gamerule doDaylightCycle false');
  setup.push('gamerule doWeatherCycle false');
  setup.push('gamerule randomTickSpeed 0'); // growth (age) is irrelevant here; keep it off so age never confuses a probe
  setup.push('time set day');
  setup.push('weather clear 1000000');
  const xMax = 16 * (SCENARIOS.length - 1) + 15;
  setup.push(`forceload add -2 -2 ${xMax + 2} 17`);
  // ⚠ ONE 16-WIDE SLAB PER FILL (leafscen.mjs's own caveat, learned the hard way there too): a
  // single fill over the whole row is > 32768 blocks and the server silently REFUSES it ("Too
  // many blocks"), leaving every previous run's leftover blocks (a neighbour placed at TRIGGER,
  // a removed ground block) standing when the next run starts placing at tick 1.
  for (let x = -16; x <= xMax + 16; x += 16) setup.push(`fill ${x} ${GY} -2 ${x + 15} ${GY + 10} 17 minecraft:air`);

  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const at = (c) => `${o.x + c[0]} ${GY + c[1]} ${o.z + c[2]}`;
    step.push(`execute if score #t mclr matches 1 run setblock ${at([8, 0, 8])} minecraft:${sc.ground}`);
    for (const s of sc.setup) step.push(`execute if score #t mclr matches 1 run setblock ${at(s.pos)} ${s.block}`);
    for (const p of sc.plant) step.push(`execute if score #t mclr matches 1 run setblock ${at(p)} ${cell(sc.block)}`);
    for (const c of sc.change) step.push(`execute if score #t mclr matches ${TRIGGER} run setblock ${at(c.pos)} ${c.to}`);
    sc.probes.forEach((p, pi) => {
      const key = `${sc.id}.p${pi}`, j = probes.length;
      probes.push({ key, scenario: sc.id, cell: p });
      step.push(`scoreboard players set #c mclr 0`);
      step.push(`execute if block ${at(p)} minecraft:${sc.block} run scoreboard players set #c mclr 1`);
      step.push(`data modify storage mcliteref:surv p${j} append value 0`);
      step.push(`execute store result storage mcliteref:surv p${j}[-1] int 1 run scoreboard players get #c mclr`);
    });
  });
  for (let j = 0; j < probes.length; j++) setup.push(`data remove storage mcliteref:surv p${j}`);
  return { setup, step, probes, T };
}
