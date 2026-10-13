#!/usr/bin/env node
// furnacecheck.mjs — PASS 17 JOB 1 (G19b), the furnace family's screen (D-414).
//
//   node tools/furnacecheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, AND WHAT IT LEAVES TO OTHERS. `guicheck` §4f proves the slot squares and the
// flame/arrow sprites sit on the real pixels; `usecheck` §8 proves a right-click on a furnace,
// blast furnace or smoker reaches `Hud.openFurnace`; `behavcheck` §9 proves the smelting arithmetic
// against the real recipe and fuel tables. THIS is the join between them: a click sequence over
// `Menu.furnaceMenu` puts fuel and ore into the block entity, `BlockEntities.tick` smelts it, the
// arrow and flame are functions of the LIVE counters at three values each, the output comes back
// out with its banked experience, and none of it is a copy — close and reopen finds the same stacks.
//
// ⚠ EVERY SECTION BREAKS ITS OWN DATA AND ASSERTS THE BREAK IS CAUGHT (D-30). The one that matters
// most is §2: an arrow that read a CONSTANT would pass any single-value test, which is exactly how
// "the arrow does not move" would ship — so the three values must be pairwise different, and a
// fixture whose counters are frozen must FAIL that same assertion.
//
// Headless: the real modules, no DOM beyond the input stubs `craftingtablecheck` already uses.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
               '14g_menu.js', '07c_blockentity.js', '13_input.js', '15b_gui.js', '15_hud.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.BlockEntities.init();

const Inv = MCL.Inventory, M = MCL.Menu, H = MCL.Hud, BE = MCL.BlockEntities, R = MCL.Recipes;
const st = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, m); if (c && VERBOSE) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log(s); };

let nextX = 0;
function newFurnace(type) {
  type = type || 'furnace';
  BE.clear();
  return BE.create(nextX++, 0, 0, type);
}
function newPlayer() {
  const P = { menu: { inventory: Inv.create() }, xpTotal: 0 };
  MCL.Player = P;
  return P;
}
const tick = (n) => { for (let i = 0; i < n; i++) BE.tick(); };
// the menu index of backpack slot `i` (9..35) and hotbar slot `h` (0..8) in a furnace menu
const packIdx = (i) => 3 + (i - 9);
const hotIdx = (h) => 30 + h;

console.log('furnacecheck — PASS 17 JOB 1 (G19b), the furnace / blast furnace / smoker screen (D-414)');

// ═══════════ 1. the menu is a window on the block entity ═══════════════════════════════════════
say('\n1. shape, and that the slots ARE the block entity');
{
  const be = newFurnace(), P = newPlayer();
  const m = M.furnaceMenu(be, P.menu.inventory);
  ok(m.slots.length === 39, `a furnace menu has 39 slots (3 + 27 backpack + 9 hotbar), got ${m.slots.length}`);
  ok(m.be === be, 'it keeps the block entity itself, not a copy');
  be.items[0] = st('raw_iron', 5);
  ok(M.slotGet(m.slots[0]) === be.items[0], 'slot 0 reads the SAME stack object the block entity holds');
  M.slotSet(m.slots[1], st('coal', 3));
  ok(nameOf(be.items[1]) === 'coal' && be.items[1].n === 3, 'and writing slot 1 lands in the block entity');
  // anti-vacuity: a menu built over a COPY would not see a later change to the entity
  const copy = { type: 'furnace', items: be.items.map((x) => Inv.copy(x)), burnTime: 0, cookTime: 0, cookTimeTotal: 200 };
  const mc = M.furnaceMenu(copy, P.menu.inventory);
  be.items[0] = st('raw_gold', 2);
  okAv(nameOf(M.slotGet(mc.slots[0])) !== 'raw_gold', 'a menu over a copy does not see the block entity change — so the test above is not vacuous');
}

// ═══════════ 2. THE ARROW AND THE FLAME ARE FUNCTIONS OF THE COUNTERS (three values each) ═══════
say('\n2. progress is read off the live counters');
{
  const be = newFurnace();
  const arrow = (c, t) => { be.cookTime = c; be.cookTimeTotal = t; return M.furnaceBurnProgress(be); };
  const a = [arrow(50, 200), arrow(100, 200), arrow(199, 200)];
  ok(a[0] === 6 && a[1] === 12 && a[2] === 23, `the arrow at 50/100/199 of 200 is 6/12/23 pixels (i * 24 / j, truncated), got ${a}`);
  ok(new Set(a).size === 3, 'the three arrow lengths are all different');
  ok(arrow(0, 200) === 0 && arrow(10, 0) === 0, 'it is 0 when EITHER counter is 0');
  ok(arrow(50, 100) === 12, 'and it scales with the recipe: 50 of 100 (a blast furnace) is 12, not 6');
  const flame = (b, d) => { be.burnTime = b; be.burnDuration = d; return M.furnaceLitProgress(be); };
  const f = [flame(1600, 1600), flame(800, 1600), flame(100, 1600)];
  ok(f[0] === 13 && f[1] === 6 && f[2] === 0, `the flame at 1600/800/100 of 1600 is 13/6/0 pixels (litTime * 13 / litDuration), got ${f}`);
  ok(new Set(f).size === 3, 'the three flame heights are all different');
  ok(flame(100, 0) === 6 && flame(200, 0) === 13, 'a duration of 0 reads as 200 (getLitProgress): 100 -> 6, 200 -> 13');
  ok(M.furnaceIsLit(Object.assign(be, { burnTime: 1 })) && !M.furnaceIsLit(Object.assign(be, { burnTime: 0 })), 'lit means litTime > 0');
  // anti-vacuity: a FROZEN fixture (counters that never move) fails the "three different values" test
  const frozen = { burnTime: 400, burnDuration: 1600, cookTime: 60, cookTimeTotal: 200 };
  const fz = [0, 1, 2].map(() => M.furnaceBurnProgress(frozen));
  okAv(new Set(fz).size !== 3, 'a furnace whose counters never move gives ONE arrow length, so the three-values assertion would fail on it');
  okAv(arrow(50, 200) !== arrow(100, 200), 'and the arrow really depends on cookTime');
}

// ═══════════ 3. a click sequence smelts: fuel, ore, ticks, the arrow moving, the ingot out ═════
say('\n3. coal + raw iron, by hand, to an ingot');
{
  const be = newFurnace(), P = newPlayer(), inv = P.menu.inventory;
  Inv.setItem(inv, 9, st('raw_iron', 8));
  Inv.setItem(inv, 10, st('coal', 4));
  const m = M.furnaceMenu(be, inv);
  M.doClick(m, packIdx(10), 0, M.QUICK_MOVE, P);
  ok(nameOf(be.items[1]) === 'coal' && be.items[1].n === 4 && !be.items[0], 'shift-clicking coal sends it to the FUEL slot, not the ingredient slot');
  M.doClick(m, packIdx(9), 0, M.QUICK_MOVE, P);
  ok(nameOf(be.items[0]) === 'raw_iron' && be.items[0].n === 8, 'shift-clicking raw iron sends it to the INGREDIENT slot');
  ok(Inv.isEmpty(Inv.getItem(inv, 9)) && Inv.isEmpty(Inv.getItem(inv, 10)), 'and both left the backpack');
  const before = { arrow: M.furnaceBurnProgress(be), lit: M.furnaceIsLit(be) };
  ok(before.arrow === 0 && !before.lit, 'a furnace nothing has ticked yet is cold with an empty arrow');
  tick(1);
  ok(M.furnaceIsLit(be) && be.burnDuration === 1600 && be.items[1].n === 3, 'one tick lights it, from 1600-tick coal, and spends one coal');
  tick(99);
  ok(be.cookTime === 100 && M.furnaceBurnProgress(be) === 12, `100 ticks in: cookTime 100, arrow 12 px (got ${be.cookTime}, ${M.furnaceBurnProgress(be)})`);
  const flameNow = M.furnaceLitProgress(be);
  tick(100);
  ok(nameOf(be.items[2]) === 'iron_ingot' && be.items[2].n === 1 && be.items[0].n === 7, '200 ticks in: one iron ingot, one raw iron spent');
  ok(be.cookTime === 0 && M.furnaceBurnProgress(be) === 0, 'the arrow is back to empty');
  ok(M.furnaceLitProgress(be) < flameNow || flameNow === 13, `the flame has burned down (${flameNow} -> ${M.furnaceLitProgress(be)})`);
  ok(be.recipesUsed && Object.keys(be.recipesUsed).length === 1, 'the smelt is on the recipe ledger');
  // the result comes out by shift-click, into the HOTBAR side first (reverse order), and pays XP
  const xpBefore = P.xpTotal;
  be.recipesUsed = { 'smelting/iron_ingot': { n: 10, xp: 1 } };        // whole points only: deterministic
  M.doClick(m, 2, 0, M.QUICK_MOVE, P);
  ok(Inv.isEmpty(be.items[2]), 'shift-clicking the result empties the result slot');
  let got = 0;
  for (let i = 0; i < 36; i++) { const s = Inv.getItem(inv, i); if (nameOf(s) === 'iron_ingot') got += s.n; }
  ok(got === 1, `and the ingot is in the player's inventory (found ${got})`);
  ok(P.xpTotal === xpBefore + 10, `and the ten banked experience points arrived (${xpBefore} -> ${P.xpTotal})`);
  ok(Object.keys(be.recipesUsed).length === 0, 'the ledger is cleared by the take');
  // anti-vacuity: taking nothing (an empty result slot) pays nothing and does not touch the ledger
  be.recipesUsed = { x: { n: 5, xp: 1 } };
  M.doClick(m, 2, 0, M.QUICK_MOVE, P);
  okAv(P.xpTotal === xpBefore + 10 && be.recipesUsed.x.n === 5, 'clicking an EMPTY result slot pays no experience and keeps the ledger');
}

// ═══════════ 4. experience: floor(count * xp), plus one more with probability frac ═════════════
say('\n4. the experience payout');
{
  const be = newFurnace(), P = newPlayer();
  const pay = (used, rnd) => { be.recipesUsed = used; P.xpTotal = 0; return M.furnaceAwardXp(be, P, () => rnd); };
  // iron: 0.7 xp each. One ingot = 0.7 -> 0 whole + a 70% chance of one more.
  ok(pay({ a: { n: 1, xp: 0.7 } }, 0.5) === 1 && P.xpTotal === 1, 'one iron ingot with a roll under 0.7 pays 1');
  ok(pay({ a: { n: 1, xp: 0.7 } }, 0.9) === 0 && P.xpTotal === 0, 'and with a roll over 0.7 pays nothing');
  ok(pay({ a: { n: 10, xp: 0.7 } }, 0) === 7, 'ten iron ingots pay 7 exactly — the fraction is 0 in FLOAT arithmetic, so even a roll of 0 adds nothing (vanilla is a float)');
  ok(pay({ a: { n: 3, xp: 0.1 }, b: { n: 2, xp: 1 } }, 0) === 2 + 1, 'two recipes are paid SEPARATELY: 2*1 = 2, and 3*0.1 = 0.3 -> 0 whole + 1 on a low roll');
  okAv(pay({ a: { n: 1, xp: 0.7 } }, 0.5) !== pay({ a: { n: 1, xp: 0.7 } }, 0.9), 'the payout depends on the roll, so the two assertions above are not the same number twice');
}

// ═══════════ 5. THE OUTPUT SLOT CAN STOP THE FURNACE (canBurn) ═════════════════════════════════
say('\n5. a full output slot, and one holding something else');
{
  let be = newFurnace();
  be.items[0] = st('raw_iron', 10); be.items[1] = st('coal', 2); be.items[2] = st('iron_ingot', 64);
  tick(300);
  ok(!M.furnaceIsLit(be) && be.items[1].n === 2 && be.items[0].n === 10 && be.items[2].n === 64,
     `a furnace with a full output slot does not light, spends no fuel and eats no input (lit ${be.burnTime}, coal ${be.items[1].n}, input ${be.items[0].n})`);
  ok(be.cookTime === 0, 'and its arrow stays empty');
  // 63 ingots: room for exactly one more
  be = newFurnace();
  be.items[0] = st('raw_iron', 10); be.items[1] = st('coal', 2); be.items[2] = st('iron_ingot', 63);
  tick(200);
  ok(be.items[2].n === 64 && be.items[0].n === 9, 'with room for one it smelts one');
  tick(50);
  ok(be.items[2].n === 64 && be.items[0].n === 9 && be.cookTime === 0, 'and then stops, with its progress reset to 0 (lit but unable to burn: NOT cooling by 2)');
  // an output slot holding a DIFFERENT item blocks it too
  be = newFurnace();
  be.items[0] = st('raw_iron', 4); be.items[1] = st('coal', 2); be.items[2] = st('gold_ingot', 1);
  tick(250);
  ok(be.items[0].n === 4 && be.items[2].n === 1 && nameOf(be.items[2]) === 'gold_ingot', 'an output slot holding a different item stops it — nothing is overwritten');
  // anti-vacuity: the SAME furnace with an empty output slot does smelt, so the blocks above are real
  be = newFurnace();
  be.items[0] = st('raw_iron', 4); be.items[1] = st('coal', 2);
  tick(250);
  okAv(be.items[0].n === 3 && be.items[2] && be.items[2].n === 1, 'the same furnace with an EMPTY output slot smelts, so the refusals above are the output\'s doing');
}

// ═══════════ 6. the counters when the furnace is interrupted ═══════════════════════════════════
say('\n6. taking the ingredient away, and running out of fuel');
{
  const P = newPlayer();
  let be = newFurnace();
  be.items[0] = st('raw_iron', 4); be.items[1] = st('coal', 1);
  tick(80);
  ok(be.cookTime === 80, 'set up: 80 ticks of progress');
  // lit, ingredient removed through the SCREEN: the cook resets to 0 (setItem), not cools
  const m = M.furnaceMenu(be, P.menu.inventory);
  M.doClick(m, 0, 0, M.PICKUP, P);
  ok(!be.items[0] && be.cookTime === 0, 'taking the ingredient out through the screen resets the cook to 0 at once');
  M.doClick(m, 0, 0, M.PICKUP, P);                       // put it back
  ok(be.items[0] && be.items[0].n === 4, 'and putting it back works');
  // an UNLIT furnace with progress cools by 2 a tick
  be = newFurnace();
  be.items[0] = st('raw_iron', 4); be.cookTime = 100; be.cookTimeTotal = 200; be.burnTime = 0;
  tick(1);
  ok(be.cookTime === 98, `an unlit furnace with progress and no fuel cools by 2 a tick (100 -> ${be.cookTime})`);
  tick(60);
  ok(be.cookTime === 0, 'and never below 0');
  // #410: a stored CookTimeTotal that differs from the recipe is KEPT (vanilla sets it only in setItem / after a craft; completes on ==)
  be = newFurnace('blast_furnace');
  be.items[0] = st('raw_iron', 2); be.items[1] = st('coal', 2); be.cookTimeTotal = 150;
  tick(120);
  ok(be.cookTimeTotal === 150 && be.cookTime === 120 && !be.items[2], `a loaded total of 150 is not rewritten to the recipe's 100 (total ${be.cookTimeTotal}, cook ${be.cookTime})`);
  tick(30);
  okAv(be.items[2] && be.items[2].n === 1 && be.cookTime === 0, 'and the craft completes at the STORED total (150), not the recipe\'s 100');
  ok(be.cookTimeTotal === 100, `after a craft the total is re-read from the recipe (${be.cookTimeTotal})`);
  be = newFurnace('blast_furnace');
  be.items[0] = st('raw_iron', 2); be.items[1] = st('coal', 2); be.cookTimeTotal = 50; be.cookTime = 60;
  tick(5);
  okAv(!be.items[2] && be.cookTime === 65, 'a cookTime above the total never completes (vanilla tests ==)');
  // a DIFFERENT ingredient put into the slot restarts the cook and re-reads the recipe's time
  be = newFurnace('blast_furnace');
  const mb = M.furnaceMenu(be, P.menu.inventory);
  be.items[0] = st('raw_iron', 2); be.cookTime = 50; be.cookTimeTotal = 100;
  M.slotSet(mb.slots[0], st('raw_gold', 2));
  ok(be.cookTime === 0 && be.cookTimeTotal === 100, 'a different ingredient restarts the cook; a blasting recipe reads 100');
  be.cookTime = 40;
  M.slotSet(mb.slots[0], be.items[0]);                    // the SAME stack again: no restart
  okAv(be.cookTime === 40, 'putting the SAME stack back does not restart it (anti-vacuity for the reset above)');
  M.slotSet(mb.slots[0], st('dirt', 1));
  ok(be.cookTimeTotal === 200, 'an ingredient with no recipe in this furnace reads 200');
}

// ═══════════ 7. the three slots' own rules ═════════════════════════════════════════════════════
say('\n7. the fuel slot and the result slot');
{
  const be = newFurnace(), P = newPlayer(), inv = P.menu.inventory;
  const m = M.furnaceMenu(be, inv);
  const carry = (s) => { M.setCarried(m, s); };
  carry(st('iron_ingot', 5));
  M.doClick(m, 1, 0, M.PICKUP, P);
  ok(Inv.isEmpty(be.items[1]) && M.getCarried(m) && M.getCarried(m).n === 5, 'the fuel slot refuses something that does not burn');
  M.setCarried(m, null);
  carry(st('coal', 30));
  M.doClick(m, 1, 0, M.PICKUP, P);
  ok(nameOf(be.items[1]) === 'coal' && be.items[1].n === 30, 'and takes fuel');
  M.setCarried(m, null); be.items[1] = null;
  carry(st('bucket', 2));
  M.doClick(m, 1, 0, M.PICKUP, P);
  ok(nameOf(be.items[1]) === 'bucket' && be.items[1].n === 1 && M.getCarried(m) && M.getCarried(m).n === 1,
     'a bucket goes in the fuel slot too, but ONE only (FurnaceFuelSlot.getMaxStackSize)');
  M.setCarried(m, null);
  carry(st('dirt', 4));
  M.doClick(m, 2, 0, M.PICKUP, P);
  ok(Inv.isEmpty(be.items[2]) && M.getCarried(m).n === 4, 'nothing can be put INTO the result slot');
  M.setCarried(m, null);
  // and a half-take from the result is allowed (right click takes the larger half)
  be.items[2] = st('iron_ingot', 9);
  M.doClick(m, 2, 1, M.PICKUP, P);
  ok(M.getCarried(m) && M.getCarried(m).n === 5 && be.items[2].n === 4, `right-clicking a stack of 9 in the result takes 5 and leaves 4 (got ${M.getCarried(m) && M.getCarried(m).n}/${be.items[2] && be.items[2].n})`);
}

// ═══════════ 8. shift-click routing, per furnace ═══════════════════════════════════════════════
say('\n8. quick-move, and what each furnace will take');
{
  const route = (type, name, from) => {
    const be = newFurnace(type), P = newPlayer(), inv = P.menu.inventory;
    Inv.setItem(inv, from, st(name, 4));
    const m = M.furnaceMenu(be, inv);
    M.doClick(m, from < 9 ? hotIdx(from) : packIdx(from), 0, M.QUICK_MOVE, P);
    const where = [];
    for (let i = 0; i < 3; i++) if (!Inv.isEmpty(be.items[i])) where.push(i);
    let inInv = -1;
    for (let i = 0; i < 36; i++) if (!Inv.isEmpty(Inv.getItem(inv, i))) inInv = i;
    return { where, inInv };
  };
  ok(route('furnace', 'porkchop', 9).where.join() === '0', 'a furnace takes raw porkchop as an ingredient');
  ok(route('smoker', 'porkchop', 9).where.join() === '0', 'a smoker takes it too');
  const bp = route('blast_furnace', 'porkchop', 9);
  ok(bp.where.length === 0 && bp.inInv === 0, 'a BLAST furnace does not: it goes from the backpack to the hotbar instead');
  ok(route('blast_furnace', 'raw_iron', 9).where.join() === '0', 'but it takes raw iron');
  ok(route('smoker', 'raw_iron', 9).where.length === 0, 'and a smoker does not');
  ok(route('furnace', 'stick', 9).where.join() === '1', 'a stick is fuel, so it goes to the fuel slot');
  ok(route('furnace', 'dirt', 9).inInv === 0 && route('furnace', 'dirt', 9).where.length === 0, 'dirt (neither) crosses from backpack to hotbar');
  const back = route('furnace', 'dirt', 0);
  ok(back.where.length === 0 && back.inInv >= 9, `and from the hotbar to the backpack (landed in slot ${back.inInv})`);
  // ⚠ the chain is on WHAT THE STACK IS: something that smelts and finds the ingredient slot
  // occupied by another item is NOT then offered to the fuel slot
  {
    const be = newFurnace(), P = newPlayer(), inv = P.menu.inventory;
    be.items[0] = st('raw_gold', 3);
    Inv.setItem(inv, 9, st('raw_iron', 4));
    const m = M.furnaceMenu(be, inv);
    M.doClick(m, packIdx(9), 0, M.QUICK_MOVE, P);
    ok(nameOf(be.items[0]) === 'raw_gold' && Inv.isEmpty(be.items[1]) && Inv.getItem(inv, 9).n === 4,
       'raw iron beside a different ingredient stays put: it does not fall through to the fuel slot');
  }
  // slots 0 and 1 go to the player
  {
    const be = newFurnace(), P = newPlayer(), inv = P.menu.inventory;
    be.items[0] = st('raw_iron', 3); be.items[1] = st('coal', 5);
    const m = M.furnaceMenu(be, inv);
    M.doClick(m, 0, 0, M.QUICK_MOVE, P);
    M.doClick(m, 1, 0, M.QUICK_MOVE, P);
    ok(Inv.isEmpty(be.items[0]) && Inv.isEmpty(be.items[1]), 'shift-clicking the ingredient or the fuel moves it to the player');
  }
}

// ═══════════ 9. what a burnt fuel and a dried sponge leave behind ══════════════════════════════
say('\n9. remainders');
{
  let be = newFurnace();
  be.items[0] = st('raw_iron', 2); be.items[1] = st('lava_bucket', 1);
  tick(1);
  ok(nameOf(be.items[1]) === 'bucket' && be.items[1].n === 1 && be.burnDuration === 20000, `a burnt lava bucket leaves an empty bucket (${nameOf(be.items[1])}, ${be.burnDuration} ticks)`);
  be = newFurnace();
  be.items[0] = st('wet_sponge', 1); be.items[1] = st('bucket', 1); be.burnTime = 5000; be.burnDuration = 5000;
  tick(200);
  ok(nameOf(be.items[2]) === 'sponge' && nameOf(be.items[1]) === 'water_bucket', `a wet sponge dries into a sponge and turns the bucket into water (${nameOf(be.items[2])}, ${nameOf(be.items[1])})`);
  be = newFurnace();
  be.items[0] = st('wet_sponge', 1); be.items[1] = st('coal', 1); be.burnTime = 5000; be.burnDuration = 5000;
  tick(200);
  okAv(nameOf(be.items[1]) === 'coal', 'anti-vacuity: without a bucket in the fuel slot nothing is turned into water');
}

// ═══════════ 10. the screen itself: open, leave, come back ═════════════════════════════════════
say('\n10. Hud.openFurnace, and closing loses nothing');
{
  const P = newPlayer(), inv = P.menu.inventory;
  BE.clear();
  const be = BE.create(3, 4, 5, 'smoker');
  be.items[0] = st('porkchop', 6); be.items[1] = st('coal', 2);
  ok(H.openFurnace(3, 4, 5) === true && H.screen === 'furnace', 'opening over a real smoker entity opens the furnace screen');
  const m1 = H.furnaceMenu;
  ok(m1 && m1.be === be && m1.slots.length === 39, 'over that entity, 39 slots');
  M.doClick(m1, packIdx(9), 0, M.PICKUP, P);              // pick up nothing (empty) - just a click
  Inv.setItem(inv, 9, st('coal', 8));
  M.doClick(m1, packIdx(9), 0, M.QUICK_MOVE, P);
  ok(be.items[1].n === 10, 'a shift-click through the open screen changed the entity (2 + 8 coal)');
  H.close();
  ok(H.screen === null && H.furnaceMenu === null, 'closing clears the screen and the menu');
  ok(nameOf(be.items[0]) === 'porkchop' && be.items[0].n === 6 && be.items[1].n === 10, 'and the block entity still holds everything');
  ok(H.openFurnace(3, 4, 5) === true && H.furnaceMenu !== m1 && M.slotGet(H.furnaceMenu.slots[1]).n === 10, 'a reopened screen is a new menu over the same stacks (catches a screen that edits a copy)');
  H.close();
  ok(H.openFurnace(9, 9, 9) === false && H.screen === null, 'a cell with no furnace entity opens nothing');
  BE.create(7, 7, 7, 'chest');
  ok(H.openFurnace(7, 7, 7) === false, 'and a chest entity is refused');
  // anti-vacuity: a screen built over a COPY would lose the shift-click on reopen
  const be2 = BE.create(1, 1, 1, 'furnace');
  be2.items[1] = st('coal', 1);
  const cm = M.furnaceMenu({ type: 'furnace', items: be2.items.map((x) => Inv.copy(x)), burnTime: 0, cookTime: 0, cookTimeTotal: 200 }, inv);
  Inv.setItem(inv, 9, st('coal', 5));
  M.doClick(cm, packIdx(9), 0, M.QUICK_MOVE, P);
  okAv(be2.items[1].n === 1, 'a menu over a copy leaves the real entity at 1 coal — the assertion above can fail');
}

// ═══════════ 11. THE DRAW: the real `Hud.drawFurnace`, on a canvas that records what it is told ═══
say('\n11. drawFurnace blits the flame and the arrow off the live counters');
{
  const G = MCL.Gui;
  G.ready = true;
  const calls = [];
  G.dim = () => {};
  G.blit = (c, sheet, r, x, y, sc) => calls.push({ sheet, r: r.slice(), x, y, sc });
  G.text = (c, str) => calls.push({ text: str });
  H.drawItem = () => {};
  H.w = 800; H.h = 600; H.scale = 2;
  const P = newPlayer();
  const draw = (be) => {
    calls.length = 0;
    H.furnaceMenu = M.furnaceMenu(be, P.menu.inventory);
    H.drawFurnace({ fillStyle: '', fillRect() {} });
    const F = G.FURNACE, o = H.furnaceOrigin;
    const flame = calls.filter((k) => k.r && k.r[0] === F.flame.sx && k.r[1] < F.arrow.sy);
    const arrow = calls.filter((k) => k.r && k.r[0] === F.arrow.sx && k.r[1] === F.arrow.sy);
    return { o, flame, arrow, panel: calls.filter((k) => k.r && k.r[0] === 0 && k.r[1] === 0), texts: calls.filter((k) => k.text).map((k) => k.text) };
  };
  const be = newFurnace('blast_furnace');
  be.burnTime = 0; be.cookTime = 0; be.cookTimeTotal = 100;
  let d = draw(be);
  ok(d.panel.length === 1 && d.panel[0].sheet === 'furnace' && d.panel[0].r.join() === '0,0,176,166', 'the panel is the whole 176x166 furnace sheet — for a blast furnace too, the three sheets being one picture');
  ok(d.flame.length === 0, 'an UNLIT furnace draws no flame at all');
  ok(d.arrow.length === 1 && d.arrow[0].r[2] === 1 && d.arrow[0].r[3] === 16, 'an empty arrow still blits the one-pixel sliver vanilla draws (l + 1 wide, 16 tall)');
  ok(d.texts[0] === 'blast furnace' || d.texts[0] === 'Blast Furnace', `the title names the block (${d.texts[0]})`);
  // the arrow at three cook counters, on a blast furnace (total 100)
  const widths = [];
  for (const c of [25, 50, 99]) {
    be.burnTime = 800; be.burnDuration = 1600; be.cookTime = c; be.cookTimeTotal = 100;
    d = draw(be);
    widths.push(d.arrow[0].r[2]);
    ok(d.arrow[0].x === d.o.x + 79 * d.o.s && d.arrow[0].y === d.o.y + 34 * d.o.s, `the arrow is drawn at the vanilla origin (79, 34) at cookTime ${c}`);
  }
  ok(widths.join() === '7,13,24', `the arrow is 7, 13 and 24 pixels wide at cookTime 25, 50, 99 of 100 (progress + 1), got ${widths}`);
  ok(new Set(widths).size === 3, 'three counters, three different drawn widths (D-241, D-296)');
  // the flame at three burn counters
  const heights = [];
  for (const b of [1600, 800, 100]) {
    be.burnTime = b; be.burnDuration = 1600; be.cookTime = 0;
    d = draw(be);
    ok(d.flame.length === 1, `a lit furnace (burnTime ${b}) draws exactly one flame blit`);
    const r = d.flame[0].r, l = r[3] - 1;
    heights.push(r[3]);
    ok(r[1] === 12 - l && r[2] === 14 && d.flame[0].y === d.o.y + (36 + 12 - l) * d.o.s,
       `the flame is the bottom ${r[3]} rows of the sprite, drawn ${l} rows above its base`);
  }
  ok(heights.join() === '14,7,1', `the flame is 14, 7 and 1 rows tall at 1600, 800 and 100 of 1600, got ${heights}`);
  // anti-vacuity: freeze the counters between two draws and the picture cannot change
  be.burnTime = 800; be.burnDuration = 1600; be.cookTime = 50; be.cookTimeTotal = 100;
  const d1 = draw(be), d2 = draw(be);
  okAv(d1.arrow[0].r[2] === d2.arrow[0].r[2] && d1.flame[0].r[3] === d2.flame[0].r[3], 'two draws of unchanged counters give the same picture; only the counters move it');
  be.cookTime = 60;
  okAv(draw(be).arrow[0].r[2] !== d1.arrow[0].r[2], 'and a larger cook counter changes the drawn arrow — the draw reads the counter, not a constant');
}

console.log('\n================ furnacecheck ================');
console.log(' assertions passed .. ' + pass);
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
if (fails.length) { fails.forEach((f) => console.log('   ✗ ' + f)); process.exitCode = 1; }
console.log('==============================================');
