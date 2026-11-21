#!/usr/bin/env node
// clientsoundloopcheck.mjs - #11728: ElytraSoundInstance + BubbleColumnSoundPlayer ports (02j_sounds.js) vs .decomp, wired from Player.tick.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rd = (f) => readFileSync(join(MCLITE_ROOT, f), 'utf8');
const dec = (c) => rd('.decomp/net/minecraft/client/sound/' + c + '.java');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const E = dec('ElytraSoundInstance'), B = dec('BubbleColumnSoundPlayer');
ok(/tickCount <= 20/.test(E) && /\/ 4\.0F/.test(E) && /1\.0E-7/.test(E) && /\(float\)\(this\.tickCount - 20\) \/ 20\.0F/.test(E) && /\$\$0 - 0\.8F|this\.volume - 0\.8F/.test(E), 'decomp elytra law');
ok(/hasPlayedForCurrentColumn/.test(B) && /!this\.firstTick/.test(B) && /isSpectator/.test(B), 'decomp bubble law');
function trial(patch) {
  const M = loadEngine({ extra: ['02j_sounds.js'], dom: false, patch: patch ? (f, s) => (f === '02j_sounds.js' ? patch(s) : s) : undefined });
  const S = M.Sound, o = {}, near = (a, b) => Math.abs(a - b) < 1e-9;
  const voices = [], plays = [];
  S.loopVoice = (ev, src) => { const v = { event: ev, src, stopped: false, stop() { v.stopped = true; }, set(vol, p) { v.vol = vol; v.pitch = p; } }; voices.push(v); return v; };
  S.entitySound = (ev) => plays.push(ev);
  const L = S.elytraLaw;
  o.silent = L(10, 4).volume === 0 && L(19, 4).volume === 0 && L(30, 1e-8).volume === 0;
  o.ramp = near(L(30, 1).volume, 0.25 * 0.5) && near(L(40, 1).volume, 0.25);
  o.clamp = L(50, 100).volume === 1 && near(L(50, 100).pitch, 1.2) && L(50, 1).pitch === 1;
  const p = { x: 1, y: 2, z: 3, vx: 1, vy: 0, vz: 0, fallFlying: true, removed: false };
  S.elytraTick(p);
  o.start = voices.length === 1 && voices[0].event === 'item.elytra.flying' && voices[0].src === 'player';
  for (let i = 0; i < 25; i++) S.elytraTick(p);
  o.follow = !voices[0].stopped && voices[0].vol > 0;
  p.fallFlying = false; S.elytraTick(p);
  o.done = voices[0].stopped && S.elytraVoice === null;
  S.elytraVoice = null; const q = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fallFlying: false }; S.elytraTick(q);
  o.noglide = voices.length === 1;
  const b = { x: 0, y: 0, z: 0 };
  S.bubbleColumnTick(b, true, true); o.first = plays.length === 0;
  S.bubbleColumnTick(b, false, false); S.bubbleColumnTick(b, true, true);
  o.drag = plays.join() === 'block.bubble_column.whirlpool_inside';
  S.bubbleColumnTick(b, true, true); o.once = plays.length === 1;
  S.bubbleColumnTick(b, false, false); S.bubbleColumnTick(b, true, false);
  o.up = plays[1] === 'block.bubble_column.upwards_inside';
  b.spectator = true; S.bubbleColumnTick(b, false, false); S.bubbleColumnTick(b, true, true); o.spec = plays.length === 2;
  const A = dec('AmbientSoundPlayer'), AL = dec('AmbientSoundLoops');
  o.decA = /1\.0E-4F/.test(A) && /0\.001F/.test(A) && /0\.01F/.test(A) && /\/ 40\.0F/.test(AL) && /transitionTimer -= 2/.test(AL);
  o.law = S.underwaterLaw(0, true).timer === 1 && S.underwaterLaw(0, false).timer === -2 && S.underwaterLaw(40, true).timer === 40 && near(S.underwaterLaw(20, true).volume, 21 / 40) && S.underwaterLaw(-2, false).volume === 0;
  o.pick = S.ambientAdditionFor(0.00005) === 'ambient.underwater.loop.additions.ultra_rare' && S.ambientAdditionFor(0.0005) === 'ambient.underwater.loop.additions.rare' && S.ambientAdditionFor(0.005) === 'ambient.underwater.loop.additions' && S.ambientAdditionFor(0.02) === null;
  plays.length = 0; const ap = { x: 0, y: 0, z: 0, submerged: true, removed: false };
  S.ambientWait = 0; S.underwaterTick(ap, () => 0.005); o.amb = plays.join() === 'ambient.underwater.loop.additions';
  plays.length = 0; ap.submerged = false; S.ambientWait = 0; S.underwaterTick(ap, () => 0.005); o.dry = plays.length === 0;
  return o;
}
for (const [k, v] of Object.entries(trial(null))) ok(v, 'scenario ' + k);
const pl = rd('src/14_player.js');
ok(/Sound\.underwaterTick\(/.test(pl), 'reach: Player.tick calls underwaterTick');
ok(/Sound\.elytraTick\(/.test(pl) && /Sound\.bubbleColumnTick\(/.test(pl), 'reach: Player.tick calls both');
const BR = [
  ['delay', 'tickCount < 20) vol = 0', 'tickCount < 10) vol = 0', ['silent']],
  ['ramp', '((tickCount - 20) / 20)', '1', ['ramp']],
  ['div', 'v2 / 4', 'v2 / 2', ['ramp']],
  ['pitch', '1 + (vol - 0.8)', '1 + (vol - 0.7)', ['clamp']],
  ['setdone', 'v.stop(); S.elytraVoice = null;', 'S.elytraVoice = null;', ['done']],
  ['firsttick', 'p.bcPlayed && p.bcFirstDone', 'p.bcPlayed', ['first']],
  ['drag', "drag ? 'block.bubble_column.whirlpool_inside' : 'block.bubble_column.upwards_inside'", "'block.bubble_column.upwards_inside'", ['drag']],
  ['spectator', '&& !p.spectator', '', ['spec']],
  ['timer2', 'timer - 2', 'timer - 1', ['law']],
  ['cap', 'Math.min(timer, 40)', 'Math.min(timer, 60)', ['law']],
  ['rare', "r < 0.001 ? 'ambient.underwater.loop.additions.rare'", "r < 0.0001 ? 'ambient.underwater.loop.additions.rare'", ['pick']],
  ['needwet', 'S.ambientWait <= 0 && p.submerged', 'S.ambientWait <= 0', ['dry']],
  ['once', 'p.bcPlayed = true;', 'p.bcPlayed = false;', ['once']],
];
for (const [key, a, b2, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b2); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const c = expect.some((q) => !X[q]); ok(c, 'anti-vacuity: ' + key); if (c) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('  FAIL ' + f);
console.log(`clientsoundloopcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
