#!/usr/bin/env node
// advtrig-started_ridingcheck.mjs — G17-AT18 (#7980). Drives the REAL call site (Mnt.mount -> Adv.trigger
// 'minecraft:started_riding'); a non-matching `player` condition must not complete; breaks its own matcher/call site.
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
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07r_mount.js'];
const fails = []; let asserted = 0; let users = [];

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1); MCL.Behave.init(MCL.World);
  MCL.EntityList.init(); MCL.Ai.init(); MCL.Breed.init(); MCL.Mount.init();
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const using = [];
  Adv.manager.advancements.forEach((a) => { for (const n in a.criteria) if (a.criteria[n].trigger === 'minecraft:started_riding') using.push(a.id + '#' + n); });
  users = using;
  no(using.length > 0, 'no advancement uses started_riding');
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const horse = MCL.EntityList.spawn('horse', 0.5, 70, 0.5);
  no(!!horse, 'horse did not spawn');
  // a failed mount (baby / already ridden) must not trigger
  horse.rider = 'x';
  MCL.Mount.mount(horse);
  no(done.length === 0, 'triggered on a refused mount');
  horse.rider = null;
  // matcher: a non-matching player condition must not complete
  const m = Adv.matchers['minecraft:started_riding'];
  no(m && !m({ player: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:pig' } }] }, { player: P }), 'non-matching player condition matched');
  no(m && m({}, { player: P }) === true, 'empty conditions did not match');
  no(MCL.Mount.mount(horse) === true, 'mount refused');
  no(done.length === 0, 'riding a horse completed a boat+goat advancement');
  MCL.Mount.dismount(horse);
  // a boat carrying a goat (ride_a_boat_with_a_goat): drive the same call site with a boat vehicle
  const boat = MCL.EntityList.spawn('boat', 2.5, 70, 0.5), goat = MCL.EntityList.spawn('goat', 2.5, 70, 0.5);
  no(!!boat && !!goat, 'boat/goat did not spawn');
  boat.passengers = [goat];
  MCL.Mount.isMountable = () => true;
  MCL.Mount.mount(boat);
  using.forEach((u) => no(done.includes(u.split('#')[0]), 'not completed: ' + u));
  return f;
}
run().forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07r_mount.js', "'minecraft:started_riding', {", "'minecraft:started_riding_x', {")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:started_riding'] = function", "Adv.matchers['minecraft:x'] = function")],
  ['player ignored', brk('02l_advancements.js', "{ 'this': me });", "{ 'this': null }); return true;")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
console.log('advancements using started_riding: ' + users.join(', '));
if (fails.length) { console.log('advtrig-started_ridingcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-started_ridingcheck: OK — ${caught} breaks caught`);
