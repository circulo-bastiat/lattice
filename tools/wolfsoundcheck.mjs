#!/usr/bin/env node
// wolfsoundcheck.mjs - #915: WolfEntity getAmbientSound/getHurtSound/getDeathSound/playStepSound/getSoundVolume.
// ANTI-VACUITY: each assertion is re-run against a broken engine and must fail ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

function scenario(brk) {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
            '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14j_combat.js', '07n_tame.js', '07zw_mobnbt.js'],
    dom: false
  });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Ai.init(); if (M.Combat && M.Combat.init) M.Combat.init();
  const calls = [];
  M.Sound = { play: (ev, o) => { calls.push({ ev, o }); return true; } };
  const T = M.Tame, Cb = M.Combat, EL = M.EntityList;
  if (brk === 'silent') T.wolfSound = () => null;
  if (brk === 'volume') { const f = T.wolfSound; T.wolfSound = (e, k, r) => { const v = f(e, k, r); calls.forEach((c) => { c.o.volume = 1; }); return v; }; }
  if (brk === 'angry') T.isAngry = () => false;
  const out = [];
  const say = (c, m) => { if (!c) out.push(m); };
  EL.list.length = 0;
  const w = EL.spawn('wolf', 0, 64, 0);
  const amb = (r) => { calls.length = 0; T.wolfSound(w, 'ambient', () => r); return calls[0]; };
  w.angerTime = 0; w.tamed = false;
  say((amb(0.9) || {}).ev === 'entity.wolf.ambient', 'wild ambient');
  say((amb(0.1) || {}).ev === 'entity.wolf.pant', 'wild 1/3 roll -> pant');
  w.tamed = true; w.health = 5;
  say((amb(0.1) || {}).ev === 'entity.wolf.whine', 'tamed low health -> whine');
  w.health = 20;
  say((amb(0.1) || {}).ev === 'entity.wolf.pant', 'tamed healthy -> pant');
  w.angerTime = 100;
  const g = amb(0.9);
  say(g && g.ev === 'entity.wolf.growl', 'angry -> growl');
  say(g && g.o.volume === 0.4, 'ambient volume 0.4');
  w.angerTime = 0;
  calls.length = 0; T.wolfSound(w, 'step');
  say(calls[0] && calls[0].ev === 'entity.wolf.step' && calls[0].o.volume === 0.15, 'step 0.15');
  calls.length = 0; Cb.hurt(w, 1, true);
  say(calls.some((x) => x.ev === 'entity.wolf.hurt'), 'hurt sound');
  const w3 = EL.spawn('wolf', 0, 64, 0);
  calls.length = 0; Cb.hurt(w3, 9999, true);
  say(calls.some((x) => x.ev === 'entity.wolf.death'), 'death sound');
  const w2 = EL.spawn('wolf', 0, 64, 0);
  calls.length = 0; w2.ambientSoundChance = 5000; T.tickWolfSounds(w2, () => 0.9);
  say(calls.length === 1, 'ambient roll from tickWolfSounds');
  return out;
}
const fails = scenario(null);
let caught = 0;
const B = ['silent', 'volume', 'angry'];
for (const b of B) {
  if (scenario(b).length) { caught++; console.log(`  ✓ break caught: ${b}`); } else fails.push(`break NOT caught: ${b}`);
}
for (const f of fails) console.log('  ✗ ' + f);
console.log(`wolfsoundcheck: ${fails.length ? 'FAIL' : 'PASS'}`);
console.log(`wolfsoundcheck: ${caught} breaks caught (of ${B.length})`);
process.exit(fails.length ? 1 : 0);
