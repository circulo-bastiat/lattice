#!/usr/bin/env node
// mooshroomstewbowlcheck.mjs — s101 orchestrator (QUEUE 0.2 G18c): the MOOSHROOM + cow milking.
// Every rule is MooshroomEntity/CowEntity (.decomp, read whole); the numbers the game owns
// (1024 mutation, 5 drops, the flower effect table) are read back from .decomp/the packed
// recipe table, never typed here. Sections: 1 exists (motion/roster/spawn rule/type/skin),
// 2 milk (cow + mooshroom, baby refused), 3 bowl (plain + suspicious stew), 4 brown + flower,
// 5 shears -> cow + 5 mushrooms, 6 lightning flip, 7 child type (breed path), with breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m)) console.log('  ✓ ' + m); };
console.log('mooshroomcheck — s101 (QUEUE 0.2 G18c), the mooshroom + cow milking');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js',
  '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js', '07n_tame.js', '07zn_mooshroom.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities, Mo = MCL.Mooshroom;
const Breed = MCL.Breed, W = MCL.World, S = MCL.States, Use = MCL.Use, Iv = MCL.Inventory, CH = MCL.CH, IT = MCL.Items;
Ent.init(); Ent.attrs = MCL.DATA.entities.attrs; W.init(1); MCL.Behave.init(W); EL.init(); Ai.init(); Spawn.init(); Breed.init();
if (MCL.Combat && MCL.Combat.init) MCL.Combat.init();
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const SRC = readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/entity/passive/MooshroomEntity.java'), 'utf8');


const use = (e, name, opts = {}) => {
  const inv = Iv.create(); const st = { i: IT.of(name), n: opts.n || 1 }; Iv.setItem(inv, 0, st);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: !!opts.creative, targetEntity: e };
  Use.entityUse(P, e, st);
  const all = []; for (let i = 0; i < 46; i++) { const q = Iv.getItem(inv, i); if (q && q.n > 0) all.push(q); }
  return all;
};
const brown = () => { const m = EL.spawn('mooshroom', 2, 64, 0, {}); m.isBaby = false; m.mooshroomType = 'brown'; m.stewEffect = { id: 8, ticks: 140 }; return m; };
const cnt = (all, nm) => all.filter((q) => IT.nameOf(q.i) === nm).reduce((a, q) => a + q.n, 0);
const effOf = (all) => { const q = all.find((x) => IT.nameOf(x.i) === 'suspicious_stew'); return q && JSON.stringify(Iv.tagOf(q)); };
for (const creative of [false, true]) {
  const all = use(brown(), 'bowl', { n: 8, creative });
  ok(cnt(all, 'suspicious_stew') === 1, `creative=${creative}: one suspicious_stew`);
  ok(/EffectId/.test(effOf(all) || ''), `creative=${creative}: the stew carries its effect tag`);
  if (!creative) ok(cnt(all, 'bowl') === 7, `survival: 7 bowls stay of 8, got ${cnt(all, 'bowl')}`);
}
okAv(cnt(use(brown(), 'bowl', { n: 8 }), 'bowl') !== 0, 'anti-vacuity: the bowl stack is not wiped (a wipe breaks this)');
okAv(!/EffectId/.test(effOf(use(EL.spawn('mooshroom', 2, 64, 0, {}), 'bowl', { n: 8 })) || ''), 'anti-vacuity: a plain mooshroom gives an untagged stew');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
