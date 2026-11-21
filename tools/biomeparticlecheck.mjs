#!/usr/bin/env node
// biomeparticlecheck.mjs — #263: biome ambient particles (BiomeParticleConfig, ClientWorld.randomBlockDisplayTick tail):
// ash / white_ash (AscendingParticle) and crimson_spore / warped_spore (WaterSuspendParticle). Breaks its own gates.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;

const M = loadEngine({ extra: ['07zx_particle.js', '07zzc_lightning.js'], dom: false });
const Px = M.Particle; Px.init();
const seq = (v) => { let i = 0; return () => v[i++ % v.length]; };

// -- the particles
let p = Px.spawn('crimson_spore', 1, 2, 3, 0, 0, 0, seq([0.5]));
ok(p && p.type === 'crimson_spore' && near(p.y, 1.875), 'crimson_spore: y - 0.125');
ok(p.gravityStrength === 0 && p.velocityMultiplier === 1, 'spore: no gravity, no drag');
ok(near(p.scale, 0.15 * 0.9), 'spore scale = base * (r*0.6+0.6)');
ok(p.maxAge === Math.floor(16 / 0.6), 'spore maxAge (int)(16/(r*0.8+0.2))');
ok(near(p.red, 0.9) && near(p.green, 0.4) && near(p.blue, 0.5), 'crimson colour 0.9/0.4/0.5');
p = Px.spawn('warped_spore', 0, 0, 0, 0, 0, 0, seq([0.5]));
ok(near(p.red, 0.1) && near(p.green, 0.1) && near(p.blue, 0.3), 'warped colour 0.1/0.1/0.3');
p = Px.spawn('ash', 0, 0, 0, 0, 0, 0, seq([0.5]));
ok(p.gravityStrength === 0.1 && p.velocityMultiplier === 0.96 && near(p.scale, 0.15 * 0.75), 'ash: gravity 0.1, drag 0.96, scale*0.75');
ok(p.maxAge === Math.floor(20 / 0.6) && near(p.shade, 0.25), 'ash maxAge (int)(20/(r*0.8+0.2)), grey r*0.5');
p = Px.spawn('white_ash', 0, 0, 0, 0, 0, 0, seq([0.5]));
ok(p.gravityStrength === 0.0125 && near(p.red, 0.7294118) && near(p.blue, 0.7607843), 'white_ash: gravity 0.0125, lilac');
okAv(!near(p.gravityStrength, 0.1), 'white_ash gravity differs from ash');
const jv = Px.jitterVelocity(seq([0.5]), 0, 0, 0);
ok(near(jv[0], 0) && near(jv[1], 0.1) && near(jv[2], 0), 'jitter: speed-bounded, +0.1 up');
// colour / sprite layer
ok(Px.colorOf(Px.spawn('ash', 0, 0, 0, 0, 0, 0, seq([0.5])))[0] === 0.25, 'ash colour is its grey');
const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'particle-tex.meta.json'), 'utf8'));
for (const t of ['ash', 'white_ash', 'crimson_spore', 'warped_spore']) ok(Array.isArray(meta.layers[t]) && meta.layers[t].length === 1, 'atlas layer ' + t);
okAv(!('nope' in meta.layers), 'missing layer detected');

// -- the biome hook
const Lgt = M.Lightning, got = [];
M.Particle.spawn = (n, x, y, z) => { got.push({ n, x, y, z }); return {}; };
M.States.solidRender = () => false; M.States.fullCubeCollision = () => false;
let biome = 'crimson_forest';
M.Biomes = { ready: true, name: () => biome };
M.World = { biomeAt3: () => 0 };
ok(Lgt.biomeDisplayParticle(0, 10, 20, 30, () => 0.01) === 1 && got[0].n === 'crimson_spore', 'crimson_forest roll below 0.025 spawns');
ok(got[0].x === 10.01 && got[0].y === 20.01, 'positioned in the cell by three rolls');
ok(Lgt.biomeDisplayParticle(0, 0, 0, 0, () => 0.5) === 0, 'high roll: nothing');
biome = 'warped_forest'; got.length = 0;
ok(Lgt.biomeDisplayParticle(0, 0, 0, 0, () => 0.01) === 1 && got[0].n === 'warped_spore', 'warped_forest');
biome = 'basalt_deltas'; got.length = 0;
ok(Lgt.biomeDisplayParticle(0, 0, 0, 0, () => 0.1) === 1 && got[0].n === 'white_ash', 'basalt_deltas p=0.118');
biome = 'soul_sand_valley'; got.length = 0;
ok(Lgt.biomeDisplayParticle(0, 0, 0, 0, () => 0.1) === 0, 'soul_sand_valley p=0.00625 rejects 0.1');
ok(Lgt.biomeDisplayParticle(0, 0, 0, 0, () => 0.001) === 1 && got[0].n === 'ash', 'soul_sand_valley ash');
biome = 'plains'; got.length = 0;
okAv(Lgt.biomeDisplayParticle(0, 0, 0, 0, () => 0) === 0, 'plains has no config');
biome = 'basalt_deltas'; M.States.solidRender = () => true;
okAv(Lgt.biomeDisplayParticle(5, 0, 0, 0, () => 0) === 0, 'a full cube cell is skipped');

console.log(fails.length ? fails.join('\n') : '');
console.log(`${pass + breaks} assertions, ${fails.length} failures, ${breaks} breaks caught`);
console.log(`${breaks} breaks caught (of ${breaks})`);
process.exit(fails.length ? 1 : 0);
