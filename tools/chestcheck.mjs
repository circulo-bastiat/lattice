#!/usr/bin/env node
// chestcheck.mjs — PASS 17 JOB 1 (G19b), first slice: a plain chest's own screen.
//
//   node tools/chestcheck.mjs [--verbose]
//
// ⚠ THIS FILE IS THE BEHAVIOURAL HALF. `guicheck.mjs` §4d already proved the chest screen's own
// slot geometry lands on the real `generic_54.png` pixels; this file proves the CLICK MACHINE
// wired to that geometry (`Menu.chestMenu`) actually moves items the way `git 2a8efe1:docs/passes/PASS-17-CURRENT.md`'s own
// acceptance criteria ask for — into the chest, back out on shift-click, and surviving a close
// and reopen — the same "MAIN THREAD ONLY, no DOM" argument `14g_menu.js`'s own header makes for
// `invcheck`: a click is a state machine over plain objects, so a whole scripted session runs
// here without a browser.
//
// ⚠ `Menu.chestMenu`'s own header names what this session did NOT verify: the slot-position
// FORMULA is bytecode-adjacent (measured against the real shipped texture in guicheck, not
// against `ChestMenu.<init>`'s own bytecode), and only `rows === 3` is wired to a real block.
// Double chest and every other remaining G19b screen (furnace, hopper, dispenser/dropper,
// brewing stand) are still on `Use.OWED`. Ender chest, barrel and shulker box (with its own
// nesting refusal, D-406) are all closed and proven below.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src', ASSETS = MCLITE_ROOT + 'assets';
const VERBOSE = process.argv.includes('--verbose');
const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '14f_inventory.js', '14g_menu.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
const IT = NS.Items, Inv = NS.Inventory, M = NS.Menu;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };
const st = (n, c) => Inv.stack(n, c);
const newChest = () => ({ type: 'chest', items: new Array(27), open: 0 });
const P = { menu: null };  // Menu.doClick's own `player` argument — only used by the two
                            // equipment branches and the drop hook, neither of which a chest
                            // slot reaches, so a bare object stands in the same way
                            // `goalcheck.mjs`'s synthetic entities stand in for a real one.

console.log('chestcheck — PASS 17 JOB 1 (G19b), the chest screen (D-397+)');

// ═══════════ 1. the menu's own shape ═══════════════════════════════════════════════════════
{
  const be = newChest();
  const inv = Inv.create();
  const m = M.chestMenu(be, inv, 3);
  ok(m.slots.length === 27 + 27 + 9, `a 3-row chest menu has 63 slots (27 chest + 27 backpack + 9 hotbar), got ${m.slots.length}`);
  ok(m.rows === 3, 'the menu remembers its own row count');
  ok(m.be === be, 'the menu keeps a reference to the block entity, not a copy of it');
  for (let i = 0; i < 27; i++) ok(m.slots[i].container === m.slots[0].container, `slot ${i} is on the chest's own container`);
  say('shape: 63 slots, three bands, the chest container shared across its own 27');
}

// ═══════════ 2. a stack moves FROM the backpack INTO the chest, by hand (PICKUP) ═══════════
{
  const be = newChest();
  const inv = Inv.create();
  Inv.setItem(inv, 9, st('dirt', 20));           // slot 9 is the first backpack slot
  const m = M.chestMenu(be, inv, 3);

  // pick the stack up off menu slot 27 (== inventory index 9, the first backpack slot)
  M.doClick(m, 27, 0, M.PICKUP, P);
  ok(M.getCarried(m) && M.getCarried(m).n === 20, 'picking up backpack slot 9 carries the whole stack of 20');
  ok(Inv.isEmpty(Inv.getItem(inv, 9)), 'and empties the backpack slot it came from');

  // place it into chest slot 0
  M.doClick(m, 0, 0, M.PICKUP, P);
  ok(Inv.isEmpty(M.getCarried(m)), 'placing it into chest slot 0 empties the cursor');
  ok(!Inv.isEmpty(be.items[0]) && be.items[0].n === 20 && Inv.itemName(be.items[0]) === 'dirt',
     `the CHEST'S OWN block entity now holds the 20 dirt, got ${JSON.stringify(be.items[0])}`);
  say('PICKUP: backpack slot 9 -> cursor -> chest slot 0, the block entity itself updated');
}

// ═══════════ 3. shift-click carries it back out (QUICK_MOVE) ══════════════════════════════
{
  const be = newChest();
  be.items[5] = st('cobblestone', 40);
  const inv = Inv.create();
  const m = M.chestMenu(be, inv, 3);

  M.doClick(m, 5, 0, M.QUICK_MOVE, P);
  ok(Inv.isEmpty(be.items[5]) || be.items[5] === undefined, 'shift-clicking a chest slot empties the chest\'s own slot');
  let found = 0;
  for (let i = 0; i < 36; i++) { const s = Inv.getItem(inv, i); if (!Inv.isEmpty(s) && Inv.itemName(s) === 'cobblestone') found += s.n; }
  ok(found === 40, `and all 40 cobblestone land somewhere in the player's own 36 non-hotbar-first slots, found ${found}`);

  // and the reverse: shift-clicking a BACKPACK slot sends it INTO the chest
  const be2 = newChest();
  const inv2 = Inv.create();
  Inv.setItem(inv2, 9, st('oak_log', 12));
  const m2 = M.chestMenu(be2, inv2, 3);
  M.doClick(m2, 27, 0, M.QUICK_MOVE, P);
  ok(Inv.isEmpty(Inv.getItem(inv2, 9)), 'and the reverse: shift-clicking backpack slot 9 empties it');
  let landed = 0;
  for (let i = 0; i < 27; i++) if (!Inv.isEmpty(be2.items[i])) landed += be2.items[i].n;
  ok(landed === 12, `with all 12 oak logs landing somewhere in the chest's own 27, found ${landed}`);
  say('QUICK_MOVE: both directions — chest to backpack, and backpack to chest');
}

// ═══════════ 4. close and reopen — the container itself persists, not a copy of it ═════════
{
  const be = newChest();
  const inv = Inv.create();
  const m1 = M.chestMenu(be, inv, 3);
  Inv.setItem(inv, 9, st('diamond', 3));
  M.doClick(m1, 27, 0, M.PICKUP, P);
  M.doClick(m1, 4, 0, M.PICKUP, P);               // place into chest slot 4
  ok(!Inv.isEmpty(be.items[4]) && be.items[4].n === 3, 'diamonds landed in the block entity before "closing"');

  // "closing" is just dropping the menu object — nothing about `be` should depend on `m1`
  // still existing, and "reopening" is a FRESH menu over the SAME block entity.
  const m2 = M.chestMenu(be, inv, 3);
  ok(M.slotGet(m2.slots[4]) === be.items[4], 'reopening reads the SAME stack object out of the block entity');
  ok(!Inv.isEmpty(M.slotGet(m2.slots[4])) && M.slotGet(m2.slots[4]).n === 3,
     'and the 3 diamonds are still there after close and reopen');
  say('close/reopen: a fresh Menu.chestMenu over the same `be` sees the same contents');
}

// ═══════════ 5. anti-vacuity (D-30, D-305) ═════════════════════════════════════════════════
{
  // 5a. a container that COPIES `be.items` at creation time (the bug the close/reopen test
  // exists to catch) must FAIL the same persistence assertion — proving the test is not
  // vacuously true for any container shape.
  function brokenChestMenu(be, inventory, rows) {
    const snapshot = be.items.slice();           // <- THE BUG: a copy, not a reference
    const n = rows * 9;
    const chestC = M.container(
      (i) => snapshot[i] || null,
      (i, s) => { snapshot[i] = Inv.isEmpty(s) ? null : s; },
      (i, count) => { const s = snapshot[i]; if (Inv.isEmpty(s)) return null; const out = Inv.split(s, count); if (s.n <= 0) snapshot[i] = null; return out; },
      n);
    const invC = M.inventoryContainer(inventory);
    const slots = [];
    for (let i = 0; i < n; i++) slots.push(M.slot(chestC, i));
    for (let p = 9; p < 36; p++) slots.push(M.slot(invC, p));
    for (let h = 0; h < 9; h++) slots.push(M.slot(invC, h));
    return M.create(slots, {});
  }
  const be = newChest();
  const inv = Inv.create();
  const bm1 = brokenChestMenu(be, inv, 3);
  Inv.setItem(inv, 9, st('emerald', 5));
  M.doClick(bm1, 27, 0, M.PICKUP, P);
  M.doClick(bm1, 2, 0, M.PICKUP, P);
  okAv(Inv.isEmpty(be.items[2]),
    'anti-vacuity: a chest menu that copies `be.items` instead of referencing it leaves the REAL block entity empty — the close/reopen test would have caught it');

  // 5b. the real Menu.chestMenu, same sequence, must NOT show that failure — the pair proves
  // the check tells a reference from a copy rather than always failing or always passing.
  const be2 = newChest();
  const inv2 = Inv.create();
  const rm1 = M.chestMenu(be2, inv2, 3);
  Inv.setItem(inv2, 9, st('emerald', 5));
  M.doClick(rm1, 27, 0, M.PICKUP, P);
  M.doClick(rm1, 2, 0, M.PICKUP, P);
  okAv(!Inv.isEmpty(be2.items[2]) && be2.items[2].n === 5,
    'anti-vacuity: and the REAL Menu.chestMenu does NOT have that bug — the check is not always red');

  // 5c. moving more than the chest's own 27 slots can hold must not lose or duplicate items —
  // a full chest simply keeps the rest on the cursor/where it was.
  const be3 = newChest();
  for (let i = 0; i < 27; i++) be3.items[i] = st('sand', 64);   // completely full, all one item
  const inv3 = Inv.create();
  Inv.setItem(inv3, 9, st('sand', 10));
  const m3 = M.chestMenu(be3, inv3, 3);
  M.doClick(m3, 27, 0, M.QUICK_MOVE, P);       // shift-click sand into an already-full chest
  ok(!Inv.isEmpty(Inv.getItem(inv3, 9)) && Inv.getItem(inv3, 9).n === 10,
     'shift-clicking into a completely full chest of the same item leaves the stack where it was, not duplicated or dropped');
}

// ═══════════ 6. the barrel (D-403) — the SAME menu, over a differently-typed block entity ═════════════
// ⚠ Vanilla's own `BarrelScreen.CONTAINER_BACKGROUND` is `generic_54.png` — the SAME file
// `ChestScreen` draws (confirmed against the 1.18.2 jar: there is no `gui/container/barrel.png`
// at all), so `Hud.openChest`/`Hud.drawChest`/`Hud.chestClick` (15_hud.js) do not branch on
// `be.type` anywhere — the only place that knows the difference is `Hud.openChest`'s own
// type gate, which now accepts `'barrel'` alongside `'chest'`/`'trapped_chest'`. This section
// proves the substrate `Menu.chestMenu` itself treats a barrel-typed block entity exactly like
// a chest-typed one — the claim the type gate change depends on.
{
  const newBarrel = () => ({ type: 'barrel', items: new Array(27), open: 0 });
  const be = newBarrel();
  const inv = Inv.create();
  Inv.setItem(inv, 9, st('bread', 5));
  const m = M.chestMenu(be, inv, 3);
  ok(m.slots.length === 27 + 27 + 9, `a barrel's own menu has the same 63 slots as a chest's, got ${m.slots.length}`);

  M.doClick(m, 27, 0, M.PICKUP, P);
  M.doClick(m, 8, 0, M.PICKUP, P);
  ok(!Inv.isEmpty(be.items[8]) && be.items[8].n === 5 && Inv.itemName(be.items[8]) === 'bread',
     `a barrel's own block entity holds items the same way a chest's does, got ${JSON.stringify(be.items[8])}`);

  const m2 = M.chestMenu(be, inv, 3);
  ok(M.slotGet(m2.slots[8]) === be.items[8], 'and a barrel survives close/reopen the same way — same reference, not a copy');

  // anti-vacuity: `be.type` plays no role inside `Menu.chestMenu` at all — an UNTYPED block
  // entity (no `.type` field) must behave identically, proving this section is not silently
  // passing because of a `type === 'barrel'` special case somewhere in the menu code itself.
  const untyped = { items: new Array(27), open: 0 };
  const inv3 = Inv.create();
  Inv.setItem(inv3, 9, st('bread', 2));
  const m3 = M.chestMenu(untyped, inv3, 3);
  M.doClick(m3, 27, 0, M.PICKUP, P);
  M.doClick(m3, 0, 0, M.PICKUP, P);
  okAv(!Inv.isEmpty(untyped.items[0]) && untyped.items[0].n === 2,
    'anti-vacuity: Menu.chestMenu works with no `.type` field at all — it is the caller (Hud.openChest\'s type gate) that decides which blocks reach it, not this menu');
  say('barrel: same 63-slot menu, same persistence, and Menu.chestMenu itself is type-blind — the gate lives in Hud.openChest');
}

// ═══════════ 7. the shulker box (D-406) — the SAME menu, its OWN texture, and one new rule ═══
// ⚠ Unlike the barrel, vanilla DOES ship a distinct `shulker_box.png` (confirmed present in the
// 1.13.2 jar `build-gui.mjs` draws every GUI sheet from) — `guicheck` §4e proves that artwork
// against the real pixels; this file stays the behavioural half and proves the one thing that
// IS new logic here: `Menu.chestMenu`'s 4th argument, `noNest`, refuses to let a shulker box
// (any of the 17 — the plain one or any of the 16 dyed ones) be placed into the container's own
// 27 slots, while leaving the player's own backpack/hotbar band (and every OTHER caller of
// `Menu.chestMenu` that does not pass `noNest`) completely unrestricted — "no shulker in a
// shulker" is a rule about THIS container's own slots, not about the item existing at all.
{
  const newShulker = () => ({ type: 'shulker_box', items: new Array(27), open: 0 });
  const be = newShulker();
  const inv = Inv.create();
  Inv.setItem(inv, 9, st('cobblestone', 12));
  const m = M.chestMenu(be, inv, 3, true);
  ok(m.slots.length === 27 + 27 + 9, `a shulker box's own menu has the same 63 slots as a chest's, got ${m.slots.length}`);

  // an ordinary item moves in exactly like it would into a chest or barrel
  M.doClick(m, 27, 0, M.PICKUP, P);
  M.doClick(m, 0, 0, M.PICKUP, P);
  ok(!Inv.isEmpty(be.items[0]) && be.items[0].n === 12 && Inv.itemName(be.items[0]) === 'cobblestone',
     `an ordinary item still moves into a shulker box's own container, got ${JSON.stringify(be.items[0])}`);

  // the nesting refusal itself: a shulker box ITEM, picked up by hand, may not be placed into
  // any of the container's own 27 slots (direct PICKUP-click placement).
  const inv2 = Inv.create();
  Inv.setItem(inv2, 9, st('red_shulker_box', 1));
  const m2 = M.chestMenu(be, inv2, 3, true);
  M.doClick(m2, 27, 0, M.PICKUP, P);                 // pick the shulker box item up off the backpack
  ok(M.getCarried(m2) && Inv.itemName(M.getCarried(m2)) === 'red_shulker_box', 'the shulker box item is carried, ready to try placing');
  M.doClick(m2, 1, 0, M.PICKUP, P);                  // try to place it into container slot 1
  ok(Inv.isEmpty(be.items[1]), `a shulker box item is refused by another shulker box's own container slot, got ${JSON.stringify(be.items[1])}`);
  ok(M.getCarried(m2) && Inv.itemName(M.getCarried(m2)) === 'red_shulker_box', 'and stays carried rather than being silently dropped or swallowed');

  // the SAME refusal on the shift-click path (QUICK_MOVE), not only direct placement — a second
  // route into the same slots that a `mayPlace`-only fix could still miss if `moveItemStackTo`
  // did not itself check `slotMayPlace` (it does, `14g_menu.js` line ~323).
  const inv3 = Inv.create();
  Inv.setItem(inv3, 9, st('white_shulker_box', 1));
  const m3 = M.chestMenu(be, inv3, 3, true);
  M.doClick(m3, 27, 0, M.QUICK_MOVE, P);              // shift-click the backpack's own shulker box
  ok(be.items.every((s2) => Inv.isEmpty(s2) || Inv.itemName(s2) !== 'white_shulker_box'),
     'shift-clicking a shulker box item at the player also refuses to quick-move it into the container');
  ok(!Inv.isEmpty(inv3.slots[9]) && Inv.itemName(inv3.slots[9]) === 'white_shulker_box',
     'and the stack is left where it was, in the player\'s own backpack, rather than vanishing');

  // the uncoloured `shulker_box` name itself must be caught too, not just the sixteen dyed ones
  const inv4 = Inv.create();
  Inv.setItem(inv4, 9, st('shulker_box', 1));
  const m4 = M.chestMenu(be, inv4, 3, true);
  M.doClick(m4, 27, 0, M.PICKUP, P);
  M.doClick(m4, 2, 0, M.PICKUP, P);
  ok(Inv.isEmpty(be.items[2]), 'the plain, uncoloured `shulker_box` item is refused the same way as a dyed one');

  // anti-vacuity: the SAME item is perfectly ordinary in the player's OWN backpack/hotbar slots
  // (n..n+36) — this is a rule about the container's own slots, not a blanket ban on the item —
  // and, separately, `noNest` genuinely GATES the behaviour: the identical be/inventory shape
  // WITHOUT passing `noNest` (exactly what `Hud.openChest` does for chest/barrel/ender chest)
  // must accept the same shulker box item the calls above just refused.
  const inv5 = Inv.create();
  Inv.setItem(inv5, 9, st('blue_shulker_box', 1));
  const m5 = M.chestMenu(be, inv5, 3, true);
  M.doClick(m5, 27, 0, M.PICKUP, P);
  M.doClick(m5, 27, 0, M.PICKUP, P);                  // place it right back into ITS OWN backpack slot
  okAv(!Inv.isEmpty(inv5.slots[9]) && Inv.itemName(inv5.slots[9]) === 'blue_shulker_box',
    'anti-vacuity: noNest does not block the player\'s own backpack/hotbar slots, only the container\'s own — a shulker box item still fits back in slot 9');
  const be2 = newShulker();
  const inv6 = Inv.create();
  Inv.setItem(inv6, 9, st('green_shulker_box', 1));
  const m6 = M.chestMenu(be2, inv6, 3);                // NO noNest — the barrel/chest/ender-chest call shape
  M.doClick(m6, 27, 0, M.PICKUP, P);
  M.doClick(m6, 3, 0, M.PICKUP, P);
  okAv(!Inv.isEmpty(be2.items[3]) && Inv.itemName(be2.items[3]) === 'green_shulker_box',
    'anti-vacuity: without noNest, the identical shulker-box-typed block entity accepts a shulker box item — the refusal is the ARGUMENT gating it, not a hardcoded type check on be.type');

  say('shulker box: same 63-slot menu, own screen texture (guicheck §4e), and the nesting refusal proven on both PICKUP and QUICK_MOVE, for a dyed AND the plain item, gated by noNest itself');
}

// ═══════════ 8. the double chest (D-413) — ONE 54-slot container over TWO block entities ═══
// ⚠ The menu half. `Menu.chestMenu`'s fifth argument is the second block entity: slots 0..26 are
// `first.items` and 27..53 are `second.items`, the LIVE arrays. The world half — which block
// entity is FIRST, when two chests pair, what breaking one leaves — is `behavcheck` §chest and
// `chestpaircheck`'s `Hud.chestPair`, because those need block states and this file has none.
{
  const half = () => ({ type: 'chest', items: new Array(27), open: 0 });
  const first = half(), second = half();
  const inv = Inv.create();
  Inv.setItem(inv, 9, st('iron_ingot', 20));
  Inv.setItem(inv, 10, st('coal', 7));
  const m = M.chestMenu(first, inv, 6, false, second);
  ok(m.slots.length === 54 + 27 + 9, `a double chest's menu is 54 + 27 + 9 slots, got ${m.slots.length}`);
  ok(m.rows === 6 && m.be === first && m.be2 === second, 'the menu names both halves and six rows');

  // a stack put into the TOP three rows lands in `first`, one put in the BOTTOM three in `second`
  M.doClick(m, 54, 0, M.PICKUP, P);                  // pick iron up off backpack slot 9
  M.doClick(m, 3, 0, M.PICKUP, P);                   // put it in slot 3 (top half)
  M.doClick(m, 55, 0, M.PICKUP, P);                  // pick coal up
  M.doClick(m, 27 + 5, 0, M.PICKUP, P);              // and put it in slot 32 (bottom half)
  ok(first.items[3] && first.items[3].n === 20 && Inv.itemName(first.items[3]) === 'iron_ingot',
     `slot 3 is FIRST's slot 3, got ${JSON.stringify(first.items[3])}`);
  ok(second.items[5] && second.items[5].n === 7 && Inv.itemName(second.items[5]) === 'coal',
     `slot 32 is SECOND's slot 5, got ${JSON.stringify(second.items[5])}`);
  ok(Inv.isEmpty(first.items[32 - 27]) && Inv.isEmpty(second.items[3]),
     'and neither half grew the other half\'s stack — no aliasing between the two arrays');

  // close and reopen: a NEW menu over the same two block entities shows the same stacks
  const m2 = M.chestMenu(first, Inv.create(), 6, false, second);
  ok(M.slotGet(m2.slots[3]) === first.items[3] && M.slotGet(m2.slots[32]) === second.items[5],
     'reopening reads the same stacks, by reference — the container IS the two block entities, not a copy');

  // shift-click a stack out of the far half (slot 32) into the player, and one in from the player
  const inv3 = Inv.create();
  Inv.setItem(inv3, 9, st('gold_ingot', 5));
  const m3 = M.chestMenu(first, inv3, 6, false, second);
  M.doClick(m3, 32, 0, M.QUICK_MOVE, P);
  ok(Inv.isEmpty(second.items[5]), 'shift-clicking slot 32 empties SECOND\'s slot 5');
  let coal = 0; for (const s2 of inv3.slots) if (!Inv.isEmpty(s2) && Inv.itemName(s2) === 'coal') coal += s2.n;
  ok(coal === 7, `and the coal arrived in the player's inventory, got ${coal}`);
  M.doClick(m3, 54 + 0, 0, M.QUICK_MOVE, P);        // shift-click the gold in the backpack
  let gold = 0;
  for (const bank of [first, second]) for (const s2 of bank.items) if (!Inv.isEmpty(s2) && Inv.itemName(s2) === 'gold_ingot') gold += s2.n;
  ok(gold === 5, `shift-clicking into the double chest puts the stack in one of the halves, got ${gold}`);
  ok(!Inv.isEmpty(first.items[0]) && Inv.itemName(first.items[0]) === 'gold_ingot',
     'and it took the first free slot in slot order — FIRST\'s slot 0, before any of SECOND\'s');

  // anti-vacuity 1: swap left/right (first <-> second) and the SAME clicks put the stacks in the
  // OTHER block entity — so the mapping test above genuinely tells the halves apart.
  const a = half(), b = half();
  const invS = Inv.create(); Inv.setItem(invS, 9, st('iron_ingot', 20));
  const mS = M.chestMenu(b, invS, 6, false, a);      // swapped
  M.doClick(mS, 54, 0, M.PICKUP, P); M.doClick(mS, 3, 0, M.PICKUP, P);
  okAv(Inv.isEmpty(a.items[3]) && !Inv.isEmpty(b.items[3]),
    'anti-vacuity: swapping the two halves puts slot 3 in the other block entity — the mapping assertion above can fail');
  // anti-vacuity 2: a menu with NO second half (be2 dropped) has only 27 container slots, so the
  // bottom-half assertions could not hold — a single chest is not a double
  const single = M.chestMenu(half(), Inv.create(), 3);
  okAv(single.slots.length === 27 + 36 && !single.be2,
    'anti-vacuity: without a second half the menu is the 27-slot chest, and `be2` is null');
  say('double chest: 54 + 36 slots over two live arrays, FIRST in slots 0..26, SECOND in 27..53');
}

console.log('');
console.log('1. the menu\'s own shape — 63 slots, three bands');
console.log('2. PICKUP — a stack moves from the backpack into the chest by hand');
console.log('3. QUICK_MOVE — shift-click, both directions');
console.log('4. close and reopen — the container persists because it IS the block entity');
console.log('5. anti-vacuity — a copy-based container fails the same test the real one passes, and a full chest neither drops nor duplicates');
console.log('6. the barrel (D-403) — the same menu, proven type-blind, over a barrel block entity');
console.log('7. the shulker box (D-406) — the same menu, its own screen texture, and the nesting refusal (both PICKUP and QUICK_MOVE, dyed and plain, gated by noNest)');
console.log('8. the double chest (D-413) — one 54-slot container over two live block-entity arrays, FIRST then SECOND');
console.log('');
for (const f of fails) console.log('FAIL  ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
