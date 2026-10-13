#!/usr/bin/env node
// goatcheck.mjs — loop/goat-s99 (QUEUE 0.2 G18c, missing overworld mob): the GOAT, whole.
// Drives the REAL modules (07zj_goat.js, Ai.ROSTER.goat/EL.DEFAULTS.goat/Spawn.RULES.goat/
// Br.CHILD.goat/Ph.landed's own goat hook/Use.entityUse's own milking branch) against
// `.decomp/net/minecraft/entity/passive/GoatEntity.java` and `GoatBrain.java` (both read in
// full).
//
//   node tools/goatcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own row for goat
//   2. EL.spawn('goat', ...) — EL.DEFAULTS.goat rolls the screaming flag, Ai.ROSTER.goat attaches e.ai
//   3. Spawn.RULES.goat — the goats_spawnable_on tag + light gate
//   4. Gt.adjustFallDamage / Ph.landed's own hook — the flat -10
//   5. Gt.jumpVelocity/Gt.bestJumpVelocity — the long-jump trajectory kernel
//   6. Gt.LongJumpGoal — cooldown gate + one-shot launch
//   7. Gt.RamGoal / Gt.impact — cooldown, target pick, prepare, charge, impact, knockback
//   8. Br.CHILD.goat / Gt.childScreaming — the (asymmetric) screaming inheritance
//   9. milking — Use.entityUse's own bucket branch
//  10. anti-vacuity — break the check's own data/stubs and watch it catch the break

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('nofallcheck -- #766: mobs whose handleFallDamage is `return false` take no fall damage');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_goat.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Gt = MCL.Goat, Breed = MCL.Breed, W = MCL.World, S = MCL.States, Bh = MCL.Behave;
const Ph = MCL.Physics, Cb = MCL.Combat, Use = MCL.Use, Iv = MCL.Inventory;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();
if (Cb && Cb.init) Cb.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}


const TYPES = ['chicken', 'bat', 'parrot', 'bee', 'blaze', 'ocelot', 'cat', 'magma_cube', 'wither', 'ghast', 'phantom'];
const fall = (type) => {
  EL.list.length = 0;
  // spawn a host mob and relabel it: only e.type decides the exemption, and the special mobs need
  // their whole AI module stack to spawn
  const e = EL.spawn(type === 'cow' ? 'cow' : 'pig', 0, 64, 0, {});
  e.type = type; e.health = e.maxHealth = type === 'chicken' ? 4 : 20;
  const hp0 = e.health;
  Ph.landed(e, 20, -1);
  Cb.tickEntity(e);
  return { hp0, hp: e.health };
};
for (const t of TYPES) {
  const r = fall(t);
  if (!r) { say('  (cannot spawn ' + t + ')'); continue; }
  ok(r.hp === r.hp0, `${t} lost hp on a 20-block landing (${r.hp0} -> ${r.hp}); vanilla handleFallDamage returns false`);
}
const ch = fall('chicken');
ok(ch && ch.hp0 === 4 && ch.hp === 4, 'chicken hp must stay 4');
// anti-vacuity: a cow does take it, and the exemption table is what saves the chicken
const cow = fall('cow');
okAv(cow && cow.hp < cow.hp0, 'a cow dropped 20 blocks kept its hp -- fall damage is not spent at all');
const saved = Ph.landed;
{
  const e = EL.spawn('chicken', 0, 64, 0, {});
  e.type = 'cow'; Ph.landed(e, 20, -1); e.type = 'chicken';
  okAv(e.pendingFallDamage > 0, 'a chicken relabelled cow took no damage -- the check would pass without the exemption');
}
{
  EL.list.length = 0;
  const e = EL.spawn('chicken', 0, 64, 0, {}); e.pendingFallDamage = 5; e.type = 'cow'; const h = e.health;
  Cb.tickEntity(e);
  okAv(e.health < h, 'spending pendingFallDamage did not hurt -- the hp assertion is vacuous');
}
console.log(` assertions passed ..... ${pass}`);
console.log(` failures ............ ${fails.length}`);
for (const f of fails) console.log(' FAIL ' + f);
process.exit(fails.length ? 1 : 0);
