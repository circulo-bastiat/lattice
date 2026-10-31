#!/usr/bin/env node
// advtrig-slide_down_blockcheck.mjs — G17-AT9 (#7756). Drives the REAL call site (Use.entityCollide on a honey block ->
// Adv.trigger 'minecraft:slide_down_block') against SlideDownBlockCriterion; breaks its own matcher and call site.
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
  MCL.Use.init(MCL.World);
  const honey = MCL.Reg.names.indexOf('honey_block');
  const hs = MCL.Reg.realFirst[honey] + MCL.Reg.defaultState[honey];
  MCL.World.setBlock(5, 70, 5, hs);
  const slide = (gt) => {
    MCL.Behave.gameTime = gt;
    Object.assign(P, { x: 5.5 - 0.76, y: 70.5, z: 5.5, vx: 0, vy: -0.3, vz: 0, onGround: false, width: 0.6, height: 1.8 });
    MCL.Use.entityCollide(P);
  };
  slide(7);
  no(!has('adventure/honey_block_slide'), 'granted off the 20-tick gate');
  slide(20); // (re-armed below) ground contact never slides
  done.length = 0; P.advancements = new Adv.Tracker({ addExperience() {}, onGrant: (a) => done.push(a.id) });
  P.onGround = true; MCL.Use.entityCollide(P);
  no(!has('adventure/honey_block_slide'), 'granted while on the ground');
  slide(20);
  no(has('adventure/honey_block_slide'), 'honey_block_slide not completed');
  // a non-matching block does not complete it
  const adv = Adv.manager.get('minecraft:adventure/honey_block_slide');
  const p2 = new Adv.Tracker({ addExperience() {}, onGrant: () => {} });
  Adv.trigger({ advancements: p2 }, 'minecraft:slide_down_block', { player: P, state: { id: 'minecraft:stone', state: {} } });
  no(!p2.getProgress(adv).isDone(), 'stone completed honey_block_slide');
  Adv.trigger({ advancements: p2 }, 'minecraft:slide_down_block', { player: P, state: { id: 'minecraft:honey_block', state: {} } });
  no(p2.getProgress(adv).isDone(), 'honey state did not complete');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14l_use.js', "'minecraft:slide_down_block', {", "'minecraft:slide_down_block_x', {")],
  ['block ignored', brk('02l_advancements.js', "stripNs(c.block) !== stripNs(b.id)", 'false')],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:slide_down_block'] = function", "Adv.matchers['minecraft:x'] = function")],
  ['gate dropped to never', brk('14l_use.js', "NS.Adv.trigger && ((B && B.gameTime) | 0) % 20 === 0", 'false')],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-slide_down_blockcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-slide_down_blockcheck: OK — ${caught} breaks caught`);
