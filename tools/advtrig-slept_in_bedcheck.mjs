#!/usr/bin/env node
// advtrig-slept_in_bedcheck.mjs — G17-AT39 (#8042). Drives the REAL call site (Sleep.use -> doSleep ->
// Adv.trigger 'minecraft:slept_in_bed') against SleptInBedCriterion; breaks its own matcher and call site.
// Vanilla 1.18.2 advancement using it (packed data): adventure/sleep_in_bed.
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
  const Adv = M.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  no(typeof Adv.matchers['minecraft:slept_in_bed'] === 'function' && Adv.matchers['minecraft:slept_in_bed']({}, { player: { x: 0, y: 0, z: 0 } }) === true, 'matcher missing or rejects empty conditions');
  const done = [];
  const mk = () => { const p = { x: 0.5, y: 64, z: 0.5, px: 0, py: 0, pz: 0, ex: 0, ey: 0, ez: 0, vx: 0, vy: 0, vz: 0, yaw: 0,
    sleeping: false, sleepPos: null, sleepTimer: 0, spawnPoint: null, dead: false, mode: 0, type: 'player' };
    p.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) }); return p; };
  const has = () => done.includes('minecraft:adventure/sleep_in_bed');
  Sky.dayTime = 6000; Sky.weather = Sky.newWeather();
  const dayP = mk(); Sleep.use(dayP, 0, 64, 1, HEAD);
  no(!dayP.sleeping && !has(), 'granted though the sleep was refused (daytime)');
  Sky.dayTime = 13000; Sky.weather = Sky.newWeather();
  const P = mk(); Sleep.use(P, 0, 64, 1, HEAD);
  no(P.sleeping === true, 'night sleep did not start');
  no(has(), 'adventure/sleep_in_bed not completed by a real sleep');
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14m_sleep.js', "'minecraft:slept_in_bed', {", "'minecraft:slept_in_bed_x', {")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:slept_in_bed'] = function (c, ctx) {", "Adv.matchers['minecraft:x'] = function (c, ctx) {")],
  ['matcher never matches', brk('02l_advancements.js', "var pl = ctx.player;\n    return P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': pl });\n  };\n  // ChanneledL", "return false;\n  };\n  // ChanneledL")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-slept_in_bedcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-slept_in_bedcheck: OK — ${caught} breaks caught`);
