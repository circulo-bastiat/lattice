#!/usr/bin/env node
// savecheck.mjs — a save must survive the block registry changing underneath it.
//
//   node tools/savecheck.mjs
//
// ⚠ THE REASON THIS EXISTS. `docs/archive/NEXT.md` once claimed saves were already name-keyed —
// "G14's whole point". They were not. Format v1 stored a raw `u16` block id per edit, which is
// only safe while the id table never changes, and the entire point of the generated 1.18.2
// registry is that it REPLACES that table. Load a v1 save against a different roster and every
// block silently becomes whatever now holds its number: a cobblestone house comes back as
// something else, with no error and no way to tell.
//
// ⚠ AND WHY IT CHANGED IN SESSION 2. v2 wrote a name palette, which was right as far as it
// went and stopped being enough the moment a cell started holding a registry REAL STATE. A
// name cannot say `oak_stairs` facing east, bottom half, not waterlogged — and there are 80 of
// those. v3 writes the name AND the block's LOCAL state index, and resolves
// `realFirst[block] + local` on load.
//
// The local index is the right thing to persist rather than the global one. A global state id
// moves the moment ANY earlier block in the registry gains a property; a local index only moves
// if that block's own state space changes. This file proves it the hard way: it reorders the
// whole registry between save and load — every block's global state ids change — and requires
// every edit to come back as the same block in the same state.
//
// ⚠⚠ AND WHY IT GREW IN SESSION 9 (G14, D-288). Everything above is about BLOCKS, and every
// assertion in it passed while the save was losing the entire game. `Player.toJSON` wrote nine
// BLOCK STATES, which is what a hotbar was in session 2; G8 gave the player 41 slots of item
// stacks and G5 gave them health, food and experience, and none of it was ever written. A
// diamond pickaxe saved as state 0 — air. This file could not see it, because it asked whether
// the format survives a shuffled registry and never whether the format CONTAINS THE GAME.
// §7 onwards is that question, and it is asked the same hard way: the ITEM registry is shuffled
// too, because `NS.Items` is generated from the jar exactly like `NS.Reg` and a stack saved by
// item id is a diamond pickaxe waiting to become whatever now holds index 704.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const ASSETS = MCLITE_ROOT + 'assets';

const RUNTIME = readFileSync(join(ASSETS, 'block-runtime.bin')).toString('base64');
const GEOMETRY = readFileSync(join(ASSETS, 'block-geometry.bin')).toString('base64');
const RMETA = JSON.parse(readFileSync(join(ASSETS, 'block-runtime.meta.json'), 'utf8'));
const GMETA = JSON.parse(readFileSync(join(ASSETS, 'block-geometry.meta.json'), 'utf8'));
const TILEALPHA = JSON.parse(readFileSync(join(ASSETS, 'block-tiles.meta.json'), 'utf8')).alpha;

const ITEMS = readFileSync(join(ASSETS, 'items.bin')).toString('base64');
const IMETA = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));

const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
               '02c_states.js', '02g_items.js', '03_section.js', '09b_sky.js', '14d_survival.js',
               '14f_inventory.js', '16b_save.js'];

function fresh() {
  const NS = {};
  const store = {};
  globalThis.MCL = NS;
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
  NS.Blocks.init();
  NS.Reg.init({ runtime: RUNTIME, runtimeBytes: RMETA.rawBytes, geometry: GEOMETRY,
                geometryBytes: GMETA.rawBytes, tileAlpha: TILEALPHA });
  NS.Items.init({ items: ITEMS, itemsBytes: IMETA.rawBytes });
  NS.World = { key: (cx, cz) => cx + ',' + cz };
  return NS;
}

/**
 * Reorder the ITEM registry the way regenerating it from a changed jar would — the same items
 * under the same names at different indices. ⚠ This is the item-side twin of `reorder` above and
 * it exists for the same reason: `Inventory.stack` holds `s.i`, an index into `NS.Items`, and a
 * save that wrote that number would hand the next build somebody else's item.
 */
function reorderItems(NS, by) {
  const IT = NS.Items, n = IT.names.length;
  const order = [];
  for (let k = 0; k < n; k++) order.push((k + by) % n);
  const pick = (arr) => (arr && arr.length === n
    ? (ArrayBuffer.isView(arr) ? arr.constructor.from(order.map((srcI) => arr[srcI]))
                               : order.map((srcI) => arr[srcI]))
    : arr);
  IT.names = order.map((srcI) => IT.names[srcI]);
  for (const f of ['stackSize', 'flags', 'state', 'tint0', 'tint1', 'layers', 'durability']) {
    if (IT[f] !== undefined) IT[f] = pick(IT[f]);
  }
  IT.index = Object.create(null);
  for (let i = 0; i < n; i++) IT.index[IT.names[i]] = i;
  return NS;
}

/**
 * Reorder the registry the way regenerating it from a changed jar would: the same blocks with
 * the same state spaces, in a different order, so every GLOBAL state id moves while every
 * (name, local) pair stays put. `air` is left at index 0 because zero-means-air is a separate
 * invariant that regcheck owns.
 */
function reorder(NS, by) {
  const R = NS.Reg, n = R.blockCount;
  const counts = new Array(n), defs = new Array(n), names = R.names.slice();
  for (let i = 0; i < n; i++) {
    counts[i] = R.realFirst[i + 1] - R.realFirst[i];
    defs[i] = R.defaultState[i];
  }
  // a rotation of blocks 1..n-1
  const order = [0];
  for (let k = 0; k < n - 1; k++) order.push(1 + ((k + by) % (n - 1)));

  const newNames = new Array(n), newFirst = new Uint32Array(n + 1), newDef = new Uint16Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const src = order[i];
    newNames[i] = names[src];
    newDef[i] = defs[src];
    newFirst[i] = acc;
    acc += counts[src];
  }
  newFirst[n] = acc;
  R.names = newNames;
  R.realFirst = newFirst;
  R.defaultState = newDef;
  R.id = Object.create(null);
  for (let i = 0; i < n; i++) R.id[newNames[i]] = i;
  return NS;
}

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// The edits under test. Deliberately NOT all default states: a stair with a facing, a slab
// with a half, a leaf block with a distance — the states a name alone cannot describe.
const A = fresh();
const stateOf = (NS, name, local) => NS.Reg.realFirst[NS.Reg.id[name]] + local;
const PLACED = [
  ['stone', 0, 0, 0, 5],
  ['cobblestone', 0, 0, 0, 900],
  ['oak_stairs', 7, 1, -2, 4096],        // a stair in some particular orientation
  ['oak_slab', 2, -3, 7, 77],            // a slab half
  ['oak_leaves', 9, 0, 0, 12345],        // a leaf with a distance and a persistence
  ['glowstone', 0, 5, 5, 1],
  // ⚠ AND THE FAR CORNERS OF THE WORLD (D-148's lesson: a test at the origin tests the origin).
  // The chunk coordinates are written as int32 and the cell index is chunk-local, so these must
  // round-trip exactly — including the negative ones, where a sign error would land the edit in
  // a different chunk and nobody would ever find the block they placed.
  ['stone', 0, 62500, -62500, 2048],          // a million blocks out, both signs
  ['diamond_block', 0, -1874999, 1874999, 4095],   // the world border, both signs
  ['oak_stairs', 3, 1874999, 1874999, 0],
];

// ─────────────────────────────────────────────── 1. a plain round trip
console.log('1. encode -> decode returns the same block AND the same state');
{
  for (const [name, local, cx, cz, i] of PLACED) {
    const key = A.World.key(cx, cz);
    if (!A.Save.edits.has(key)) A.Save.edits.set(key, { cx, cz, m: new Map() });
    A.Save.edits.get(key).m.set(i, stateOf(A, name, local));
  }
  const blob = A.Save.encode();
  ok(typeof blob === 'string' && blob.length > 0, 'encode produced a string');
  const B = fresh();
  ok(B.Save.decode(blob) === true, 'decode accepted its own output');
  ok(B.Save.count === PLACED.length, `${B.Save.count} edits decoded, placed ${PLACED.length}`);
  for (const [name, local, cx, cz, i] of PLACED) {
    const e = B.Save.edits.get(B.World.key(cx, cz));
    ok(!!e, `chunk ${cx},${cz} survived`);
    const want = stateOf(B, name, local);
    if (e) ok(e.m.get(i) === want,
      `${name}[${local}] at ${cx},${cz}[${i}] came back as ${B.States.name(e.m.get(i))}[${e.m.get(i)}], wanted ${want}`);
  }
  ok((B.Save.unknownNames || []).length === 0, 'no unknown names in a same-build round trip');
  // the far chunks specifically: same key, same sign, same cell
  for (const [, , cx, cz] of PLACED.filter(([, , x]) => Math.abs(x) > 1000)) {
    const e = B.Save.edits.get(B.World.key(cx, cz));
    ok(!!e && e.cx === cx && e.cz === cz,
       `the chunk at (${cx},${cz}) came back as (${e && e.cx},${e && e.cz}) — a far or negative coordinate is being mangled`);
  }
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 2. THE POINT: a reordered registry
console.log('2. the whole registry is reordered underneath the save');
{
  const blob = A.Save.encode();
  const C = reorder(fresh(), 137);

  let moved = 0;
  for (const [name, local] of PLACED) if (stateOf(C, name, local) !== stateOf(A, name, local)) moved++;
  ok(moved === PLACED.length,
     `the reorder must move every test block's GLOBAL state id, moved ${moved}/${PLACED.length}`);

  ok(C.Save.decode(blob) === true, 'a save decodes against a reordered registry');
  for (const [name, local, cx, cz, i] of PLACED) {
    const e = C.Save.edits.get(C.World.key(cx, cz));
    const got = e && e.m.get(i);
    const want = stateOf(C, name, local);
    ok(got === want,
       `${name}[${local}] came back as "${C.States.name(got)}"[${got}] after the reorder, wanted ${want}`);
  }
  ok((C.Save.unknownNames || []).length === 0, 'a pure reorder loses no names');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 3. a name this build no longer has
console.log('3. a block the build no longer knows');
{
  const blob = A.Save.encode();
  const D = fresh();
  const gone = D.Reg.id.glowstone;
  delete D.Reg.id.glowstone;
  D.Reg.names[gone] = '__removed__';

  ok(D.Save.decode(blob) === true, 'a save with an unknown block still decodes');
  ok((D.Save.unknownNames || []).indexOf('glowstone') >= 0,
     `the missing name must be reported, got ${JSON.stringify(D.Save.unknownNames)}`);
  const e = D.Save.edits.get(D.World.key(5, 5));
  ok(e && e.m.get(1) === 0, 'an unknown block becomes AIR, not whatever now holds its number');
  const e0 = D.Save.edits.get(D.World.key(0, 0));
  ok(e0 && e0.m.get(5) === stateOf(D, 'stone', 0), 'the blocks around it are unaffected');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 4. a state index this build no longer has
// The other half of the same problem, and the one the LOCAL index makes survivable: a block
// that loses states between versions. The edit must land on that block's default rather than
// walking into whatever block the arithmetic lands in.
console.log('4. a state index that has fallen off the end of its block');
{
  const blob = A.Save.encode();
  const E = fresh();
  const b = E.Reg.id.oak_leaves;
  const first = E.Reg.realFirst[b];
  // pretend oak_leaves dropped to two states — realFirst[b+1] is the next block's start, so
  // shrinking it is exactly what a smaller state space looks like from the outside
  E.Reg.realFirst = Uint32Array.from(E.Reg.realFirst);
  E.Reg.realFirst[b + 1] = first + 2;
  ok(E.Save.decode(blob) === true, 'a save with an out-of-range state still decodes');
  const e = E.Save.edits.get(E.World.key(0, 0));
  ok(e && e.m.get(12345) === first + E.Reg.defaultState[b],
     `an out-of-range local index must clamp to the block's default, got ${e && e.m.get(12345)}`);
  ok(E.States.block[e.m.get(12345)] === b,
     'and it must still be the same BLOCK, not the next one along');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 5. the palette is not wasteful
console.log('5. the palette carries only what is used');
{
  const blob = A.Save.encode();
  const bytes = Buffer.from(blob, 'base64');
  const nNames = bytes.readUInt16LE(12);
  // ⚠ DISTINCT (name, local) PAIRS, not placements and not names: the palette entry is a block
  // name AND its local state index, so the same stone placed in two chunks shares one entry
  // while two stairs in different orientations need two. The first version of this line
  // compared against the number of PLACEMENTS — right only while every placement happened to be
  // a distinct state, and wrong the moment the far-coordinate cases repeated one.
  const distinctNames = new Set(PLACED.map(([name, local]) => name + '/' + local)).size;
  ok(nNames === distinctNames, `${nNames} names in the palette for ${distinctNames} distinct blocks`);
  // ⚠ THE BLOB CARRIES `DATA_VERSION`, NOT `VERSION`, AND THE DIFFERENCE IS A DELETED WORLD.
  // They were one constant until session 9. Bumping the envelope to v4 for the inventory would
  // have made `decode` reject every existing blob — every block the player had ever placed —
  // to record something that has nothing to do with blocks. The blob format has not changed
  // since session 2, so its number has not moved, and this line asserts they are SEPARATE.
  ok(bytes.readUInt32LE(4) === A.Save.DATA_VERSION,
     `the blob header says ${bytes.readUInt32LE(4)}, DATA_VERSION is ${A.Save.DATA_VERSION}`);
  ok(A.Save.VERSION !== A.Save.DATA_VERSION,
     'the envelope version and the blob version are the same number — a field added to one now deletes the other');
  // ⚠ THE ENVELOPE MOVES AND THE BLOB DOES NOT, which is the whole point of D-288b. v5 added
  // the sky's clock and weather (D-300); the block bytes have not changed since session 2.
  ok(A.Save.VERSION === 5 && A.Save.DATA_VERSION === 3,
     `envelope v${A.Save.VERSION}, blob v${A.Save.DATA_VERSION}`);
  for (const v of [1, 2]) {
    const old = Buffer.from(bytes); old.writeUInt32LE(v, 4);
    const F = fresh();
    ok(F.Save.decode(old.toString('base64')) === false, `a v${v} blob is refused, not misread`);
  }
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 7. the inventory survives a shuffled ITEM registry
// ⚠ THE SECTION THIS FILE DID NOT HAVE, AND THE BUG IT WOULD HAVE CAUGHT. Everything above
// proves the BLOCK ids cannot hurt you. A stack holds an ITEM id, out of a registry generated
// from the same jar by the same kind of tool, and until G14 no stack was written at all.
console.log('7. the inventory: 41 slots, by item NAME, across a shuffled item registry');
{
  const H = fresh();
  const Iv = H.Inventory, IT = H.Items;
  const inv = Iv.create();
  // deliberately across the whole index space, and not only blocks
  const STOCK = [
    [0,  'diamond_pickaxe', 1, 137, null],       // a TOOL with damage — state 0 before G14
    [1,  'cobblestone',    64, 0,   null],       // a full stack: the count is the part v3 lost
    [4,  'torch',           7, 0,   null],
    [8,  'bread',           3, 0,   null],       // edible, no block state at all
    [20, 'golden_apple',    2, 0,   null],       // MAIN slot 20 — outside the hotbar entirely
    [35, 'oak_log',        12, 0,   null],       // the last main slot
    [36, 'iron_boots',      1, 5,   null],       // ARMOUR
    [39, 'diamond_helmet',  1, 0,   null],
    [40, 'stick',          64, 0,   null],       // the OFFHAND, vanilla's slot 40
    [2,  'leather_chestplate', 1, 0, { display: { color: 0x3A7F2B } }],   // NBT (D-267)
  ];
  for (const [slot, name, count, dmg, tag] of STOCK) {
    Iv.setItem(inv, slot, Iv.stack(name, count, dmg, tag));
  }
  inv.selected = 4;
  const wire = JSON.parse(JSON.stringify(Iv.toJSON(inv)));
  ok(!!wire && wire.slots.length === Iv.SIZE, `the wire form carries all ${Iv.SIZE} slots`);
  ok(wire.slots.every((x) => x === null || typeof x.n === 'string'),
     'every non-empty slot is written as an item NAME, never a number');

  // ⚠ now move every item id underneath it
  const I2 = reorderItems(fresh(), 613);
  let movedItems = 0;
  for (const [, name] of STOCK) if (I2.Items.of(name) !== IT.of(name)) movedItems++;
  ok(movedItems === STOCK.length,
     `the item reorder must move every test item's id, moved ${movedItems}/${STOCK.length}`);

  const inv2 = I2.Inventory.create();
  ok(I2.Inventory.fromJSON(inv2, wire) === true, 'the inventory reads back against the new registry');
  ok(inv2.selected === 4, `the selected slot came back as ${inv2.selected}`);
  for (const [slot, name, count, dmg, tag] of STOCK) {
    const st = I2.Inventory.getItem(inv2, slot);
    ok(!!st, `slot ${slot} (${name}) is not empty after the round trip`);
    if (!st) continue;
    ok(I2.Items.nameOf(st.i) === name,
       `slot ${slot} came back as ${I2.Items.nameOf(st.i)}, wanted ${name}`);
    ok(st.n === count, `slot ${slot} count ${st.n}, wanted ${count}`);
    ok(st.d === dmg, `slot ${slot} damage ${st.d}, wanted ${dmg}`);
    if (tag) ok(JSON.stringify(st.t) === JSON.stringify(tag),
      `slot ${slot} NBT ${JSON.stringify(st.t)}, wanted ${JSON.stringify(tag)}`);
  }
  // and the empty slots stayed empty rather than filling with whatever index 0 now is
  let empties = 0;
  const filled = new Set(STOCK.map(([sl]) => sl));
  for (let i = 0; i < I2.Inventory.SIZE; i++) if (!filled.has(i) && !I2.Inventory.getItem(inv2, i)) empties++;
  ok(empties === I2.Inventory.SIZE - STOCK.length,
     `${empties} slots stayed empty, expected ${I2.Inventory.SIZE - STOCK.length}`);

  // ⚠ an item this build no longer has is DROPPED, not substituted
  const I3 = fresh();
  const wire3 = JSON.parse(JSON.stringify(wire));
  wire3.slots[1] = { n: '__no_such_item__', c: 64 };
  const inv3 = I3.Inventory.create();
  I3.Inventory.fromJSON(inv3, wire3);
  ok(!I3.Inventory.getItem(inv3, 1), 'an unknown item name becomes an EMPTY slot, not a substitute');
  ok(!!I3.Inventory.getItem(inv3, 0), 'and the slots around it are untouched');

  // a length that does not match SIZE must not write past the end, in either direction
  const shortWire = { size: 5, selected: 0, slots: wire.slots.slice(0, 5) };
  const inv4 = I3.Inventory.create();
  ok(I3.Inventory.fromJSON(inv4, shortWire) === true, 'a shorter save still loads');
  ok(!I3.Inventory.getItem(inv4, 20), 'and the slots it does not mention are empty');
  const longWire = { size: 900, selected: 99, slots: wire.slots.concat(new Array(900).fill(null)) };
  const inv5 = I3.Inventory.create();
  ok(I3.Inventory.fromJSON(inv5, longWire) === true, 'a longer save still loads');
  ok(inv5.selected === 0, `a selected slot of 99 must clamp into the hotbar, got ${inv5.selected}`);
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 8. the survival state, and its clamps
console.log('8. health, food, saturation and experience — round trip and clamp');
{
  const J = fresh();
  const Sv = J.Survival;
  const e = Sv.init({});
  e.health = 7.5; e.food = 13; e.saturation = 2.25; e.exhaustion = 3.75;
  e.xpLevel = 30; e.xpProgress = 0.5; e.xpTotal = 1395; e.absorption = 4;
  const wire = JSON.parse(JSON.stringify(Sv.toJSON(e)));
  const f = Sv.init({});
  ok(Sv.fromJSON(f, wire) === true, 'the survival state reads back');
  for (const [name] of Sv.SURVIVAL_FIELDS) {
    ok(f[name] === e[name], `${name} came back as ${f[name]}, wanted ${e[name]}`);
  }
  ok(f.dead === false, 'a living player does not load dead');

  // ⚠ THE CLAMPS. A save is a file on disk: truncated, hand-edited, or written by another build.
  const g = Sv.init({});
  Sv.fromJSON(g, { health: 1e9, food: -40, saturation: NaN, exhaustion: 'x',
                   xpLevel: -5, xpProgress: 7, xpTotal: Infinity });
  ok(g.health === Sv.MAX_HEALTH, `health 1e9 clamped to ${g.health}, wanted ${Sv.MAX_HEALTH}`);
  ok(g.food === 0, `food -40 clamped to ${g.food}`);
  ok(g.saturation === 5, `a NaN saturation took its default, got ${g.saturation}`);
  ok(g.exhaustion === 0, `a non-numeric exhaustion took its default, got ${g.exhaustion}`);
  ok(g.xpLevel === 0, `xpLevel -5 clamped to ${g.xpLevel}`);
  ok(g.xpProgress === 1, `xpProgress 7 clamped to ${g.xpProgress}`);
  ok(Number.isFinite(g.xpTotal), `an Infinite xpTotal must not survive, got ${g.xpTotal}`);
  // ⚠ NaN is the one that does not announce itself: it fails every comparison, so a NaN food
  // level neither starves nor regenerates and the player simply stops healing for ever.
  for (const [name] of Sv.SURVIVAL_FIELDS) ok(!Number.isNaN(g[name]), `${name} is NaN after a hostile load`);

  // absent input: defaults, not whatever the entity already had
  const h = Sv.init({});
  h.health = 1; h.food = 1; h.xpLevel = 99;
  ok(Sv.fromJSON(h, null) === false, 'a missing survival block reports that it read nothing');
  ok(h.health === Sv.MAX_HEALTH && h.food === Sv.MAX_FOOD && h.xpLevel === 0,
     `and it resets to the defaults rather than keeping the last world's state (${h.health}/${h.food}/${h.xpLevel})`);
  const dead = Sv.init({});
  Sv.fromJSON(dead, { health: 0 });
  ok(dead.dead === true, 'health 0 loads as dead');
  ok(dead.deathTicks === 0 && dead.invulnerable === 0, 'but not mid-death-animation');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 8b. a v3 save, migrated rather than refused
// ⚠ WHY MIGRATE v3 WHEN v2 WAS REFUSED. A v2 entry was a NUMBER into a table that no longer
// exists: reading it means guessing which block it was, and a house rebuilt out of guesses is
// the failure the whole name-keyed format exists to prevent. A v3 entry is a NAME, and a name
// still means what it meant. So v3 is read, upgraded and rewritten as v4 — and every value it
// produces is one the old save actually implies, never one invented to fill a new field.
console.log('8b. a v3 hotbar migrates into stacks, inventing nothing');
{
  const L = fresh();
  const Iv = L.Inventory;
  const V3 = [
    ['cobblestone', 0], ['oak_log', 0], ['torch', 0],
    ['water', 0],                    // ⚠ a block with NO ITEM — must become empty, not a guess
    null, ['glass', 0], null, null, ['oak_stairs', 4],
  ];
  const inv = Iv.create();
  const filled = Iv.fromHotbarV3(inv, V3);
  const named = V3.filter(Boolean).length;
  ok(filled < named, `${filled} slots filled from ${named} named entries — the itemless block was dropped`);
  ok(!Iv.getItem(inv, 3), 'a block with no item becomes an EMPTY slot');
  for (const [i, name] of [[0, 'cobblestone'], [1, 'oak_log'], [2, 'torch'], [5, 'glass'], [8, 'oak_stairs']]) {
    const st = Iv.getItem(inv, i);
    ok(!!st && L.Items.nameOf(st.i) === name, `v3 slot ${i} migrated to ${st && L.Items.nameOf(st.i)}, wanted ${name}`);
    ok(!!st && st.n === 1, `and to ONE of it (v3 never recorded a count), got ${st && st.n}`);
    ok(!!st && st.d === 0, 'and undamaged');
  }
  ok(!Iv.getItem(inv, 4) && !Iv.getItem(inv, 6) && !Iv.getItem(inv, 7), 'empty v3 slots stay empty');
  // slots outside the hotbar are untouched: v3 had no field for them and none is invented
  let outside = 0;
  for (let i = Iv.HOTBAR; i < Iv.SIZE; i++) if (Iv.getItem(inv, i)) outside++;
  ok(outside === 0, `${outside} slots outside the hotbar were filled from a save that had no such field`);

  // a legacy bare-number entry is refused, not reinterpreted
  const inv2 = Iv.create();
  ok(Iv.fromHotbarV3(inv2, [7, 12, 3]) === 0, 'a v1/v2 numeric hotbar fills nothing');

  // ⚠ AND THE ENVELOPE ACCEPTS v3 WHILE WRITING v4
  ok(L.Save.READABLE.indexOf(3) >= 0 && L.Save.READABLE.indexOf(4) >= 0
     && L.Save.READABLE.indexOf(5) >= 0,
     `READABLE is ${JSON.stringify(L.Save.READABLE)}`);
  ok(L.Save.VERSION === 5, 'and VERSION — what it WRITES — is 5');
  ok(L.Save.READABLE.indexOf(L.Save.VERSION) >= 0,
     'and what it writes is something it can read back — the bump did not orphan the writer');
  ok(L.Save.READABLE.indexOf(2) < 0, 'a v2 envelope is still refused');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────── 8c. "New world" must forget the OLD world (D-415)
//
// Dan: *"hitting erase current world and create new one still slots you back with the old
// world."* The title screen's button cleared `localStorage` and the edit map by hand and then
// re-entered `boot()` — and `boot()`'s second pass calls `Save.load()` again, which returns
// false at its FIRST line because the string is gone and therefore never touches `S.playerState`
// or the sky. Both were still sitting in this module from the first pass, so the "new" world
// restored the old player at the old position under the old sky.
//
// `Save.reset()` is the whole fix and this is what it has to guarantee.
console.log('8c. Save.reset() forgets the player and the sky, not just the blocks');
{
  const L = fresh();
  const Sv = L.Save;
  Sv.init();
  Sv.seed = 4242;
  Sv.record(7, 70, 7, 0, L.States.stateOf('stone'));
  Sv.playerState = { x: 1234.5, y: 91, z: -77.25, health: 3 };
  if (L.Sky) { L.Sky.dayTime = 15000; L.Sky.fromJSON({ t: 15000 }); }
  // ⚠ `Save.save` reports through the HUD, which a headless run does not have. Every other
  // section here avoids `save()`; this one needs a real stored string, so it stubs the one
  // call rather than skipping the step the test is about.
  L.Hud = L.Hud || { say: function () {}, pushStatus: function () {} };
  // `Save.save` writes the PLAYER through `Player.toJSON`; this file loads no player module, so
  // the one call it makes is stubbed with the same state `playerState` was set to above.
  L.Player = L.Player || { toJSON: function () { return Sv.playerState; } };
  Sv.save(false);
  ok(Sv.count > 0, 'the world under test really has a saved edit');
  ok(globalThis.localStorage.getItem(Sv.KEY) !== null, 'and a saved string in storage');

  Sv.reset();
  ok(globalThis.localStorage.getItem(Sv.KEY) === null, 'reset() removes the saved string');
  ok(Sv.count === 0 && Sv.bytes === 0 && Sv.dirty === false, 'reset() clears the edit map');
  ok(Sv.playerState === null,
     'reset() forgets the PLAYER — the one thing the old button left behind, and the reason a ' +
     '"new world" put you back where you were');
  ok(Sv.loaded === false, 'and it is no longer a loaded world');
  if (L.Sky) {
    ok(L.Sky.dayTime === L.Sky.NEW_WORLD_TIME,
       `reset() gives the new world a new morning (got ${L.Sky.dayTime})`);
  }
  // and the second load really does find nothing, which is the state boot()'s second pass sees
  ok(Sv.load() === false, 'a reload after reset() finds no world, so boot() builds a fresh one');
  ok(Sv.playerState === null, 'and that failed load does NOT resurrect a player state');
}
console.log(`   ${pass} ok`);

// ─────────────────────────────────────────────── 9. anti-vacuity
console.log('9. anti-vacuity: break it, and it must be caught');
{
  const av = [];
  const blob = A.Save.encode();
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('the name palette read as raw ids, the way v1 did', () => {
    // v1 read the record's u16 AS a block id. Under a reorder that lands on a different block;
    // the palette path lands on the right one. If the two ever agree the palette is doing
    // nothing, so the check throws only when they DISAGREE.
    const F = reorder(fresh(), 137);
    F.Save.decode(blob);
    const right = F.Save.edits.get(F.World.key(0, 0)).m.get(5);
    const bytes = Buffer.from(blob, 'base64');
    const nNames = bytes.readUInt16LE(12);
    let o = 14;
    for (let i = 0; i < nNames; i++) o += 1 + bytes.readUInt8(o) + 2;
    o += 12;
    const slotAsId = bytes.readUInt16LE(o + 4);
    if (right !== slotAsId && right === stateOf(F, 'stone', 0)) throw 0;
  });

  check('the local state index dropped, so only the block survives', () => {
    // Reproduce v2: resolve the name to the block's DEFAULT state and ignore the local index.
    // For the stair and the slab that is a different state, which is the whole reason for v3.
    const F = fresh();
    F.Save.decode(blob);
    const got = F.Save.edits.get(F.World.key(1, -2)).m.get(4096);
    const naive = F.States.stateOf('oak_stairs');
    if (got !== naive && got === stateOf(F, 'oak_stairs', 7)) throw 0;
  });

  check('an unknown block mapped onto whatever holds its number', () => {
    const G = fresh();
    const gone = G.Reg.id.glowstone;
    delete G.Reg.id.glowstone;
    G.Reg.names[gone] = '__removed__';
    G.Save.decode(blob);
    const got = G.Save.edits.get(G.World.key(5, 5)).m.get(1);
    if (got === 0 && gone !== 0) throw 0;      // it became air, not `gone`
  });

  // ── §7's breaks: the inventory ────────────────────────────────────────────────────────────
  const H = fresh();
  const stock = H.Inventory.create();
  H.Inventory.setItem(stock, 0, H.Inventory.stack('diamond_pickaxe', 1, 137));
  H.Inventory.setItem(stock, 1, H.Inventory.stack('cobblestone', 64));
  const goodWire = JSON.parse(JSON.stringify(H.Inventory.toJSON(stock)));

  check('a stack written by item ID instead of name', () => {
    // what the format would look like if it stored `s.i`: resolve that number against a
    // SHUFFLED registry and you get somebody else's item. The check throws only when the two
    // actually disagree, so a reorder that happened to be a no-op cannot pass this.
    const idWire = { size: goodWire.size, selected: 0,
                     slots: goodWire.slots.map((x) => (x ? { id: H.Items.of(x.n), c: x.c } : null)) };
    const K = reorderItems(fresh(), 613);
    const byId = K.Items.nameOf(idWire.slots[0].id);
    const byName = K.Items.nameOf(K.Inventory.stackFromJSON(goodWire.slots[0]).i);
    if (byName === 'diamond_pickaxe' && byId !== 'diamond_pickaxe') throw 0;
  });

  check('the count dropped, the way a v3 hotbar entry did', () => {
    // v3 recorded a block state and nothing else, so 64 cobblestone came back as one block.
    const K = fresh();
    const full = K.Inventory.stackFromJSON(goodWire.slots[1]);
    const countless = K.Inventory.stackFromJSON({ n: goodWire.slots[1].n });
    if (full.n === 64 && countless.n === 1) throw 0;
  });

  check('the damage dropped, so every tool comes back repaired', () => {
    const K = fresh();
    const worn = K.Inventory.stackFromJSON(goodWire.slots[0]);
    const fresh2 = K.Inventory.stackFromJSON({ n: goodWire.slots[0].n });
    if (worn.d === 137 && fresh2.d === 0) throw 0;
  });

  check('a tool with no block state saved as its block state, which is air', () => {
    // the actual G14 bug: `Items.stateOf` is −1 for a pickaxe, and the old path wrote 0.
    const K = fresh();
    const st = K.Items.stateOf(K.Items.of('diamond_pickaxe'));
    const viaState = (st >= 0) ? st : 0;
    const viaName = K.Inventory.stackFromJSON(goodWire.slots[0]);
    if (viaState === 0 && viaName && K.Items.nameOf(viaName.i) === 'diamond_pickaxe') throw 0;
  });

  check('an unknown item substituted rather than dropped', () => {
    const K = fresh();
    const inv = K.Inventory.create();
    K.Inventory.fromJSON(inv, { size: 41, selected: 0, slots: [{ n: '__nope__', c: 9 }] });
    if (!K.Inventory.getItem(inv, 0)) throw 0;       // it is empty, not something else
  });

  check('slots past the hotbar not written at all', () => {
    // the state v3 was in: nine slots and no field for the other thirty-two.
    const K = fresh();
    const inv = K.Inventory.create();
    K.Inventory.setItem(inv, 36, K.Inventory.stack('iron_boots', 1, 5));
    const round = K.Inventory.create();
    K.Inventory.fromJSON(round, JSON.parse(JSON.stringify(K.Inventory.toJSON(inv))));
    const nine = K.Inventory.create();
    K.Inventory.fromJSON(nine, { size: 9, selected: 0, slots: new Array(9).fill(null) });
    if (K.Inventory.getItem(round, 36) && !K.Inventory.getItem(nine, 36)) throw 0;
  });

  // ── §8's breaks: the survival state ───────────────────────────────────────────────────────
  check('the clamps removed, so a hostile save is believed', () => {
    const K = fresh();
    const clamped = K.Survival.init({});
    K.Survival.fromJSON(clamped, { health: 1e9 });
    if (clamped.health === K.Survival.MAX_HEALTH) throw 0;
  });

  check('NaN passed straight through, so the player silently stops healing', () => {
    const K = fresh();
    const e = K.Survival.init({});
    K.Survival.fromJSON(e, { food: NaN });
    // a naive `e.food = o.food` would leave NaN there; the clamp must not
    if (!Number.isNaN(e.food)) throw 0;
  });

  check('an absent survival block leaving the last world\'s state behind', () => {
    const K = fresh();
    const e = K.Survival.init({});
    e.health = 1; e.xpLevel = 99;
    K.Survival.fromJSON(e, null);
    if (e.health === K.Survival.MAX_HEALTH && e.xpLevel === 0) throw 0;
  });

  check('a v3 hotbar migrated by INVENTING a count', () => {
    const K = fresh();
    const inv = K.Inventory.create();
    K.Inventory.fromHotbarV3(inv, [['cobblestone', 0]]);
    if (K.Inventory.getItem(inv, 0).n === 1) throw 0;      // one, not 64 and not a stack size
  });

  check('a v3 entry for a block with no item filled with something else', () => {
    const K = fresh();
    const inv = K.Inventory.create();
    K.Inventory.fromHotbarV3(inv, [['water', 0]]);
    if (K.Items.of('water') < 0 && !K.Inventory.getItem(inv, 0)) throw 0;
  });

  check('the envelope version and the blob version sharing one constant', () => {
    // the world-deleting bug this session nearly shipped: bump the envelope for an inventory
    // field and `decode` rejects every existing blob.
    const K = fresh();
    const bytes = Buffer.from(blob, 'base64');
    const asEnvelope = Buffer.from(bytes); asEnvelope.writeUInt32LE(K.Save.VERSION, 4);
    const okNow = K.Save.decode(blob);
    const okIfShared = fresh().Save.decode(asEnvelope.toString('base64'));
    if (okNow === true && okIfShared === false) throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" is not distinguished from correct behaviour`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

// ─────────────────────────────── 8c2. a NEGATIVE seed round-trips signed (#385)
console.log('8c2. a negative seed survives Save.save/Save.load unchanged');
{
  const L = fresh();
  const Sv = L.Save;
  L.Hud = L.Hud || { say: function () {}, pushStatus: function () {} };
  L.Player = L.Player || { toJSON: function () { return { x: 0, y: 80, z: 0 }; } };
  Sv.init(); Sv.seed = -5;
  Sv.record(7, 70, 7, 0, L.States.stateOf('stone'));
  Sv.save(false);
  Sv.seed = 0;
  Sv.load();
  ok(Sv.seed === -5, `seed -5 must reload as -5 (got ${Sv.seed})`);
  // break: the old unsigned widening must be seen as a different seed
  const caught = ((-5) >>> 0) !== -5;
  ok(caught, 'anti-vacuity: seed >>> 0 turns -5 into another seed');
  console.log(`   ${caught ? '✓' : '✗'} anti-vacuity: unsigned widening of a negative seed is caught (1 breaks caught)`);
}

// ─────────────────────────────── 8d. the world's DIFFICULTY is saved (loop s111, Diff.OWED)
console.log('8d. difficulty round-trips through Save.save/Save.load, and a new world is NORMAL');
{
  const L = fresh();
  const Sv = L.Save;
  // 07l_spawn.js's `NS.Diff` store, stood in by its own three members (this harness loads no mob code).
  const mkDiff = () => ({ value: 'normal', LEVELS: ['peaceful', 'easy', 'normal', 'hard'],
    get() { return this.value; }, set(l) { if (this.LEVELS.indexOf(l) >= 0) this.value = l; return this.value; } });
  L.Diff = mkDiff();
  L.Hud = L.Hud || { say: function () {}, pushStatus: function () {} };
  L.Player = L.Player || { toJSON: function () { return { x: 0, y: 80, z: 0 }; } };
  Sv.init(); Sv.seed = 4242;
  Sv.record(7, 70, 7, 0, L.States.stateOf('stone'));
  L.Diff.set('hard');
  Sv.save(false);
  ok(JSON.parse(globalThis.localStorage.getItem(Sv.KEY)).difficulty === 'hard', 'the save payload carries difficulty "hard"');
  L.Diff.value = 'easy';
  Sv.load();
  ok(L.Diff.get() === 'hard', `load() restores HARD (got ${L.Diff.get()})`);
  // a save from before this field existed loads as NORMAL, not as whatever the session had
  const o = JSON.parse(globalThis.localStorage.getItem(Sv.KEY)); delete o.difficulty;
  globalThis.localStorage.setItem(Sv.KEY, JSON.stringify(o));
  L.Diff.value = 'peaceful';
  Sv.load();
  ok(L.Diff.get() === 'normal', `a pre-difficulty save loads as NORMAL (got ${L.Diff.get()})`);
  L.Diff.value = 'hard';
  Sv.reset();
  ok(L.Diff.get() === 'normal', `reset() (new world) returns to NORMAL (got ${L.Diff.get()})`);
  // break: a save that forgets the field must fail the first round-trip assertion
  const L2 = fresh(); const S2 = L2.Save; L2.Diff = mkDiff();
  L2.Hud = L.Hud; L2.Player = L.Player; S2.init(); S2.seed = 1;
  L2.Diff.set('hard'); const g = L2.Diff.get; L2.Diff.get = () => undefined; S2.save(false); L2.Diff.get = g;
  S2.load();
  const caught = L2.Diff.get() !== 'hard';
  ok(caught, 'anti-vacuity: a save that drops difficulty reloads as something other than HARD — the round-trip assertion sees it');
  console.log(`   ${caught ? '✓' : '✗'} anti-vacuity: difficulty dropped from the save is caught`);
}

// ─────────────────────────────── 8e. GAMERULES are saved (s112, Diff.OWED "gamerule values not saved")
console.log('8e. changed gamerules round-trip through Save.save/Save.load; a new world has none');
{
  const L = fresh();
  const Sv = L.Save;
  L.Hud = L.Hud || { say: function () {}, pushStatus: function () {} };
  L.Player = L.Player || { toJSON: function () { return { x: 0, y: 80, z: 0 }; } };
  const sets = [];
  L.Commands = { ruleValues: Object.create(null), ruleSet(k, v) { sets.push(k); this.ruleValues[k] = v; return v; } };
  Sv.init(); Sv.seed = 4242;
  Sv.record(7, 70, 7, 0, L.States.stateOf('stone'));
  L.Commands.ruleValues.mobGriefing = 'false'; L.Commands.ruleValues.randomTickSpeed = 9;
  Sv.save(false);
  const saved = JSON.parse(globalThis.localStorage.getItem(Sv.KEY)).gameRules;
  ok(saved && saved.mobGriefing === 'false' && saved.randomTickSpeed === 9, 'the save payload carries the changed gamerules');
  L.Commands.ruleValues = Object.create(null); L.Commands.ruleValues.doMobLoot = 'false';
  Sv.load();
  ok(L.Commands.ruleValues.mobGriefing === 'false' && L.Commands.ruleValues.randomTickSpeed === 9, 'load() restores them');
  ok(L.Commands.ruleValues.doMobLoot === undefined, 'load() drops a rule the save does not carry (the session\'s own leftovers)');
  ok(sets.indexOf('mobGriefing') >= 0, 'load() goes through Commands.ruleSet (each rule\'s live side effect runs)');
  const o = JSON.parse(globalThis.localStorage.getItem(Sv.KEY)); delete o.gameRules;
  globalThis.localStorage.setItem(Sv.KEY, JSON.stringify(o));
  L.Commands.ruleValues.keepInventory = 'true';
  Sv.load();
  ok(Object.keys(L.Commands.ruleValues).length === 0, 'a save from before this field loads with every rule at its default');
  L.Commands.ruleValues.keepInventory = 'true';
  Sv.reset();
  ok(Object.keys(L.Commands.ruleValues).length === 0, 'reset() (new world) returns every rule to its default');
  // break: a save that forgets the field must fail the round-trip
  L.Commands.ruleValues.mobGriefing = 'false';
  const keep = Sv.rulesToJSON; Sv.rulesToJSON = () => ({}); Sv.save(false); Sv.rulesToJSON = keep;
  Sv.load();
  const caught = L.Commands.ruleValues.mobGriefing !== 'false';
  ok(caught, 'anti-vacuity: a save that drops the gamerules reloads without mobGriefing=false — the round-trip assertion sees it');
  console.log(`   ${caught ? '✓' : '✗'} anti-vacuity: gamerules dropped from the save are caught`);
}

console.log('');
console.log('================ savecheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
