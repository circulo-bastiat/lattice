#!/usr/bin/env node
// behaviour07bcheck.mjs — #11481: stages that exercise 07b_behaviour.js classes no stage cited, through the real
// path (Behave.place / updateShape / changed / tick / randomTick on a hand-built world, the shipped rules).
// Classes: AbstractPlantPartBlock, AttachedStemBlock, BambooBlock, BambooSaplingBlock, BrewingStandBlock, CocoaBlock,
// FenceBlock, FenceGateBlock, ScaffoldingBlock, SnowyBlock, SoulFireBlock, TrapdoorBlock, WallBlock, StairShape,
// Fluid, FluidState, LavaFluid, WaterFluid, State, WorldTickScheduler.
// Anti-vacuity: each rule is cut in the real source text (loadEngine patch) and the matching scene must go wrong.
import { loadEngine } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js'];
const FILE = '07b_behaviour.js';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  const R = M.Reg, S = M.States, B = M.Behave, N = 48, MID = 24;
  const cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
  const W = {
    getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
    setBlock(x, y, z, id) { if (!inside(x, y, z)) return false; const old = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, old); return true; },
    poke(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; },
    blockLightAt: () => 15,
  };
  B.init(W); M.BlockEntities.init(); B.clearSchedule();
  const events = []; M.GameEvent = { ...(M.GameEvent || {}), emit: (e) => events.push(e) };
  const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
  const sp = (n, kv) => Object.entries(kv).reduce((s, [k, v]) => B.setProp(s, k, v), def(n));
  const pn = (st, p) => B.propName(st, p);
  const at = (x, y, z) => W.getBlock(x, y, z);
  const nm = (x, y, z) => (at(x, y, z) === 0 ? 'air' : R.names[S.block[at(x, y, z)]]);
  const reset = () => { cells.fill(0); B.clearSchedule(); M.BlockEntities.clear && M.BlockEntities.clear(); };
  const place = (x, y, z, n) => W.setBlock(x, y, z, B.place(def(n), x, y, z));
  const row = (n) => { const o = []; for (let x = 0; x <= n; x++) { const s = at(x, 0, 0); o.push(s === 0 ? '.' : pn(s, 'level')); } return o.join(' '); };
  const floor = () => { for (let x = -22; x <= 22; x++) for (let z = -22; z <= 22; z++) W.poke(x, -1, z, def('stone')); };
  const r = {};

  // FenceBlock / WallBlock / FenceGateBlock
  reset(); place(0, 0, 0, 'oak_fence'); W.setBlock(1, 0, 0, def('stone'));
  r.fenceSolid = pn(at(0, 0, 0), 'east') === 'true';
  reset(); place(0, 0, 0, 'oak_fence'); W.setBlock(0, 0, 1, sp('oak_fence_gate', { facing: 'east' }));
  r.gateAcross = pn(at(0, 0, 0), 'south') === 'true';
  reset(); place(0, 0, 0, 'oak_fence'); W.setBlock(0, 0, 1, sp('oak_fence_gate', { facing: 'north' }));
  r.gateNotAcross = pn(at(0, 0, 0), 'south') === 'false';
  reset(); place(0, 0, 0, 'cobblestone_wall'); place(1, 0, 0, 'cobblestone_wall');
  r.wallWall = pn(at(0, 0, 0), 'east') === 'low';
  // StairShape
  reset(); W.setBlock(0, 0, 0, sp('oak_stairs', { facing: 'east', half: 'bottom' }));
  W.setBlock(1, 0, 0, sp('oak_stairs', { facing: 'north', half: 'bottom' }));
  W.setBlock(0, 0, 0, B.updateShape(at(0, 0, 0), 0, 0, 0));
  r.stairOuter = pn(at(0, 0, 0), 'shape') === 'outer_left';
  // SnowyBlock
  reset(); place(0, 0, 0, 'grass_block'); W.setBlock(0, 1, 0, def('snow'));
  r.snowy = pn(at(0, 0, 0), 'snowy') === 'true';
  // ScaffoldingBlock
  reset(); floor(); W.setBlock(0, 0, 0, def('scaffolding')); W.setBlock(1, 0, 0, def('scaffolding'));
  for (let t = 0; t < 20; t++) B.tick();
  r.scaffoldFloor = nm(0, 0, 0) === 'scaffolding' && pn(at(0, 0, 0), 'distance') === '0';
  r.scaffoldSide = nm(1, 0, 0) === 'scaffolding';
  reset(); floor(); W.poke(1, -1, 0, 0); W.setBlock(0, 0, 0, def('scaffolding')); W.setBlock(1, 0, 0, def('scaffolding'));
  for (let t = 0; t < 20; t++) B.tick();
  r.scaffoldDist = nm(1, 0, 0) === 'scaffolding' && pn(at(1, 0, 0), 'distance') === '1';
  reset(); W.poke(0, 0, 0, def('scaffolding')); W.poke(0, 0, 1, def('scaffolding')); B.schedule(0, 0, 0, 1);
  for (let t = 0; t < 5; t++) B.tick();
  r.scaffoldUnsupported = nm(0, 0, 0) !== 'scaffolding';
  // BambooSaplingBlock / BambooBlock
  reset(); W.poke(0, 1, 0, def('bamboo')); W.poke(0, 0, 0, def('bamboo_sapling'));
  r.bambooSapling = R.names[S.block[B.updateShape(at(0, 0, 0), 0, 0, 0)]] === 'bamboo';
  reset(); W.poke(0, 1, 0, sp('bamboo', { age: '1' })); W.poke(0, 0, 0, def('bamboo'));
  r.bambooAge = pn(B.updateShape(at(0, 0, 0), 0, 0, 0), 'age') === '1';
  // AbstractPlantPartBlock
  reset();
  r.plantBodyToHead = R.names[S.block[B.updateShape(def('weeping_vines_plant'), 0, 0, 0)]] === 'weeping_vines';
  reset(); W.poke(0, -1, 0, def('weeping_vines_plant'));
  r.plantHeadToBody = R.names[S.block[B.updateShape(def('weeping_vines'), 0, 0, 0)]] === 'weeping_vines_plant';
  // CocoaBlock
  reset(); W.poke(0, 0, 0, def('cocoa')); B.randomTick(0, 0, 0, () => 0.99);
  const c0 = pn(at(0, 0, 0), 'age'); B.randomTick(0, 0, 0, () => 0);
  r.cocoa = c0 === '0' && pn(at(0, 0, 0), 'age') === '1';
  // AttachedStemBlock (farmland keeps it)
  reset(); W.poke(0, 0, 0, sp('farmland', { moisture: '0' })); W.poke(0, 1, 0, def('attached_melon_stem'));
  B.randomTick(0, 0, 0, () => 0.5);
  r.attachedStem = nm(0, 0, 0) === 'farmland';
  reset(); W.poke(0, 0, 0, sp('farmland', { moisture: '0' })); B.randomTick(0, 0, 0, () => 0.5);
  r.bareFarmland = nm(0, 0, 0) === 'dirt';
  // SoulFireBlock / BrewingStandBlock display ticks
  reset(); W.poke(0, 0, 0, def('soul_fire')); W.poke(-1, 0, 0, def('soul_sand'));
  r.soulFire = B.fireDisplayTick(at(0, 0, 0), 0, 0, 0, () => 0.5) === 2;
  reset(); W.poke(0, 0, 0, def('fire')); W.poke(-1, 0, 0, def('soul_sand'));
  r.fireNotSoul = B.fireDisplayTick(at(0, 0, 0), 0, 0, 0, () => 0.5) === 0;
  r.brewing = B.brewingDisplayTick(def('brewing_stand'), 0, 0, 0, () => 0.5) === 1 && B.brewingDisplayTick(def('stone'), 0, 0, 0) === 0;
  // TrapdoorBlock / FenceGateBlock events
  reset(); events.length = 0; place(0, 0, 0, 'oak_trapdoor'); W.setBlock(0, 0, 0, B.setProp(at(0, 0, 0), 'open', 'true'));
  const opened = events.includes('block_open');
  W.setBlock(0, 0, 0, B.setProp(at(0, 0, 0), 'open', 'false'));
  r.trapdoorEvents = opened && events.includes('block_close');
  // Fluid / FluidState / WaterFluid / LavaFluid
  reset(); floor(); W.setBlock(0, 0, 0, B.setProp(def('water'), 'level', '0'));
  for (let t = 0; t < 300; t++) B.tick();
  r.water = row(8) === '0 1 2 3 4 5 6 7 .';
  reset(); floor(); W.setBlock(0, 0, 0, B.setProp(def('lava'), 'level', '0'));
  for (let t = 0; t < 300; t++) B.tick();
  r.lava = row(4) === '0 2 4 6 .';
  // State: a block id is one real state, props round-trip
  r.state = pn(sp('oak_stairs', { facing: 'west', half: 'top' }), 'facing') === 'west' && sp('oak_stairs', { half: 'top' }) !== def('oak_stairs');
  // WorldTickScheduler
  reset(); const a = B.schedule(3, 3, 3, 5), b = B.schedule(3, 3, 3, 5), c = B.schedule(3, 3, 3, 2);
  r.scheduler = a === true && b === false && c === true && B.isQueued(3, 3, 3);
  return r;
}

const A = trial(null);
for (const k of Object.keys(A)) ok(A[k] === true, 'scene failed on real source: ' + k);

const BR = [
  ['fenceSolid', "return !isExceptionForConnection(other) && B.faceSturdy(other, OPP[dir]);", "return false;"],
  ['wallWall', 'function wallConnects(other, dir) {', 'function wallConnects(other, dir) { return false;'],
  ['gateAcross', 'return gateAxisZ !== dirAxisZ;', 'return gateAxisZ === dirAxisZ;'],
  ['gateNotAcross', 'return gateAxisZ !== dirAxisZ;', 'return gateAxisZ === dirAxisZ;'],
  ['stairOuter', 'withV(out, P.shape, V[stairShape(state, x, y, z)])', 'withV(out, P.shape, V.straight)'],
  ['snowy', 'var SNOWY_TAG = { snow: 1,', 'var SNOWY_TAG = { snowx: 1,'],
  ['scaffoldUnsupported', 'if (i === 7) {', 'if (false) {'],
  ['scaffoldDist', 'var td = scaffoldNum(n) + 1;', 'var td = scaffoldNum(n) + 2;'],
  ['bambooSapling', 'return isBamboo(w.get(x, y + 1, z)) ? R.realFirst', 'return false ? R.realFirst'],
  ['bambooAge', 'numProp(ba, P.age) > numProp(state, P.age)', 'numProp(ba, P.age) < numProp(state, P.age)'],
  ['plantBodyToHead', 'return joined ? st : randomGrowthState(r, st, B.rng || Math.random);', 'return st;'],
  ['plantHeadToBody', 'if (S.block[st] === r.head) return joined ?', 'if (S.block[st] === r.head) return false ? st :  st; if (0) return joined ?'],
  ['cocoa', 'if (((rnd() * 5) | 0) !== 0) return false;\n    var age = numProp(st, P.age);\n    if (age >= 2)', 'var age = numProp(st, P.age);\n    if (age >= 2 || 1)'],
  ['attachedStem', '/^attached_(pumpkin|melon)_stem$/', '/^attached_zz_stem$/'],
  ['soulFire', 'var soul = nm === soulB, n = 0;', 'var soul = false, n = 0;'],
  ['brewing', "if (S.block[st] !== S.block[S.stateOf('brewing_stand')]) return 0;\n    rnd = rnd || NS.wrand;\n    var px = x + 0.4 + rnd() * 0.2, py = y + 0.7 + rnd() * 0.3, pz = z + 0.4 + rnd() * 0.2;\n    if (NS.Particle && NS.Particle.spawn) NS.Particle.spawn('smoke', px, py, pz, 0, 0, 0);\n    return 1;\n  };\n\n  /** `LavaFluid", "return 0;\n  };\n\n  /** `LavaFluid"],
  ['trapdoorEvents', "ev = n === 'true' ? 'block_open' : 'block_close';", "ev = 'block_close';"],
  ['water', 'var WATER_DELAY = 5,', 'var WATER_DELAY = 50,'],
  ['lava', 'LAVA_DELAY = 30;', 'LAVA_DELAY = 300;'],
  ['scheduler', 'if (pending[k] !== undefined && pending[k] <= at) return false;', 'if (pending[k] !== undefined && pending[k] < 0) return false;'],
];
for (const [key, from, to] of BR) {
  breaks++;
  let changed = false;
  const p = (f, s) => { if (f !== FILE || !s.includes(from)) return s; changed = true; return s.replace(from, to); };
  let got; try { got = trial(p); } catch (e) { got = { [key]: false }; }
  if (!changed) { fails.push('no-op break: ' + key); continue; }
  ok(got[key] !== true, 'anti-vacuity: break of ' + key + ' was not caught');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} checks passed, 0 failures, ${breaks} anti-vacuity breaks caught`);
process.exit(fails.length ? 1 : 0);
