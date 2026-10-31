#!/usr/bin/env node
// parcheck.mjs — PLAN W11's acceptance test: the world does not depend on who generated it.
//
//   node tools/parcheck.mjs [--print]
//
// PLAN W11: *"the determinism test from W3/W7 must still pass with parallelism on and worker
// count varied between 1, 2 and 8 — three runs, byte-identical output. This is the only test
// that catches a data race, and it must exist before W11 is called done."*
//
// ⚠ HOW A DATA RACE COULD EVEN HAPPEN HERE, which decides what this file has to do. MC-Lite's
// workers share NOTHING: no `SharedArrayBuffer` (the file:// constraint forbids it), no shared
// heap, one decoded registry per worker. So the classic race — two threads writing one array —
// is impossible by construction. What IS possible, and what has already bitten this project
// twice, is ORDER DEPENDENCE: a per-worker CACHE (the carvers' path cache, the features'
// placement cache, the biome memo) whose contents depend on which columns that worker happened
// to be handed. Two workers see two different sequences of columns; if any cache leaks state
// between columns, the same chunk comes out differently depending on the pool size, and the seam
// shows up in play as a wall through the middle of a cave.
//
// So the test is: run the SAME region through 1, 2 and 8 INDEPENDENT engine instances with the
// columns dealt out round-robin exactly as a pool of that size would, and compare every byte.
// Each instance is a separate `loadEngine`, which is a separate worker in every way that matters
// here — its own module scope, its own caches, its own registry.
//
// The two bugs §5 caught on its first run, and why the light transport is still deferred,
// are D-144.
//
// Sections:
//   1. one instance, twice — the floor: without this the rest proves nothing
//   2. 1 vs 2 vs 8 instances, columns dealt round-robin — the stated acceptance
//   3. deal order — the same pool given the columns in reverse and in a shuffled order
//   4. meshing — the same section meshed by different instances, byte for byte
//   5. light — the border pass settles to the same answer whatever order chunks arrive in
//   6. the OTHER half of "who generated it" — a feature reaching several chunks must be judged
//      the same by every one of them, not only by the chunk its origin sits in (D-213)
//   7. anti-vacuity

import { loadEngine } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const SEED = 90210;
let PARSIX = null;                                  // what section 6 built, re-used by section 7
const REGION = [];
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) REGION.push([cx, cz]);

/** One "worker": its own engine, its own caches. */
function spawn() {
  const M = loadEngine({});
  // ⚠ CLIMATE EXPLICIT (D-182). This file is testing ORDER DEPENDENCE, not any one mode's
  // numbers — vanilla is picked here only so every spawned instance agrees on what world it is
  // racing to reproduce, rather than each one silently taking `G.defaults()`'s current default.
  M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  return M;
}

/** Every block of one column, flat, comparable. */
function columnBytes(M, cx, cz) {
  const CFG = M.CFG, S = M.Section;
  const col = M.Gen.genColumn(cx, cz);
  const out = new Int32Array(CFG.SECTIONS_Y * CFG.SECTION_VOL);
  let n = 0;
  for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    for (let i = 0; i < CFG.SECTION_VOL; i++) out[n++] = S.get(col.sec[sy], i);
  }
  return out;
}

function diff(a, b) {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return i;
  return -1;
}

/** Deal the region across `n` instances round-robin, as a pool of n workers would. */
function runPool(n, order) {
  const pool = [];
  for (let i = 0; i < n; i++) pool.push(spawn());
  const out = new Map();
  order.forEach(([cx, cz], k) => {
    out.set(cx + ',' + cz, columnBytes(pool[k % n], cx, cz));
  });
  return out;
}

// ─────────────────────────────────────────────── 1. the floor
console.log('1. one instance, the same column twice');
const single = spawn();
{
  const a = columnBytes(single, 1, -2);
  const b = columnBytes(single, 1, -2);
  ok(diff(a, b) === -1, 'the same instance generated the same column differently twice');
  let solid = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== 0) solid++;
  ok(solid > 20000, `the sample column has only ${solid} non-air blocks — the comparison is vacuous`);
  if (PRINT) console.log(`   ${solid.toLocaleString()} non-air blocks in the reference column`);
}

// ─────────────────────────────────────────────── 2. 1 vs 2 vs 8
console.log('2. one, two and eight instances, columns dealt round-robin');
const base = runPool(1, REGION);
{
  for (const n of [2, 8]) {
    const got = runPool(n, REGION);
    let bad = 0, firstBad = null;
    for (const [k, v] of base) {
      const d = diff(v, got.get(k));
      if (d !== -1) { bad++; if (!firstBad) firstBad = `${k} at index ${d}`; }
    }
    ok(bad === 0, `${bad} of ${base.size} columns differ with a pool of ${n} (first: ${firstBad})`);
  }
  ok(base.size === REGION.length, `the base run produced ${base.size} of ${REGION.length} columns`);
}

// ─────────────────────────────────────────────── 3. deal order
console.log('3. the same pool, different deal orders');
{
  const rev = REGION.slice().reverse();
  const shuffled = REGION.slice();
  // a fixed shuffle, so a failure is reproducible
  let s = 12345;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7FFFFFFF;
    const j = s % (i + 1);
    const t = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = t;
  }
  for (const [label, order] of [['reversed', rev], ['shuffled', shuffled]]) {
    const got = runPool(4, order);
    let bad = 0;
    for (const [k, v] of base) if (diff(v, got.get(k)) !== -1) bad++;
    ok(bad === 0, `${bad} columns differ when a pool of 4 is dealt the region ${label}`);
  }
}

// ─────────────────────────────────────────────── 4. meshing
console.log('4. the same section meshed by two instances');
{
  const A = spawn(), B = spawn();
  const CFG = A.CFG;
  const bytesOf = (M) => {
    // a 27-section snapshot built by hand, exactly the shape World.snapshotFor produces
    const cols = new Map();
    const col = (cx, cz) => {
      const k = cx + ',' + cz;
      if (!cols.has(k)) cols.set(k, M.Gen.genColumn(cx, cz));
      return cols.get(k);
    };
    const SY = 8;
    const nb = new Array(27);
    for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const slot = (dy + 1) * 9 + (dz + 1) * 3 + (dx + 1);
      const ny = SY + dy;
      nb[slot] = (ny < 0 || ny >= CFG.SECTIONS_Y) ? null : col(dx, dz).sec[ny];
    }
    const snap = { sy: SY, base: CFG.WORLD_MIN_Y + SY * 16, nb: nb, biome: null };
    const buf = M.Mesher.mesh(snap, null, 0, SY * 16 + CFG.WORLD_MIN_Y, 0);
    return { buf: buf ? new Uint8Array(buf) : new Uint8Array(0), vis: M.Mesher.lastVis };
  };
  const a = bytesOf(A), b = bytesOf(B);
  ok(a.buf.length > 0, 'the sample section produced no geometry — section 4 is vacuous');
  ok(a.buf.length === b.buf.length, `two instances meshed ${a.buf.length} and ${b.buf.length} bytes`);
  ok(diff(a.buf, b.buf) === -1, 'two instances produced different geometry for the same section');
  ok(a.vis === b.vis, `two instances disagree on the visibility mask: 0x${a.vis.toString(16)} vs 0x${b.vis.toString(16)}`);
  if (PRINT) console.log(`   section (0,8,0): ${a.buf.length} bytes, vis 0x${a.vis.toString(16)}`);
}

// ─────────────────────────────────────────────── 5. light, in any arrival order
console.log('5. the border light pass settles the same way whatever order chunks arrive in');
{
  // ⚠ THE ORDER DEPENDENCE THAT COULD ACTUALLY EXIST TODAY. Columns are lit against themselves
  // on the worker and the seams are settled on the main thread as neighbours arrive (D-142).
  // Chunks arrive in whatever order the workers finish, so the settled light MUST NOT depend on
  // that order — or a chunk looks different depending on which way the player flew into it.
  const M = loadEngine({ extra: ['08_lighting.js'] });
  const SR = M.States, L = M.Light;
  const STONE = SR.stateOf('stone'), GLOW = SR.stateOf('glowstone');

  function build(order) {
    const blocks = new Map(), light = new Map(), live = new Set();
    const key = (x, y, z) => `${x},${y},${z}`;
    const ck = (x, z) => `${x >> 4},${z >> 4}`;
    const ad = {
      block: (x, y, z) => blocks.get(key(x, y, z)) || 0,
      get: (x, y, z, ch) => { const b = light.get(key(x, y, z)) || 0; return ch === L.SKY ? (b >>> 4) : (b & 15); },
      set: (x, y, z, ch, lv) => {
        const b = light.get(key(x, y, z)) || 0;
        light.set(key(x, y, z), ch === L.SKY ? ((lv << 4) | (b & 15)) : ((b & 0xF0) | lv));
      },
      opaque: (st) => SR.opaque[st] === 1,
      atten: (st) => SR.atten[st],
      emit: (st) => SR.emit[st],
      loaded: (x, y, z) => y >= 0 && y <= 20 && live.has(ck(x, z)),
    };
    // a sealed corridor across four chunks with one glowstone in the middle of the first
    for (let x = -8; x < 56; x++) for (let z = -8; z < 24; z++) {
      blocks.set(key(x, 4, z), STONE); blocks.set(key(x, 8, z), STONE);
    }
    blocks.set(key(6, 5, 6), GLOW);
    L.init(); L.setAdapter(ad);
    for (const [cx, cz] of order) {
      live.add(`${cx},${cz}`);
      // the worker's own pass: the emitter, lit against nothing but its own column
      for (let x = cx * 16; x < cx * 16 + 16; x++) for (let z = cz * 16; z < cz * 16 + 16; z++) {
        const st = ad.block(x, 5, z);
        if (SR.emit[st]) { ad.set(x, 5, z, L.BLOCK, SR.emit[st]); L.seed(x, 5, z, SR.emit[st], L.BLOCK); }
      }
      L.queueBorder(cx, cz);
      L.settle();
    }
    return { ad, light };
  }

  const orderA = [[0, 0], [1, 0], [2, 0], [3, 0], [0, 1], [1, 1]];
  const orderB = [[3, 0], [1, 1], [1, 0], [0, 1], [2, 0], [0, 0]];
  const a = build(orderA), b = build(orderB);
  let cells = 0, lit = 0, differ = 0, firstAt = null;
  for (let x = 0; x < 56; x++) for (let z = 0; z < 24; z++) for (let y = 5; y <= 7; y++) {
    const la = a.ad.get(x, y, z, L.BLOCK), lb = b.ad.get(x, y, z, L.BLOCK);
    cells++;
    if (la > 0) lit++;
    if (la !== lb && !firstAt) firstAt = `(${x},${y},${z}) ${la} vs ${lb}`;
    if (la !== lb) differ++;
  }
  ok(lit > 200, `only ${lit} lit cells — the order test is vacuous`);
  ok(differ === 0, `${differ} of ${cells} cells depend on the order chunks arrived in (first: ${firstAt})`);
  // and it really did cross three chunk borders
  ok(a.ad.get(20, 5, 6, L.BLOCK) === 1, `light one chunk over: ${a.ad.get(20, 5, 6, L.BLOCK)}, expected 1 (15 - 14 steps)`);
  if (PRINT) console.log(`   ${lit} lit cells, identical under both arrival orders`);
}

// ─────────────────────────── 6. the same feature, judged by nine different chunks
console.log('6. a feature that reaches nine chunks is judged the same by all nine (D-213)');
{
  // ⚠ WHY THIS FILE DID NOT CATCH D-213, AND WHY THAT IS NOT A HOLE IN SECTIONS 1-5.
  //
  // D-213 sliced every tree in the world flat along the chunk grid, and parcheck ran green
  // through all of it. That is correct behaviour for what sections 1-5 assert. They ask whether
  // `genColumn(cx,cz)` gives the same bytes on every instance and in every arrival order, and it
  // did: `genColumn` is self-contained — it runs all nine source chunks' placements against its
  // OWN blocks and never consults a neighbour — so the clipping was perfectly deterministic. A
  // determinism test cannot see a bug that every instance commits identically.
  //
  // The invariant D-213 was actually breaking is the OTHER half of W11's claim, and nothing had
  // ever stated it: a placement is offered to every target chunk within its reach, and the
  // decision of WHETHER TO BUILD must be the same in all of them. When it is not, the chunks
  // disagree about whether a tree exists, each writes only its own answer, and the world has a
  // seam that no amount of re-running reproduces away. So: one instance, one placement, nine
  // targets, and the verdicts compared. Sections 1-5 are "the same chunk twice"; this is "the
  // same feature, nine chunks".
  const M = single;
  const F = M.Features, SR = M.States, CFG = M.CFG, H = CFG.CHUNK_H, MINY = CFG.WORLD_MIN_Y;
  const STONE = SR.stateOf('stone'), GRASS = SR.stateOf('grass_block');
  // the pre-feature world, built from the pure column function both sides of the guard read
  const pre = (cx, cz) => {
    const sb = new Uint16Array(H * 256);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const h = M.Column.height((cx << 4) + x, (cz << 4) + z) | 0;
      const top = Math.min(H - 1, h - MINY);
      for (let y = 0; y <= top; y++) sb[(y << 8) | (z << 4) | x] = STONE;
      if (top >= 0) sb[(top << 8) | (z << 4) | x] = GRASS;
    }
    return sb;
  };
  const NAMES = ['oak_checked', 'birch_checked', 'spruce_checked', 'acacia_checked',
                 'dark_oak_checked', 'fancy_oak_checked', 'mega_jungle_tree_checked'];
  // ⚠ A COASTLINE, CHOSEN BY A STATED PROPERTY. A verdict that is TRUE at all 256 positions is
  // indistinguishable from a constant, so the sample has to contain ground a tree cannot stand on
  // as well as ground it can. This walks a band of chunks — never the origin, D-148 — and takes
  // the first whose 3x3 is at least a quarter dry land and at least a tenth under the sea.
  const SEA = M.Gen.params.seaLevel;
  let CX = 0, CZ = 0, found = false;
  for (let az = -20; az <= 20 && !found; az++) {
    for (let ax = -20; ax <= 20 && !found; ax++) {
      if (!ax && !az) continue;
      let dry = 0, wet = 0, n = 0;
      for (let z = -16; z < 32; z += 2) for (let x = -16; x < 32; x += 2) {
        const h = M.Column.height((ax << 4) + x, (az << 4) + z) | 0;
        n++; if (h >= SEA) dry++; else wet++;
      }
      if (dry >= n / 4 && wet >= n / 10) { CX = ax; CZ = az; found = true; }
    }
  }
  ok(found, 'section 6 found no coastline chunk — its sample cannot contain a refused position');
  const sbs = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) sbs.push([CX + dx, CZ + dz, pre(CX + dx, CZ + dz)]);

  /** The nine verdicts on one inline placed feature at one position. */
  const verdicts = (inl, x, y, z) => sbs.map(([cx, cz, sb]) => F.inlineGuard(inl, sb, cx, cz, x, y, z, null));

  let asked = 0, yes = 0, split = 0; const firstSplit = [];
  for (const name of NAMES) {
    const inl = F.api.inline('minecraft:' + name, 'parcheck-6');
    ok(!!inl && inl.chain.some((m) => m.kind === 'predicate'),
       name + ': parcheck cannot get an inline placed feature with a guard on it');
    if (!inl) continue;
    for (let rz = 0; rz < 16; rz++) {
      for (let rx = 0; rx < 16; rx++) {
        const x = (CX << 4) + rx, z = (CZ << 4) + rz;
        const y = F.api.heightmapY(1, x, z);
        const v = verdicts(inl, x, y, z);
        asked++;
        if (v[4]) yes++;
        if (v.some((b) => b !== v[0])) {
          split++;
          if (firstSplit.length < 3) firstSplit.push(name + ' at ' + x + ',' + y + ',' + z + ': ' + v.map((b) => (b ? 1 : 0)).join(''));
        }
      }
    }
  }
  console.log('   chunk ' + CX + ',' + CZ + ' · ' + NAMES.length + ' guarded trees x 256 positions = ' + asked
              + ' placements judged by 9 chunks each · ' + yes + ' say build · ' + split + ' split');
  ok(asked === NAMES.length * 256, 'only ' + asked + ' of ' + (NAMES.length * 256) + ' positions were judged');
  // ⚠ BOTH ANSWERS HAVE TO BE IN THE SAMPLE, and a hundred of each is a population, not a rate
  // read off today’s world: a verdict that is true everywhere and one that is false everywhere
  // are both constants, and nine chunks agree on a constant for free.
  ok(yes >= 100, 'only ' + yes + ' of ' + asked + ' positions would build a tree at all — section 6 has no power');
  ok(asked - yes >= 100, 'only ' + (asked - yes) + ' of ' + asked + ' positions are refused — section 6 cannot tell a verdict from a constant');
  ok(split === 0, split + ' of ' + asked + ' placements are judged differently by the nine chunks they reach: ' + firstSplit.join(' | '));
  PARSIX = { sbs, CX, CZ, F };
}

// ─────────────────────────────────────────────── 7. anti-vacuity
console.log('7. anti-vacuity');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('two instances seeded differently would look identical', () => {
    const other = loadEngine({});
    other.Gen.init(SEED + 1, Object.assign(other.Gen.defaults(), { climate: 'vanilla' }));
    const a = columnBytes(single, 1, -2), b = columnBytes(other, 1, -2);
    if (diff(a, b) !== -1) throw 0;                    // they DO differ, so the comparison works
  });

  check('the byte comparison ignoring a changed block', () => {
    const a = columnBytes(single, 0, 0);
    const b = a.slice(); b[b.length >> 1] ^= 1;
    if (diff(a, b) !== -1) throw 0;
  });

  check('a region too small to deal across eight workers', () => {
    if (REGION.length >= 8) throw 0;
  });

  // ⚠ D-213's own bug, put back: judge an inline tree's guard from the TARGET chunk's blocks
  // rather than from the position. Eight of the nine read -1 at the trunk and refuse, which is
  // exactly the split section 6 asserts is never there.
  check('a tree judged by the chunk that is writing it instead of by its position (D-213)', () => {
    const { sbs, CX, CZ, F } = PARSIX;
    const inl = F.api.inline('minecraft:oak_checked', 'parcheck-7');
    const broken = { gen: inl.gen, chain: inl.chain, local: true };
    let split = 0;
    for (let rz = 0; rz < 16; rz++) for (let rx = 0; rx < 16; rx++) {
      const x = (CX << 4) + rx, z = (CZ << 4) + rz, y = F.api.heightmapY(1, x, z);
      const v = sbs.map(([cx, cz, sb]) => F.inlineGuard(broken, sb, cx, cz, x, y, z, null));
      if (v.some((b) => b !== v[0])) split++;
    }
    if (split > 0) throw 0;                            // it DOES split, so section 6 can fail
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================= parcheck ===============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
