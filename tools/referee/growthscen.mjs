// growthscen.mjs — the GROWTH TIMING scenarios (infra I6, RANDOM-TICK growth), shared by rungrowth.mjs
// (the real 1.18.2 server) and growthrefcheck.mjs (the engine). 24 Sept 2026.
//
// Growth is RANDOM (`Behave.randomTickSection` draws `speed` uniform positions per 16^3 section per
// tick — CropBlock/SugarCaneBlock/etc. then roll their own chance), so this pack compares DISTRIBUTIONS
// at fixed checkpoints, never a tick-exact series the way hopperscen/redstonescen/furnacescen do.
//
// Layout: one scenario per 16x16 chunk-footprint (so it is exactly one section wide), laid out
// CONTIGUOUSLY in a row along +x starting at the world spawn chunk. Ground is set at GY (the flat
// world's top layer, -61 — see server.mjs's `level-type=flat` 1 bedrock + 2 dirt + 1 grass starting
// at WORLD_MIN_Y=-64) and the growing block sits at GY+1, open to full sky (light 15) so the light>=9
// gate every crop/sapling reads never blocks growth — the same reason `hopperrefcheck.mjs`'s fake
// world hands back a fixed max light rather than modelling one.
//
// ⚠ WHY CONTIGUOUS, AND WHY ONLY 9 CHUNKS (0..8, x 0..143). `/forceload` keeps a chunk simulating
// block entities and scheduled ticks (rungrowth's rcon.mjs / hopperscen's whole pack proves that),
// but a REAL PLAYER (growbot.mjs) is what makes it also run RANDOM ticks
// (ThreadedAnvilChunkStorage.shouldTick requires `playerChunkWatchingManager` to be non-empty).
// Empirically (rungrowth's own dispatch notes, 24 Sept 2026) that player-watched window is NOT
// simply "within view-distance of wherever `/tp` puts the bot": a lone bot RCON-teleported to
// chunk 8 (x 128-143) grows a wheat plant fully in under 250 ticks; the SAME bot teleported one
// chunk further, to chunk 9 (x 144-159), grows nothing at all -- not in 2400 ticks, not with a
// 30-second settle delay before the run starts. The cutoff is exactly at the chunk boundary
// (x=143 ticks, x=144 does not) and was re-verified by binary search. The most likely cause (never
// fully confirmed against source -- this project has no vanilla NETWORK client to test the fix
// with) is that this bot never sends a Client Settings packet, so the server keeps tracking its
// watched chunks around whatever fallback/join-time window it used before any view-distance was
// negotiated, rather than recentering on every `/tp`. Fitting every scenario inside that verified
// working window (9 chunks) is simpler and more honest than shipping a golden that silently
// depends on scenario ORDER for whether its growth numbers mean anything.
//
// #305 added a SECOND row past those 8 (see `origin`): the two stem scenarios, at chunks (0,1) and (1,1).
//
// Cells within a scenario are placed on a "spaced" grid (step 2, positions 0,2,..,14 -> 64 cells) so
// `CropBlock.getAvailableMoisture`'s same-crop row penalty never confounds an isolated-plant scenario;
// `wheat_row` is the one scenario that plants densely (every cell 0..15, 252 of 256 — 4 held for water)
// specifically to exercise that penalty.
//
// Each `SPEED` random ticks/section/tick is driven by BOTH sides identically (`gamerule
// randomTickSpeed <SPEED>` on the server, `speed` passed into `Behave.randomTickSection` in the check)
// so growth is fast enough to move within a few thousand ticks without either side's engine being
// asked a different question than the other (D-331).
export const SPEED = 256;
export const CHECKPOINTS = [400, 800, 1200, 1600, 2000, 2400];
export const T = CHECKPOINTS[CHECKPOINTS.length - 1];
export const GY = -61; // the flat world's grass layer; the growing block sits at GY+1

const spacedGrid = () => { const out = []; for (let gx = 0; gx < 8; gx++) for (let gz = 0; gz < 8; gz++) out.push([gx * 2, gz * 2]); return out; };
const denseGrid = (skip) => {
  const out = [];
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) { if (skip.some(([sx, sz]) => sx === x && sz === z)) continue; out.push([x, z]); }
  return out;
};
const denseRect = (x0, x1, z0, z1) => { const out = []; for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z]); return out; };
const WATER_4 = [[3, 3], [3, 11], [11, 3], [11, 11]]; // Chebyshev-covers every cell 0..14 within FarmBlock's 4-block radius
// #304: the ENCLOSED light scenarios plant on the ODD cells 1..13 (49), inside a stone shell on the chunk's own
// border (local 0 and 15), with water on even cells that Chebyshev-cover all of them within FarmBlock's radius 4.
const oddGrid = () => { const out = []; for (let gx = 0; gx < 7; gx++) for (let gz = 0; gz < 7; gz++) out.push([1 + gx * 2, 1 + gz * 2]); return out; };
const WATER_ODD = [[4, 4], [4, 10], [10, 4], [10, 10]];

export const SCENARIOS = [
  // isolated (spaced, single farmland tile per plant -- no row-penalty confound): moist vs dry
  { id: 'wheat_moist', kind: 'crop', ground: 'farmland_moist', block: 'wheat', prop: 'age', maxState: 7,
    cells: spacedGrid(), water: WATER_4 },
  { id: 'wheat_dry', kind: 'crop', ground: 'farmland_dry', block: 'wheat', prop: 'age', maxState: 7,
    cells: spacedGrid(), water: [] },
  // dense (every cell adjacent, same crop): CropBlock.getAvailableMoisture's east/west+north/south (or
  // diagonal) same-crop halving, hydrated so the only difference from wheat_moist is the row penalty
  { id: 'wheat_row', kind: 'crop', ground: 'farmland_moist', block: 'wheat', prop: 'age', maxState: 7,
    cells: denseGrid(WATER_4), water: WATER_4 },
  { id: 'carrots_moist', kind: 'crop', ground: 'farmland_moist', block: 'carrots', prop: 'age', maxState: 7,
    cells: spacedGrid(), water: WATER_4 },
  { id: 'potatoes_moist', kind: 'crop', ground: 'farmland_moist', block: 'potatoes', prop: 'age', maxState: 7,
    cells: spacedGrid(), water: WATER_4 },
  // BeetrootsBlock.randomTick (.decomp/net/minecraft/block/BeetrootsBlock.java:42-46): an EXTRA
  // `random.nextInt(3) != 0` gate in front of the normal CropBlock roll, on top of the smaller max age 3
  { id: 'beetroot_moist', kind: 'crop', ground: 'farmland_moist', block: 'beetroots', prop: 'age', maxState: 3,
    cells: spacedGrid(), water: WATER_4 },
  // sugar cane was DROPPED from this pack (24 Sept 2026): the height-layer probe below (the same
  // air<->glass swap technique as the crop-state probes, just presence rather than an exact state)
  // produced a logically impossible golden for it -- height>=3 present with height>=2 reported as
  // NEVER present, which cannot happen (height 3 implies height 2) -- and the cause was not found
  // in the time this pass had. `kind: 'column'` and its probe/compare code stay (a future column
  // scenario can use them) but nothing exercises them until the swap-restore sequence for a
  // MULTI-LAYER presence probe is re-audited; ship the 8 scenarios that are verified, not a 9th
  // whose own golden contradicts itself.
  { id: 'sapling', kind: 'crop', ground: 'grass', block: 'oak_sapling', prop: 'stage', maxState: 1,
    cells: spacedGrid(), water: [] },
  { id: 'netherwart', kind: 'crop', ground: 'soul_sand', block: 'nether_wart', prop: 'age', maxState: 3,
    cells: spacedGrid(), water: [] },
  // ── #304 (G24) ──────────────────────────────────────────────────────────────────────────────────
  // SweetBerryBushBlock.randomTick: age<3, nextInt(5), base light >= 9 at the cell ABOVE (open sky here)
  { id: 'sweet_berry', kind: 'crop', ground: 'grass', block: 'sweet_berry_bush', prop: 'age', maxState: 3,
    cells: spacedGrid(), water: [] },
  // CocoaBlock.randomTick: nextInt(5), age<2, no light gate. A pod hangs on the jungle log its FACING names
  // (02k's rule 23), so every pod faces south onto a log at z+1 (an odd z, never another pod's cell); `props`
  // is carried through the probe's swap-back so the restored pod still faces its log.
  { id: 'cocoa', kind: 'crop', ground: 'grass', block: 'cocoa', prop: 'age', maxState: 2, props: { facing: 'south' },
    support: { dx: 0, dz: 1, block: 'jungle_log' }, cells: spacedGrid(), water: [] },
  // BambooSaplingBlock -> BambooBlock: a column that grows from its top to at most 16 stalks (GY+1..GY+16), so it
  // spans TWO sections (-64 and -48); probed by PRESENCE per height layer with `execute if block` (columnscen's
  // non-destructive probe: a bamboo stalk carries age/leaves/stage, which a glass swap-back could not restore).
  { id: 'bamboo', kind: 'tall', ground: 'grass', block: 'bamboo_sapling', tall: 'bamboo', layers: [2, 3, 4, 6, 8, 10, 12, 14],
    sections: [-64, -48], cells: spacedGrid(), water: [] },
  // The light gates, restated from .decomp (not assumed): CropBlock.randomTick grows only at getBaseLightLevel(pos, 0)
  // >= 9 on the crop's OWN cell; CropBlock.canPlaceAt keeps a crop ALIVE at >= 8 or open sky. So at 8 a crop stands
  // and never grows, at 9 it grows. Each is a sealed stone shell (sky light 0) with a `light` block of level L+1 over
  // every plant, so the plant's own cell reads exactly L. `still`: the server's own distribution must NOT move.
  { id: 'wheat_light8', kind: 'crop', ground: 'farmland_moist', block: 'wheat', prop: 'age', maxState: 7,
    cells: oddGrid(), water: WATER_ODD, enclosed: true, light: 8, still: true },
  { id: 'wheat_light9', kind: 'crop', ground: 'farmland_moist', block: 'wheat', prop: 'age', maxState: 7,
    cells: oddGrid(), water: WATER_ODD, enclosed: true, light: 9 },
  // #305 (G24b) — AbstractPlantStemBlock.randomTick: `age < 25 && nextDouble() < growthChance` grows the HEAD one
  // cell along its growth direction into a cell `chooseStemState` accepts. `kind: 'stem'` measures the COLUMN
  // LENGTH from the anchor (head + `_plant` body, counted per layer): `maxState` is the longest column the box
  // allows. Both stay inside the ONE section (y -64..-49) growthrefcheck's engine side ticks.
  // KelpBlock (growthChance 0.14, UP, into WATER): on sand at GY in a glass-walled pool of water GY..GY+11 -> 11 cells.
  // FIRST of the second row, i.e. chunk (0,1), beside `wheat_moist` — whose farmland is already moisture 7, so this
  // water changes nothing there. The pool is local x 1..10 (`box`), so its nearest water is 6 blocks from
  // `wheat_dry`'s farmland at x 16 (FarmlandBlock.isWaterNearby's radius is 4), and it is walled INSIDE its own
  // footprint. Kelp columns never read each other (chooseStemState is the cell above), so the pool is planted densely.
  { id: 'kelp', kind: 'stem', block: 'kelp', body: 'kelp_plant', dir: 1, ground: 'sand', box: [1, 10, 1, 14],
    anchorY: GY, maxState: 11, cells: denseRect(1, 10, 1, 14), water: [] },
  // WeepingVinesBlock (growthChance 0.1, DOWN, into air): hung under a stone ceiling at GY+11, the column can
  // reach GY+1 (the grass at GY stops it) -> 10 cells.
  { id: 'weeping_vines', kind: 'stem', block: 'weeping_vines', body: 'weeping_vines_plant', dir: -1,
    anchorY: GY + 11, maxState: 10, cells: spacedGrid(), water: [] },
];

// Contiguous, chunk-ALIGNED (16 apart): each scenario's 16-wide footprint is exactly ONE section
// column both sides call `randomTickSection` on. No gap chunk is needed for isolation -- every
// water block sits at local x/z 3 or 11 (see WATER_4), so the nearest possible cross-boundary
// read (a spaced-grid cell at local 14, the far side of `FarmBlock`'s radius-4 hydration check,
// against a neighbour's water at local 3 one chunk over) is 5 blocks, outside that radius.
// #304: past the ninth scenario the row wraps to z = 16 (chunk row 1), so no scenario is further along +x than the
// verified working window above; `wheat_row`'s dense z=15 cells meet a row-1 chunk at z=16, and no row-1 water sits
// within FarmBlock's radius of a row-0 cell (WATER_ODD's nearest is local z 4, i.e. z=20).
export const PER_ROW = 9;
export const origin = (i) => ({ x: 16 * (i % PER_ROW), y: GY, z: 16 * Math.floor(i / PER_ROW) });
export const stateString = (block, props) => `minecraft:${block}` + (props && Object.keys(props).length ? '[' + Object.entries(props).map(([k, v]) => `${k}=${v}`).join(',') + ']' : '');

const GROUND_STATE = {
  farmland_moist: 'minecraft:farmland[moisture=7]',
  farmland_dry: 'minecraft:farmland[moisture=0]',
  sand: 'minecraft:sand',
  soul_sand: 'minecraft:soul_sand',
  grass: 'minecraft:grass_block',
};

const cropDefaultState = (sc) => (sc.kind === 'column' || sc.kind === 'stem') ? `minecraft:${sc.block}[age=0]` : sc.kind === 'tall' ? `minecraft:${sc.block}` : stateString(sc.block, { ...sc.props, [sc.prop]: 0 });
// a stem scenario's cell at column position k (1 = the first plant cell next to the anchor)
export const stemY = (sc, k) => sc.anchorY + sc.dir * k;

/**
 * serverPlan() -> { setup, step, probes, T }
 *   setup   RCON commands run once before the run starts (gamerules, forceload, storage init)
 *   step    the `#minecraft:tick` function body: tick-1 placement + every checkpoint's fill/store probe
 *   probes  [{ key, scenario, state|height, ck }] in storage-index order (index == array position)
 * A probe reads its count via a `fill <box> <block> replace <block>[<prop>=<v>]` -- filling matching
 * cells with THEMSELVES so nothing changes, and `execute store result ... run fill ...` captures the
 * vanilla "N block(s) filled" count into storage. `fill <box> <block> replace <block>` (no bracket) as
 * a column-plant "height" probe matches ANY age of that block, i.e. "is this y-layer occupied".
 */
export function serverPlan() {
  const setup = [], step = [], probes = [], fns = {};
  setup.push('gamerule doDaylightCycle false');
  setup.push('gamerule doWeatherCycle false');
  setup.push('gamerule randomTickSpeed ' + SPEED);
  setup.push('time set day');
  setup.push('weather clear 1000000');
  setup.push('gamerule doMobSpawning false'); // #305: nothing may spawn under the vines' dark ceiling
  const xMax = 16 * (Math.min(SCENARIOS.length, PER_ROW) - 1) + 15;
  const zMax = 16 * Math.ceil(SCENARIOS.length / PER_ROW) - 1;
  // a 2-block margin on every side: the sapling scenario's "became a log" probe (below) reads a
  // box that overhangs its own 16x16 footprint, for a canopy that can lean past the cell it grew on.
  // Cleared one scenario at a time (#304): the whole area in one `fill` is over its 32768-block limit, and bamboo
  // reaches GY+16. All clears run before any enclosure is built.
  setup.push(`forceload add -2 -2 ${xMax + 2} ${zMax + 2}`);
  SCENARIOS.forEach((sc, i) => { const o = origin(i); setup.push(`fill ${o.x - 2} ${GY} ${o.z - 2} ${o.x + 17} ${GY + 18} ${o.z + 17} minecraft:air`); });
  // ⚠ THE GY LAYER IS FLOORED WITH STONE (#304). Cleared to air, it let every WATER_4 source FLOW across it — from
  // wheat_moist's x=11 into wheat_dry's own chunk — so the server's "dry" plot was partly hydrated (it grew ~1.5x
  // faster than CropBlock's 1-in-13 at tick 400, where the engine, which runs no fluid ticks, grew at exactly that).
  // Only farmland counts in getAvailableMoisture, so a stone neighbour and an air one are the same to a crop.
  SCENARIOS.forEach((sc, i) => { const o = origin(i); setup.push(`fill ${o.x} ${GY} ${o.z} ${o.x + 15} ${GY} ${o.z + 15} minecraft:stone`); });
  // the light shells, and their light blocks placed NOW, before tick 1: a light block set over a crop fires its
  // neighbour update before the light engine has spread it, and CropBlock.canPlaceAt (light >= 8 or sky) then
  // breaks a crop standing in the dark — that is what emptied both shells on the first run
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    if (sc.enclosed) setup.push(`fill ${o.x} ${GY} ${o.z} ${o.x + 15} ${GY + 3} ${o.z + 15} minecraft:stone hollow`);
    if (sc.light !== undefined) for (const [dx, dz] of sc.cells) setup.push(`setblock ${o.x + dx} ${GY + 2} ${o.z + dz} minecraft:light[level=${sc.light + 1}]`);
  });

  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    if (sc.kind === 'stem') { stemPlan(sc, o, step, probes, fns); return; }
    for (const [dx, dz] of sc.cells) {
      const gx = o.x + dx, gz = o.z + dz;
      step.push(`execute if score #t mclr matches 1 run setblock ${gx} ${GY} ${gz} ${GROUND_STATE[sc.ground]}`);
      if (sc.support) step.push(`execute if score #t mclr matches 1 run setblock ${gx + sc.support.dx} ${GY + 1} ${gz + sc.support.dz} minecraft:${sc.support.block}`);
      step.push(`execute if score #t mclr matches 1 run setblock ${gx} ${GY + 1} ${gz} ${cropDefaultState(sc)}`);
    }
    for (const [wx, wz] of sc.water) {
      step.push(`execute if score #t mclr matches 1 run setblock ${o.x + wx} ${GY} ${o.z + wz} minecraft:water`);
    }
    const x1 = o.x, z1 = o.z, x2 = o.x + 15, z2 = o.z + 15;
    // ⚠ `fill <box> <block> replace <sameBlock>[<sameState>]` ALWAYS reports "No blocks were
    // filled": vanilla's fill counter is `Level.setBlock`'s return, which is false when the new
    // state equals the old one (Level.java's `setBlockState`: no-op writes are not "changed"), so
    // a same-state query can never be read this way. Every probe below instead counts through a
    // one-tick MARKER swap: replace the matching cells with `minecraft:glass` (a real state
    // change, counted), read the count, then swap them straight back — both fills run inside the
    // SAME datapack-function tick, before the world tick that would run any random tick, so
    // nothing here is ever visible to a player or to `Behave.randomTick` for even one tick.
    for (const ck of CHECKPOINTS) {
      if (sc.kind === 'tall') {
        // columnscen's probe: one `execute if block` per cell per layer into a scoreboard counter — nothing is swapped
        for (const h of sc.layers) {
          probes.push({ key: `${sc.id}.h${h}`, scenario: sc.id, layer: h, ck });
          const j = probes.length - 1;
          step.push(`execute if score #t mclr matches ${ck} run scoreboard players set #cc mclr 0`);
          for (const [dx, dz] of sc.cells) {
            step.push(`execute if score #t mclr matches ${ck} if block ${o.x + dx} ${GY + h} ${o.z + dz} minecraft:${sc.tall} run scoreboard players add #cc mclr 1`);
          }
          step.push(`execute if score #t mclr matches ${ck} store result storage mcliteref:grow p${j} int 1 run scoreboard players get #cc mclr`);
        }
      } else if (sc.kind === 'column') {
        // presence at a height layer = cells - (still air there); swapping air<->glass loses no
        // growth information (air carries no state), unlike swapping the plant's own age away.
        for (const h of [2, 3]) {
          probes.push({ key: `${sc.id}.e${h}`, scenario: sc.id, height: h, ck });
          const j = probes.length - 1;
          step.push(`execute if score #t mclr matches ${ck} store result storage mcliteref:grow p${j} int 1 run ` +
            `fill ${x1} ${GY + h} ${z1} ${x2} ${GY + h} ${z2} minecraft:glass replace minecraft:air`);
          step.push(`execute if score #t mclr matches ${ck} run fill ${x1} ${GY + h} ${z1} ${x2} ${GY + h} ${z2} minecraft:air replace minecraft:glass`);
        }
      } else {
        for (let v = 0; v <= sc.maxState; v++) {
          probes.push({ key: `${sc.id}.s${v}`, scenario: sc.id, state: v, ck });
          const j = probes.length - 1;
          step.push(`execute if score #t mclr matches ${ck} store result storage mcliteref:grow p${j} int 1 run ` +
            `fill ${x1} ${GY + 1} ${z1} ${x2} ${GY + 1} ${z2} minecraft:glass replace minecraft:${sc.block}[${sc.prop}=${v}]`);
          step.push(`execute if score #t mclr matches ${ck} run ` +
            `fill ${x1} ${GY + 1} ${z1} ${x2} ${GY + 1} ${z2} ${stateString(sc.block, { ...sc.props, [sc.prop]: v })} replace minecraft:glass`);
        }
      }
      // `SaplingBlock.generate` (.decomp/net/minecraft/block/SaplingBlock.java:38-44): at stage 1 a
      // hit does not advance a property at all, it calls the tree generator directly, so a grown
      // sapling's block is simply GONE -- replaced by a trunk+canopy. Only checkable at the LAST
      // checkpoint (destructive: no restore, matching D-331's "don't restore for the sake of it"
      // once nothing downstream reads the world again) over a box tall/wide enough for a small oak.
      if (sc.id === 'sapling' && ck === CHECKPOINTS[CHECKPOINTS.length - 1]) {
        probes.push({ key: `${sc.id}.logs`, scenario: sc.id, state: 'logs', ck });
        const j = probes.length - 1;
        step.push(`execute if score #t mclr matches ${ck} store result storage mcliteref:grow p${j} int 1 run ` +
          `fill ${x1 - 2} ${GY + 1} ${z1 - 2} ${x2 + 2} ${GY + 9} ${z2 + 2} minecraft:diamond_block replace minecraft:oak_log`);
      }
    }
  });
  // initialised so a probe whose checkpoint never fires (a bug, not the common case) reads 0
  // over RCON instead of "no such data", which would abort the whole run rather than surface as a note
  probes.forEach((p, j) => setup.push(`data modify storage mcliteref:grow p${j} set value 0`));
  return { setup, step, probes, fns, T };
}

// #305 — a `kind: 'stem'` scenario. Tick 1 builds the box (kelp: a glass ring one block outside the footprint, water
// GY..GY+11, sand under each cell; vines: a stone ceiling at the anchor) and plants each head at age 0. Each
// checkpoint runs ONE function (`fns`, written by rungrowth) that counts, per column position k, the cells whose
// block there is the head OR the body — columns are contiguous, so that count is "cells with length >= k". No
// marker swap: `execute if block` only reads (columnscen.mjs's probe), and the ages it would destroy are the point.
function stemPlan(sc, o, step, probes, fns) {
  const x1 = o.x, z1 = o.z, x2 = o.x + 15, z2 = o.z + 15, t1 = 'execute if score #t mclr matches 1 run ';
  if (sc.box) {
    const top = sc.anchorY + sc.maxState, [bx0, bx1, bz0, bz1] = sc.box;
    step.push(t1 + `fill ${o.x + bx0 - 1} ${GY} ${o.z + bz0 - 1} ${o.x + bx1 + 1} ${top} ${o.z + bz1 + 1} minecraft:glass`);
    step.push(t1 + `fill ${o.x + bx0} ${GY} ${o.z + bz0} ${o.x + bx1} ${top} ${o.z + bz1} minecraft:water`);
  } else {
    step.push(t1 + `fill ${x1} ${sc.anchorY} ${z1} ${x2} ${sc.anchorY} ${z2} minecraft:stone`);
  }
  for (const [dx, dz] of sc.cells) {
    const gx = o.x + dx, gz = o.z + dz;
    if (sc.ground) step.push(t1 + `setblock ${gx} ${sc.anchorY} ${gz} ${GROUND_STATE[sc.ground]}`);
    step.push(t1 + `setblock ${gx} ${stemY(sc, 1)} ${gz} ${cropDefaultState(sc)}`);
  }
  for (const ck of CHECKPOINTS) {
    const fn = `probe_${sc.id}_${ck}`, body = (fns[fn] = []);
    step.push(`execute if score #t mclr matches ${ck} run function mcliteref:${fn}`);
    for (let k = 1; k <= sc.maxState; k++) {
      probes.push({ key: `${sc.id}.h${k}`, scenario: sc.id, height: k, ck });
      const j = probes.length - 1;
      body.push('scoreboard players set #cc mclr 0');
      for (const [dx, dz] of sc.cells) {
        const at = `${o.x + dx} ${stemY(sc, k)} ${o.z + dz}`;
        body.push(`execute if block ${at} minecraft:${sc.block} run scoreboard players add #cc mclr 1`);
        body.push(`execute if block ${at} minecraft:${sc.body} run scoreboard players add #cc mclr 1`);
      }
      body.push(`execute store result storage mcliteref:grow p${j} int 1 run scoreboard players get #cc mclr`);
    }
  }
}
