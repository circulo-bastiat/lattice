#!/usr/bin/env node
// stridersoundcheck.mjs — #935: StriderEntity ambient/hurt/death/step/eat/saddle/happy/retreat sounds.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07zzj_strider.js'], dom: false });
const St = MCL.Strider;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };
function run() {
  const played = [];
  MCL.Sound = MCL.Sound || {};
  MCL.Sound.entitySound = (ev, x, y, z, vol, pitch, src) => { played.push({ ev, vol, pitch, src }); };
  const mk = () => ({ type: 'strider', x: 0, y: 1, z: 0, health: 20, dead: false, onGround: true, growAge: 0 });
  const r = {};
  let e = mk(); St.onDamaged(e); r.hurt = played.splice(0);
  e = mk(); e.health = 0; St.onDamaged(e); r.death = played.splice(0);
  e = mk(); St.playSaddle(e); r.saddle = played.splice(0);
  e = mk(); St.saddle(e, true); r.silent = played.splice(0);
  e = mk(); St.saddle(e); r.player = played.splice(0);
  e = mk(); St.playEat(e, seq(0.9, 0.1)); r.eat = played.splice(0);
  // ambient is MobVoice.tickAmbient's single roll (#3527): tickSounds must not touch the counter or play it
  e = mk(); e.ambientSoundChance = 999; St.tickSounds(e, () => 0); r.ambient = played.splice(0); r.chance = e.ambientSoundChance;
  e = mk(); e.ambientSoundChance = 999; e.striderTempted = true; St.tickSounds(e, () => 0.5); r.tempted = played.splice(0);
  e = mk(); e.ambientSoundChance = 999; e.striderEscaping = true; St.tickSounds(e, () => 0.5); r.escaping = played.splice(0);
  e = mk(); e.striderTempted = true; St.tickSounds(e, () => 0); r.happy = played.splice(0);
  e = mk(); e.striderEscaping = true; St.tickSounds(e, () => 0); r.retreat = played.splice(0);
  e = mk(); St.tickSounds(e, () => 0.5); e.x = 5; St.tickSounds(e, () => 0.5); r.step = played.splice(0);
  e = mk(); e.inLava = true; St.tickSounds(e, () => 0.5); e.x = 5; St.tickSounds(e, () => 0.5); r.lava = played.splice(0);
  e = mk(); e.vehicle = {}; St.tickSounds(e, () => 0.5); e.x = 5; St.tickSounds(e, () => 0.5); r.mounted = played.splice(0);
  e = mk(); e.inWater = true; St.tickSounds(e, () => 0.5); e.x = 5; St.tickSounds(e, () => 0.5); r.wet = played.splice(0);
  // Entity.nextStepSoundDistance starts 1.0F: 1.2 blocks (stepDist 0.72) is silent, 1.8 blocks (1.08) steps (#4419)
  e = mk(); St.tickSounds(e, () => 0.5); e.x = 1.2; St.tickSounds(e, () => 0.5); r.early = played.splice(0); e.x = 1.8; St.tickSounds(e, () => 0.5); r.first = played.splice(0);
  return r;
}
function verdict() {
  const r = run(), id = a => a.map(p => p.ev);
  return id(r.hurt).join() === 'entity.strider.hurt' && id(r.death).join() === 'entity.strider.death' &&
    id(r.saddle).join() === 'entity.strider.saddle' && r.saddle[0].vol === 0.5 &&
    r.silent.length === 0 && id(r.player).join() === 'entity.strider.saddle' &&
    id(r.eat).join() === 'entity.strider.eat' && Math.abs(r.eat[0].pitch - 1.16) < 1e-9 &&
    r.ambient.length === 0 && r.chance === 999 && r.tempted.length === 0 && r.escaping.length === 0 &&
    id(r.happy).includes('entity.strider.happy') && id(r.retreat).includes('entity.strider.retreat') &&
    r.mounted.length === 0 && r.wet.length === 0 &&
    r.early.length === 0 && r.first.length === 1 &&
    id(r.step).join() === 'entity.strider.step' && id(r.lava).join() === 'entity.strider.step_lava';
}
ok(verdict(), 'each strider sound event fires with its id, volume and pitch');
const S0 = { ...St.SOUND };
St.SOUND.hurt = 'x'; if (!verdict()) breaks++; St.SOUND.hurt = S0.hurt;
St.SOUND.stepLava = St.SOUND.step; if (!verdict()) breaks++; St.SOUND.stepLava = S0.stepLava;
{ const ts = St.tickSounds; St.tickSounds = (e, rr) => { e.ambientSoundChance++; return ts(e, rr); }; if (!verdict()) breaks++; St.tickSounds = ts; }
{ const sd = St.saddle; St.saddle = e => sd(e); if (!verdict()) breaks++; St.saddle = sd; }
{ const ts = St.tickSounds; St.tickSounds = (e, rr) => { delete e.vehicle; return ts(e, rr); }; if (!verdict()) breaks++; St.tickSounds = ts; }
{ const ts = St.tickSounds; St.tickSounds = (e, rr) => { if (e.stepDist === undefined) { e.stepDist = 0; e.nextStepDist = 0.6; e.stepX = e.x; e.stepZ = e.z; } return ts(e, rr); }; if (!verdict()) breaks++; St.tickSounds = ts; }
St.SADDLE_VOLUME = 1; if (!verdict()) breaks++; St.SADDLE_VOLUME = 0.5;
ok(verdict(), 'restored data passes again');
ok(breaks === 7, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
