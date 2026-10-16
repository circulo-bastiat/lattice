#!/usr/bin/env node
// enderchestcheck.mjs — PASS 17 JOB 1 (G19b), the ender chest (D-404).
//
//   node tools/enderchestcheck.mjs [--verbose]
//
// ⚠ WHAT IS NEW HERE, AND WHY IT IS NOT chestcheck.mjs's JOB. `chestcheck.mjs` §6 already proved
// `Menu.chestMenu` is completely type-blind — it works over ANY `{ items, open }`-shaped object,
// with no idea a barrel or an ender chest exists. That is still true for the ender chest: the
// menu itself did not change. What DID change is `Hud.openChest` (15_hud.js): for an
// `ender_chest`-typed block entity, and ONLY that type, it rebinds the entity's own `.items`
// array to `Player.enderItems` — a single 27-slot inventory the player carries — before handing
// it to `Menu.chestMenu`. That rebind is the entire feature (vanilla's `EnderChestMenu` is built
// over `player.getEnderChestInventory()`, not the clicked block's own container), it lives
// nowhere `chestcheck.mjs` looks, and `usecheck.mjs` §8 only proves the call reaches
// `Hud.openChest` and fails the same way chest/barrel do with no `Hud` wired at all — it cannot
// prove the rebind either, because there is no `Hud` in that harness. So this file loads the
// real `15_hud.js` (`H.openChest`/`H.close`) over a real `BlockEntities` store and asserts the
// one claim that matters: TWO DIFFERENT ender chests, at two different positions, read and write
// the SAME 27 slots — and, by contrast, two different plain chests do NOT.
//
// ⚠ RUNS HEADLESS. `H.openChest`/`H.close` touch no canvas and no DOM; only `NS.Input.uiOpen`/
// `releaseLock` are touched, which is why `13_input.js` is loaded too (its own `attach()` is
// never called, so no listener is ever registered against a document that does not exist here).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '14g_menu.js',
               '07c_blockentity.js', '13_input.js', '15_hud.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.BlockEntities.init();

const Inv = MCL.Inventory, M = MCL.Menu, BE = MCL.BlockEntities, H = MCL.Hud;
const st = (n, c) => Inv.stack(n, c);

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c && VERBOSE) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

function newPlayer() {
  var P = { enderItems: null, menu: { inventory: Inv.create() } };
  MCL.Player = P;
  return P;
}

console.log('enderchestcheck — PASS 17 JOB 1 (G19b), the ender chest (D-404)');

// ═══════════ 1. two different ender chests share one 27-slot inventory ═══════════════════════
{
  var P = newPlayer();
  var beA = BE.create(0, 0, 0, 'ender_chest');
  var beB = BE.create(5, 5, 5, 'ender_chest');
  ok(beA !== beB, 'two distinct block entities exist, at two distinct positions');
  ok(beA.items !== beB.items, 'and, freshly made, each still has its own EMPTY items array — the sharing happens on open, not on creation');

  ok(H.openChest(0, 0, 0) === true, 'opening the first ender chest succeeds');
  ok(beA.items === P.enderItems, "opening it rebound the block entity's own .items to the player's shared inventory");
  var m = H.chestMenu;
  Inv.setItem(m.inventory, 9, st('diamond', 5));
  M.doClick(m, 27, 0, M.PICKUP, {});                 // pick the diamonds off the backpack slot
  M.doClick(m, 0, 0, M.PICKUP, {});                  // place them in the ender chest's own slot 0
  ok(!Inv.isEmpty(beA.items[0]) && beA.items[0].n === 5 && Inv.itemName(beA.items[0]) === 'diamond',
     `5 diamonds landed in the first ender chest's slot 0, got ${JSON.stringify(beA.items[0])}`);
  H.close();

  ok(H.openChest(5, 5, 5) === true, 'opening the SECOND ender chest, at a different position, also succeeds');
  ok(beB.items === P.enderItems, "and it rebinds to the SAME shared array — not a second one");
  ok(beB.items === beA.items, "both block entities' own .items now point at the identical array");
  ok(!Inv.isEmpty(beB.items[0]) && beB.items[0].n === 5 && Inv.itemName(beB.items[0]) === 'diamond',
     `the diamonds put into ender chest A are visible from ender chest B's own screen, got ${JSON.stringify(beB.items[0])}`);
  var m2 = H.chestMenu;
  ok(m2.slots.length === 27 + 27 + 9, `the ender chest's own menu still has the plain 63 slots, got ${m2.slots.length}`);
  H.close();
  say('1 ok: two positions, one 27-slot inventory, proven through a real pickup/place click, not a field compare alone');
}

// ═══════════ 2. the lid still animates per-position (be.open is untouched by the rebind) ══════
{
  var P = newPlayer();
  var beA = BE.create(1, 1, 1, 'ender_chest');
  var beB = BE.create(9, 9, 9, 'ender_chest');
  H.openChest(1, 1, 1);
  ok(beA.open === 1 && beB.open === 0, `opening A bumps ONLY A's own lid counter (A=${beA.open}, B=${beB.open})`);
  H.close();
  ok(beA.open === 0, 'and closing it brings that counter back down — the shared items array is untouched by open/close');
  say('2 ok: shared storage, independent lids — matching vanilla\'s own block entity plus shared inventory split');
}

// ═══════════ 3. anti-vacuity: plain chests, by contrast, do NOT share ══════════════════════════
// If this section failed to fail, §1 would not be proving anything an untouched Hud.openChest
// did not already do — a bug that made EVERY container type share storage would pass §1 too.
{
  var P = newPlayer();
  var c1 = BE.create(20, 0, 0, 'chest');
  var c2 = BE.create(30, 0, 0, 'chest');
  H.openChest(20, 0, 0);
  var m = H.chestMenu;
  Inv.setItem(m.inventory, 9, st('bread', 3));
  M.doClick(m, 27, 0, M.PICKUP, {});
  M.doClick(m, 0, 0, M.PICKUP, {});
  H.close();
  H.openChest(30, 0, 0);
  var m2 = H.chestMenu;
  okAv(c1.items !== c2.items, 'anti-vacuity: two plain chests keep two SEPARATE items arrays');
  okAv(Inv.isEmpty(M.slotGet(m2.slots[0])),
    `anti-vacuity: the bread put into chest 1 is NOT visible from chest 2's own screen, got ${JSON.stringify(M.slotGet(m2.slots[0]))}`);
  H.close();

  // and a barrel, D-403's own precedent, does not share with an ender chest either
  var barrel = BE.create(40, 0, 0, 'barrel');
  var ec = BE.create(50, 0, 0, 'ender_chest');
  okAv(barrel.type !== ec.type && barrel.items !== ec.items,
    'anti-vacuity: a barrel and an ender chest are not the same type and do not share an array before either is opened');
  say('3 ok: the sharing is ender-chest-specific, not a general Hud.openChest behaviour');
}

// ═══════════ 4. anti-vacuity: an unbound Player.enderItems is created on demand, not assumed ══
{
  var P = { enderItems: undefined, menu: { inventory: Inv.create() } };
  MCL.Player = P;
  var be = BE.create(60, 0, 0, 'ender_chest');
  okAv(H.openChest(60, 0, 0) === true, 'opening an ender chest with no P.enderItems yet still succeeds');
  okAv(Array.isArray(P.enderItems) && P.enderItems.length === 27,
    `and it creates the 27-slot array on demand, got ${P.enderItems && P.enderItems.length}`);
  H.close();
}

console.log('');
console.log('1. two ender chests, two positions, one shared 27-slot inventory — proven by a real click, not a field compare');
console.log('2. the lid still animates per-position; the rebind touches storage only');
console.log('3. anti-vacuity: plain chests and barrels do NOT share, and an ender chest does not share with a barrel');
console.log('4. anti-vacuity: Player.enderItems is created lazily, not assumed to already exist');
console.log('');
for (const f of fails) console.log('FAIL  ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
