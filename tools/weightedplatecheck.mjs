#!/usr/bin/env node
// weightedplatecheck.mjs — #343: a weighted plate at power N strongly powers the block below at N, UP only.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Behave.init({ get: () => 0, set: () => {}, getBlock: () => 0, setBlock: () => {} });
M.Redstone.init();
const Rs = M.Redstone, S = M.States;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function run(direct) {
  const bad = [];
  for (const n of ['light_weighted_pressure_plate', 'heavy_weighted_pressure_plate'])
    for (const p of [1, 7, 15]) {
      const st = M.Behave.setProp(S.stateOf(n), 'power', p);
      if (direct(st, Rs.UP) !== p) bad.push(`${n} power ${p} UP`);
      for (const d of [Rs.DOWN, Rs.NORTH, Rs.SOUTH, Rs.EAST, Rs.WEST]) if (direct(st, d) !== 0) bad.push(`${n} power ${p} dir ${d}`);
    }
  const off = S.stateOf('heavy_weighted_pressure_plate');
  if (direct(off, Rs.UP) !== 0) bad.push('power 0');
  if (direct(M.Behave.setProp(S.stateOf('stone_pressure_plate'), 'powered', true), Rs.UP) !== 15) bad.push('stone plate UP');
  if (direct(M.Behave.setProp(S.stateOf('stone_pressure_plate'), 'powered', true), Rs.DOWN) !== 0) bad.push('stone plate DOWN');
  return bad;
}
console.log('weightedplatecheck — #343');
const real = (st, d) => Rs.directSignal(st, d, 0, 0, 0);
const bad = run(real);
ok(bad.length === 0, 'directSignal: ' + bad.join('; '));
const brk = (m, f) => { breaks++; if (run(f).length > 0) { pass++; console.log('   ✓ break caught: ' + m); } else fails.push('anti-vacuity: ' + m); };
brk('literal 15 instead of the plate output', (st, d) => (d === Rs.UP && real(st, d) > 0 ? 15 : 0));
brk('weighted plate silent (the old bug)', (st, d) => (M.Behave.propName(st, 'power') !== null && M.Behave.propName(st, 'power') !== undefined ? 0 : real(st, d)));
brk('powers every direction', (st, d) => real(st, Rs.UP));
for (const f of fails) console.log('  ✗ ' + f);
console.log('\n================ weightedplatecheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks - fails.filter((f) => f.startsWith('anti-vacuity')).length}`);
process.exit(fails.length ? 1 : 0);
