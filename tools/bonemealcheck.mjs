// bonemealcheck.mjs -- #6343: one shared crop growth rule (.decomp CropBlock.applyGrowth: age + randomInt(2,5), cap maxAge)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
console.log('bonemealcheck - Fertilizable crop growth (#6343)');
const src = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function lcg(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
function suite(F, o) {
  for (const [max, div] of [[7, 1], [3, 3]]) {
    const r = lcg(7), seen = new Set();
    for (let i = 0; i < 1000; i++) {
      const n = F.cropGrowAge(0, max, r);
      seen.add(n);
    }
    const want = new Set(); for (let g = 2; g <= 5; g++) want.add(Math.min(max, Math.floor(g / div)));
    o([...seen].sort().join() === [...want].sort().join(), 'growth set for max ' + max + ' = ' + [...want]);
    o(F.cropGrowAge(max - 1, max, () => 0.99) === max, 'capped at maxAge ' + max);
  }
}
const M = loadEngine({ extra: ['07zv_villagerbrain.js'], dom: false });
const F = M.Fertilizable;
ok(!!F, 'NS.Fertilizable exists');
if (F) suite(F, ok);
// both call sites use the shared function, not an inline bump
ok(/NS\.Fertilizable\.cropGrowAge/.test(src('07zv_villagerbrain.js').split('function boneMealTick')[1] || ''), 'villager uses shared growth');
ok(/NS\.Fertilizable\.cropGrowAge/.test(src('14l_use.js')), 'player uses shared growth');
// break proof: a villager bump of 1 must be caught
let caught = 0;
{ const bad = { cropGrowAge: (a, m) => Math.min(m, a + 1) }; const f = []; suite(bad, (c, m) => { if (!c) f.push(m); }); if (f.length) caught++; }
{ const bad = { cropGrowAge: (a, m, r) => Math.min(m, a + 2 + Math.floor(r() * 4)) }; const f = []; suite(bad, (c, m) => { if (!c) f.push(m); }); if (f.length) caught++; }
ok(caught === 2, 'both broken variants caught');
console.log('   ✓ ' + caught + ' breaks caught');
if (fails.length) { console.log(pass + ' assertions, ' + fails.length + ' failures'); fails.forEach((f) => console.log('  x ' + f)); console.log('FAIL bonemealcheck'); process.exit(1); }
console.log('PASS bonemealcheck: ' + pass + ' assertions, 0 failures, ' + caught + ' breaks caught');
