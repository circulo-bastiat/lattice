#!/usr/bin/env node
// bucketdatacheck.mjs — #3185: Bucketable.copyDataToStack/FromNbt round-trip health, name, flags.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets'), rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js', '07e_loot.js', '07h_entities.js',
  '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js', '07m_breed.js', '07zh_rabbit.js',
  '07zj_fox.js', '07zj_goat.js', '07zl_panda.js', '07q_effects.js', '07zm_axolotl.js', '07zj_fish.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const { EntityList: EL, Use, Items } = MCL;
MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
MCL.World.init(1); MCL.Behave.init(MCL.World); EL.init(); MCL.Ai.init(); MCL.Spawn.init(); MCL.Breed.init(); if (MCL.Combat.init) MCL.Combat.init(); if (MCL.Effects.init) MCL.Effects.init();
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const TYPES = ['cod', 'salmon', 'pufferfish', 'tropical_fish', 'axolotl'];
const { Inventory: Iv, States: S, World: W, CH } = MCL;
if (MCL.Use.init) MCL.Use.init(W);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
W.setBlock(2, 63, 0, S.stateOf('grass_block') | 0); W.setBlock(2, 64, 0, 0); W.setBlock(2, 65, 0, 0);
function roundTrip(type, skipData) {
  W.setBlock(2, 64, 0, 0);
  const e = EL.spawn(type, 1, 64, 0, {});
  e.health = 1; if (process.env.NF) {} else e.customName = 'Bob'; e.silent = true; e.noGravity = true; if (!process.env.NI) e.invulnerable = true;
  const inv = Iv.create(), st = { i: Items.of('water_bucket'), n: 1 };
  Iv.setItem(inv, 0, st);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false, ex: 2.5, ey: 64.5, ez: 0.5, eyeHeight: 0.5, lookVec: () => [0, -1, 0] };
  const rv = Use.entityUse(P, e, st); if (process.env.DBG) console.log(rv, e.health, e.removed, Items.nameOf(st.i));
  const b = Iv.getItem(inv, 0); if (process.env.DBG) console.log(type, JSON.stringify(b), e.removed);
  if (skipData && b) delete b.bucketData;
  const ru = Use.bucketUse(P, b); if (process.env.DBG) console.log('release', ru, b && Items.nameOf(b.i), W.getBlock(2,63,0), JSON.stringify(Object.keys(P).join()));
  return { b, rel: EL.list.filter(x => !x.removed && x.fromBucket).pop() };
}
for (const t of TYPES) {
  const { b, rel } = roundTrip(t);
  ok(b && b.bucketData && b.bucketData.Health === 1, `${t}: bucket carries Health`);
  ok(rel.type === t && rel.health === 1 && rel.customName === 'Bob' && rel.silent && rel.noGravity && rel.invulnerable, `${t}: release restores health/name/flags`);
  const br = roundTrip(t, true).rel; if (process.env.DBG) console.log(t, br.health, br.customName, br.removed, EL.list.length);
  breaks++; ok(br.health !== 1 || br.customName !== 'Bob', `${t}: anti-vacuity: dropping bucketData must lose the data`);
}
for (const f of fails) console.log('  FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
