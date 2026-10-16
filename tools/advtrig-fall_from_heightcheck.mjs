#!/usr/bin/env node
// advtrig-fall_from_heightcheck.mjs — G17-AT8 (#7755). Drives the REAL call site (Ph.move landing -> Ph.playerLanding ->
// Adv.trigger 'minecraft:fall_from_height') against TravelCriterion; breaks its own matcher and call site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zzm_wither.js'];
const fails = []; let asserted = 0;
const ok = (c, m) => { asserted++; if (!c) fails.push(m); };

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1); MCL.Behave.init(MCL.World);
  if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
  MCL.EntityList.init(); MCL.Ai.init(); if (MCL.Spawn && MCL.Spawn.init) MCL.Spawn.init();
  MCL.Breed.init(); MCL.Combat.init && MCL.Combat.init();
  for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
    const c = MCL.World.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(cx, cz), c);
  }
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const has = (id) => done.includes('minecraft:' + id);
  const adv = Adv.manager.get('minecraft:adventure/fall_from_world_height');
  if (process.env.SHOWCOND) console.log(JSON.stringify(Object.values(adv.criteria).map((c) => c.conditions)));
  const Ph = MCL.Phys || MCL.Physics;
  const fall = (fromY, floorY) => {
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = -64; y < 300; y++) MCL.World.setBlock && MCL.World.setBlock(x, y, z, 0);
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) MCL.World.setBlock(x, floorY, z, MCL.Reg.id.stone);
    Object.assign(P, { x: 0.5, y: fromY, z: 0.5, vx: 0, vy: 0, vz: 0, onGround: false, fallDistance: 0, fallStartPos: null, health: 20 });
    for (let i = 0; i < 400 && !P.onGround; i++) { P.vy = -3; Ph.move(P, 0, -3, 0); }
  };
  fall(100, 60);
  no(P.onGround, 'did not land (short fall)');
  no(!has('adventure/fall_from_world_height'), 'short fall completed fall_from_world_height');
  // matcher alone: start 300 (< 319) and a 378-block drop each fail one condition
  const direct = (sy, py) => { P.y = py; Adv.trigger(P, 'minecraft:fall_from_height', { player: P, start: [0.5, sy, 0.5] }); return has('adventure/fall_from_world_height'); };
  no(!direct(300, -61), 'start below 319 completed it');
  no(!direct(319, -59.5), 'a 378.5 drop completed it');
  no(direct(330, -61), 'matcher rejected a valid fall');
  done.length = 0; for (const k in adv.criteria) P.advancements.getProgress(adv).criteria.get(k).date = null;
  P.advancements.getProgress(adv).done = false;
  fall(330, 200);
  no(!has('adventure/fall_from_world_height'), 'fall from 330 landing at 200 completed it (distance/player location)');
  fall(330, -62);
  no(P.onGround, 'did not land (world-height fall)');
  no(has('adventure/fall_from_world_height'), 'world-height fall did not complete fall_from_world_height');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const cb = readFileSync(join(ROOT, 'src/14b_physics.js'), 'utf8'), ad = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14b_physics.js', "'minecraft:fall_from_height', {", "'minecraft:fall_from_height_x', {")],
  ['start never recorded', brk('14b_physics.js', 'e.fallStartPos == null) e.fallStartPos =', 'e.fallStartPos === 1) e.fallStartPos =')],
  ['distance ignored', brk('02l_advancements.js', 'P.distance(c.distance, s[0]', 'true || P.distance(c.distance, s[0]')],
  ['start_position ignored', brk('02l_advancements.js', 'P.location(c.start_position, lc', 'true || P.location(c.start_position, lc')],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:fall_from_height'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-fall_from_heightcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-fall_from_heightcheck: OK — ${caught} breaks caught`);
