#!/usr/bin/env node
// advtrig-bred_animalscheck.mjs — G17-AT11. minecraft:bred_animals: Adv.matchers + the Breed.breed call site.
// Drives the real Breed.breed with a player-caused pair; asserts both husbandry advancements complete, that a
// non-matching condition does not, then breaks matcher and call site and requires the asserts to fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');

function run(patch) {
  const M = loadEngine({
    extra: ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
            '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07zx_particle.js', '07zzo_stats.js'],
    patch
  });
  const im = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: im.rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  const am = JSON.parse(readFileSync(join(ASSETS, 'advancements.meta.json'), 'utf8'));
  M.Adv.init({ advancements: readFileSync(join(ASSETS, 'advancements.bin')).toString('base64'), advancementsBytes: am.rawBytes });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init(); M.Breed.init();
  const f = [], no = (c, m) => { if (!c) f.push(m); };
  const A = M.Adv, Br = M.Breed, EL = M.EntityList;
  const player = { x: 0, y: 8, z: 0 };
  player.advancements = new A.Tracker({});
  const done = (id) => player.advancements.getProgress(A.manager.get(id)).isDone();
  const pair = (type, cause) => {
    const a = EL.spawn(type, 0.5, 8, 0.5), b = EL.spawn(type, 1.5, 8, 0.5);
    Br.setAge(a, 0); Br.setAge(b, 0); Br.setInLove(a, cause); Br.setInLove(b, null);
    return [a, b];
  };
  // no loving player: nothing fires
  let [a, b] = pair('cow', null);
  no(!!Br.breed(a, b, { random: () => 0.5 }), 'cow pair did not breed');
  no(!done('minecraft:husbandry/breed_an_animal'), 'granted without a loving player');
  [a, b] = pair('cow', player);
  no(!!Br.breed(a, b, { random: () => 0.5 }), 'player cow pair did not breed');
  no(done('minecraft:husbandry/breed_an_animal'), 'breed_an_animal not completed');
  const all = A.manager.get('minecraft:husbandry/bred_all_animals');
  const p = player.advancements.getProgress(all);
  no(p.criteria.get('minecraft:cow').date !== null, 'bred_all_animals cow criterion missing');
  no(p.criteria.get('minecraft:sheep').date === null, 'non-matching child (sheep) criterion completed by cows');
  no(!done('minecraft:husbandry/bred_all_animals'), 'bred_all_animals completed after one species');
  for (const c of all.criteria ? Object.keys(all.criteria) : []) {
    if (p.criteria.get(c).date === null) player.advancements.grantCriterion(all, c);
  }
  no(done('minecraft:husbandry/bred_all_animals'), 'bred_all_animals not completable');
  // matcher direct: parent/partner conditions
  const ctx = { parent: { type: 'minecraft:cow' }, partner: { type: 'minecraft:cow' }, child: { type: 'minecraft:cow' } };
  const m = A.matchers['minecraft:bred_animals'];
  no(m && m({}, ctx) === true, 'empty conditions should match');
  no(m && m({ child: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:pig' } }] }, ctx) === false, 'wrong child type matched');
  no(m && m({ child: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:pig' } }] }, { parent: ctx.parent, partner: ctx.partner }) === false, 'condition with no child matched');
  return f;
}

const fails = run();
const breaks = [
  ['matcher removed', (f, s) => f === '02l_advancements.js' ? s.replace("Adv.matchers['minecraft:bred_animals'] = function", "var unused = function") : s],
  ['child ignored', (f, s) => f === '02l_advancements.js' ? s.replace("if (has(c.child) &&", "if (false &&") : s],
  ['call site removed', (f, s) => f === '07m_breed.js' ? s.replace("NS.Adv.trigger(lover,", "(function(){})(lover,") : s],
  ['no loving player gate', (f, s) => f === '07m_breed.js' ? s.replace("if (lover && NS.Adv && NS.Adv.trigger)", "if (NS.Adv && NS.Adv.trigger)") : s],
];
let caught = 0;
for (const [name, patch] of breaks) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('break NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-bred_animalscheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log('assertions passed ..... 12');
console.log(`${caught} breaks caught (advtrig-bred_animalscheck OK)`);
