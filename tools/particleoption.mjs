#!/usr/bin/env node
// particleoption.mjs — #284 (G20): the Particles option against the decomp rules
// (option/ParticlesMode.java, WorldRenderer.tickRainSplashing:399-446, spawnParticle/
// getRandomParticleSpawnChance:2676-2703).
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ break caught: ' + m); else fails.push('anti-vacuity: ' + m); };

console.log('particleoption — #284 (G20), ParticlesMode All/Decreased/Minimal (Wx.tickRainSplashing, Px.spawn)');
const M = loadEngine({ extra: ['07zx_particle.js', '09c_weather.js'], initReg: false });
const Wx = M.Weather, Px = M.Particle;
ok(Wx && Px && typeof Px.calculateParticleLevel === 'function', 'Weather and Particle.calculateParticleLevel exist');

// counts: (int)(100*f*f) / (Decreased ? 2 : 1), integer division
const counts = [[1, true, 0, 100], [1, true, 1, 50], [1, true, 2, 100], [1, false, 0, 25], [1, false, 1, 12],
  [0.23, true, 0, 5], [0.23, true, 1, 2], [0, true, 1, 0]];
const cnt = () => counts.every(([g, f, m, n]) => Wx.splashTries(g, f, m) === n);
ok(cnt(), 'splash try count halves (int division) on Decreased only');

const world = (o) => Object.assign({
  x: 0.5, y: 64.5, z: 0.5, ticks: 3, gradient: 1, fancy: true, bottomY: -64, particles: 0,
  topY: () => 64, biomeAt: () => 1, precipitation: (b) => b, warm: () => true, cellTop: () => 0, hot: () => false,
}, o || {});
const spawnsOf = (o) => Wx.tickRainSplashing(world(o)).spawns.length;
const spawns = () => spawnsOf({ particles: 0 }) === 100 && spawnsOf({ particles: 1 }) === 50 && spawnsOf({ particles: 2 }) === 0;
ok(spawns(), 'All 100 splashes, Decreased 50, Minimal none at full rain');
const minSound = () => { Wx.splashSoundCounter = 5; const r = Wx.tickRainSplashing(world({ particles: 2 })); return r.tries === 100 && r.sound !== null; };
ok(minSound(), 'Minimal still runs the accepted-hit path (sound counter) but spawns nothing');
const minNoHit = () => Wx.tickRainSplashing(world({ particles: 2, topY: () => 200 })).sound === null;
ok(minNoHit(), 'Minimal with no accepted column asks for no sound');

// calculateParticleLevel with a scripted r()
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
const lv = () => Px.calculateParticleLevel(0, false, seq(0)) === 0 &&
  Px.calculateParticleLevel(1, false, seq(0.1)) === 2 &&      // nextInt(3)==0 demotes
  Px.calculateParticleLevel(1, false, seq(0.5)) === 1 &&
  Px.calculateParticleLevel(2, false, seq(0)) === 2 &&
  Px.calculateParticleLevel(2, true, seq(0.05, 0.5)) === 1 &&  // nextInt(10)==0 promotes, then survives
  Px.calculateParticleLevel(2, true, seq(0.05, 0.1)) === 2 &&  // promoted then demoted
  Px.calculateParticleLevel(2, true, seq(0.5)) === 2;
ok(lv(), 'calculateParticleLevel: Decreased demotes 1 in 3, Minimal+alwaysSpawn promotes 1 in 10');

// Px.spawn gate
M.Settings = M.Settings || {};
const S = M.Settings;
const trySpawn = (mode, r, type) => { S.particles = mode; Px.list.length = 0; return Px.spawn(type || 'smoke', 0, 0, 0, 0, 0, 0, r) !== null; };
const gate = () => trySpawn(0, seq(0.5)) && !trySpawn(2, seq(0.5)) && trySpawn(1, seq(0.9)) && !trySpawn(1, seq(0.1));
ok(gate(), 'Px.spawn: All spawns, Minimal refuses, Decreased refuses on the 1-in-3 roll');
S.particles = 0;

// anti-vacuity: break the data, each must be seen
okAv(!(() => [[1, true, 1, 100]].every(([g, f, m, n]) => Wx.splashTries(g, f, m) === n))(), 'Decreased count claimed 100 is refused');
okAv(!(() => spawnsOf({ particles: 2 }) === 100)(), 'Minimal claimed to splash 100 is refused');
okAv(!(() => Px.calculateParticleLevel(1, false, seq(0.1)) === 1)(), 'Decreased demotion claimed absent is refused');
okAv(!(() => trySpawn(2, seq(0.5)))(), 'Minimal spawn claimed allowed is refused');

if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`particleoption: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
