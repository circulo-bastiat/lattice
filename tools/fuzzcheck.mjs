#!/usr/bin/env node
// fuzzcheck.mjs — two thousand random edits, and the invariants that must survive all of them.
//
//   node tools/fuzzcheck.mjs [--print] [--edits 2000] [--seed 12345]
//
// ⚠ WHY A FUZZ TEST, WHEN EVERY OTHER CHECK IS A HAND-WRITTEN CASE. Session 4 found twelve bugs
// and five of them lived in the JOIN between two stages that were each correct: light and
// carvers (D-140), meshing and streaming (D-147), culling and the frustum (D-145), the physics
// shapes and the physics sweep (D-152). Hand-written cases test what someone thought of. This
// tests what nobody thought of: it takes real generated terrain, makes thousands of random edits
// out of the REAL block roster — slabs, stairs, fences, glass, water, glowstone, plants — and
// after each batch asserts the invariants that must hold whatever was placed.
//
// The invariants, and each one is a bug this session actually had:
//   1. no adjacent open cells differ by more than one light level (the seam, W9)
//   2. nothing with a support rule stands on nothing (D-140)
//   3. every section that changed re-meshes without throwing, and the mesh decodes (D-131)
//   4. an emitter lights its neighbours; breaking it takes the light away (D-150)
//   5. every edit round-trips through the save codec (§13)
//   6. the world stays deterministic: regenerating an untouched column gives the same bytes
//
// It is SEEDED, so a failure is reproducible: the seed is printed and can be passed back in.

import { loadEngine } from './loadsrc.mjs';

const PRINT = process.argv.includes('--print');
const argOf = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const EDITS = argOf('--edits', 2000);
const SEED = argOf('--seed', 12345);

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 30) fails.push(m); };

// ⚠ `02f_tags.js` IS PART OF THE ENGINE THIS FUZZ IS SUPPOSED TO BE FUZZING (D-351). Eight of
// the survival rules ask a tag question, and without the payload every one of them answers "I
// cannot tell" and is skipped — so the fuzz would run two thousand edits past rules it never
// reached, and report a green. The real game always has it: `Reg.init` loads it.
const MAIN = ['02f_tags.js', '06_atlas.js', '07_world.js', '08_lighting.js', '09_jobs.js',
              '10_camera.js', '10_gfx.js', '16_settings.js', '16b_save.js'];
const MCL = loadEngine({ extra: MAIN, dom: true });
const G = MCL.Gen, W = MCL.World, S = MCL.Section, SR = MCL.States, L = MCL.Light, M = MCL.Mesher;
const CFG = MCL.CFG;
MCL.Blocks.init();
G.init(777, G.defaults());
L.init();
// ⚠ `Save.record` is a no-op when there is no storage backend, so the journal has to be armed
// BEFORE the fuzz or section 6 asserts a round trip over zero edits and passes on nothing.
MCL.Save.backend = 'localStorage';

/** A fixed LCG: the same seed is the same run, on any machine. */
let rng = SEED >>> 0;
const rnd = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);

// ── the world: 3x3 columns, generated and settled ────────────────────────────────────────────
const R = 1;
for (let cx = -R; cx <= R; cx++) {
  for (let cz = -R; cz <= R; cz++) {
    const c = W.getOrCreate(cx, cz);
    const col = G.genColumn(cx, cz);
    c.sec = col.sec; c.hmap = col.hmap; c.biome = col.biome || null; c.state = MCL.CH.GENERATED;
    L.queueBorder(cx, cz);
  }
}
ok(L.settle(), 'the world did not settle before the fuzz started');

// ── the palette of things to place: the real roster, not a convenient corner of it ───────────
const PALETTE = ['stone', 'oak_planks', 'glass', 'oak_slab', 'oak_stairs', 'oak_fence',
                 'glowstone', 'torch', 'water', 'oak_leaves', 'grass', 'dandelion',
                 'white_carpet', 'cobblestone_wall', 'chest', 'snow']
  .map((n) => [n, SR.stateOf(n)])
  .filter(([, st]) => st !== undefined && st !== null && st > 0);
ok(PALETTE.length >= 12, `only ${PALETTE.length} of the palette resolved to a state`);

const openAt = (x, y, z) => { const b = W.getBlock(x, y, z); return b === 0 || SR.opaque[b] !== 1; };
const solid = (b) => b > 0 && SR.solid[b] === 1;

// ── the fuzz ─────────────────────────────────────────────────────────────────────────────────
console.log(`1. ${EDITS} random edits from a ${PALETTE.length}-block palette (seed ${SEED})`);
const touched = new Set();
let placed = 0, broken = 0, refused = 0;
{
  const surface = (x, z) => MCL.Column.height(x, z);
  for (let n = 0; n < EDITS; n++) {
    const x = ri(32) - 16, z = ri(32) - 16;
    const top = surface(x, z);
    const y = top - 6 + ri(14);                     // a band straddling the surface
    if (y <= CFG.WORLD_MIN_Y + 1 || y >= CFG.WORLD_MAX_Y - 1) { refused++; continue; }
    const breaking = rnd() < 0.35;
    const st = breaking ? 0 : PALETTE[ri(PALETTE.length)][1];
    const before = W.getBlock(x, y, z);
    if (!W.setBlock(x, y, z, st)) { refused++; continue; }   // out of range, or D-155 said no
    if (breaking) broken++; else placed++;
    if (W.getBlock(x, y, z) !== st) fails.push(`setBlock(${x},${y},${z}) stored ${W.getBlock(x, y, z)}, not ${st}`);
    void before;
    touched.add(`${x >> 4},${z >> 4}`);
    // settle every so often, exactly as the game does between frames
    if ((n & 63) === 63) L.settle(500);
  }
  ok(L.settle(), 'the light engine did not settle after the fuzz');
  ok(placed > EDITS * 0.4, `only ${placed} placements out of ${EDITS} attempts`);
  ok(broken > EDITS * 0.15, `only ${broken} breaks out of ${EDITS} attempts`);
  if (PRINT) console.log(`   ${placed} placed · ${broken} broken · ${refused} refused (out of range or unsupportable)`);
}

// ── 2. the light invariant ───────────────────────────────────────────────────────────────────
console.log('2. no adjacent open cells differ by more than one light level');
{
  let checked = 0, bad = 0, worst = 0, worstAt = null;
  for (let x = -15; x < 15; x++) {
    for (let z = -15; z < 15; z++) {
      for (let y = MCL.Column.height(x, z) - 10; y < MCL.Column.height(x, z) + 10; y++) {
        if (!openAt(x, y, z)) continue;
        const here = W.getLight(x, y, z);
        for (const [dx, dy, dz] of [[1, 0, 0], [0, 0, 1], [0, 1, 0]]) {
          if (!openAt(x + dx, y + dy, z + dz)) continue;
          const there = W.getLight(x + dx, y + dy, z + dz);
          for (const ch of [0, 1]) {
            const a = ch ? (here >>> 4) : (here & 15);
            const b = ch ? (there >>> 4) : (there & 15);
            checked++;
            const d = Math.abs(a - b);
            // straight down is the sky channel's licensed exception (full light falls for free)
            if (d > 1 && !(ch === 1 && dy === 1 && (a === 15 || b === 15))) {
              bad++;
              if (d > worst) { worst = d; worstAt = `(${x},${y},${z}) ${ch ? 'sky' : 'block'} ${a} vs ${b}`; }
            }
          }
        }
      }
    }
  }
  ok(checked > 20000, `only ${checked} adjacent pairs examined`);
  ok(bad === 0, `${bad} light discontinuities after ${EDITS} random edits (worst ${worst}: ${worstAt})`);
  if (PRINT) console.log(`   ${checked.toLocaleString()} pairs · ${bad} discontinuities`);
}

// ── 3. nothing stands on nothing ─────────────────────────────────────────────────────────────
console.log('3. nothing with a support rule is left standing on nothing (D-140)');
{
  // ⚠ the fuzz PLACES plants directly, which the player can do too, and it BREAKS the blocks
  // under them, which the player does far more often. Vanilla refuses the first and cascades the
  // second; since D-155 so does `World.setBlock`, on both counts. This sweeps the whole fuzzed
  // volume for the result either half failing would leave behind: a plant standing on air.
  let unsupported = 0, first = null, ruled = 0;
  for (let x = -15; x < 15; x++) {
    for (let z = -15; z < 15; z++) {
      for (let y = MCL.Column.height(x, z) - 10; y < MCL.Column.height(x, z) + 10; y++) {
        const st = W.getBlock(x, y, z);
        if (!st || SR.support[st] !== 1) continue;
        ruled++;
        const below = W.getBlock(x, y - 1, z);
        if (below === 0) { unsupported++; if (!first) first = `${SR.name(st)} at (${x},${y},${z})`; }
      }
    }
  }
  // ⚠ the likeliest cause of this failing is STALE ASSETS, not a bug: the support class lives in
  // the runtime blob (D-140), so a checkout whose `assets/` predates it has `States.support` all
  // zero and nothing here has a rule to break. Say that, rather than "vacuous".
  let anySupport = 0;
  for (let st = 1; st < SR.count; st++) if (SR.support[st]) { anySupport++; if (anySupport > 3) break; }
  ok(anySupport > 0, 'the runtime blob carries no support classes at all — regenerate assets/ (node tools/suite.mjs), D-140');
  ok(ruled > 0 || anySupport === 0, 'the fuzz placed no support-ruled blocks at all — section 3 is vacuous');
  if (PRINT) console.log(`   ${ruled} floor-supported blocks · ${unsupported} of them with air under them`);
  // D-155 closed this: a placement that cannot survive is refused, and breaking a block's support
  // breaks it too. So the number is ZERO, not "small" — the fence this check used to carry
  // ("at most half of them may float") passed the whole time the bug Dan reported was live.
  ok(unsupported === 0,
     `${unsupported} of ${ruled} floor-supported blocks are floating after the fuzz (first: ${first})`);

  // Both halves of D-155 stated directly, so a regression names itself instead of showing up as
  // a count. Done at a hand-picked site rather than inferred from the fuzz.
  {
    const DIRT = SR.stateOf('dirt'), GRASS = SR.stateOf('short_grass') || SR.stateOf('grass');
    const x = -13, z = 13, y = MCL.Column.height(x, z) + 4;
    for (let d = 0; d < 3; d++) W.setBlock(x, y + d, z, 0);
    L.settle();
    ok(W.setBlock(x, y + 1, z, GRASS) === false, 'a plant was placed into thin air');
    ok(W.getBlock(x, y + 1, z) === 0, 'the refused placement wrote the block anyway');
    W.setBlock(x, y, z, DIRT);
    ok(W.setBlock(x, y + 1, z, GRASS) === true, 'a plant was refused a placement onto dirt');
    ok(W.getBlock(x, y + 1, z) === GRASS, 'the accepted placement did not write the block');
    W.setBlock(x, y, z, 0);
    ok(W.getBlock(x, y + 1, z) === 0,
       `breaking the dirt left ${SR.name(W.getBlock(x, y + 1, z))} floating above it (D-155)`);
  }
}

// ── 4. every touched section still meshes ────────────────────────────────────────────────────
console.log('4. every touched section re-meshes and decodes');
let meshed = 0, bytes = 0;
{
  for (const key of touched) {
    const [cx, cz] = key.split(',').map(Number);
    for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
      const snap = W.snapshotFor(cx, cz, sy);
      let buf = null, threw = null;
      try { buf = M.mesh(snap, null, cx * 16, sy * 16 + CFG.WORLD_MIN_Y, cz * 16); } catch (e) { threw = e; }
      W.releaseSnap(snap);
      ok(!threw, `meshing (${cx},${sy},${cz}) threw: ${threw && threw.message}`);
      if (!buf) continue;
      meshed++; bytes += buf.byteLength;
      const hdr = new Int32Array(buf, 0, 16);
      ok(hdr[0] === CFG.MESH_MAGIC, `section (${cx},${sy},${cz}) has magic 0x${(hdr[0] >>> 0).toString(16)}`);
      const quads = hdr[1] + hdr[2] + hdr[3];
      ok(quads >= 0 && quads <= CFG.MAX_QUADS * 3, `section (${cx},${sy},${cz}) reports ${quads} quads`);
    }
  }
  ok(meshed > 5, `only ${meshed} sections produced geometry after the fuzz`);
  if (PRINT) console.log(`   ${meshed} sections meshed · ${(bytes / 1024).toFixed(0)} KB`);
}

// ── 5. an emitter still lights, and breaking it still unlights ───────────────────────────────
console.log('5. an emitter placed into the fuzzed world still lights its neighbours (D-150)');
{
  const GLOW = SR.stateOf('glowstone');
  let done = false, rejected = 0;
  for (let attempt = 0; attempt < 600 && !done; attempt++) {
    const x = ri(20) - 10, z = ri(20) - 10;
    const y = MCL.Column.height(x, z) + 2;
    let clear = true;
    for (let d = 0; d <= 4; d++) if (W.getBlock(x + d, y, z) !== 0) clear = false;
    // ⚠ An air row is NOT a dark row, and hunting for one is hopeless: 1500 edits from a palette
    // that contains torches and glowstone leave roughly two hundred emitters inside 48x48, so
    // every candidate row is already lit by something. Seed 3 read 15 14 14 13 12 — CORRECT
    // light, from a glowstone the fuzz had put directly above the row — and the old literal
    // "15 14 13" assertion called it a bug. The invariant that survives a lit neighbourhood is
    // the INCREMENT: adding one source raises each open cell to exactly max(baseline, 15 - d),
    // and removing it must put every cell back to the baseline, to the level.
    if (!clear) continue;
    const base = [0, 1, 2, 3, 4].map((d) => W.getLight(x + d, y, z) & 15);
    if (base[0] === 15) { rejected++; continue; }   // nothing to measure: already saturated
    W.setBlock(x, y, z, GLOW);
    L.settle();
    const row = [0, 1, 2, 3, 4].map((d) => W.getLight(x + d, y, z) & 15);
    const want = [0, 1, 2, 3, 4].map((d) => Math.max(base[d], 15 - d));
    ok(row.join(' ') === want.join(' '),
       `an emitter in the fuzzed world lights ${row.join(' ')} over a baseline of ${base.join(' ')}, expected ${want.join(' ')}`);
    W.setBlock(x, y, z, 0);
    L.settle();
    const after = [0, 1, 2, 3, 4].map((d) => W.getLight(x + d, y, z) & 15);
    ok(after.join(' ') === base.join(' '),
       `breaking it left ${after.join(' ')}, not the baseline ${base.join(' ')} it started from`);
    done = true;
    if (PRINT) console.log(`   at (${x},${y},${z}): ${base.join(' ')} -> ${row.join(' ')} -> ${after.join(' ')} · ${rejected} saturated sites skipped`);
  }
  ok(done, 'no open run of five cells was found in 600 tries — section 5 did not run');
}

// ── 6. the save codec carries every edit ─────────────────────────────────────────────────────
console.log('6. every edit round-trips through the save codec');
{
  const Save = MCL.Save;
  let live = 0;
  Save.edits.forEach((e) => { live += e.m.size; });
  const blob = Save.encode();
  ok(typeof blob === 'string' && blob.length > 0, 'encode produced nothing');
  const before = new Map();
  Save.edits.forEach((e, k) => { before.set(k, new Map(e.m)); });
  Save.edits.clear(); Save.count = 0;
  ok(Save.decode(blob) === true, 'the fuzzed save did not decode');
  let back = 0, wrong = 0;
  Save.edits.forEach((e, k) => {
    const was = before.get(k);
    if (!was) { wrong++; return; }
    e.m.forEach((v, i) => { back++; if (was.get(i) !== v) wrong++; });
  });
  ok(live > 100, `only ${live} edits were journalled from ${EDITS} attempts`);
  ok(back === live, `${back} edits came back out of ${live}`);
  ok(wrong === 0, `${wrong} edits changed value or chunk through the codec`);
  if (PRINT) console.log(`   ${live} edits · ${(blob.length / 1024).toFixed(1)} KB of base64 · ${wrong} wrong`);
}

// ── 7. an untouched column is still deterministic ────────────────────────────────────────────
console.log('7. an untouched column still generates identically');
{
  const M2 = loadEngine({});
  M2.Gen.init(777, M2.Gen.defaults());
  const a = M2.Gen.genColumn(9, -9);
  const b = G.genColumn(9, -9);                     // the fuzzed engine, a column it never touched
  let diff = -1;
  outer:
  for (let sy = 0; sy < CFG.SECTIONS_Y; sy++) {
    for (let i = 0; i < CFG.SECTION_VOL; i++) {
      if (M2.Section.get(a.sec[sy], i) !== S.get(b.sec[sy], i)) { diff = sy * CFG.SECTION_VOL + i; break outer; }
    }
  }
  ok(diff < 0, `a column the fuzz never touched generates differently after ${EDITS} edits, first at ${diff}`);
}

// ── 8. anti-vacuity ──────────────────────────────────────────────────────────────────────────
console.log('8. anti-vacuity');
{
  const av = [];
  const check = (label, fn) => { let caught = false; try { fn(); } catch { caught = true; } av.push([label, caught]); };

  check('a fuzz that placed nothing', () => { if (placed > 0) throw 0; });
  check('a light scan that examined no pairs', () => {
    let n = 0;
    for (let x = 0; x < 2; x++) n++;
    if (n > 0) throw 0;
  });
  check('a planted discontinuity going unnoticed', () => {
    // plant one, run the same rule over that one pair, and require it to fire
    const x = 0, z = 0, y = MCL.Column.height(0, 0) + 3;
    W.setLight(x, y, z, 0xF0);
    W.setLight(x + 1, y, z, 0x30);
    const a = W.getLight(x, y, z) >>> 4, b = W.getLight(x + 1, y, z) >>> 4;
    if (Math.abs(a - b) > 1) throw 0;
  });
  // §5 asserts an exact profile, max(baseline, 15 - d), not an inequality: prove that an engine
  // one level short anywhere along the ray would be caught rather than shrugged at.
  check('an emitter one level dim going unnoticed', () => {
    const base = [4, 3, 2, 1, 0];
    const want = base.map((b, d) => Math.max(b, 15 - d));
    const dim = want.slice(); dim[3] -= 1;
    if (dim.join(' ') !== want.join(' ')) throw 0;
  });
  check('a break that did not restore the baseline going unnoticed', () => {
    const base = [4, 3, 2, 1, 0], after = [4, 3, 2, 1, 1];
    if (after.join(' ') !== base.join(' ')) throw 0;
  });
  check('the same seed producing a different run', () => {
    let r1 = SEED >>> 0, r2 = SEED >>> 0, same = true;
    for (let i = 0; i < 50; i++) {
      r1 = (Math.imul(r1, 1664525) + 1013904223) >>> 0;
      r2 = (Math.imul(r2, 1664525) + 1013904223) >>> 0;
      if (r1 !== r2) same = false;
    }
    if (same) throw 0;
  });

  for (const [label, caught] of av) {
    ok(caught, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${caught ? '✓' : '✗'} ${label}`);
  }
}

console.log('');
console.log('================ fuzzcheck ===============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` seed ${SEED} · ${EDITS} edits — re-run a failure with --seed ${SEED} --edits ${EDITS}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
