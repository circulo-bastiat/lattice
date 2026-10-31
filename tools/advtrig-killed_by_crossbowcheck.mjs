#!/usr/bin/env node
// advtrig-killed_by_crossbowcheck.mjs — #7743 G17-AT3. minecraft:killed_by_crossbow: the matcher
// (KilledByCrossbowCriterion.Conditions.matches) and the vanilla call site (PersistentProjectileEntity.onEntityHit
// :369-378), driven through the real Cb.arrowStrikeEntity. Breaks its own matcher and call site to prove it can fail.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
console.log('advtrig-killed_by_crossbowcheck — killed_by_crossbow matcher + onEntityHit call site');

function run(patch) {
  const f = [];
  let asserted = 0;
  const no = (c, m) => { asserted++; if (!c) f.push(m); };
  const M = loadEngine({
    extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
            '14i_hand.js', '02l_advancements.js', '14j_combat.js', '14d_survival.js', '14l_use.js', '07b_behaviour.js', '09c_weather.js'],
    patch,
  });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.Adv.init({ advancements: b64('advancements.bin'), advancementsBytes: rdj('advancements.meta.json').rawBytes });
  M.Entities.init(); M.EntityList.init(); M.Combat.init();
  const EL = M.EntityList, Cb = M.Combat, W = M.World, CH = M.CH;
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  M.Behave.init({ getBlock: (x, y, z) => W.getBlock(x, y, z), setBlock: (x, y, z, s) => W.setBlock(x, y, z, s), getLight: () => 15 << 4 });

  const P = M.Player = { x: -20, y: 64, z: 0, health: 20 };
  const done = [];
  const fresh = () => { P.advancements = new M.Adv.Tracker({ onGrant: (a) => done.push(a.id) }); done.length = 0; };
  const isDone = (id) => P.advancements.getProgress(M.Adv.manager.get('minecraft:adventure/' + id)).isDone();
  // victims in a row along +x at z 0; one arrow flies through each in turn
  const victim = (type, i) => { EL.clear; const e = EL.spawn(type, 2 + i * 3, 64, 0); e.maxHealth = e.health = 1; return e; };
  const shoot = (xbow, pierce) => {
    const a = EL.spawn('arrow', -5, 64.5, 0, { vx: 3, vy: 0, vz: 0, shooter: P });
    a.shotFromCrossbow = xbow; a.pierceLevel = pierce; return a;
  };
  const strike = (a, v) => { a.removed = false; Cb.arrowStrikeEntity(a, v.x - 1, v.y + 0.5, v.z, 2, 0, 0); };

  // pillager killed by a (non-piercing) crossbow arrow
  fresh(); EL.clear();
  let v = victim('pillager', 0), a = shoot(true, 0); strike(a, v);
  no(v.health <= 0 || v.dead, 'setup: the pillager did not die');
  no(isDone('whos_the_pillager_now'), 'crossbow kill of a pillager did not complete whos_the_pillager_now');
  no(!isDone('arbalistic') && !isDone('two_birds_one_arrow'), 'one kill completed arbalistic/two_birds');
  // same kill with a bow arrow, and with the wrong victim: must not complete
  fresh(); EL.clear(); v = victim('pillager', 0); a = shoot(false, 0); strike(a, v);
  no(!isDone('whos_the_pillager_now'), 'a bow (non-crossbow) kill completed the crossbow advancement');
  fresh(); EL.clear(); v = victim('cow', 0); a = shoot(true, 0); strike(a, v);
  no(!isDone('whos_the_pillager_now'), 'a crossbow kill of a cow completed whos_the_pillager_now');
  // piercing: two phantoms with one arrow
  fresh(); EL.clear(); a = shoot(true, 1);
  strike(a, victim('phantom', 0)); no(!isDone('two_birds_one_arrow'), 'one phantom completed two_birds_one_arrow');
  strike(a, victim('phantom', 1)); no(isDone('two_birds_one_arrow'), 'two phantoms on one piercing arrow did not complete two_birds_one_arrow');
  // phantom + cow must not
  fresh(); EL.clear(); a = shoot(true, 1);
  strike(a, victim('phantom', 0)); strike(a, victim('cow', 1));
  no(!isDone('two_birds_one_arrow'), 'phantom + cow completed two_birds_one_arrow');
  // arbalistic: five distinct types; four types do not
  fresh(); EL.clear(); a = shoot(true, 5);
  ['pillager', 'phantom', 'cow', 'pig', 'pig'].forEach((t, i) => strike(a, victim(t, i)));
  no(!isDone('arbalistic'), 'five victims of only four types completed arbalistic');
  fresh(); EL.clear(); a = shoot(true, 4);
  ['pillager', 'phantom', 'cow', 'pig'].forEach((t, i) => strike(a, victim(t, i)));
  no(!isDone('arbalistic'), 'four entity types completed arbalistic');
  strike(a, victim('sheep', 4));
  no(isDone('arbalistic'), 'five entity types on one piercing arrow did not complete arbalistic');
  return { f, asserted };
}

const base = run();
const fails = base.f.slice();
const mut = (file, a, b) => (name, src) => { if (name !== file) return src; if (!src.includes(a)) throw new Error('anchor gone: ' + a); return src.replace(a, b); };
const mutants = [
  ['matcher accepts anything', mut('02l_advancements.js', "return P.range(cond.unique_entity_types, n);", 'return true;')],
  ['victims not distinct', mut('02l_advancements.js', 'left.splice(hit, 1);', '')],
  ['no unique-type count', mut('02l_advancements.js', "if (!types[v.type]) { types[v.type] = 1; n++; }", 'n++;')],
  ['call site gone', mut('14j_combat.js', "if (e.shotFromCrossbow && e.shooter &&", 'if (false && e.shooter &&')],
  ['crossbow flag ignored', mut('14j_combat.js', "if (e.shotFromCrossbow && e.shooter &&", 'if (e.shooter &&')],
  ['pierced kills not collected', mut('14j_combat.js', "if (e.pierceLevel > 0 && (t.dead || t.health <= 0)) (e.piercingKilled", 'if (false) (e.piercingKilled')],
];
let caught = 0;
for (const [name, patch] of mutants) {
  let bad; try { bad = run(patch).f; } catch (e) { bad = [e.message]; }
  if (bad.length) { caught++; console.log('   ✓ broken (' + name + ') → ' + bad[0]); } else fails.push('mutant NOT caught: ' + name);
}
if (fails.length) { console.log('advtrig-killed_by_crossbowcheck: FAIL'); fails.forEach((m) => console.log('   x ' + m)); process.exit(1); }
console.log(`assertions passed ..... ${base.asserted}`);
console.log(`advtrig-killed_by_crossbowcheck: OK — ${caught} breaks caught`);
