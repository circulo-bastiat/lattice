#!/usr/bin/env node
// advtrig-player_killed_entitycheck.mjs — G17-AT1 (#7741). Drives the REAL call site (Cb.hurt's killing blow ->
// Adv.trigger 'minecraft:player_killed_entity') against OnKilledCriterion; breaks its own matcher and call site.
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
  const kill = (type, x, src, byPlayer) => {
    const e = MCL.EntityList.spawn(type, x, 70, 0.5);
    if (!e) return null;
    MCL.Combat.hurt(e, 1000, 0, byPlayer, src);
    return e;
  };
  const has = (id) => done.includes('minecraft:' + id);
  // a non-player kill (fall damage, no attacker) must not complete anything
  const z0 = kill('zombie', 3.5, { source: 'fall' }, false);
  no(z0 && z0.dead, 'zombie did not die');
  no(P.advancements.getProgress(Adv.manager.get('minecraft:adventure/kill_a_mob')).criteria.get('minecraft:zombie').date === null && !has('adventure/kill_a_mob'), 'non-player kill granted a criterion');
  kill('zombie', 3.5, { source: 'player', attacker: P }, true);
  no(P.advancements.getProgress(Adv.manager.get('minecraft:adventure/kill_a_mob')).criteria.get('minecraft:zombie').date !== null, 'zombie kill not recorded');
  no(has('adventure/kill_a_mob'), 'kill_a_mob (any one mob) not completed');
  no(!has('adventure/kill_all_mobs'), 'kill_all_mobs completed after one mob');
  // sniper_duel: a skeleton shot from < 50 blocks does NOT count; from 60 with a projectile does
  const sn = Adv.manager.get('minecraft:adventure/sniper_duel');
  kill('skeleton', 20.5, { source: 'projectile', projectile: true, attacker: P }, true);
  no(!has('adventure/sniper_duel'), 'sniper_duel granted at 20 blocks');
  kill('skeleton', 60.5, { source: 'player', attacker: P }, true);
  no(!has('adventure/sniper_duel'), 'sniper_duel granted for a non-projectile blow');
  kill('skeleton', 60.5, { source: 'projectile', projectile: true, attacker: P }, true);
  no(has('adventure/sniper_duel'), 'sniper_duel not completed');
  // every mob in the lists
  for (const adv of ['adventure/kill_a_mob', 'adventure/kill_all_mobs']) {
    const a = Adv.manager.get('minecraft:' + adv);
    for (const k in a.criteria) {
      if (P.advancements.getProgress(a).criteria.get(k).date !== null) continue;
      Adv.trigger(P, 'minecraft:player_killed_entity', { player: P, entity: { type: k.replace('minecraft:', ''), x: 1, y: 70, z: 1 }, damage: { attacker: P } });
    }
  }
  no(has('adventure/kill_a_mob'), 'kill_a_mob not completed');
  no(has('adventure/kill_all_mobs'), 'kill_all_mobs not completed');
  return f;
}
const base = run();
base.forEach((m) => fails.push(m));
const cb = readFileSync(join(ROOT, 'src/14j_combat.js'), 'utf8'), ad = readFileSync(join(ROOT, 'src/02l_advancements.js'), 'utf8');
const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
const mutants = [
  ['call site gone', brk('14j_combat.js', "'minecraft:player_killed_entity', {", "'minecraft:player_killed_entity_x', {")],
  ['entity condition ignored', brk('02l_advancements.js', 'P.extended(c.entity, lc, subj)', 'true')],
  ['killing_blow ignored', brk('02l_advancements.js', 'P.damage(c.killing_blow, lc, ctx.damage)', 'true')],
  ['no matcher', brk('02l_advancements.js', "Adv.matchers['minecraft:player_killed_entity'] = function", "Adv.matchers['minecraft:x'] = function")],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-player_killed_entitycheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${asserted}`);
console.log(`advtrig-player_killed_entitycheck: OK — ${caught} breaks caught`);
