// columnscen.mjs — the COLUMN-PLANT growth scenarios (infra column-pack, RANDOM-TICK growth),
// shared by runcolumn.mjs (the real 1.18.2 server) and columnrefcheck.mjs (the engine). 25 Sept 2026.
//
// Sugar cane and cactus (.decomp/net/minecraft/block/SugarCaneBlock.java:39-58,
// .decomp/net/minecraft/block/CactusBlock.java:39-59): identical shape of randomTick — a column
// grows a new default-state block on top of itself, wrapping its OWN age 0..15 back to 0, but ONLY
// while `column height < 3` (counted by walking down from the ticking block while the block below
// is the same block) and only while the block above is air. Both are `kind: 'column'`, same as
// growthscen.mjs's (dropped) column probe -- see this file's header below for why THIS probe is a
// fresh design rather than a reuse of that one.
//
// ⚠ WHY A NEW PROBE, NOT growthscen.mjs's swap-to-glass ONE (growthscen.mjs's own doc comment,
// 24 Sept 2026): that pack's column probe (fill <box> glass replace air / air replace glass, once
// per height layer) produced a REAL SERVER golden where height>=3 was reported present while
// height>=2 was reported NEVER present at the same checkpoint -- physically impossible for a
// bottom-up column (height 3 implies height 2 occupied) -- and the cause was not found in that
// pass's time. Rather than reuse a probe with an unexplained failure mode, this pack counts
// presence DIRECTLY: `execute if block <pos> minecraft:<block> run scoreboard players add #cc mclr 1`
// per cell, summed into a scoreboard counter, then stored once per (scenario, height, checkpoint).
// No swap, no marker block, no two-step restore to get wrong -- the command that decides "is this
// column plant here" is the same command whose result is read. runcolumn.mjs additionally ASSERTS
// (D-30/D-305: refuse to write an impossible golden) that presence(height 3) <= presence(height 2)
// for every scenario/checkpoint before writing the golden file at all.
//
// Layout: one scenario per 16x16 chunk-footprint (so it is exactly one section wide), contiguous
// along +x starting at world spawn (growthscen.mjs's own doc comment explains why: `/forceload`
// alone never enables RANDOM ticks, only a real player watching the chunk does, and that watched
// window does not reliably survive `/tp` past a handful of chunks from spawn -- fitting every
// scenario inside the verified-working window, chunks 0..8, is simpler and more honest than a
// golden that silently depends on scenario order).
export const SPEED = 256;
export const CHECKPOINTS = [400, 800, 1200, 1600, 2000, 2400];
export const T = CHECKPOINTS[CHECKPOINTS.length - 1];
export const GY = -61; // the flat world's grass layer; the growing block sits at GY+1

// spaced grid: cells 2 apart on both axes, so no cane/cactus column ever sits next to another
// one (SugarCaneBlock has no side rule, but CactusBlock's canPlaceAt breaks on ANY solid
// horizontal neighbour -- spacing keeps every cell's neighbours air, matching growthscen.mjs's
// own `spacedGrid` isolation reasoning for crops). 36 cells/scenario (6x6): enough that the
// statistical tolerance in columnrefcheck.mjs's `tolFrac` (binomial, n=cells) is tight enough to
// catch a real growth-rate break -- n=8 (one row) turned out too coarse: a doubled growth rate
// still fell inside a 5-sigma band on 8 samples (see this file's own dispatch notes).
function spacedGrid(zStart, n) { const out = []; for (let gx = 0; gx < n; gx++) for (let gz = 0; gz < n; gz++) out.push([gx * 2, zStart + gz * 2]); return out; }
// water one cell "north" (z-1) of every cane cell's own row -- offsetting every row's z by 2
// (zStart=2) keeps that water row (z-1) from ever landing on another row's own cane cells (z=0,2,4,...).
function waterRowsFor(cells) { return cells.map(([x, z]) => [x, z - 1]); }

export const SCENARIOS = [
  // sugar cane needs water adjacent (N/S/E/W, not diagonal) to the GROUND block it stands on
  // (SugarCaneBlock.java:78-88: canPlaceAt loops `Direction.Type.field_11062`, horizontal only,
  // and accepts water OR frosted ice beside `pos.down()`).
  { id: 'sugar_cane_water', kind: 'column', block: 'sugar_cane', ground: 'sand',
    cells: spacedGrid(2, 6), water: waterRowsFor(spacedGrid(2, 6)) },
  // a dirt-ground variant: SugarCaneBlock.java's tag/block list also accepts dirt-family ground
  // (`BlockTags.field_29822`, i.e. the dirt tag) next to water, not only sand.
  { id: 'sugar_cane_dirt', kind: 'column', block: 'sugar_cane', ground: 'dirt',
    cells: spacedGrid(2, 6), water: waterRowsFor(spacedGrid(2, 6)) },
  // cactus: sand ground, no water needed, no solid neighbour within 2 (spacedGrid keeps a full
  // air gap on every side -- CactusBlock.java:82-92's canPlaceAt).
  { id: 'cactus_sand', kind: 'column', block: 'cactus', ground: 'sand',
    cells: spacedGrid(0, 6), water: [] },
];

export const origin = (i) => ({ x: 16 * i, y: GY, z: 0 });

const GROUND_STATE = { sand: 'minecraft:sand', dirt: 'minecraft:dirt' };

/**
 * serverPlan() -> { setup, step, probes, T }
 *   setup   RCON commands run once before the run starts
 *   step    the `#minecraft:tick` function body: tick-1 placement + every checkpoint's count probe
 *   probes  [{ key, scenario, height, ck }] in storage-index order (index == array position)
 * Each probe zeroes a scoreboard counter, adds 1 per cell that IS the scenario's block at that
 * height (a plain `execute if block ... run scoreboard players add`, no marker swap), then stores
 * the counter once. This can only ever report a real, currently-true count -- there is no second
 * command whose result could disagree with the first.
 */
export function serverPlan() {
  const setup = [], step = [], probes = [];
  setup.push('gamerule doDaylightCycle false');
  setup.push('gamerule doWeatherCycle false');
  setup.push('gamerule randomTickSpeed ' + SPEED);
  setup.push('time set day');
  setup.push('weather clear 1000000');
  const xMax = 16 * (SCENARIOS.length - 1) + 15;
  setup.push(`forceload add -2 -2 ${xMax + 2} 17`);
  setup.push(`fill -2 ${GY} -2 ${xMax + 2} ${GY + 10} 17 minecraft:air`);

  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    for (const [dx, dz] of sc.cells) {
      const gx = o.x + dx, gz = o.z + dz;
      step.push(`execute if score #t mclr matches 1 run setblock ${gx} ${GY} ${gz} ${GROUND_STATE[sc.ground]}`);
      step.push(`execute if score #t mclr matches 1 run setblock ${gx} ${GY + 1} ${gz} minecraft:${sc.block}[age=0]`);
    }
    for (const [wx, wz] of sc.water) {
      step.push(`execute if score #t mclr matches 1 run setblock ${o.x + wx} ${GY} ${o.z + wz} minecraft:water`);
    }
    for (const ck of CHECKPOINTS) {
      for (const h of [2, 3]) {
        probes.push({ key: `${sc.id}.h${h}`, scenario: sc.id, height: h, ck });
        const j = probes.length - 1;
        step.push(`execute if score #t mclr matches ${ck} run scoreboard players set #cc mclr 0`);
        for (const [dx, dz] of sc.cells) {
          const gx = o.x + dx, gz = o.z + dz;
          step.push(`execute if score #t mclr matches ${ck} if block ${gx} ${GY + h} ${gz} minecraft:${sc.block} run scoreboard players add #cc mclr 1`);
        }
        step.push(`execute if score #t mclr matches ${ck} store result storage mcliteref:colgrow p${j} int 1 run scoreboard players get #cc mclr`);
      }
    }
  });
  probes.forEach((p, j) => setup.push(`data modify storage mcliteref:colgrow p${j} set value 0`));
  return { setup, step, probes, T };
}
