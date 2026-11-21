#!/usr/bin/env node
// witherns11643check.mjs — #11643: 00_ns.js carries WitherArmorFeatureRenderer's energy-swirl scroll (CFG.swirlOffset) and the entity renderer draws it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');
const M = loadEngine({ extra: [], dom: false }); initRegistry(M);
const C = M.CFG;
const java = rd('.decomp/net/minecraft/client/render/entity/feature/WitherArmorFeatureRenderer.java');
ok(/MathHelper\.cos\([^)]*0\.02F\) \* 3\.0F/.test(java), 'decomp x = cos(f*0.02)*3');
ok(/\$\$\d+ \* 0\.01F % 1\.0F/.test(rd('.decomp/net/minecraft/client/render/entity/feature/EnergySwirlOverlayFeatureRenderer.java')), 'decomp y = f*0.01 % 1');
const want = (f) => [(Math.cos(f * 0.02) * 3) % 1, (f * 0.01) % 1];
const good = (swirl) => [0, 1, 7.5, 100, 333.25].every((f) => { const o = swirl(f), w = want(f); return Math.abs(o[0] - w[0]) < 1e-9 && Math.abs(o[1] - w[1]) < 1e-9; });
ok(good(C.swirlOffset), 'CFG.swirlOffset matches WitherArmorFeatureRenderer');
const er = rd('src/07j_entityrender.js');
ok(/LAYER_ADDITIVE|texKey: 'wither_armor'/.test(er) && /swirlOffset/.test(er + rd('src/12_gfx_webgl2.js')), 'renderer/shader reach swirlOffset');
// anti-vacuity: broken variants must be caught
const brk = (sw, m) => { breaks++; ok(!good(sw), 'anti-vacuity: ' + m); console.log('   ✓ ' + m); };
brk((f) => [f * 0.01 % 1, f * 0.01 % 1], 'creeper-style x scroll would be caught');
brk((f) => [Math.cos(f * 0.02) * 3, f * 0.01 % 1], 'missing %1 would be caught');
brk(undefined === 0 ? null : (f) => [0, 0], 'no scroll would be caught');
console.log(`witherns11643check (#11643)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
