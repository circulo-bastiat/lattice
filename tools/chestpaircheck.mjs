#!/usr/bin/env node
// chestpaircheck.mjs — PASS 17 JOB 1 (G19b), D-413: the DOUBLE CHEST, the world half.
//
//   node tools/chestpaircheck.mjs
//
// `chestcheck` §8 proves the MENU: one 54-slot container over two live arrays. This proves
// everything that decides WHICH two arrays, and it is the part that had no code at all before
// D-413 — nothing in the game turned two placed chests into a pair:
//   · `Player.withChestType` (`ChestBlock.getStateForPlacement`) — the clicked side, the sneak
//     rule, the facing the second chest inherits;
//   · `Behave.chestShape` (`ChestBlock.updateShape`) — the FIRST chest flips to the opposite half
//     when the second lands, and a half goes back to `single` when its mate is broken;
//   · `Hud.chestPair` — `type=right` is FIRST (slots 0..26, the top three rows), `type=left` SECOND.
//
// ⚠ The world is a flat array with `Behave.changed` behind `setBlock`, the way `behavcheck` does
// it: the shipped placement and neighbour-update code runs, and no rule is re-implemented here.
// ⚠ ONE FACT IS TRANSCRIBED, NOT REFEREED: that RIGHT is FIRST. There is no javap on the machines
// this runs on, so `ChestBlock.getBlockType` was not read from the jar. `chestcheck` and this
// file both PIN the mapping so a change to it is a decision — but they do not prove it vanilla.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };

const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const MCL = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js',
          '14g_menu.js', '14_player.js', '15_hud.js', '14b_physics.js', '07f_redstone.js'],
  dom: true,
});
MCL.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'),
                 itemsBytes: rdj('items.meta.json').rawBytes });
const R = MCL.Reg, S = MCL.States, B = MCL.Behave, BE = MCL.BlockEntities;
const P = MCL.Player, H = MCL.Hud, M = MCL.Menu, Inv = MCL.Inventory;

// ── a 48^3 world; setBlock calls Behave.changed exactly as World.setBlock does ────────────────
const N = 48, MID = 24;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const world = {
  getBlock: (x, y, z) => cells[idx(x, y, z)],
  setBlock(x, y, z, id) { cells[idx(x, y, z)] = id; B.changed(x, y, z); return true; },
  blockLightAt: () => 15,
};
MCL.World = world;
B.init(world);
BE.init();
const fresh = () => { cells.fill(0); BE.init(); B.clearSchedule(); };

const V = R.PVAL, PR = R.PROP;
const idOf = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
const type = (x, y, z) => R.valueNames[S.propValue(world.getBlock(x, y, z), PR.type)];
const facing = (x, y, z) => R.valueNames[S.propValue(world.getBlock(x, y, z), PR.facing)];
const FACE_E = 0, FACE_W = 1, FACE_S = 4, FACE_N = 5;
const NORTH = 0, EAST = Math.PI / 2, SOUTH = Math.PI, WEST = 3 * Math.PI / 2;   // yaw: 0 looks -Z, growing toward +X

/** Place a chest exactly as `Player.placeBlock` builds the state, then write it. */
function place(name, x, y, z, yaw, face, sneak) {
  let st = P.placementState(idOf(name), face === undefined ? 2 : face, 0.5, 0.5, 0.5, yaw);
  st = P.withChestType(st, x, y, z, face === undefined ? 2 : face, !!sneak);
  st = B.place(st, x, y, z);
  world.setBlock(x, y, z, st);
}
const stack = (n, c) => Inv.stack(n, c);

console.log('chestpaircheck — the double chest, the world half (D-413)');

// ═══════════ 1. two chests side by side become a pair, and BOTH states say so ═══════════════
{
  fresh();
  place('chest', 0, 0, 0, NORTH);                       // faces south — toward the player
  ok(facing(0, 0, 0) === 'south' && type(0, 0, 0) === 'single', `a lone chest is single and faces the player, got ${type(0, 0, 0)} / ${facing(0, 0, 0)}`);
  place('chest', 1, 0, 0, NORTH);
  ok(type(1, 0, 0) === 'left', `the chest placed to the EAST of a south-facing chest is its `+ '`left` half, got ' + type(1, 0, 0));
  ok(type(0, 0, 0) === 'right', `and the FIRST chest flipped to `+ '`right` by the neighbour update, got ' + type(0, 0, 0));
  ok(facing(1, 0, 0) === 'south', 'both halves face the same way');

  // ⚠ FIRST is `type=right`: slots 0..26 (the top three rows) are THAT chest's own array
  const a = BE.get(0, 0, 0), b = BE.get(1, 0, 0);
  ok(a && b && a !== b && a.type === 'chest' && b.type === 'chest', 'each half has its OWN block entity');
  const pairA = H.chestPair(0, 0, 0, a), pairB = H.chestPair(1, 0, 0, b);
  ok(pairA && pairA.first === a && pairA.second === b, 'opened from the RIGHT half: first = right (slots 0..26), second = left');
  ok(pairB && pairB.first === a && pairB.second === b, 'opened from the LEFT half it is the SAME pair, the same way round — which half you click does not reorder the container');

  // an item put in the right half's array is in the right block entity, and shows in the top rows
  a.items[4] = stack('iron_ingot', 9); b.items[4] = stack('coal', 3);
  const inv = Inv.create();
  const m = M.chestMenu(pairB.first, inv, 6, false, pairB.second);
  ok(M.slotGet(m.slots[4]) === a.items[4] && M.slotGet(m.slots[27 + 4]) === b.items[4],
     'slot 4 is the right chest\'s slot 4 and slot 31 the left chest\'s slot 4');
  Inv.setItem(inv, 9, stack('cobblestone', 30));
  M.doClick(m, 54, 0, M.PICKUP, { menu: null });
  M.doClick(m, 27 + 9, 0, M.PICKUP, { menu: null });
  ok(!Inv.isEmpty(b.items[9]) && Inv.itemName(b.items[9]) === 'cobblestone' && b.items[9].n === 30,
     `a stack put in the bottom half is in the LEFT block entity, got ${JSON.stringify(b.items[9])}`);
  ok(Inv.isEmpty(a.items[9]), 'and NOT in the right one');

  // closing and reopening: a new menu, built the same way, shows what was put in
  const p2 = H.chestPair(0, 0, 0, a);
  const m2 = M.chestMenu(p2.first, Inv.create(), 6, false, p2.second);
  ok(M.slotGet(m2.slots[27 + 9]) === b.items[9], 'reopening the pair still shows the stack — the container is the two block entities');

  // ── breaking one half leaves a 27-slot chest that keeps ITS OWN stacks ──────────────────────
  world.setBlock(1, 0, 0, 0);
  ok(type(0, 0, 0) === 'single', `breaking the left half puts the right half back to single, got ${type(0, 0, 0)}`);
  ok(H.chestPair(0, 0, 0, a) === null, 'and it no longer opens as a pair');
  const m3 = M.chestMenu(a, Inv.create(), 3);
  ok(m3.slots.length === 27 + 36 && M.slotGet(m3.slots[4]) === a.items[4], 'it is an ordinary 27-slot chest and it kept its own stacks');
}

// ═══════════ 2. what must NOT pair ═════════════════════════════════════════════════════════
{
  fresh();
  place('chest', 0, 0, 0, NORTH);
  place('trapped_chest', 1, 0, 0, NORTH);
  ok(type(0, 0, 0) === 'single' && type(1, 0, 0) === 'single', 'a chest and a trapped chest never pair');

  fresh();
  place('chest', 0, 0, 0, NORTH);                       // faces south
  place('chest', 1, 0, 0, EAST);                        // faces west
  ok(type(0, 0, 0) === 'single' && type(1, 0, 0) === 'single', `two chests facing different ways do not pair, got ${type(0, 0, 0)}/${type(1, 0, 0)}`);

  fresh();
  place('chest', 0, 0, 0, NORTH);
  place('chest', 0, 0, 1, NORTH);                       // in FRONT of the first: same axis as its facing
  ok(type(0, 0, 0) === 'single' && type(0, 0, 1) === 'single', 'a chest placed in front of another does not pair');

  // a half that already has a mate is not a candidate: the third chest stays single
  fresh();
  place('chest', 0, 0, 0, NORTH); place('chest', 1, 0, 0, NORTH); place('chest', 2, 0, 0, NORTH);
  ok(type(2, 0, 0) === 'single', `a third chest beside an already-paired half stays single, got ${type(2, 0, 0)}`);
  ok(type(0, 0, 0) === 'right' && type(1, 0, 0) === 'left', 'and the existing pair is untouched');
}

// ═══════════ 3. sneaking chooses the partner by the CLICKED side ═══════════════════════════
{
  fresh();
  place('chest', 0, 0, 0, NORTH);                       // south-facing, single
  // the player looks EAST (so the new chest would face WEST) and clicks the EAST face of the chest
  place('chest', 1, 0, 0, EAST, FACE_E, false);
  ok(type(1, 0, 0) === 'single' && facing(1, 0, 0) === 'west', 'without sneaking, a chest facing the other way does not pair');
  fresh();
  place('chest', 0, 0, 0, NORTH);
  place('chest', 1, 0, 0, EAST, FACE_E, true);
  ok(type(1, 0, 0) === 'left' && facing(1, 0, 0) === 'south', `sneaking pairs it by the clicked face and takes the partner's facing, got ${type(1, 0, 0)}/${facing(1, 0, 0)}`);
  ok(type(0, 0, 0) === 'right', 'and the first chest took the other half');
  // and from the other side
  fresh();
  place('chest', 0, 0, 0, NORTH);
  place('chest', -1, 0, 0, WEST, FACE_W, true);
  ok(type(-1, 0, 0) === 'right' && type(0, 0, 0) === 'left', `on the west side it is the mirror image, got ${type(-1, 0, 0)}/${type(0, 0, 0)}`);
}

// ═══════════ 4. anti-vacuity — each piece can be seen to matter ════════════════════════════
{
  const scenario = () => {
    fresh();
    place('chest', 0, 0, 0, NORTH); place('chest', 1, 0, 0, NORTH);
    const a = BE.get(0, 0, 0), b = BE.get(1, 0, 0);
    const p = H.chestPair(1, 0, 0, b);
    return { a, b, p, t0: type(0, 0, 0) };
  };
  // (a) no neighbour update: the first chest never learns it is half of a pair
  const realShape = B.updateShape;
  B.updateShape = (st) => st;
  const off = scenario();
  B.updateShape = realShape;
  okAv(off.t0 === 'single' && off.p === null,
    'anti-vacuity: with `Behave.updateShape` off the first chest stays single and no pair forms — the pairing test above reads the neighbour update');
  // (b) RIGHT/LEFT swapped: the top three rows would be the OTHER block entity
  const on = scenario();
  const swapped = { first: on.p.second, second: on.p.first };
  okAv(swapped.first === on.b && on.p.first === on.a,
    'anti-vacuity: a swapped FIRST/SECOND puts slot 0 in the other block entity — the mapping assertion can fail');
  // (c) the sneak flag is what decides the sneak case
  fresh(); place('chest', 0, 0, 0, NORTH); place('chest', 1, 0, 0, EAST, FACE_E, false);
  const noSneak = type(1, 0, 0);
  fresh(); place('chest', 0, 0, 0, NORTH); place('chest', 1, 0, 0, EAST, FACE_E, true);
  okAv(noSneak !== type(1, 0, 0), 'anti-vacuity: the same click pairs when sneaking and does not when standing — the flag is read');
  // (d) breaking the partner is what un-pairs: without the neighbour update it would stay 'right'
  fresh(); place('chest', 0, 0, 0, NORTH); place('chest', 1, 0, 0, NORTH);
  B.updateShape = (st) => st;
  world.setBlock(1, 0, 0, 0);
  const stuck = type(0, 0, 0);
  B.updateShape = realShape;
  okAv(stuck === 'right', 'anti-vacuity: with the neighbour update off, breaking one half leaves the other claiming a mate — so the un-pairing assertion is real');
}

// ═══════════ 5. s119 — ChestBlock.isChestBlocked: a solid block or a sitting cat above ═══════
{
  if (MCL.Redstone && MCL.Redstone.init && !MCL.Redstone.ready) MCL.Redstone.init();
  if (!P.menu) P.menu = { inventory: Inv.create() };
  if (!MCL.Input) MCL.Input = { uiOpen: false, releaseLock() {} };
  const saveList = MCL.EntityList ? MCL.EntityList.list : undefined;
  MCL.EntityList = MCL.EntityList || {};
  MCL.EntityList.list = [];
  fresh();
  place('chest', 0, 0, 0, NORTH);
  const open = (x, y, z) => { H.chestMenu = null; return H.openChest(x, y, z); };
  ok(open(0, 0, 0) === true && H.chestMenu, 'a free single chest opens');
  world.setBlock(0, 1, 0, idOf('stone'));
  ok(open(0, 0, 0) === 'blocked' && !H.chestMenu, 'stone above: the chest does not open (and the click is consumed — a truthy answer)');
  world.setBlock(0, 1, 0, idOf('glass'));
  ok(open(0, 0, 0) === true, 'glass above is not a solid block (isSolidBlock = redstone conductor) — it opens');
  world.setBlock(0, 1, 0, idOf('oak_slab'));
  ok(open(0, 0, 0) === true, 'a slab above is not a full cube — it opens');
  world.setBlock(0, 1, 0, 0);
  const cat = { type: 'cat', x: 0.5, y: 1, z: 0.5, width: 0.6, height: 0.7, sitting: true };
  MCL.EntityList.list.push(cat);
  ok(open(0, 0, 0) === 'blocked', 'a SITTING cat on the chest blocks it');
  cat.sitting = false;
  ok(open(0, 0, 0) === true, 'a standing cat does not');
  cat.sitting = true; cat.type = 'ocelot';
  ok(open(0, 0, 0) === true, 'an ocelot is not a CatEntity — it does not block');
  MCL.EntityList.list.length = 0;
  // a double: stone over EITHER half blocks both
  place('chest', 1, 0, 0, NORTH);
  world.setBlock(1, 1, 0, idOf('stone'));
  ok(open(0, 0, 0) === 'blocked', 'stone over the OTHER half of a double blocks opening from this half');
  world.setBlock(1, 1, 0, 0);
  ok(open(0, 0, 0) === true, 'and with it gone the double opens');
  // ender chest: solid above blocks, a cat does not
  fresh();
  place('ender_chest', 3, 0, 0, NORTH);
  MCL.EntityList.list.push({ type: 'cat', x: 3.5, y: 1, z: 0.5, width: 0.6, height: 0.7, sitting: true });
  ok(open(3, 0, 0) === true, 'an ender chest ignores a cat (EnderChestBlock asks only the block)');
  world.setBlock(3, 1, 0, idOf('stone'));
  ok(open(3, 0, 0) === 'blocked', 'but not a solid block');
  // anti-vacuity: with the solid test switched off, the stone case would open
  const realC = MCL.Redstone.isConductor; MCL.Redstone.isConductor = () => false;
  okAv(open(3, 0, 0) !== 'blocked', 'anti-vacuity: with isConductor stubbed false the blocked ender chest opens — the solid assertion can fail');
  MCL.Redstone.isConductor = realC;
  MCL.EntityList.list = saveList || [];
}

console.log('');
console.log('1. two chests pair, right = FIRST = the top three rows, and breaking one half leaves a 27-slot chest');
console.log('2. no pairing across chest/trapped chest, across facings, in front, or onto an already-paired half');
console.log('3. sneaking pairs by the clicked side (both sides)');
console.log('4. anti-vacuity — neighbour update off, halves swapped, sneak flag, un-pairing');
console.log('5. s119 — a chest under a solid block or a sitting cat will not open (either half of a double); an ender chest only minds the block');
console.log('');
for (const f of fails) console.log('FAIL  ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
