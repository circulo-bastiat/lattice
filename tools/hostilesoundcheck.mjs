#!/usr/bin/env node
// hostilesoundcheck.mjs — #696: husk/drowned/zombie_villager/zombified_piglin ambient/hurt/death/step (.decomp ZombieEntity.getAmbientSound/
// getHurtSound/getDeathSound/playStepSound: step 0.15/1.0; others getSoundVolume 1 / getSoundPitch 1.0±0.2,
// baby 1.5±0.2). Drowned *_water variants while touching water; piglin angry ambient. Proves it can fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js', '14j_combat.js', '07zx_particle.js', '07zk_undead.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init();
M.EntityList.init();
M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, U = M.Undead;
const evs = JSON.parse(readFileSync(join(ROOT, '.mcsnd', 'sounds.json'), 'utf8'));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const played = [];
M.Sound = Object.assign(M.Sound || {}, { play: (ev, o) => { played.push([ev, o]); } });
M.Sound.entitySound = (ev, x, y, z, volume, pitch, source) => M.Sound.play(ev, { x, y, z, volume, pitch, source });

const rz = () => 0.5;
const mk = (t) => { const z = EL.spawn(t, 0, 64, 0); z.growAge = 0; z.maxHealth = z.health = 20; z.onGround = true; return z; };
const ev = (t, kind, mut) => { const z = mk(t); if (mut) mut(z); played.length = 0; U.playSound(z, kind, rz); return played.map((p) => p[0]).join(','); };
const hurtEv = (t, w) => { const z = mk(t); z.inWater = !!w; played.length = 0; Cb.hurt(z, 1, undefined, true); return played.map((p) => p[0]).join(','); };
const deathEv = (t, w) => { const z = mk(t); z.inWater = !!w; played.length = 0; Cb.hurt(z, 100, undefined, true); return played.map((p) => p[0]).join(','); };
const run = () => {
  const o = [];
  for (const [t, n] of [['husk', 'husk'], ['zombie_villager', 'zombie_villager'], ['zombified_piglin', 'zombified_piglin'], ['drowned', 'drowned']]) {
    o.push(ev(t, 'ambient') === `entity.${n}.ambient`);
    o.push(hurtEv(t) === `entity.${n}.hurt`);
    o.push(deathEv(t) === `entity.${n}.death`);
  }
  o.push(ev('husk', 'step') === 'entity.husk.step');
  o.push(ev('zombie_villager', 'step') === 'entity.zombie_villager.step');
  o.push(ev('drowned', 'step') === 'entity.drowned.step');
  o.push(ev('zombified_piglin', 'step') === 'entity.zombie.step');
  o.push(ev('drowned', 'ambient', (z) => { z.inWater = true; }) === 'entity.drowned.ambient_water');
  o.push(hurtEv('drowned', true) === 'entity.drowned.hurt_water');
  o.push(deathEv('drowned', true) === 'entity.drowned.death_water');
  o.push(ev('zombified_piglin', 'ambient', (z) => { z.angerTime = 100; }) === 'entity.zombified_piglin.angry');
  { const p = mk('zombified_piglin'); p.angerTime = 400; played.length = 0; p.target = { x: 1, y: 64, z: 0 };
    let t = 0; for (; t < 40 && !played.length; t++) U.tickSounds(p, () => 0.99);
    o.push(played.length === 1 && played[0][0] === 'entity.zombified_piglin.angry' && t <= 20 && played[0][1].volume === 2 && Math.abs(played[0][1].pitch - 1.8) < 1e-9); }
  // volume/pitch: step 0.15/1.0, others 1 / baby 1.5
  const z = mk('husk'); played.length = 0; U.playSound(z, 'step', rz); o.push(played[0][1].volume === 0.15 && played[0][1].pitch === 1);
  const b = mk('husk'); b.growAge = -24000; played.length = 0; U.playSound(b, 'hurt', rz); o.push(played[0][1].pitch === 1.5 && played[0][1].source === 'hostile');
  return o;
};
const good = (o) => o.every(Boolean);
const res = run();
res.forEach((v, i) => ok(v, 'assertion #' + i));
for (const t of ['husk', 'zombie_villager', 'zombified_piglin', 'drowned', 'zombie'])
  for (const e of Object.values(U.SOUNDS[t])) ok(evs[e], `${e} not in sounds.json`);

const caught = (label, fn, restore) => {
  fn();
  let bad; try { bad = !good(run()); } catch (e) { bad = true; }
  restore();
  breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
const S = (t, k) => { const old = U.SOUNDS[t][k]; return [(v) => { U.SOUNDS[t][k] = v; }, () => { U.SOUNDS[t][k] = old; }]; };
{ const [set, rs] = S('husk', 'hurt'); caught('husk hurt swapped', () => set('entity.zombie.hurt'), rs); }
{ const [set, rs] = S('drowned', 'death_water'); caught('drowned water death missing', () => set(undefined), rs); }
{ const [set, rs] = S('zombified_piglin', 'angry'); caught('piglin angry ambient dropped', () => set('entity.zombified_piglin.ambient'), rs); }
{ const o = U.tickAngrySound; caught('piglin angry-on-target dropped', () => { U.tickAngrySound = () => {}; }, () => { U.tickAngrySound = o; }); }
{ const [set, rs] = S('zombie_villager', 'step'); caught('villager step swapped', () => set('entity.zombie.step'), rs); }
{ const o = U.soundEvent; caught('soundEvent ignores water', () => { U.soundEvent = (e, k) => U.SOUNDS[e.type][k]; }, () => { U.soundEvent = o; }); }

console.log('\n================ hostilesoundcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
