#!/usr/bin/env node
// #4468: the llama SPIT particle (spit.json == smoke.json frames) must have a drawable atlas layer.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['07zx_particle.js'], dom: false });
const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'particle-tex.meta.json'), 'utf8'));
const Px = M.Particle;
const withLayers = (l) => { M.DATA = Object.assign({}, M.DATA, { particleLayers: l }); Px._resetLayerCacheForTest(); };
withLayers(meta.layers);
const p = { type: 'spit', age: 0, maxAge: 10, scale: 0.2, shade: 0.8 };
ok(Px.frameLayer(p) >= 0, 'spit has a non-negative frameLayer');
ok(Px.sizeOf(p) === p.scale, 'spit size is its raw scale (ExplosionSmokeParticle)');
ok(Px.colorOf(p)[0] === 0.8, 'spit tinted by its grey roll');
// break: with the smoke frames dropped, spit must go undrawable (proves the check looks)
withLayers(Object.assign({}, meta.layers, { smoke: undefined }));
if (Px.frameLayer(p) === -1) { breaks++; console.log("   ✓ anti-vacuity: break caught"); } else fails.push('break not caught');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length || breaks < 1 ? 1 : 0);
