#!/usr/bin/env node
// hoppercheck.mjs — PASS 17 JOB 1 (G19b), the HOPPER (D-419).
//
//   node tools/hoppercheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES, AND WHAT IT LEAVES TO OTHERS. `guicheck` §4g proves the eleven slot origins
// sit on `hopper.png`'s own pixels; `usecheck` proves a right-click on a hopper reaches
// `Hud.openHopper`. THIS is the machine: five slots that ARE the block entity, a click sequence
// that survives a close and a reopen, and the transfer — which is the half a screen cannot show.
//
// ⚠⚠ **THE ONE THING THAT MAKES A HOPPER A HOPPER IS THE CLOCK.** `tryMoveItems` moves exactly
// ONE item and then sets an eight-tick cooldown: 2.5 items a second, and every sorter, feed and
// clock ever built on one depends on it. A hopper that drained a stack in a tick would pass any
// "did the item arrive" test, so §3 measures the RATE over a hundred ticks and §8 breaks the
// cooldown to show the measurement has teeth.
//
// Sections:
//   1. shape — 41 slots, and the five ARE `be.items`, not a copy
//   2. the click sequence: a stack in, shift-clicked back, and a close/reopen that loses nothing
//   3. the clock — one item per transfer, eight ticks apart, measured as a rate
//   4. it pushes into what it FACES, through the opposite face, and only there
//   5. it pulls from the container ABOVE, through that container's own underside
//   6. the furnace doors — top feeds the ingredient, side feeds the fuel, below takes the result
//   7. the redstone gate — `ENABLED` is inverted, and a powered hopper moves nothing
//   8. anti-vacuity — break the cooldown, the facing, the furnace face table and the gate

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

const EXTRA = ['07zzq_brewing.js', '02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js',
               '14g_menu.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07zy_composter.js',
               '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '13_input.js', '15b_gui.js', '15_hud.js', '07zzr_minecart.js', '14l_use.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
const REAL_EL = MCL.EntityList;
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
MCL.BlockEntities.init();
MCL.Entities.init();

const Inv = MCL.Inventory, M = MCL.Menu, H = MCL.Hud, BE = MCL.BlockEntities;
const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const stk = (n, c) => Inv.stack(n, c === undefined ? 1 : c);
const nameOf = (s) => (Inv.isEmpty(s) ? '' : MCL.Items.nameOf(s.i));

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, m ? 'anti-vacuity: ' + m : m); if (c) { if (VERBOSE) console.log('   ✓ ' + m); } };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('hoppercheck — PASS 17 JOB 1 (G19b), the hopper (D-419)');

// ── the fixture: a real World and a real Behave, so the facing is read the way the game reads it
B.init(W);
function freshWorld() {
  W.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  BE.clear();
}
/** Put a real hopper block at (x,y,z) facing `dir`, and give it its block entity. */
function hopperAt(x, y, z, dir) {
  let st = S.stateOf('hopper') | 0;
  if (dir) st = B.setProp(st, 'facing', dir);
  W.setBlock(x, y, z, st);
  const be = BE.get(x, y, z) || BE.create(x, y, z, 'hopper');
  return be;
}
function containerAt(x, y, z, type, block) {
  W.setBlock(x, y, z, S.stateOf(block || type) | 0);
  return BE.get(x, y, z) || BE.create(x, y, z, type);
}
const tick = (n) => { for (let i = 0; i < n; i++) BE.tick(); };
function newPlayer() {
  const P = { menu: { inventory: Inv.create() }, xpTotal: 0 };
  MCL.Player = P;
  return P;
}
const packIdx = (i) => 5 + (i - 9);       // backpack slot i (9..35) -> menu index
const hotIdx = (h) => 32 + h;             // hotbar slot h (0..8)  -> menu index

// ═══════════ 1. shape, and that the slots ARE the block entity ═══════════════════════════════
say('\n1. shape, and the five slots ARE be.items');
{
  freshWorld();
  const be = hopperAt(0, 4, 0, 'down');
  const P = newPlayer();
  const m = M.hopperMenu(be, P.menu.inventory);
  ok(m.slots.length === 41, `a hopper menu has 41 slots, got ${m.slots.length}`);
  ok(M.HOPPER_SIZE === 5, `the hopper's own container is 5 slots, got ${M.HOPPER_SIZE}`);
  ok(be.items.length === 5, `the block entity carries 5 slots, got ${be.items.length}`);

  be.items[2] = stk('cobblestone', 7);
  ok(nameOf(M.slotGet(m.slots[2])) === 'cobblestone' && M.slotGet(m.slots[2]).n === 7,
     'a stack written on the block entity is visible through the menu — the menu is a window');
  M.slotSet(m.slots[4], stk('torch', 3));
  ok(be.items[4] && be.items[4].n === 3,
     'a stack written through the menu lands on the block entity, not on a copy');
}

// ═══════════ 2. the click sequence, and the close/reopen ═════════════════════════════════════
say('\n2. a stack in, shift-clicked back, and a close and reopen');
{
  freshWorld();
  const be = hopperAt(0, 4, 0, 'down');
  const P = newPlayer();
  Inv.setItem(P.menu.inventory, 9, stk('cobblestone', 32));
  let m = M.hopperMenu(be, P.menu.inventory);
  H.hopperMenu = m;

  // pick the stack up out of the backpack and drop it in hopper slot 0
  M.doClick(m, packIdx(9), 0, M.PICKUP, P);
  ok(nameOf(M.getCarried(m)) === 'cobblestone', 'the stack is carried after the first click');
  M.doClick(m, 0, 0, M.PICKUP, P);
  ok(be.items[0] && be.items[0].n === 32, `32 cobblestone went into the hopper, got ${be.items[0] && be.items[0].n}`);
  ok(Inv.isEmpty(Inv.getItem(P.menu.inventory, 9)), 'and left the backpack slot empty');

  // shift-click it back out
  M.doClick(m, 0, 0, M.QUICK_MOVE, P);
  ok(Inv.isEmpty(be.items[0]), 'shift-clicking slot 0 emptied it');
  let back = 0;
  for (let i = 0; i < 36; i++) { const s = Inv.getItem(P.menu.inventory, i); if (!Inv.isEmpty(s)) back += s.n; }
  ok(back === 32, `all 32 came back into the player's inventory, got ${back}`);

  // ⚠ CLOSE AND REOPEN — the test that catches a screen editing a copy.
  M.doClick(m, hotIdx(0), 0, M.PICKUP, P);          // pick from the hotbar it landed in, if it did
  if (M.getCarried(m)) M.doClick(m, 1, 0, M.PICKUP, P);
  else { be.items[1] = stk('cobblestone', 5); }
  const beforeName = nameOf(be.items[1]), beforeN = be.items[1] ? be.items[1].n : 0;
  H.hopperMenu = null;
  m = M.hopperMenu(be, P.menu.inventory);           // reopen over the SAME block entity
  const after = M.slotGet(m.slots[1]);
  ok(nameOf(after) === beforeName && after.n === beforeN,
     `slot 1 survived close and reopen (${beforeName} x${beforeN} -> ${nameOf(after)} x${after && after.n})`);
}

// ═══════════ 3. the clock ════════════════════════════════════════════════════════════════════
say('\n3. one item per transfer, eight ticks apart');
{
  freshWorld();
  const hop = hopperAt(0, 4, 0, 'down');
  const chest = containerAt(0, 3, 0, 'chest');
  hop.items[0] = stk('cobblestone', 64);
  const TICKS = 100;
  tick(TICKS);
  const moved = chest.items[0] ? chest.items[0].n : 0;
  // `HopperBlockEntity.serverTick` (.decomp:91-98) decrements `transferCooldown` FIRST, then
  // tries the move in that SAME tick if it just reached 0 -- so a move every 8th tick from tick
  // 1 (D-773 cloud unit: the old floor(100/9)+1 here baked in the pre-fix off-by-one).
  const expect = Math.floor((TICKS - 1) / BE.HOPPER_COOLDOWN) + 1;
  ok(BE.HOPPER_COOLDOWN === 8, `the cooldown is vanilla's 8, got ${BE.HOPPER_COOLDOWN}`);
  ok(moved === expect, `${TICKS} ticks moved ${moved} items; the clock says ${expect}`);
  ok(hop.items[0].n === 64 - moved, `and the hopper is down by exactly that many (${hop.items[0].n})`);
  say(`   moved ${moved} of 64 in ${TICKS} ticks`);
}

// ═══════════ 4. it pushes into what it FACES ═════════════════════════════════════════════════
say('\n4. the facing, and the face the item enters by');
{
  const DIRS = [['down', 0, -1, 0], ['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0]];
  let hit = 0;
  for (const [dir, dx, dy, dz] of DIRS) {
    freshWorld();
    const hop = hopperAt(0, 4, 0, dir);
    const target = containerAt(dx, 4 + dy, dz, 'chest');
    const decoy = containerAt(0, 6, 0, 'chest');       // above it: never a push target
    hop.items[0] = stk('cobblestone', 4);
    tick(3);
    if (target.items[0] && target.items[0].n === 1 && !decoy.items[0]) hit++;
    else fails.push(`a hopper facing ${dir} did not push into (${dx},${dy},${dz})`);
  }
  ok(hit === DIRS.length, `all ${DIRS.length} facings push into the cell they point at, got ${hit}`);

  // and it does NOT push into a cell that holds no container
  freshWorld();
  const lonely = hopperAt(0, 4, 0, 'down');
  lonely.items[0] = stk('cobblestone', 4);
  tick(20);
  ok(lonely.items[0].n === 4, `a hopper facing empty air keeps its items (kept ${lonely.items[0].n} of 4)`);
  ok(lonely.cooldown === 0, 'and never sets a cooldown, because nothing moved');
}

// ═══════════ 5. it pulls from ABOVE ══════════════════════════════════════════════════════════
say('\n5. the pull, from the container directly above');
{
  freshWorld();
  const hop = hopperAt(0, 4, 0, 'down');
  const above = containerAt(0, 5, 0, 'chest');
  const beside = containerAt(1, 4, 0, 'chest');
  above.items[3] = stk('diamond', 5);
  beside.items[0] = stk('emerald', 5);
  tick(30);
  const got = hop.items[0] ? hop.items[0].n : 0;
  ok(nameOf(hop.items[0]) === 'diamond' && got >= 2, `the hopper pulled diamonds from above (got ${got})`);
  ok(above.items[3].n === 5 - got, `the chest above is down by exactly that many (${above.items[3].n})`);
  ok(beside.items[0].n === 5, 'and took nothing from the chest beside it');
}

// ═══════════ 5b. a chest_minecart in the cell above ══════════════════════════════════════════
say('\n5b. the pull from a minecart above');
function cartPullRun(dy) {
  freshWorld();
  const hop = hopperAt(0, 4, 0, 'down');
  const cart = { type: 'chest_minecart', x: 0.5, y: 5 + dy, z: 0.5, removed: false,
    inventory: [null, { item: 'gold_ingot', count: 3 }, { item: 'iron_ingot', count: 3 }] };
  MCL.EntityList = { list: [cart] };
  const log = [];
  for (let t = 0; t < 12; t++) { BE.tick(); log.push(hop.items.reduce((a, s) => a + (Inv.isEmpty(s) ? 0 : s.n), 0)); }
  return { hop, cart, log };
}
{
  const r = cartPullRun(0);
  ok(nameOf(r.hop.items[0]) === 'gold_ingot' && r.cart.inventory[1].count === 3 - r.hop.items[0].n, 'cart: first non-empty slot (1) is drained');
  ok(r.log[11] >= 2 && r.log[11] <= 3, `cart: one item per 8 ticks (${r.log[11]} in 12)`);
  ok(!r.cart.inventory[2] || r.cart.inventory[2].count === 3, 'cart: slot 2 untouched while slot 1 has items');
  const far = cartPullRun(2);
  ok(far.log[11] === 0, 'cart two cells up is not pulled from');
  freshWorld(); MCL.EntityList = { list: [] };
  const h = hopperAt(0, 4, 0, 'down'); tick(20);
  ok(Inv.isEmpty(h.items[0]), 'no cart: nothing is pulled');
  MCL.EntityList = undefined;
}

// ═══════════ 6. the furnace doors ════════════════════════════════════════════════════════════
say('\n6. a hopper on a furnace: top feeds the ingredient, side the fuel, below takes the result');
{
  // TOP — into the ingredient slot, through `Menu.furnaceSetItem`, which restarts the cook
  freshWorld();
  const topHop = hopperAt(0, 5, 0, 'down');
  const furn = containerAt(0, 4, 0, 'furnace');
  topHop.items[0] = stk('raw_iron', 3);
  furn.cookTime = 77;                       // a cook in progress that a NEW ingredient must reset
  tick(3);
  ok(nameOf(furn.items[0]) === 'raw_iron', `the ingredient slot took the raw iron, got '${nameOf(furn.items[0])}'`);
  ok(furn.cookTime === 0, `and the cook restarted through Menu.furnaceSetItem's door (cookTime ${furn.cookTime})`);
  ok(Inv.isEmpty(furn.items[1]) && Inv.isEmpty(furn.items[2]), 'and nothing landed in the fuel or result slots');

  // SIDE — into the fuel slot, and only if it burns
  freshWorld();
  const sideHop = hopperAt(1, 4, 0, 'west');
  const furn2 = containerAt(0, 4, 0, 'furnace');
  sideHop.items[0] = stk('coal', 3);
  tick(3);
  ok(nameOf(furn2.items[1]) === 'coal', `a hopper on the side fed the FUEL slot, got '${nameOf(furn2.items[1])}'`);

  freshWorld();
  const sideHop2 = hopperAt(1, 4, 0, 'west');
  const furn3 = containerAt(0, 4, 0, 'furnace');
  sideHop2.items[0] = stk('raw_iron', 3);
  tick(20);
  ok(Inv.isEmpty(furn3.items[0]) && Inv.isEmpty(furn3.items[1]),
     'and refuses raw iron through the side — the fuel slot takes fuel, and the side reaches no other slot');
  ok(sideHop2.items[0].n === 3, 'the refused stack stays in the hopper');

  // BELOW — takes the result and never the ingredient
  freshWorld();
  const underHop = hopperAt(0, 3, 0, 'down');
  const furn4 = containerAt(0, 4, 0, 'furnace');
  furn4.items[0] = stk('raw_iron', 4);
  furn4.items[2] = stk('iron_ingot', 4);
  tick(30);
  const pulled = underHop.items[0] ? underHop.items[0].n : 0;
  ok(nameOf(underHop.items[0]) === 'iron_ingot' && pulled >= 2,
     `a hopper under a furnace takes the RESULT (got ${pulled} '${nameOf(underHop.items[0])}')`);
  ok(furn4.items[0].n === 4, 'and never the ingredient');
}

// ═══════════ 6b. the brewing stand's SidedInventory ═════════════════════════════════════════
say('\n6b. brewing stand — top: ingredient only, side: blaze powder + bottles, below: potions never the ingredient');
function brewFixtures() {
  const out = {};
  freshWorld();
  const top = hopperAt(0, 5, 0, 'down'), stand = containerAt(0, 4, 0, 'brewing_stand');
  top.items[0] = stk('stick', 2); top.items[1] = stk('potion', 1); top.items[2] = stk('nether_wart', 2);
  tick(40);
  out.top = { stand };
  freshWorld();
  const side = hopperAt(1, 4, 0, 'west'), stand2 = containerAt(0, 4, 0, 'brewing_stand');
  side.items[0] = stk('nether_wart', 2); side.items[1] = stk('blaze_powder', 2); side.items[2] = stk('potion', 2);
  tick(60);
  out.side = { stand: stand2 };
  freshWorld();
  const under = hopperAt(0, 3, 0, 'down'), stand3 = containerAt(0, 4, 0, 'brewing_stand');
  stand3.items[0] = stk('potion', 1); stand3.items[3] = stk('nether_wart', 2);
  tick(30);
  out.below = { hop: under, stand: stand3 };
  return out;
}
{
  const r = brewFixtures();
  ok(nameOf(r.top.stand.items[3]) === 'nether_wart', `a hopper above fed the ingredient slot, got '${nameOf(r.top.stand.items[3])}'`);
  ok(Inv.isEmpty(r.top.stand.items[4]) && Inv.isEmpty(r.top.stand.items[0]), 'and nothing else from above (no stick, no bottle)');
  ok(nameOf(r.side.stand.items[4]) === 'blaze_powder', `a hopper beside fed blaze powder into slot 4, got '${nameOf(r.side.stand.items[4])}'`);
  ok(nameOf(r.side.stand.items[0]) === 'potion', `and a potion into a bottle slot, got '${nameOf(r.side.stand.items[0])}'`);
  ok(nameOf(r.side.stand.items[3]) !== 'nether_wart', 'but never the ingredient through the side');
  ok(nameOf(r.below.hop.items[0]) === 'potion', `a hopper below took the potion, got '${nameOf(r.below.hop.items[0])}'`);
  ok(r.below.stand.items[3] && r.below.stand.items[3].n === 2, 'and never the ingredient');
}

// ═══════════ 7. the redstone gate ════════════════════════════════════════════════════════════
say('\n7. ENABLED is inverted — a powered hopper moves nothing');
{
  freshWorld();
  const hop = hopperAt(0, 4, 0, 'down');
  const chest = containerAt(0, 3, 0, 'chest');
  hop.items[0] = stk('cobblestone', 8);
  const realGate = BE.hopperEnabled;
  BE.hopperEnabled = () => false;           // as if a neighbour were feeding it a signal
  tick(40);
  BE.hopperEnabled = realGate;
  ok(!chest.items[0], 'a disabled hopper moved nothing into the chest below it');
  ok(hop.items[0].n === 8, 'and kept all eight');
  tick(12);
  ok(chest.items[0] && chest.items[0].n >= 1, 'and moves again the moment the signal goes away');
}

// ═══════════ 7b. a minecart in the output cell (getInventoryAt entity branch) ══════════════════
// REAL_EL is captured right after loadEngine
console.log('\n7b. a hopper pushes into a chest_minecart in its output cell, not into a plain minecart');
function cartRun() {
  freshWorld();
  const hop = hopperAt(0, 4, 0, 'down');
  hop.items[0] = stk('cobblestone', 64);
  const chestCart = { type: 'chest_minecart', x: 0.5, y: 3, z: 0.5, inventory: [] };
  const plain = { type: 'minecart', x: 0.5, y: 3, z: 0.5 };
  MCL.EntityList = { list: [chestCart], random: Math.random };
  const savedMc = MCL.Minecart;
  MCL.Minecart = { INVENTORY: { chest_minecart: 27, hopper_minecart: 5 }, generateLoot() {} };
  tick(100);
  const moved = chestCart.inventory.reduce((a, s) => a + (s ? s.count : 0), 0);
  MCL.EntityList.list = [plain];
  hop.items[0] = stk('cobblestone', 64);
  tick(40);
  MCL.Minecart = savedMc;
  return { moved, hopLeft: hop.items[0] ? hop.items[0].n : 0 };
}
{
  const r = cartRun();
  ok(r.moved === 13, `a hopper moves one item per 8 ticks into the chest cart (13 in 100 ticks, got ${r.moved})`);
  ok(r.hopLeft === 64, 'and nothing into a minecart with no inventory');
}

// ═══════════ 8. anti-vacuity ═════════════════════════════════════════════════════════════════
console.log('\n8. anti-vacuity — every rule above must be breakable');
{
  // (a) a hopper with no cooldown must move far more than the clock allows
  freshWorld();
  const hop = hopperAt(0, 4, 0, 'down');
  const chest = containerAt(0, 3, 0, 'chest');
  hop.items[0] = stk('cobblestone', 64);
  const real = BE.HOPPER_COOLDOWN;
  BE.HOPPER_COOLDOWN = 0;
  tick(100);
  BE.HOPPER_COOLDOWN = real;
  const fast = chest.items[0] ? chest.items[0].n : 0;
  okAv(fast > 50, `with the cooldown at 0 a hopper empties far faster (moved ${fast} in 100 ticks; §3's clock says 13)`);

  // (b) the facing must be READ — a hopper facing down must not push sideways
  freshWorld();
  const h2 = hopperAt(0, 4, 0, 'down');
  const side = containerAt(1, 4, 0, 'chest');
  h2.items[0] = stk('cobblestone', 4);
  tick(30);
  okAv(!side.items[0], 'a hopper facing DOWN must not push into the chest beside it (§4 cannot fail if it does)');

  // (c) the furnace face table must be REAL — a hopper on top must not reach the fuel slot
  freshWorld();
  const h3 = hopperAt(0, 5, 0, 'down');
  const f2 = containerAt(0, 4, 0, 'furnace');
  h3.items[0] = stk('coal', 4);
  tick(30);
  okAv(nameOf(f2.items[0]) === 'coal' && Inv.isEmpty(f2.items[1]),
       'coal dropped in from ABOVE lands in the INGREDIENT slot, not the fuel slot — the face table is real');

  // (d) `hopperEnabled` must be the thing §7 turned off, not a coincidence
  freshWorld();
  const h4 = hopperAt(0, 4, 0, 'down');
  const c4 = containerAt(0, 3, 0, 'chest');
  h4.items[0] = stk('cobblestone', 8);
  tick(12);
  okAv(!!c4.items[0], 'with the gate left alone the same fixture DOES move — §7 turned off the real thing');

  const realEnabled = BE.hopperEnabled;
  // (d2) item entities (HopperBlockEntity.extract item branch, .decomp:183-189)
  {
    const EL = MCL.EntityList = REAL_EL;
    const mk = (y, n) => { EL.init(); EL.pushPlayer = () => null; return EL.dropStack(0.5, y, 0.5, 'cobblestone', n, { vx: 0, vy: 0, vz: 0, pickupDelay: 99 }); };
    freshWorld();
    const h5 = hopperAt(0, 4, 0, 'down');
    containerAt(0, 3, 0, 'chest');
    let it = mk(5.5, 5);                     // 1.5 above the hopper's cell base: inside ABOVE (y 5..6)
    BE.hopperEnabled = () => false;
    for (let i = 0; i < 9; i++) BE.tick();
    BE.hopperEnabled = realEnabled;
    okAv(Inv.isEmpty(h5.items[0]) && !it.removed, 'a locked hopper takes no item entity');
    for (let i = 0; i < 9; i++) BE.tick();
    const total = h5.items.reduce((a, s) => a + (Inv.isEmpty(s) ? 0 : s.n), 0) +
                  (BE.get(0, 3, 0).items || []).reduce((a, s) => a + (Inv.isEmpty(s) ? 0 : s.n), 0);
    okAv(total === 5 && it.removed, `the whole 5-stack entity is taken in one attempt and discarded (total ${total}, removed ${it.removed})`);
    freshWorld();
    const h6 = hopperAt(0, 4, 0, 'up'); for (let i = 0; i < 5; i++) h6.items[i] = stk('cobblestone', i ? 64 : 62);
    it = mk(5.0, 5);
    BE.tick();
    okAv(h6.items[0].n === 64 && !it.removed && it.count === 3, `a partial fit shrinks the entity (slot ${h6.items[0].n}, entity ${it.count})`);
    freshWorld();
    hopperAt(0, 4, 0, 'up');
    it = mk(7.0, 5);
    tick(9);
    okAv(!it.removed && it.count === 5, 'an entity above the 2-block input area is not taken');
  }

  // (f) the entity branch must be the thing 7b measured
  // (f) the brewing slot table must be REAL — break it and §6b must fail
  {
    const real = BE.hopperMayTake;
    BE.hopperMayTake = () => true;
    const r = brewFixtures();
    BE.hopperMayTake = real;
    okAv(!r.below.stand.items[3] || r.below.stand.items[3].n !== 2,
         'with canExtract opened a hopper below DOES drain the ingredient — §6b has teeth');
  }

  // (d2) a hopper facing a composter: level only on chance rolls, item always consumed, nothing at 7/8
  {
    const C = MCL.Composter;
    const run = (lvl, item, n) => {
      freshWorld();
      W.setBlock(0, 3, 0, S.stateOf('composter'));
      C.setLevel(0, 3, 0, lvl);
      const h = hopperAt(0, 4, 0, 'down');
      h.items[0] = stk(item, n);
      tick(8 * n + 4);
      return { lvl: C.level(0, 3, 0), left: h.items[0] ? h.items[0].n : 0 };
    };
    const a = run(0, 'oak_leaves', 1);
    okAv(a.lvl === 1 && a.left === 0, `level 0 composter takes the first leaf for sure (lvl ${a.lvl}, left ${a.left})`);
    const b = run(1, 'oak_leaves', 3);
    okAv(b.left === 0 && b.lvl >= 1 && b.lvl <= 4, `three leaves all consumed, level rises by chance only (lvl ${b.lvl}, left ${b.left})`);
    const c7 = run(7, 'oak_leaves', 1), c8 = run(8, 'oak_leaves', 1);
    okAv(c7.left === 1 && c8.left === 1, 'level 7 and 8 refuse and keep the item');
    const nc = run(0, 'cobblestone', 1);
    okAv(nc.left === 1 && nc.lvl === 0, 'a non-compostable item is not accepted');
    const saved = C.CHANCE.oak_leaves;
    C.CHANCE.oak_leaves = 1;
    const m = run(1, 'oak_leaves', 3);
    C.CHANCE.oak_leaves = 0;
    const z = run(1, 'oak_leaves', 3);
    C.CHANCE.oak_leaves = saved;
    okAv(m.lvl === 4 && z.lvl === 1 && z.left === 0, `chance drives the level (chance 1 -> ${m.lvl}, chance 0 -> ${z.lvl}, still consumed)`);
  }

  // (g) the cart cell offset must matter
  okAv(cartPullRun(2).log[11] === 0 && cartPullRun(0).log[11] > 0, 'moving the cart out of the cell above stops the pull');
  MCL.EntityList = undefined;

  // (h) the entity branch must be the thing 7b measured
  {
    const real = BE.get;
    const save = BE.HOPPER_COOLDOWN;
    MCL.EntityList = null;
    freshWorld();
    const h5 = hopperAt(0, 4, 0, 'down'); h5.items[0] = stk('cobblestone', 8);
    const cc = { type: 'chest_minecart', x: 0.5, y: 3, z: 0.5, inventory: [] };
    MCL.EntityList = { list: [cc], random: Math.random };    // the cart is there, but no type counts as an inventory: as if the branch were skipped
    MCL.Minecart = { INVENTORY: {}, generateLoot() {} };
    tick(40);
    okAv(cc.inventory.length === 0, 'with the branch inventory test failing the cart receives nothing (7b cannot pass without the branch)');
    void real; void save;
  }

  // (i) #5495 HopperBlockEntity.onEntityCollided: an item entering the input shape is taken that tick
  {
    MCL.Use.init(W);
    const run = (cd, hook) => {
      freshWorld();
      const h = hopperAt(0, 4, 0, 'down'); h.cooldown = cd;
      const it = { type: 'item', item: 'cobblestone', count: 3, x: 0.5, y: 4.6, z: 0.5, width: 0.25, height: 0.25 };
      MCL.EntityList = { list: [it], remove(x) { x.removed = true; }, random: Math.random };
      const save = BE.hopperEntityCollided;
      if (!hook) BE.hopperEntityCollided = () => false;
      MCL.Use.entityCollide(it);
      BE.hopperEntityCollided = save;
      return { taken: !!it.removed, n: h.items[0] ? h.items[0].n : 0, cd: h.cooldown };
    };
    const r0 = run(0, true), r3 = run(3, true);
    ok(r0.taken && r0.n === 3 && r0.cd === BE.HOPPER_COOLDOWN, 'ready hopper absorbs the colliding item at once and starts its cooldown');
    ok(!r3.taken && r3.n === 0, 'a hopper on cooldown leaves the item alone');
    okAv(!run(0, false).taken, 'without the collision hook the item is not absorbed on entry');
    MCL.EntityList = undefined;
  }

  // (g) the composter level gate
  {
    const run = (lvl) => {
      freshWorld();
      const h = hopperAt(0, 4, 0, 'down');
      W.setBlock(0, 5, 0, S.stateOf('composter') | 0);
      MCL.Composter.setLevel(0, 5, 0, lvl);
      tick(12);
      return [h, MCL.Composter.level(0, 5, 0)];
    };
    const [h8, l8] = run(8);
    ok(nameOf(h8.items[0]) === 'bone_meal' && h8.items[0].n === 1 && l8 === 0, `level-8 composter gives 1 bone_meal and resets (got ${nameOf(h8.items[0])} lvl ${l8})`);
    const [h7, l7] = run(7);
    ok(Inv.isEmpty(h7.items[0]) && l7 === 7, 'level-7 composter gives nothing');
    const real = MCL.Composter.LEVEL_MAX;
    MCL.Composter.LEVEL_MAX = 7;
    const [hm] = run(7);
    MCL.Composter.LEVEL_MAX = real;
    okAv(!Inv.isEmpty(hm.items[0]), 'mutating the level gate to 7 makes a level-7 composter give bone_meal (red)');
  }

  // (e) the owed list is closed
  okAv(Array.isArray(BE.HOPPER_OWED) && BE.HOPPER_OWED.length === 1,
       `BE.HOPPER_OWED names exactly the one thing a hopper still cannot do (got ${BE.HOPPER_OWED && BE.HOPPER_OWED.length})`);
}

console.log('\n================ hoppercheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
if (fails.length) { for (const f of fails) console.log('  ✗ ' + f); process.exit(1); }
