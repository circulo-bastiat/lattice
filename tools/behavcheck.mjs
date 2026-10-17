#!/usr/bin/env node
// behavcheck.mjs — PLAN G2's acceptance, in PLAN's own words:
//
//   *"place a fence next to a wall and assert both connection states; flow water down a
//    staircase and assert the level at each step; grow a crop through all eight stages; light a
//    fire under a stone slab and assert it goes out."*
//
//   node tools/behavcheck.mjs
//
// ── THE WORLD IS A 48^3 ARRAY, AND THAT IS THE POINT ─────────────────────────────────────
// `src/07b_behaviour.js` reads and writes through an adapter — `getBlock`, `setBlock`,
// `blockLightAt` — and nothing else. So this file hands it a flat `Uint16Array` instead of the
// streaming chunk world, and every scenario below is a few dozen blocks placed by hand and then
// ticked. A check that had to generate terrain to grow one wheat plant is a check that runs once
// and is then quietly dropped from the suite (D-143's lesson), and the adapter exists so that
// cannot happen here.
//
// What the adapter deliberately does NOT do is re-implement any rule: `setBlock` writes the cell
// and calls `Behave.changed`, which is exactly what `World.setBlock` does. The connection logic,
// the fluid spread, the tick scheduler and the crop growth are all the shipped code.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

// ⚠ `02g_items.js`, `14f_inventory.js` AND `02h_recipes.js` ARE HERE BECAUSE THE FURNACE IS
// REAL NOW (D-289). G2 left `BE.smeltResult`/`BE.fuelValue` as hooks for a later stage, and no
// later stage ever filled them — so §9 below stubbed them with a two-item fake, proved the
// counters against the fake, and set them back to null. That was honest about what it proved and
// it still meant NO FURNACE IN ANY BUILD HAS EVER SMELTED ANYTHING, with a green check beside it.
// The hooks are gone; the furnace calls G9's own `cookingFor` and `fuelTime`, so this check has
// to load G9's own tables, and coal now burns for the 1600 ticks the compiled Java says (D-269).
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js'];
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
function withItems(M) {
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
  return M;
}
const MCL = withItems(loadEngine({ extra: EXTRA, dom: false }));
const R = MCL.Reg, S = MCL.States, B = MCL.Behave, BE = MCL.BlockEntities;

const N = 48, MID = 24;
function makeWorld(MM) {
  const M = MM || MCL;
  const cells = new Uint16Array(N * N * N);
  const light = new Uint8Array(N * N * N).fill(15);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const inside = (x, y, z) => x + MID >= 0 && x + MID < N && y + MID >= 0 && y + MID < N && z + MID >= 0 && z + MID < N;
  const world = {
    getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
    setBlock(x, y, z, id) {
      if (!inside(x, y, z)) return false;
      cells[idx(x, y, z)] = id;
      if (M.Behave.ready) M.Behave.changed(x, y, z);
      return true;
    },
    // the raw write, for building a scene without firing a hundred neighbour updates
    poke(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; },
    blockLightAt: (x, y, z) => (inside(x, y, z) ? light[idx(x, y, z)] : 15),
    setLight(x, y, z, v) { if (inside(x, y, z)) light[idx(x, y, z)] = v; },
    clear() { cells.fill(0); light.fill(15); },
  };
  M.Behave.init(world);
  M.BlockEntities.init();
  M.Behave.clearSchedule();
  return world;
}
const W = makeWorld();
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
const pName = (st, p) => B.propName(st, p);
/** A deterministic generator, so a scenario that rolls a die is reproducible. */
function rng(seed) {
  let s = seed | 0 || 1;
  return () => { s ^= s << 13; s |= 0; s ^= s >>> 17; s ^= s << 5; s |= 0; return ((s >>> 0) % 16777216) / 16777216; };
}

// ─────────────────────────────────────────────── 1. the substrate is wired up
console.log('1. the behaviour layer is bound to the roster and the tags');
{
  ok(B.ready, 'Behave.init did not run');
  ok(BE.ready, 'BlockEntities.init did not run');
  ok(MCL.Tags.ready, 'the tag substrate is not loaded — G2 is built on it');
  ok(R.PROP.age !== undefined, 'the placement table does not carry `age` — crops cannot be read (D-204)');
  ok(R.PROP.level !== undefined, 'the placement table does not carry `level` — fluids cannot be read (D-204)');
  ok(R.PROP.distance !== undefined, 'the placement table does not carry `distance` — leaves cannot decay');
  ok(R.PROP.part !== undefined && R.PROP.moisture !== undefined && R.PROP.snowy !== undefined,
     'the placement table is still the six-property placement subset (D-204)');
  console.log(`   ${R.propNames.length} properties · ${R.valueNames.length} values · ${MCL.Tags.tagCount} tags`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. faces, which every connection rests on
console.log('2. isFaceSturdy, from the real collision boxes');
{
  const sturdy = (block, dir) => B.faceSturdy(def(block), dir);
  // 0 down 1 up 2 north 3 south 4 west 5 east
  ok(sturdy('stone', 0) && sturdy('stone', 1) && sturdy('stone', 5), 'a full cube is sturdy on every face');
  const slabBottom = def('oak_slab');
  ok(pName(slabBottom, 'type') === 'bottom', 'the default oak slab should be the bottom half');
  ok(B.faceSturdy(slabBottom, 0), 'a bottom slab is sturdy on its DOWN face');
  ok(!B.faceSturdy(slabBottom, 1), 'a bottom slab is NOT sturdy on its UP face');
  ok(B.faceSturdy(slabBottom, 2) === false, 'a bottom slab is not sturdy on a side — it only fills half of it');
  ok(!B.faceSturdy(def('oak_fence'), 5), 'a fence post is not a sturdy face');
  ok(!B.faceSturdy(def('torch'), 0), 'a torch has no sturdy face at all');
  ok(B.faceSturdy(def('dirt'), 1) && B.faceSturdy(def('oak_planks'), 1), 'dirt and planks are sturdy on top');
  ok(!B.faceSturdy(0, 1), 'air is never sturdy');
  let sturdyCount = 0;
  for (let b = 0; b < R.blockCount; b++) if (B.faceSturdy(R.realFirst[b] + R.defaultState[b], 1)) sturdyCount++;
  ok(sturdyCount > 300 && sturdyCount < 700, `${sturdyCount} of ${R.blockCount} blocks have a sturdy top face — that number looks wrong`);
  console.log(`   ${sturdyCount} of ${R.blockCount} blocks are sturdy on top`);
}
console.log(`   ${pass} ok`);

// helpers shared by the scenarios below
const place = (x, y, z, name) => W.setBlock(x, y, z, B.place(def(name), x, y, z));
const at = (x, y, z) => W.getBlock(x, y, z);
const reset = () => { W.clear(); B.clearSchedule(); BE.clear(); };
const floor = (y) => { for (let x = -22; x <= 22; x++) for (let z = -22; z <= 22; z++) W.poke(x, y, z, def('stone')); };
const blockAt = (x, y, z) => (at(x, y, z) === 0 ? 'air' : R.names[S.block[at(x, y, z)]]);

// ─────────────────────────────────────────────── 3. PLAN's first acceptance: fences and walls
console.log('3. connections: a fence next to a wall, and everything either of them touches');
{
  reset();
  place(0, 0, 0, 'oak_fence');
  place(1, 0, 0, 'cobblestone_wall');
  const f = at(0, 0, 0), wl = at(1, 0, 0);
  // ⚠ THE ANSWER IS "NEITHER", AND THAT IS VANILLA. `FenceBlock.connectsTo` wants a STURDY face
  // on the neighbour and a wall does not present one; `WallBlock.connectsTo` wants the same of a
  // fence and gets the same answer. A clone that connects them looks right in a screenshot and
  // is wrong in the game, which is why this pair is PLAN's named acceptance.
  ok(pName(f, 'east') === 'false', `the fence connected east to a wall: ${pName(f, 'east')}`);
  ok(pName(wl, 'west') === 'none', `the wall connected west to a fence: ${pName(wl, 'west')}`);
  ok(pName(wl, 'up') === 'true', 'a wall with no connections has a post');

  reset();
  place(-1, 0, 0, 'oak_fence'); place(0, 0, 0, 'oak_fence'); place(1, 0, 0, 'oak_fence');
  let m = at(0, 0, 0);
  ok(pName(m, 'west') === 'true' && pName(m, 'east') === 'true', 'a fence connects to a fence');
  ok(pName(m, 'north') === 'false' && pName(m, 'south') === 'false', 'and only to the ones that are there');

  reset();
  place(0, 0, 0, 'oak_fence'); W.setBlock(1, 0, 0, def('stone'));
  ok(pName(at(0, 0, 0), 'east') === 'true', 'a fence connects to a solid block');
  reset();
  place(0, 0, 0, 'oak_fence'); W.setBlock(1, 0, 0, def('oak_leaves'));
  ok(pName(at(0, 0, 0), 'east') === 'false', 'a fence does NOT connect to leaves — isExceptionForConnection');
  reset();
  place(0, 0, 0, 'oak_fence'); place(1, 0, 0, 'nether_brick_fence');
  ok(pName(at(0, 0, 0), 'east') === 'false', 'a wooden fence does not connect to a nether brick fence');
  reset();
  place(0, 0, 0, 'oak_fence'); place(1, 0, 0, 'oak_fence_gate');
  ok(pName(at(0, 0, 0), 'east') === 'true', 'a fence connects to a gate across the gate axis');
  reset();
  place(0, 0, 0, 'oak_fence'); W.setBlock(0, 0, 1, B.setProp(def('oak_fence_gate'), 'facing', 'north'));
  ok(pName(at(0, 0, 0), 'south') === 'false', 'and not to one turned the other way');
  reset();
  place(0, 0, 0, 'oak_fence'); W.setBlock(0, 0, 1, B.setProp(def('oak_fence_gate'), 'facing', 'east'));
  ok(pName(at(0, 0, 0), 'south') === 'true', 'a gate facing east is walked through north-south, so it joins that line');

  // panes and bars
  reset();
  place(0, 0, 0, 'glass_pane'); place(1, 0, 0, 'glass_pane');
  ok(pName(at(0, 0, 0), 'east') === 'true' && pName(at(0, 0, 0), 'west') === 'false', 'panes attach to panes');
  reset();
  place(0, 0, 0, 'glass_pane'); place(1, 0, 0, 'iron_bars');
  ok(pName(at(0, 0, 0), 'east') === 'true', 'a pane attaches to iron bars');
  reset();
  place(0, 0, 0, 'iron_bars'); place(1, 0, 0, 'cobblestone_wall');
  ok(pName(at(0, 0, 0), 'east') === 'true', 'bars attach to a wall');
  ok(pName(at(1, 0, 0), 'west') !== 'none', 'and a wall connects to bars');

  // and the reverse direction: breaking the neighbour must disconnect it again
  reset();
  place(-1, 0, 0, 'oak_fence'); place(0, 0, 0, 'oak_fence');
  ok(pName(at(0, 0, 0), 'west') === 'true', 'connected before the break');
  W.setBlock(-1, 0, 0, 0);
  ok(pName(at(0, 0, 0), 'west') === 'false', 'a fence must disconnect when its neighbour is broken');

  // grass `snowy`, which is the same updateShape path
  reset();
  place(0, 0, 0, 'grass_block'); W.setBlock(0, 1, 0, def('snow'));
  ok(pName(at(0, 0, 0), 'snowy') === 'true', 'grass under snow is snowy');
  W.setBlock(0, 1, 0, 0);
  ok(pName(at(0, 0, 0), 'snowy') === 'false', 'and stops being snowy when the snow goes');

  for (const sn of ['snow_block', 'powder_snow']) for (const g of ['grass_block', 'mycelium', 'podzol']) {
    reset(); place(0, 0, 0, g); W.setBlock(0, 1, 0, def(sn));
    ok(pName(at(0, 0, 0), 'snowy') === 'true', g + ' under ' + sn + ' is snowy');
    W.setBlock(0, 1, 0, 0);
    ok(pName(at(0, 0, 0), 'snowy') === 'false', g + ' reverts when ' + sn + ' is broken');
  }

  // stairs
  reset();
  W.setBlock(0, 0, 0, B.setProp(B.setProp(def('oak_stairs'), 'facing', 'east'), 'half', 'bottom'));
  ok(pName(at(0, 0, 0), 'shape') === 'straight', 'a lone stair is straight');
  W.setBlock(1, 0, 0, B.setProp(B.setProp(def('oak_stairs'), 'facing', 'north'), 'half', 'bottom'));
  W.setBlock(0, 0, 0, B.updateShape(at(0, 0, 0), 0, 0, 0));
  ok(pName(at(0, 0, 0), 'shape') === 'outer_left',
     `an east stair in front of a north stair is outer_left, got ${pName(at(0, 0, 0), 'shape')}`);
  reset();
  W.setBlock(0, 0, 0, B.setProp(B.setProp(def('oak_stairs'), 'facing', 'east'), 'half', 'bottom'));
  W.setBlock(-1, 0, 0, B.setProp(B.setProp(def('oak_stairs'), 'facing', 'north'), 'half', 'bottom'));
  W.setBlock(0, 0, 0, B.updateShape(at(0, 0, 0), 0, 0, 0));
  ok(pName(at(0, 0, 0), 'shape') === 'inner_left',
     `an east stair behind a north stair is inner_left, got ${pName(at(0, 0, 0), 'shape')}`);
  console.log('   fence/wall/pane/bar/gate/stair/snowy, both making and breaking the connection');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. walls: LOW, TALL and the post (D-206)
console.log('4. wall side heights and the post');
{
  reset();
  place(-1, 0, 0, 'cobblestone_wall'); place(0, 0, 0, 'cobblestone_wall'); place(1, 0, 0, 'cobblestone_wall');
  let m = at(0, 0, 0);
  ok(pName(m, 'west') === 'low' && pName(m, 'east') === 'low', 'a wall in a straight line is low on both sides');
  ok(pName(m, 'up') === 'false', 'a wall in a straight line has NO post');
  ok(pName(at(-1, 0, 0), 'up') === 'true', 'the end of the line does have one');
  W.setBlock(0, 1, 0, def('stone'));
  m = at(0, 0, 0);
  ok(pName(m, 'west') === 'tall' && pName(m, 'east') === 'tall', 'a wall under a full block goes tall');
  ok(pName(m, 'up') === 'true', 'and grows its post back');
  W.setBlock(0, 1, 0, 0);
  ok(pName(at(0, 0, 0), 'west') === 'low', 'and comes back down when the block is removed');
  reset();
  place(0, 0, 0, 'cobblestone_wall'); place(1, 0, 0, 'cobblestone_wall');
  W.setBlock(0, 1, 0, def('oak_slab'));                 // a BOTTOM slab: sturdy on its down face
  ok(pName(at(0, 0, 0), 'east') === 'tall', 'a wall under a bottom slab is tall');
  console.log('   low/tall/post, from the real shape of the block above');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. placement
console.log('5. placement: waterlogged, and connected on arrival');
{
  reset();
  W.setBlock(0, 0, 0, B.setProp(def('water'), 'level', '0'));
  const slab = B.place(def('oak_slab'), 0, 0, 0);
  ok(pName(slab, 'waterlogged') === 'true', 'a slab placed into a water source arrives waterlogged');
  reset();
  const dry = B.place(def('oak_slab'), 0, 0, 0);
  ok(pName(dry, 'waterlogged') === 'false', 'and dry in air');
  reset();
  place(-1, 0, 0, 'oak_fence');
  const arriving = B.place(def('oak_fence'), 0, 0, 0);
  ok(pName(arriving, 'west') === 'true', 'a fence arrives already connected to what is next to it');
  reset();
  const noWater = B.place(def('stone'), 0, 0, 0);
  ok(noWater === def('stone'), 'a block with no waterlogged property is placed unchanged');
  console.log('   waterlogged from the fluid, connections from updateShape');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 6. PLAN's second acceptance: water down steps
console.log('6. fluids: the level at every step of the spread');
{
  const levelRow = (y, n, dz) => {
    const out = [];
    for (let x = 0; x <= n; x++) {
      const st = at(x, dz === undefined ? y : y, dz === undefined ? 0 : dz);
      out.push(st === 0 ? '.' : (S.block[st] === R.id.water || S.block[st] === R.id.lava ? pName(st, 'level') : '?'));
    }
    return out.join(' ');
  };
  reset(); floor(-1);
  W.setBlock(0, 0, 0, B.setProp(def('water'), 'level', '0'));
  for (let t = 0; t < 300; t++) B.tick();
  ok(levelRow(0, 8) === '0 1 2 3 4 5 6 7 .',
     `water on a flat floor should read 0 1 2 3 4 5 6 7 then stop; got "${levelRow(0, 8)}"`);

  reset(); floor(-1);
  W.setBlock(0, 0, 0, B.setProp(def('lava'), 'level', '0'));
  // lava's tick delay is 30, so three spread steps need 90 ticks; 300 is three times over.
  for (let t = 0; t < 300; t++) B.tick();
  ok(levelRow(0, 4) === '0 2 4 6 .',
     `overworld lava drops off 2 a step and reaches 3 blocks; got "${levelRow(0, 4)}"`);

  // the staircase. Each step is one down and one across, in a trench so the only way out is down.
  reset();
  for (let x = 0; x <= 8; x++) for (let y = -12; y <= -x - 1; y++) W.poke(x, y, 0, def('stone'));
  for (let x = -1; x <= 9; x++) for (let y = -12; y <= 2; y++) { W.poke(x, y, -1, def('stone')); W.poke(x, y, 1, def('stone')); }
  for (let y = -12; y <= 2; y++) W.poke(-1, y, 0, def('stone'));
  W.setBlock(0, 0, 0, B.setProp(def('water'), 'level', '0'));
  for (let t = 0; t < 400; t++) B.tick();
  let steps = 0, allFalling = true;
  for (let x = 1; x <= 8; x++) {
    const st = at(x, -x, 0);
    if (st === 0 || S.block[st] !== R.id.water) { allFalling = false; break; }
    // ⚠ 8 IS "FALLING", NOT "LEVEL 8". Vanilla packs the falling flag into the same property:
    // 0 is a source, 1..7 are the flowing strengths and 8 is falling. Water that has just landed
    // has water directly above it, so `getNewLiquid` returns the falling form.
    if (pName(st, 'level') !== '8') { allFalling = false; break; }
    steps++;
  }
  ok(steps === 8 && allFalling, `water reached ${steps} of 8 steps as falling water`);
  // and the property this really tests: falling resets the strength, so a staircase is not
  // limited to the seven blocks a flat floor is
  ok(at(8, -8, 0) !== 0, 'water must still be flowing at step 8 — falling resets the drop-off');

  // infinite water
  reset(); floor(-1);
  for (let x = -22; x <= 22; x++) for (let y = 0; y <= 3; y++) { W.poke(x, y, -1, def('stone')); W.poke(x, y, 1, def('stone')); }
  W.poke(-1, 0, 0, def('stone')); W.poke(3, 0, 0, def('stone'));
  W.setBlock(0, 0, 0, B.setProp(def('water'), 'level', '0'));
  W.setBlock(2, 0, 0, B.setProp(def('water'), 'level', '0'));
  for (let t = 0; t < 200; t++) B.tick();
  ok(blockAt(1, 0, 0) === 'water' && pName(at(1, 0, 0), 'level') === '0',
     'two water sources two apart must make a third between them');
  W.setBlock(0, 0, 0, 0);
  for (let t = 0; t < 200; t++) B.tick();
  ok(pName(at(1, 0, 0), 'level') === '0', 'and it survives when one of its parents is taken away');

  // lava must not do that
  reset(); floor(-1);
  for (let x = -22; x <= 22; x++) for (let y = 0; y <= 3; y++) { W.poke(x, y, -1, def('stone')); W.poke(x, y, 1, def('stone')); }
  W.poke(-1, 0, 0, def('stone')); W.poke(3, 0, 0, def('stone'));
  W.setBlock(0, 0, 0, B.setProp(def('lava'), 'level', '0'));
  W.setBlock(2, 0, 0, B.setProp(def('lava'), 'level', '0'));
  for (let t = 0; t < 300; t++) B.tick();
  ok(pName(at(1, 0, 0), 'level') !== '0', 'lava must NEVER make a new source in the overworld');

  // ── D-415: LAVA MEETS WATER ────────────────────────────────────────────────────────────
  // `LiquidBlock.shouldSpreadLiquid` (source -> obsidian, flowing -> cobblestone, looking at the
  // OPPOSITE of each flow direction) and `LavaFluid.spreadTo` (lava falling into water -> stone).
  // Before D-415 this engine had no lava/water interaction at all: the two fluids simply
  // overwrote each other and there was no way to make cobblestone or obsidian in the world.
  console.log('6b. lava meets water — obsidian, cobblestone and stone');
  {
    // a LAVA SOURCE with water directly above becomes OBSIDIAN
    reset(); floor(-1);
    W.poke(0, 0, 0, B.setProp(def('lava'), 'level', '0'));
    W.setBlock(0, 1, 0, B.setProp(def('water'), 'level', '0'));
    for (let t = 0; t < 40; t++) B.tick();
    ok(blockAt(0, 0, 0) === 'obsidian',
       `a lava SOURCE under water must become obsidian; got ${blockAt(0, 0, 0)}`);

    // a FLOWING lava block touched by water from the side becomes COBBLESTONE
    reset(); floor(-1);
    W.setBlock(0, 0, 0, B.setProp(def('lava'), 'level', '0'));
    for (let t = 0; t < 300; t++) B.tick();
    const flowed = at(2, 0, 0);
    ok(flowed !== 0 && S.block[flowed] === R.id.lava && pName(flowed, 'level') !== '0',
       'the lava flowed two blocks and is not a source there');
    W.setBlock(3, 0, 0, B.setProp(def('water'), 'level', '0'));
    for (let t = 0; t < 120; t++) B.tick();
    ok(blockAt(2, 0, 0) === 'cobblestone' || blockAt(3, 0, 0) === 'cobblestone',
       `flowing lava touched by water must become cobblestone; got ${blockAt(2, 0, 0)}/${blockAt(3, 0, 0)}`);

    // lava falling INTO water becomes STONE — a different rule, and a different block
    reset(); floor(-4);
    for (let y = -3; y <= 0; y++) { W.poke(-1, y, 0, def('stone')); W.poke(1, y, 0, def('stone'));
                                    W.poke(0, y, -1, def('stone')); W.poke(0, y, 1, def('stone')); }
    W.poke(0, -3, 0, B.setProp(def('water'), 'level', '0'));
    W.setBlock(0, 0, 0, B.setProp(def('lava'), 'level', '0'));
    for (let t = 0; t < 120; t++) B.tick();
    ok(blockAt(0, -3, 0) === 'stone',
       `lava falling into water must make stone, not obsidian or cobblestone; got ${blockAt(0, -3, 0)}`);

    // ⚠ ANTI-VACUITY (D-30): break the rule's input and the assertions above must fail.
    // Water that is BELOW the lava is the case vanilla deliberately ignores — `d.getOpposite()`
    // — so a check that "any adjacent water turns lava to stone" would light up here and this
    // one must not.
    reset(); floor(-4);
    for (let y = -3; y <= 0; y++) { W.poke(-1, y, 0, def('stone')); W.poke(1, y, 0, def('stone')); }
    W.poke(0, 1, 0, def('stone'));                    // cap it so nothing falls in from above
    W.poke(0, -1, 0, def('stone'));                   // and a floor under the lava
    W.poke(0, -2, 0, B.setProp(def('water'), 'level', '0'));
    W.setBlock(0, 0, 0, B.setProp(def('lava'), 'level', '0'));
    for (let t = 0; t < 60; t++) B.tick();
    ok(blockAt(0, 0, 0) === 'lava',
       `water two below a capped lava source must NOT turn it to anything; got ${blockAt(0, 0, 0)}`);
  }

  // and a pool drains completely when its source is removed
  reset(); floor(-1);
  W.setBlock(0, 0, 0, B.setProp(def('water'), 'level', '0'));
  for (let t = 0; t < 300; t++) B.tick();
  ok(at(5, 0, 0) !== 0, 'the pool formed before the drain test');
  W.setBlock(0, 0, 0, 0);
  for (let t = 0; t < 400; t++) B.tick();
  let wet = 0;
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) if (at(x, 0, z) !== 0) wet++;
  ok(wet === 0, `${wet} cells are still wet after the source was removed`);
  console.log('   flat 0..7 · lava 0/2/4/6 · an 8-step staircase · an infinite source · a full drain');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. PLAN's third acceptance: a crop, all 8 stages
console.log('7. random ticks');
{
  const farm = (moist) => {
    reset();
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) W.poke(x, -1, z, B.setProp(def('farmland'), 'moisture', moist));
  };
  farm(7);
  W.poke(0, 0, 0, def('wheat'));
  const r = rng(4242);
  const ages = [];
  for (let t = 0; t < 20000; t++) {
    B.randomTick(0, 0, 0, r);
    const a = +pName(at(0, 0, 0), 'age');
    if (ages[ages.length - 1] !== a) ages.push(a);
    if (a === 7) break;
  }
  ok(ages.join(',') === '0,1,2,3,4,5,6,7', `wheat must pass through all eight ages in order; got ${ages.join(',')}`);
  ok(B.maxAge(R.id.wheat) === 7, 'wheat has eight ages');
  ok(B.maxAge(R.id.beetroots) === 3, 'beetroot has four');

  // growth SPEED is the nine-cell farmland rule, and moist ground is three times a dry one
  const ticksToRipe = (moist, seed) => {
    farm(moist);
    W.poke(0, 0, 0, def('wheat'));
    const rr = rng(seed);
    let n = 0;
    while (+pName(at(0, 0, 0), 'age') < 7 && n < 200000) { B.randomTick(0, 0, 0, rr); n++; }
    return n;
  };
  let moistTotal = 0, dryTotal = 0;
  const SEEDS = 12;
  for (let s = 1; s <= SEEDS; s++) { moistTotal += ticksToRipe(7, s * 7919); dryTotal += ticksToRipe(0, s * 7919); }
  ok(dryTotal > moistTotal * 1.5,
     `dry farmland must be markedly slower: ${(dryTotal / SEEDS).toFixed(1)} vs ${(moistTotal / SEEDS).toFixed(1)} random ticks`);

  // and nothing grows below light 9
  farm(7);
  W.poke(0, 0, 0, def('wheat'));
  for (let x = -3; x <= 3; x++) for (let y = -1; y <= 2; y++) for (let z = -3; z <= 3; z++) W.setLight(x, y, z, 8);
  for (let t = 0; t < 5000; t++) B.randomTick(0, 0, 0, r);
  ok(pName(at(0, 0, 0), 'age') === '0', 'a crop must not grow in light 8');

  // leaf decay: distance counts out from the log, and 7 dies
  reset();
  W.poke(0, 0, 0, def('oak_log'));
  for (let d = 1; d <= 8; d++) W.poke(d, 0, 0, B.setProp(def('oak_leaves'), 'distance', 7));
  for (let p2 = 0; p2 < 10; p2++) for (let d = 1; d <= 8; d++) W.setBlock(d, 0, 0, B.updateLeafDistance(at(d, 0, 0), d, 0, 0));
  ok([1, 2, 3, 4, 5, 6].every((d) => pName(at(d, 0, 0), 'distance') === String(d)),
     'leaf distance must count outwards from the log');
  for (let p3 = 0; p3 < 20; p3++) for (let d = 1; d <= 8; d++) B.randomTick(d, 0, 0, r);
  ok(at(7, 0, 0) === 0 && at(8, 0, 0) === 0, 'leaves at distance 7 must decay');
  ok(at(6, 0, 0) !== 0, 'and leaves at distance 6 must not');
  reset();
  W.poke(0, 0, 0, B.setProp(B.setProp(def('oak_leaves'), 'distance', 7), 'persistent', 'true'));
  for (let p4 = 0; p4 < 50; p4++) B.randomTick(0, 0, 0, r);
  ok(at(0, 0, 0) !== 0, 'a PERSISTENT leaf never decays, whatever its distance');
  // D-517 — vanilla's random tick ONLY removes a distance-7 leaf; it never re-counts. A leaf
  // whose stored distance is stale (3, standing next to a log) is left exactly as it is.
  reset();
  W.poke(0, 0, 0, def('oak_log'));
  W.poke(1, 0, 0, B.setProp(def('oak_leaves'), 'distance', 3));
  const stale = at(1, 0, 0);
  for (let p5 = 0; p5 < 200; p5++) B.randomTick(1, 0, 0, r);
  ok(at(1, 0, 0) === stale, 'a random tick rewrote a leaf that was not at distance 7 — vanilla randomTick never re-counts (D-517)');
  // ...and the re-count happens where vanilla puts it: a neighbour change schedules a 1-tick update.
  // Fell the log under a correctly-counted branch: the canopy re-counts to 7 on scheduled ticks
  // alone, then decays on random ticks.
  reset();
  W.poke(0, 0, 0, def('oak_log'));
  for (let d = 1; d <= 4; d++) W.poke(d, 0, 0, B.setProp(def('oak_leaves'), 'distance', d));
  W.setBlock(0, 0, 0, 0);
  for (let t = 0; t < 20; t++) B.tick();
  ok([1, 2, 3, 4].every((d) => pName(at(d, 0, 0), 'distance') === '7'),
     'felling the log did not re-count the branch to 7 through scheduled ticks (LeavesBlock.getStateForNeighborUpdate, D-517)');
  for (let p6 = 0; p6 < 30; p6++) for (let d = 1; d <= 4; d++) B.randomTick(d, 0, 0, r);
  ok([1, 2, 3, 4].every((d) => at(d, 0, 0) === 0), 'the felled branch did not decay');
  // and an UNTOUCHED counted branch is never rewritten by its neighbours' scheduled ticks
  reset();
  W.poke(0, 0, 0, def('oak_log'));
  for (let d = 1; d <= 3; d++) W.poke(d, 0, 0, B.setProp(def('oak_leaves'), 'distance', d));
  const before = [1, 2, 3].map((d) => at(d, 0, 0));
  W.setBlock(0, 1, 0, def('stone'));                      // an unrelated neighbour change
  for (let t = 0; t < 20; t++) B.tick();
  ok([1, 2, 3].every((d, i) => at(d, 0, 0) === before[i]) && B.scheduled() === 0,
     'a correctly-counted branch kept re-scheduling itself after an unrelated change (ping-pong, D-517)');

  // grass: spreads onto dirt in the light, dies under a cover
  reset(); floor(-1);
  W.poke(0, 0, 0, def('grass_block'));
  for (let d = 1; d <= 3; d++) W.poke(d, 0, 0, def('dirt'));
  for (let x = -3; x <= 6; x++) for (let z = -3; z <= 3; z++) W.poke(x, -1, z, def('dirt'));
  let spread = 0;
  for (let t = 0; t < 4000 && spread === 0; t++) { B.randomTick(0, 0, 0, r); if (blockAt(1, 0, 0) === 'grass_block') spread = t + 1; }
  ok(spread > 0, 'grass must spread onto neighbouring dirt');
  reset();
  W.poke(0, 0, 0, def('grass_block'));
  W.poke(0, 1, 0, def('stone'));
  let died = false;
  for (let t = 0; t < 500 && !died; t++) { B.randomTick(0, 0, 0, r); died = blockAt(0, 0, 0) === 'dirt'; }
  ok(died, 'grass under an opaque block must turn back into dirt');

  // farmland dries out and reverts
  reset();
  W.poke(0, 0, 0, B.setProp(def('farmland'), 'moisture', 3));
  for (let t = 0; t < 10; t++) B.randomTick(0, 0, 0, r);
  ok(blockAt(0, 0, 0) === 'dirt', 'dry farmland with nothing planted on it turns back into dirt');
  reset();
  W.poke(0, 0, 0, B.setProp(def('farmland'), 'moisture', 0));
  W.poke(2, 0, 0, B.setProp(def('water'), 'level', '0'));
  B.randomTick(0, 0, 0, r);
  ok(pName(at(0, 0, 0), 'moisture') === '7', 'farmland next to water is fully moist');

  // sugar cane grows to three and stops
  reset();
  W.poke(0, -1, 0, def('dirt'));
  W.poke(0, 0, 0, def('sugar_cane'));
  for (let t = 0; t < 4000; t++) B.randomTick(0, 0, 0, r), B.randomTick(0, 1, 0, r), B.randomTick(0, 2, 0, r);
  ok(blockAt(0, 1, 0) === 'sugar_cane' && blockAt(0, 2, 0) === 'sugar_cane', 'sugar cane grows to three tall');
  ok(blockAt(0, 3, 0) === 'air', 'and stops at three');

  // ice melts by BLOCK light on its own cell (IceBlock.randomTick: > 11 - opacity; the referee: meltrefcheck) —
  // it used to melt in the DARK, the rule upside down. Both directions: a dark cell keeps it, a lit one melts it.
  reset();
  W.poke(0, -1, 0, def('stone'));
  W.poke(0, 0, 0, def('ice'));
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) W.setLight(x, y, z, 0);
  B.randomTick(0, 0, 0, r);
  ok(blockAt(0, 0, 0) === 'ice', 'ice in the dark stays ice');
  for (let x = -2; x <= 2; x++) for (let y = -2; y <= 2; y++) for (let z = -2; z <= 2; z++) W.setLight(x, y, z, 15);
  B.randomTick(0, 0, 0, r);
  ok(blockAt(0, 0, 0) === 'water', 'ice over a block melts into water in block light');
  console.log('   wheat 0..7 · moist vs dry · dark · leaf decay · grass · farmland · cane · ice');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 8. PLAN's fourth acceptance: fire goes out
console.log('8. fire');
{
  const r = rng(31337);
  B.rng = r;
  reset();
  W.poke(0, -1, 0, def('stone'));
  W.setBlock(0, 0, 0, def('fire'));
  ok(B.scheduled() > 0, 'placing fire must schedule it — fire is a scheduled tick, not a random one');
  let out = -1;
  for (let t = 0; t < 4000 && out < 0; t++) { B.tick(); if (at(0, 0, 0) === 0) out = t; }
  ok(out > 0, 'fire on stone with nothing to burn must go out');
  ok(out > 30, `and not on its first tick: it went out at ${out}`);

  reset();
  W.poke(0, -1, 0, def('oak_planks'));
  W.setBlock(0, 0, 0, def('fire'));
  // vanilla (FireBlock.trySpreadingFire): the fire lives as long as its planks do, and CONSUMES them — the referee's
  // planks1 scene burns the plank away in 6 of 6 server runs inside 1200 ticks (firerefcheck)
  let diedFirst = false, eaten = -1;
  for (let t = 0; t < 4000 && eaten < 0; t++) {
    B.tick();
    if (at(0, -1, 0) !== def('oak_planks')) eaten = t;
    else if (at(0, 0, 0) === 0) diedFirst = true;
  }
  ok(!diedFirst, 'fire on planks must keep burning while the planks are there');
  ok(eaten > 30, `and the fire must burn the planks away (vanilla), not on its first tick: gone at ${eaten}`);

  reset();
  W.setBlock(0, 0, 0, def('fire'));
  for (let t = 0; t < 200; t++) B.tick();
  ok(at(0, 0, 0) === 0, 'fire with nothing under it and nothing to burn cannot survive at all');
  ok(B.canBurn(def('oak_planks')) && B.canBurn(def('oak_log')) && B.canBurn(def('white_wool')),
     'planks, logs and wool must be burnable');
  ok(!B.canBurn(def('stone')) && !B.canBurn(def('cobblestone')) && !B.canBurn(0),
     'stone, cobblestone and air must not');
  B.rng = null;
  console.log('   goes out on stone, survives on planks, cannot stand on nothing');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 9. block entities
console.log('9. block entities: the store follows the block');
{
  reset();
  ok(BE.missing.length === 0, `${BE.missing.length} named block-entity blocks are not in the registry: ${BE.missing.join(' ')}`);
  ok(BE.typeCount === 34, `${BE.typeCount} block-entity types, expected 1.18.2's 34 (D-208)`);
  ok(BE.typeOf(R.id.chest) === 'chest' && BE.typeOf(R.id.furnace) === 'furnace', 'chests and furnaces have one');
  ok(BE.typeOf(R.id.oak_sign) === 'sign' && BE.typeOf(R.id.oak_wall_sign) === 'sign', 'every sign has one, through the tag');
  ok(BE.typeOf(R.id.red_bed) === 'bed' && BE.typeOf(R.id.white_banner) === 'banner', 'beds and banners, through their tags');
  ok(BE.typeOf(R.id.stone) === undefined && BE.typeOf(R.id.dirt) === undefined, 'and stone and dirt do not');

  W.setBlock(0, 0, 0, def('chest'));
  const e = BE.get(0, 0, 0);
  ok(!!e && e.type === 'chest', 'placing a chest creates its block entity');
  ok(e.items.length === 27, 'a chest has 27 slots');
  e.items[0] = { item: 'diamond', count: 5 };
  ok(BE.get(0, 0, 0).items[0].count === 5, 'and the store keeps what is put in it');
  W.setBlock(0, 0, 0, 0);
  ok(BE.get(0, 0, 0) === undefined, 'breaking the block must destroy the entity — or its contents outlive it');
  W.setBlock(0, 0, 0, def('furnace'));
  ok(BE.get(0, 0, 0).type === 'furnace', 'and a different block gets a different entity');
  W.setBlock(0, 0, 0, def('chest'));
  ok(BE.get(0, 0, 0).type === 'chest', 'replacing one type with another swaps the entity');
  ok(BE.count() === 1, `${BE.count()} entities in the store, expected 1`);

  // ── THE FURNACE, AGAINST G9'S OWN TABLES (D-289) ─────────────────────────────────────────
  // ⚠ NO STUBS. Every number below comes from the game's own data: the recipe out of
  // `recipes.bin` and the 1600-tick coal out of the compiled-Java fuel map (D-269). The previous
  // version of this section supplied its own `smeltResult` and `fuelValue`, which is how a
  // furnace that could never smelt sat behind a green assertion for two stages.
  const IT = MCL.Items, Iv = MCL.Inventory, RC = MCL.Recipes;
  ok(RC.ready === true, 'G9\'s recipe table loaded');
  ok(!!RC.fuel, 'and the fuel map with it');
  ok(BE.smeltResult === undefined && BE.fuelValue === undefined,
     'the unfilled hooks are DELETED, not left beside the real lookup (D-139)');
  reset();
  W.setBlock(0, 0, 0, def('furnace'));
  const f = BE.get(0, 0, 0);
  f.items[0] = Iv.stack('raw_iron', 3);
  f.items[1] = Iv.stack('coal', 1);
  ok(!!f.items[0] && !!f.items[1], 'the slots hold Inventory stacks, the same shape the player has');
  // what the real tables say, asserted here so the ticks below are checked against data
  const rec = RC.cookingFor(f.items[0], RC.SMELTING);
  ok(!!rec && IT.nameOf(rec.result.i) === 'iron_ingot', 'raw_iron smelts to iron_ingot, per the jar');
  ok(rec.time === 200, `the recipe's own cook time is ${rec && rec.time}, vanilla says 200`);
  ok(RC.fuelTime(f.items[1]) === 1600, `coal burns ${RC.fuelTime(f.items[1])} ticks, vanilla says 1600`);
  for (let t = 0; t < 200; t++) BE.tick();
  ok(f.items[1] === null, 'the fuel is consumed when the furnace lights');
  // ⚠ 1401, NOT 1400. Vanilla decrements `litTime` at the TOP of the tick and lights the furnace
  // below that, so the tick a furnace lights on does not spend any of its fuel: 1600 - 199.
  ok(f.burnTime === 1600 - 199, `burnTime should be 1600 - 199 = 1401, it is ${f.burnTime}`);
  ok(f.items[2] && IT.nameOf(f.items[2].i) === 'iron_ingot' && f.items[2].n === 1,
     'one ingot after exactly 200 ticks — the cook time comes from the recipe');
  ok(f.items[0].n === 2, 'and one input was spent');
  for (let t = 0; t < 200; t++) BE.tick();
  ok(f.items[2].n === 2, 'a second ingot after another 200');
  // D-414: the experience is a LEDGER of recipes used (`recipesUsed`, paid out when the output is
  // taken — furnacecheck §3/§4), not a running float: two smelts of one recipe are one entry, n 2.
  const led = Object.values(f.recipesUsed || {});
  ok(led.length === 1 && led[0].n === 2 && led[0].xp > 0,
     `and the smelts banked their experience on the recipe ledger, ${JSON.stringify(f.recipesUsed)}`);

  // ⚠ A BLAST FURNACE DOES NOT INHERIT THE SMELTING RECIPE. Vanilla has no fallback: the recipe
  // must itself be tagged `blasting`. Ore blasts; food does not, and a fallback would cook it.
  reset();
  W.setBlock(0, 0, 0, def('blast_furnace'));
  const bf = BE.get(0, 0, 0);
  bf.items[0] = Iv.stack('raw_iron', 1);
  bf.items[1] = Iv.stack('coal', 1);
  const blast = RC.cookingFor(bf.items[0], RC.BLASTING);
  ok(!!blast, 'raw_iron has a blasting recipe of its own');
  ok(blast.time === 100, `and it is twice as fast: ${blast && blast.time} ticks against the furnace's 200`);
  ok(RC.cookingFor(Iv.stack('porkchop', 1), RC.BLASTING) === null,
     'a porkchop has NO blasting recipe — a blast furnace that cooks food is a fallback that should not exist');
  ok(RC.cookingFor(Iv.stack('porkchop', 1), RC.SMOKING) !== null, '...while a smoker has one');

  // ⚠ A FULL OUTPUT SLOT STOPS THE FURNACE (`AbstractFurnaceBlockEntity.canBurn`, D-414). This
  // section used to assert the OPPOSITE — "64 -> 62, and it is still lit" — which was a furnace that
  // smelted two ingots into a slot with no room and threw them away, written down as a requirement.
  // The real rule: it does not light, does not spend the coal, does not touch the input. One short
  // of full, it smelts exactly one more and then stops (furnacecheck §5 has the rest).
  reset();
  W.setBlock(0, 0, 0, def('furnace'));
  const g2 = BE.get(0, 0, 0);
  g2.items[0] = Iv.stack('raw_iron', 64);
  g2.items[1] = Iv.stack('coal', 64);
  g2.items[2] = Iv.stack('iron_ingot', 64);
  for (let t = 0; t < 400; t++) BE.tick();
  ok(g2.items[2].n === 64 && g2.items[0].n === 64 && g2.items[1].n === 64 && !(g2.burnTime > 0),
     `a full output slot stops the furnace outright: ingots ${g2.items[2].n}, input ${g2.items[0].n}, coal ${g2.items[1].n}, burn ${g2.burnTime}`);
  reset();
  W.setBlock(0, 0, 0, def('furnace'));
  const g3 = BE.get(0, 0, 0);
  g3.items[0] = Iv.stack('raw_iron', 64);
  g3.items[1] = Iv.stack('coal', 64);
  g3.items[2] = Iv.stack('iron_ingot', 63);
  for (let t = 0; t < 400; t++) BE.tick();
  // ⚠ AND IT RAN — anti-vacuity for the assertions above: with ONE free place the same furnace
  // lights, spends coal and eats exactly one input, so the refusal above is the slot's doing.
  ok(g3.items[2].n === 64 && g3.items[0].n === 63 && g3.items[1].n === 63,
     `with one free place it smelts exactly one: ingots ${g3.items[2].n}, input ${g3.items[0].n}, coal ${g3.items[1].n}`);
  console.log(`   ${BE.typeCount} types · create, swap, destroy · a furnace smelting to the tick, on G9's tables`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 10. the scheduler (what G15 will hang off)
console.log('10. the tick scheduler');
{
  reset();
  B.clearSchedule();
  const order = [];
  const realTick = B.scheduledTick;
  B.scheduledTick = (x) => order.push(x);
  B.schedule(1, 0, 0, 5, 0);
  B.schedule(2, 0, 0, 3, 0);
  B.schedule(3, 0, 0, 5, -1);           // same tick, higher priority (lower number first)
  B.schedule(4, 0, 0, 5, 0);            // same tick and priority, later insertion
  for (let t = 0; t < 6; t++) B.tick();
  ok(order.join(',') === '2,3,1,4', `scheduled ticks must run by (tick, priority, insertion); got ${order.join(',')}`);
  B.clearSchedule();
  ok(B.schedule(9, 0, 0, 4) === true, 'a first schedule is accepted');
  ok(B.schedule(9, 0, 0, 9) === false, 'a later duplicate for the same position is dropped');
  B.scheduledTick = realTick;
  console.log('   ordering by tick, then priority, then insertion; duplicates collapsed');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 11. anti-vacuity (D-30)
console.log('11. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  // ⚠ ONE ENGINE PER BREAK, A FRESH WORLD PER ARM, and the clean arm runs FIRST. Decoding the
  // roster is 254 ms and there are seven breaks; an engine per arm cost 1.8 s to prove nothing
  // extra. The engine is never the one the sections above used, so a mutation cannot leak
  // backwards, and the world is rebuilt for each arm so the two start identical.
  let ENGINE = null;
  const brk = (label, judge, run) => {
    ENGINE = withItems(loadEngine({ extra: EXTRA, dom: false }));
    const clean = judge(run(false)) === true;
    const dirty = judge(run(true)) === false;
    av.push([label, clean && dirty]);
  };
  const scene = () => {
    const M = ENGINE;
    const w = makeWorld(M);
    return { M, w, d: (n) => M.Reg.realFirst[M.Reg.id[n]] + M.Reg.defaultState[M.Reg.id[n]] };
  };

  brk('faceSturdy answering "opaque" instead of "the face is covered"', (e) => e === 'false', (broken) => {
    const { M, w, d } = scene();
    if (broken) M.Behave.faceSturdy = (st) => st !== 0 && M.States.opaque[st] === 1;
    w.setBlock(0, 0, 0, M.Behave.place(d('oak_fence'), 0, 0, 0));
    // a BOTTOM slab is opaque by material but has no sturdy east face, so a fence must not
    // connect to it — this is exactly the substitution D-205 refused
    w.setBlock(1, 0, 0, d('oak_slab'));
    return M.Behave.propName(w.getBlock(0, 0, 0), 'east');
  });

  brk('a fence and a wall wired to connect to each other', (e) => e === 'false', (broken) => {
    const { M, w, d } = scene();
    if (broken) M.Behave.updateShape = (st) => M.Behave.setProp(st, 'east', 'true');
    w.setBlock(0, 0, 0, M.Behave.place(d('oak_fence'), 0, 0, 0));
    w.setBlock(1, 0, 0, M.Behave.place(d('cobblestone_wall'), 1, 0, 0));
    return M.Behave.propName(w.getBlock(0, 0, 0), 'east');
  });

  // D-488: a lavafall must SETTLE. The falling column spreads sideways at 7 (vanilla's
  // `if FALLING -> 7`) and the side cell's own tick settles it to 8-2 = 6; with a fluid allowed to
  // write into its own fluid the two re-wrote each other every 30 ticks for ever.
  brk('a fluid writing into its own fluid (the lavafall that never settles)', (n) => n === 0, (broken) => {
    const { M, w, d } = scene();
    for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) w.poke(x, -1, z, d('stone'));
    for (let y = 0; y <= 4; y++) w.poke(0, y, 0, d('stone'));
    if (broken) M.Behave.SAME_FLUID_REFUSES = false;
    w.setBlock(0, 5, 0, M.Behave.setProp(d('lava'), 'level', '0'));
    for (let t = 0; t < 1200; t++) M.Behave.tick();
    let writes = 0; const realSet = w.setBlock;
    w.setBlock = function () { writes++; return realSet.apply(w, arguments); };
    for (let t = 0; t < 300; t++) M.Behave.tick();
    w.setBlock = realSet;
    return writes;
  });

  brk('water spreading with no drop-off', (row) => row === '0 1 2 3 4 5 6 7 .', (broken) => {
    const { M, w, d } = scene();
    for (let x = -22; x <= 22; x++) for (let z = -22; z <= 22; z++) w.poke(x, -1, z, d('stone'));
    if (broken) {
      // the fluid's own spread, with the strength never decreasing: an ocean instead of a puddle
      const realSet = w.setBlock;
      w.setBlock = function (x, y, z, id) {
        if (id !== 0 && M.States.block[id] === M.Reg.id.water) id = M.Behave.setProp(id, 'level', '1');
        return realSet.call(w, x, y, z, id);
      };
    }
    w.setBlock(0, 0, 0, M.Behave.setProp(d('water'), 'level', '0'));
    for (let t = 0; t < 300; t++) M.Behave.tick();
    const out = [];
    for (let x = 0; x <= 8; x++) {
      const st = w.getBlock(x, 0, 0);
      out.push(st === 0 ? '.' : M.Behave.propName(st, 'level'));
    }
    return out.join(' ');
  });

  brk('a crop that skips straight to ripe', (ages) => ages === '0,1,2,3,4,5,6,7', (broken) => {
    const { M, w, d } = scene();
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) w.poke(x, -1, z, M.Behave.setProp(d('farmland'), 'moisture', 7));
    w.poke(0, 0, 0, d('wheat'));
    const r = rng(4242);
    const seen = [];
    for (let t = 0; t < 20000; t++) {
      if (broken) w.setBlock(0, 0, 0, M.Behave.setProp(w.getBlock(0, 0, 0), 'age', 7));
      else M.Behave.randomTick(0, 0, 0, r);
      const a = +M.Behave.propName(w.getBlock(0, 0, 0), 'age');
      if (seen[seen.length - 1] !== a) seen.push(a);
      if (a === 7) break;
    }
    return seen.join(',');
  });

  brk('a leaf distance that never updates', (gone) => gone === true, (broken) => {
    const { M, w, d } = scene();
    w.poke(0, 0, 0, d('oak_log'));
    for (let i = 1; i <= 8; i++) w.poke(i, 0, 0, M.Behave.setProp(d('oak_leaves'), 'distance', 7));
    // the mutation is one layer down, in the state-space primitive the rule is built on: with
    // `withProp` inert, no leaf can record how far it is from a log, they all stay at 7, and the
    // whole branch decays instead of just its far end
    if (broken) M.States.withProp = (st) => st;
    for (let p2 = 0; p2 < 10; p2++) for (let i = 1; i <= 8; i++) w.setBlock(i, 0, 0, M.Behave.updateLeafDistance(w.getBlock(i, 0, 0), i, 0, 0));
    const r = rng(11);
    for (let p3 = 0; p3 < 20; p3++) for (let i = 1; i <= 8; i++) M.Behave.randomTick(i, 0, 0, r);
    // the un-mutated build kills 7 and 8 and keeps 6; the mutant kills everything, because every
    // leaf is still at distance 7
    return w.getBlock(7, 0, 0) === 0 && w.getBlock(6, 0, 0) !== 0;
  });

  brk('leaves that never hear their log was felled (no neighbour-update schedule, D-517)', (gone) => gone === true, (broken) => {
    const { M, w, d } = scene();
    w.poke(0, 0, 0, d('oak_log'));
    for (let i = 1; i <= 3; i++) w.poke(i, 0, 0, M.Behave.setProp(d('oak_leaves'), 'distance', i));
    if (broken) M.Behave.schedule = () => false;
    w.setBlock(0, 0, 0, 0);
    for (let t = 0; t < 20; t++) M.Behave.tick();
    const r = rng(12);
    for (let p = 0; p < 30; p++) for (let i = 1; i <= 3; i++) M.Behave.randomTick(i, 0, 0, r);
    return [1, 2, 3].every((i) => w.getBlock(i, 0, 0) === 0);
  });

  brk('fire that never ages, and so never goes out', (out) => out === true, (broken) => {
    const { M, w, d } = scene();
    M.Behave.rng = rng(31337);
    w.poke(0, -1, 0, d('stone'));
    // fire on a non-burnable floor dies once its AGE passes 3; freeze the age and it burns for
    // ever on a stone slab, which is exactly the acceptance PLAN names
    if (broken) M.States.withProp = (st) => st;
    w.setBlock(0, 0, 0, d('fire'));
    for (let t = 0; t < 4000; t++) { M.Behave.tick(); if (w.getBlock(0, 0, 0) === 0) return true; }
    return false;
  });

  // ── the furnace, wired to G9 for the first time (D-289) ─────────────────────────────────
  brk('a furnace merging past the output stack size, making items out of nothing',
      (n) => n === 64, (broken) => {
    const { M, w, d } = scene();
    if (broken) M.Items.maxStack = () => 1e9;          // the cap removed
    w.setBlock(0, 0, 0, d('furnace'));
    const e = M.BlockEntities.get(0, 0, 0);
    e.items[0] = M.Inventory.stack('raw_iron', 64);
    e.items[1] = M.Inventory.stack('coal', 64);
    e.items[2] = M.Inventory.stack('iron_ingot', 64);
    for (let t = 0; t < 400; t++) M.BlockEntities.tick();
    return e.items[2].n;
  });

  brk('the furnace running on a two-item stub instead of G9\'s table',
      (name) => name === 'glass', (broken) => {
    // the state this section was in for two stages. A stub answers for the one item it was
    // written for; the real table answers for hundreds, so asking about a THIRD item is what
    // tells them apart — and nothing in the old check ever asked.
    const M = ENGINE;
    if (broken) {
      const real = M.Recipes.cookingFor;
      M.Recipes.cookingFor = (stack, t) =>
        (M.Items.nameOf(stack.i) === 'raw_iron' ? real.call(M.Recipes, stack, t) : null);
    }
    const r = M.Recipes.cookingFor(M.Inventory.stack('sand', 1), M.Recipes.SMELTING);
    return r ? M.Items.nameOf(r.result.i) : null;
  });

  brk('a blast furnace falling back to the smelting recipe',
      (t) => t === null, (broken) => {
    // vanilla has NO inheritance: a porkchop has a smoking recipe and no blasting one. A
    // fallback would cook food in a blast furnace and no count of anything would notice.
    const M = ENGINE;
    const pork = M.Inventory.stack('porkchop', 1);
    const r = M.Recipes.cookingFor(pork, M.Recipes.BLASTING)
          || (broken ? M.Recipes.cookingFor(pork, M.Recipes.SMELTING) : null);
    return r ? r.time : null;
  });

  brk('a block entity left behind when its block is broken', (gone) => gone === true, (broken) => {
    const { M, w, d } = scene();
    w.setBlock(0, 0, 0, d('chest'));
    if (broken) M.BlockEntities.onChanged = () => {};
    w.setBlock(0, 0, 0, 0);
    return M.BlockEntities.get(0, 0, 0) === undefined;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" is not distinguished from correct behaviour`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('=============== behavcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
