#!/usr/bin/env node
// advtrig-tickcheck.mjs — G17-AT41 (#8044). Drives the REAL call site (Player.tick -> Adv.trigger 'minecraft:tick') against TickCriterion; breaks its own matcher and call site.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14_player.js', '14c_raycast.js', '07i_entitylist.js',
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
  const P = MCL.Player; Object.assign(P, { x: 0.5, y: 70, z: 0.5 });
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  const users = [...Adv.manager.advancements.values()].filter((a) => Object.values(a.criteria).some((c) => c.trigger === 'minecraft:tick'));
  // the packed 1.18.2 data has NO advancement on minecraft:tick (roots use inventory_changed etc.), so drive synthetic ones
  no(users.length === 0, 'packed data now uses minecraft:tick: ' + users.map((a) => a.id).join(','));
  const mk = (id, cond) => { const a = Adv.manager.get(id), k = Object.keys(a.criteria)[0]; a.criteria[k] = { trigger: 'minecraft:tick', conditions: cond }; return a; };
  const okA = mk('minecraft:story/root', {});
  const badA = mk('minecraft:nether/root', { player: [{ condition: 'minecraft:entity_properties', entity: 'this', predicate: { type: 'minecraft:zombie' } }] });
  P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  MCL.Input = { locked: false, uiOpen: true, down: () => false };
  try { P.tick(); } catch (e) { no(false, 'Player.tick threw ' + e.message); }
  no(done.includes('minecraft:story/root'), 'Player.tick did not complete a tick-trigger advancement');
  no(!done.includes('minecraft:nether/root'), 'non-matching player predicate completed the advancement');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14_player.js', "'minecraft:tick', { player: P }", "'minecraft:tick_x', { player: P }")],
  ['player predicate ignored', brk('02l_advancements.js', "Adv.matchers['minecraft:tick'] = function (c, ctx) {\n    var pl = ctx && ctx.player;\n    return P.extended(c.player, { origin: pl ? [pl.x, pl.y, pl.z] : null, player: pl }, { 'this': pl });", "Adv.matchers['minecraft:tick'] = function (c, ctx) {\n    return true;")],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:tick'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-tickcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-tickcheck: OK — ${caught} breaks caught`);
