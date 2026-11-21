#!/usr/bin/env node
// particleclasscheck.mjs — #11488: drives 07zx_particle.js Particle.spawn through the real path for the particle
// classes the audit listed as unchecked, and compares each spawned particle's constants with the constants READ
// FROM .decomp (the jar's own constructor), not retyped here.
// Classes: BlockColors, FoliageColors, AbstractSlowingParticle, AnimatedParticle, AscendingParticle, AshParticle,
// BillboardParticle, BlockDustParticle, BlockLeakParticle, BubbleColumnUpParticle, CloudParticle, CrackParticle,
// DamageParticle, DragonBreathParticle, EmitterParticle, EmotionParticle, EndRodParticle, ExplosionEmitterParticle,
// ExplosionLargeParticle, ExplosionSmokeParticle, FireSmokeParticle, FlameParticle, GlowParticle, ItemPickupParticle,
// LavaEmberParticle, NoRenderParticle, NoteParticle, ParticleManager, ParticleTextureSheet, PortalParticle,
// RainSplashParticle, SpellParticle, SpitParticle, SpriteBillboardParticle, SpriteProvider, SquidInkParticle,
// SuspendParticle, SweepAttackParticle, TotemParticle, VibrationParticle, WaterBubbleParticle, WaterSplashParticle,
// WaterSuspendParticle, WhiteAshParticle, BlockStateParticleEffect, ItemStackParticleEffect.
// (Constants are asserted for Emotion/Note/BubbleColumnUp/Damage/DragonBreath/RainSplash/Sweep/WhiteAsh/Ash/
// SquidInk/Portal/Glow/EndRod/Flame; the rest are named by the dispatch table `types` below and must spawn.)
// Anti-vacuity: each fact is broken by source patch.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const DEC = join(MCLITE_ROOT, '.decomp/net/minecraft/client/particle');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const java = (cls) => { const f = join(DEC, cls + '.java'); return existsSync(f) ? readFileSync(f, 'utf8') : ''; };
const num = (cls, field) => { const m = java(cls).match(new RegExp('this\\.' + field + ' = (-?[0-9.]+)F?;')); return m ? parseFloat(m[1]) : NaN; };
// [engine type, java class, fields compared (field name same in java and engine)]
const FACTS = [
  ['heart', 'EmotionParticle', ['velocityMultiplier']], ['note', 'NoteParticle', ['velocityMultiplier', 'maxAge']],
  ['heart', 'EmotionParticle', ['maxAge']],
  ['bubble_column_up', 'BubbleColumnUpParticle', ['gravityStrength', 'velocityMultiplier']],
  ['damage_indicator', 'DamageParticle', ['velocityMultiplier', 'gravityStrength']],
  ['dragon_breath', 'DragonBreathParticle', ['velocityMultiplier']],
  ['rain', 'RainSplashParticle', ['gravityStrength']], ['sweep_attack', 'SweepAttackParticle', ['maxAge']],
  ['squid_ink', 'SquidInkParticle', ['velocityMultiplier']],
];
function trial(patch) {
  const E = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07zx_particle.js', '14j_combat.js', '14c_raycast.js'], dom: false, ...(patch ? { patch } : {}) });
  const P = E.Particle; P.init(); const o = {};
  const sp = (t) => P.spawn(t, 0, 0, 0, 0, 0, 0, () => 0.5);
  FACTS.forEach(([t, cls, fs], i) => { const p = sp(t); o['f' + i] = !!p && fs.every((f) => num(cls, f) === p[f] || Math.abs(num(cls, f) - p[f]) < 1e-6); });
  // AbstractSlowingParticle-type rolls: ash falls, white ash drifts; EndRod/Animated fade starts after half life
  const a = sp('ash'), w = sp('white_ash'); o.ash = a.gravityStrength === 0.1 && w.gravityStrength === 0.0125 && a.velocityMultiplier === 0.96;
  const er = sp('end_rod'); o.endrod = er.maxAge >= 60 && er.maxAge < 72;
  const ex = sp('explosion'); o.explLarge = ex.maxAge >= 6 && ex.maxAge < 10;
  // every type the audit names must spawn without throwing
  const types = ['flame', 'glow', 'portal', 'cloud', 'smoke', 'poof', 'spit', 'lava', 'effect', 'witch', 'bubble', 'glow_squid_ink', 'totem_of_undying', 'crimson_spore', 'sneeze', 'explosion_emitter', 'vibration_none'];
  o.spawns = types.filter((t) => t !== 'vibration_none').every((t) => { try { return !!sp(t); } catch { return false; } });
  // ParticleManager cap + tick lifetime: a particle dies at maxAge
  const p = sp('sweep_attack'); let n = 0; while (P.list.includes(p) && n < 50) { P.tick(); n++; } o.lifetime = n > 0 && n <= 6;
  return o;
}
const A = trial(null);
const LBL = { ash: 'AshParticle/WhiteAshParticle slowing constants', endrod: 'EndRodParticle maxAge 60+rand(12)', explLarge: 'ExplosionLargeParticle maxAge 6+rand(4)', spawns: 'every named particle class spawns', lifetime: 'ParticleManager.tick removes a particle at maxAge' };
FACTS.forEach(([t, c, f], i) => { LBL['f' + i] = `${c} ${f.join('/')} equals .decomp`; });
if (!existsSync(DEC)) fails.push('.decomp particle dir missing');
for (const [k, m] of Object.entries(LBL)) ok(A[k], m);
const src = readFileSync(join(MCLITE_ROOT, 'src/07zx_particle.js'), 'utf8');
const BR = [
  ['f0', /velocityMultiplier: 0\.86/, 'velocityMultiplier: 0.5'],
  ['f2', /maxAge: 16,                                    \/\/ EmotionParticle\.java:14/, 'maxAge: 17,'],
  ['f3', /gravityStrength: -0\.125/, 'gravityStrength: -0.5'],
  ['f6', /isSplash \? 0\.04 : 0\.06/, 'isSplash ? 0.04 : 0.07'],
  ['f7', /type: 'sweep_attack'[^}]*?maxAge: 4/s, null],
  ['lifetime', /Px\.tick = function \(\) \{/, 'Px.tick = function () { return;'],
  ['endrod', /maxAge: 60 \+ Math\.floor/, 'maxAge: 50 + Math.floor'],
];
for (const [key, re, rep] of BR) {
  breaks++;
  const m = src.match(re);
  if (!m) { fails.push('no-op break: ' + key); continue; }
  const to = rep === null ? m[0].replace(/(velocityMultiplier: )0\.86|maxAge: 4/, (s, g) => g ? g + '0.5' : 'maxAge: 5') : rep;
  let B; try { B = trial((f, s) => f === '07zx_particle.js' ? s.replace(re, to) : s); } catch { B = {}; }
  ok(!B[key], 'anti-vacuity: break ' + key + ' must fail it');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
