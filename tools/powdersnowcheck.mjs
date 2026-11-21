#!/usr/bin/env node
// powdersnowcheck.mjs — #5655: PowderSnowBlock.entityInside branch of Use.entityCollide.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
let src = readFileSync(SRC + '14l_use.js', 'utf8');
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function run(code, grief) {
  const NS = {}; const world = new Map();
  NS.World = { getBlock: (x, y, z) => world.get(x + ',' + y + ',' + z) || 0, setBlock: (x, y, z, s) => world.set(x + ',' + y + ',' + z, s) };
  NS.Reg = { id: { powder_snow: 7 }, names: ['a','b','c','d','e','f','g','powder_snow'] }; NS.States = { block: [0, 0, 0, 0, 0, 0, 0, 7] };
  NS.Physics = { W: 0.6, H: 1.8, slowMovement: (e, m) => { e.mult = m; } };
  NS.EntityList = { aiCtx: () => ({ mobGriefing: () => grief }) };
  NS.Player = { type: 'player', maxHealth: 20 };
  const g = globalThis; const saved = g.MCL; g.MCL = NS;
  const i = code.lastIndexOf('})(MCL);'); code = code.slice(0, i) + 'Use.__init = function () { R = NS.Reg; S = NS.States; W = NS.World; };' + code.slice(i);
  try { new Function('MCL', code)(NS); } catch (e) { g.MCL = saved; return null; }
  g.MCL = saved;
  return { NS, world };
}
function scenario(code) {
  const out = {};
  for (const grief of [true, false]) {
    const r = run(code, grief); if (!r) return null;
    const { NS, world } = r; const U = NS.Use; U.__init(); U.ready = true;
    world.set('0,5,0', 7);
    const z = { type: 'zombie', maxHealth: 20, x: 0.5, y: 5, z: 0.5, width: 0.6, height: 1.95, isOnFire: true, remainingFireTicks: 100 };
    U.entityCollide(z);
    out[grief] = { z, block: world.get('0,5,0') };
  }
  return out;
}
function verify(label, code, expectCaught) {
  const o = scenario(code); let good = false;
  if (o) {
    const a = o[true], b = o[false];
    good = a.z.mult && Math.abs(a.z.mult[0] - 0.9) < 1e-6 && a.z.mult[1] === 1.5 && a.z.isOnFire === false && a.block === 0 &&
           b.z.isOnFire === false && b.block === 7;
  }
  if (expectCaught) { if (!good) breaks++; else fails.push(label + ' not caught'); } else ok(good, 'real branch');
}
verify('real', src, false);
verify('no-branch', src.replace(/S\.block\[st\] === R\.id\.powder_snow/, 'false'), true);
verify('no-grief', src.replace('.mobGriefing()', '.mobGriefing() || true'), true);
verify('no-extinguish', src.replace('e.remainingFireTicks = 0; e.isOnFire = false;', ''), true);
console.log(fails.length ? 'FAIL ' + fails.join('; ') : `powdersnowcheck: ${pass} ok, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
