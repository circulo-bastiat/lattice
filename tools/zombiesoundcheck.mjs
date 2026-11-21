#!/usr/bin/env node
// zombiesoundcheck.mjs — #666: plain zombie ambient/hurt/death/step (.decomp ZombieEntity.getAmbientSound/
// getHurtSound/getDeathSound/playStepSound: step 0.15/1.0; others getSoundVolume 1 / getSoundPitch 1.0±0.2,
// baby 1.5±0.2; MobEntity.baseTick ambient roll, min delay 80). Proves it can fail.
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

const run = () => {
  const out = {};
  // ambient: rnd()=0 always < chance once chance>0; chance starts 0 so tick 1 is silent, tick 2 fires
  let z = EL.spawn('zombie', 0, 64, 0); z.growAge = 0; z.maxHealth = z.health = 20; z.onGround = true;
  const rz = () => 0.5;            // pitch jitter 0 ; 0.5*1000=500 < chance only when chance>500
  z.ambientSoundChance = 600;
  played.length = 0; U.tickSounds(z, rz); out.ambient = played.map((p) => p);
  out.delay = z.ambientSoundChance;
  played.length = 0; z.ambientSoundChance = 0; U.tickSounds(z, rz); out.quiet = played.length;
  // step: walk 2 blocks (0.6 per block -> one step past 1.0)
  z = EL.spawn('zombie', 0, 64, 0); z.growAge = 0; z.onGround = true; z.ambientSoundChance = 0;
  played.length = 0; U.tickSounds(z, rz);
  z.x = 2; U.tickSounds(z, rz); out.step = played.map((p) => p);
  // hurt / death through Cb.hurt
  z = EL.spawn('zombie', 0, 64, 0); z.growAge = 0; z.maxHealth = z.health = 20;
  played.length = 0; Cb.hurt(z, 1, undefined, true); out.hurt = played.map((p) => p);
  z = EL.spawn('zombie', 0, 64, 0); z.growAge = 0; z.maxHealth = z.health = 20;
  played.length = 0; Cb.hurt(z, 100, undefined, true); out.death = played.map((p) => p);
  // baby pitch
  z = EL.spawn('zombie', 0, 64, 0); z.growAge = -24000;
  out.baby = U.soundPitch(z, rz);
  return out;
};
const good = (o) => {
  const one = (a, ev, vol, pitch) => a.length === 1 && a[0][0] === ev && a[0][1].volume === vol && (pitch === null ? Math.abs(a[0][1].pitch - 1) <= 0.2 : a[0][1].pitch === pitch) && a[0][1].source === 'hostile';
  return one(o.ambient, 'entity.zombie.ambient', 1, 1) && o.delay === -80 && o.quiet === 0 &&
    one(o.step, 'entity.zombie.step', 0.15, 1) && one(o.hurt, 'entity.zombie.hurt', 1, null) &&
    one(o.death, 'entity.zombie.death', 1, null) && o.baby === 1.5;
};
const o = run(); if (process.env.DBG) console.log(JSON.stringify(o));
ok(o.ambient.length === 1 && o.ambient[0][0] === 'entity.zombie.ambient', 'ambient event');
ok(o.delay === -80, 'ambient delay resets to -80');
ok(o.quiet === 0, 'no ambient at chance 0');
ok(o.step.length === 1 && o.step[0][1].volume === 0.15 && o.step[0][1].pitch === 1, 'step 0.15/1.0');
ok(o.hurt.length === 1 && o.hurt[0][0] === 'entity.zombie.hurt', 'hurt event');
ok(o.death.length === 1 && o.death[0][0] === 'entity.zombie.death', 'death event (only, no hurt)');
ok(o.baby === 1.5, 'baby pitch 1.5');
ok(good(o), 'full vanilla comparison');
for (const ev of Object.values(U.SOUNDS.zombie)) ok(evs[ev], `${ev} not in sounds.json`);

// wiring: EL.tickMob reaches tickSounds; Cb.hurt reaches playSound
{
  let n = 0; const s = U.tickSounds;
  M.Physics.updateFluids = () => {}; M.Physics.blockAt = () => 0; M.Physics.eyeWater = () => false; M.Physics.travelMob = () => {}; U.tickSounds = () => { n++; };
  const z = EL.spawn('zombie', 0, 64, 0); z.maxHealth = z.health = 20;
  try { EL.tickMob(z); } catch (e) { if (process.env.DBG) console.log(e.stack.split("\n").slice(0,3).join("\n")); }
  U.tickSounds = s; ok(n === 1, 'EL.tickMob calls Undead.tickSounds');
}

const caught = (label, fn) => {
  const save = { ps: U.playSound, ts: U.tickSounds, es: M.Sound.entitySound, SV: U.STEP_VOLUME, SO: { ...U.SOUNDS.zombie } };
  fn();
  let bad; try { bad = !good(run()); } catch (e) { bad = true; }
  U.playSound = save.ps; U.tickSounds = save.ts; M.Sound.entitySound = save.es; U.STEP_VOLUME = save.SV; Object.assign(U.SOUNDS.zombie, save.SO);
  breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
caught('playSound removed', () => { U.playSound = () => null; });
caught('step volume 0.5', () => { U.STEP_VOLUME = 0.5; });
caught('hurt event swapped', () => { U.SOUNDS.zombie.hurt = 'entity.zombie.death'; });
caught('tickSounds removed', () => { U.tickSounds = () => {}; });
caught('sound layer removed', () => { M.Sound.entitySound = () => {}; });

console.log('\n================ zombiesoundcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
