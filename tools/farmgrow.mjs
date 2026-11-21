#!/usr/bin/env node
// farmgrow.mjs — #304 (G24): the farming random-tick rules, as COMPARISONS the engine must get the right way round
// (D-291), plus the new rules' own bounds. The real-server numbers are growthrefcheck's (tools/referee/growthscen.mjs:
// sweet_berry, cocoa, bamboo, wheat_light8/9); this check runs anywhere, with no golden, and cannot SKIP.
//
//   1. hydrated wheat matures in FEWER ticks than dry (CropBlock.getAvailableMoisture: 3 moist vs 1 dry under it)
//   2. wheat at base light 8 never grows, at 9 it does (CropBlock.randomTick `>= 9`; 8 is only canPlaceAt's bound)
//   3. cocoa ripens to age 2 in the DARK and stops (CocoaBlock.randomTick: no light gate, age < 2)
//   4. sweet berries: light 8 above -> nothing, light 9 above -> age 3 and no further (SweetBerryBushBlock)
//   5. bamboo: a sapling becomes a column <= 16 stalks, thick below, one stage-1 top at most (BambooBlock)
// Anti-vacuity: each break edits the REAL src/07b_behaviour.js text (loadEngine's `patch`) and must turn a row red.
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// one engine + a Map world; `light` = the base light every cell reads (sky 0, block L), undefined = 15
function engine(patch, light) {
  let hit = !patch;
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false, patch: patch && ((f, src) => {
    if (f !== '07b_behaviour.js') return src;
    const out = src.replace(patch[0], patch[1]);
    hit = out !== src;
    return out;
  }) });
  if (!hit) throw new Error('farmgrow: a break did not match src/07b_behaviour.js: ' + patch[0]);
  const cells = new Map();
  const key = (x, y, z) => x + ',' + y + ',' + z;
  const w = {
    getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0,
    // World.setBlock's neighbour pass: a bamboo sapling becomes bamboo, a column thickens, only through updateShape
    setBlock: (x, y, z, s) => { cells.set(key(x, y, z), s); M.Behave.changed(x, y, z); return true; },
  };
  if (light !== undefined) w.getLight = () => light & 15;
  M.Behave.init(w);
  const S = M.States, B = M.Behave, R = M.Reg;
  const st = (name, props) => { let s = S.stateOf(name); for (const k in props || {}) s = B.setProp(s, k, props[k]); return s; };
  const num = (s, p) => { const v = S.propValue(s, R.PROP[p]); return v < 0 ? 0 : +R.valueNames[v]; };
  const is = (s, name) => s !== 0 && S.block[s] === R.id[name];
  return { M, B, S, R, w, st, num, is };
}

const GY = 4, SPEED = 256;
const GRID = []; for (let gx = 0; gx < 8; gx++) for (let gz = 0; gz < 8; gz++) GRID.push([gx * 2, gz * 2]);
const WATER = [[3, 3], [3, 11], [11, 3], [11, 11]];

// plant `block` on `ground` over the spaced grid, tick one section, return per-plant ticks to reach `target`
function grow(E, { ground, block, props, prop = 'age', target, water = [], support, T = 6000, seed = 1 }) {
  const { B, w, st, num, is } = E;
  for (const [x, z] of GRID) {
    w.setBlock(x, GY, z, st(ground[0], ground[1]));
    if (support) w.setBlock(x + support[0], GY + 1, z + support[1], st(support[2]));
    w.setBlock(x, GY + 1, z, st(block, props));
  }
  for (const [x, z] of water) w.setBlock(x, GY, z, st('water'));
  const rnd = seeded(seed), done = new Array(GRID.length).fill(-1);
  let peak = 0;
  for (let t = 1; t <= T && done.includes(-1); t++) {
    B.randomTickSection(0, 0, 0, rnd, SPEED);
    GRID.forEach(([x, z], k) => {
      const s = w.getBlock(x, GY + 1, z);
      const v = is(s, block) ? num(s, prop) : -1;
      if (v > peak) peak = v;
      if (done[k] < 0 && v >= target) done[k] = t;
    });
  }
  const grown = done.filter((d) => d >= 0);
  return { mean: grown.length ? grown.reduce((a, b) => a + b, 0) / grown.length : Infinity, grown: grown.length, peak };
}

function rows(patch) {
  const r = {};
  const moist = grow(engine(patch), { ground: ['farmland', { moisture: 7 }], block: 'wheat', target: 7, water: WATER });
  const dry = grow(engine(patch), { ground: ['farmland', { moisture: 0 }], block: 'wheat', target: 7 });
  r.moistFaster = moist.grown === 64 && dry.grown === 64 && moist.mean < dry.mean;
  r.moistMsg = `hydrated wheat matures in fewer ticks than dry (moist mean ${moist.mean.toFixed(0)}, dry ${dry.mean.toFixed(0)})`;
  const l8 = grow(engine(patch, 8), { ground: ['farmland', { moisture: 7 }], block: 'wheat', target: 1, water: WATER, T: 1500 });
  const l9 = grow(engine(patch, 9), { ground: ['farmland', { moisture: 7 }], block: 'wheat', target: 7, water: WATER });
  r.light = l8.peak === 0 && l9.grown === 64;
  r.lightMsg = `wheat at base light 8 never grows (peak age ${l8.peak}), at 9 all 64 mature (${l9.grown})`;
  const cocoa = grow(engine(patch, 0), { ground: ['stone'], block: 'cocoa', props: { facing: 'south' }, support: [0, 1, 'jungle_log'], target: 2, T: 3000 });
  r.cocoa = cocoa.grown === 64 && cocoa.peak === 2;
  r.cocoaMsg = `cocoa ripens to age 2 in the dark, all 64, never past it (grown ${cocoa.grown}, peak ${cocoa.peak})`;
  const b8 = grow(engine(patch, 8), { ground: ['grass_block'], block: 'sweet_berry_bush', target: 1, T: 1500 });
  const b9 = grow(engine(patch, 9), { ground: ['grass_block'], block: 'sweet_berry_bush', target: 3, T: 3000 });
  r.berry = b8.peak === 0 && b9.grown === 64 && b9.peak === 3;
  r.berryMsg = `sweet berries: light 8 above never grows (peak ${b8.peak}), 9 reaches age 3 and stops (${b9.grown}, peak ${b9.peak})`;
  // bamboo: 16 sapling columns, run long enough that every one has stopped
  const E = engine(patch);
  const { B, w, st, num, is } = E;
  const cols = GRID.filter((c, k) => k % 4 === 0);
  for (const [x, z] of cols) { w.setBlock(x, GY, z, st('grass_block')); w.setBlock(x, GY + 1, z, st('bamboo_sapling')); }
  const rnd = seeded(7);
  for (let t = 0; t < 6000; t++) for (const sy of [0, 16]) B.randomTickSection(0, sy, 0, rnd, SPEED);
  let maxH = 0, badShape = 0, saplings = 0;
  for (const [x, z] of cols) {
    let h = 0;
    while (is(w.getBlock(x, GY + 1 + h, z), 'bamboo')) h++;
    if (is(w.getBlock(x, GY + 1, z), 'bamboo_sapling')) saplings++;
    if (h > maxH) maxH = h;
    for (let y = 0; y < h; y++) {
      const s = w.getBlock(x, GY + 1 + y, z);
      if (y < h - 1 && num(s, 'stage') !== 0) badShape++;            // only the top may have stopped
      if (h >= 3 && y < h - 2 && num(s, 'age') !== 1) badShape++;     // a 3+ column is thick below its top two
    }
  }
  r.bamboo = saplings === 0 && maxH >= 12 && maxH <= 16 && badShape === 0;
  r.bambooMsg = `bamboo: every sapling became a column, tallest ${maxH} (12..16), thick below, stage 1 only on top (saplings left ${saplings}, bad stalks ${badShape})`;
  return r;
}

const r = rows(null);
ok(r.moistFaster, r.moistMsg);
ok(r.light, r.lightMsg);
ok(r.cocoa, r.cocoaMsg);
ok(r.berry, r.berryMsg);
ok(r.bamboo, r.bambooMsg);
for (const k of ['moistMsg', 'lightMsg', 'cocoaMsg', 'berryMsg', 'bambooMsg']) console.log('   ' + r[k]);

// anti-vacuity: break the real source, the matching row must go red
const BREAKS = [
  ['moisture term removed from getAvailableMoisture', 'moistFaster', [/if \(prop\(st, P\.moisture\) >= 0 && \+R\.valueNames\[prop\(st, P\.moisture\)\] > 0\) f1 = 3;/, '']],
  ['cocoa rule dropped', 'cocoa', [/if \(R\.id\.cocoa !== undefined\) rules\[R\.id\.cocoa\] = tickCocoa;/, '']],
  ['crop light gate lowered to 8', 'light', [/if \(w\.baseLight\(x, y, z\) < 9\) return false;    \/\/ CropBlock\.randomTick/, 'if (w.baseLight(x, y, z) < 8) return false;    // CropBlock.randomTick']],
  ['sweet berry light gate lowered to 8', 'berry', [/if \(w\.baseLight\(x, y \+ 1, z\) < 9\) return false;\n    w\.set\(x, y, z, B\.setProp\(st, 'age', age \+ 1\)\);/, "if (w.baseLight(x, y + 1, z) < 8) return false;\n    w.set(x, y, z, B.setProp(st, 'age', age + 1));"]],
  ['bamboo cap raised to 20 and its height-15 stop removed', 'bamboo', [/if \(below \+ 1 >= 16\) return false;([\s\S]*?)&& n !== 15\)/, 'if (below + 1 >= 20) return false;$1&& n !== 19)']],
];
for (const [name, row, patch] of BREAKS) {
  breaks++;
  let caught;
  try { caught = !rows(patch)[row]; } catch (e) { caught = false; fails.push(`break "${name}": ${e.message}`); continue; }
  if (ok(caught, `anti-vacuity: ${name} turns "${row}" red`)) console.log('   ✓ break caught: ' + name);
}

if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ✗ ' + f)); }
console.log(`farmgrow: ${pass} assertions, ${fails.length} failures, ${breaks - fails.filter((f) => /anti-vacuity|break "/.test(f)).length} breaks caught`);
process.exit(fails.length ? 1 : 0);
