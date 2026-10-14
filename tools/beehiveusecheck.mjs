#!/usr/bin/env node
// beehiveusecheck.mjs — #3021: BeehiveBlock.onUse / afterBreak / angerNearbyBees (.decomp BeehiveBlock.java,
// BeehiveBlockEntity.angerBees). Drives the real Use.blockUse and Bee.* against the real registry.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('beehiveusecheck — #3021 BeehiveBlock.onUse / afterBreak');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
               '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js',
               '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
               '07t_fly.js', '07q_effects.js', '09b_sky.js', '07zo_bee.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const { Bee, States: S, BlockEntities: BE, World: W, EntityList: EL, Inventory: Iv, Behave: B, Use } = MCL;
MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
BE.init(); W.init(1); B.init(W); EL.init(); if (MCL.Ai && MCL.Ai.init) MCL.Ai.init();
if (Use.init) Use.init(W);

const nest = (lvl) => B.setProp(S.stateOf('bee_nest'), 'honey_level', String(lvl));
const level = (x, y, z) => B.propName(W.getBlock(x, y, z), 'honey_level');
const bees = () => EL.list.filter((e) => e.type === 'bee' && !e.removed);
const mkP = (held, extra) => {
  const P = Object.assign({ x: 11.5, y: 64, z: 10.5, slot: 0, instabuild: false, yaw: 0, mayBuild: true,
                            inventory: Iv.create ? Iv.create() : null }, extra || {});
  Iv.setItem(P.inventory, 0, held);
  return P;
};
for (let cx = -1; cx < 40; cx++) { const ch = W.makeChunk(cx, 0); ch.state = MCL.CH.GENERATED; W.chunks.set(W.key(cx, 0), ch); }
let n = 0;
function setup(lvl, nbees) {
  const x = 10 + 16 * (++n), y = 64, z = 10;
  W.setBlock(x, y, z, nest(lvl));
  const be = BE.create(x, y, z, 'beehive'); be.honeyLevel = lvl;
  for (let i = 0; i < nbees; i++) be.bees.push({ id: null, hasNectar: false, ticksLeft: 600 });
  return { x, y, z, be };
}
const clear = () => { for (const e of bees()) e.removed = true; };
const use = (P, c) => Use.blockUse(P, c.x, c.y, c.z, W.getBlock(c.x, c.y, c.z), Iv.getItem(P.inventory, 0));
const near = (c) => ({ x: c.x + 0.5, z: c.z + 0.5 });

// 1. shears at level 5: honeycomb dropped, shears damaged, level 0, bees angry at the player
let c = setup(5, 2), P = mkP(Iv.stack('shears', 1, 0), near(c)); const drops0 = EL.list.length;
ok(use(P, c) === true, 'shears on a full hive must be consumed');
ok(level(c.x, c.y, c.z) === '0', 'honey_level must reset to 0, got ' + level(c.x, c.y, c.z));
ok(Iv.getItem(P.inventory, 0).d === 1, 'shears must take 1 damage');
ok(EL.list.slice(drops0).some((e) => e.type === 'item' && e.count === 3 && MCL.Items.nameOf(typeof e.item === 'number' ? e.item : MCL.Items.of(e.item)) === 'honeycomb'), '3 honeycomb must drop');
ok(bees().length === 2 && bees().every((e) => e.target === P && e.angerTime > 0), 'both occupants must come out angry at the player');
ok(c.be.bees.length === 0, 'hive must be emptied');
clear();

// 2. glass bottle: stack of 2 -> one honey_bottle goes to the inventory, one bottle stays
c = setup(5, 0); P = mkP(Iv.stack('glass_bottle', 2, 0), near(c));
ok(use(P, c) === true, 'bottle on a full hive must be consumed');
ok(Iv.getItem(P.inventory, 0).n === 1 && MCL.Items.nameOf(Iv.getItem(P.inventory, 0).i) === 'glass_bottle', 'bottle stack must shrink by 1');
ok(level(c.x, c.y, c.z) === '0', 'bottle must reset honey_level');
let hb = 0; for (let i = 0; i < 36; i++) { const s = Iv.getItem(P.inventory, i); if (s && !Iv.isEmpty(s) && MCL.Items.nameOf(s.i) === 'honey_bottle') hb += s.n; }
ok(hb === 1, 'one honey_bottle must be handed over, got ' + hb);

// 3. level 4: nothing happens (falls through)
c = setup(4, 1); P = mkP(Iv.stack('shears', 1, 0), near(c));
use(P, c);
ok(level(c.x, c.y, c.z) === '4' && c.be.bees.length === 1, 'honey_level 4 must be untouched');

// 4. lit campfire under the hive: honey taken, bees stay calm (still inside)
c = setup(5, 2); W.setBlock(c.x, c.y - 2, c.z, B.setProp(S.stateOf('campfire'), 'lit', 'true'));
P = mkP(Iv.stack('shears', 1, 0), near(c)); use(P, c);
ok(level(c.x, c.y, c.z) === '0', 'smoked hive: honey still taken');
ok(bees().length === 0 && c.be.bees.length === 2, 'smoked hive: takeHoney only, the bees stay inside');
P = mkP(Iv.EMPTY, near(c)); Bee.onHiveBreak(c.x, c.y, c.z, P, c.be, false);
ok(bees().length === 2 && bees().every((e) => e.cannotEnterHiveTicks === 400), 'smoked break: released bees cannot re-enter for 400 (angerNearbyBees still targets them, as vanilla afterBreak)');
clear();

// 5. breaking a nest: bees angry; nearby loose bee takes the player; silk touch spares them
c = setup(0, 2); P = mkP(Iv.EMPTY, near(c));
const loose = EL.spawn('bee', c.x + 3, c.y, c.z);
Bee.onHiveBreak(c.x, c.y, c.z, P, c.be, false);
ok(bees().length === 3 && bees().every((e) => e.target === P), 'break: 2 occupants + 1 nearby bee all target the player');
ok(loose.angerTime > 0, 'nearby bee must be angry');
clear();
c = setup(0, 2); P = mkP(Iv.EMPTY, near(c));
Bee.onHiveBreak(c.x, c.y, c.z, P, c.be, true);
ok(bees().length === 0 && c.be.bees.length === 2, 'silk touch: bees stay in the hive');

// anti-vacuity: break the code under test and prove the asserts notice
let caught = 0; const before = fails.length;
const caughtIt = (m) => { caught++; console.log('   ✓ broken: ' + m); };
const keep = Bee.angerBees; Bee.angerBees = () => [];
c = setup(5, 2); P = mkP(Iv.stack('shears', 1, 0), near(c)); use(P, c);
if (bees().length === 0) caughtIt('angerBees stubbed -> no angry bees'); clear(); Bee.angerBees = keep;
const keep2 = Bee.takeHoney; Bee.takeHoney = () => {};
c = setup(5, 0); P = mkP(Iv.stack('shears', 1, 0), near(c)); use(P, c);
if (level(c.x, c.y, c.z) === '5') caughtIt('takeHoney stubbed -> honey_level stays 5'); Bee.takeHoney = keep2;
ok(caught === 2, 'anti-vacuity: only ' + caught + '/2 breaks caught');

console.log('================ beehiveusecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${caught}`);
for (const m of fails) console.log(' - ' + m);
process.exit(fails.length ? 1 : 0);
