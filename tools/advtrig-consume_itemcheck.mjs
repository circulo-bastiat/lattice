#!/usr/bin/env node
// advtrig-consume_itemcheck.mjs — G17-AT6 (#7746). Drives the REAL call site (Cb.hurt's killing blow ->
// Adv.trigger 'minecraft:consume_item') against OnKilledCriterion; breaks its own matcher and call site.
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
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zzm_wither.js', '07zzc_lightning.js'];
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
  const Iv = MCL.Inventory;
  P.inventory = Iv.create ? Iv.create() : Iv.newInventory(); P.slot = 0;
  const eat = (nm) => { Iv.setItem(P.inventory, 0, Iv.stack(nm, 1, 0)); P.food = 5; MCL.Use.drinkFinish(P); };
  const crit = (id, c) => { const p = P.advancements.getProgress(Adv.manager.advancements.get ? Adv.manager.advancements.get('minecraft:' + id) : null); return p; };
  no(!has('husbandry/root'), 'root done before eating');
  eat('apple');
  no(has('husbandry/root'), 'husbandry/root not completed by eating');
  no(!has('husbandry/balanced_diet'), 'balanced_diet completed by one item');
  const seen = []; 
  Adv.manager.advancements.forEach((a) => { if (a.id === 'minecraft:husbandry/balanced_diet') seen.push(a); });
  const pr = P.advancements.getProgress(seen[0]);
  const un = Array.from(pr.getUnobtainedCriteria());
  no(!un.includes('apple'), 'apple criterion not obtained');
  no(un.includes('bread'), 'bread criterion obtained by eating an apple');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14l_use.js', "'minecraft:consume_item', {", "'minecraft:consume_item_x', {")],
  ['item ignored', brk('02l_advancements.js', "P.item(cond.item, ctx, ctx && ctx.stack); };\n  Adv.matchers['minecraft:shot", "true; };\n  Adv.matchers['minecraft:shot")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:consume_item'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-consume_itemcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-consume_itemcheck: OK — ${caught} breaks caught`);
