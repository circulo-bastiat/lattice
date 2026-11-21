#!/usr/bin/env node
// platecheck.mjs — cloud relaxed-curie (27 Sept 2026): the pressure-plate / wooden-button-arrow constants in
// src/14l_use.js against the ONE place they come from, `.decomp/` (D-773: ported, never hand-typed).
//
//   node tools/platecheck.mjs
//
// The engine owns the numbers (Use.PLATE_BOX, PLATE_TICKS, WEIGHTED_TICKS, PLATE_WEIGHT, BUTTON_SHAPES); this
// check never owns one (D-329) — it re-reads each from the decompiled 1.18.2 source and asserts they are equal.
// The behaviour itself is the referee's: platerefcheck + buttonrefcheck. Anti-vacuity (D-30/D-305): a plate box
// nudged 1/16, a weighted plate whose weight is 16, and a pressed wall button that keeps its unpressed shape
// must each be caught by the SAME compare the real run uses.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const DEC = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'block');
if (!existsSync(join(DEC, 'AbstractPressurePlateBlock.java'))) {
  console.log('platecheck: SKIP (.decomp/ not present — node tools/cloud/bootstrap.mjs or the PC\'s .decomp)');
  process.exit(process.env.CI || process.env.GITHUB_ACTIONS || process.env.MCLITE_REQUIRE_DATA ? 1 : 0); // a CI machine must have the data
}
const src = (f) => readFileSync(join(DEC, f), 'utf8');
const nums = (s) => s.split(',').map((v) => parseFloat(v));

// ── what .decomp says ────────────────────────────────────────────────────────────────────────
const plate = src('AbstractPressurePlateBlock.java'), weighted = src('WeightedPressurePlateBlock.java');
const button = src('AbstractButtonBlock.java'), blocks = src('Blocks.java');
const tickRate = (s) => { const m = s.match(/getTickRate\(\)\s*\{\s*return\s+(\d+);/); return m ? +m[1] : null; };
const boxM = plate.match(/Box BOX = new Box\(([^)]*)\)/);
const want = {
  PLATE_BOX: boxM ? nums(boxM[1]) : null,
  PLATE_TICKS: tickRate(plate),
  WEIGHTED_TICKS: tickRate(weighted),
  PLATE_WEIGHT: {},
  BUTTON_SHAPES: {}
};
for (const n of ['light_weighted_pressure_plate', 'heavy_weighted_pressure_plate']) {
  const m = blocks.match(new RegExp(`"${n}",\\s*new WeightedPressurePlateBlock\\(\\s*(\\d+)`));
  want.PLATE_WEIGHT[n] = m ? +m[1] : null;
}
const shape = (name) => { const m = button.match(new RegExp(`VoxelShape ${name} = Block\\.createCuboidShape\\(([^)]*)\\)`)); return m ? nums(m[1]) : null; };
const KEY = { floor_x: 'FLOOR_X', floor_z: 'FLOOR_Z', ceiling_x: 'CEILING_X', ceiling_z: 'CEILING_Z',
              north: 'NORTH', south: 'SOUTH', west: 'WEST', east: 'EAST' };
for (const [k, j] of Object.entries(KEY)) want.BUTTON_SHAPES[k] = [shape(`${j}_SHAPE`), shape(`${j}_PRESSED_SHAPE`)];

// ── what the engine carries ──────────────────────────────────────────────────────────────────
const M = loadEngine({ extra: ['14l_use.js'], dom: false });
const U = M.Use;
const have = { PLATE_BOX: U.PLATE_BOX, PLATE_TICKS: U.PLATE_TICKS, WEIGHTED_TICKS: U.WEIGHTED_TICKS,
               PLATE_WEIGHT: U.PLATE_WEIGHT, BUTTON_SHAPES: U.BUTTON_SHAPES };

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
function compare(w, h) {
  const bad = [];
  for (const k of Object.keys(w)) if (JSON.stringify(w[k]) !== JSON.stringify(h[k])) bad.push(`${k}: .decomp ${JSON.stringify(w[k])} / engine ${JSON.stringify(h[k])}`);
  return bad;
}

console.log('platecheck — plate + wooden-button-arrow constants vs .decomp');
ok(want.PLATE_BOX && want.PLATE_BOX.length === 6, 'AbstractPressurePlateBlock.BOX parsed from .decomp');
ok(want.PLATE_TICKS > 0 && want.WEIGHTED_TICKS > 0, 'both getTickRate() overrides parsed from .decomp');
ok(Object.values(want.PLATE_WEIGHT).every((v) => v > 0), 'both WeightedPressurePlateBlock weights parsed from Blocks.java');
ok(Object.values(want.BUTTON_SHAPES).every((p) => p[0] && p[1]), 'all 16 AbstractButtonBlock outline shapes parsed from .decomp');
for (const x of compare(want, have)) ok(false, x);
if (!compare(want, have).length) pass++;

const brk = (m, c) => { breaks++; if (c) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
const clone = () => JSON.parse(JSON.stringify(have));
{ const b = clone(); b.PLATE_BOX[4] += 1 / 16; brk('a plate box 1/16 taller is a mismatch', compare(want, b).length > 0); }
{ const b = clone(); b.PLATE_WEIGHT.light_weighted_pressure_plate = 16; brk('a light plate of weight 16 is a mismatch', compare(want, b).length > 0); }
{ const b = clone(); b.BUTTON_SHAPES.north[1] = b.BUTTON_SHAPES.north[0]; brk('a pressed north button with its unpressed shape is a mismatch', compare(want, b).length > 0); }

for (const f of fails) console.log('  ✗ ' + f);
console.log('');
console.log('================ platecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
