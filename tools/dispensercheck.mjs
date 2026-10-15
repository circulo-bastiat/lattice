#!/usr/bin/env node
// dispensercheck.mjs — PASS 17 JOB 1 (G19b), the DISPENSER and the DROPPER (D-420).
//
//   node tools/dispensercheck.mjs [--verbose]
//
// ⚠ THEY ARE THE SAME BLOCK WITH TWO ENDINGS, and this file is written to keep them apart. State,
// screen, 3x3, trigger and four-tick delay are shared; what differs is that a DROPPER puts its
// item INTO the container it faces and a DISPENSER never does — it throws, into a chest's face if
// there is one. A check that only asserted "the item left the block" would pass either one
// behaving as the other, so §4 and §5 are the same scene with the two blocks swapped.
//
// ⚠ THE TRIGGER IS A LATCH, NOT A LEVEL. `TRIGGERED` is what makes a dispenser fire ONCE on the
// rising edge; §2 holds the lever down for fifty ticks and asserts exactly one item left.
//
// ⚠⚠ AND THE `pos.above()` TERM IS JAVA EDITION'S QUASI-CONNECTIVITY. §3 powers the cell ABOVE a
// dispenser — not beside it — and asserts it fires anyway. Every BUD and every piston door in the
// game is built on that, and a clone that dropped it would look identical on a lever.
//
// Sections:
//   1. shape — 45 slots, the nine ARE `be.items`, and a close/reopen loses nothing
//   2. the trigger — one item on the rising edge, and no more while the lever is held
//   3. quasi-connectivity — power the cell ABOVE and it fires
//   4. a DROPPER puts its item into the container it faces
//   5. a DISPENSER never does — it throws, even at a chest
//   6. `getRandomSlot` is uniform over the non-empty slots, not "the first one"
//   7. the hopper's own `enabled` property is WRITTEN now, not only read (D-420)
//   8. anti-vacuity

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
               '14g_menu.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07y_equip.js', '07z_potion.js', '07zzy_firework.js', '07zzm_wither.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07y_equip.js', '07z_potion.js', '07zzy_firework.js',
               '13_input.js', '15b_gui.js', '15_hud.js', '14l_use.js', '07zzh_blaze.js', '07w_passive.js', '07zo_bee.js', '07n_tame.js', '07r_mount.js', '07ze_llama.js', '14_player.js', '07m_breed.js', '07zzj_strider.js', '07zze_oxidize.js', '07zx_particle.js', '07zzt_boat.js', '07zn_mooshroom.js', '07zq_snowgolem.js', '07d_mining.js', '07e_loot.js', '07zzt_armorstand.js', '07zzq_rail.js', '07zzr_minecart.js', '07zv_villagerbrain.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const REAL_PLAYER = MCL.Player;
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
MCL.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
MCL.BlockEntities.init();
MCL.Entities.init();
if (MCL.Equip) MCL.Equip.init();
if (MCL.Tame && MCL.Tame.init) MCL.Tame.init();
if (MCL.Mount) MCL.Mount.init();

const Inv = MCL.Inventory, M = MCL.Menu, H = MCL.Hud, BE = MCL.BlockEntities;
const W = MCL.World, B = MCL.Behave, Rs = MCL.Redstone, EL = MCL.EntityList, CH = MCL.CH, S = MCL.States;
const stk = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('dispensercheck — PASS 17 JOB 1 (G19b), the dispenser and the dropper (D-420)');

B.init(W);
Rs.init();
ok(Rs.ready, 'Redstone came up against the real World');
function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  BE.clear();
  EL.init();
  EL.pushPlayer = () => null;
}
function putP(x, y, z, name, props) {
  let st = S.stateOf(name) | 0;
  for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]);
  W.setBlock(x, y, z, st);
  return st;
}
function blockAt(x, y, z, name, props) {
  putP(x, y, z, name, props);
  return BE.get(x, y, z) || BE.create(x, y, z, name);
}
/** Run `n` game ticks of the scheduled queue AND the block-entity tick, the way `17_main` does. */
const run = (n) => { for (let i = 0; i < n; i++) { B.tick(); BE.tick(); } };
function newPlayer() {
  const P = { menu: { inventory: Inv.create() }, xpTotal: 0 };
  MCL.Player = P;
  return P;
}

// ═══════════ 1. shape, and the nine ARE be.items ═════════════════════════════════════════════
say('\n1. shape, and a close/reopen that loses nothing');
{
  freshWorld();
  const be = blockAt(0, 4, 0, 'dispenser', { facing: 'north' });
  const P = newPlayer();
  let m = M.dispenserMenu(be, P.menu.inventory);
  ok(m.slots.length === 45, `a dispenser menu has 45 slots, got ${m.slots.length}`);
  ok(M.DISPENSER_SIZE === 9, `its own container is 9 slots, got ${M.DISPENSER_SIZE}`);
  be.items[4] = stk('arrow', 12);
  ok(nameOf(M.slotGet(m.slots[4])) === 'arrow', 'a stack on the block entity is visible through the menu');
  M.slotSet(m.slots[8], stk('cobblestone', 5));
  ok(be.items[8] && be.items[8].n === 5, 'and a stack written through the menu lands on the entity');
  m = M.dispenserMenu(be, P.menu.inventory);
  ok(nameOf(M.slotGet(m.slots[4])) === 'arrow' && M.slotGet(m.slots[4]).n === 12,
     'reopening over the same block entity finds the same stacks');
  // a dropper shares the menu
  const drop = blockAt(2, 4, 0, 'dropper', { facing: 'north' });
  const dm = M.dispenserMenu(drop, P.menu.inventory);
  ok(dm.slots.length === 45, 'a dropper uses the same 45-slot menu');
}

// ═══════════ 2. the trigger — once, on the rising edge ═══════════════════════════════════════
say('\n2. the latch: one item on the rising edge, and no more while the lever is held');
{
  freshWorld();
  const disp = blockAt(0, 4, 0, 'dispenser', { facing: 'north' });
  disp.items[0] = stk('cobblestone', 16);
  ok(B.propName(W.getBlock(0, 4, 0), 'triggered') === 'false', 'a fresh dispenser is not latched');

  putP(1, 4, 0, 'redstone_block');          // a permanent source right beside it
  B.changed(1, 4, 0);
  ok(B.propName(W.getBlock(0, 4, 0), 'triggered') === 'true', 'the latch closed on the rising edge');
  ok(disp.items[0].n === 16, 'and nothing has fired yet — the fire is four ticks later');
  run(3);
  ok(disp.items[0].n === 16, `still nothing three ticks in (${disp.items[0].n} of 16 left)`);
  run(2);
  ok(disp.items[0].n === 15, `exactly one item left the dispenser (${disp.items[0].n} of 16 left)`);
  run(60);
  ok(disp.items[0].n === 15, `and holding the signal fires nothing more (${disp.items[0].n} of 16 left)`);
  ok(EL.count() === 1, `one item entity was thrown, got ${EL.count()}`);

  // drop the signal, raise it again: one more
  W.setBlock(1, 4, 0, 0);
  B.changed(1, 4, 0);
  ok(B.propName(W.getBlock(0, 4, 0), 'triggered') === 'false', 'the latch opened when the signal went away');
  putP(1, 4, 0, 'redstone_block');
  B.changed(1, 4, 0);
  run(6);
  ok(disp.items[0].n === 14, `a second rising edge fired exactly one more (${disp.items[0].n} of 16 left)`);
}

// ═══════════ 3. quasi-connectivity ═══════════════════════════════════════════════════════════
say('\n3. the pos.above() term — power the cell ABOVE and it still fires');
{
  freshWorld();
  const disp = blockAt(0, 4, 0, 'dispenser', { facing: 'north' });
  disp.items[0] = stk('cobblestone', 8);
  // the source is beside the cell ABOVE the dispenser, and touches the dispenser nowhere
  putP(1, 5, 0, 'redstone_block');
  B.changed(1, 5, 0);
  run(6);
  // ⚠ BOTH DIRECTIONS (rule 6), settled by the referee (dispenserefcheck `dropper_quasi`): the
  // redstone block's placement updates only ITS six neighbours, and the dispenser is not one of
  // them, so it does NOT fire yet — quasi-connectivity waits for a later update that reaches it.
  ok(disp.items[0].n === 8, `a signal one block up does not fire it until the dispenser is updated (${disp.items[0].n} of 8 left)`);
  putP(-1, 4, 0, 'stone');
  B.changed(-1, 4, 0);
  run(6);
  ok(disp.items[0].n === 7, `a dispenser fires off a signal one block up once a neighbour changes (${disp.items[0].n} of 8 left)`);
}

// ═══════════ 4. a DROPPER puts its item into what it faces ═══════════════════════════════════
say('\n4. the dropper inserts');
{
  freshWorld();
  const drop = blockAt(0, 4, 0, 'dropper', { facing: 'down' });
  const chest = blockAt(0, 3, 0, 'chest');
  drop.items[0] = stk('cobblestone', 8);
  putP(1, 4, 0, 'redstone_block');
  B.changed(1, 4, 0);
  run(6);
  ok(chest.items[0] && chest.items[0].n === 1, `the dropper put one item in the chest below it (got ${chest.items[0] && chest.items[0].n})`);
  ok(drop.items[0].n === 7, `and is down by exactly one (${drop.items[0].n} of 8)`);
  ok(EL.count() === 0, `nothing was thrown on the floor (${EL.count()} item entities)`);

  // a FULL target: the dropper keeps its item rather than throwing it
  freshWorld();
  const drop2 = blockAt(0, 4, 0, 'dropper', { facing: 'down' });
  const chest2 = blockAt(0, 3, 0, 'chest');
  for (let i = 0; i < 27; i++) chest2.items[i] = stk('stone', 64);
  drop2.items[0] = stk('cobblestone', 8);
  putP(1, 4, 0, 'redstone_block');
  B.changed(1, 4, 0);
  run(6);
  ok(drop2.items[0].n === 8, `a dropper facing a FULL chest keeps its item (${drop2.items[0].n} of 8)`);
  ok(EL.count() === 0, 'and does not throw it past the chest');

  // facing open air: it throws
  freshWorld();
  const drop3 = blockAt(0, 4, 0, 'dropper', { facing: 'down' });
  drop3.items[0] = stk('cobblestone', 8);
  putP(1, 4, 0, 'redstone_block');
  B.changed(1, 4, 0);
  run(6);
  ok(drop3.items[0].n === 7 && EL.count() === 1, `facing open air a dropper throws (${drop3.items[0].n} left, ${EL.count()} entities)`);

  // G17-C3: getInventoryAt's entity branch - a chest_minecart in the faced cell takes the item
  const cartRun = (type, fill) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dropper', { facing: 'down' });
    const c = EL.spawn(type, 0.5, 3.0, 0.5);
    if (c.inventory === undefined || c.inventory === null) c.inventory = [];
    if (fill) for (let i = 0; i < 27; i++) c.inventory[i] = { item: 'stone', count: 64 };
    d.items[0] = stk('cobblestone', 8);
    putP(1, 4, 0, 'redstone_block');
    B.changed(1, 4, 0);
    run(6);
    return { d, c, others: EL.count() };
  };
  const cm = cartRun('chest_minecart', false);
  okAv(cm.d.items[0].n === 7 && cm.c.inventory[0] && cm.c.inventory[0].item === 'cobblestone' && cm.c.inventory[0].count === 1,
       `a dropper facing a chest_minecart inserts (${cm.d.items[0].n} left)`);
  const cf = cartRun('chest_minecart', true);
  okAv(cf.d.items[0].n === 8, `a dropper facing a FULL chest_minecart keeps its item (${cf.d.items[0].n} of 8)`);
  const cp = cartRun('minecart', false);
  okAv(cp.d.items[0].n === 7 && !(cp.c.inventory && cp.c.inventory[0]), `a plain minecart is not an inventory: the dropper throws (${cp.d.items[0].n} left)`);
}

// ═══════════ 5. a DISPENSER never inserts ════════════════════════════════════════════════════
say('\n5. the dispenser throws, even at a chest');
{
  freshWorld();
  const disp = blockAt(0, 4, 0, 'dispenser', { facing: 'down' });
  const chest = blockAt(0, 3, 0, 'chest');
  disp.items[0] = stk('cobblestone', 8);
  putP(1, 4, 0, 'redstone_block');
  B.changed(1, 4, 0);
  run(6);
  ok(!chest.items[0], 'a dispenser facing a chest put NOTHING in it');
  ok(disp.items[0].n === 7, `it still fired (${disp.items[0].n} of 8 left)`);
  ok(EL.count() === 1, `and threw the item instead (${EL.count()} item entities)`);
}

// ═══════════ 6. getRandomSlot ════════════════════════════════════════════════════════════════
say('\n6. getRandomSlot is uniform over the NON-EMPTY slots');
{
  freshWorld();
  const be = blockAt(0, 4, 0, 'dispenser', { facing: 'north' });
  be.items[2] = stk('cobblestone', 64);
  be.items[5] = stk('arrow', 64);
  be.items[7] = stk('stone', 64);
  const hits = new Map();
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 9000; i++) {
    const s = BE.dispenserRandomSlot(be, rnd);
    hits.set(s, (hits.get(s) || 0) + 1);
  }
  ok(hits.size === 3, `only the three non-empty slots are ever picked, got ${[...hits.keys()].sort().join(',')}`);
  const counts = [...hits.values()];
  const lo = Math.min(...counts), hi = Math.max(...counts);
  ok(lo > 2500 && hi < 3500, `and each is picked about a third of the time (${counts.join('/')} of 9000)`);
  ok(BE.dispenserRandomSlot({ items: new Array(9) }, rnd) === -1, 'an empty dispenser returns -1, the empty click');
}

// ═══════════ 7. the hopper's `enabled` property is WRITTEN ═══════════════════════════════════
say("\n7. D-420 — a hopper's `enabled` property no longer lies about the gate");
{
  freshWorld();
  const hop = blockAt(0, 4, 0, 'hopper', { facing: 'down' });
  ok(B.propName(W.getBlock(0, 4, 0), 'enabled') === 'true', 'an unpowered hopper reads enabled=true');
  putP(1, 4, 0, 'redstone_block');
  B.changed(1, 4, 0);
  ok(B.propName(W.getBlock(0, 4, 0), 'enabled') === 'false', 'a powered hopper reads enabled=false');
  ok(BE.hopperEnabled(hop) === false, 'and the transfer gate agrees with the property');
  W.setBlock(1, 4, 0, 0);
  B.changed(1, 4, 0);
  ok(B.propName(W.getBlock(0, 4, 0), 'enabled') === 'true', 'and it comes back when the signal goes away');
}

// ═══════════ 8. anti-vacuity ═════════════════════════════════════════════════════════════════
console.log('\n8. anti-vacuity — every rule above must be breakable');
{
  // (a) without the trigger nothing fires at all — §2 is not watching some other mechanism
  freshWorld();
  const quiet = blockAt(0, 4, 0, 'dispenser', { facing: 'north' });
  quiet.items[0] = stk('cobblestone', 8);
  run(60);
  okAv(quiet.items[0].n === 8, `an unpowered dispenser fires nothing in 60 ticks (${quiet.items[0].n} of 8 left)`);

  // (b) quasi-connectivity is a REAL extra term: a signal two blocks up must NOT fire it
  freshWorld();
  const far = blockAt(0, 4, 0, 'dispenser', { facing: 'north' });
  far.items[0] = stk('cobblestone', 8);
  putP(1, 6, 0, 'redstone_block');
  B.changed(1, 6, 0);
  run(10);
  okAv(far.items[0].n === 8, `a signal TWO blocks up must not fire it — §3's term is +1, not "anywhere above" (${far.items[0].n} of 8)`);

  // (c) the dropper/dispenser difference is real: the same scene, both blocks
  freshWorld();
  const d1 = blockAt(0, 4, 0, 'dropper', { facing: 'down' });
  const c1 = blockAt(0, 3, 0, 'chest');
  d1.items[0] = stk('cobblestone', 4);
  putP(1, 4, 0, 'redstone_block'); B.changed(1, 4, 0); run(6);
  const dropperInserted = !!c1.items[0];
  freshWorld();
  const d2 = blockAt(0, 4, 0, 'dispenser', { facing: 'down' });
  const c2 = blockAt(0, 3, 0, 'chest');
  d2.items[0] = stk('cobblestone', 4);
  putP(1, 4, 0, 'redstone_block'); B.changed(1, 4, 0); run(6);
  const dispenserInserted = !!c2.items[0];
  okAv(dropperInserted && !dispenserInserted,
       `the same scene separates them: dropper inserted=${dropperInserted}, dispenser inserted=${dispenserInserted}`);

  // (d) the owed list is closed
  okAv(Array.isArray(BE.DISPENSER_OWED) && BE.DISPENSER_OWED.length === 3,
       `BE.DISPENSER_OWED names exactly the three things these two still cannot do (got ${BE.DISPENSER_OWED && BE.DISPENSER_OWED.length})`);
}

// ═══════════ 9. ProjectileDispenserBehavior (G17-D1) ═════════════════════════════════════════
say('\n9. projectile dispenser behaviours');
{
  const faces = ['down', 'up', 'north', 'south', 'west', 'east'];
  const fire = (item, face, tag) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: face });
    d.items[0] = stk(item, 2);
    if (tag) d.items[0].t = tag;
    BE.dispenseFrom(d, Math.random);
    const ents = [...EL.list];
    return { d, ents };
  };
  const types = { arrow: 'arrow', snowball: 'snowball', egg: 'egg' };
  for (const [item, type] of Object.entries(types)) for (const f of faces) {
    const { d, ents } = fire(item, f);
    const e = ents.find((x) => x.type === type);
    okAv(!!e && !ents.some((x) => x.type === 'item') && d.items[0].n === 1,
         `${item} facing ${f} fires a ${type} entity (not an item), one consumed`);
    if (e) {
      const m = Math.hypot(e.vx, e.vy, e.vz);
      okAv(m > 1.1 * 0.5 && m < 1.1 * 1.6, `${item} ${f}: speed ${m.toFixed(3)} within the power-1.1 bound`);
      if (type === 'arrow') okAv(e.pickupType === 'allowed', `arrow ${f}: pickup allowed`);
    }
  }
  const sp = fire('spectral_arrow', 'north').ents.find((x) => x.type === 'spectral_arrow');
  okAv(!!sp && sp.pickupType === 'allowed', 'spectral arrow fires as a spectral_arrow entity');
  const tag = { Potion: "minecraft:poison" };
  const ta = fire('tipped_arrow', 'north', tag).ents.find((x) => x.type === 'arrow');
  okAv(!!ta && ta.pickupItem === 'tipped_arrow' && ta.pickupType === 'allowed', 'tipped arrow fires an arrow keeping its stack identity');
  // G17-D2: scaled force 1.1*1.25 = 1.375, variation 3.0
  for (const [item, type, ling] of [['splash_potion', 'potion', false], ['lingering_potion', 'potion', true], ['experience_bottle', 'experience_bottle']]) {
    const { d, ents } = fire(item, 'north', item === 'experience_bottle' ? null : { Potion: 'minecraft:healing' });
    const e = ents.find((x) => x.type === type);
    okAv(!!e && !ents.some((x) => x.type === 'item') && d.items[0].n === 1, `${item} fires a ${type} entity (not an item)`);
    if (e) {
      const m = Math.hypot(e.vx, e.vy, e.vz);
      okAv(m > 1.375 * 0.5 && m < 1.375 * 1.5, `${item}: speed ${m.toFixed(3)} within the scaled 1.375 bound`);
      if (type === 'potion') okAv(e.potionId === 'healing' && !!e.lingering === ling, `${item}: potion tag kept (${e.potionId}, lingering ${e.lingering})`);
    }
  }
  const savedP = BE.DISPENSE_BEHAVIORS.splash_potion;
  delete BE.DISPENSE_BEHAVIORS.splash_potion;
  ok(fire('splash_potion', 'north', { Potion: 'minecraft:healing' }).ents.some((x) => x.type === 'item'), 'with the splash_potion entry removed it is thrown as an item (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.splash_potion = savedP;
  const saved = BE.DISPENSE_BEHAVIORS.snowball;
  delete BE.DISPENSE_BEHAVIORS.snowball;
  const br = fire('snowball', 'north');
  ok(br.ents.some((x) => x.type === 'item') && !br.ents.some((x) => x.type === 'snowball'),
     'with the registry entry removed a snowball is thrown as an item (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.snowball = saved;

  // spawn eggs: the mob appears in the cell in FRONT
  freshWorld(); MCL.Use.init(W);
  const egg = fire('cow_spawn_egg', 'east'); 
  const cow = egg.ents.find((x) => x.type === 'cow');
  okAv(!!cow && !egg.ents.some((x) => x.type === 'item') && egg.d.items[0].n === 1,
       'cow spawn egg facing east spawns a cow (not an item), one consumed');
  okAv(!!cow && Math.abs(cow.x - 1.5) < 1e-6 && Math.abs(cow.z - 0.5) < 1e-6,
       `the cow stands at the east cell centre (got ${cow && cow.x},${cow && cow.z})`);
  const bad = fire('zzz_spawn_egg', 'east');
  ok(!bad.ents.some((x) => x.type === 'cow'), 'unknown egg spawns no mob');
  const savedEgg = BE.DISPENSE_BEHAVIORS._spawn_egg;
  delete BE.DISPENSE_BEHAVIORS._spawn_egg;
  const noEgg = fire('cow_spawn_egg', 'east');
  ok(!noEgg.ents.some((x) => x.type === 'cow'), 'with the spawn-egg entry removed no cow spawns (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS._spawn_egg = savedEgg;
  //  armor_stand (G17-D12)
  say('\n9b. armor_stand dispenser behaviour');
  const yawOf = (f) => { freshWorld(); MCL.Use.init(W); const r = fire('armor_stand', f); const s = r.ents.find((x) => x.type === 'armor_stand'); return { r, s }; };
  const want = { east: 270, north: 180, south: 0, west: 90 };
  for (const f of Object.keys(want)) {
    const { r, s } = yawOf(f);
    const deg = s ? ((s.yaw * 180 / Math.PI - 180) % 360 + 360) % 360 : -1;
    okAv(!!s && Math.abs(deg - want[f]) < 1e-6 && !r.ents.some((x) => x.type === 'item'), `armor_stand facing ${f}: stand at yaw ${want[f]} (got ${deg})`);
  }
  const { r: re, s: se } = yawOf('east');
  okAv(!!se && Math.abs(se.x - 1.5) < 1e-6 && Math.abs(se.z - 0.5) < 1e-6 && re.d.items[0].n === 1, 'armor_stand east at (front+0.5), one consumed');
  const savedA = BE.DISPENSE_BEHAVIORS.armor_stand;
  delete BE.DISPENSE_BEHAVIORS.armor_stand;
  freshWorld(); MCL.Use.init(W);
  ok(!fire('armor_stand', 'east').ents.some((x) => x.type === 'armor_stand'), 'with the registry entry removed no stand spawns (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.armor_stand = savedA;
}

// ═══════════ 99. bone meal: FallibleItemDispenserBehavior (G17-D9) ═══════════════════════════
say('\n99. bone meal dispenser behaviour');
{
  MCL.Use.init(W);
  ok(MCL.Use.ready, 'Use came up');
  const rig = (target, props, below) => {
    freshWorld();
    W.getLight = () => 15;
    if (below) putP(1, 3, 0, below, below === 'farmland' ? { moisture: 7 } : {});
    putP(1, 4, 0, target, props);
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk('bone_meal', 3);
    return d;
  };
  const rnd0 = () => 0.1;
  let d = rig('wheat', { age: 0 }, 'farmland');
  okAv(BE.dispenseFrom(d, rnd0) === true && d.items[0].n === 2 && B.propName(W.getBlock(1, 4, 0), 'age') !== '0',
       'wheat age 0 grows and one bone meal is spent');
  d = rig('stone');
  okAv(BE.dispenseFrom(d, rnd0) === false && d.items[0].n === 3 && !EL.list.some((x) => x.type === 'item'),
       'stone: the dispense fails, the bone meal is kept and nothing is thrown');
  d = rig('wheat', { age: 7 }, 'farmland');
  okAv(BE.dispenseFrom(d, rnd0) === false && d.items[0].n === 3, 'a mature crop fails and keeps the item');
  d = rig('oak_sapling', { stage: 0 }, 'grass_block');
  okAv(BE.dispenseFrom(d, rnd0) === true && B.propName(W.getBlock(1, 4, 0), 'stage') === '1' && d.items[0].n === 2,
       'sapling (roll < 0.45) advances to stage 1');
  freshWorld();
  for (let x = -2; x <= 6; x++) for (let z = -4; z <= 4; z++) { putP(x, 3, z, 'sand'); for (let y = 4; y <= 6; y++) putP(x, y, z, 'water', { level: 0 }); }
  putP(0, 4, 0, 'dispenser', { facing: 'east' });
  const dd = BE.get(0, 4, 0) || BE.create(0, 4, 0, 'dispenser');
  dd.items[0] = stk('bone_meal', 2);
  let sg = 0;
  okAv(BE.dispenseFrom(dd, Math.random) === true && dd.items[0].n === 1, 'underwater: useOnGround succeeds, one spent');
  for (let x = -2; x <= 6; x++) for (let z = -4; z <= 4; z++) if (W.getBlock(x, 4, z) === S.stateOf('seagrass')) sg++;
  okAv(sg > 0, `seagrass spread onto the sea floor (${sg})`);
  const saved = BE.DISPENSE_BEHAVIORS.bone_meal;
  delete BE.DISPENSE_BEHAVIORS.bone_meal;
  d = rig('wheat', { age: 0 }, 'farmland');
  BE.dispenseFrom(d, rnd0);
  ok(B.propName(W.getBlock(1, 4, 0), 'age') === '0' && EL.list.some((x) => x.type === 'item'),
     'with the registry entry removed the bone meal is thrown and the wheat does not grow (the check can fail)');
  breaks++;
  console.log('  ✓ break caught: bone_meal registry entry removed');
  BE.DISPENSE_BEHAVIORS.bone_meal = saved;
}

// ═══════════ 99a. glowstone charges a respawn_anchor (G17-D18) ═══════════════════════════
say('\n99a. glowstone dispenser behaviour');
{
  const rigG = (c) => {
    freshWorld();
    putP(1, 4, 0, 'respawn_anchor', { charges: c });
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk('glowstone', 5);
    return d;
  };
  let d = rigG(3);
  okAv(BE.dispenseFrom(d, () => 0.5) === true && d.items[0].n === 4 && B.propName(W.getBlock(1, 4, 0), 'charges') === '4',
       'anchor at 3: stack 5 -> 4, charges 4');
  d = rigG(4);
  BE.dispenseFrom(d, () => 0.5);
  okAv(B.propName(W.getBlock(1, 4, 0), 'charges') === '4' && EL.list.some((x) => x.type === 'item'), 'anchor at 4: the glowstone is thrown');
  const savedG = BE.DISPENSE_BEHAVIORS.glowstone;
  delete BE.DISPENSE_BEHAVIORS.glowstone;
  d = rigG(3);
  BE.dispenseFrom(d, () => 0.5);
  ok(B.propName(W.getBlock(1, 4, 0), 'charges') === '3', 'with the registry entry removed the anchor stays at 3 (the check can fail)');
  breaks++;
  console.log('  ✓ break caught: glowstone registry entry removed');
  BE.DISPENSE_BEHAVIORS.glowstone = savedG;
}

// ═══════════ 99b. glass_bottle: tryPutFilledBottle (G17-D19) ═══════════════════════════
say('\n99b. glass bottle dispenser behaviour');
{
  const rig = (target, props, n) => {
    freshWorld();
    putP(1, 4, 0, target, props);
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk('glass_bottle', n || 1);
    return d;
  };
  const nm = (s) => s && MCL.Items.nameOf(s.i);
  let d = rig('beehive', { honey_level: 5, facing: 'north' });
  okAv(BE.dispenseFrom(d, () => 0.1) === true && nm(d.items[0]) === 'honey_bottle' && B.propName(W.getBlock(1, 4, 0), 'honey_level') === '0',
       'full beehive: honey_bottle replaces the lone bottle, honey level 0');
  d = rig('beehive', { honey_level: 4, facing: 'north' });
  okAv(BE.dispenseFrom(d, () => 0.1) === true && !d.items[0] && EL.list.some((x) => x.type === 'item'), 'level 4: the bottle is thrown');
  d = rig('water', { level: 0 });
  okAv(BE.dispenseFrom(d, () => 0.1) === true && nm(d.items[0]) === 'potion' && d.items[0].t && d.items[0].t.Potion === 'minecraft:water', 'water: water potion');
  d = rig('water', { level: 0 }, 3);
  okAv(BE.dispenseFrom(d, () => 0.1) === true && d.items[0].n === 2 && nm(d.items[1]) === 'potion', 'stack of 3: 2 bottles + potion in first free slot');
  const saved = BE.DISPENSE_BEHAVIORS.glass_bottle;
  delete BE.DISPENSE_BEHAVIORS.glass_bottle;
  d = rig('water', { level: 0 });
  BE.dispenseFrom(d, () => 0.1);
  ok(nm(d.items[0]) !== 'potion', 'with the registry entry removed no potion appears (the check can fail)');
  breaks++;
  console.log('  ✓ break caught: glass_bottle registry entry removed');
  BE.DISPENSE_BEHAVIORS.glass_bottle = saved;
}

// ═══════════ 11. honeycomb: HoneycombItem.getWaxedState (G17-D20) ═════════════════════════════
say('\n11. honeycomb dispenser behaviour');
{
  const events = [];
  MCL.Particle = MCL.Particle || {};
  const prevWE = MCL.Particle.worldEvent;
  MCL.Particle.worldEvent = (id, x, y, z) => id !== 2000 && events.push([id, x, y, z]);
  const run = (target, props) => {
    freshWorld(); events.length = 0;
    putP(1, 4, 0, target, props);
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk('honeycomb', 3);
    const r = BE.dispenseFrom(d, () => 0.5);
    return { d, r, items: EL.list.some((x) => x.type === 'item') };
  };
  const cases = [['copper_block', {}, 'waxed_copper_block'], ['cut_copper', {}, 'waxed_cut_copper'],
    ['exposed_cut_copper_stairs', { facing: 'south', half: 'top', waterlogged: 'true' }, 'waxed_exposed_cut_copper_stairs'],
    ['oxidized_cut_copper_slab', { type: 'top' }, 'waxed_oxidized_cut_copper_slab']];
  for (const [t, pr, w] of cases) {
    const { d, r, items } = run(t, pr);
    const st = W.getBlock(1, 4, 0);
    okAv(r === true && d.items[0].n === 2 && !items, `${t}: dispense succeeds, one honeycomb spent, nothing thrown`);
    okAv(st === Object.keys(pr).reduce((a, k) => B.setProp(a, k, pr[k]), S.stateOf(w) | 0), `${t} became ${w} with its properties`);
    okAv(events.length === 1 && events[0][0] === 3003, `${t}: event 3003 emitted once`);
  }
  for (const [t, pr] of [['waxed_copper_block', {}], ['stone', {}], ['air', {}]]) {
    const { d, items } = run(t, pr);
    okAv(items && d.items[0].n === 2 && events.length === 0, `${t}: honeycomb is thrown as an item, no 3003`);
  }
  const savedH = BE.DISPENSE_BEHAVIORS.honeycomb;
  delete BE.DISPENSE_BEHAVIORS.honeycomb;
  run('copper_block', {});
  ok(W.getBlock(1, 4, 0) === S.stateOf('copper_block') && EL.list.some((x) => x.type === 'item'),
     'with the registry entry removed the honeycomb is thrown and the copper stays (the check can fail)');
  breaks++;
  console.log('  ✓ break caught: honeycomb registry entry removed');
  BE.DISPENSE_BEHAVIORS.honeycomb = savedH;
  MCL.Particle.worldEvent = prevWE;
}

// ═══════════ 10. fire_charge -> SmallFireballEntity (G17-D4) ═════════════════════════════════
say('\n10. fire_charge dispenser behaviour');
{
  const fire = (face) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: face });
    d.items[0] = stk('fire_charge', 2);
    let s = 12345;
    const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    BE.dispenseFrom(d, r);
    return { d, f: EL.list.find((x) => x.type === 'small_fireball'), items: EL.list.some((x) => x.type === 'item') };
  };
  const dirs = { north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };
  for (const [face, v] of Object.entries(dirs)) {
    const { d, f, items } = fire(face);
    okAv(!!f && !items && d.items[0].n === 1, `fire_charge facing ${face} spawns a small_fireball, one consumed`);
    if (f) {
      const dot = f.powerX * v[0] + f.powerY * v[1] + f.powerZ * v[2];
      const m = Math.hypot(f.powerX, f.powerY, f.powerZ);
      okAv(Math.abs(m - 0.1) < 1e-9 && dot / m > 0.95, `${face}: power direction matches the face (cos ${(dot / m).toFixed(3)})`);
    }
  }
  const saved = BE.DISPENSE_BEHAVIORS.fire_charge;
  delete BE.DISPENSE_BEHAVIORS.fire_charge;
  const br = fire('north');
  ok(!br.f && br.items, 'with the registry entry removed fire_charge is thrown as an item (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.fire_charge = saved;
}

say('\n11. dispenser equips armour on the entity in front (ArmorItem.dispenseArmor)');
{
  const Eq = MCL.Equip, IT = MCL.Items;
  const setup = (item, mk) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk(item, 2);
    const m = mk();
    return { d, m };
  };
  const zombie = () => EL.spawn('zombie', 1.5, 4, 0.5);
  let { d, m } = setup('iron_helmet', zombie);
  BE.dispenseFrom(d, Math.random);
  okAv(m && Eq.getEquipped(m, IT.HEAD) && nameOf(Eq.getEquipped(m, IT.HEAD)) === 'iron_helmet' && d.items[0].n === 1,
       'zombie in front wears the helmet in the head slot, one consumed');
  okAv(Eq.dropChance(m, IT.HEAD) === 2.0 && m.persistent === true, 'drop chance 2.0 and persistent');
  BE.dispenseFrom(d, Math.random);
  okAv(nameOf(Eq.getEquipped(m, IT.HEAD)) === 'iron_helmet' && !d.items[0] && EL.list.some((x) => x.type === 'item'),
       'a second helmet is thrown, not equipped over the occupied slot');
  ({ d, m } = setup('carved_pumpkin', zombie));
  BE.dispenseFrom(d, Math.random);
  okAv(nameOf(Eq.getEquipped(m, IT.HEAD)) === 'carved_pumpkin', 'carved pumpkin goes on the head');
  ({ d, m } = setup('elytra', zombie));
  BE.dispenseFrom(d, Math.random);
  okAv(nameOf(Eq.getEquipped(m, IT.CHEST)) === 'elytra', 'elytra goes in the chest slot');
  const P = MCL.Player;
  const Pst = { x: P.x, y: P.y, z: P.z, mode: P.mode, inventory: P.inventory, width: P.width, height: P.height };
  P.inventory = Inv.create(); P.width = 0.6; P.height = 1.8;
  ({ d } = setup('iron_chestplate', () => null));
  P.x = 1.5; P.y = 4; P.z = 0.5; P.mode = 0;
  const ci = Inv.ARMOR_START + 2;
  P.inventory.slots[ci] = null;
  BE.dispenseFrom(d, Math.random);
  okAv(nameOf(P.inventory.slots[ci]) === 'iron_chestplate', 'player in front is dressed with the chestplate');
  ({ d } = setup('iron_chestplate', () => null));
  P.inventory.slots[ci] = null; P.mode = 3;
  BE.dispenseFrom(d, Math.random);
  okAv(Inv.isEmpty(P.inventory.slots[ci]) && EL.list.some((x) => x.type === 'item'), 'a spectator is skipped');
  P.inventory.slots[ci] = null; Object.assign(P, Pst);
  const saved = BE.DISPENSE_BEHAVIORS.iron_helmet;
  delete BE.DISPENSE_BEHAVIORS.iron_helmet;
  const br = setup('iron_helmet', zombie);
  BE.equipablesDone = true;
  BE.dispenseFrom(br.d, Math.random);
  ok(!Eq.getEquipped(br.m, IT.HEAD), 'with the registry entry removed nothing is equipped (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.iron_helmet = saved;
}

say('\n11b. every armour piece, elytra, carved_pumpkin and head equips a mob with the slot empty, not a full one');
{
  const Eq = MCL.Equip, IT = MCL.Items;
  const items = [];
  for (const mat of ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite'])
    for (const p of ['helmet', 'chestplate', 'leggings', 'boots']) if (IT.has ? IT.has(mat + '_' + p) : true) items.push(mat + '_' + p);
  items.push('turtle_helmet', 'elytra', 'carved_pumpkin', 'skeleton_skull', 'wither_skeleton_skull', 'player_head',
             'zombie_head', 'creeper_head', 'dragon_head');   // no piglin_head in 1.18.2
  const tryItem = (name, preFill) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk(name, 1);
    const m = EL.spawn('zombie', 1.5, 4, 0.5);
    const es = Eq.preferredSlot(d.items[0]);
    if (preFill) Eq.setEquipped(m, es, stk('stone', 1));
    BE.dispenseFrom(d, Math.random);
    return nameOf(Eq.getEquipped(m, es)) === name;
  };
  for (const n of items) {
    okAv(tryItem(n, false), `${n} equips an empty slot`);
    okAv(!tryItem(n, true), `${n} does not replace an occupied slot`);
  }
  const sv = BE.DISPENSE_BEHAVIORS.elytra;
  delete BE.DISPENSE_BEHAVIORS.elytra; BE.equipablesDone = true;
  ok(!tryItem('elytra', false), 'with the elytra registration removed it is not equipped (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.elytra = sv;
}

say('\n11c. wither_skeleton_skull dispenser behaviour (#6397): builds the wither, else equips');
{
  MCL.Player = REAL_PLAYER;
  const Wi = MCL.Wither;
  const witherOf = () => EL.list.filter((x) => x.type === 'wither' && !x.removed);
  // the T: skulls at y=6, row at y=5, stem y=4; dispenser above the middle skull cell
  const t = (withBody) => {
    freshWorld();
    const d = blockAt(1, 7, 5, 'dispenser', { facing: 'down' });
    d.items[0] = stk('wither_skeleton_skull', 1);
    if (withBody) {
      for (const x of [0, 1, 2]) putP(x, 5, 5, 'soul_sand');
      putP(1, 4, 5, 'soul_sand');
      for (const x of [0, 2]) putP(x, 6, 5, 'wither_skeleton_skull');
    }
    return d;
  };
  let d = t(true);
  const r = BE.dispenseFrom(d, Math.random);
  if (VERBOSE) console.log(r, Wi && Wi.ready, EL.ready, MCL.States.name(W.getBlock(1, 6, 5)), MCL.Tags.ready);
  okAv(r === true && !d.items[0] && witherOf().length === 1, 'a skull dispensed onto the T of soul sand builds a wither');
  d = t(false);
  BE.dispenseFrom(d, Math.random);
  okAv(MCL.States.name(W.getBlock(1, 6, 5)) === 'air' && witherOf().length === 0, 'with no T the skull is not placed');
  const sv = BE.DISPENSE_BEHAVIORS.wither_skeleton_skull;
  BE.DISPENSE_BEHAVIORS.wither_skeleton_skull = undefined; BE.equipablesDone = true;
  d = t(true);
  BE.dispenseFrom(d, Math.random);
  ok(witherOf().length === 0, 'with the entry removed no wither is built (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.wither_skeleton_skull = sv;
}

say('\n11. firework_rocket dispenser behaviour (#5163)');
{
  for (const f of ['up', 'north']) {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: f });
    d.items[0] = stk('firework_rocket', 2);
    d.items[0].t = { Fireworks: { Flight: 3, Explosions: [{ Type: 1, Colors: [255] }, { Type: 0, Colors: [1] }] } };
    BE.dispenseFrom(d, Math.random);
    const r = [...EL.list].find((x) => x.type === 'firework_rocket');
    okAv(!!r && d.items[0].n === 1 && !EL.list.some((x) => x.type === 'item'), `firework facing ${f}: rocket spawned, one consumed`);
    if (r) {
      okAv(r.tag.Fireworks.Flight === 3 && r.tag.Fireworks.Explosions.length === 2, `firework ${f}: flight and explosions from the stack`);
      okAv(r.lifeTime >= 40 && r.lifeTime <= 40 + 5 + 6, `firework ${f}: lifeTime ${r.lifeTime} from flight 3`);
    }
  }
  const saved = BE.DISPENSE_BEHAVIORS.firework_rocket;
  delete BE.DISPENSE_BEHAVIORS.firework_rocket;
  freshWorld();
  const d = blockAt(0, 4, 0, 'dispenser', { facing: 'up' });
  d.items[0] = stk('firework_rocket', 2);
  BE.dispenseFrom(d, Math.random);
  ok(!EL.list.some((x) => x.type === 'firework_rocket'), 'with the registry entry removed no rocket spawns (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.firework_rocket = saved;
}

// ═══════════ 12. flint_and_steel (G17-D5) ════════════════════════════════════════════════════
say('\n12. flint and steel dispenser behaviour');
{
  const steel = (face, setup) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: face });
    d.items[0] = stk('flint_and_steel', 1);
    MCL.Use.init(W);
    setup();
    const r = BE.dispenseFrom(d, Math.random);
    return { d, r };
  };
  let o = steel('east', () => putP(1, 4, 0, 'tnt'));
  okAv(o.r === true && W.getBlock(1, 4, 0) === 0 && EL.list.some((x) => x.type === 'tnt'), 'TNT in front is primed and its block removed');
  okAv((o.d.items[0].d | 0) === 1, 'the steel lost 1 durability on the TNT success');
  o = steel('east', () => putP(1, 4, 0, 'campfire', { lit: 'false', waterlogged: 'false' }));
  okAv(o.r === true && (o.d.items[0].d | 0) === 1, 'campfire lit costs 1 durability');
  o = steel('east', () => { putP(1, 3, 0, 'oak_planks'); });
  okAv(o.r === true && W.getBlock(1, 4, 0) !== 0, 'air over a flammable floor gets fire');
  o = steel('east', () => putP(1, 4, 0, 'stone'));
  okAv(o.r === false && (o.d.items[0].d | 0) === 0 && o.d.items[0].n === 1, 'stone in front fails and the tool is undamaged');
  const saved = BE.DISPENSE_BEHAVIORS.flint_and_steel;
  delete BE.DISPENSE_BEHAVIORS.flint_and_steel;
  o = steel('east', () => putP(1, 4, 0, 'tnt'));
  ok(W.getBlock(1, 4, 0) !== 0, 'with the registry entry removed the TNT is not primed (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.flint_and_steel = saved;
}

// ═══════════ 11. ShearsDispenserBehavior (G17-D10) ═══════════════════════════════════════════
say('\n11. shears dispenser behaviour');
{
  const setup = () => { freshWorld(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' }); d.items[0] = stk('shears', 1); return d; };
  let d = setup();
  putP(1, 4, 0, 'beehive', { honey_level: '5', facing: 'north' });
  BE.create(1, 4, 0, 'beehive');
  okAv(BE.dispenseFrom(d, Math.random) === true && B.propName(W.getBlock(1, 4, 0), 'honey_level') === '0'
       && d.items[0] && d.items[0].d === 1 && EL.list.filter((x) => x.type === 'item').length === 1,
       'full beehive: honey_level 0, one honeycomb stack dropped, shears damaged by 1');
  const hc = EL.list.find((x) => x.type === 'item');
  okAv(hc && (hc.count === 3 || (hc.item && hc.item.n === 3)), 'the honeycomb stack holds 3');
  d = setup();
  putP(1, 4, 0, 'beehive', { honey_level: '4', facing: 'north' });
  okAv(BE.dispenseFrom(d, Math.random) === false && d.items[0].d === 0 && !EL.list.some((x) => x.type === 'item'),
       'beehive at honey_level 4 fails: nothing dropped, shears undamaged');
  d = setup();
  putP(1, 4, 0, 'stone');
  okAv(BE.dispenseFrom(d, Math.random) === false && d.items[0] && d.items[0].d === 0, 'stone fails, shears undamaged');
  d = setup();
  const sh = EL.spawn('sheep', 1.5, 4, 0.5);
  sh.woolColor = 'red';
  okAv(BE.dispenseFrom(d, Math.random) === true && sh.sheared === true && d.items[0].d === 1, 'sheep in front is sheared, shears damaged by 1');
  const wool = EL.list.find((x) => x.type === 'item');
  const wn = wool && (wool.count || (wool.item && wool.item.n));
  okAv(wool && wn >= 1 && wn <= 3, `1-3 wool dropped (${wn})`);
  okAv(BE.dispenseFrom(d, Math.random) === false && d.items[0].d === 1, 'an already-sheared sheep fails, no further damage');
  d = setup();
  d.items[0].d = MCL.Items.durability[d.items[0].i] - 1;
  EL.spawn('sheep', 1.5, 4, 0.5);
  BE.dispenseFrom(d, Math.random);
  okAv(!d.items[0], 'shears at last durability break (slot emptied)');
  d = setup();
  const mo = EL.spawn('mooshroom', 1.5, 4, 0.5);
  okAv(BE.dispenseFrom(d, Math.random) === true && d.items[0].d === 1 && mo.removed && EL.list.some((x) => x.type === 'cow')
       && EL.list.filter((x) => x.type === 'item').length === 5, 'mooshroom -> cow + 5 mushroom stacks, 1 durability');
  d = setup();
  const bm = EL.spawn('mooshroom', 1.5, 4, 0.5); bm.isBaby = true;
  okAv(BE.dispenseFrom(d, Math.random) === false && !bm.removed && !EL.list.some((x) => x.type === 'cow') && d.items[0].d === 0, 'baby mooshroom refused, shears kept (default throw)');
  d = setup();
  const sg = EL.spawn('snow_golem', 1.5, 4, 0.5);
  okAv(BE.dispenseFrom(d, Math.random) === true && sg.hasPumpkin === false && d.items[0].d === 1
       && EL.list.some((x) => x.type === 'item'), 'snow golem: pumpkin off, carved_pumpkin dropped');
  d = setup();
  EL.spawn('snow_golem', 1.5, 4, 0.5).hasPumpkin = false;
  okAv(BE.dispenseFrom(d, Math.random) === false && d.items[0] && d.items[0].d === 0, 'pumpkinless golem refused (default throw)');
  const saved = BE.DISPENSE_BEHAVIORS.shears;
  delete BE.DISPENSE_BEHAVIORS.shears;
  d = setup();
  EL.spawn('sheep', 1.5, 4, 0.5);
  BE.dispenseFrom(d, Math.random);
  ok(!EL.list.some((x) => x.type === 'sheep' && x.sheared), 'with the registry entry removed the sheep is not sheared (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.shears = saved;
}

// ═══════════ 12. horse armour / llama carpet dispenser behaviour (G17-D15) ═══════════
say('\n12. horse armour and llama carpets');
{
  const Mnt = MCL.Mount;
  const setup = (item) => { freshWorld(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' }); d.items[0] = stk(item, 2); return d; };
  const mob = (type, tamed) => { const m = EL.spawn(type, 1.5, 4, 0.5); m.tamed = tamed; return m; };
  let d = setup('diamond_horse_armor'), h = mob('horse', true);
  okAv(BE.dispenseFrom(d, Math.random) === true && h.armorItem === 'diamond_horse_armor' && h.mountItems[1] && d.items[0].n === 1,
       'diamond horse armour fills a tame horse slot, exactly one consumed');
  BE.dispenseFrom(d, Math.random);
  okAv(h.mountItems[1].n === 1 && EL.list.some((x) => x.type === 'item'), 'a horse already armoured is not re-equipped, the item is thrown');
  d = setup('diamond_horse_armor'); h = mob('horse', false);
  BE.dispenseFrom(d, Math.random);
  okAv(!h.armorItem && EL.list.some((x) => x.type === 'item'), 'untame horse not equipped, item thrown');
  d = setup('diamond_horse_armor'); const pg = mob('pig', true);
  BE.dispenseFrom(d, Math.random);
  okAv(!pg.armorItem && EL.list.some((x) => x.type === 'item'), 'a pig is not equipped, item thrown');
  d = setup('red_carpet'); h = mob('horse', true);
  BE.dispenseFrom(d, Math.random);
  okAv(!h.armorItem && !(h.mountItems && h.mountItems[1]) && EL.list.some((x) => x.type === 'item'), 'a carpet into a horse is not accepted');
  d = setup('red_carpet'); const ll = mob('llama', true);
  okAv(BE.dispenseFrom(d, Math.random) === true && ll.carpetColor === Mnt.carpetColorIndex('red_carpet') && d.items[0].n === 1,
       'red carpet into a tame llama sets the carpet colour');
  const saved = BE.DISPENSE_BEHAVIORS.diamond_horse_armor;
  delete BE.DISPENSE_BEHAVIORS.diamond_horse_armor;
  d = setup('diamond_horse_armor'); h = mob('horse', true);
  BE.dispenseFrom(d, Math.random);
  ok(!h.armorItem, 'with the registry entry removed the horse is not equipped (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.diamond_horse_armor = saved;
}

// ═══════════ 13. TNT item (G17-D13) ═════════════════════════════════════════════════════════
say('\n13. TNT item dispenser behaviour');
{
  const run = () => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'north' });
    d.items[0] = stk('tnt', 3);
    const heard = [];
    const sv = MCL.Sound;
    MCL.Sound = { play: (n) => { heard.push(n); } };
    const r = BE.dispenseFrom(d, Math.random);
    MCL.Sound = sv;
    return { d, r, heard, t: EL.list.find((x) => x.type === 'tnt') };
  };
  let o = run();
  okAv(o.r === true && o.t && o.t.fuse === 80 && o.t.x === 0.5 && o.t.y === 4 && o.t.z === -0.5 && !o.t.igniter,
       'one primed tnt, fuse 80, at the front cell centre, no igniter');
  okAv(o.heard.includes('entity.tnt.primed'), 'entity.tnt.primed is emitted');
  okAv(o.d.items[0] && o.d.items[0].n === 2, 'the stack dropped to 2');
  // the fuse running out at tick 80 and exploding is Tnt.tick's, proved by tntcheck.mjs
  const saved = BE.DISPENSE_BEHAVIORS.tnt;
  delete BE.DISPENSE_BEHAVIORS.tnt;
  o = run();
  ok(!o.t, 'with the registry entry removed no primed tnt spawns (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.tnt = saved;
}

// ═══════════ 10. fluid buckets (G17-D11) ═════════════════════════════════════════════════════
{
  const setup = (nm) => { freshWorld(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' }); d.items[0] = stk(nm, 1); if (nm === 'axolotl_bucket') d.items[0].axolotlVariant = 3; return d; };
  let d = setup('cod_bucket');
  ok(BE.dispenseFrom(d, Math.random) === true && d.items[0] && d.items[0].i === MCL.Items.of('bucket'), 'cod bucket leaves an empty bucket');
  ok(EL.list.some((x) => x.type === 'cod'), 'cod spawned in front');
  ok(W.getBlock(1, 4, 0) === MCL.States.stateOf('water'), 'water placed in front');
  d = setup('axolotl_bucket'); BE.dispenseFrom(d, Math.random);
  const ax = EL.list.find((x) => x.type === 'axolotl');
  ok(ax && ax.axolotlVariant === 3, 'axolotl keeps its variant');
  d = setup('powder_snow_bucket'); BE.dispenseFrom(d, Math.random);
  ok(W.getBlock(1, 4, 0) === MCL.States.stateOf('powder_snow'), 'powder snow placed');
  W.setBlock(1, 4, 0, MCL.States.stateOf('stone'));
  d = setup('cod_bucket'); W.setBlock(1, 4, 0, MCL.States.stateOf('stone'));
  BE.dispenseFrom(d, Math.random);
  ok(!EL.list.some((x) => x.type === 'cod') && !d.items[0], 'solid block in front: bucket thrown');
  const sv = BE.dispenseBucket; BE.dispenseBucket = () => null;
  d = setup('cod_bucket'); BE.dispenseFrom(d, Math.random);
  ok(!EL.list.some((x) => x.type === 'cod'), 'with the entry removed no cod spawns (the check can fail)');
  breaks++;
  BE.dispenseBucket = sv;
}

// ═══════════ 10c. water bucket waterlogs (G17-D27) ═══════════════════════════════════════════════
say('\n10c. dispenser water_bucket waterlogs a fillable block');
{
  const S = MCL.States;
  const run = (bucket, block, props) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk(bucket, 1);
    if (block === 'seagrass') putP(1, 3, 0, 'sand');
    putP(1, 4, 0, block, props);
    const before = W.getBlock(1, 4, 0);
    const r = BE.dispenseFrom(d, Math.random);
    return { d, r, before, after: W.getBlock(1, 4, 0) };
  };
  const wl = (st) => MCL.Behave.propName(st, 'waterlogged') === 'true';
  let o = run('water_bucket', 'oak_stairs', {});
  okAv(wl(o.after) && o.d.items[0] && o.d.items[0].i === MCL.Items.of('bucket'), 'stairs waterlogged, slot holds an empty bucket');
  o = run('water_bucket', 'oak_slab', { waterlogged: 'true' });
  ok(o.after === o.before && !o.d.items[0], 'waterlogged slab: thrown, state unchanged');
  o = run('lava_bucket', 'oak_stairs', {});
  ok(!wl(o.after) && !o.d.items[0], 'lava bucket facing stairs: thrown, not waterlogged');
  o = run('water_bucket', 'seagrass', {});
  ok(o.after === o.before && o.d.items[0] && o.d.items[0].i === MCL.Items.of('bucket'), 'seagrass: filled in place, empty bucket');
  const sv = MCL.Use.placeFluid; MCL.Use.placeFluid = () => false;
  o = run('water_bucket', 'oak_stairs', {});
  ok(!wl(o.after), 'with the fill branch removed the stairs stay dry (the check can fail)');
  breaks++;
  MCL.Use.placeFluid = sv;
}

// ═══════════ 10b. empty bucket drains any FluidDrainable (G17-D26) ═══════════════════════════
{
  const S = MCL.States;
  const run = (st) => { freshWorld(); MCL.Use.init(W); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' }); d.items[0] = stk('bucket', 1); W.setBlock(1, 3, 0, S.stateOf('soul_sand')); W.setBlock(1, 4, 0, st); BE.dispenseFrom(d, Math.random); return d; };
  let d = run(S.stateOf('powder_snow'));
  ok(d.items[0] && d.items[0].i === MCL.Items.of('powder_snow_bucket') && W.getBlock(1, 4, 0) === 0, 'empty bucket facing powder snow -> powder_snow_bucket, cell air');
  d = run(S.withLocal('bubble_column', 0));
  ok(d.items[0] && d.items[0].i === MCL.Items.of('water_bucket') && W.getBlock(1, 4, 0) === 0, 'empty bucket facing bubble column -> water_bucket, cell air');
  const flow = MCL.Behave.setProp(S.stateOf('water'), 'level', '1');
  d = run(flow);
  ok(!d.items[0] && W.getBlock(1, 4, 0) === flow, 'flowing water: bucket thrown, cell unchanged');
  const sv = MCL.Use.tryDrainFluid; MCL.Use.tryDrainFluid = () => '';
  d = run(S.stateOf('powder_snow'));
  ok(!(d.items[0] && d.items[0].i === MCL.Items.of('powder_snow_bucket')), 'with the drain removed powder snow is not taken (the check can fail)');
  breaks++;
  MCL.Use.tryDrainFluid = sv;
}

// ═══════════ 12. chest on a tame donkey (G17-D16) ═══════════════════════════════════════════
say('\n12. chest dispenser behaviour');
{
  const setup = () => { freshWorld(); const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' }); d.items[0] = stk('chest', 2); return d; };
  const EL = MCL.EntityList, Mnt = MCL.Mount || MCL.Mnt;
  let d = setup();
  const dk = EL.spawn('donkey', 1.5, 4, 0.5); dk.tamed = true;
  okAv(BE.dispenseFrom(d, Math.random) === true && dk.hasChest === true && d.items[0].n === 1 && !EL.list.some((x) => x.type === 'item'),
       'tame donkey gets the chest, one consumed, nothing thrown');
  BE.dispenseFrom(d, Math.random);
  okAv(EL.list.some((x) => x.type === 'item'), 'a donkey that already has a chest: the chest is thrown');
  d = setup();
  const wd = EL.spawn('donkey', 1.5, 4, 0.5);
  BE.dispenseFrom(d, Math.random);
  okAv(!wd.hasChest, 'an untame donkey gets no chest');
  d = setup();
  const hs = EL.spawn('horse', 1.5, 4, 0.5); hs.tamed = true;
  BE.dispenseFrom(d, Math.random);
  okAv(!hs.hasChest, 'a horse is ignored');
  const saved = BE.DISPENSE_BEHAVIORS.chest;
  delete BE.DISPENSE_BEHAVIORS.chest;
  d = setup();
  const d2 = EL.spawn('donkey', 1.5, 4, 0.5); d2.tamed = true;
  BE.dispenseFrom(d, Math.random);
  ok(!d2.hasChest, 'with the registry entry removed the donkey gets no chest (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.chest = saved;
}

// ═══════════ 9. world events 1000/1001/1002/2000 (G17-D22) ═══════════════════════════════════
console.log('\n9. world events — dispense sound, empty click, launch sound, facing smoke');
{
  const Px = MCL.Particle; Px.init();
  const smoke = []; const realSpawn = Px.spawn;
  Px.spawn = (t, x, y, z, vx, vy, vz, r) => { if (t === 'smoke') smoke.push({ x, y, z, vx, vy, vz }); return true; };
  BE.eventLog = [];
  const fire = (kind, item, face) => {
    freshWorld(); BE.eventLog.length = 0; smoke.length = 0;
    const d = blockAt(0, 4, 0, kind, { facing: face });
    if (item) d.items[0] = stk(item, 2);
    BE.dispenseFrom(d, Math.random);
    return BE.eventLog.map((x) => x.id);
  };
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  let ids = fire('dispenser', 'cobblestone', 'east');
  okAv(eq(ids, [1000, 2000]), `a dispenser throwing logs 1000 then 2000 (${ids})`);
  okAv(smoke.length === 10 && smoke.every((q) => q.x > 0.5 + 0.55 && Math.abs(q.vz) < 0.2) && smoke.reduce((a, q) => a + q.vx, 0) > 0,
       `facing east: 10 smoke particles on the east face moving +x (${smoke.length})`);
  fire('dispenser', 'cobblestone', 'up');
  okAv(smoke.length === 10 && smoke.every((q) => q.y > 4.5 + 0.3) && smoke.reduce((a, q) => a + q.vy, 0) > 0, 'facing up: smoke above, moving +y');
  fire('dispenser', 'cobblestone', 'down');
  okAv(smoke.length === 10 && smoke.every((q) => q.y < 4.5 - 0.3) && smoke.reduce((a, q) => a + q.vy, 0) < 0, 'facing down: smoke below, moving -y');
  ids = fire('dispenser', 'arrow', 'north');
  okAv(eq(ids, [1002, 2000]), `an arrow logs 1002 (launch), not 1000 (${ids})`);
  ids = fire('dispenser', null, 'north');
  okAv(eq(ids, [1001]) && smoke.length === 0, `an empty dispenser logs only the 1001 click (${ids})`);
  ids = fire('dropper', null, 'north');
  okAv(eq(ids, [1001]), `an empty dropper clicks too (${ids})`);
  ids = fire('dropper', 'cobblestone', 'north');
  okAv(eq(ids, [1000, 2000]), `a dropper throwing into the open logs 1000+2000 as ItemDispenserBehavior does (${ids})`);
  freshWorld(); BE.eventLog.length = 0;
  const dr = blockAt(0, 4, 0, 'dropper', { facing: 'north' });
  blockAt(0, 4, -1, 'chest', {});
  dr.items[0] = stk('cobblestone', 2);
  BE.dispenseFrom(dr, Math.random);
  okAv(BE.eventLog.length === 0, 'a dropper inserting into a chest logs no event');
  ids = fire('dispenser', 'fire_charge', 'north');
  okAv(eq(ids, [1018, 2000]), `a fire_charge logs 1018 (${ids})`);
  ids = fire('dispenser', 'firework_rocket', 'north');
  okAv(eq(ids, [1004, 2000]), `a firework_rocket logs 1004 (${ids})`);
  {
    const stoneAt = (x, y, z) => { try { return blockAt(x, y, z, 'stone', {}); } catch (e) { return null; } };
    for (const it of ['flint_and_steel', 'bone_meal']) {
      freshWorld(); BE.eventLog.length = 0;
      const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' }); stoneAt(1, 4, 0);
      d.items[0] = stk(it, 1);
      BE.dispenseFrom(d, Math.random);
      okAv(eq(BE.eventLog.map((x) => x.id), [1001]) && d.items[0] && d.items[0].n === 1, `${it} facing stone logs [1001], item stays (${BE.eventLog.map((x) => x.id)})`);
    }
    const bm = BE.DISPENSE_BEHAVIORS.bone_meal; BE.DISPENSE_BEHAVIORS.bone_meal = () => true;
    freshWorld(); BE.eventLog.length = 0;
    const d3 = blockAt(0, 4, 0, 'dispenser', { facing: 'east' }); d3.items[0] = stk('bone_meal', 1);
    BE.dispenseFrom(d3, Math.random);
    ok(!eq(BE.eventLog.map((x) => x.id), [1001]), 'a behaviour that succeeds logs no 1001 (the check can fail)'); breaks++;
    BE.DISPENSE_BEHAVIORS.bone_meal = bm;
  }
  const fe = BE.DISPENSE_BEHAVIORS.fire_charge.event; BE.DISPENSE_BEHAVIORS.fire_charge.event = 0;
  ids = fire('dispenser', 'fire_charge', 'north');
  ok(!eq(ids, [1018, 2000]), 'without the event field the fire_charge logs 1000 (the check can fail)'); breaks++;
  BE.DISPENSE_BEHAVIORS.fire_charge.event = fe;
  {
    const c2 = []; const sw2 = MCL.Sound; MCL.Sound = MCL.Sound || {}; const o2 = MCL.Sound.entitySound;
    MCL.Sound.entitySound = (ev, x, y, z, v, p) => c2.push([ev, v, p]);
    BE.dispenseEvent({ x: 0, y: 4, z: 0 }, 1004, 2); BE.dispenseEvent({ x: 0, y: 4, z: 0 }, 1018, 2, () => 0.5);
    MCL.Sound.entitySound = o2; MCL.Sound = sw2;
    okAv(eq(c2, [['entity.firework_rocket.shoot', 1, 1.2], ['entity.blaze.shoot', 2, 1]]), 'sounds: 1004 1.0/1.2, 1018 2.0/~1.0');
  }
  // the sound call itself
  const calls = []; const soundWas = MCL.Sound; MCL.Sound = MCL.Sound || {}; const snd = MCL.Sound, orig = snd.entitySound;
  snd.entitySound = (ev, x, y, z, v, p) => calls.push([ev, v, p]);
  BE.dispenseEvent({ x: 0, y: 4, z: 0 }, 1000, 2); BE.dispenseEvent({ x: 0, y: 4, z: 0 }, 1001, 2); BE.dispenseEvent({ x: 0, y: 4, z: 0 }, 1002, 2);
  snd.entitySound = orig; MCL.Sound = soundWas;
  okAv(eq(calls, [['block.dispenser.dispense', 1, 1], ['block.dispenser.fail', 1, 1.2], ['block.dispenser.launch', 1, 1.2]]),
       'sounds: dispense 1.0/1.0, fail 1.0/1.2, launch 1.0/1.2');
  // break: with the projectile flag removed, the arrow logs 1000 and the check notices
  const f = BE.DISPENSE_BEHAVIORS.arrow.projectile; BE.DISPENSE_BEHAVIORS.arrow.projectile = false;
  ids = fire('dispenser', 'arrow', 'north');
  ok(!eq(ids, [1002, 2000]), 'without the projectile flag the arrow no longer logs 1002 (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.arrow.projectile = f;
  BE.eventLog = null; Px.spawn = realSpawn;
}

// ═══════════ 12. BlockPlacementDispenserBehavior (G17-D18) ═══════════════════════════════════
say('\n12. jack_o_lantern and shulker boxes are placed in front');
{
  MCL.Player = REAL_PLAYER;       // `newPlayer()` swaps in a stub; the dispenser reuses the real `placementState`
  const setup = (item, facing, tag) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing });
    d.items[0] = stk(item, 1);
    if (tag) d.items[0].t = tag;
    putP(0, 3, 0, 'stone'); putP(1, 3, 0, 'stone'); putP(0, 3, 1, 'stone'); putP(0, 4, -1, 'stone'); putP(0, 5, 0, 'stone');
    return d;
  };
  const fa = (x, y, z) => B.propName(W.getBlock(x, y, z), 'facing');
  const nm = (x, y, z) => MCL.Reg.names[MCL.States.block[W.getBlock(x, y, z)]];
  let d = setup('jack_o_lantern', 'east');
  putP(1, 3, 0, 'stone');
  okAv(BE.dispenseFrom(d, Math.random) === true && nm(1, 4, 0) === 'jack_o_lantern' && fa(1, 4, 0) === 'west' && !d.items[0],
       'jack_o_lantern on solid ground faces opposite the dispenser direction (west), item spent');
  d = setup('jack_o_lantern', 'east');
  putP(1, 3, 0, 'air');
  okAv(BE.dispenseFrom(d, Math.random) === true && nm(1, 4, 0) === 'jack_o_lantern' && fa(1, 4, 0) === 'west', 'jack_o_lantern over air is still placed');
  d = setup('shulker_box', 'east', { BlockEntityTag: { Items: [{ Slot: 3, id: 'minecraft:diamond', Count: 5 }] } });
  putP(1, 3, 0, 'air');
  okAv(BE.dispenseFrom(d, Math.random) === true && nm(1, 4, 0) === 'shulker_box' && fa(1, 4, 0) === 'east',
       'shulker over air faces the dispenser direction (side = facing)');
  const be = BE.get(1, 4, 0);
  okAv(be && be.items[3] && MCL.Items.nameOf(be.items[3].i) === 'diamond' && be.items[3].n === 5, 'the placed shulker keeps its BlockEntityTag items');
  d = setup('red_shulker_box', 'east');
  putP(1, 3, 0, 'stone');
  okAv(BE.dispenseFrom(d, Math.random) === true && nm(1, 4, 0) === 'red_shulker_box' && fa(1, 4, 0) === 'up', 'shulker on solid ground faces up (side = UP)');
  d = setup('shulker_box', 'up');
  putP(0, 5, 0, 'air');
  okAv(BE.dispenseFrom(d, Math.random) === true && nm(0, 5, 0) === 'shulker_box' && fa(0, 5, 0) === 'up', 'an upward dispenser places a shulker facing up');
  d = setup('shulker_box', 'east');
  putP(1, 4, 0, 'stone');
  okAv(BE.dispenseFrom(d, Math.random) === false && d.items[0] && d.items[0].n === 1 && nm(1, 4, 0) === 'stone',
       'an occupied front cell fails (click) and keeps the item');
  const saved = BE.DISPENSE_BEHAVIORS.jack_o_lantern;
  delete BE.DISPENSE_BEHAVIORS.jack_o_lantern;
  d = setup('jack_o_lantern', 'east');
  BE.dispenseFrom(d, Math.random);
  ok(nm(1, 4, 0) !== 'jack_o_lantern', 'with the registry entry removed nothing is placed (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.jack_o_lantern = saved;
}

// ═══════════ 13. SaddleDispenserBehavior (G17-D14) ═════════════════════════════════════════════
say('\n13. saddle dispenser behaviour');
{
  const setup = (type, props) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk('saddle', 2);
    const m = EL.spawn(type, 1.5, 4, 0.5);
    Object.assign(m, props || {});
    return { d, m };
  };
  const items = () => EL.list.filter((x) => x.type === 'item').length;
  let { d, m } = setup('horse', { tamed: true });
  okAv(BE.dispenseFrom(d, Math.random) === true && m.saddled === true && d.items[0].n === 1 && items() === 0,
       'a tame horse is saddled, one saddle consumed, nothing thrown');
  ({ d, m } = setup('horse', { tamed: false }));
  BE.dispenseFrom(d, Math.random);
  okAv(!m.saddled && items() === 1, 'an untame horse is not saddled; the saddle is thrown out');
  ({ d, m } = setup('pig'));
  BE.dispenseFrom(d, Math.random);
  okAv(m.saddled === true && d.items[0].n === 1, 'a pig is saddled');
  ({ d, m } = setup('pig', { growAge: -24000 }));
  BE.dispenseFrom(d, Math.random);
  okAv(!m.saddled && items() === 1, 'a baby pig is not saddled; thrown');
  ({ d, m } = setup('pig', { saddled: true }));
  BE.dispenseFrom(d, Math.random);
  okAv(items() === 1, 'an already saddled pig: the saddle is thrown');
  ({ d, m } = setup('strider'));
  BE.dispenseFrom(d, Math.random);
  okAv(m.saddled === true, 'a strider is saddled');
  const saved = BE.DISPENSE_BEHAVIORS.saddle;
  delete BE.DISPENSE_BEHAVIORS.saddle;
  ({ d, m } = setup('pig'));
  BE.dispenseFrom(d, Math.random);
  ok(!m.saddled, 'with the registry entry removed the pig is not saddled (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.saddle = saved;
}

say('\n12. boats (BoatDispenserBehavior)');
{
  const go = (wood, setup) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    setup();
    d.items[0] = stk(wood + '_boat', 2);
    BE.dispenseFrom(d, Math.random);
    return { d, b: EL.list.find((x) => x.type === 'boat'), items: EL.list.some((x) => x.type === 'item') };
  };
  const inWater = () => putP(1, 4, 0, 'water', { level: 0 });
  const overWater = () => putP(1, 3, 0, 'water', { level: 0 });
  for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
    let r = go(w, inWater);
    okAv(!!r.b && !r.items && r.d.items[0].n === 1 && r.b.boatType === w && Math.abs(r.b.y - 5.5 - 0) < 1e-6 && Math.abs(r.b.x - 1.625) < 1e-6,
         `${w}_boat on front water spawns a ${w} boat at y+1`);
    r = go(w, overWater);
    okAv(!!r.b && !r.items && Math.abs(r.b.y - 4.5) < 1e-6, `${w}_boat over water below spawns at y+0`);
  }
  const r = go('oak', () => putP(1, 4, 0, 'stone'));
  okAv(!r.b && r.items, 'solid in front -> thrown as an item');
  const saved = BE.DISPENSE_BEHAVIORS.oak_boat;
  delete BE.DISPENSE_BEHAVIORS.oak_boat;
  ok(!go('oak', inWater).b, 'with the registry entry removed no boat spawns (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.oak_boat = saved;
}

// ═══════════ 12b. minecarts (MinecartItem.DISPENSER_BEHAVIOR) ═══════════════════════════════════
say('\n12b. minecarts');
{
  const rail = (y, shape) => { putP(1, y - 1, 0, 'stone'); putP(1, y, 0, 'rail', { shape }); };
  const go = (setup, item = 'minecart', face = 'east') => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: face });
    setup();
    d.items[0] = stk(item, 2);
    BE.dispenseFrom(d, Math.random);
    return { d, c: EL.list.find((x) => x.type === item), items: EL.list.some((x) => x.type === 'item') };
  };
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  let r = go(() => rail(4, 'north_south'));
  okAv(!!r.c && !r.items && r.d.items[0].n === 1 && near(r.c.y, 4.1) && near(r.c.x, 1.625) && near(r.c.z, 0.5), 'minecart on a rail spawns at y+0.1, x+1.125');
  r = go(() => rail(4, 'ascending_east'));
  okAv(!!r.c && near(r.c.y, 4.6), 'minecart on an ascending rail spawns at y+0.6');
  r = go(() => rail(3, 'north_south'));
  okAv(!!r.c && near(r.c.y, 3.1), 'minecart in air over a rail spawns at y-0.9');
  r = go(() => rail(3, 'ascending_east'));
  okAv(!!r.c && near(r.c.y, 3.6), 'minecart in air over an ascending rail spawns at y-0.4');
  r = go(() => putP(1, 4, 0, 'stone'));
  okAv(!r.c && r.items, 'no rail -> thrown as an item');
  r = go(() => rail(4, 'north_south'), 'chest_minecart');
  okAv(!!r.c, 'chest_minecart is placed too');
  const saved = BE.DISPENSE_BEHAVIORS.minecart;
  delete BE.DISPENSE_BEHAVIORS.minecart;
  ok(!go(() => rail(4, 'north_south')).c, 'with the registry entry removed no cart spawns (the check can fail)');
  breaks++;
  BE.DISPENSE_BEHAVIORS.minecart = saved;
}

// ═══════════ 10d. bucket over a replaceable block breaks it with drops (G17-D28) ══════════════════
say('\n10d. dispenser water_bucket breaks a replaceable block with drops first');
{
  const S = MCL.States;
  const run = (block, props) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk('water_bucket', 1);
    putP(1, 3, 0, 'dirt');
    putP(1, 4, 0, block, props);
    BE.dispenseFrom(d, Math.random);
    const ents = (MCL.EntityList.list || []);
        return { after: W.getBlock(1, 4, 0), items: ents.filter(x => x && x.type === 'item' && Math.floor(x.x) === 1 && Math.floor(x.y) === 4 && Math.floor(x.z) === 0).length };
  };
  const water = S.stateOf('water');
  let o = run('dandelion', {});
  okAv(o.after === water && o.items === 1, 'dandelion: cell holds water and the flower dropped (' + o.items + ')');
  o = run('grass', {});
  ok(o.after === water && o.items === 0, 'grass: water, no item');
  o = run('water', {});
  ok(o.items === 0, 'existing water overwritten with no item');
  const sv = MCL.Use.breakForFluid; MCL.Use.breakForFluid = () => {};
  o = run('dandelion', {});
  ok(o.items === 0, 'with the break removed the flower vanishes without a drop (the check can fail)');
  breaks++;
  MCL.Use.breakForFluid = sv;
}

// ═══════════ 15. bucket sounds (G17-D29) ═══════════════════════════════════════════════════
say('\n15. dispenser bucket fluid sounds');
{
  const run = (item, prep) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    if (prep) prep();
    d.items[0] = stk(item, 1);
    const heard = [];
    const sv = MCL.Sound;
    MCL.Sound = { play: (n, o) => { heard.push([n, o]); } };
    BE.dispenseFrom(d, Math.random);
    MCL.Sound = sv;
    return heard.filter((h) => /^item\.bucket\./.test(h[0]));
  };
  const want = { water_bucket: 'item.bucket.empty', lava_bucket: 'item.bucket.empty_lava',
    powder_snow_bucket: 'item.bucket.empty_powder_snow', cod_bucket: 'item.bucket.empty_fish' };
  for (const [it, snd] of Object.entries(want)) {
    const h = run(it);
    okAv(h.length === 1 && h[0][0] === snd && h[0][1].x === 1.5 && h[0][1].y === 4.5 && h[0][1].z === 0.5, `${it} -> ${snd} once at the cell centre`);
    const t = run(it, () => putP(1, 4, 0, 'stone'));
    okAv(t.length === 0, `${it} thrown (blocked) plays no bucket sound`);
  }
  okAv(run('bucket', () => putP(1, 4, 0, 'water', { level: 0 })).length === 0, 'draining plays no bucket sound (DispenserBehavior has none)');
}

say('\n16. carved_pumpkin dispenser builds golems (CarvedPumpkinBlock.canDispense)');
{
  const EL = MCL.EntityList;
  const run = (snow) => {
    freshWorld();
    const d = blockAt(0, 4, 0, 'dispenser', { facing: 'east' });
    d.items[0] = stk('carved_pumpkin', 1);
    for (let i = 0; i < snow; i++) putP(1, 3 - i, 0, 'snow_block');
    if (snow === 2) { /* head goes at y=4: stack is 2,3 below */ }
    return d;
  };
  // pumpkin lands at (1,4,0); snow blocks at (1,3,0),(1,2,0)
  let d = run(2);
  BE.dispenseFrom(d, Math.random);
  okAv(EL.list.some((x) => x.type === 'snow_golem') && !d.items[0] && MCL.World.getBlock(1, 4, 0) === 0
       && MCL.World.getBlock(1, 3, 0) === 0, 'two snow blocks + dispenser spawn a snow_golem, pumpkin consumed, pattern cleared');
  d = run(1);
  BE.dispenseFrom(d, Math.random);
  okAv(!EL.list.some((x) => x.type === 'snow_golem') && MCL.World.getBlock(1, 4, 0) === 0
       && EL.list.some((x) => x.type === 'item'), 'incomplete pattern: no golem, no block, pumpkin thrown');
}

console.log('\n============== dispensercheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
