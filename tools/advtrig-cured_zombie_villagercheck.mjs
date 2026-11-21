#!/usr/bin/env node
// advtrig-cured_zombie_villagercheck.mjs — G17-AT22 (#7984). Drives the REAL call site (Zv.finishConversion ->
// Adv.trigger 'minecraft:cured_zombie_villager'); only advancement using it: minecraft:story/cure_zombie_villager.
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
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zr_zvillager.js'];
const fails = []; let asserted = 0;

function run(patch) {
  const f = [], no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1); MCL.Behave.init(MCL.World);
  if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
  MCL.EntityList.init(); MCL.Ai.init(); if (MCL.Spawn && MCL.Spawn.init) MCL.Spawn.init();
  for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
    const c = MCL.World.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(cx, cz), c);
  }
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player', uuid: 'p-1' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  MCL.ZVillager.curers['p-1'] = P;
  const adv = Adv.manager.advancements.get ? Adv.manager.advancements.get('minecraft:story/cure_zombie_villager') : null;
  const crit = adv.criteria.cured_zombie;
  const cure = () => {
    const z = MCL.EntityList.spawn('zombie_villager', 0.5, 70, 0.5);
    z.converterId = 'p-1';
    return MCL.ZVillager.finishConversion(z);
  };
  const has = () => done.includes('minecraft:story/cure_zombie_villager');
  // a condition the villager cannot meet must not complete it
  crit.conditions = { villager: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:zombie' } }] };
  cure();
  no(!has(), 'completed although the villager predicate wants a zombie');
  crit.conditions = { zombie: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:zombie_villager' } }],
    villager: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:villager' } }] };
  cure();
  no(has(), 'not completed with matching zombie + villager predicates');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07zr_zvillager.js', "'minecraft:cured_zombie_villager', {", "'minecraft:cured_zombie_villager_x', {")],
  ['villager ignored', brk('02l_advancements.js', "P.extended(c.villager, lc, { 'this': ctx.villager })", "true")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:cured_zombie_villager'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-cured_zombie_villagercheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-cured_zombie_villagercheck: OK — ${caught} breaks caught`);
