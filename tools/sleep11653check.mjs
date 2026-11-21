#!/usr/bin/env node
// #11733 classmap: exercises BadRespawnPointDamageSource (net/minecraft/entity/damage)
// sleep11653check.mjs — #11653: proves 14m_sleep.js through Sleep.use/tick/wake: EntityPose SLEEPING (0.2 box/eye) and back to
// STANDING, SleepManager night skip (sleepTimer>=100 -> next dawn), setSpawnPoint, Timer (110-tick post-wake decay). Source breaks must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '07za_explosion.js', '02g_items.js', '02l_advancements.js', '07_world.js', '07b_behaviour.js',
  '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14e_gamemode.js', '09b_sky.js', '07zq_snowgolem.js',
  '14f_inventory.js', '14j_combat.js', '14_player.js', '14l_use.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zz1_phantom.js', '14m_sleep.js'];
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'),
    monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(ROOT, 'src', '19_data.gen.js'), 'utf8'))[1]) });
  M.Entities.init();
  const W = M.World, R = M.Reg, SR = M.States, Sleep = M.Sleep, Sky = M.Sky;
  M.EntityList.init(); M.Ai.init(); M.Use.init(W); Sleep.init(W);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  }
  const bed = (part) => { const b = R.id.red_bed, P_ = R.PROP, V = R.PVAL;
    for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++)
      if (SR.propValue(s, P_.part) === V[part] && SR.propValue(s, P_.facing) === V.south && SR.propValue(s, P_.occupied) === V['false']) return s; };
  const HEAD = bed('head'), FOOT = bed('foot'), STONE = SR.stateOf('stone');
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 63, z, STONE);
  W.setBlock(0, 64, 0, FOOT); W.setBlock(0, 64, 1, HEAD);
  M.Hud = { say() {} };
  const mk = () => ({ x: 0.5, y: 64, z: 0.5, px: 0, py: 0, pz: 0, ex: 0, ey: 0, ez: 0, vx: 0, vy: 0, vz: 0, yaw: 0, height: 1.8, eyeHeight: 1.62,
    sleeping: false, sleepPos: null, sleepTimer: 0, spawnPoint: null, dead: false, mode: 0, type: 'player' });
  Sky.dayTime = 6000; Sky.weather = Sky.newWeather();
  const dayP = mk(); Sleep.use(dayP, 0, 64, 1, HEAD);
  no(!dayP.sleeping, 'slept in daytime');
  no(dayP.spawnPoint && dayP.spawnPoint.z === 1, 'spawn point not set by refused sleep');
  Sky.dayTime = 13000; Sky.weather = Sky.newWeather();
  const P = mk(); Sleep.use(P, 0, 64, 1, HEAD);
  no(P.sleeping === true, 'night sleep did not start');
  no(P.height === 0.2 && P.eyeHeight === 0.2, 'SLEEPING pose dims not applied');
  for (let i = 0; i < 99; i++) Sleep.tick(P);
  no(P.sleeping && P.sleepTimer === 99, 'timer not counting to 99: ' + P.sleepTimer);
  Sleep.tick(P);
  no(!P.sleeping && Sky.dayTime === 24000, 'night not skipped at 100 ticks: ' + Sky.dayTime);
  no(P.height === 1.8 && P.eyeHeight === 1.62, 'STANDING pose not restored');
  no(P.sleepTimer === 0, 'timer not reset after completed night');
  // manual wake leaves the timer at 100, which decays through 110 back to 0
  Sky.dayTime = 13000;
  const Q = mk(); Sleep.use(Q, 0, 64, 1, HEAD); Sleep.tick(Q); Sleep.wake(Q, false);
  no(!Q.sleeping && Q.sleepTimer === 100, 'manual wake timer ' + Q.sleepTimer);
  for (let i = 0; i < 9; i++) Sleep.tick(Q);
  no(Q.sleepTimer === 109, 'post-wake decay ' + Q.sleepTimer);
  Sleep.tick(Q);
  no(Q.sleepTimer === 0, 'post-wake decay did not wrap at 110');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['pose dims', brk('14m_sleep.js', 'P.height = 0.2; P.eyeHeight = 0.2;', 'P.height = 1.8;')],
  ['standing restore', brk('14m_sleep.js', 'P.sleepYaw = undefined;\n    P.sleeping = false;', 'P.sleepYaw = undefined;\n    P.sleeping = true;')],
  ['skip threshold', brk('14m_sleep.js', 'if (P.sleepTimer >= 100) performNightSkip(P);', 'if (P.sleepTimer >= 101) performNightSkip(P);')],
  ['skip target', brk('14m_sleep.js', 'Sky.dayTime = t - (t % 24000);', 'Sky.dayTime = t;')],
  ['decay wrap', brk('14m_sleep.js', 'if (P.sleepTimer >= 110) P.sleepTimer = 0;', 'if (P.sleepTimer >= 120) P.sleepTimer = 0;')],
  ['spawn point', brk('14m_sleep.js', 'P.spawnPoint = { x: x,', 'P.spawnPointX = { x: x,')],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('sleep11653check: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`sleep11653check: OK — ${caught} breaks caught`);
