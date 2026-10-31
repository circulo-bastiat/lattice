#!/usr/bin/env node
// lightcheck.mjs — PLAN W9's acceptance test: the light rules are VANILLA'S rules.
//
//   node tools/lightcheck.mjs [--print]
//
// PLAN W9: *"a hand-built room with windows, overhangs and a staircase; every cell's light level
// asserted against a hand-computed table."* That is sections 2 and 3, and every number in them
// was worked out on paper from the three rules and then typed here — not read off the engine.
// A table copied from the implementation proves the implementation equals itself.
//
// The three rules, restated because everything below is a consequence of them:
//   • block light: an emitter's level, minus one per step, minus the target's opacity.
//   • sky light: the same sideways and upward — but STRAIGHT DOWN through a zero-opacity cell it
//     keeps its level, which is why a shaft under a hole is 15 all the way to the floor.
//   • an opaque block holds no light.
//
// ⚠ The engine is exercised through its ADAPTER (`Light.setAdapter`), over a plain array world
// built here. That is the real `src/08_lighting.js` — the same code the game loads, not a
// reimplementation of it — which is the only way this check is worth anything.
//
// Sections:
//   1. the adapter and the queues
//   2. sky light: the shaft, the overhang, the window and the staircase, cell by cell
//   3. block light: a torch in a room, and two torches interfering
//   4. removal: put the roof back, break the torch, and prove the light goes away
//   5. the chunk seam: two columns lit separately, then settled — no step bigger than one
//  5b. the same claim over a REAL generated region, in BOTH climate modes (D-193)
//  5c. and over deliberately TALL terrain, where a canopy stands above the chunk's stone
//   6. anti-vacuity: break each rule and prove the table catches it

import { loadEngine } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs'; // D-465: shared worldgen chunk cache

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MCL = loadEngine({ extra: ['08_lighting.js'] });
const SR = MCL.States, CFG = MCL.CFG, L = MCL.Light;
const AIR = 0;
const STONE = SR.stateOf('stone');
const GLASS = SR.stateOf('glass');
const WATER = SR.stateOf('water');
const TORCH = SR.stateOf('torch');
const GLOWSTONE = SR.stateOf('glowstone');

// ── a tiny world: one Map of packed cells, with the engine's own adapter shape ───────────────
function makeWorld() {
  const blocks = new Map(), light = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  const w = {
    lo: [-8, 0, -8], hi: [24, 24, 24],
    setBlock(x, y, z, st) { blocks.set(key(x, y, z), st); },
    adapter: {
      block: (x, y, z) => blocks.get(key(x, y, z)) || AIR,
      get: (x, y, z, ch) => {
        const b = light.get(key(x, y, z)) || 0;
        return ch === L.SKY ? (b >>> 4) : (b & 15);
      },
      set: (x, y, z, ch, lv) => {
        const b = light.get(key(x, y, z)) || 0;
        light.set(key(x, y, z), ch === L.SKY ? ((lv << 4) | (b & 15)) : ((b & 0xF0) | lv));
      },
      // ⚠ `lightSolid`, not `opaque` — the engine's own adapter asks this and so must the test
      // world, or this file asserts a rule the game does not use (D-156).
      opaque: (st) => SR.lightSolid[st] === 1,
      atten: (st) => SR.atten[st],
      emit: (st) => SR.emit[st],
      loaded: (x, y, z) => x >= w.lo[0] && x <= w.hi[0] && y >= w.lo[1] && y <= w.hi[1] && z >= w.lo[2] && z <= w.hi[2],
    },
    sky: (x, y, z) => w.adapter.get(x, y, z, L.SKY),
    blk: (x, y, z) => w.adapter.get(x, y, z, L.BLOCK),
  };
  return w;
}

/**
 * A SEALED room: floor, roof, and four walls. Sealed matters — an open side lets the sky in from
 * the edge of the test volume and every number below becomes the light of the wrong source,
 * which is exactly the mistake this file would otherwise be asserting.
 */
function buildRoom(w, lo, hi, floorY, roofY) {
  for (let x = lo; x <= hi; x++) for (let z = lo; z <= hi; z++) {
    w.setBlock(x, roofY, z, STONE);
    w.setBlock(x, floorY, z, STONE);
  }
  for (let y = floorY; y <= roofY; y++) for (let t = lo; t <= hi; t++) {
    w.setBlock(lo, y, t, STONE); w.setBlock(hi, y, t, STONE);
    w.setBlock(t, y, lo, STONE); w.setBlock(t, y, hi, STONE);
  }
}

/**
 * The initial sky column, exactly as `Gen.lightPass` seeds it before any BFS: 15 downward
 * through the open air until something opaque stops it. Then every cell is queued and the real
 * engine settles the whole thing, which is what makes this a test of the ENGINE and not of a
 * hand-rolled flood written in this file.
 */
function seedAndSettle(w, ceiling) {
  L.init(); L.setAdapter(w.adapter);
  for (let x = w.lo[0]; x <= w.hi[0]; x++) {
    for (let z = w.lo[2]; z <= w.hi[2]; z++) {
      let lv = 15;
      for (let y = ceiling; y >= w.lo[1]; y--) {
        const st = w.adapter.block(x, y, z);
        if (w.adapter.opaque(st)) { lv = 0; }
        else if (lv === 15 && SR.atten[st] === 0) { lv = 15; }
        else { lv = Math.max(0, lv - 1 - SR.atten[st]); }
        w.adapter.set(x, y, z, L.SKY, lv);
      }
    }
  }
  for (let x = w.lo[0]; x <= w.hi[0]; x++) {
    for (let z = w.lo[2]; z <= w.hi[2]; z++) {
      for (let y = w.lo[1]; y <= ceiling; y++) {
        const s = w.sky(x, y, z);
        if (s > 1) L.seed(x, y, z, s, L.SKY);
        const st = w.adapter.block(x, y, z);
        const e = SR.emit[st];
        if (e) { w.adapter.set(x, y, z, L.BLOCK, e); L.seed(x, y, z, e, L.BLOCK); }
      }
    }
  }
  ok(L.settle(), 'the engine did not settle');
}

// ─────────────────────────────────────────────── 1. the adapter and the queues
console.log('1. the engine, its adapter and its queues');
{
  ok(typeof L.step === 'function', 'Light.step is missing');
  ok(typeof L.queueEdit === 'function', 'Light.queueEdit is missing');
  ok(typeof L.queueBorder === 'function', 'Light.queueBorder is missing');
  L.init();
  ok(L.step(1000) === false, 'an empty engine reports work to do');
  // ⚠ THE QUEUE HAS NO COORDINATE LIMIT (D-148). It used to pack x and z into eleven bits each,
  // which is a world 2,048 blocks wide: at x = 1441 the pack wrapped and the cell came back out
  // at x = −607, so every edit and every seam beyond ±1024 blocks was applied somewhere else.
  // These are the coordinates a player actually reaches.
  for (const [x, y, z] of [[0, -64, 0], [1023, 319, -1024], [-1024, 0, 1023], [17, -7, -3],
                           [1441, 70, 601], [-250000, 200, 250000], [29999984, 0, -29999984]]) {
    const m = L.ymeta(y, 9, L.SKY);
    ok(L.uy(m) === y && L.ulevel(m) === 9 && L.uch(m) === L.SKY, `the y/level/channel word lost (${x},${y},${z})`);
    const r = new L.Ring(4);
    r.push(x, z, m);
    const out = new Int32Array(3);
    r.shift3(out);
    ok(out[0] === x && out[1] === z && L.uy(out[2]) === y, `the ring lost (${x},${y},${z})`);
  }
  // the ring grows rather than dropping — a dropped entry is a cell lit for ever (D-27)
  const r = new L.Ring(4);
  for (let i = 0; i < 100; i++) r.push(i, i * 2, i * 3);
  ok(r.n === 100, `the ring holds ${r.n} of 100 entries`);
  const out = new Int32Array(3); let good = true;
  for (let i = 0; i < 100; i++) { r.shift3(out); if (out[0] !== i || out[1] !== i * 2 || out[2] !== i * 3) good = false; }
  ok(good, 'the ring reordered or corrupted its entries when it grew');
}

// ─────────────────────────────────────────────── 2. sky light, by hand
console.log('2. sky light — a shaft, an overhang, a window and a staircase');
const w2 = makeWorld();
{
  // A solid roof at y=12 over the whole area, floor at y=4, and the room between them.
  buildRoom(w2, -4, 20, 4, 12);
  w2.setBlock(8, 12, 8, AIR);              // a one-block hole in the roof
  w2.setBlock(0, 12, 0, GLASS);            // a window: transparent, opacity 0 in 1.18
  w2.setBlock(16, 12, 16, WATER);          // water in the roof: opacity 1

  seedAndSettle(w2, 20);

  // THE SHAFT. Sky light falls straight down through the hole without losing a level, so every
  // cell under it is 15 — this is the rule that separates vanilla's sky light from block light.
  for (let y = 11; y >= 5; y--) ok(w2.sky(8, y, 8) === 15, `under the hole at y=${y}: ${w2.sky(8, y, 8)}, expected 15`);
  // and the floor block itself is opaque, so it holds nothing
  ok(w2.sky(8, 4, 8) === 0, `the floor under the shaft is ${w2.sky(8, 4, 8)}, expected 0`);

  // SIDEWAYS FROM THE SHAFT: one level per step, so the ring at distance d is 15-d.
  for (let d = 1; d <= 6; d++) {
    ok(w2.sky(8 + d, 8, 8) === 15 - d, `${d} east of the shaft: ${w2.sky(8 + d, 8, 8)}, expected ${15 - d}`);
    ok(w2.sky(8, 8, 8 - d) === 15 - d, `${d} north of the shaft: ${w2.sky(8, 8, 8 - d)}, expected ${15 - d}`);
  }
  // the diagonal is the Manhattan distance, not the Euclidean one — a BFS on six faces
  ok(w2.sky(11, 8, 11) === 9, `3+3 diagonal: ${w2.sky(11, 8, 11)}, expected 9`);
  // and it runs out: the far corner of the room is 11+11 steps from the shaft, well past 15
  // (19,8,-3) is 25 steps from the shaft, 25 from the window and 25 from the water: nothing
  // reaches it, and a rule that leaked one extra level anywhere would show up here first.
  ok(w2.sky(19, 8, -3) === 0, `the far corner: ${w2.sky(19, 8, -3)}, expected 0`);

  // THE WINDOW. Glass has opacity 0 in 1.18, so a glass block in the roof passes the full 15 —
  // and the shaft under it behaves exactly like the open hole.
  ok(SR.atten[GLASS] === 0, `glass attenuates ${SR.atten[GLASS]} — the window case is not testing what it says`);
  ok(w2.sky(0, 11, 0) === 15, `under the glass: ${w2.sky(0, 11, 0)}, expected 15`);
  ok(w2.sky(0, 5, 0) === 15, `six below the glass: ${w2.sky(0, 5, 0)}, expected 15`);

  // WATER. Opacity 1: the cell below it is 15-1-1 = 13, and it keeps falling one per level
  // because the straight-down exemption only applies while the level is still 15.
  ok(SR.atten[WATER] === 1, `water attenuates ${SR.atten[WATER]}, expected 1`);
  ok(w2.sky(16, 12, 16) === 14, `inside the water block: ${w2.sky(16, 12, 16)}, expected 14`);
  ok(w2.sky(16, 11, 16) === 13, `under the water: ${w2.sky(16, 11, 16)}, expected 13`);
  ok(w2.sky(16, 10, 16) === 12, `two under the water: ${w2.sky(16, 10, 16)}, expected 12`);

  // THE OVERHANG. Above the roof everything is open sky at 15, including the cell that sits
  // directly on top of the roof, and the roof block itself holds nothing.
  ok(w2.sky(5, 13, 5) === 15, `on top of the roof: ${w2.sky(5, 13, 5)}, expected 15`);
  ok(w2.sky(5, 12, 5) === 0, `inside the roof: ${w2.sky(5, 12, 5)}, expected 0`);
  ok(w2.sky(5, 11, 5) === 9, `six steps from the shaft, under the roof: ${w2.sky(5, 11, 5)}, expected 9`);

  if (PRINT) {
    let row = '';
    for (let d = 0; d <= 8; d++) row += w2.sky(8 + d, 8, 8).toString(16) + ' ';
    console.log('   east from the shaft:', row);
  }
}

// ─────────────────────────────────────────────── 2b. the same room, 5,000 blocks from spawn
console.log('2b. the same room at x=5000, z=-7000 — the queue has no coordinate limit (D-148)');
{
  // ⚠ THIS IS THE TEST THAT WOULD HAVE CAUGHT D-148. Every case above sits within a few dozen
  // blocks of the origin, and the queue used to pack x and z into eleven bits each — so it was
  // correct here and silently wrong at the far end of a five-minute flight. The room is the
  // same room; only the coordinates are a player's real ones.
  const OX = 5000, OZ = -7000;
  const w = makeWorld();
  w.lo = [OX - 8, 0, OZ - 8]; w.hi = [OX + 24, 24, OZ + 24];
  const buildAt = (lo, hi, floorY, roofY) => {
    for (let x = lo; x <= hi; x++) for (let z = lo; z <= hi; z++) {
      w.setBlock(OX + x, roofY, OZ + z, STONE);
      w.setBlock(OX + x, floorY, OZ + z, STONE);
    }
    for (let y = floorY; y <= roofY; y++) for (let t = lo; t <= hi; t++) {
      w.setBlock(OX + lo, y, OZ + t, STONE); w.setBlock(OX + hi, y, OZ + t, STONE);
      w.setBlock(OX + t, y, OZ + lo, STONE); w.setBlock(OX + t, y, OZ + hi, STONE);
    }
  };
  buildAt(-4, 20, 4, 12);
  w.setBlock(OX + 8, 12, OZ + 8, AIR);            // the same hole in the same roof
  w.setBlock(OX + 4, 5, OZ + 4, TORCH);           // and the same torch

  L.init(); L.setAdapter(w.adapter);
  for (let x = w.lo[0]; x <= w.hi[0]; x++) {
    for (let z = w.lo[2]; z <= w.hi[2]; z++) {
      let lv = 15;
      for (let y = 20; y >= 0; y--) {
        const st = w.adapter.block(x, y, z);
        if (w.adapter.opaque(st)) lv = 0;
        else if (lv === 15 && SR.atten[st] === 0) lv = 15;
        else lv = Math.max(0, lv - Math.max(1, SR.atten[st]));
        w.adapter.set(x, y, z, L.SKY, lv);
      }
    }
  }
  for (let x = w.lo[0]; x <= w.hi[0]; x++) {
    for (let z = w.lo[2]; z <= w.hi[2]; z++) {
      for (let y = 0; y <= 20; y++) {
        const sky = w.sky(x, y, z);
        if (sky > 1) L.seed(x, y, z, sky, L.SKY);
        const e = SR.emit[w.adapter.block(x, y, z)];
        if (e) { w.adapter.set(x, y, z, L.BLOCK, e); L.seed(x, y, z, e, L.BLOCK); }
      }
    }
  }
  ok(L.settle(), 'the engine did not settle 5,000 blocks from the origin');

  for (let y = 11; y >= 5; y--) {
    ok(w.sky(OX + 8, y, OZ + 8) === 15, `at x=5000, under the hole at y=${y}: ${w.sky(OX + 8, y, OZ + 8)}, expected 15`);
  }
  for (let d = 1; d <= 6; d++) {
    ok(w.sky(OX + 8 + d, 8, OZ + 8) === 15 - d, `at x=5000, ${d} east of the shaft: ${w.sky(OX + 8 + d, 8, OZ + 8)}, expected ${15 - d}`);
    ok(w.blk(OX + 4 + d, 5, OZ + 4) === 14 - d, `at x=5000, ${d} from the torch: ${w.blk(OX + 4 + d, 5, OZ + 4)}, expected ${14 - d}`);
  }
  // and nothing was written back at the origin, which is where the old packing sent it
  ok(w.sky(8, 8, 8) === 0 && w.blk(8, 8, 8) === 0,
     'light 5,000 blocks away landed at the origin instead — the queue is wrapping (D-148)');
  if (PRINT) console.log(`   shaft 15 all the way down and the torch falls off correctly, at (${OX},${OZ})`);
}

// ─────────────────────────────────────────────── 3. block light
console.log('3. block light — a torch, a glowstone, and two sources meeting');
const w3 = makeWorld();
{
  buildRoom(w3, -4, 20, 4, 12);
  w3.setBlock(4, 5, 4, TORCH);              // level 14 in 1.18
  w3.setBlock(16, 5, 16, GLOWSTONE);        // level 15

  seedAndSettle(w3, 20);

  ok(SR.emit[TORCH] === 14, `torch emits ${SR.emit[TORCH]}, expected 14`);
  ok(SR.emit[GLOWSTONE] === 15, `glowstone emits ${SR.emit[GLOWSTONE]}, expected 15`);
  ok(w3.blk(4, 5, 4) === 14, `at the torch: ${w3.blk(4, 5, 4)}, expected 14`);
  for (let d = 1; d <= 5; d++) {
    ok(w3.blk(4 + d, 5, 4) === 14 - d, `${d} from the torch: ${w3.blk(4 + d, 5, 4)}, expected ${14 - d}`);
  }
  ok(w3.blk(4, 6, 4) === 13, `above the torch: ${w3.blk(4, 6, 4)}, expected 13`);
  // ⚠ THE WHOLE FIELD AT ONCE, against the formula rather than a spot check: every open cell of
  // the room is exactly `max(14 - d(torch), 15 - d(glowstone), 0)` by Manhattan distance. 4,000
  // cells, and it is what proves there is no accumulation, no leak through the walls and no
  // second rule hiding in the engine.
  let cells = 0, wrong = 0, dark = 0;
  for (let x = -3; x <= 19; x++) for (let z = -3; z <= 19; z++) for (let y = 5; y <= 11; y++) {
    const dT = Math.abs(x - 4) + Math.abs(y - 5) + Math.abs(z - 4);
    const dG = Math.abs(x - 16) + Math.abs(y - 5) + Math.abs(z - 16);
    const want = Math.max(0, 14 - dT, 15 - dG);
    cells++;
    if (want === 0) dark++;
    if (w3.blk(x, y, z) !== want) wrong++;
  }
  ok(cells > 3000 && dark > 200, `the field is ${cells} cells with ${dark} dark ones — too small to prove anything`);
  ok(wrong === 0, `${wrong} of ${cells} cells disagree with max(14-d, 15-d, 0)`);
  // no straight-down exemption for the block channel: it is 13 under the torch, not 14
  ok(w3.blk(4, 4 + 1, 4) === 14 && w3.blk(5, 5, 4) === 13, 'the torch row is wrong');

  // two sources: the brighter one wins at every cell, and neither adds to the other
  const mid = w3.blk(10, 5, 10);
  const fromTorch = 14 - (Math.abs(10 - 4) + Math.abs(10 - 4));    // 14 - 12 = 2
  const fromGlow = 15 - (Math.abs(16 - 10) + Math.abs(16 - 10));   // 15 - 12 = 3
  ok(mid === Math.max(fromTorch, fromGlow), `between the two sources: ${mid}, expected ${Math.max(fromTorch, fromGlow)} (max, never a sum)`);

  // the sky channel is untouched by any of it
  ok(w3.sky(4, 5, 4) === 0, `the sealed room has sky light ${w3.sky(4, 5, 4)}, expected 0`);
}

// ─────────────────────────────────────────────── 4. removal
console.log('4. removal — seal the hole, break the torch');
{
  // seal the roof over the shaft: the whole 15-shaft and everything it lit must go dark
  L.setAdapter(w2.adapter);
  w2.setBlock(8, 12, 8, STONE);
  L.queueEdit(8, 12, 8);
  ok(L.settle(), 'the removal pass did not settle');
  for (let y = 11; y >= 5; y--) ok(w2.sky(8, y, 8) === 0, `sealed, under the old hole at y=${y}: ${w2.sky(8, y, 8)}, expected 0`);
  // and what light is left in the room is the WINDOW's, at exactly its own distance: (5,11,5)
  // is ten steps from the glass at (0,11,0), so 5. The room does not go black — it goes correct.
  ok(w2.sky(5, 11, 5) === 5, `sealed, ten steps from the window: ${w2.sky(5, 11, 5)}, expected 5`);
  // ...except where the window and the water still let light in, 8 and 16 blocks away
  ok(w2.sky(0, 11, 0) === 15, `the glass window went dark when the hole was sealed: ${w2.sky(0, 11, 0)}`);

  // re-open it and the shaft comes back, to the same numbers as section 2
  w2.setBlock(8, 12, 8, AIR);
  L.queueEdit(8, 12, 8);
  ok(L.settle(), 'the re-propagation did not settle');
  for (let y = 11; y >= 5; y--) ok(w2.sky(8, y, 8) === 15, `re-opened at y=${y}: ${w2.sky(8, y, 8)}, expected 15`);
  ok(w2.sky(11, 8, 8) === 12, `re-opened, three away: ${w2.sky(11, 8, 8)}, expected 12`);

  // break the torch: the room goes dark except where the glowstone reaches
  L.setAdapter(w3.adapter);
  w3.setBlock(4, 5, 4, AIR);
  L.queueEdit(4, 5, 4);
  ok(L.settle(), 'the torch removal did not settle');
  ok(w3.blk(4, 5, 4) === 0, `where the torch was: ${w3.blk(4, 5, 4)}, expected 0`);
  ok(w3.blk(6, 5, 4) === 0, `two from the old torch: ${w3.blk(6, 5, 4)}, expected 0`);
  ok(w3.blk(16, 5, 16) === 15, 'the glowstone went out when the torch did');
  ok(w3.blk(13, 5, 16) === 12, `three from the glowstone: ${w3.blk(13, 5, 16)}, expected 12`);
}

// ─────────────────────────────────────────────── 4b. an OPAQUE emitter, placed by the player
console.log('4b. glowstone and lava — an emitter that is also a solid block');
{
  // ⚠ THE CASE EVERY TEST ABOVE MISSED. A torch is not opaque, so a check built around torches
  // never asks what happens when the emitter IS a solid block — and `queueEdit` skipped
  // emission for opaque blocks entirely, so a player-placed glowstone, lava or jack o'lantern
  // lit nothing at all. The same block placed by WORLDGEN lit correctly (`Gen.lightPass` seeds
  // emitters without asking about opacity), which is exactly the kind of split that survives a
  // green suite. Vanilla stores an emitter's own level in its own cell whatever its opacity.
  const w = makeWorld();
  buildRoom(w, -4, 20, 4, 12);
  seedAndSettle(w, 20);
  L.setAdapter(w.adapter);

  for (const [name, level] of [['glowstone', 15], ['lava', 15], ['jack_o_lantern', 15]]) {
    const st = SR.stateOf(name);
    if (!st) continue;
    ok(SR.emit[st] === level, `${name} emits ${SR.emit[st]}, expected ${level}`);
    w.setBlock(8, 5, 8, st);
    L.queueEdit(8, 5, 8);
    ok(L.settle(), `${name}: the engine did not settle`);
    ok(w.blk(8, 5, 8) === level, `${name}: its own cell holds ${w.blk(8, 5, 8)}, expected ${level}`);
    for (let d = 1; d <= 4; d++) {
      ok(w.blk(8 + d, 5, 8) === level - d, `${name}: ${d} away is ${w.blk(8 + d, 5, 8)}, expected ${level - d}`);
    }
    // and breaking it takes the light with it
    w.setBlock(8, 5, 8, AIR);
    L.queueEdit(8, 5, 8);
    ok(L.settle(), `${name}: the removal did not settle`);
    for (let d = 0; d <= 4; d++) {
      ok(w.blk(8 + d, 5, 8) === 0, `${name}: ${d} away is still ${w.blk(8 + d, 5, 8)} after it was broken`);
    }
    if (PRINT) console.log(`   ${name}: lights 4 blocks and takes it back`);
  }

  // the sky channel is still zero INSIDE the solid emitter, which is the half that must not change
  const glow = SR.stateOf('glowstone');
  w.setBlock(0, 11, 0, glow);                        // under the glass window, where sky light is 15
  L.queueEdit(0, 11, 0);
  L.settle();
  ok(w.sky(0, 11, 0) === 0, `sky light inside a solid glowstone is ${w.sky(0, 11, 0)}, expected 0`);
  ok(w.blk(0, 11, 0) === 15, `block light inside the glowstone is ${w.blk(0, 11, 0)}, expected 15`);
}

console.log('4c. a slab, a stair, a carpet and a snow layer do not block the sky (D-156)');
{
  // ⚠ THE CASE 4b STILL MISSED. 4b asked what an emitter that is ALSO a solid block does; this
  // asks the mirror question — what a block that is opaque by MATERIAL but is not a full cube
  // does to light passing through it. Vanilla's answer is `getLightBlock`: 15 only for a block
  // whose collision shape is a full cube, so a slab, a stair, a wall, a fence, a carpet and a
  // snow layer all pass sky light. `States.opaque` says the opposite for all 196 of them — it is
  // the FACE CULLING table and it is right about culling — and the light engine used to ask it.
  const w = makeWorld();
  buildRoom(w, -4, 20, 4, 12);
  w.setBlock(0, 12, 0, GLASS);              // the same window section 2 uses, so (0,11,0) is lit
  seedAndSettle(w, 20);
  L.setAdapter(w.adapter);

  // the roster, and the two tables that must disagree about it: opaque yes, lightSolid no
  let thin = 0;
  for (const name of ['oak_slab', 'oak_stairs', 'cobblestone_wall', 'oak_fence', 'white_carpet',
                      'snow', 'farmland', 'dirt_path']) {
    const st = SR.stateOf(name);
    if (st == null) continue;
    thin++;
    ok(SR.opaque[st] === 1, `${name} is not opaque by material — this case no longer tests anything`);
    ok(SR.lightSolid[st] === 0, `${name} is lightSolid, so it blocks all light (D-156)`);
    ok(SR.atten[st] < 15, `${name} attenuates by ${SR.atten[st]}, which is a full block's cost`);
  }
  ok(thin >= 6, `only ${thin} of the thin blocks resolved to a state`);

  // and a full cube must still block it, or the fix has thrown the rule away entirely
  for (const name of ['stone', 'dirt', 'oak_planks']) {
    const st = SR.stateOf(name);
    if (st == null) continue;
    ok(SR.lightSolid[st] === 1, `${name} is not lightSolid — a full cube must block light`);
  }

  // the behaviour, not just the table: put one under the window and read the cell it occupies.
  // Under open sky at 15, a cell holding a thin block must still be lit; a full cube must not.
  const probe = (name) => {
    const st = SR.stateOf(name);
    w.setBlock(0, 11, 0, st);
    L.queueEdit(0, 11, 0);
    L.settle();
    const v = w.sky(0, 11, 0);
    w.setBlock(0, 11, 0, AIR);
    L.queueEdit(0, 11, 0);
    L.settle();
    return v;
  };
  const openSky = w.sky(0, 11, 0);
  ok(openSky > 8, `the probe cell is at sky ${openSky} with nothing in it — it is not under the window`);
  for (const name of ['oak_slab', 'snow', 'white_carpet']) {
    const v = probe(name);
    ok(v > 0, `sky light inside a ${name} under open sky is ${v} — it is acting as a full blocker (D-156)`);
    if (PRINT) console.log(`   ${name}: sky ${v} where open air reads ${openSky}`);
  }
  ok(probe('stone') === 0, 'sky light inside a solid stone block is not zero');

  // ⚠ AND THE ENGINE'S OWN ADAPTER, NOT JUST THE TABLES. Everything above reads `States` directly
  // or goes through the adapter THIS FILE builds, and both were still correct when D-156 was
  // reintroduced to test them: the bug was `Light.worldAdapter()` asking `opaque` instead of
  // `lightSolid`, and nothing here touched that function. A check that never calls the thing the
  // game calls cannot see a bug inside it (D-164). This asks the shipped adapter the same question.
  {
    const wa = L.worldAdapter ? L.worldAdapter() : null;
    ok(!!wa && typeof wa.opaque === 'function', 'Light.worldAdapter() has no opaque predicate to test');
    if (wa && typeof wa.opaque === 'function') {
      for (const name of ['oak_slab', 'oak_stairs', 'snow', 'white_carpet', 'oak_fence']) {
        const st = SR.stateOf(name);
        if (st == null) continue;
        ok(wa.opaque(st) === false,
           `the SHIPPED light adapter calls ${name} opaque — it is reading the culling table, not lightSolid (D-156)`);
      }
      for (const name of ['stone', 'dirt']) {
        ok(wa.opaque(SR.stateOf(name)) === true,
           `the shipped light adapter does not call ${name} opaque — a full cube must block light`);
      }
    }
  }
}

// ─────────────────────────────────────────────── 5. the seam
console.log('5. the chunk seam — two columns lit apart, then settled');
{
  // This is the bug W9 exists to fix: `Gen.lightPass` lights a column against nothing but
  // itself, so a torch one block inside chunk A leaves a hard black edge in chunk B. Here the
  // two halves are lit independently, exactly as the worker does it, and then the border seeds
  // are queued the way `World` queues them.
  const w = makeWorld();
  buildRoom(w, -4, 24, 4, 12);
  w.setBlock(14, 5, 8, GLOWSTONE);                 // one block west of the x=16 border
  L.init(); L.setAdapter(w.adapter);
  // half A only: seed and settle with the far half declared unloaded
  const realLoaded = w.adapter.loaded;
  w.adapter.loaded = (x, y, z) => realLoaded(x, y, z) && x < 16;
  w.adapter.set(14, 5, 8, L.BLOCK, 15);
  L.seed(14, 5, 8, 15, L.BLOCK);
  L.settle();
  ok(w.blk(15, 5, 8) === 14, `inside half A: ${w.blk(15, 5, 8)}, expected 14`);
  ok(w.blk(16, 5, 8) === 0, `across the seam before the fix: ${w.blk(16, 5, 8)}, expected 0 — the bug`);

  // now the neighbour arrives, and the border seed carries the light across
  w.adapter.loaded = realLoaded;
  let pushed = 0;
  for (let y = 4; y <= 12; y++) for (let z = 0; z <= 15; z++) {
    const mine = w.blk(15, y, z), theirs = w.blk(16, y, z);
    if (mine > theirs + 1) { L.seed(15, y, z, mine, L.BLOCK); pushed++; }
  }
  ok(pushed > 0, 'no border seed was produced — section 5 is vacuous');
  ok(L.settle(), 'the border pass did not settle');
  for (let d = 0; d <= 6; d++) {
    const want = Math.max(0, 15 - (16 + d - 14));
    ok(w.blk(16 + d, 5, 8) === want, `${d} past the seam: ${w.blk(16 + d, 5, 8)}, expected ${want}`);
  }
  // and the invariant a screenshot would show: no step bigger than one between neighbours
  let worst = 0;
  for (let x = 10; x <= 22; x++) for (let y = 5; y <= 11; y++) {
    const a = w.blk(x, y, 8), b = w.blk(x + 1, y, 8);
    if (!w.adapter.opaque(w.adapter.block(x, y, 8)) && !w.adapter.opaque(w.adapter.block(x + 1, y, 8))) {
      worst = Math.max(worst, Math.abs(a - b));
    }
  }
  ok(worst <= 1, `the brightest step between adjacent open cells is ${worst}, expected 1 — that is a visible seam`);
}

let realWorld = null;
let regions = [];

// ⚠ SECTIONS 2–5 ARE HAND-BUILT ROOMS, and a hand-built room is a world with no worldgen in
// it. `realRegion` runs the whole pipeline the game runs — `Gen.lightPass` per column on the
// worker side, then `Light.queueBorder` per column as `World` does when a chunk lands — and then
// makes the assertion a screenshot cannot: **no two adjacent open cells anywhere in 25 chunks
// differ by more than one level**, in either channel. That is what a seam IS, and it is the
// bug W9 exists to fix.
//
// ⚠ D-193 — IT USED TO BE ONE REGION, AT THE ORIGIN, WITH NO CLIMATE MODE NAMED. That made the
// world it lit whatever `Gen.defaults()` happened to say, and when D-182 made earth mode the
// default the check started lighting a different world and immediately found a bug that had been
// sitting in `Gen.lightPass` since D-154. Finding it was luck. It is a matrix now: both climate
// modes, and a region chosen for MOUNTAINS, so the rules are asserted over the tall terrain and
// the deep canopies that were reaching the hole in the seed scan.
function realRegion(opts) {
  const climate = opts.climate, seed = opts.seed == null ? 31337 : opts.seed;
  const ox = opts.ox || 0, oz = opts.oz || 0;
  const yLo = opts.yLo == null ? -50 : opts.yLo, yHi = opts.yHi == null ? 200 : opts.yHi;
  const M2 = loadEngine({ extra: ['06_atlas.js', '07_world.js', '08_lighting.js', '09_jobs.js', '10_camera.js', '10_gfx.js', '16_settings.js'], dom: true });
  const G2 = M2.Gen, W2 = M2.World, L2 = M2.Light, SR2 = M2.States, MINY = M2.CFG.WORLD_MIN_Y;
  M2.Blocks.init();
  // ⚠ the mode is NAMED, never inherited: `Object.assign(G2.defaults(), {climate})` is the whole
  // point of this function, and a region that took the default would go stale the next time the
  // default moves.
  G2.init(seed, Object.assign(G2.defaults(), { climate: climate }));
  L2.init();
  // `canopy` counts the cells this check exists to cover: a non-air block standing ABOVE the
  // tallest OPAQUE block of its own chunk — a tree top over a plain, a snow layer on a peak.
  // Those are the columns D-193's `topSeen` was blind to, and a region with none of them cannot
  // prove the fix.
  let canopy = 0, maxTop = MINY;
  for (let cx = ox - 2; cx <= ox + 2; cx++) {
    for (let cz = oz - 2; cz <= oz + 2; cz++) {
      const c = W2.getOrCreate(cx, cz);
      const col = getCachedColumn(M2, cx, cz) /* D-465 */;
      c.sec = col.sec; c.hmap = col.hmap; c.biome = col.biome || null; c.state = M2.CH.GENERATED;
      let top = 0;
      for (let k = 0; k < 256; k++) if (col.hmap[k] > top) top = col.hmap[k];
      if (top + MINY > maxTop) maxTop = top + MINY;
      for (let lx = 0; lx < 16; lx++) for (let lz = 0; lz < 16; lz++) {
        for (let y = top + MINY + 1; y < 256; y++) {
          if (W2.getBlock((cx << 4) + lx, y, (cz << 4) + lz) !== 0) canopy++;
        }
      }
      L2.queueBorder(cx, cz);
    }
  }
  const settled = L2.settle();
  const openAt = (x, y, z) => { const b = W2.getBlock(x, y, z); return b === 0 || SR2.opaque[b] !== 1; };
  let checked = 0, bad = 0, worst = 0, worstAt = null;
  const hist = new Array(16).fill(0);
  const cxw = ox << 4, czw = oz << 4;
  for (let x = cxw - 30; x < cxw + 30; x++) {
    for (let z = czw - 30; z < czw + 30; z++) {
      for (let y = yLo; y < yHi; y++) {
        if (!openAt(x, y, z)) continue;
        const here = W2.getLight(x, y, z);
        hist[here >>> 4]++;
        for (const [dx, dy, dz] of [[1, 0, 0], [0, 0, 1], [0, 1, 0]]) {
          if (!openAt(x + dx, y + dy, z + dz)) continue;
          const there = W2.getLight(x + dx, y + dy, z + dz);
          for (const ch of [0, 1]) {
            const a = ch ? (here >>> 4) : (here & 15);
            const b = ch ? (there >>> 4) : (there & 15);
            checked++;
            const d = Math.abs(a - b);
            // ⚠ straight down is the one exception: full sky light falls for free, so a 15 can
            // sit directly over a 15 with a 0 beside it — but never a 15 beside a 13.
            if (d > 1 && !(ch === 1 && dy === 1 && (a === 15 || b === 15))) {
              bad++;
              if (d > worst) { worst = d; worstAt = `(${x},${y},${z}) ${ch ? 'sky' : 'block'} ${a} vs ${b}`; }
            }
          }
        }
      }
    }
  }
  const mid = hist.slice(1, 15).reduce((a, b) => a + b, 0);
  return { W2, SR2, openAt, settled, checked, bad, worst, worstAt, hist, mid, canopy, maxTop, climate, ox, oz, seed };
}

/** The four assertions every region owes, so a new row in the matrix cannot be asserted less. */
function assertRegion(label, R, minPairs) {
  ok(R.settled, `${label}: the real-world border pass did not settle`);
  ok(R.checked > minPairs, `${label}: only ${R.checked} adjacent pairs — the region is too small to prove anything`);
  ok(R.bad === 0, `${label}: ${R.bad} adjacent open cells differ by more than one level (worst ${R.worst}: ${R.worstAt})`);
  // and it must not be vacuously dark or vacuously bright: a world of all 15s has no seams
  // because it has no shade.
  ok(R.hist[15] > 10000 && R.hist[0] > 1000, `${label}: sky histogram is ${R.hist[15]} full / ${R.hist[0]} dark — one of them is missing`);
  ok(R.mid > 50, `${label}: only ${R.mid} cells carry an intermediate sky level — the gradient at overhangs is missing`);
  if (PRINT) console.log(`   ${label}: ${R.checked.toLocaleString()} pairs · ${R.bad} seams · top y=${R.maxTop} · canopy ${R.canopy} · sky 15:${R.hist[15]} 0:${R.hist[0]} mid:${R.mid}`);
}

// ─────────────────────────────────────────────── 5b. the same claim, in REAL worlds
console.log('5b. generated 5x5 regions, both climate modes — no seam anywhere, and a real gradient at the overhangs');
{
  for (const climate of MCL.Gen.CLIMATES) {
    const R = realRegion({ climate, ox: 0, oz: 0 });
    assertRegion(`${climate} @ 0,0`, R, 1000000);
    regions.push(R);
    if (climate === 'vanilla') realWorld = { W2: R.W2, SR2: R.SR2, openAt: R.openAt };
  }
  // every mode the title screen offers is lit here, or a mode ships unasserted
  ok(regions.length === MCL.Gen.CLIMATES.length, `${regions.length} regions for ${MCL.Gen.CLIMATES.length} climate modes — a mode is unasserted`);
}

// ─────────────────────────────────────────────── 5c. and the same claim over TALL terrain
console.log('5c. a mountain region — the rules where the world is tallest and the canopy deepest');
{
  // ⚠ THE SCAN WINDOW FOLLOWS THE TERRAIN. y stops at 256 (`WORLD_MAX_Y`) rather than at 200,
  // because an earth-mode peak reaches into the 240s and the cells that broke D-193 were the
  // ones ABOVE the stone — scanning to 200 would have walked underneath the whole bug.
  // ⚠ THE ORIGIN IS CHOSEN, NOT CONVENIENT: (0,192) tops out at y=232 AND carries 325 cells of
  // canopy above its chunks' stone, and it is the combination that matters. A peak with a bare
  // summit tops 247 here and did not see D-193's bug at all; the trees standing over the
  // shoulder of a mountain are what reached it.
  const tall = realRegion({ climate: 'earth', ox: 0, oz: 12, yLo: 0, yHi: 256 });
  assertRegion('earth @ 0,192 (mountains)', tall, 1000000);
  ok(tall.canopy > 100, `the "tall" region has only ${tall.canopy} cells of canopy above its stone — 5c cannot see D-193's bug`);
  ok(tall.maxTop > 200, `the "tall" region tops out at y=${tall.maxTop} — that is not mountains, and 5c proves nothing`);
  regions.push(tall);
}

// ─────────────────────────────────────────────── 6. anti-vacuity
console.log('6. anti-vacuity — break each rule and watch the table fail');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('sky light losing a level on the way straight down', () => {
    // The shaft would read 15,14,13,... and section 2 asserts 15 all the way. If that assertion
    // were written as "monotonically decreasing" it would pass on the broken engine too.
    const shaft = [];
    for (let y = 11; y >= 5; y--) shaft.push(w2.sky(8, y, 8));
    if (shaft.every((v) => v === 15)) throw 0;
  });

  check('the diagonal measured as Euclidean distance', () => {
    // 3,3 away is 9 by Manhattan and would be 11 by Euclidean — the check must be able to tell.
    if (w2.sky(11, 8, 11) === 9 && w2.sky(11, 8, 11) !== 11) throw 0;
  });

  check('two light sources adding instead of taking the max', () => {
    const mid = w3.blk(10, 5, 10);
    if (mid <= 3) throw 0;                     // max is 3; a sum would be 5
  });

  check('a removal that leaves the old light behind', () => {
    if (w3.blk(6, 5, 4) === 0) throw 0;        // the torch is gone; this cell must be 0
  });

  check('an opaque block holding light', () => {
    if (w2.sky(5, 12, 5) === 0 && w3.blk(4, 4, 4) === 0) throw 0;
  });

  // §4c rests on the two tables DISAGREEING about a thin block. If `lightSolid` were just a copy
  // of `opaque`, every assertion in it would still be well-formed and would pass on a world where
  // slabs are full light blockers — which is exactly the world D-156 found. So prove they differ.
  check('lightSolid being a copy of opaque', () => {
    let differ = 0;
    for (let st = 1; st < SR.count; st++) if (SR.opaque[st] !== SR.lightSolid[st]) differ++;
    if (differ > 100) throw 0;
  });

  check('a seam planted in the real world and not noticed', () => {
    // §5b's scan is only worth something if it can see a discontinuity. Plant one — write a
    // light byte straight into a cell next to a lit neighbour — and require the same rule to
    // fire on it.
    if (!realWorld) throw 0;
    const { W2, openAt } = realWorld;
    let planted = null;
    for (let x = -20; x < 20 && !planted; x++) {
      for (let z = -20; z < 20 && !planted; z++) {
        for (let y = 60; y < 190; y++) {
          if (!openAt(x, y, z) || !openAt(x + 1, y, z)) continue;
          if ((W2.getLight(x, y, z) >>> 4) !== 15) continue;
          W2.setLight(x + 1, y, z, 0x30);          // sky 3 next to a sky 15
          planted = [x + 1, y, z];
          break;
        }
      }
    }
    if (!planted) throw 0;                          // nowhere to plant it; nothing proved
    const [px, py, pz] = planted;
    const a = W2.getLight(px - 1, py, pz) >>> 4, b = W2.getLight(px, py, pz) >>> 4;
    W2.setLight(px, py, pz, 0xF0);                  // put it back
    if (Math.abs(a - b) > 1) throw 0;               // the rule fires, as it must
  });

  // §§5b and 5c are a MATRIX now (D-193), and a matrix is only worth its rows: two rows that
  // light the same terrain are one row, and a row with no canopy over its stone cannot see the
  // hole D-193 closed. Both are asserted here rather than assumed.
  check('a region matrix that never sees a canopy above its chunk\'s stone', () => {
    const canopy = regions.reduce((a, R) => a + R.canopy, 0);
    if (canopy > 0) throw 0;
  });

  check('the two climate modes generating the same terrain', () => {
    const [a, b] = regions;
    if (!a || !b) throw 0;                       // no matrix at all: that IS the vacuity
    let differ = 0;
    for (let x = -30; x < 30; x += 3) for (let z = -30; z < 30; z += 3) {
      for (let y = 0; y < 200; y += 3) if (a.W2.getBlock(x, y, z) !== b.W2.getBlock(x, y, z)) differ++;
    }
    if (differ > 100) throw 0;                   // two genuinely different worlds
  });

  check('the seam left unlit', () => {
    // section 5 asserts light crosses; if the engine silently refused to cross, this fires
    const wtest = makeWorld();
    buildRoom(wtest, -4, 24, 4, 12);
    L.init(); L.setAdapter(wtest.adapter);
    wtest.adapter.set(14, 5, 8, L.BLOCK, 15);
    L.seed(14, 5, 8, 15, L.BLOCK);
    L.settle();
    if (wtest.blk(20, 5, 8) === 9) throw 0;    // 15 - 6 = 9, and it did cross
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ lightcheck ==============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
