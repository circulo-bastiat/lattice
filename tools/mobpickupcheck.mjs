#!/usr/bin/env node
// mobpickupcheck.mjs — loop/mobpickup, QUEUE 0.2 (MobEntity item pickup). Proves `NS.Equip`'s
// own `Eq.tickPickup`/`Eq.loot`/`Eq.tryEquip`/`Eq.prefersNewEquipment`/`Eq.canPickupItem`/
// `Eq.canGather` (src/07y_equip.js) against LIVE `EL.spawn`'d mobs and REAL `EL.spawn('item',
// ...)` item entities, not a rewritten copy of either — `MobEntity.tickMovement`'s own
// `canPickUpLoot`/`mobGriefing`-gated pickup loop (.decomp `entity/mob/MobEntity.java:519-540`),
// `tryEquip`/`prefersNewEquipment`/`prefersNewDamageableItem` (:539-630),
// `ZombieEntity.canPickupItem`/`.canGather` (:431-438) + `ZombifiedPiglinEntity.canGather`
// (:244-246), and `PillagerEntity.loot`'s own banner-only restriction (:234-246).
//
//   node tools/mobpickupcheck.mjs [--verbose]
//
// Sections:
//   1. bare zombie picks up a dropped iron_sword — equips it, item entity discarded,
//      dropChance[MAINHAND] becomes 2.0, e.persistent becomes true
//   2. prefersNewEquipment: a sword already in hand beats a WORSE sword (wooden vs iron
//      already held) — no swap; a BETTER sword (diamond over wooden) swaps AND drops the old
//      one as a real ItemEntity (deterministic rnd forces the drop roll)
//   3. ZombieEntity.canPickupItem — a baby zombie WITH a vehicle refuses an egg; the same baby
//      WITHOUT a vehicle takes it (matches the jar's own `isBaby() && hasVehicle()` AND)
//   4. ZombieEntity.canGather — a plain zombie refuses glow_ink_sac outright;
//      zombified_piglin does not (ZombifiedPiglinEntity.canGather's own override)
//   5. mobGriefing gamerule gates the WHOLE loop — off, a zombie next to a sword does nothing
//   6. PillagerEntity.loot — a banner is picked up (the GENERIC MAINHAND path, not the
//      raid-captain HEAD override), an iron_sword in the exact same spot is left
//      alone (the jar's own dead-code isRaidCaptain branch means nothing but a banner
//      is ever reachable)
//   7. Eq.PICKUP_SKIP — villager/fox/panda/piglin never get driven through the generic path
//      even with canPickUpLoot forced true (their own bespoke code, or none yet, owns them)
//   8. anti-vacuity — a stubbed-out Eq.tryEquip and an emptied Eq.PICKUP_BOX_INFLATE are
//      themselves detected as breaking section 1's own real pickup

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
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('mobpickupcheck — loop/mobpickup: MobEntity item pickup (NS.Equip)');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07i_entitylist.js', '07l_spawn.js',
  '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.Equip.init();
// D-271 IS PAID (D-335): the attribute table comes from the SAME golden file `gen-data.mjs`
// inlines into `DATA.itemAttrs` (a copy typed here would be the thing D-305 is about) —
// `loadEngine` never runs `gen-data`, so this reads it straight off disk, the same convention
// `tools/handcheck.mjs` already uses.
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
M.Combat.init();

const Eq = M.Equip, IT = M.Items, EL = M.EntityList, CH = M.CH, W = M.World, SR = M.States;

ok(Eq && Eq.ready, 'NS.Equip did not load / did not report ready');
ok(typeof Eq.tickPickup === 'function' && typeof Eq.loot === 'function' && typeof Eq.tryEquip === 'function',
  'Eq.tickPickup/Eq.loot/Eq.tryEquip did not load (src/07y_equip.js)');
ok(M.Undead && M.Undead.ready, 'NS.Undead did not load (src/07zk_undead.js)');
if (!Eq || !Eq.ready) { console.log('\nFAIL mobpickupcheck — module missing'); process.exit(1); }

W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) W.setBlock(x, PLAT_Y, z, STONE);

const ZERO = () => 0;   // deterministic rnd: Math.max(0 - 0.1, 0) = 0 < any dropChance -> always drops

function spawnMob(type, x, y, z) {
  // Most species this check needs (zombie, skeleton, pillager, villager, fox, panda) spawn
  // fine through the real `EL.spawn`. Four do not, TODAY, for a reason that has nothing to do
  // with this unit: `EL.motionFor` (07i_entitylist.js, NOT a file this unit edits beyond its
  // one named hook line) has no `D.entities.motion`/hardcode row for `wither_skeleton`,
  // `piglin`, `piglin_brute` or `zombified_piglin` — a pre-existing gap (no `.jar` in this
  // worktree re-measured them, the same standing "not in D.entities.motion" note this file's
  // own header already gives fox/panda/rabbit/goat) that predates this unit and is out of its
  // owned files to close. A bare fixture with exactly the fields `Eq.tickPickup`/`Eq.loot`/
  // `Eq.canPickupItem`/`Eq.canGather` actually read (type/x/y/z/width/height/canPickUpLoot/
  // dead/removed) tests THIS unit's own logic without needing `EL.spawn`'s full machinery —
  // it is never registered in `EL.list`, so it cannot collide with anything real there.
  const e = EL.spawn(type, x, y, z);
  if (e) {   // EL.spawn rolls random gear / baby / jockey: strip them so every run asks the same question
    for (let s = 0; s < 6; s++) Eq.setEquipped(e, s, null);
    e.isBaby = false; e.vehicle = null; e.persistent = false;
    e.canPickUpLoot = true; return e;
  }
  const dim = M.Entities.dimensions(type) || { width: 0.6, height: 1.95 };
  return { type, x, y, z, width: dim.width, height: dim.height,
    canPickUpLoot: true, dead: false, removed: false, equip: [], equipDropChance: [] };
}
function dropItem(x, y, z, name, count) {
  const e = EL.spawn('item', x, y, z, { item: IT.of(name), count: count || 1 });
  e.pickupDelay = 0;   // EL.spawn's own default (10, 07i_entitylist.js:540) would otherwise
  return e;              // refuse the `(o.pickupDelay | 0) > 0` gate for several ticks — this
}                         // check calls Eq.tickPickup directly, same convention vbgathercheck uses.
function itemEntitiesOf(name) {
  const idx = IT.of(name);
  return EL.list.filter((o) => o.type === 'item' && !o.removed && o.item === idx);
}

// ═══ 1. a bare zombie picks up a dropped sword ══════════════════════════════════════════════
console.log('\n 1. bare zombie picks up a dropped iron_sword: equips it, discards the ItemEntity, sets the 2.0 guaranteed-drop chance + persistent');
{
  const z = spawnMob('zombie', 0, PLAT_Y + 1, 0);
  const sw = dropItem(0.3, PLAT_Y + 1, 0, 'iron_sword', 1);
  Eq.tickPickup(z, ZERO);
  const held = Eq.getEquipped(z, IT.MAINHAND);
  ok(!!held && IT.nameOf(held.i) === 'iron_sword', `zombie's MAINHAND is iron_sword after tickPickup, got ${held ? IT.nameOf(held.i) : 'empty'}`);
  ok(sw.removed === true, 'the ItemEntity was discarded on pickup (MobEntity.loot\'s own `$$0.discard()`)');
  ok(Eq.dropChance(z, IT.MAINHAND) === 2.0, `MAINHAND drop chance is the 2.0 guaranteed-drop sentinel after pickup (updateDropChances, .decomp:562-568), got ${Eq.dropChance(z, IT.MAINHAND)}`);
  ok(z.persistent === true, 'e.persistent set true on pickup (equipLootStack, .decomp:557)');
  EL.clear();
}

// ═══ 2. prefersNewEquipment: worse sword refused, better sword swaps + drops the old one ═══
console.log('\n 2. prefersNewEquipment: a held iron_sword beats a wooden_sword on the ground (no swap); a diamond_sword beats it back (swaps, drops the old one)');
{
  const z = spawnMob('zombie', 10, PLAT_Y + 1, 10);
  Eq.setEquipped(z, IT.MAINHAND, Eq.stackOf('iron_sword'));
  const worse = dropItem(10.3, PLAT_Y + 1, 10, 'wooden_sword', 1);
  Eq.tickPickup(z, ZERO);
  let held = Eq.getEquipped(z, IT.MAINHAND);
  ok(IT.nameOf(held.i) === 'iron_sword', `a worse sword on the ground does not replace the held iron_sword, got ${IT.nameOf(held.i)}`);
  ok(!worse.removed, 'the refused wooden_sword ItemEntity is left on the ground, not consumed');

  const better = dropItem(10.3, PLAT_Y + 1, 10, 'diamond_sword', 1);
  Eq.tickPickup(z, ZERO);
  held = Eq.getEquipped(z, IT.MAINHAND);
  ok(IT.nameOf(held.i) === 'diamond_sword', `a better sword on the ground DOES replace the held one, got ${IT.nameOf(held.i)}`);
  ok(better.removed === true, 'the picked-up diamond_sword ItemEntity was discarded');
  const dropped = itemEntitiesOf('iron_sword');
  ok(dropped.length === 1, `the displaced iron_sword was dropped as a real ItemEntity (Math.max(rnd()-0.1,0) < dropChance, rnd forced to 0), got ${dropped.length} entities`);
  EL.clear();
}

// ═══ 3. ZombieEntity.canPickupItem — baby + vehicle refuses an egg ══════════════════════════
console.log('\n 3. ZombieEntity.canPickupItem: a baby zombie WITH a vehicle refuses an egg; without a vehicle it does not');
{
  const babyRiding = spawnMob('zombie', 20, PLAT_Y + 1, 20);
  babyRiding.isBaby = true;
  babyRiding.vehicle = { fake: true };
  const egg1 = dropItem(20.3, PLAT_Y + 1, 20, 'egg', 1);
  Eq.tickPickup(babyRiding, ZERO);
  ok(!egg1.removed && !Eq.getEquipped(babyRiding, IT.MAINHAND), 'a baby zombie riding a vehicle refuses the egg (ZombieEntity.canPickupItem, .decomp:431-433)');
  EL.clear();   // the refused egg1 would otherwise sit inside the NEXT mob's own pickup box too

  const babyGrounded = spawnMob('zombie', 21, PLAT_Y + 1, 20);
  babyGrounded.isBaby = true;
  const egg2 = dropItem(21.3, PLAT_Y + 1, 20, 'egg', 1);
  Eq.tickPickup(babyGrounded, ZERO);
  const held = Eq.getEquipped(babyGrounded, IT.MAINHAND);
  ok(egg2.removed === true && !!held && IT.nameOf(held.i) === 'egg', 'the same baby zombie with NO vehicle takes the egg — the AND needs both halves');
  EL.clear();
}

// ═══ 4. ZombieEntity.canGather — glow_ink_sac refused; zombified_piglin overrides it back ═══
console.log('\n 4. ZombieEntity.canGather refuses glow_ink_sac; ZombifiedPiglinEntity.canGather (.decomp:244-246) does not inherit that refusal');
{
  const zom = spawnMob('zombie', 30, PLAT_Y + 1, 30);
  const sac1 = dropItem(30.3, PLAT_Y + 1, 30, 'glow_ink_sac', 1);
  Eq.tickPickup(zom, ZERO);
  ok(!sac1.removed && !Eq.getEquipped(zom, IT.MAINHAND), 'a plain zombie refuses glow_ink_sac outright');
  EL.clear();   // same isolation reason as section 3

  const zp = spawnMob('zombified_piglin', 31, PLAT_Y + 1, 30);
  // D-671: a zombified piglin now spawns WITH its golden sword (vanilla initEquipment), which
  // prefersNewEquipment rightly keeps over an ink sac — empty the hand so this asks canGather only.
  Eq.setEquipped(zp, IT.MAINHAND, null);
  const sac2 = dropItem(31.3, PLAT_Y + 1, 30, 'glow_ink_sac', 1);
  Eq.tickPickup(zp, ZERO);
  const held = Eq.getEquipped(zp, IT.MAINHAND);
  ok(sac2.removed === true && !!held && IT.nameOf(held.i) === 'glow_ink_sac', 'a zombified_piglin DOES pick up glow_ink_sac — its own canGather override skips the refusal');
  EL.clear();
}

// ═══ 5. the mobGriefing gamerule gates the whole loop ═══════════════════════════════════════
console.log('\n 5. GameRules.DO_MOB_GRIEFING gates the whole pickup loop, not just block-breaking');
{
  const savedCtx = EL.aiCtx;
  EL.aiCtx = function (e) { const c = savedCtx(e); c.mobGriefing = function () { return false; }; return c; };
  const z = spawnMob('zombie', 40, PLAT_Y + 1, 40);
  const sw = dropItem(40.3, PLAT_Y + 1, 40, 'iron_sword', 1);
  Eq.tickPickup(z, ZERO);
  ok(!sw.removed && !Eq.getEquipped(z, IT.MAINHAND), 'mobGriefing OFF: the zombie does nothing to the sword lying right next to it');
  EL.aiCtx = savedCtx;
  EL.clear();
}

// ═══ 6. PillagerEntity.loot — banner-only ═══════════════════════════════════════════════════
console.log('\n 6. PillagerEntity.loot: a banner is picked up (generic MAINHAND path); an iron_sword is silently ignored');
{
  const p = spawnMob('pillager', 50, PLAT_Y + 1, 50);
  // `EL.DEFAULTS`/`Eq.initWeapon` already rolled this pillager a crossbow (`Eq.WEAPON_FOR`,
  // 07y_equip.js) the moment it spawned, matching PillagerEntity's own `initEquipment` — clear
  // it so this test isolates `Eq.loot`'s own species dispatch from `prefersNewEquipment`'s
  // ordinary "won't swap a crossbow for a banner" refusal (already proven a different way by
  // section 2's own sword-vs-sword comparison).
  Eq.setEquipped(p, IT.MAINHAND, null);
  const sword = dropItem(50.3, PLAT_Y + 1, 50, 'iron_sword', 1);
  Eq.tickPickup(p, ZERO);
  ok(!sword.removed && !Eq.getEquipped(p, IT.MAINHAND), 'a pillager leaves an iron_sword alone (PillagerEntity.loot has no branch for it, .decomp:234-246)');

  const banner = dropItem(50.3, PLAT_Y + 1, 50, 'white_banner', 1);
  Eq.tickPickup(p, ZERO);
  // `LivingEntity.getPreferredEquipmentSlot` (.decomp:3268-3279) only routes to HEAD for
  // `carved_pumpkin` or an `AbstractSkullBlock` item — a banner is neither, so the generic
  // path (this test) equips it to MAINHAND. RaiderEntity.loot's own HARD-CODED `field_6169`
  // (HEAD) only fires on the raid-captain-PROMOTION branch, which is `Eq.OWED`, not this path.
  const held = Eq.getEquipped(p, IT.MAINHAND);
  ok(banner.removed === true && !!held && IT.nameOf(held.i) === 'white_banner', `a pillager DOES pick up a banner, into MAINHAND (getPreferredEquipmentSlot's generic path, not the raid-captain HEAD override), got ${held ? IT.nameOf(held.i) : 'empty'}`);
  EL.clear();
}

// ═══ 7. Eq.PICKUP_SKIP — villager/fox/panda/piglin are never generically driven ═════════════
console.log('\n 7. Eq.PICKUP_SKIP: villager/fox/panda/piglin/piglin_brute keep their own (or no) pickup — never the generic ZombieEntity-shaped path');
{
  for (const type of ['villager', 'fox', 'panda', 'piglin', 'piglin_brute']) {
    const m = spawnMob(type, 60, PLAT_Y + 1, 60);
    const sword = dropItem(60.3, PLAT_Y + 1, 60, 'iron_sword', 1);
    Eq.tickPickup(m, ZERO);
    ok(!sword.removed, `${type}: Eq.tickPickup is a no-op (Eq.PICKUP_SKIP), the sword ItemEntity is untouched`);
    EL.clear();
  }
}

// ═══ 8. anti-vacuity ═════════════════════════════════════════════════════════════════════════
console.log('\n 8. anti-vacuity: a stubbed-out Eq.tryEquip, and a zeroed pickup-box inflate, are themselves caught breaking section 1\'s own real pickup');
{
  const savedTryEquip = Eq.tryEquip;
  Eq.tryEquip = function () { return false; };
  const z1 = spawnMob('zombie', 70, PLAT_Y + 1, 70);
  const sw1 = dropItem(70.3, PLAT_Y + 1, 70, 'iron_sword', 1);
  Eq.tickPickup(z1, ZERO);
  okAv(!sw1.removed && !Eq.getEquipped(z1, IT.MAINHAND), 'a stubbed-out Eq.tryEquip leaves the sword alone — the real one does not, section 1 already proved it');
  Eq.tryEquip = savedTryEquip;
  EL.clear();

  const savedInflate = Eq.PICKUP_BOX_INFLATE;
  Eq.PICKUP_BOX_INFLATE = 0;
  const z2 = spawnMob('zombie', 80, PLAT_Y + 1, 80);
  const sw2 = dropItem(80.6, PLAT_Y + 1, 80, 'iron_sword', 1);   // 0.6 away, inside the real 1.0 box, outside a zeroed one
  Eq.tickPickup(z2, ZERO);
  okAv(!sw2.removed, 'a zeroed pickup-box inflate misses a sword 0.6 blocks away that the real 1.0 box would have caught');
  Eq.PICKUP_BOX_INFLATE = savedInflate;
  EL.clear();
}

console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(`\n${pass} ok, ${breaks} anti-vacuity breaks caught, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  - ' + f);
  console.log('\nFAIL mobpickupcheck');
  process.exit(1);
} else {
  console.log(`\nPASS mobpickupcheck — ${pass} checks green (incl. ${breaks} anti-vacuity)`);
}
