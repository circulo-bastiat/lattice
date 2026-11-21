#!/usr/bin/env node
// advtrig-thrown_item_picked_up_by_entitycheck.mjs — G17-AT19 (#7981). Drives the REAL call site (Cb.hurt's killing blow ->
// Adv.trigger 'minecraft:channeled_lightning') against OnKilledCriterion; breaks its own matcher and call site.
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
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zzm_wither.js', '07zzc_lightning.js', '07zzf_piglin.js'];
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
  if (MCL.Tags && MCL.Tags.init && !MCL.Tags.ready) MCL.Tags.init();
  const Adv = MCL.Adv;
  Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  const done = [];
  const P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player' };
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const has = (id) => done.includes('minecraft:' + id);
  P.uuid = 'pl-uuid-1';
  const pig = (baby) => MCL.EntityList.spawn('piglin', 0.5, 70, 0.5, baby ? { baby: true } : {});
  const drop = (thrower) => MCL.EntityList.spawn('item', 0.5, 70, 0.5, { item: MCL.Items.of('gold_ingot'), count: 1, pickupDelay: 0, mobNbtRestore: true, thrower });
  const pick = (p) => { MCL.Piglin.lootTick(p); };
  // not thrown by the player: no completion
  let p = pig(false); no(!!p, 'piglin did not spawn');
  pick(p, drop(undefined));
  no(!has('nether/distract_piglin'), 'completed for an item nobody threw');
  // thrown by the player but picked up by a baby piglin: entity predicate is_baby:false fails
  p = pig(true); p.isBaby = true;
  pick(p, drop(P.uuid));
  no(!has('nether/distract_piglin'), 'completed for a baby piglin');
  p = pig(false);
  pick(p, drop(P.uuid));
  no(has('nether/distract_piglin'), 'distract_piglin not completed');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('07zzf_piglin.js', "NS.Equip.triggerPickedUp(e, o);", "")],
  ['thrower ignored', brk('07y_equip.js', "itemEntity && itemEntity.thrower && EL && EL.byUuid ? EL.byUuid(itemEntity.thrower) : null", "NS.Player")],
  ['entity ignored', brk('02l_advancements.js', "P.item(c.item, lc, ctx.stack) && P.extended(c.entity, lc, { 'this': ctx.entity });\n  };\n  // BeeNest", "P.item(c.item, lc, ctx.stack);\n  };\n  // BeeNest")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:thrown_item_picked_up_by_entity'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-thrown_item_picked_up_by_entitycheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-thrown_item_picked_up_by_entitycheck: OK — ${caught} breaks caught`);
