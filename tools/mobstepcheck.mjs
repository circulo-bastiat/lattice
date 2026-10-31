#!/usr/bin/env node
// mobstepcheck.mjs — #817: generic mob step sounds (distanceTraveled/nextStep) + iron golem walk dust.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js', '07i_entitylist.js', '07zzp_mobvoice.js'], dom: false });
const EL = MCL.EntityList;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
function run(type, speed, ticks) {
  const played = [], dust = [];
  MCL.World = { getBlock: () => 1 };
  MCL.Sound = { ready: true, play: (id, o) => { played.push([id, o]); return true; }, blockStep: () => { played.push(['block', {}]); return true; } };
  MCL.Particle = { ready: true, spawnBlockDust: () => { dust.push(1); return {}; } };
  EL.random = () => 0;
  const e = { type, ai: {}, x: 0, y: 64, z: 0, px: 0, py: 64, pz: 0, vx: speed, vy: 0, vz: 0, width: 1.4 };
  for (let i = 0; i < ticks; i++) { e.px = e.x; e.x += speed; EL.tickStep(e); }
  return { played, dust };
}
function verdict() {
  const g = run('iron_golem', 0.2, 30);           // 0.12 per tick: 30 ticks = 3.6 -> steps at >1,>2,>3
  const p = run('pig', 0.2, 30), c = run('creeper', 0.2, 30), still = run('iron_golem', 0, 30);
  return g.played.length === 3 && g.played.every(x => x[0] === 'entity.iron_golem.step' && x[1].volume === 1) &&
    p.played.length === 3 && p.played[0][0] === 'entity.pig.step' && p.played[0][1].volume === 0.15 &&
    c.played.length === 3 && c.played[0][0] === 'block' &&
    g.dust.length === 30 && p.dust.length === 0 && still.played.length === 0 && still.dust.length === 0;
}
ok(verdict(), 'golem/pig/creeper step cadence and sounds; golem dust only while moving');
// #3487: MobVoice.tickStep is silent for getMoveEffect()==EVENTS mobs (bat), on ground and wet; a zombie still steps
const MV = MCL.MobVoice, mobSounds = {};
for (const l of readFileSync(fileURLToPath(new URL('./golden/mob-sounds-1.18.2.tsv', import.meta.url)), 'utf8').split(/\r?\n/)) { if (!l || l[0] === '#') continue; const c = l.split('\t'); mobSounds[c[0]] = c.slice(2); }
MCL.DATA = Object.assign({}, MCL.DATA, { mobSounds });
const mvStep = (type, wet) => { MCL.Physics = { blockAt: () => 1 }; MCL.Sound = { blockVP: () => ({}), blockStep: () => true, play: () => true };
  const e = { type, x: 0, y: 64, z: 0, onGround: true, inWater: wet, stepX: -1, stepZ: 0 }; MV.tickStep(e); e.x = 5.5; e.stepX = 5; e.stepDist = 2; return MV.tickStep(e); };
const mvOk = () => ['bat', 'guardian', 'elder_guardian'].every(t => !mvStep(t, false) && !mvStep(t, true)) && mvStep('zombie', false);
ok(mvOk(), 'MobVoice.tickStep: bat silent on ground and in water, zombie steps');
const evSv = MV.EVENTS_ONLY; MV.EVENTS_ONLY = {}; if (!mvOk()) breaks++; MV.EVENTS_ONLY = evSv;
// #3493: EL.tickStep silent for endermite/silverfish (EVENTS move effect); the break lists them in STEP_SOUND again
const elEv = () => run('endermite', 0.2, 30).played.length === 0 && run('silverfish', 0.2, 30).played.length === 0;
ok(elEv(), 'EL.tickStep: endermite/silverfish silent');
const nSv = EL.STEP_NONE; EL.STEP_NONE = {}; if (!elEv()) breaks++; EL.STEP_NONE = nSv;
const sv = [EL.STEP_SOUND.iron_golem, EL.golemDust, EL.STEP_NONE];
EL.STEP_SOUND.iron_golem = ['x', 1]; if (!verdict()) breaks++; EL.STEP_SOUND.iron_golem = sv[0];
EL.golemDust = () => {}; if (!verdict()) breaks++; EL.golemDust = sv[1];
EL.STEP_NONE = { creeper: 1, pig: 1 }; if (!verdict()) breaks++; EL.STEP_NONE = sv[2];
const stepOk = () => { const e = { type: 'axolotl' }; EL.DEFAULTS.axolotl(e, {}); return e.stepHeight === 1.0 && e.maxUpStep === 1.0; };
ok(stepOk(), 'axolotl EL init sets stepHeight 1.0');
const axSv = EL.DEFAULTS.axolotl; EL.DEFAULTS.axolotl = function () {}; if (!stepOk()) breaks++; EL.DEFAULTS.axolotl = axSv;
// #4115: evoker (HostileEntity) steps, splashes and fall-sounds through MobVoice; its ambient/hurt/death stay with NS.Spell
const evVoice = () => { const pl = []; MCL.Sound = { blockVP: () => ({}), blockStep: () => { pl.push('step'); return true; }, play: id => { pl.push(id); return true; } };
  const e = { type: 'evoker', x: 0, y: 64, z: 0, onGround: true, inWater: false, voiceWet: false, health: 20 };
  MV.tickStep(Object.assign(e, { stepX: -1, stepZ: 0, stepDist: 2 })); e.inWater = true; MV.tickWater(e); MV.onFall(e, 6); MV.onDamage(e, false);
  return pl.includes('step') && pl.includes('entity.hostile.splash') && pl.includes('entity.hostile.big_fall') && !pl.some(x => /evoker/.test(x)); };
ok(evVoice(), 'evoker: step, hostile splash, big_fall play; no table hurt/ambient');
const skSv = MV.SKIP; MV.SKIP = Object.assign({ evoker: 1 }, skSv); if (!evVoice()) breaks++; MV.SKIP = skSv;
ok(breaks === 7, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
