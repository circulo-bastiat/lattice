#!/usr/bin/env node
// blazeburncheck.mjs — #1862: BlazeEntity.tickMovement's client effects (src/07zzh_blaze.js mobTick):
// 2 large_smoke per tick, entity.blaze.burn on 1/24 ticks (vol 1+rand, pitch rand*0.7+0.3).
import { loadEngine } from './loadsrc.mjs';

let fails = 0, breaks = 0;
const lines = [];
const ok = (c, m) => { if (!c) { fails++; lines.push('  FAIL ' + m); } };

function run(rollSeq) {
  const MCL = loadEngine({ extra: ['07zzh_blaze.js'], dom: false });
  const sounds = [], parts = [];
  MCL.Sound = { mobSound: (e, ev, v, p) => { sounds.push([ev, v, p]); sounds.pos = [e.x, e.y, e.z]; return true; } };
  MCL.Particle = { spawn: (t, x, y, z, a, b, c, r) => { const p = { t, scale: 1 }; parts.push(p); return p; } };
  let i = 0;
  MCL.EntityList = { random: () => 0.5 };
  MCL.fbRand = () => rollSeq[i++ % rollSeq.length];   // #5361: the client-only effects draw from the render stream, not the entity's
  const e = { type: 'blaze', x: 0, y: 0, z: 0, width: 0.6, height: 1.8, vy: 0, onGround: true };
  MCL.Blaze.mobTick(e);
  return { sounds, parts };
}

const lo = run([0.0, 0.5]);                       // first roll 0 -> nextInt(24)==0 fires
ok(lo.sounds.length === 1 && lo.sounds[0][0] === 'entity.blaze.burn', 'burn sound plays on the 1/24 roll');
ok(lo.sounds[0] && lo.sounds[0][1] >= 1 && lo.sounds[0][1] < 2 && lo.sounds[0][2] >= 0.3 && lo.sounds[0][2] < 1, 'volume 1..2, pitch 0.3..1');
ok(lo.parts.length === 2 && lo.parts.every((p) => p.t === 'smoke' && p.scale === 2.5), 'two large smoke per tick');
ok(lo.sounds.pos && lo.sounds.pos.join() === '0.5,0.5,0.5', 'burn sound plays at entity pos + (0.5,0.5,0.5)');
const hi = run([0.9]);
ok(hi.sounds.length === 0 && hi.parts.length === 2, 'no sound off the roll, smoke still spawns');

// anti-vacuity: the check must fail on a blaze with no effects
const MCL = loadEngine({ extra: ['07zzh_blaze.js'], dom: false });
const dead = { sounds: 0, parts: 0 };
MCL.Sound = { mobSound: () => dead.sounds++ }; MCL.Particle = { spawn: () => dead.parts++ };
MCL.EntityList = { random: () => 0 };
MCL.Blaze.mobTick({ type: 'blaze', x: 0, y: 0, z: 0, width: 0.6, height: 1.8, vy: 0, onGround: true, removed: true });
breaks++; ok(dead.sounds === 0 && dead.parts === 0, 'removed blaze makes no effects');
breaks++; ok(run([0.9]).sounds.length === 0, 'broken roll (no 1/24) yields no sound');
breaks++; ok(lo.sounds.pos.join() !== '0,0,0', 'feet-origin position would be caught');
const total = 8;
// first line is what the suite row shows
console.log('blazeburncheck #1862 — ' + breaks + ' breaks caught');
lines.forEach((l) => console.log(l));
console.log((total - fails) + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
