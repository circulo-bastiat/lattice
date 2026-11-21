#!/usr/bin/env node
// lockstep-eatgrass -- #8637 (G18b-L28): lockstep scenario eatgrass, 20 salts x 6000 ticks. Sheep and baby sheep on a grass field
// drive Passive.EatGrassGoal each tick; the per-tick event log (start roll, 40-tick timer reaching the trigger, short grass removed /
// grass_block -> dirt, sheared cleared, baby growAge +60) is compared with an independent model built from EatGrassGoal.java /
// SheepEntity.java constants (roll nextInt(baby?50:1000)==0, MAX_TIMER 40). This engine has no every-other-tick goal alternator
// (07w_passive.js header), so the model's per-tick roll is the doubled 2*N, and the timer trigger 5 is the halved getTickCount(4).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const dec = (f) => readFileSync(join(ROOT, '.decomp/net/minecraft/entity', f), 'utf8');
const eg = dec('ai/goal/EatGrassGoal.java');
if (!/nextInt\(this\.mob\.isBaby\(\) \? 50 : 1000\)|nextInt\(this\.mob\.isBaby\(\)\s*\?\s*50\s*:\s*1000\)/.test(eg.replace(/\s+/g, ' '))) throw new Error('decomp roll is not 50/1000');
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 6000, MAXT = 40, TRIG = 5;

function engineLog(patch, salt, baby, onShort) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '07m_breed.js', '07w_passive.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets/entities.json'), 'utf8')) });
  M.Entities.init(); M.Breed.init();
  if (!M.Breed.ready) throw new Error('Breed not ready');
  const W = M.World, R = M.Reg, S = M.States;
  W.init(1);
  const c = W.makeChunk(0, 0); c.state = M.CH.GENERATED; W.chunks.set(W.key(0, 0), c);
  const gb = S.stateOf('grass_block'), dirt = S.stateOf('dirt');
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) W.setBlock(x, 63, z, gb);
  const grassState = S.stateOf('grass');
  const e = { type: 'sheep', x: 8.5, y: 64, z: 8.5, growAge: baby ? -24000 : 0, sheared: true, path: {} };
  const rnd = stream(salt);
  const g = new M.Passive.EatGrassGoal(e, { random: rnd });
  const log = []; let running = false;
  const refill = () => { if (onShort) W.setBlock(8, 64, 8, grassState); else W.setBlock(8, 63, 8, gb); e.sheared = true; };
  if (onShort) refill();
  for (let t = 0; t < TICKS; t++) {
    if (!running) {
      if (g.canUse()) { running = true; g.start(); log.push([t, 'start', g.getTimer()]); }
    } else {
      const a = e.growAge, before = W.getBlock(8, onShort ? 64 : 63, 8);
      g.tick();
      if (W.getBlock(8, onShort ? 64 : 63, 8) !== before) log.push([t, 'block', W.getBlock(8, onShort ? 64 : 63, 8) === (onShort ? 0 : dirt) ? 'eaten' : 'other', e.sheared, e.growAge - a]);
      if (!g.canContinueToUse()) { g.stop(); running = false; log.push([t, 'stop']); refill(); e.growAge = baby ? -24000 : 0; }
    }
  }
  return log;
}

function modelLog(salt, baby) {
  const rnd = stream(salt), roll = baby ? 2 * 50 : 2 * 1000, log = [];
  let timer = 0;
  for (let t = 0; t < TICKS; t++) {
    if (timer === 0) { if (Math.floor(rnd() * roll) === 0) { timer = MAXT; log.push([t, 'start', MAXT]); } }
    else {
      timer--;
      if (timer === TRIG) log.push([t, 'block', 'eaten', false, baby ? 60 * 20 : 0]);
      if (timer === 0) log.push([t, 'stop']);
    }
  }
  return log;
}

let bad = 0, breaks = 0, events = 0;
const run = (patch, salts, report) => {
  let n = 0;
  for (const s of salts) for (const baby of [false, true]) for (const onShort of [false, true]) {
    const a = JSON.stringify(engineLog(patch, s, baby, onShort)), b = JSON.stringify(modelLog(s, baby));
    if (a !== b) { n++; if (report && n <= 3) console.log(`FAIL salt ${s} baby=${baby} short=${onShort}: ${a.slice(0, 120)} vs ${b.slice(0, 120)}`); }
    else if (report) events += JSON.parse(a).length;
  }
  return n;
};
bad += run(null, Array.from({ length: 20 }, (_, i) => i), true);
if (!events) { bad++; console.log('FAIL vacuous: no eating event ever'); }
const mut = (name, file, f, to) => {
  let hit = false;
  const patch = (fn, src) => { if (fn !== file) return src; const o = src.replace(f, to); if (o !== src) hit = true; return o; };
  const n = run(patch, [0, 1, 2], false);
  if (!hit) { bad++; console.log('FAIL mutation did not apply: ' + name); } else if (n) { breaks++; breaks > 0 && void 0; } else { bad++; console.log('NOT CAUGHT ' + name); }
};
mut('grass chance 1/1000 -> 1/500', '07w_passive.js', 'EAT_GRASS_ADULT_ROLL = 2000', 'EAT_GRASS_ADULT_ROLL = 1000');
mut('baby chance 1/50 -> 1/25', '07w_passive.js', 'EAT_GRASS_BABY_ROLL = 100', 'EAT_GRASS_BABY_ROLL = 50');
mut('timer 40 -> 30', '07w_passive.js', 'EAT_GRASS_MAX_TIMER = 40', 'EAT_GRASS_MAX_TIMER = 30');
mut('baby ageUp 60 -> 30', '07w_passive.js', 'ageUp(e, 60, false)', 'ageUp(e, 30, false)');
console.log(`lockstep-eatgrass: ${events} events, ${bad} failures, ${breaks} breaks caught (20 salts x ${TICKS} ticks x 4 variants)`);
process.exit(bad ? 1 : 0);
