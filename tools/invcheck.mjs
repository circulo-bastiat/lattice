#!/usr/bin/env node
// invcheck.mjs — PLAN G8, part one. The item stack and the inventory's search order.
//
//   node tools/invcheck.mjs [--verbose]
//
// ⚠ THE SEARCH ORDER IS THE WHOLE POINT OF THIS FILE. Picking an item up is not "put it in the
// first slot with room": `Inventory.getSlotWithRemainingSpace` asks the SELECTED slot first, then
// the OFFHAND at index 40, and only then scans 0..35 — read out of the 1.18.2 bytecode (D-261).
// No count can see that rule. It decides which of two identical partial stacks grows when you
// walk over a dropped item, and it is exactly the sort of thing a clone gets wrong for years.

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
const IT = NS.Items, Inv = NS.Inventory;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };
const st = (n, c, d) => Inv.stack(n, c, d);

console.log('invcheck — PLAN G8, the stack and the inventory (D-261)');

// ═══════════════ 1. the stack ══════════════════════════════════════════════════════════════
{
  ok(IT.ready && IT.count > 1000, `the item table must be loaded, count ${IT.count}`);
  const dirt = st('dirt', 10);
  ok(dirt && dirt.n === 10 && Inv.itemName(dirt) === 'dirt', 'a stack knows its item and its count');
  ok(Inv.stack('dirt', 0) === Inv.EMPTY, 'a zero-count stack IS empty, not a stack of nothing');
  ok(Inv.stack('not_a_real_item', 5) === Inv.EMPTY, 'an unknown item makes no stack');
  ok(Inv.maxStackSize(st('dirt', 1)) === 64 && Inv.maxStackSize(st('diamond_sword', 1)) === 1,
     'stack sizes come from the item table, not from a guess');
  ok(Inv.maxStackSize(st('ender_pearl', 1)) === 16, "an ender pearl's stack is 16");
  ok(Inv.isStackable(st('dirt', 1)) && !Inv.isStackable(st('diamond_sword', 1)),
     'a sword is not stackable and dirt is');
  ok(!Inv.isStackable(st('diamond_sword', 1, 40)), 'and a DAMAGED tool is not stackable either');
  ok(Inv.isSameItemSameTags(st('dirt', 1), st('dirt', 5)), 'two stacks of dirt are the same item');
  ok(!Inv.isSameItemSameTags(st('dirt', 1), st('stone', 1)), 'dirt and stone are not');
  ok(!Inv.isSameItemSameTags(st('diamond_sword', 1, 0), st('diamond_sword', 1, 5)),
     'the same tool at different damage does not stack — damage is the only tag MC-Lite has');
  const s = st('dirt', 10), taken = Inv.split(s, 4);
  ok(taken.n === 4 && s.n === 6, `split(4) of 10 should leave 6 and hand back 4, got ${s.n}/${taken.n}`);
  ok(Inv.split(st('dirt', 3), 9).n === 3, 'splitting more than there is takes what there is');
  say('stack: sizes, stackability, damage as the only tag');
}

// ═══════════════ 2. THE SEARCH ORDER — selected, then offhand, then the scan ═══════════════
{
  // three identical partial stacks: slot 0, the selected slot 4, and the offhand. Vanilla fills
  // the SELECTED one first. A "first slot with room" implementation fills slot 0 and looks right.
  const inv = Inv.create();
  inv.selected = 4;
  Inv.setItem(inv, 0, st('dirt', 10));
  Inv.setItem(inv, 4, st('dirt', 10));
  Inv.setItem(inv, Inv.OFFHAND, st('dirt', 10));
  const left = Inv.add(inv, st('dirt', 5));
  ok(left === 0, 'five dirt must fit somewhere');
  ok(Inv.getItem(inv, 4).n === 15,
     `the SELECTED slot fills first: expected 15 there, got ${Inv.getItem(inv, 4).n}`);
  ok(Inv.getItem(inv, 0).n === 10 && Inv.getItem(inv, Inv.OFFHAND).n === 10,
     'and nothing else moved');

  // fill the selected slot to the top: the OFFHAND is next, before the scan
  const inv2 = Inv.create();
  inv2.selected = 4;
  Inv.setItem(inv2, 0, st('dirt', 10));
  Inv.setItem(inv2, 4, st('dirt', 64));
  Inv.setItem(inv2, Inv.OFFHAND, st('dirt', 10));
  Inv.add(inv2, st('dirt', 5));
  ok(Inv.getItem(inv2, Inv.OFFHAND).n === 15,
     `with the selected slot full the OFFHAND is next: expected 15, got ${Inv.getItem(inv2, Inv.OFFHAND).n}`);
  ok(Inv.getItem(inv2, 0).n === 10, 'and the scan still has not run');

  // both full: NOW it scans, and takes the lowest index with room
  const inv3 = Inv.create();
  inv3.selected = 4;
  Inv.setItem(inv3, 0, st('dirt', 64));
  Inv.setItem(inv3, 1, st('dirt', 10));
  Inv.setItem(inv3, 2, st('dirt', 10));
  Inv.setItem(inv3, 4, st('dirt', 64));
  Inv.setItem(inv3, Inv.OFFHAND, st('dirt', 64));
  Inv.add(inv3, st('dirt', 5));
  ok(Inv.getItem(inv3, 1).n === 15 && Inv.getItem(inv3, 2).n === 10,
     'the scan takes the lowest index with room, and slot 0 is full so slot 1 gets it');
  say('search order: selected -> offhand(40) -> scan 0..35');
}

// ═══════════════ 3. spilling across slots, and what is left over ══════════════════════════
{
  const inv = Inv.create();
  const leftover = Inv.add(inv, st('dirt', 100));
  ok(leftover === 0, `100 dirt must fit in an empty inventory, ${leftover} left over`);
  ok(Inv.getItem(inv, 0).n === 64 && Inv.getItem(inv, 1).n === 36,
     `it must fill one stack then start another: got ${Inv.getItem(inv, 0).n}/${Inv.getItem(inv, 1) && Inv.getItem(inv, 1).n}`);
  ok(Inv.countOf(inv, 'dirt') === 100, 'and the total is still 100');

  // a 16-stack item respects ITS OWN size, not the inventory's 64
  const inv2 = Inv.create();
  Inv.add(inv2, st('ender_pearl', 20));
  ok(Inv.getItem(inv2, 0).n === 16 && Inv.getItem(inv2, 1).n === 4,
     'an ender pearl stacks to 16, not to 64');

  // a full inventory hands the remainder back rather than eating it
  const full = Inv.create();
  for (let i = 0; i < Inv.MAIN; i++) Inv.setItem(full, i, st('stone', 64));
  const back = Inv.add(full, st('dirt', 7));
  ok(back === 7, `a full inventory must hand all 7 back, it kept ${7 - back}`);
  ok(Inv.countOf(full, 'dirt') === 0, 'and must not have taken any');

  // ⚠ armour and the offhand are not FREE space: a free slot is a MAIN slot
  const armourOnly = Inv.create();
  for (let i = 0; i < Inv.MAIN; i++) Inv.setItem(armourOnly, i, st('stone', 64));
  ok(Inv.getFreeSlot(armourOnly) === -1,
     'with 0..35 full there is no free slot, even though 36..40 are empty');
  say('spilling: 100 dirt -> 64 + 36, ender pearls 16 + 4, a full inventory gives it back');
}

// ═══════════════ 4. tools, damage and the not-stackable path ══════════════════════════════
{
  const inv = Inv.create();
  Inv.add(inv, st('diamond_sword', 1));
  Inv.add(inv, st('diamond_sword', 1));
  ok(Inv.getItem(inv, 0).n === 1 && Inv.getItem(inv, 1).n === 1,
     'two swords take two slots, because a sword is not stackable');
  const inv2 = Inv.create();
  Inv.setItem(inv2, 0, st('diamond_sword', 1, 100));
  Inv.add(inv2, st('diamond_sword', 1, 0));
  ok(Inv.getItem(inv2, 1) && Inv.getItem(inv2, 1).n === 1,
     'a fresh sword does not merge into a damaged one');
  say('tools: never stack, and damage keeps them apart');
}

// ═══════════════ 5. removing, counting, finding ═══════════════════════════════════════════
{
  const inv = Inv.create();
  Inv.setItem(inv, 3, st('dirt', 10));
  const out = Inv.removeItem(inv, 3, 4);
  ok(out.n === 4 && Inv.getItem(inv, 3).n === 6, 'removeItem takes what you asked for');
  const rest = Inv.removeItem(inv, 3, 99);
  ok(rest.n === 6 && Inv.getItem(inv, 3) === Inv.EMPTY,
     'taking more than there is empties the slot rather than leaving a zero stack');
  ok(Inv.removeItem(inv, 3, 1) === Inv.EMPTY, 'and an empty slot gives nothing');
  const inv2 = Inv.create();
  Inv.setItem(inv2, 2, st('dirt', 5));
  Inv.setItem(inv2, 7, st('dirt', 3));
  Inv.setItem(inv2, Inv.OFFHAND, st('dirt', 2));
  ok(Inv.countOf(inv2, 'dirt') === 10, `count must span every slot including the offhand, got ${Inv.countOf(inv2, 'dirt')}`);
  ok(Inv.findSlot(inv2, 'dirt') === 2 && Inv.findSlot(inv2, 'stone') === -1, 'findSlot finds the first, and admits when there is none');
}

// ═══════════════ 6. the block items a hotbar actually holds ═══════════════════════════════
{
  // G8 exists so a slot can hold an ITEM; what the world needs back is the STATE it places.
  const s = st('stone', 1);
  ok(IT.isBlock(s.i) && IT.stateOf(s.i) >= 0, 'a block item knows the state it places (D-260)');
  ok(!IT.isBlock(st('apple', 1).i) && IT.stateOf(st('apple', 1).i) === -1, 'and food places nothing');
  ok(IT.isEdible(st('apple', 1).i) && IT.nutrition[st('apple', 1).i] === 4, 'and food knows what it is worth');
}

// ═══════════════ 7. doClick — PICKUP, and the half-stack rule ═════════════════════════════
// ⚠ EVERYTHING FROM HERE DOWN IS THE CLICK HALF (D-265), and it is scripted CLICK SEQUENCES
// rather than calls to one function, because the bugs in a slot machine live between clicks.
const M = NS.Menu;
// ⚠ `instabuild`, not `creative`: G6 (D-253) deleted that boolean, and `modecheck` scans for it.
const mkPlayer = (creative) => { const inv = Inv.create(); return { instabuild: !!creative, inventory: inv }; };
const mkMenu = (creative) => { const p = mkPlayer(creative); return { m: M.playerMenu(p.inventory, p), p, inv: p.inventory }; };
// menu-slot helpers, so a test reads like a player: hotbar 0 is menu slot 36.
const HOT = (i) => 36 + i;
const BACK = (i) => 9 + i;
const OFFHAND = 45;
const ARMOUR = (i) => 5 + i;
const at = (m, i) => M.slotGet(m.slots[i]);
const cnt = (x) => (Inv.isEmpty(x) ? 0 : x.n);
const nameAt = (m, i) => Inv.itemName(at(m, i));
const carriedName = (m) => Inv.itemName(M.getCarried(m));

{
  const { m, p } = mkMenu(false);
  M.slotSet(m.slots[HOT(0)], st('stone', 64));
  M.doClick(m, HOT(0), 0, M.PICKUP, p);
  ok(carriedName(m) === 'stone' && cnt(M.getCarried(m)) === 64, 'left-click takes the whole stack');
  ok(cnt(at(m, HOT(0))) === 0, 'and the slot is empty');

  M.doClick(m, HOT(1), 0, M.PICKUP, p);
  ok(cnt(at(m, HOT(1))) === 64 && Inv.isEmpty(M.getCarried(m)), 'left-click puts the whole stack down');

  // ⚠ RIGHT-CLICK TAKES THE LARGER HALF: (n + 1) / 2, integer. Five gives three, not two.
  M.slotSet(m.slots[HOT(2)], st('stone', 5));
  M.doClick(m, HOT(2), 1, M.PICKUP, p);
  ok(cnt(M.getCarried(m)) === 3, 'right-click takes (n+1)/2 — three of five');
  ok(cnt(at(m, HOT(2))) === 2, 'and leaves two');

  M.doClick(m, HOT(3), 1, M.PICKUP, p);
  ok(cnt(at(m, HOT(3))) === 1 && cnt(M.getCarried(m)) === 2, 'right-click puts down exactly one');

  // a different item in the slot is a SWAP, not a merge
  M.slotSet(m.slots[HOT(4)], st('dirt', 10));
  M.doClick(m, HOT(4), 0, M.PICKUP, p);
  ok(carriedName(m) === 'dirt' && cnt(M.getCarried(m)) === 10, 'clicking a different item swaps it into the hand');
  ok(nameAt(m, HOT(4)) === 'stone' && cnt(at(m, HOT(4))) === 2, 'and what was held goes into the slot');

  // merging into a partial stack of the same item respects the item cap
  const { m: m2, p: p2 } = mkMenu(false);
  M.slotSet(m2.slots[HOT(0)], st('stone', 60));
  M.setCarried(m2, st('stone', 10));
  M.doClick(m2, HOT(0), 0, M.PICKUP, p2);
  ok(cnt(at(m2, HOT(0))) === 64, 'merging fills the slot to the stack size');
  ok(cnt(M.getCarried(m2)) === 6, 'and the remainder stays in the hand');

  // ⚠ the ITEM's cap, not the container's — an ender pearl stops at 16
  const { m: m3, p: p3 } = mkMenu(false);
  M.setCarried(m3, st('ender_pearl', 16));
  M.doClick(m3, HOT(0), 0, M.PICKUP, p3);
  ok(cnt(at(m3, HOT(0))) === 16, 'an ender pearl stack is 16, not 64');

  // dropping outside the window
  const { m: m4, p: p4 } = mkMenu(false);
  M.setCarried(m4, st('stone', 7));
  M.doClick(m4, M.OUTSIDE, 1, M.PICKUP, p4);
  ok(cnt(M.getCarried(m4)) === 6 && m4.drops.length === 1 && cnt(m4.drops[0]) === 1,
     'right-click outside drops exactly one');
  M.doClick(m4, M.OUTSIDE, 0, M.PICKUP, p4);
  ok(Inv.isEmpty(M.getCarried(m4)) && cnt(m4.drops[1]) === 6, 'left-click outside drops the rest');
}

// ═══════════════ 8. doClick — QUICK_MOVE, and the two bands ═══════════════════════════════
{
  // ⚠ THE BACKPACK SENDS TO THE HOTBAR AND THE HOTBAR SENDS TO THE BACKPACK. They are not one
  // range, and a clone that treats them as one makes shift-click a no-op half the time.
  const { m, p } = mkMenu(false);
  M.slotSet(m.slots[BACK(0)], st('stone', 64));
  M.doClick(m, BACK(0), 0, M.QUICK_MOVE, p);
  ok(cnt(at(m, BACK(0))) === 0, 'shift-clicking the backpack empties the slot');
  let inHotbar = 0;
  for (let i = 0; i < 9; i++) inHotbar += cnt(at(m, HOT(i)));
  ok(inHotbar === 64, 'and the stack arrives in the hotbar');

  const { m: m2, p: p2 } = mkMenu(false);
  M.slotSet(m2.slots[HOT(0)], st('dirt', 32));
  M.doClick(m2, HOT(0), 0, M.QUICK_MOVE, p2);
  ok(cnt(at(m2, HOT(0))) === 0, 'shift-clicking the hotbar empties the slot');
  let inBack = 0;
  for (let i = 0; i < 27; i++) inBack += cnt(at(m2, BACK(i)));
  ok(inBack === 32, 'and the stack arrives in the backpack');

  // ⚠ IT MERGES BEFORE IT TAKES AN EMPTY SLOT. One pass would scatter.
  const { m: m3, p: p3 } = mkMenu(false);
  M.slotSet(m3.slots[BACK(0)], st('stone', 40));
  M.slotSet(m3.slots[HOT(5)], st('stone', 20));
  M.doClick(m3, BACK(0), 0, M.QUICK_MOVE, p3);
  ok(cnt(at(m3, HOT(5))) === 60, 'shift-click tops up a partial stack first');
  ok(cnt(at(m3, HOT(0))) === 0, 'rather than starting a new one');

  // a full destination band leaves the source alone
  const { m: m4, p: p4 } = mkMenu(false);
  for (let i = 0; i < 9; i++) M.slotSet(m4.slots[HOT(i)], st('dirt', 64));
  M.slotSet(m4.slots[BACK(0)], st('stone', 5));
  M.doClick(m4, BACK(0), 0, M.QUICK_MOVE, p4);
  ok(cnt(at(m4, BACK(0))) === 5, 'shift-click into a full band does nothing');

  // ⚠ D-266 — THE EQUIPMENT BRANCHES, and the four items a name-suffix rule would get wrong.
  const equipCases = [
    ['iron_helmet', ARMOUR(0), 'a helmet flies to the head slot'],
    ['iron_chestplate', ARMOUR(1), 'a chestplate to the chest slot'],
    ['iron_leggings', ARMOUR(2), 'leggings to the legs slot'],
    ['iron_boots', ARMOUR(3), 'boots to the feet slot'],
    ['turtle_helmet', ARMOUR(0), 'a TURTLE helmet is still a helmet'],
    ['elytra', ARMOUR(1), 'an elytra is worn on the CHEST and is named nothing like one'],
    ['carved_pumpkin', ARMOUR(0), 'a carved pumpkin goes on your HEAD'],
    ['player_head', ARMOUR(0), 'and so does a player head'],
    ['shield', OFFHAND, 'a shield goes to the OFFHAND'],
  ];
  for (const [item, dest, what] of equipCases) {
    const { m: me, p: pe } = mkMenu(false);
    M.slotSet(me.slots[BACK(0)], st(item, 1));
    M.doClick(me, BACK(0), 0, M.QUICK_MOVE, pe);
    ok(cnt(at(me, dest)) === 1 && cnt(at(me, BACK(0))) === 0, 'shift-click: ' + what);
  }
  // ⚠ AND THE OTHER DIRECTION: an occupied armour slot is not a destination, and a plain block
  // is not equipment — a rule that sent everything to slot 5 would pass the nine cases above.
  const { m: m5, p: p5 } = mkMenu(false);
  M.slotSet(m5.slots[ARMOUR(0)], st('iron_helmet', 1));
  M.slotSet(m5.slots[BACK(0)], st('diamond_helmet', 1));
  M.doClick(m5, BACK(0), 0, M.QUICK_MOVE, p5);
  ok(Inv.itemName(at(m5, ARMOUR(0))) === 'iron_helmet', 'an occupied head slot is left alone');
  ok(cnt(at(m5, BACK(0))) === 0, 'and the second helmet goes to the hotbar instead');
  const { m: m6, p: p6 } = mkMenu(false);
  M.slotSet(m6.slots[BACK(0)], st('stone', 1));
  M.doClick(m6, BACK(0), 0, M.QUICK_MOVE, p6);
  ok(cnt(at(m6, ARMOUR(0))) === 0 && cnt(at(m6, ARMOUR(3))) === 0, 'stone is not equipment');
}

// ═══════════════ 9. doClick — SWAP, CLONE and THROW ═══════════════════════════════════════
{
  const { m, p, inv } = mkMenu(false);
  M.slotSet(m.slots[BACK(0)], st('stone', 12));
  Inv.setItem(inv, 3, st('dirt', 7));
  M.doClick(m, BACK(0), 3, M.SWAP, p);
  ok(nameAt(m, BACK(0)) === 'dirt' && cnt(at(m, BACK(0))) === 7, 'number-key swap brings the hotbar item in');
  ok(Inv.itemName(Inv.getItem(inv, 3)) === 'stone' && cnt(Inv.getItem(inv, 3)) === 12, 'and sends the slot item out');

  // swapping into an empty hotbar slot is a move
  const { m: m2, p: p2, inv: inv2 } = mkMenu(false);
  M.slotSet(m2.slots[BACK(1)], st('stone', 4));
  M.doClick(m2, BACK(1), 5, M.SWAP, p2);
  ok(cnt(at(m2, BACK(1))) === 0 && cnt(Inv.getItem(inv2, 5)) === 4, 'swapping into an empty hotbar slot moves it');

  // CLONE is creative-only, and it fills the stack
  const { m: m3, p: p3 } = mkMenu(false);
  M.slotSet(m3.slots[BACK(0)], st('stone', 3));
  M.doClick(m3, BACK(0), 2, M.CLONE, p3);
  ok(Inv.isEmpty(M.getCarried(m3)), 'middle-click does nothing in survival');
  const { m: m4, p: p4 } = mkMenu(true);
  M.slotSet(m4.slots[BACK(0)], st('stone', 3));
  M.doClick(m4, BACK(0), 2, M.CLONE, p4);
  ok(cnt(M.getCarried(m4)) === 64, 'middle-click in creative gives a full stack');
  ok(cnt(at(m4, BACK(0))) === 3, 'and leaves the original alone');
  const { m: m5, p: p5 } = mkMenu(true);
  M.slotSet(m5.slots[BACK(0)], st('ender_pearl', 1));
  M.doClick(m5, BACK(0), 2, M.CLONE, p5);
  ok(cnt(M.getCarried(m5)) === 16, 'and a full stack means the ITEM’s full stack');

  // THROW: Q drops one, ctrl-Q drops the lot
  const { m: m6, p: p6 } = mkMenu(false);
  M.slotSet(m6.slots[BACK(0)], st('stone', 9));
  M.doClick(m6, BACK(0), 0, M.THROW, p6);
  ok(cnt(at(m6, BACK(0))) === 8 && cnt(m6.drops[0]) === 1, 'Q drops one');
  M.doClick(m6, BACK(0), 1, M.THROW, p6);
  ok(cnt(at(m6, BACK(0))) === 0 && cnt(m6.drops[1]) === 8, 'ctrl-Q drops the rest');
  M.setCarried(m6, st('dirt', 1));
  const dropsBefore = m6.drops.length;
  M.doClick(m6, BACK(1), 0, M.THROW, p6);
  ok(m6.drops.length === dropsBefore, 'THROW does nothing while something is held');
}

// ═══════════════ 10. doClick — PICKUP_ALL, and why it needs two passes ════════════════════
{
  // ⚠ THE FIRST PASS SKIPS FULL STACKS. Without it a double-click empties the first full stack
  // it meets and leaves every partial one behind — the opposite of what the gesture is for.
  const { m, p } = mkMenu(false);
  M.slotSet(m.slots[BACK(0)], st('stone', 64));
  M.slotSet(m.slots[BACK(1)], st('stone', 5));
  M.slotSet(m.slots[BACK(2)], st('stone', 7));
  M.setCarried(m, st('stone', 1));
  M.doClick(m, HOT(8), 0, M.PICKUP_ALL, p);
  ok(cnt(M.getCarried(m)) === 64, 'double-click fills the hand to a full stack');
  ok(cnt(at(m, BACK(1))) === 0 && cnt(at(m, BACK(2))) === 0, 'taking the PARTIAL stacks first');
  ok(cnt(at(m, BACK(0))) === 13, 'and only then topping up from the full one');

  // a different item is not collected
  const { m: m2, p: p2 } = mkMenu(false);
  M.slotSet(m2.slots[BACK(0)], st('dirt', 20));
  M.setCarried(m2, st('stone', 1));
  M.doClick(m2, HOT(8), 0, M.PICKUP_ALL, p2);
  ok(cnt(M.getCarried(m2)) === 1 && cnt(at(m2, BACK(0))) === 20, 'double-click collects only the same item');
}

// ═══════════════ 11. doClick — QUICK_CRAFT, the drag, and its state machine ═══════════════
{
  const mask = (h, t) => M.quickCraftMask(h, t);
  ok(M.quickCraftHeader(mask(2, 1)) === 2 && M.quickCraftType(mask(2, 1)) === 1,
     'the button int packs header and type the way vanilla reads it back');

  // LEFT DRAG over three slots: the stack splits evenly, the remainder stays in hand
  const { m, p } = mkMenu(false);
  M.setCarried(m, st('stone', 7));
  M.doClick(m, -999, mask(0, 0), M.QUICK_CRAFT, p);
  M.doClick(m, BACK(0), mask(1, 0), M.QUICK_CRAFT, p);
  M.doClick(m, BACK(1), mask(1, 0), M.QUICK_CRAFT, p);
  M.doClick(m, BACK(2), mask(1, 0), M.QUICK_CRAFT, p);
  M.doClick(m, -999, mask(2, 0), M.QUICK_CRAFT, p);
  ok(cnt(at(m, BACK(0))) === 2 && cnt(at(m, BACK(1))) === 2 && cnt(at(m, BACK(2))) === 2,
     'a left drag over three slots puts two in each');
  ok(cnt(M.getCarried(m)) === 1, 'and the remainder stays in the hand');

  // RIGHT DRAG: one each
  const { m: m2, p: p2 } = mkMenu(false);
  M.setCarried(m2, st('stone', 7));
  M.doClick(m2, -999, mask(0, 1), M.QUICK_CRAFT, p2);
  M.doClick(m2, BACK(0), mask(1, 1), M.QUICK_CRAFT, p2);
  M.doClick(m2, BACK(1), mask(1, 1), M.QUICK_CRAFT, p2);
  M.doClick(m2, -999, mask(2, 1), M.QUICK_CRAFT, p2);
  ok(cnt(at(m2, BACK(0))) === 1 && cnt(at(m2, BACK(1))) === 1, 'a right drag puts one in each');
  ok(cnt(M.getCarried(m2)) === 5, 'and the rest stays in the hand');

  // ⚠ A DRAG OVER A SLOT THAT ALREADY HAS SOME TOPS IT UP rather than overwriting: the
  // `+ slotStackSize` at the end of getQuickCraftSlotCount is the whole reason.
  const { m: m3, p: p3 } = mkMenu(false);
  M.slotSet(m3.slots[BACK(0)], st('stone', 3));
  M.setCarried(m3, st('stone', 4));
  M.doClick(m3, -999, mask(0, 1), M.QUICK_CRAFT, p3);
  M.doClick(m3, BACK(0), mask(1, 1), M.QUICK_CRAFT, p3);
  M.doClick(m3, BACK(1), mask(1, 1), M.QUICK_CRAFT, p3);
  M.doClick(m3, -999, mask(2, 1), M.QUICK_CRAFT, p3);
  ok(cnt(at(m3, BACK(0))) === 4, 'a right drag over a slot holding three makes it four');
  ok(cnt(at(m3, BACK(1))) === 1, 'and the empty slot gets one');
  ok(cnt(M.getCarried(m3)) === 2, 'leaving two in hand');

  // MIDDLE drag is creative only
  const { m: m4, p: p4 } = mkMenu(false);
  M.setCarried(m4, st('stone', 2));
  M.doClick(m4, -999, mask(0, 2), M.QUICK_CRAFT, p4);
  M.doClick(m4, BACK(0), mask(1, 2), M.QUICK_CRAFT, p4);
  M.doClick(m4, -999, mask(2, 2), M.QUICK_CRAFT, p4);
  ok(cnt(at(m4, BACK(0))) === 0 && cnt(M.getCarried(m4)) === 2, 'a middle drag does nothing in survival');
  const { m: m5, p: p5 } = mkMenu(true);
  M.setCarried(m5, st('stone', 2));
  M.doClick(m5, -999, mask(0, 2), M.QUICK_CRAFT, p5);
  M.doClick(m5, BACK(0), mask(1, 2), M.QUICK_CRAFT, p5);
  M.doClick(m5, BACK(1), mask(1, 2), M.QUICK_CRAFT, p5);
  M.doClick(m5, -999, mask(2, 2), M.QUICK_CRAFT, p5);
  ok(cnt(at(m5, BACK(0))) === 64 && cnt(at(m5, BACK(1))) === 64,
     'a middle drag in creative fills every slot it crosses');

  // ⚠ A ONE-SLOT DRAG IS A CLICK, with the drag's TYPE as the button — so a one-slot RIGHT drag
  // puts down exactly one, not "all of it split one way".
  const { m: m6, p: p6 } = mkMenu(false);
  M.setCarried(m6, st('stone', 9));
  M.doClick(m6, -999, mask(0, 1), M.QUICK_CRAFT, p6);
  M.doClick(m6, BACK(0), mask(1, 1), M.QUICK_CRAFT, p6);
  M.doClick(m6, -999, mask(2, 1), M.QUICK_CRAFT, p6);
  ok(cnt(at(m6, BACK(0))) === 1 && cnt(M.getCarried(m6)) === 8,
     'a one-slot right drag puts down exactly one');

  // THE STATE MACHINE: an out-of-order message resets, and nothing is written
  const { m: m7, p: p7 } = mkMenu(false);
  M.setCarried(m7, st('stone', 8));
  M.doClick(m7, -999, mask(0, 0), M.QUICK_CRAFT, p7);
  M.doClick(m7, BACK(0), mask(1, 0), M.QUICK_CRAFT, p7);
  M.doClick(m7, -999, mask(0, 0), M.QUICK_CRAFT, p7);   // a second BEGIN mid-drag
  M.doClick(m7, -999, mask(2, 0), M.QUICK_CRAFT, p7);
  ok(cnt(at(m7, BACK(0))) === 0, 'a repeated BEGIN resets the drag and writes nothing');
  ok(cnt(M.getCarried(m7)) === 8, 'and the hand is untouched');

  // an ordinary click while a drag is live cancels it and does nothing else
  const { m: m8, p: p8 } = mkMenu(false);
  M.setCarried(m8, st('stone', 8));
  M.doClick(m8, -999, mask(0, 0), M.QUICK_CRAFT, p8);
  M.doClick(m8, BACK(0), mask(1, 0), M.QUICK_CRAFT, p8);
  M.doClick(m8, BACK(1), 0, M.PICKUP, p8);
  ok(cnt(at(m8, BACK(1))) === 0 && cnt(M.getCarried(m8)) === 8,
     'a PICKUP during a drag cancels the drag and places nothing');

  // dragging with an empty hand resets immediately
  const { m: m9, p: p9 } = mkMenu(false);
  M.doClick(m9, -999, mask(0, 0), M.QUICK_CRAFT, p9);
  ok(m9.qcStatus === 0, 'a drag begun with an empty hand resets at once');
}

// ═══════════════ 12. the menu's shape, and the slots that refuse ══════════════════════════
{
  const { m } = mkMenu(false);
  ok(m.slots.length === 46, 'the player menu has 46 slots');
  ok(m.slots[0].noDrag === true, 'the crafting result refuses a drag');
  ok(M.slotMayPlace(m.slots[0], st('stone', 1)) === false, 'and refuses to be filled by hand');
  for (let i = 0; i < 4; i++) ok(m.slots[ARMOUR(i)].cap === 1, `armour slot ${i} holds one item`);
  // menu 5..8 are the inventory's 39..36 — head first on screen, feet first in storage
  ok(m.slots[ARMOUR(0)].index === 39 && m.slots[ARMOUR(3)].index === 36,
     'the armour band is reversed against the inventory (head is menu 5, inventory 39)');
  ok(m.slots[HOT(0)].index === 0 && m.slots[BACK(0)].index === 9 && m.slots[OFFHAND].index === 40,
     'the hotbar, the backpack and the offhand land on the right inventory indices');
  for (let i = 0; i < m.slots.length; i++) ok(m.slots[i].menuIndex === i, `slot ${i} knows its menu index`);
}

// ═══════════════ 7. ANTI-VACUITY ══════════════════════════════════════════════════════════
{
  // 1. the three search candidates must be DISTINGUISHABLE — if selected were 0, §2 would pass
  //    under a "first slot with room" implementation and prove nothing
  {
    const inv = Inv.create();
    inv.selected = 4;
    Inv.setItem(inv, 0, st('dirt', 10));
    Inv.setItem(inv, 4, st('dirt', 10));
    const firstWithRoom = 0;
    const vanilla = Inv.getSlotWithRemainingSpace(inv, st('dirt', 1));
    okAv(vanilla !== firstWithRoom && vanilla === 4,
       'anti-vacuity: the selected slot and the first slot with room must be different slots');
  }
  // 2. and the offhand must beat the scan, not merely be searched at all
  {
    const inv = Inv.create();
    inv.selected = 4;
    Inv.setItem(inv, 0, st('dirt', 10));
    Inv.setItem(inv, Inv.OFFHAND, st('dirt', 10));
    okAv(Inv.getSlotWithRemainingSpace(inv, st('dirt', 1)) === Inv.OFFHAND,
       'anti-vacuity: with the selected slot empty, 40 must win over slot 0');
  }
  // 3. the item table must really be supplying the sizes
  okAv(Inv.maxStackSize(st('ender_pearl', 1)) !== Inv.maxStackSize(st('dirt', 1)),
     'anti-vacuity: two items must have different stack sizes, or §1 tests a constant');
  // 4. a full inventory must be reachable — otherwise §3's leftover case never runs
  {
    const full = Inv.create();
    for (let i = 0; i < Inv.MAIN; i++) Inv.setItem(full, i, st('stone', 64));
    okAv(Inv.getFreeSlot(full) === -1 && Inv.getSlotWithRemainingSpace(full, st('dirt', 1)) === -1,
       'anti-vacuity: a full inventory must actually refuse both searches');
  }
  // 5. damage must change stackability, or §4 is asserting an accident
  okAv(Inv.isStackable(st('diamond_sword', 1)) === false && Inv.isStackable(st('dirt', 1)) === true,
     'anti-vacuity: stackability must vary by item');
  // 6. and the storage half must not silently create matter
  {
    const inv = Inv.create();
    const s = st('dirt', 200);
    const before = s.n;
    const left = Inv.add(inv, s);
    okAv(Inv.countOf(inv, 'dirt') + left === before,
       'anti-vacuity: everything put in plus everything handed back must equal what arrived');
  }
}

// ═══════════════ 13b. ANTI-VACUITY FOR THE CLICK HALF ════════════════════════════════════
// ⚠ The sections above are click SEQUENCES against live code, so they cannot be made vacuous by
// breaking a data file the way §13 does. They are made vacuous by a rule that is WRONG IN A WAY
// THE SEQUENCE STILL PASSES — so each break here re-runs the same sequence against the wrong
// rule and asserts the expectation would have failed. If one of these stops failing, the
// assertion it guards has stopped meaning anything.
{
  const saveType = M.quickCraftType, saveHeader = M.quickCraftHeader;
  const saveInsert = M.safeInsert, saveMove = M.moveItemStackTo;

  // 1. the header/type swap — the exact mistake session 9 made writing this file
  M.quickCraftType = (i) => i & 3;
  M.quickCraftHeader = (i) => (i >> 2) & 3;
  let broke = false;
  try {
    const p = mkPlayer(false), m = M.playerMenu(p.inventory, p);
    M.setCarried(m, st('stone', 7));
    const mk = (h, t) => M.quickCraftMask(h, t);
    M.doClick(m, -999, mk(0, 0), M.QUICK_CRAFT, p);
    M.doClick(m, BACK(0), mk(1, 0), M.QUICK_CRAFT, p);
    M.doClick(m, BACK(1), mk(1, 0), M.QUICK_CRAFT, p);
    M.doClick(m, BACK(2), mk(1, 0), M.QUICK_CRAFT, p);
    M.doClick(m, -999, mk(2, 0), M.QUICK_CRAFT, p);
    broke = !(cnt(at(m, BACK(0))) === 2 && cnt(at(m, BACK(1))) === 2 && cnt(at(m, BACK(2))) === 2);
  } catch (e) { broke = true; }
  M.quickCraftType = saveType; M.quickCraftHeader = saveHeader;
  okAv(broke, 'anti-vacuity: the quick-craft header and type read the wrong way round');

  // 2. right-click taking the SMALLER half — n/2 instead of (n+1)/2
  {
    const p = mkPlayer(false), m = M.playerMenu(p.inventory, p);
    M.slotSet(m.slots[BACK(0)], st('stone', 5));
    M.doClick(m, BACK(0), 1, M.PICKUP, p);
    const right = cnt(M.getCarried(m));
    okAv(right === 3 && (5 / 2 | 0) !== 3,
         'anti-vacuity: the half-stack rule is (n+1)/2 and n/2 would give a different answer');
  }

  // 3. moveItemStackTo with the MERGE PASS REMOVED — shift-click would scatter
  M.moveItemStackTo = function (m, stack, start, end, reverse) {
    // the second pass only: take the first empty slot
    const i0 = reverse ? end - 1 : start, step = reverse ? -1 : 1;
    for (let i = i0; i >= start && i < end; i += step) {
      const sl = m.slots[i];
      if (Inv.isEmpty(M.slotGet(sl)) && M.slotMayPlace(sl, stack)) {
        M.slotSet(sl, Inv.split(stack, Math.min(stack.n, M.slotMaxStack(sl, stack))));
        return true;
      }
    }
    return false;
  };
  {
    const p = mkPlayer(false), m = M.playerMenu(p.inventory, p);
    M.slotSet(m.slots[BACK(0)], st('stone', 40));
    M.slotSet(m.slots[HOT(5)], st('stone', 20));
    M.doClick(m, BACK(0), 0, M.QUICK_MOVE, p);
    okAv(cnt(at(m, HOT(5))) !== 60,
         'anti-vacuity: shift-click without its merge pass scatters instead of topping up');
  }
  M.moveItemStackTo = saveMove;

  // 4. safeInsert ignoring the ITEM's cap — ender pearls would reach 64
  M.safeInsert = function (sl, stack, count) {
    const here = M.slotGet(sl);
    const room = sl.cap - (Inv.isEmpty(here) ? 0 : here.n);
    const n = Math.min(Math.min(count, stack.n), room);
    if (n <= 0) return stack;
    if (Inv.isEmpty(here)) M.slotSet(sl, Inv.split(stack, n));
    else { stack.n -= n; here.n += n; M.slotSet(sl, here); }
    return stack;
  };
  {
    const p = mkPlayer(false), m = M.playerMenu(p.inventory, p);
    M.setCarried(m, st('ender_pearl', 40));
    M.doClick(m, BACK(0), 0, M.PICKUP, p);
    okAv(cnt(at(m, BACK(0))) !== 16,
         'anti-vacuity: a slot cap that ignores the item would hold 40 ender pearls');
  }
  M.safeInsert = saveInsert;

  // 5. the one-slot drag treated as a drag rather than a click
  {
    const p = mkPlayer(false), m = M.playerMenu(p.inventory, p);
    M.setCarried(m, st('stone', 9));
    const mk = (h, t) => M.quickCraftMask(h, t);
    M.doClick(m, -999, mk(0, 1), M.QUICK_CRAFT, p);
    M.doClick(m, BACK(0), mk(1, 1), M.QUICK_CRAFT, p);
    M.doClick(m, -999, mk(2, 1), M.QUICK_CRAFT, p);
    // a "one each over one slot" drag and a one-slot right CLICK agree at 1; the break is the
    // OTHER reading — that a one-slot drag of type 0 would dump the whole stack.
    const p2 = mkPlayer(false), m2 = M.playerMenu(p2.inventory, p2);
    M.setCarried(m2, st('stone', 9));
    M.doClick(m2, -999, mk(0, 0), M.QUICK_CRAFT, p2);
    M.doClick(m2, BACK(0), mk(1, 0), M.QUICK_CRAFT, p2);
    M.doClick(m2, -999, mk(2, 0), M.QUICK_CRAFT, p2);
    okAv(cnt(at(m, BACK(0))) === 1 && cnt(at(m2, BACK(0))) === 9,
         'anti-vacuity: a one-slot drag is a CLICK, so its TYPE decides — one for right, all for left');
  }

  // 6. the state machine without its reset — a stale drag would keep writing
  {
    const p = mkPlayer(false), m = M.playerMenu(p.inventory, p);
    M.setCarried(m, st('stone', 8));
    const mk = (h, t) => M.quickCraftMask(h, t);
    M.doClick(m, -999, mk(0, 0), M.QUICK_CRAFT, p);
    M.doClick(m, BACK(0), mk(1, 0), M.QUICK_CRAFT, p);
    M.doClick(m, BACK(1), 0, M.PICKUP, p);          // cancels
    const after = m.qcStatus;
    M.doClick(m, -999, mk(2, 0), M.QUICK_CRAFT, p); // the END that a stale machine would honour
    okAv(after === 0 && cnt(at(m, BACK(0))) === 0,
         'anti-vacuity: a cancelled drag cannot be finished by a later END');
  }
}

console.log('');
console.log('1. the stack: sizes from the item table, damage as the only tag');
console.log('2. the search order — selected, then the OFFHAND at 40, then the scan');
console.log('3. spilling across slots, and the remainder a full inventory hands back');
console.log('4. tools never stack, and damage keeps them apart');
console.log('5. removing, counting and finding across all 41 slots');
console.log('6. a block item still knows the state it places (D-260)');
console.log('7. doClick — PICKUP, and the half-stack rule (D-265)');
console.log('8. doClick — QUICK_MOVE, and the two bands');
console.log('9. doClick — SWAP, CLONE and THROW');
console.log('10. doClick — PICKUP_ALL, and why it needs two passes');
console.log('11. doClick — QUICK_CRAFT, the drag, and its state machine');
console.log('12. the menu\'s shape, and the slots that refuse');
console.log('13. anti-vacuity — the ways the rules above could be vacuous');
console.log('13b. anti-vacuity for the click half — each break re-runs a real sequence');
console.log('');
for (const f of fails) console.log('FAIL  ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
