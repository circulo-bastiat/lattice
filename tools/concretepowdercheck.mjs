#!/usr/bin/env node
// concretepowdercheck.mjs — #5552 (G17-F1): ConcretePowderBlock.getPlacementState / getStateForNeighborUpdate
// (.decomp ConcretePowderBlock: shouldHarden = hardensIn(cell) || hardensOnAnySide; DOWN only counts when the cell is water).
import { loadEngine } from './loadsrc.mjs';

let pass = 0, caught = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('concretepowdercheck — powder hardens beside / in water, not above it');

const COL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];

function run(patch) {
  const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js'], patch });
  const S = M.States, B = M.Behave, w = B.w;
  const mem = new Map();
  B.init({
    getBlock: (x, y, z) => mem.get(x + ',' + y + ',' + z) || 0,
    setBlock: (x, y, z, s) => { const o = mem.get(x + ',' + y + ',' + z) || 0; if (o === s) return false; mem.set(x + ',' + y + ',' + z, s); B.changed(x, y, z, o); return true; },
  });
  const STONE = S.stateOf('stone'), WATER = S.stateOf('water'), FLOW = S.withLocal('water', 1), LAVA = S.stateOf('lava');
  const out = [];
  for (const c of COL) {
    const P = S.stateOf(c + '_concrete_powder'), C = S.stateOf(c + '_concrete');
    const go = (setup, how) => {
      mem.clear(); B.clearSchedule();
      if (how === 'place') { setup(); const r = B.place(P, 0, 10, 0); w.set(0, 10, 0, r); } else { w.set(0, 10, 0, P); setup(); }
      return w.get(0, 10, 0);
    };
    const cases = [
      ['beside water', () => w.set(1, 10, 0, WATER), 'place', C],
      ['beside water (neighbour update)', () => w.set(1, 10, 0, WATER), 'set', C],
      ['beside flowing water', () => w.set(0, 10, 1, FLOW), 'place', C],
      ['under flowing water', () => w.set(0, 11, 0, FLOW), 'place', C],
      ['under water (neighbour update)', () => w.set(0, 11, 0, WATER), 'set', C],
      ['placed into water', () => w.set(0, 10, 0, WATER), 'place', C],
      ['above water', () => w.set(0, 9, 0, WATER), 'place', P],
      ['above water (neighbour update)', () => w.set(0, 9, 0, WATER), 'set', P],
      ['beside lava', () => w.set(1, 10, 0, LAVA), 'place', P],
      ['beside stone', () => w.set(1, 10, 0, STONE), 'place', P],
    ];
    for (const [n, setup, how, want] of cases) out.push([c + ' ' + n, go(setup, how) === want]);
    // water arriving next to an already-placed powder
    mem.clear(); w.set(0, 10, 0, P); w.set(-1, 10, 0, WATER);
    out.push([c + ' water arrives later', w.get(0, 10, 0) === C]);
  }
  return out;
}
for (const [n, g] of run(null)) ok(g, n);
const brk = (f, s) => f === '07b_behaviour.js' ? s.replace('if (cpH) return powderWetSide(x, y, z) ? cpH : state;', '') : s;
const bad = run(brk).filter(([, g]) => !g).length;
if (bad > 0) caught++;
ok(bad > 0, 'stubbing the neighbour-update hook must fail the check');
console.log(`  ✓ ${caught} breaks caught`);
console.log(`concretepowdercheck: ${pass} checks passed, ${fails.length} failures (${caught} breaks caught)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
