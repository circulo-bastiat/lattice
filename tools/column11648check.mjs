#!/usr/bin/env node
// column11648check.mjs — #11648: 04d_column.js is the port of Spline (cubic evaluator), VanillaTerrainParameters/DensityFunctions
// (offset/factor/jaggedness splines + clamps), ChunkNoiseSampler's 2D remains and GeneratorType's world types; and worldgen reaches it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const rd = (f) => readFileSync(join(ROOT, f), 'utf8');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const NS = { CFG: {} }; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02d_wgdata.js', '03b_noise.js', '04d_column.js']) new Function('MCL', rd('src/' + f))(NS);
const meta = JSON.parse(rd('assets/worldgen.meta.json'));
NS.WG.init({ worldgen: readFileSync(join(ROOT, 'assets/worldgen.bin')).toString('base64'), worldgenBytes: meta.jsonBytes });
const C = NS.Column;

// ── decomp facts
const sp = rd('.decomp/net/minecraft/util/math/Spline.java');
ok(/lerp\(\$\$6, \$\$11, \$\$12\) \+ \$\$6 \* \(1\.0F - \$\$6\) \* MathHelper\.lerp\(\$\$6, \$\$13, \$\$14\)/.test(sp), 'decomp Spline cubic form');
const df = rd('.decomp/net/minecraft/world/gen/densityfunction/DensityFunctions.java');
ok(/field_37102, -0\.81, 2\.5/.test(df) && /field_37104, 0\.0, 1\.28/.test(df), 'decomp clamps offset -0.81..2.5, jaggedness 0..1.28');
const gt = rd('.decomp/net/minecraft/client/world/GeneratorType.java');
for (const n of ['flat', 'large_biomes', 'amplified', 'debug_all_block_states']) ok(gt.includes('"' + n + '"'), 'decomp GeneratorType ' + n);

// ── independent reference of Spline.apply, vs Column.splineAt
const lerp = (t, a, b) => a + t * (b - a);
function ref(node, c) {
  if (typeof node === 'number') return node;
  const v = c[{ continents: 0, erosion: 1, weirdness: 2, ridges: 3 }[node.coordinate]], p = node.points;
  let i = -1; for (let k = 0; k < p.length; k++) if (p[k].location <= v) i = k;
  if (i < 0) return ref(p[0].value, c) + p[0].derivative * (v - p[0].location);
  if (i === p.length - 1) return ref(p[i].value, c) + p[i].derivative * (v - p[i].location);
  const a = p[i], b = p[i + 1], t = (v - a.location) / (b.location - a.location), y0 = ref(a.value, c), y1 = ref(b.value, c);
  const s = b.location - a.location;
  return lerp(t, y0, y1) + t * (1 - t) * lerp(t, a.derivative * s - (y1 - y0), -b.derivative * s + (y1 - y0));
}
const pts = []; for (let i = 0; i < 400; i++) pts.push([Math.sin(i * 1.7) * 1.3, Math.cos(i * 2.3) * 1.2, Math.sin(i * 0.9), Math.cos(i * 3.1)]);
function run(worldType) {
  C.init(99n, worldType);
  const tr = C.splineAt === undefined ? null : C.splineAt;
  return tr;
}
for (const wt of C.WORLD_TYPES) {
  C.ready = false; C.init(99n, wt);
  ok(C.worldType === wt, 'init sets worldType ' + wt);
}
ok(JSON.stringify(C.WORLD_TYPES) === JSON.stringify(['default', 'large_biomes', 'amplified', 'flat']), 'WORLD_TYPES = GeneratorType list');
ok(C.ALL_WORLD_TYPES.includes('debug'), 'debug world type');
// large_biomes reads the _large noises; default does not
C.ready = false; C.init(99n, 'large_biomes'); ok(C.noiseIds.continentalness === 'continentalness_large' && C.noiseIds.erosion === 'erosion_large', 'large_biomes noise ids');
const hL = []; for (let i = 0; i < 50; i++) hL.push(C.height(i * 311, i * 177));
C.ready = false; C.init(99n, 'default'); ok(C.noiseIds.continentalness === 'continentalness', 'default noise ids');
const hD = []; for (let i = 0; i < 50; i++) hD.push(C.height(i * 311, i * 177));
ok(JSON.stringify(hL) !== JSON.stringify(hD), 'large_biomes changes heights');
C.ready = false; C.init(99n, 'amplified');
const hA = []; for (let i = 0; i < 50; i++) hA.push(C.height(i * 311, i * 177));
ok(JSON.stringify(hA) !== JSON.stringify(hD), 'amplified changes heights');
C.ready = false; C.init(99n, 'default');
// the real splines, evaluated by both
const wgs = NS.WG.get('noise_settings', 'overworld').noise.terrain_shaper;
const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const splineOK = (fn) => pts.every((c) => {
  for (const [k, lo, hi, f] of [['offset', -0.81, 2.5, C.offsetAt], ['factor', 0, 8, C.factorAt], ['jaggedness', 0, 1.28, C.jaggednessAt]]) {
    if (Math.abs(f(c) - clampf(fn(wgs[k], c), lo, hi)) > 1e-9) return false;
  }
  return true;
});
ok(splineOK(ref), 'offset/factor/jaggedness = vanilla Spline + clamps over 400 points');
let mn = 9, mx = -9; for (const c of pts) { const o = C.offsetAt(c); mn = Math.min(mn, o); mx = Math.max(mx, o); }
ok(mn >= -0.81 && mx <= 2.5 && mx > 0.5, 'offset within clamp and spans range');
// reachability from real entry points
ok(/Column\.height\(/.test(rd('src/04f_earth.js')) && /Column\./.test(rd('src/04h_surface.js')), 'earth and surface call Column');
ok(/Column\.init\(/.test(rd('src/04_worldgen.js') + rd('src/04h_surface.js') + rd('src/04f_earth.js') + rd('src/04g_biomes.js') + rd('src/04e_climate.js')), 'Column.init called from worldgen');

// anti-vacuity
const brk = (good, m) => { breaks++; ok(!good, 'anti-vacuity: ' + m); console.log('   ✓ ' + m); };
const refLinear = (node, c) => { if (typeof node === 'number') return node; const v = c[{ continents: 0, erosion: 1, weirdness: 2, ridges: 3 }[node.coordinate]], p = node.points; let i = -1; for (let k = 0; k < p.length; k++) if (p[k].location <= v) i = k; if (i < 0 || i === p.length - 1) return ref(node, c); const a = p[i], b = p[i + 1], t = (v - a.location) / (b.location - a.location); return lerp(t, refLinear(a.value, c), refLinear(b.value, c)); };
brk(splineOK(refLinear), 'linear (non-cubic) spline would be caught');
brk(splineOK((n, c) => ref(n, c) + 0.01), 'offset by 0.01 would be caught');
brk(splineOK((n, c) => ref(n, [c[0], c[1], c[3], c[2]])), 'swapped coordinates would be caught');
console.log(`column11648check (#11648)\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exit(1); }
