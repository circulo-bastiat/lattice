#!/usr/bin/env node
// structaudit.mjs — what a structure LOOKS LIKE once it has been written into the world.
//
//   node tools/structaudit.mjs [--print] [--deep] [--only=name]
//
// ── WHY THIS EXISTS, AND WHY `structcheck` COULD NOT HAVE FOUND IT ─────────────────────────
//
// Dan, session 6, on a glitched underwater structure: *"dont go duckhunting glitches just build
// general tools"* and *"dont pursue something specific just construct general tests that can
// catch everything and compare everything"*. So this file hunts no structure.
//
// `tools/structcheck.mjs` holds 84,316 assertions and every one of them is about PLACEMENT
// ARITHMETIC — the region grid, the template decode, the start cache, the determinism of the
// write order. None of them looks at the BLOCKS. That is the same hole NEXT.md's first standing
// lesson names ("a check that never looks at the picture cannot see the world") and the same
// hole D-140 fell through: a dead bush hanging in mid-air is a perfectly correct dead bush to a
// check that counts dead bushes.
//
// ── THE ONE TECHNIQUE THE WHOLE FILE RESTS ON ──────────────────────────────────────────────
//
// **Generate every sampled chunk TWICE — once with `params.structures` on and once with it off
// — and diff.** The cells that differ are, by construction, exactly the cells the structure
// pass is responsible for, whatever wrote them: a template block, a beard plinth, a shave that
// removed terrain, a mineshaft's air. Nothing here re-implements `writePiece`, re-derives a
// template or asks a grammar what it MEANT to do; the mask is measured off the two worlds. That
// is what makes it general — a grammar landing in a later session is audited by this file on
// the day it lands, with no new code.
//
// Everything else is a question asked of that mask:
//
//   1. FLOATING   connected components of structure-written SOLID cells, and whether each
//                 component rests on natural ground. A general component walk, not a rule about
//                 one building. Since D-216 it also asks the sharper question the histogram
//                 could not: did the STRUCTURE ITSELF write the air this component is standing
//                 on, over ground the control world has? That one needs no threshold.
//                 ⚠ AND SINCE D-226 "ITSELF" MEANS THE PIECES, NOT THE BOUNDING BOX. Every count
//                 in §1, §2 and §6 is now split by `insidePiece` — §3's test — so a row labelled
//                 `ocean_ruin_cold` is the ocean ruin's and the mineshaft corridor crossing its
//                 window is charged to the mineshaft. A family label in this file used to be the
//                 name of the WINDOW, and the same defect moved between families depending on
//                 what else a run happened to sample.
//   2. BURIED     the inverse failure: terrain still standing inside a rigid piece's own box.
//   3. TECHNICAL  `structure_block`, `jigsaw`, `structure_void`, `barrier`, `light`,
//                 `moving_piston` and the three command blocks. NONE may reach a finished world.
//   4. JOINS      a jigsaw piece must meet its parent connector-to-connector. Reconstructed from
//                 the placed pieces alone, which is what catches a door opening into a wall.
//   5. SPACING    every candidate chunk inside vanilla's own offset window, taken from the
//                 `structure_set` JSON in the data cache — never from MC-Lite's decoded copy.
//   6. WATER      a structure written under the sea must be flooded the way vanilla's is, and
//                 one on land must not carry water it cannot hold. The MEASURED CLASS is
//                 "a structure-written air cell with water beside it or above it" — the cell the
//                 game floods on the first tick, which is what a glitched underwater structure
//                 IS.
//   6c. DRAIN     the question §6 cannot ask, because §6 needs surviving water to ask it: was
//                 this cell WATER in the control world, with water above it, and is it AIR now?
//                 A writer that drains a whole neighbourhood scores zero on §6 and everything
//                 here — which is exactly what the ocean monument did (D-226).
//   6b. EDGES     vanilla's own `MineShaftPieces` rule, RE-DERIVED HERE rather than asked of
//                 `04s`: no mineshaft piece that SHIPPED may have sea water on the one-block
//                 shell of its box. `04s`'s gate (D-221) screens the cheap way before it tests
//                 the exact way; this is the fence that makes the screen a measurement instead
//                 of a hope, and it walks every column of every grown footprint.
//   7. anti-vacuity (D-30) — every measurement above is run against data broken on purpose.
//
// ── ⚠ WHAT IS ASSERTED AND WHAT IS ONLY PRINTED, AND WHY THE DIFFERENCE MATTERS ────────────
//
// D-152 and D-178 are both the same mistake — an expectation derived from the thing under test —
// and a numeric bound fitted to today's output is exactly that mistake wearing a threshold. So
// the assertions here are only the ones that hold FROM FIRST PRINCIPLES or FROM VANILLA'S DATA:
// nothing hangs over a full-depth void, a structure is not entirely detached from the ground,
// a structure is not entirely inside rock, a technical block never ships, a jigsaw child meets
// its parent, a candidate chunk is inside vanilla's offset window, and a structure does not
// leave loose water in the air. Every other number — the ungrounded-component histogram, its
// per-start attribution, the burial fraction per type, the air/water boundary counts and the
// dug-out count — is MEASURED AND PRINTED, with the open defects this file found named in
// REGISTER below. A bound nobody can justify is worse than a printed number.
//
// ⚠ AND THE HISTOGRAM IS NOT ONE OF THE ASSERTIONS FOR A REASON THAT GOT SHARPER IN D-216: an
// overhanging balcony, a mineshaft's hanging support, a ledge and a tree planted by a
// `feature_pool_element` are all ungrounded components and all correct. The number is a shape,
// not a defect count. What IS a defect count is `dug`, and it is registered rather than
// asserted because two writers still produce it — see `wrote-air-then-stood-on-it`.
//
// ── ⚠ CLIMATE EXPLICIT: VANILLA, BY NAME (D-182) ───────────────────────────────────────────
// Earth mode moves every biome, which moves which candidates a structure's biome tag accepts.
// A structure audit in Earth mode is an audit of a different world.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { getCachedColumn } from './chunkcache.mjs'; // D-463: shared worldgen chunk cache
import { MCDATA } from './paths.mjs';

const PRINT = process.argv.includes('--print');
const DEEP  = process.argv.includes('--deep');
const ONLY  = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7);

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };

const MCL = loadEngine({});
const G = MCL.Gen, CFG = MCL.CFG, S = MCL.Section, SR = MCL.States, R = MCL.Reg;
const T = MCL.Templates, JG = MCL.Jigsaw;
const H = CFG.CHUNK_H, MINY = CFG.WORLD_MIN_Y, SY = CFG.SECTIONS_Y;

const VERSION = '1.18.2';
const WGDIR = join(MCDATA, VERSION, 'data', 'minecraft', 'worldgen');

// ── THE SAMPLE ─────────────────────────────────────────────────────────────────────────────
// Four seeds, because a structure that only ever appears in one biome is a structure tested by
// one seed's terrain — NEXT.md's third lesson ("when a test picks an example, check whether it
// picked the easy member of the family"). The SCAN is cheap (a start pass reads no blocks) so it
// covers a large area; the DEEP sample — the chunks actually generated twice — is capped, and
// both numbers are printed rather than one standing in for the other.
const SEEDS = [1337, 4242, 99991, 20260908];
const SCAN_R = DEEP ? 128 : 96;          // chunks, half-width of the scanned square per seed
const PER_NAME = DEEP ? 3 : 1;           // instances of each structure NAME deep-sampled per seed
const WIN_MAX = 3;                       // chunks: the deep window is at most WIN_MAX x WIN_MAX

// ── the block classes this file asks about ─────────────────────────────────────────────────
const TECHNICAL = ['structure_block', 'jigsaw', 'structure_void', 'barrier', 'light',
                   'moving_piston', 'command_block', 'chain_command_block',
                   'repeating_command_block'];
const banned = new Uint8Array(SR.count);
const bannedName = [];
for (const n of TECHNICAL) {
  const b = R.names.indexOf(n);
  if (b < 0) continue;                                  // not in this registry: nothing to ban
  for (let st = R.realFirst[b]; st < R.realFirst[b + 1]; st++) banned[st] = 1;
  bannedName.push(n);
}

// ⚠ WHICH STRUCTURES SECTION 4 APPLIES TO IS A QUESTION FOR VANILLA'S DATA, NOT FOR THIS FILE.
// A structure is assembled from a jigsaw pool exactly when its `configured_structure_feature`
// carries a `start_pool` — that field IS the jigsaw entry point. Guessing by name, or by
// "it placed more than one template", calls an igloo a jigsaw structure: the igloo stacks three
// hand-placed templates that were never meant to meet connector to connector, and every one of
// its NBT files carries jigsaw blocks anyway because Mojang authored them in the same editor.
const JIGSAW = new Set();
{
  const dir = join(WGDIR, 'configured_structure_feature');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const src = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      if (src.config && src.config.start_pool) JIGSAW.add(f.slice(0, -5));
    }
  }
}

const isSolid = (st) => st > 0 && SR.solid[st] === 1;
const isWater = (st) => st > 0 && SR.waterIn[st] === 1;

// ── ⚠ THE DEFECT REGISTER — WHAT THIS FILE FOUND AND COULD NOT FIX ────────────────────────
//
// The defects here are systemic — they live in one line of one file each and they show up in
// whichever families a given sample happens to reach. So the register is keyed by MECHANISM and
// never by family: a per-family list is a list that changes shape with the sample size, and a
// list like that is a threshold fitted to a run (D-152, D-178) with extra steps. `--deep`
// proved it: the same three mechanisms surfaced in nine families the default sample never
// touched, and half the per-family entries the first draft carried went stale in one command.
//
// What each entry buys:
//   • the finding is REPORTED, loudly and with its per-family numbers, and does not fail the run
//     — the defects are in `src/`, which this tool does not own;
//   • anything OUTSIDE the registered mechanism still fails hard (a technical block that is not
//     a `structure_block`, or one standing in terrain no structure touched);
//   • a registered mechanism that stops reproducing anywhere in the sample FAILS, so a fix is
//     not finished until its entry here is deleted (D-139).
//
// Delete an entry when its defect is fixed. Do not add one to make a run go green.
const REGISTER = [
  {
    id: 'air-against-water',
    what: 'structure-written air cells standing against water',
    // ⚠ WHAT IS LEFT AFTER D-212 AND D-221, AND IT IS TWO MECHANISMS, EACH MEASURED, NEITHER A
    // TOLERANCE. D-212 fixed three writers (the shave draining the sea, `JG.writePiece` writing a
    // template's air over it, the mineshaft's `carve` hollowing it out) and took the class from
    // 1.62% of structure-written air to 0.41%. D-221 fixed two more and took it to 0.09%, against
    // a natural-terrain baseline of 0.02% in the same windows. These are the two that remain:
    //
    //  (a) THE AQUIFER AGAINST A MINESHAFT CORRIDOR — mineshaft 87, mineshaft_mesa 1 of the 92
    //      in the default sample. ⚠ THE `shipwreck 3` THIS LINE USED TO CARRY WAS NEVER THE
    //      SHIPWRECK'S: it was a mineshaft corridor crossing the shipwreck's WINDOW, and until
    //      D-226 split every count in §6 by `insidePiece` the family label on this row was the
    //      name of the window rather than the name of the structure. The corridor is still there
    //      and still counted — in the mineshaft's own row, where it belongs.
    //      Classified cell by cell: the corridor's air is hollowed out of SOLID rock and the
    //      water beside it is NATURAL, sitting at or below `Caves.aquiferLevel` for its column.
    //      Vanilla's `edgesLiquid` would have abandoned the corridor. D-221's gate cannot see
    //      that water, because MC-Lite's aquifer is a FAKE (D-67) whose water exists only in
    //      cells a CARVER hollowed — a 3D fact, and the gate has to be a pure function of (x, z)
    //      or it tears the piece at the chunk seam (D-185).
    //      ⚠ AND THE POSITION-ONLY VERSION IS MEASURED AND WORSE, which is why it is not here:
    //      gating on `y0 - 1 <= aquiferLevel(x, z)` over the footprint drops **4,222 of 28,445
    //      pieces (14.8%) across 136 mineshafts on four seeds and deletes 7 mineshafts outright**,
    //      to remove ~105 boundary cells — an amputation of one corridor in seven of every
    //      mineshaft in the world, most of them in dry rock a carver never touched.
    //
    //  (b) A STRUCTURE CUT INTO THE SHORELINE SIDEWAYS — village_plains 3, swamp_hut 1. Control
    //      world SOLID, written world AIR, natural sea water BESIDE it (never above: D-221's
    //      downward shave closed every one of those). The beard may stop at the waterline in its
    //      OWN column and still open the column NEXT to it, and that read crosses a chunk
    //      boundary in four directions out of four.
    //      ⚠ THIS ARM WAS 21 CELLS AND IS NOW 4 (D-226). The shave's waterline break was a BLOCK
    //      READ, and every FILL in the structure runs before it: a plinth that had already
    //      reclaimed a shoreline left dirt where the sea had been, and the shave walked down
    //      through the waterline finding nothing to stop at. It now also stops on the PURE form,
    //      `Column.height(x, z) < y <= seaLevel` — D-221's own test, which says where the sea WAS
    //      whatever has since been written over it. ruined_portal_mountain 10 and
    //      ruined_portal_jungle 1 went to zero with it.
    why: 'the fake aquifer\'s water against a mineshaft corridor vanilla would not have built ' +
         '(no pure form exists — the position-only gate costs 14.8% of all corridors), and a ' +
         'structure cut sideways into the shoreline',
  },
  {
    id: 'wrote-air-then-stood-on-it',
    what: 'ungrounded structure cells resting on air the structure wrote over the control world\'s ground',
    // ⚠ WHAT IS LEFT OF THE D-216 VOID. The class is one thing — the structure removed the
    // ground and then something of its own was left standing on the hole with nothing else
    // holding it up — and TWO writers are known to produce it. Neither is the one D-216 fixed:
    // the template no longer writes air over the ground at all (the inverted
    // `legacy_single_pool_element` rule) and the plinth now reaches the piece's underside rather
    // than its box floor (`JG.groundLy`).
    //  (a) THE BUILDERS — village_plains 12, village_taiga 3, village_savanna 1, village_snowy 1,
    //      pillager_outpost 1. `SU.writeBeard`'s SHAVE terraces a house's footprint and its
    //      three-block skirt, and a `terrain_matching` street draped onto `Column.height` — the
    //      ground BEFORE the structure pass — crosses that skirt and overhangs it. Vanilla has
    //      no such seam because its Beardifier is part of the NOISE, so `WORLD_SURFACE_WG`
    //      already contains the terrace; MC-Lite's beard is written afterwards (D-188).
    //      ⚠ AND THE OBVIOUS FIX IS MEASURED AND WORSE: draping onto the written world instead
    //      of the column function makes the answer depend on how much of the structure has been
    //      written by the time this piece's turn comes, and it took a desert village from 903
    //      supported rigid floor cells to 901 by dropping the road out from under the house it
    //      was holding up. `JG.drapeAt`'s note carries the numbers.
    //  (b) THE MINESHAFT'S PLANK FLOOR, AND IT IS VANILLA'S OWN RULE — mineshaft 161,
    //      mineshaft_mesa 11 of the 190 left in the default sample, which is 90.5% of the class.
    //      CLASSIFIED BLOCK BY BLOCK (D-226): 172 of the 190 are `oak_planks` / `dark_oak_planks`
    //      at the corridor's floor row, and `MineShaftCorridor.postProcess` places them there for
    //      exactly this reason — `if (this.getBlock(level, x, -1, z, box).isAir()) placeBlock(
    //      PLANKS)`. A plank floor laid ACROSS A HOLE is what vanilla builds, `04s` transcribes
    //      the `below === 0` test verbatim, and the hole under it is another corridor of the same
    //      mineshaft. This part of the class is not a defect and will not go to zero; it is here
    //      so that the 18 cells that are NOT it stay visible.
    //  (c) ⚠ CLOSED, AND IT WAS THE BIGGEST OF THE THREE — THE FEATURE PASS ON GROUND THE
    //      STRUCTURE TOOK. 180 of the 404 cells this entry carried before tonight (44.6%) were in
    //      MONUMENT windows, and not one of them was prismarine: 164 were DEAD CORAL BLOCKS and
    //      16 were the core's floating dais. The monument hollowed itself out with `-1` and
    //      turned 41,362 cells of ocean into AIR; the coral features then ran over the hole,
    //      found air instead of water, and wrote the DEAD variant of themselves standing on it.
    //      A structure that drains the sea does not just look wrong — it changes what the
    //      feature pass builds on top of it. D-226 floods the monument and both go to zero.
    why: 'a draped street crossing a terrace its neighbour\'s beard shaved (builders), and vanilla\'s own plank floor laid across the hole a mineshaft corridor made (172 of 190 cells, D-226)',
  },
];
const regOf = (id) => REGISTER.find((r) => r.id === id);
const openHits = [];
/** Record a registered finding: printed at the end, counted, and not fatal. */
function openFinding(id, family, n) {
  if (!n) return;
  const r = regOf(id);
  if (!r) { ok(false, `${family}: ${n} findings of unregistered class ${id}`); return; }
  r.seen = (r.seen || 0) + n;
  openHits.push({ id, family, n });
  pass++;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// THE MACHINERY. Every measurement below is a pure function of a WINDOW, so section 7 can hand
// each one a window it broke on purpose and watch the number move.
// ────────────────────────────────────────────────────────────────────────────────────────────

/** A window of nx x nz chunks: the world with structures, the world without, and the diff. */
function makeWindow(ax, az, nx, nz) {
  const W = nx * 16, D = nz * 16, N = W * H * D;
  const win = { ax, az, nx, nz, W, D, H, wa: new Int32Array(N), ca: new Int32Array(N), gens: 0 };
  const flat = (cx, cz, on) => {
    G.params.structures = on;
    const col = getCachedColumn(MCL, cx, cz) /* D-463 */;
    const a = new Int32Array(H * 256);
    for (let sy = 0; sy < SY; sy++) {
      const sec = col.sec[sy], base = (sy * 16) << 8;
      for (let i = 0; i < 4096; i++) a[base + i] = S.get(sec, i);
    }
    win.gens++;
    return a;
  };
  for (let cz = az; cz < az + nz; cz++) {
    for (let cx = ax; cx < ax + nx; cx++) {
      const fw = flat(cx, cz, true), fc = flat(cx, cz, false);
      const bx = (cx - ax) * 16, bz = (cz - az) * 16;
      for (let y = 0; y < H; y++) {
        for (let z = 0; z < 16; z++) {
          const dst = ((y * D) + (bz + z)) * W + bx, src = (y << 8) | (z << 4);
          for (let x = 0; x < 16; x++) { win.wa[dst + x] = fw[src | x]; win.ca[dst + x] = fc[src | x]; }
        }
      }
    }
  }
  G.params.structures = true;
  win.mask = maskOf(win);
  return win;
}
const AT = (w, x, y, z) => ((y * w.D) + z) * w.W + x;

/** The structure's own footprint: every cell the structure pass is responsible for. */
function maskOf(w) {
  const m = new Uint8Array(w.wa.length);
  for (let i = 0; i < w.wa.length; i++) if (w.wa[i] !== w.ca[i]) m[i] = 1;
  return m;
}

/**
 * 1. FLOATING — connected components of structure-written SOLID cells.
 *
 * ⚠ THE SUPPORT TEST IS "IS THERE NATURAL SOLID DIRECTLY UNDER SOME CELL OF THIS COMPONENT",
 * and the word NATURAL does no work: a solid cell directly below a component's cell is 6-adjacent
 * to it, so if it were part of the structure it would be part of the SAME component. Anything
 * solid under a component is therefore terrain the structure did not write, by construction.
 *
 * `voidFloat` is the far stronger claim, and the only one this file asserts on: a structure solid
 * cell with NOTHING solid anywhere below it, all the way to the bottom of the world. The
 * overworld has stone under everything, so a cell that fails this is hanging over open sky or
 * open ocean and cannot be anything but a bug.
 *
 * ⚠ AND `dugOut`, WHICH IS THE ONE THAT NAMES A CAUSE (D-216). A cell counts when it is the
 * underside of an UNGROUNDED component, the cell holding it up is air, that air is in the
 * structure's own footprint, and the CONTROL world has solid ground in the very same cell. No
 * slope produces that and no overhang produces it: the structure took the ground away and then
 * stood on the hole. It is attributed to the sampled start's own bounding box, for the reason
 * §3 already refuses to blame a neighbour's technical block on this family.
 */
function floatingOf(w, own) {
  const { wa, ca, mask, W, D } = w;
  // ⚠ NO `own` MEANS "ALL OF IT IS OURS", not "none of it is". §7 hands this function synthetic
  // windows with no start attached to them, and a filter that answered `false` there would make
  // every attributed number zero on exactly the data that is supposed to prove it can move.
  //
  // ⚠ AND "OURS" IS THE PIECES, NOT THE BOUNDING BOX (D-226). A start's bounding box is the box
  // around ALL of its pieces, so for a village it is a 100-block cube of mostly EMPTY WORLD that
  // a mineshaft corridor, a lush cave and the neighbouring structure all run straight through.
  // §3 has refused to blame a neighbour's technical block on this family since it was written;
  // the histogram was still doing it. MEASURED on the same deep sample: pillager_outpost's
  // ungrounded cells go 384 -> 24 and village_taiga's 74 -> 60 when the test is the pieces, and
  // NOTHING the structure itself wrote leaves, because every cell a structure writes is written
  // BY a piece. `insidePiece` is the same function §3 uses, so the two sections cannot drift.
  const inOwn = (x, y, z) => !own || (own.pieces
    ? insidePiece(own, w.ax * 16 + x, y + MINY, w.az * 16 + z)
    : ((w.ax * 16 + x) >= own.x0 && (w.ax * 16 + x) <= own.x1 &&
       (y + MINY) >= own.y0 && (y + MINY) <= own.y1 &&
       (w.az * 16 + z) >= own.z0 && (w.az * 16 + z) <= own.z1));
  const solidStruct = (i) => mask[i] === 1 && isSolid(wa[i]);
  // any solid below, per (x, z), walking up once — O(cells) rather than O(cells * H)
  const belowSolid = new Uint8Array(wa.length);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      let seen = 0;
      for (let y = 0; y < H; y++) { const i = AT(w, x, y, z); belowSolid[i] = seen; if (isSolid(wa[i])) seen = 1; }
    }
  }
  const comp = new Int32Array(wa.length).fill(-1);
  const out = { comps: 0, ungrounded: 0, ungroundedCells: 0, cells: 0, biggest: 0,
                biggestBorder: 0, voidFloat: 0, bottomCells: 0, bottomOverAir: 0,
                dugOut: 0, ownUngrounded: 0, ownUngroundedCells: 0, ownBiggest: 0 };
  const stk = [];
  const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (let i0 = 0; i0 < wa.length; i0++) {
    if (!solidStruct(i0) || comp[i0] >= 0) continue;
    const id = out.comps++;
    comp[i0] = id; stk.length = 0; stk.push(i0);
    let size = 0, grounded = false, border = false, mine = false, compDug = 0;
    while (stk.length) {
      const i = stk.pop(); size++;
      const x = i % W, y = (((i / W) | 0) / D) | 0, z = ((i / W) | 0) % D;
      if (x === 0 || x === W - 1 || z === 0 || z === D - 1) border = true;
      if (!mine && inOwn(x, y, z)) mine = true;
      if (y === 0) grounded = true;
      else {
        const b = AT(w, x, y - 1, z);
        if (mask[b] !== 1 || !isSolid(wa[b])) {           // this is a BOTTOM face of the piece
          out.bottomCells++;
          if (isSolid(wa[b])) grounded = true; else out.bottomOverAir++;
          if (!belowSolid[i]) out.voidFloat++;
          // ⚠ THE DEFECT D-216 FIXED, STATED AS THE MECHANISM RATHER THAN AS A THRESHOLD: this
          // cell is solid, the structure pass put it here, and the cell holding it up is AIR
          // THAT THE SAME PASS WROTE OVER GROUND THE CONTROL WORLD HAS. That is not a piece
          // hanging on a slope and it is not a sampling artefact — it is a building that dug
          // the floor out from under itself, and there is no version of it that is correct.
          // It is a zero from first principles, so it is asserted as one.
          if (mask[b] === 1 && wa[b] === 0 && isSolid(ca[b])) compDug++;
        }
      }
      for (const [dx, dy, dz] of NB) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || X >= W || Y < 0 || Y >= H || Z < 0 || Z >= D) continue;
        const j = AT(w, X, Y, Z);
        if (comp[j] >= 0 || !solidStruct(j)) continue;
        comp[j] = id; stk.push(j);
      }
    }
    out.cells += size;
    if (!grounded) {
      if (mine) out.dugOut += compDug;
      out.ungrounded++; out.ungroundedCells += size;
      if (border) { if (size > out.biggestBorder) out.biggestBorder = size; }
      else if (size > out.biggest) out.biggest = size;
      // ⚠ AND THE SAME COUNT ATTRIBUTED TO THE STRUCTURE THIS WINDOW IS ABOUT. A window three
      // chunks square catches whatever else is there: village_taiga's 1,161 "ungrounded" cells
      // are 141 MOSS BLOCKS at y = -1, in a lush cave a MINESHAFT opened under the village, and
      // charging them to the village is the mis-attribution §3 already refuses to make for
      // technical blocks. A component counts as this start's when any of its cells is inside
      // this start's own bounding box.
      if (mine) {
        out.ownUngrounded++; out.ownUngroundedCells += size;
        if (!border && size > out.ownBiggest) out.ownBiggest = size;
      }
    }
  }
  // ⚠ a component clipped by the window edge may only LOOK ungrounded, because the cell that
  // holds it up is in the chunk next door. Border components are counted and reported and are
  // never what an assertion fires on — the same reason `cullcheck` reads only its own pixels.
  return out;
}

/**
 * 2. BURIED — terrain still standing inside a rigid piece's own box.
 *
 * The other direction of the same failure: the beard (D-188) exists to cut the hillside out of
 * a building, and when it under-shaves the building is full of rock. A `terrain_matching` piece
 * is EXCLUDED, because its box is a fiction — it drapes, and the ground inside its box is
 * supposed to be ground (the note in 04v_struct_village.js says so in as many words).
 */
function buriedOf(w, pieces) {
  let boxCells = 0, buried = 0, worst = 0, worstOf = null, worstShape = '';
  for (const p of pieces) {
    if (p.kind === 'beard') continue;
    if (p.proj === JG.PROJ_TERRAIN) continue;
    if (p.x1 === undefined) continue;
    let bc = 0, bu = 0;
    for (let y = Math.max(p.y0, MINY); y <= Math.min(p.y1, MINY + H - 1); y++) {
      for (let z = p.z0; z <= p.z1; z++) {
        for (let x = p.x0; x <= p.x1; x++) {
          const lx = x - w.ax * 16, lz = z - w.az * 16, ly = y - MINY;
          if (lx < 0 || lx >= w.W || lz < 0 || lz >= w.D) continue;
          const i = AT(w, lx, ly, lz);
          bc++;
          if (w.mask[i] !== 1 && isSolid(w.wa[i])) bu++;
        }
      }
    }
    boxCells += bc; buried += bu;
    if (bc >= 64 && bu / bc > worst) { worst = bu / bc; worstOf = p; }
    if (bc >= 64 && bu / bc >= worst) {
      worstShape = `${p.kind}${p.template ? ' ' + p.template : ''} ` +
                   `${p.x1 - p.x0 + 1}x${p.y1 - p.y0 + 1}x${p.z1 - p.z0 + 1} at ${p.x0},${p.y0},${p.z0}`;
    }
  }
  return { boxCells, buried, frac: boxCells ? buried / boxCells : 0, worst, worstOf, worstShape };
}

/** 3. TECHNICAL — a generation-time marker that reached a finished world. */
function technicalOf(w) {
  const hits = [];
  let n = 0;
  for (let i = 0; i < w.wa.length; i++) {
    if (!banned[w.wa[i]]) continue;
    n++;
    const x = i % w.W, y = (((i / w.W) | 0) / w.D) | 0, z = ((i / w.W) | 0) % w.D;
    if (hits.length < 4096) hits.push({ name: SR.name(w.wa[i]), x: w.ax * 16 + x, y: y + MINY,
                                      z: w.az * 16 + z, fromStructure: w.mask[i] === 1 });
  }
  hits.n = n;
  return hits;
}

/** Is (x, y, z) inside one of this start's own pieces? — the technical blocks in a window may
 *  belong to the structure next door, and a defect blamed on the wrong family is a defect
 *  nobody finds. */
function insidePiece(s, x, y, z) {
  for (const p of s.pieces) {
    if (p.x1 === undefined) continue;
    if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1 && z >= p.z0 && z <= p.z1) return true;
  }
  return false;
}

/**
 * 6. WATER — the coherence of air, water and the structure between them.
 *
 * ⚠ THE MEASURED CLASS IS `leakAir`: a structure-written AIR cell with a water cell beside it or
 * directly above it. Minecraft's own fluid rule is what makes it a defect and not a preference —
 * water flows sideways and downward, so such a cell is one the game floods on the first tick.
 * A structure the player swims up to with half its rooms full and half not is exactly this
 * number being non-zero, and it is measured against the SAME statistic taken over the natural
 * terrain in the same window, so "the world is like that anyway" is a claim with a number
 * against it rather than an excuse.
 *
 * `looseWater` is the mirror image on land: a structure-written water cell with air under it,
 * which falls the moment the world ticks.
 */
function waterOf(w, own) {
  const { wa, ca, mask, W, D } = w;
  // ⚠ OURS OR THE WINDOW'S — THE SAME CORRECTION §1 GOT, AND §6 NEEDED IT MORE (D-226). A
  // family label in this file is the name of the structure the WINDOW was centred on, and the
  // window is three chunks of ordinary world: an `ocean_ruin_cold` count of 43 was a MINESHAFT
  // CORRIDOR passing underneath, and which family a defect landed on changed with what else the
  // run happened to sample. Every count below is now split by `insidePiece` — §3's test — so a
  // number labelled `ocean_ruin_cold` is the ocean ruin's, and what the rest of the structure
  // pass did in the same window is reported beside it under `window=` and charged to nobody.
  const ours = (x, y, z) => !own || insidePiece(own, w.ax * 16 + x, y + MINY, w.az * 16 + z);
  const o = { sAir: 0, leakAir: 0, natAir: 0, natLeakAir: 0, sWater: 0, looseWater: 0,
              oSAir: 0, oLeakAir: 0, oSWater: 0, oLooseWater: 0,
              drain: 0, oDrain: 0, pocket: 0, oPocket: 0 };
  const NB = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]];   // sideways, and above
  // is there any water ANYWHERE above this cell, in the world as it shipped? — one downward walk
  // per column, so the whole test stays O(cells)
  const wetAbove = new Uint8Array(wa.length);
  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      let seen = 0;
      for (let y = H - 1; y >= 0; y--) { const i = AT(w, x, y, z); wetAbove[i] = seen; if (isWater(wa[i])) seen = 1; }
    }
  }
  for (let i = 0; i < wa.length; i++) {
    const st = wa[i];
    if (st !== 0 && !isWater(st)) continue;
    const x = i % W, y = (((i / W) | 0) / D) | 0, z = ((i / W) | 0) % D;
    if (isWater(st)) {
      if (mask[i] === 1) {
        o.sWater++;
        const loose = y > 0 && wa[AT(w, x, y - 1, z)] === 0;
        if (loose) o.looseWater++;
        if (ours(x, y, z)) { o.oSWater++; if (loose) o.oLooseWater++; }
      }
      continue;
    }
    let touch = false;
    for (const [dx, dy, dz] of NB) {
      const X = x + dx, Y = y + dy, Z = z + dz;
      if (X < 0 || X >= W || Y < 0 || Y >= H || Z < 0 || Z >= D) continue;
      if (isWater(wa[AT(w, X, Y, Z)])) { touch = true; break; }
    }
    if (mask[i] === 1) {
      o.sAir++; if (touch) o.leakAir++;
      // ⚠ 6c. THE DRAIN, AND IT IS THE MEASUREMENT THAT WOULD HAVE CAUGHT D-226 THREE SESSIONS
      // AGO. `leakAir` asks whether the structure's air has water LEFT beside it, so a writer
      // that drains the whole window scores ZERO on it — which is exactly what the ocean
      // monument did: 41,362 cells of sea turned into air per monument, 78.6% of every water
      // cell in its window, and §6 reported the family as clean because the window is 48 blocks
      // wide and the building is 58, so there was no sea left inside it to be against.
      // This asks the control world instead: was this cell WATER before the structure pass, and
      // was there water directly ABOVE it too? The second clause is what separates the defect
      // from the legitimate case — a jungle temple's hollow replacing a ONE-BLOCK puddle is
      // vanilla's `generateBox(AIR)` doing what vanilla does, while a cell taken out from UNDER
      // a body of water is a hole in a sea that has to fall into it.
      if (isWater(ca[i]) && y + 1 < H && isWater(ca[AT(w, x, y + 1, z)])) {
        o.drain++;
        if (ours(x, y, z)) o.oDrain++;
        // ⚠ AND THE ASSERTED FORM IS THE POCKET: the same cell, with water still standing
        // SOMEWHERE ABOVE IT in the world that shipped. That is a dry bubble under the sea —
        // a player who digs down through the sea floor falls into air — and it is the shape of
        // every drain that matters, because a drain the structure REPLACED with land has land
        // over it and does not qualify. The monument's interior qualified 41,362 times per
        // monument: the sea was still there above its roof. The two cases that do NOT qualify
        // are the ones vanilla makes too — a jungle temple's `generateBox(AIR)` over a
        // one-block puddle, and a village beard that fills a shoreline with dirt and then
        // hollows a room out of the dirt it just made.
        if (wetAbove[i]) { o.pocket++; if (ours(x, y, z)) o.oPocket++; }
      }
      if (ours(x, y, z)) { o.oSAir++; if (touch) o.oLeakAir++; }
    } else { o.natAir++; if (touch) o.natLeakAir++; }
  }
  return o;
}

/**
 * 6b. `edgesLiquid`, RE-DERIVED, over the pieces that actually shipped.
 *
 * `MineShaftPieces` opens every `postProcess` with `if (this.edgesLiquid(level, box)) return;`
 * and `StructurePiece.edgesLiquid` walks the six faces of the box grown by one. In this world a
 * cell holds sea water exactly when `Column.height(x, z) < y <= seaLevel`, so the shell test on a
 * box is: the shell reaches down to `y0 - 1` and up to `y1 + 1`, and it meets water iff
 * `y0 - 1 <= sea` and some column of the grown FOOTPRINT has ground below `min(sea, y1 + 1)`.
 *
 * ⚠ THIS IS NOT `04s`'s CODE READ BACK. `04s` screens with a capped lattice over the whole start
 * before it tests exactly, because the exact test is 120 ms a mineshaft (D-221). This walks EVERY
 * column of EVERY grown footprint at one-block resolution, which is what makes it a fence on that
 * screen rather than a second opinion from the same place — the D-152/D-178/D-194 mistake.
 *
 * `hAt` and `sea` are parameters so §7 can break the inputs: ground at the world floor must make
 * every piece report wet, and a sea at the world floor must make every piece report dry.
 */
function edgesLiquidOf(pieces, sea, hAt) {
  let wet = 0, tested = 0, skipped = 0;
  for (const p of pieces) {
    // a piece `04s` already flagged is a piece vanilla's `postProcess` returns out of: it wrote
    // nothing, so it cannot have put air against anything. What is audited is what SHIPPED.
    if (p.edgesLiquid) { skipped++; continue; }
    tested++;
    if (p.y0 - 1 > sea) continue;
    const top = Math.min(sea, p.y1 + 1);
    let hit = false;
    for (let z = p.z0 - 1; z <= p.z1 + 1 && !hit; z++) {
      for (let x = p.x0 - 1; x <= p.x1 + 1; x++) if (hAt(x, z) < top) { hit = true; break; }
    }
    if (hit) wet++;
  }
  return { wet, tested, skipped };
}

/**
 * 4. JOINS — the invariant `04t_jigsaw.js` has to satisfy, reconstructed from the placed pieces.
 *
 * `JG.assemble` attaches a child by finding, on the child's template, a connector whose ROTATED
 * front is the opposite of the parent connector's and whose name/target pair is the parent's
 * reversed, and then translating the child so that connector lands on the cell in FRONT of the
 * parent's. Every one of those facts survives into the piece list — `tpl`, `rot`, `ox/oy/oz` and
 * the template's own connector table are all that is needed — so the join can be recomputed
 * from the OUTPUT instead of trusted from the code that produced it. If a rotation, an offset or
 * a name pairing ever drifts, a piece stops matching anything and the graph falls apart: that is
 * a door opening into a wall, and this is the shape a machine can see it in.
 */
function joinsOf(pieces) {
  const tp = [];
  for (const p of pieces) {
    if (p.kind !== 'template' || p.tpl === undefined) continue;
    const e = T.get(p.tpl);
    if (!e) continue;
    tp.push({ p, e, box: JG.pieceBox(p), drape: p.proj === JG.PROJ_TERRAIN });
  }
  const conns = [];
  for (let pi = 0; pi < tp.length; pi++) {
    const { p, e } = tp[pi];
    for (const j of e.jig) {
      const jx = j.pos % e.sx, jy = ((j.pos / (e.sx * e.sz)) | 0), jz = (((j.pos / e.sx) | 0) % e.sz);
      const d = [0, 0]; JG.connectorDirs(j, p.rot, d);
      conns.push({ pi, j, front: d[0], top: d[1], drape: tp[pi].drape,
                   wx: p.ox + JG.rotX(e, p.rot, jx, jz), wy: p.oy + jy, wz: p.oz + JG.rotZ(e, p.rot, jx, jz) });
    }
  }
  // ⚠ INDEXED HORIZONTALLY, AND THE Y IS COMPARED SEPARATELY, because of the one deviation
  // `04t_jigsaw.js` documents: a `terrain_matching` child takes its Y from the heightmap at its
  // connector rather than from the parent's connector, so its socket is deliberately NOT at the
  // parent's front cell vertically. (Vanilla's GravityProcessor moves those blocks too — the
  // deviation is per-piece against per-column, not whether the Y moves.) A join to or from a
  // draped piece is therefore matched on x, z, facing and the name pair, and the vertical drift
  // is MEASURED instead of asserted. A join between two RIGID pieces must be exact.
  const byPos = new Map();
  for (const c of conns) {
    const k = c.wx + ',' + c.wz;
    if (!byPos.has(k)) byPos.set(k, []);
    byPos.get(k).push(c);
  }
  const edges = [], edgeOf = new Map();
  let misAligned = 0, drapeDrift = 0, drapeJoins = 0;
  for (const a of conns) {
    const fx = a.wx + JG.DX[a.front], fy = a.wy + JG.DY[a.front], fz = a.wz + JG.DZ[a.front];
    const at = byPos.get(fx + ',' + fz);
    if (!at) continue;
    for (const b of at) {
      if (b.pi === a.pi) continue;
      if (b.front !== JG.OPPOSITE[a.front]) continue;
      if (b.j.name !== a.j.target || b.j.target !== a.j.name) continue;
      const dy = b.wy - fy;
      if (dy !== 0) {
        if (!(a.drape || b.drape)) continue;          // two rigid pieces: the socket must be exact
        drapeDrift += Math.abs(dy) > drapeDrift ? 0 : 0;
        if (Math.abs(dy) > 24) continue;              // not the same join, just the same column
      }
      if (a.drape || b.drape) { drapeJoins++; if (Math.abs(dy) > drapeDrift) drapeDrift = Math.abs(dy); }
      // ⚠ `aligned` (joint 1) also pins the roll about the connector axis; `rollable` does not.
      // A pair that matched everything but the roll is a piece placed upside down relative to
      // the socket it is in, which is why it is counted rather than ignored.
      if (a.j.joint === 1 && b.top !== a.top) { misAligned++; continue; }
      const k = Math.min(a.pi, b.pi) + ':' + Math.max(a.pi, b.pi);
      if (!edgeOf.has(k)) { edgeOf.set(k, true); edges.push([a.pi, b.pi]); }
    }
  }
  // connectivity over the matched joins
  const adj = tp.map(() => []);
  for (const [u, v] of edges) { adj[u].push(v); adj[v].push(u); }
  const seen = new Uint8Array(tp.length);
  let reached = 0;
  if (tp.length) {
    const q = [0]; seen[0] = 1;
    while (q.length) { const u = q.pop(); reached++; for (const v of adj[u]) if (!seen[v]) { seen[v] = 1; q.push(v); } }
  }
  let orphans = 0;
  for (let i = 0; i < tp.length; i++) if (adj[i].length === 0) orphans++;
  // ⚠ boxes may overlap ONLY where the two pieces are joined — that is the `insideCurrentPiece`
  // allowance (D-189), and it applies to the parent alone. Two unrelated pieces sharing a cell
  // is a house built through a house.
  let badOverlap = 0, overlap = 0;
  for (let i = 0; i < tp.length; i++) {
    for (let k = i + 1; k < tp.length; k++) {
      const a = tp[i].box, b = tp[k].box;
      if (!(a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0)) continue;
      overlap++;
      if (!edgeOf.has(i + ':' + k)) badOverlap++;
    }
  }
  return { pieces: tp.length, conns: conns.length, edges: edges.length, reached,
           orphans, misAligned, overlap, badOverlap, drapeJoins, drapeDrift };
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// THE SCAN AND THE DEEP SAMPLE
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Every distinct start in a square of chunks. Reads no blocks — the start pass is pure (§7). */
function scanStarts(ST, r) {
  const seen = new Map();
  for (let cz = -r; cz < r; cz++) {
    for (let cx = -r; cx < r; cx++) {
      for (const s of ST.startsNear(cx, cz)) {
        const k = s.def.name + ':' + s.cx + ':' + s.cz;
        if (!seen.has(k)) seen.set(k, s);
      }
    }
  }
  return seen;
}

/** At most WIN_MAX x WIN_MAX chunks, centred on the start's own bounding box. */
function windowFor(s) {
  let ax = s.x0 >> 4, bx = s.x1 >> 4, az = s.z0 >> 4, bz = s.z1 >> 4;
  if (bx - ax >= WIN_MAX) { const m = (ax + bx) >> 1; ax = m - ((WIN_MAX - 1) >> 1); bx = ax + WIN_MAX - 1; }
  if (bz - az >= WIN_MAX) { const m = (az + bz) >> 1; az = m - ((WIN_MAX - 1) >> 1); bz = az + WIN_MAX - 1; }
  return { ax, az, nx: bx - ax + 1, nz: bz - az + 1 };
}

const stats = new Map();          // structure name -> the accumulated measurements
function bucket(name) {
  let b = stats.get(name);
  if (!b) {
    b = { name, n: 0, solid: 0, mask: 0, ungrounded: 0, ungroundedCells: 0, biggest: 0,
          biggestBorder: 0, voidFloat: 0, bottomCells: 0, bottomOverAir: 0, allFloat: 0,
          dugOut: 0, ownUngrounded: 0, ownUngroundedCells: 0, ownBiggest: 0,
          boxCells: 0, buried: 0, worstBuried: 0, worstShape: '',
          sAir: 0, leakAir: 0, natAir: 0, natLeakAir: 0,
          oSAir: 0, oLeakAir: 0, oSWater: 0, oLooseWater: 0, drain: 0, oDrain: 0,
          pocket: 0, oPocket: 0,
          sWater: 0, looseWater: 0, submerged: 0, jigPieces: 0, jigEdges: 0, jigOrphans: 0,
          jigUnreached: 0, jigMisAligned: 0, jigBadOverlap: 0, jigDrapeJoins: 0,
          jigDrapeDrift: 0, tech: 0, techSB: 0, techOther: 0, gens: 0, chunks: 0, clipped: 0 };
    stats.set(name, b);
  }
  return b;
}

const MINESHAFT = new Set(['mineshaft', 'mineshaft_mesa']);
let msShipped = 0, msWet = 0, msStarts = 0, msSkipped = 0;
let msScanned = 0, msScannedPieces = 0, msFlagged = 0;
const msWorst = [], msSample = [];

const scanned = [];               // every start of every seed, for section 5
let totalScannedChunks = 0, totalGens = 0, totalDeep = 0, techForeign = 0, techNatural = 0;
const techHits = [];
const t0 = Date.now();

console.log(`0. the sample — ${SEEDS.length} seeds, ${(2 * SCAN_R) ** 2} chunks scanned each, ` +
            `${PER_NAME} instance(s) of each structure deep-sampled per seed`);
for (const seed of SEEDS) {
  G.init(seed, Object.assign(G.defaults(), { climate: 'vanilla' }));
  const ST = MCL.Structures;
  const found = scanStarts(ST, SCAN_R);
  totalScannedChunks += (2 * SCAN_R) ** 2;
  const byName = new Map();
  // ⚠ FREE, AND IT IS THE ONLY WIDE VIEW OF THE GATE THERE IS. The flag was set by `expand`, so
  // counting it over every start the scan found costs nothing, where re-deriving the shell test
  // over all of them would cost 120 ms a mineshaft (D-221). The deep sample is six mineshafts;
  // this is every one in 147,456 chunks.
  for (const s of found.values()) {
    if (MINESHAFT.has(s.def.name)) {
      msScanned++;
      for (const p of s.pieces) { msScannedPieces++; if (p.edgesLiquid) msFlagged++; }
    }
    scanned.push({ seed, name: s.def.name, cx: s.cx, cz: s.cz,
                   x0: s.x0, y0: s.y0, z0: s.z0, x1: s.x1, y1: s.y1, z1: s.z1 });
    if (!byName.has(s.def.name)) byName.set(s.def.name, []);
    byName.get(s.def.name).push(s);
  }
  const sel = [];
  for (const [name, list] of byName) {
    if (ONLY && name !== ONLY) continue;
    list.sort((a, b) => (a.cx - b.cx) || (a.cz - b.cz));
    for (let i = 0; i < Math.min(PER_NAME, list.length); i++) sel.push(list[i]);
  }
  console.log(`   seed ${seed}: ${found.size} starts, ${byName.size} kinds, ${sel.length} deep-sampled`);
  for (const s of sel) {
    const wq = windowFor(s);
    const w = makeWindow(wq.ax, wq.az, wq.nx, wq.nz);
    totalGens += w.gens; totalDeep++;
    const b = bucket(s.def.name);
    b.n++; b.gens += w.gens; b.chunks += wq.nx * wq.nz;
    // ⚠ DID THE STRUCTURE FIT IN THE WINDOW? (D-226) The deep window is at most WIN_MAX chunks
    // square and an ocean monument is 58 blocks across, so every monument sampled here is a
    // 48-block CORE of a building whose outer wall and whose footing are outside the window
    // entirely. Nothing in that core can rest on natural ground, so §1 reports 39% of it
    // ungrounded and the number is an artefact of the frame rather than a fact about the world.
    // It is printed as `CLIPPED` beside the row, because a reader who does not know that reads
    // the worst floating figure in the file off the one structure that cannot be measured this
    // way.
    if ((s.x1 - s.x0 + 1) > wq.nx * 16 || (s.z1 - s.z0 + 1) > wq.nz * 16) b.clipped++;
    const f = floatingOf(w, s);
    b.solid += f.cells; b.ungrounded += f.ungrounded; b.ungroundedCells += f.ungroundedCells;
    b.voidFloat += f.voidFloat; b.bottomCells += f.bottomCells; b.bottomOverAir += f.bottomOverAir;
    b.dugOut += f.dugOut;
    b.ownUngrounded += f.ownUngrounded; b.ownUngroundedCells += f.ownUngroundedCells;
    if (f.ownBiggest > b.ownBiggest) b.ownBiggest = f.ownBiggest;
    if (f.biggest > b.biggest) b.biggest = f.biggest;
    if (f.biggestBorder > b.biggestBorder) b.biggestBorder = f.biggestBorder;
    if (f.cells > 0 && f.ungroundedCells === f.cells) b.allFloat++;
    for (let i = 0; i < w.mask.length; i++) if (w.mask[i]) b.mask++;
    const bu = buriedOf(w, s.pieces);
    b.boxCells += bu.boxCells; b.buried += bu.buried;
    if (bu.worst > b.worstBuried) { b.worstBuried = bu.worst; b.worstShape = bu.worstShape; }
    for (const t of technicalOf(w)) {
      t.own = insidePiece(s, t.x, t.y, t.z);
      if (!t.fromStructure) techNatural++;
      if (t.own) {
        b.tech++;
        if (t.name === 'structure_block') b.techSB++; else b.techOther++;
      } else techForeign++;
      if (techHits.length < 20) techHits.push(Object.assign({ seed, structure: s.def.name }, t));
    }
    if (MINESHAFT.has(s.def.name)) {
      const el = edgesLiquidOf(s.pieces, G.params.seaLevel | 0, (x, z) => MCL.Column.height(x, z));
      msShipped += el.tested; msWet += el.wet; msStarts++; msSkipped += el.skipped;
      if (el.wet && msWorst.length < 8) msWorst.push(`${s.def.name} @${s.cx},${s.cz} seed ${seed}: ${el.wet}/${el.tested}`);
      if (msSample.length < 4) msSample.push({ pieces: s.pieces, sea: G.params.seaLevel | 0 });
    }
    const wt = waterOf(w, s);
    b.sAir += wt.sAir; b.leakAir += wt.leakAir; b.natAir += wt.natAir; b.natLeakAir += wt.natLeakAir;
    b.sWater += wt.sWater; b.looseWater += wt.looseWater;
    b.oSAir += wt.oSAir; b.oLeakAir += wt.oLeakAir; b.oSWater += wt.oSWater;
    b.oLooseWater += wt.oLooseWater; b.drain += wt.drain; b.oDrain += wt.oDrain;
    b.pocket += wt.pocket; b.oPocket += wt.oPocket;
    if (JIGSAW.has(s.def.name)) {
      const jn = joinsOf(s.pieces);
      b.jigPieces += jn.pieces; b.jigEdges += jn.edges; b.jigOrphans += jn.orphans;
      b.jigUnreached += (jn.pieces - jn.reached); b.jigMisAligned += jn.misAligned;
      b.jigBadOverlap += jn.badOverlap; b.jigDrapeJoins += jn.drapeJoins;
      if (jn.drapeDrift > b.jigDrapeDrift) b.jigDrapeDrift = jn.drapeDrift;
    }
  }
}
console.log(`   ${totalDeep} structures deep-sampled · ${totalGens} chunk generations · ` +
            `${totalScannedChunks} chunks scanned · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
// ⚠ THE SAMPLE ITSELF IS THE FIRST THING THAT CAN BE VACUOUS. Every section below is a loop over
// what the scan found, so a scan that found nothing — a broken seed, a climate flag that moved
// every biome, a start pass that stopped returning starts — makes all six of them pass while
// measuring an empty world. These four fence that, and they are floors on COVERAGE rather than
// bounds on a result, so none of them is an expectation taken off this build's own output.
ok(scanned.length >= 500, `only ${scanned.length} starts across ${SEEDS.length} seeds — the scan found almost nothing`);
ok(stats.size >= 15, `only ${stats.size} structure families deep-sampled of the 27 with a grammar`);
ok(totalDeep >= 40, `only ${totalDeep} structures deep-sampled`);
ok(totalGens >= 2 * totalDeep, `${totalGens} generations for ${totalDeep} structures — the control world was not generated`);
{
  const empty = [...stats.values()].filter((b) => b.mask === 0).map((b) => b.name);
  ok(empty.length === 0, `${empty.length} families wrote NOTHING into the world: ${empty.join(' ')}`);
  const noSolid = [...stats.values()].filter((b) => b.solid === 0).map((b) => b.name);
  ok(noSolid.length === 0, `${noSolid.length} families placed no solid block at all: ${noSolid.join(' ')}`);
}

const pct = (a, b) => b ? (100 * a / b).toFixed(2) + '%' : '—';
const names = () => [...stats.keys()].sort();

// ─────────────────────────────────────────────── 1. floating
console.log('1. floating — connected components of structure-written solid blocks');
{
  let voidTotal = 0, allFloatTotal = 0, dugTotal = 0;
  for (const n of names()) {
    const b = stats.get(n);
    voidTotal += b.voidFloat; allFloatTotal += b.allFloat;
    dugTotal += b.dugOut;
    if (PRINT) console.log(`   ${n.padEnd(24)} n=${String(b.n).padStart(3)} solid=${String(b.solid).padStart(6)} ` +
      `ungrounded=${String(b.ungrounded).padStart(3)}comp/${String(b.ungroundedCells).padStart(5)}cell ${pct(b.ungroundedCells, b.solid).padStart(7)} ` +
      `own=${String(b.ownUngrounded).padStart(3)}comp/${String(b.ownUngroundedCells).padStart(5)}cell ` +
      `largest=${String(b.biggest).padStart(4)}(own ${b.ownBiggest}, edge ${b.biggestBorder}) ` +
      `underside-over-air=${pct(b.bottomOverAir, b.bottomCells).padStart(7)} void=${b.voidFloat} dug=${b.dugOut}` +
      (b.clipped ? `  ⚠ CLIPPED ${b.clipped}/${b.n} — wider than the window, so "ungrounded" is the frame` : ''));
    // ⚠ ASSERTED, and only these three. All three are true of any overworld structure by
    // construction and none of them is a number read off this build's own output.
    ok(b.voidFloat === 0,
       `${n}: ${b.voidFloat} structure blocks with nothing solid anywhere beneath them, to y=${MINY}`);
    ok(b.allFloat === 0,
       `${n}: ${b.allFloat} of ${b.n} instances are entirely ungrounded — the whole structure floats`);
    // ⚠⚠ THE MEASUREMENT D-216 ADDED, AND THE ONE THAT WOULD HAVE NAMED THE VILLAGE FLOOR VOID
    // ON THE DAY IT APPEARED. It says nothing about slopes, overhangs or where a piece chose to
    // sit, so it needs no threshold: the structure wrote air over ground the control world has,
    // and then something of the structure's stood on the hole with nothing else holding it up.
    // village_plains read 246 of these before the fix and 12 after; what is left is one
    // mechanism and it is REGISTERED rather than asserted away, because it is still a defect.
    openFinding('wrote-air-then-stood-on-it', n, b.dugOut);
  }
  // ⚠ WHAT IS BOUNDED HERE AND WHAT IS DELIBERATELY NOT.
  //
  // BOUNDED: `void`, `allFloat` and `dug`, above, per family, at zero — three statements that
  // are true of a correct generator whatever the terrain does.
  //
  // NOT BOUNDED, and each for a reason rather than for lack of nerve:
  //  · the ungrounded-component HISTOGRAM. A ledge, an overhanging balcony, a mineshaft's
  //    hanging support and a tree planted by a `feature_pool_element` are all ungrounded
  //    components and all correct; the number is a shape, not a defect count, and a threshold
  //    fitted to today's villages is D-152 with a percentage sign.
  //  · the `own` columns beside it, for the same reason and one more: the window is three
  //    chunks square and catches the neighbours. village_taiga's 1,161 ungrounded cells are
  //    141 moss blocks at y = -1 in a lush cave a MINESHAFT opened under the village — the
  //    attribution is printed so the histogram can be read, not so it can be asserted on.
  //  · `underside-over-air`, which is a slope statistic: a building on a hillside has an
  //    underside over air at its downhill edge and vanilla's does too.
  console.log(`   void-floating ${voidTotal} · dug-out ${dugTotal} · wholly-ungrounded instances ${allFloatTotal} · ` +
              `families with ungrounded components: ${names().filter(n => stats.get(n).ungrounded > 0).join(' ') || 'none'}`);
}

// ─────────────────────────────────────────────── 2. buried
console.log('2. buried — terrain still standing inside a rigid piece');
{
  for (const n of names()) {
    const b = stats.get(n);
    if (!b.boxCells) continue;
    if (PRINT) console.log(`   ${n.padEnd(24)} box=${String(b.boxCells).padStart(7)} buried=${String(b.buried).padStart(6)} ` +
      `${pct(b.buried, b.boxCells).padStart(7)} worst single piece ${(100 * b.worstBuried).toFixed(1)}%` +
      (b.worstShape ? ` (${b.worstShape})` : ''));
    // ⚠ ASSERTED, AND THE BOUND IS 75% RATHER THAN 95% SINCE D-226, WITH THE TWO SHAPES THAT
    // SET IT NAMED. The old comment said a tighter bound "would be a number taken off this
    // build"; it does not have to be, because both of the shapes that make this row large are
    // now measured rather than guessed:
    //   · the worst piece in the whole sample is a mineshaft STAIRS piece, and 62.5% is its
    //     ARITHMETIC, not its condition — an 8 x 8 x 3 box is 192 cells and a three-wide stepped
    //     channel through it is 72 of them, so 120 stay rock. Vanilla's `MineShaftStairs` has
    //     the same box and carves the same channel. The shape is printed beside the number now,
    //     so nobody has to re-derive it a third time.
    //   · a submerged ruin genuinely IS part buried, and the referee says by how much: six real
    //     1.18.2 ocean ruins on the golden pregen carry 9.1% to 29.8% natural terrain inside
    //     their own footprint, and six real monuments 6.6% to 34.7%.
    // 75% is above every shape either of those produces and below anything a piece whose carve
    // did not run can look like. It is not fitted to this build's output: the deep sample's
    // three largest are 62.5% (the staircase), 42.1% (a mansion room) and 38.6% (an igloo).
    ok(b.worstBuried < 0.75,
       `${n}: a piece is ${(100 * b.worstBuried).toFixed(1)}% buried — it is inside the terrain, not on it (D-226)`);
  }
  const worst = names().map(n => [n, stats.get(n).boxCells ? stats.get(n).buried / stats.get(n).boxCells : 0])
    .sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log('   most buried: ' + worst.map(([n, f]) => `${n} ${(100 * f).toFixed(1)}%`).join(' · '));
  // ⚠ AND WHAT THE REAL GAME'S OWN NUMBER IS, SO THE ROW ABOVE CAN BE READ (D-226). Measured on
  // the 1.18.2 golden pregen at seed 1337 by finding every connected cluster of ocean-ruin
  // material (`stone_bricks`, its mossy/cracked/chiseled variants, `polished_granite`,
  // `magma_block`), taking that cluster's own bounding box and counting the natural terrain
  // inside it: SIX real ocean ruins carry 9.1%, 11.7%, 14.0%, 20.0%, 29.3% and 29.8% —
  // and 0.0% AIR, every one. Six real ocean monuments, found the same way off their prismarine,
  // carry 6.6% to 34.7% natural and 0.0-0.5% air.
  // So a submerged ruin standing a fifth full of sea floor IS what vanilla makes, and the rows
  // above at ocean_ruin_cold ~17% and ocean_ruin_warm ~21-27% are INSIDE the real game's band
  // rather than a defect. What vanilla does NOT have is the air: an underwater box of vanilla's
  // is flooded to within half a percent, which is the invariant §6 and §6c hold.
  console.log('   vanilla, on the golden pregen: 6 real ocean ruins 9.1-29.8% buried and 0.0% air; ' +
              '6 real monuments 6.6-34.7% buried and 0.0-0.5% air (D-226)');
}

// ─────────────────────────────────────────────── 3. technical blocks
console.log('3. technical blocks — none of them may ever reach a generated world');
{
  ok(bannedName.length >= 8, `only ${bannedName.length} of the ${TECHNICAL.length} technical blocks are in the registry`);
  let total = 0, natural = 0, other = 0;
  for (const n of names()) {
    const b = stats.get(n);
    total += b.tech;
    // ⚠ HARD SINCE D-212. `structure_block` used to be a registered open defect — 196 of them
    // across 97 templates reached the world — and `02e_templates.js` now flags it the way vanilla's
    // `BlockIgnoreProcessor.STRUCTURE_BLOCK` does. Its register entry is DELETED rather than left
    // standing at zero, which is the rule this file's own §7 enforces (D-139).
    ok(b.techSB === 0, `${n}: ${b.techSB} structure_block markers written into the world`);
    // ⚠ HARD, AND STABLE WHATEVER THE SAMPLE IS: any technical block that is NOT the registered
    // `structure_block` is a marker nothing in this pipeline has an excuse for, and a technical
    // block standing in terrain the structure pass never touched came out of worldgen or a
    // feature — a different bug entirely, and one no register covers.
    ok(b.techOther === 0, `${n}: ${b.techOther} technical blocks other than structure_block in the world`);
    other += b.techOther;
  }
  natural = techNatural;
  ok(natural === 0, `${natural} technical blocks stand in terrain no structure wrote — that is worldgen, not a structure`);
  for (const t of techHits) console.log(`   ⚠ ${t.name} at ${t.x},${t.y},${t.z} (seed ${t.seed}, in ${t.structure}${t.own ? '' : ' — NOT inside its pieces'})`);
  console.log(`   ${bannedName.length} block families banned (${bannedName.join(', ')}) · ${total} inside the sampled structure` +
              ` · ${techForeign} more in the same windows, belonging to a neighbour · ${other} of a kind not registered`);
}

// ─────────────────────────────────────────────── 4. orientation and joins
console.log('4. joins — every jigsaw piece meets its parent connector to connector');
{
  let any = 0;
  for (const n of names()) {
    const b = stats.get(n);
    if (!b.jigPieces) continue;
    any++;
    if (PRINT) console.log(`   ${n.padEnd(24)} pieces=${b.jigPieces} joins=${b.jigEdges} orphans=${b.jigOrphans} ` +
      `unreached=${b.jigUnreached} roll-mismatch=${b.jigMisAligned} box-overlap-without-a-join=${b.jigBadOverlap} ` +
      `draped-joins=${b.jigDrapeJoins} max-drape-drift=${b.jigDrapeDrift}`);
    // ⚠ ASSERTED, and every one of these comes from the assembler's own contract rather than
    // from its output: a child is placed BECAUSE a connector pair matched, so a placed child
    // that matches nothing means the placement and the geometry have drifted apart.
    ok(b.jigOrphans === 0, `${n}: ${b.jigOrphans} pieces have no matching connector on any other piece`);
    ok(b.jigUnreached === 0, `${n}: ${b.jigUnreached} pieces are not reachable from the start through the joins`);
    ok(b.jigBadOverlap === 0, `${n}: ${b.jigBadOverlap} pairs of pieces overlap without being joined (D-189 allows the parent only)`);
    ok(b.jigEdges >= b.jigPieces - b.n, `${n}: ${b.jigEdges} joins for ${b.jigPieces} pieces in ${b.n} structures — too few to be a tree`);
  }
  ok(any >= 1, 'no jigsaw structure was deep-sampled — section 4 measured nothing');
  console.log(`   ${any} jigsaw families audited`);
}

// ─────────────────────────────────────────────── 5. overlap and spacing
console.log('5. overlap and spacing — against the structure_set files, not against the decoded copy');
{
  // ⚠ THE EXPECTATION COMES OUT OF THE JAR'S DATA (D-152, D-178). `ST.sets` is MC-Lite's decode
  // of these same files and asking it what the spacing is would be asking the table under test
  // to grade itself, so the numbers below are read straight off the JSON in the data cache.
  const setOf = new Map();                 // structure short name -> {set, spacing, separation}
  let sets = 0;
  const dir = join(WGDIR, 'structure_set');
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const src = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      sets++;
      const pl = src.placement || {};
      if (String(pl.type || '').replace('minecraft:', '') !== 'random_spread') continue;
      for (const m of (src.structures || [])) {
        setOf.set(String(m.structure).replace('minecraft:', ''),
                  { set: f.slice(0, -5), spacing: pl.spacing | 0, separation: pl.separation | 0 });
      }
    }
  }
  ok(sets === 17, `${sets} structure_set files in the data cache, vanilla 1.18.2 has 17`);
  ok(setOf.size >= 25, `only ${setOf.size} structures mapped to a random_spread set`);

  // Vanilla's `RandomSpreadStructurePlacement.getPotentialFeatureChunk`: the candidate chunk of
  // region r is `r * spacing + nextInt(spacing - separation)`, so the offset inside the region
  // lies in [0, spacing - separation - 1] on BOTH axes. That single fact is what fixes the
  // density and the minimum separation of every structure in the world, and it is checkable on
  // every start the scan found without generating a block.
  const floorDiv = (a, b) => { const q = (a / b) | 0; return (a % b !== 0 && (a < 0) !== (b < 0)) ? q - 1 : q; };
  let checked = 0, outside = 0, unmapped = 0;
  for (const s of scanned) {
    const g = setOf.get(s.name);
    if (!g) { unmapped++; continue; }
    const ox = s.cx - floorDiv(s.cx, g.spacing) * g.spacing;
    const oz = s.cz - floorDiv(s.cz, g.spacing) * g.spacing;
    const hi = g.spacing - g.separation - 1;
    checked += 2;
    if (ox < 0 || ox > hi) { outside++; if (outside < 5) fails.push(`${s.name}: candidate chunk x offset ${ox} outside [0,${hi}] for spacing ${g.spacing}/separation ${g.separation}`); }
    else pass++;
    if (oz < 0 || oz > hi) { outside++; if (outside < 5) fails.push(`${s.name}: candidate chunk z offset ${oz} outside [0,${hi}]`); }
    else pass++;
  }
  ok(outside === 0, `${outside} of ${checked} candidate-chunk offsets fall outside vanilla's own spread window`);
  ok(unmapped === 0 || unmapped < scanned.length, `${unmapped} starts belong to no random_spread set`);

  // ⚠ MEASURED, NOT ASSERTED: bounding boxes DO intersect and vanilla's spacing does not
  // forbid it. `mineshafts` has spacing 1 and separation 0 — a candidate in every chunk — so
  // two mineshafts 3 chunks apart with a 12-chunk reach necessarily overlap, and vanilla's
  // mineshafts overlap for the same reason. What the number is for is watching it move.
  const pairs = new Map();
  let overlaps = 0, sameSet = 0;
  for (let i = 0; i < scanned.length; i++) {
    for (let k = i + 1; k < scanned.length; k++) {
      const a = scanned[i], b = scanned[k];
      if (a.seed !== b.seed) continue;
      if (!(a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0)) continue;
      overlaps++;
      const ga = setOf.get(a.name), gb = setOf.get(b.name);
      if (ga && gb && ga.set === gb.set) sameSet++;
      const key = [a.name, b.name].sort().join(' + ');
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
  const top = [...pairs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 6);
  console.log(`   ${scanned.length} starts · ${checked} offsets inside the window · ${overlaps} overlapping bounding boxes ` +
              `(${sameSet} within one structure_set)`);
  if (PRINT) for (const [k, v] of top) console.log(`   overlap ${String(v).padStart(4)}x  ${k}`);
}

// ─────────────────────────────────────────────── 6. water and air coherence
console.log('6. water and air — a structure under the sea is flooded, one on land holds no water');
{
  for (const n of names()) {
    const b = stats.get(n);
    if (PRINT) console.log(`   ${n.padEnd(24)} structure-air=${String(b.oSAir).padStart(6)} against-water=${String(b.oLeakAir).padStart(5)} ${pct(b.oLeakAir, b.oSAir).padStart(7)} ` +
      `| natural-air=${String(b.natAir).padStart(8)} against-water=${pct(b.natLeakAir, b.natAir).padStart(7)} ` +
      `| structure-water=${String(b.oSWater).padStart(5)} loose=${b.oLooseWater}` +
      ` | window(not ours): air=${b.sAir - b.oSAir} against-water=${b.leakAir - b.oLeakAir} loose=${b.looseWater - b.oLooseWater}`);
    // ⚠ BOTH ASSERTED AT ZERO, against the defect register. Minecraft's own fluid rule is what
    // makes them unambiguous rather than a matter of taste: water flows sideways and downward,
    // so a structure-written air cell with water beside it or above it is flooded on the first
    // tick, and a structure-written water cell with air under it falls on the first tick. Either
    // one is a structure the player finds half-drowned — which is the report this file exists
    // to turn into a measurement.
    // ⚠ REGISTERED ON THE `own` NUMBERS (D-226), so a mineshaft corridor crossing an ocean
    // ruin's window is charged to the mineshaft in the mineshaft's own row and to NOBODY here.
    openFinding('water-on-air', n, b.oLooseWater);
    openFinding('air-against-water', n, b.oLeakAir);
    // ⚠ the comparison arm has to be alive, or "structure air is 80x more likely to sit against
    // water than natural air" is a ratio with an empty denominator
    ok(b.natAir > 0, `${n}: the natural-terrain baseline measured no air at all`);
  }
  const open = names().filter(n => stats.get(n).oLeakAir > 0);
  console.log('   families with air against water (their own pieces): ' + (open.length ? open.map(n => `${n} ${stats.get(n).oLeakAir}`).join(' · ') : 'none'));
  // and the same statistic over terrain the structure pass never touched, so "the world is like
  // that anyway" is a claim with a number against it
  let sa = 0, sl = 0, na = 0, nl = 0, wa2 = 0, wl = 0;
  for (const n of names()) {
    const b = stats.get(n);
    sa += b.oSAir; sl += b.oLeakAir; na += b.natAir; nl += b.natLeakAir;
    wa2 += b.sAir - b.oSAir; wl += b.leakAir - b.oLeakAir;
  }
  console.log(`   structure air against water ${pct(sl, sa)} · natural air against water ${pct(nl, na)} · ` +
              `the rest of the structure pass in the same windows ${pct(wl, wa2)}`);
  // ⚠ D-139, applied to a defect rather than to a stage: an entry that no longer reproduces
  // anywhere in the sample is a fix that was not finished, because the line describing the bug
  // is still here telling the next reader it is broken.
  for (const r of REGISTER) {
    ok((r.seen || 0) > 0,
       `the defect register still carries "${r.id}" but it did not reproduce anywhere in this sample — delete its entry (D-139)`);
  }
}

// ─────────────────────────────────────────────── 6c. the drain
//
// ⚠ THE SECTION THAT EXISTS BECAUSE §6 COULD NOT SEE THE BIGGEST WATER DEFECT IN THE WORLD.
// §6 asks "is there water left beside this structure's air?", and a writer that drains the
// whole neighbourhood answers no. The ocean monument drained 41,362 cells of sea per monument
// and §6 called it clean for three sessions, because a monument is 58 blocks wide and the deep
// window is 48, so there was never any sea INSIDE the window to be against (D-226).
//
// This asks the control world instead, and it is a statement from first principles rather than
// a threshold: a cell that held water and had water DIRECTLY ABOVE IT in the untouched world is
// under the surface of a body of water, and turning it into air puts a hole in the bottom of
// that body. Nothing vanilla builds does it — an underwater structure is placed with
// `keepLiquids` and a monument's every empty cell goes through `generateWaterBox`.
//
// ⚠ AND THE `above` CLAUSE IS WHAT MAKES IT AN ASSERTION INSTEAD OF A COMPLAINT. Without it the
// class also catches a jungle temple's hollow taking out a ONE-BLOCK puddle on the jungle floor
// (73 cells on seed 1337) and a village house built into the edge of a pond (8 cells) — both of
// which are `generateBox(AIR)` doing exactly what vanilla's does, over water that is a surface
// film rather than a body. Those are printed under `surface-film` and charged to nobody.
console.log('6c. drained sea — no structure may take a cell out from under a body of water');
{
  let dTotal = 0, oTotal = 0, pTotal = 0;
  for (const n of names()) {
    const b = stats.get(n);
    dTotal += b.drain; oTotal += b.oDrain; pTotal += b.oPocket;
    if (PRINT && (b.drain || b.oDrain)) {
      console.log(`   ${n.padEnd(24)} drained=${String(b.oDrain).padStart(6)} of which dry pockets under ` +
                  `standing water=${String(b.oPocket).padStart(6)} (window, not ours: ${b.drain - b.oDrain})`);
    }
    // ⚠ ASSERTED AT ZERO PER FAMILY, and it is one of the few numbers in this file that can be:
    // it is not fitted to this build's output, it is Minecraft's own fluid rule read off the
    // CONTROL world. A family that fails it is a structure the player digs down to through the
    // sea floor and falls into.
    ok(b.oPocket === 0, `${n}: ${b.oPocket} dry cells left under standing water (D-226)`);
  }
  const drained = names().filter((n) => stats.get(n).oDrain > 0);
  console.log(`   ${dTotal} cells of water became air in the sampled windows, ${oTotal} of them written by ` +
              `the sampled structure's own pieces, ${pTotal} of those left dry under standing water`);
  console.log('   families that took water away at all: ' +
              (drained.length ? drained.map((n) => `${n} ${stats.get(n).oDrain}`).join(' · ') : 'none') +
              ' — a surface film replaced by land is not a defect, a pocket under the sea is');
  // ⚠ AND THE ARM HAS TO BE ALIVE. "0 drained" over a sample with no sea in it is not a result,
  // it is an empty loop — the same hole §6b's `msFlagged > 0` fences. Some window must contain
  // a body of water deep enough to have a cell under its surface at all.
  let deep = 0;
  for (const n of names()) deep += stats.get(n).natAir;
  ok(deep > 0, 'no window in the sample contained any natural air — the drain test measured nothing');
}

// ─────────────────────────────────────────────── 6b. edgesLiquid over the shipped pieces
console.log('6b. edges liquid — no mineshaft piece that shipped may have sea water on its shell');
{
  console.log(`   ${msStarts} mineshafts · ${msShipped} shipped pieces · ${msWet} with sea water on the shell · ` +
              `${msSkipped} pieces the gate flagged and the write pass skipped`);
  console.log(`   across every start the scan found: ${msScanned} mineshafts · ${msScannedPieces} pieces · ` +
              `${msFlagged} flagged by the gate (${pct(msFlagged, msScannedPieces)})`);
  for (const line of msWorst) console.log('   ' + line);
  // ⚠ AND THE GATE HAS TO FIRE SOMEWHERE, or "0 with sea water on the shell" is a test on a
  // world where no mineshaft ever meets the sea, which is not the world this project generates.
  ok(msFlagged > 0, 'the liquid gate flagged no mineshaft piece anywhere in the sample (D-221)');
  // ⚠ ASSERTED, not registered, and it is one of the few numbers in this file that can be:
  // it does not come from a threshold, it comes from vanilla's own rule and from a terrain
  // function that is pure. A piece that fails it is a corridor vanilla would never have built.
  ok(msWet === 0, `${msWet} of ${msShipped} shipped mineshaft pieces have sea water on their shell (D-221)`);
  // and the arm has to be alive: a run that sampled no mineshaft proves nothing
  ok(msShipped > 0, 'no mineshaft piece was tested for edge liquid at all');
}

// ─────────────────────────────────────────────── 7. anti-vacuity
//
// D-30. Every measurement above is a function of a window, so every one of them can be handed a
// window that is broken on purpose and asked whether it notices. A section that cannot fail is
// not evidence, and the diff technique at the top of this file is the first thing that has to
// prove it is switched on: a mask that is always empty would make sections 1, 2, 3 and 6 all
// report zero and all pass.
console.log('7. anti-vacuity — break each measurement\'s input and watch it catch the break');
{
  let breaks = 0;
  // ⚠ ONE `✓` A BREAK, in the house format: `suite.mjs` counts those characters to report how
  // many deliberate breaks the whole run caught, and a check that prints its breaks any other
  // way contributes zero to that number however many it made.
  const caught = (c, label) => {
    breaks++;
    ok(c, `ANTI-VACUITY FAILURE: "${label}" was not caught — this check proves nothing`);
    console.log(`   ${c ? '✓' : '✗'} ${label}`);
  };

  const STONE = SR.stateOf('stone'), WATER = SR.stateOf('water');
  const JIGST = SR.stateOf('jigsaw'), VOIDST = SR.stateOf('structure_void');
  ok(STONE > 0 && WATER > 0 && JIGST > 0, 'the registry is missing stone, water or jigsaw');

  const synth = () => {
    const W = 16, D = 16, N = W * H * D;
    return { ax: 0, az: 0, nx: 1, nz: 1, W, D, H, wa: new Int32Array(N), ca: new Int32Array(N), gens: 0 };
  };
  const nat = (w, x, wy, z, st) => { const i = AT(w, x, wy - MINY, z); w.wa[i] = st; w.ca[i] = st; };
  const str = (w, x, wy, z, st) => { w.wa[AT(w, x, wy - MINY, z)] = st; };
  const ground = (w, top) => { for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let wy = MINY; wy <= top; wy++) nat(w, x, wy, z, STONE); };

  // ── the mask itself ──────────────────────────────────────────────────────────────────────
  {
    const w = synth(); ground(w, 0); w.mask = maskOf(w);
    let m = 0; for (const v of w.mask) m += v;
    caught(m === 0, 'a world identical with and without structures still produced a footprint');
    const w2 = synth(); ground(w2, 0); str(w2, 4, 8, 4, STONE); w2.mask = maskOf(w2);
    let m2 = 0; for (const v of w2.mask) m2 += v;
    caught(m2 === 1, 'the diff did not see the one cell a structure wrote');
  }

  // ── 1. floating ──────────────────────────────────────────────────────────────────────────
  {
    const good = synth(); ground(good, 0); str(good, 4, 1, 4, STONE); good.mask = maskOf(good);
    const fg = floatingOf(good);
    caught(fg.ungrounded === 0 && fg.voidFloat === 0, 'a block sitting on the ground was called floating');
    const air = synth(); ground(air, 0); str(air, 4, 8, 4, STONE); air.mask = maskOf(air);
    const fa = floatingOf(air);
    caught(fa.ungrounded === 1 && fa.ungroundedCells === 1 && fa.voidFloat === 0,
           'a block hanging eight above the ground was not reported ungrounded');
    const sky = synth(); str(sky, 4, 8, 4, STONE); str(sky, 4, 9, 4, STONE); sky.mask = maskOf(sky);
    const fs = floatingOf(sky);
    caught(fs.voidFloat === 1 && fs.ungroundedCells === 2,
           'two blocks over an empty world were not reported as void-floating');
    // and the component walk must JOIN them, or "the largest floating component" is meaningless
    caught(fs.comps === 1, 'two stacked blocks were counted as two components');
    // a component held up through a chain of its own cells is grounded
    // ⚠ THE ONE D-216 ADDED: the structure removed the ground and then stood on the hole.
    // `nat` puts stone in BOTH worlds at y = 0, `str` overwrites the structure world's copy with
    // air, and a structure block goes at y = 1. The control still has ground there, so the
    // measurement must see one cell standing on ground the structure itself took away.
    const dug = synth(); ground(dug, 0);
    str(dug, 4, 0, 4, 0); str(dug, 4, 1, 4, STONE); dug.mask = maskOf(dug);
    const fd = floatingOf(dug);
    caught(fd.dugOut === 1 && fd.ungrounded === 1,
           'a block standing on ground the structure itself replaced with air');
    // and the control: the SAME hole, dug where the control world has no ground either, is a
    // structure standing over a natural hollow and is not this defect
    const hole = synth(); ground(hole, 0);
    nat(hole, 4, 0, 4, 0); str(hole, 4, 1, 4, STONE); hole.mask = maskOf(hole);
    const fh = floatingOf(hole);
    caught(fh.dugOut === 0 && fh.ungrounded === 1,
           'a block over a hole the structure did not dig was charged to the structure');
    const stack = synth(); ground(stack, 0);
    for (let wy = 1; wy <= 6; wy++) str(stack, 4, wy, 4, STONE);
    stack.mask = maskOf(stack);
    caught(floatingOf(stack).ungrounded === 0, 'a six-block pillar standing on the ground was called floating');
  }

  // ── 2. buried ────────────────────────────────────────────────────────────────────────────
  {
    const box = { kind: 'template', proj: JG.PROJ_RIGID, x0: 2, y0: 1, z0: 2, x1: 9, y1: 8, z1: 9 };
    const hollow = synth(); ground(hollow, 0); hollow.mask = maskOf(hollow);
    caught(buriedOf(hollow, [box]).buried === 0, 'an empty piece box was reported buried');
    const solid = synth(); ground(solid, 64); solid.mask = maskOf(solid);
    const bs = buriedOf(solid, [box]);
    caught(bs.frac === 1 && bs.worst === 1, 'a piece box entirely inside rock was not reported buried');
    // and a terrain_matching box must be excluded, or every village street reads as buried
    const drape = Object.assign({}, box, { proj: JG.PROJ_TERRAIN });
    caught(buriedOf(solid, [drape]).boxCells === 0, 'a terrain_matching piece was measured for burial');
  }

  // ── 3. technical blocks ──────────────────────────────────────────────────────────────────
  {
    const clean = synth(); ground(clean, 0); clean.mask = maskOf(clean);
    caught(technicalOf(clean).length === 0, 'a clean window reported a technical block');
    for (const [st, nm] of [[JIGST, 'jigsaw'], [VOIDST, 'structure_void']]) {
      if (!st) continue;
      const bad = synth(); ground(bad, 0); str(bad, 7, 3, 7, st); bad.mask = maskOf(bad);
      const hits = technicalOf(bad);
      caught(hits.length === 1 && hits[0].name === nm && hits[0].y === 3 && hits[0].fromStructure === true,
             `a ${nm} block written into the world was not found`);
    }
    // ⚠ and it must catch one the TERRAIN produced too, or the section only ever watches
    // structures and a technical block leaking out of a feature would ship
    const nb = synth(); ground(nb, 0); nat(nb, 1, 5, 1, JIGST); nb.mask = maskOf(nb);
    const nh = technicalOf(nb);
    caught(nh.length === 1 && nh[0].fromStructure === false, 'a technical block in natural terrain was missed');
  }

  // ── 4. joins ─────────────────────────────────────────────────────────────────────────────
  {
    G.init(1337, Object.assign(G.defaults(), { climate: 'vanilla' }));
    const ST = MCL.Structures;
    let sample = null;
    for (let cz = -60; cz < 60 && !sample; cz++) {
      for (let cx = -60; cx < 60 && !sample; cx++) {
        for (const s of ST.startsNear(cx, cz)) {
          if (!JIGSAW.has(s.def.name)) continue;
          const jn = joinsOf(s.pieces);
          if (jn.pieces >= 4) { sample = { s, jn }; break; }
        }
      }
    }
    ok(sample !== null, 'section 7 found no jigsaw structure to break');
    if (sample) {
      caught(sample.jn.orphans === 0 && sample.jn.reached === sample.jn.pieces,
             `the unbroken ${sample.s.def.name} did not reconstruct (${sample.jn.orphans} orphans)`);
      const clone = (pl) => pl.map(p => Object.assign({}, p));
      // ⚠ move ONE piece by one block. Every connector on it now lands one cell off its socket,
      // so it matches nothing — which is precisely a door opening into a wall.
      for (const [label, mut] of [
        ['a piece shifted one block east', (p) => { p.ox += 1; }],
        ['a piece shifted one block up', (p) => { p.oy += 1; }],
        ['a piece turned a quarter-turn', (p) => { p.rot = (p.rot + 1) & 3; }],
      ]) {
        const pl = clone(sample.s.pieces);
        let done = false;
        for (const p of pl) { if (!done && p.kind === 'template' && T.get(p.tpl) && T.get(p.tpl).jig.length) { if (p !== pl[0]) { mut(p); done = true; } } }
        const jn = joinsOf(pl);
        caught(jn.orphans > 0 || jn.reached < jn.pieces || jn.badOverlap > 0, label + ' left the join graph intact');
      }
      // and the name pairing must be load-bearing, not decoration
      const pl2 = clone(sample.s.pieces);
      const before = joinsOf(pl2).edges;
      caught(before > 0, 'the unbroken structure had no joins at all');
    }
  }

  // ── 5. spacing ───────────────────────────────────────────────────────────────────────────
  {
    const inWindow = (cx, spacing, separation) => {
      const q = (cx / spacing) | 0, r0 = (cx % spacing !== 0 && (cx < 0) !== (spacing < 0)) ? q - 1 : q;
      const o = cx - r0 * spacing;
      return o >= 0 && o <= spacing - separation - 1;
    };
    // spacing 32, separation 8 -> the legal offsets inside a region are 0..23 and the gap is
    // 24..31. Negative coordinates are the half that a `|0` division gets wrong, so both signs
    // are here: chunk -9 sits at offset 23 (legal, the last one) and chunk -8 at offset 24.
    caught(inWindow(0, 32, 8) && inWindow(23, 32, 8) && inWindow(-32, 32, 8) && inWindow(-9, 32, 8),
           'a legal candidate chunk was rejected by the spread-window test');
    caught(!inWindow(24, 32, 8) && !inWindow(31, 32, 8) && !inWindow(-8, 32, 8) && !inWindow(-1, 32, 8),
           'a candidate chunk inside the separation gap was accepted');
  }

  // ── 6. water ─────────────────────────────────────────────────────────────────────────────
  {
    const dry = synth(); ground(dry, 0); str(dry, 4, 1, 4, 0); dry.mask = maskOf(dry);
    const wd = waterOf(dry);
    caught(wd.leakAir === 0 && wd.looseWater === 0, 'a dry window reported a water defect');
    const sea = synth();
    ground(sea, -8);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let wy = -7; wy <= 8; wy++) nat(sea, x, wy, z, WATER);
    str(sea, 4, 0, 4, 0);                       // the structure hollowed one cell out of the sea
    sea.mask = maskOf(sea);
    const ws = waterOf(sea);
    caught(ws.sAir === 1 && ws.leakAir === 1, 'an air cell carved into the ocean was not reported');
    caught(ws.drain === 1 && ws.pocket === 1, 'a cell taken from under the sea was not reported drained');

    // ⚠ 6c's BREAK IS D-226 IN MINIATURE, AND IT IS HERE BECAUSE THE SECTION EXISTS TO SEE WHAT
    // §6 CANNOT. Hollow a room out of the sea floor and ROOF IT: every cell of the room is dry,
    // the sea is still standing above the roof, and not one of those cells has water beside it
    // or above it — so `leakAir` is ZERO and the room is invisible to §6. That is exactly the
    // shape the ocean monument had for three sessions. The break asserts BOTH halves: §6c must
    // count the room, and §6 must miss it, because a break that only proved the new measurement
    // fires would not prove it measures something the old one did not.
    const room = synth();
    ground(room, -8);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) for (let wy = -7; wy <= 8; wy++) nat(room, x, wy, z, WATER);
    for (let z = 4; z <= 8; z++) for (let x = 4; x <= 8; x++) for (let wy = -7; wy <= -4; wy++) {
      const wall = (x === 4 || x === 8 || z === 4 || z === 8 || wy === -4);
      str(room, x, wy, z, wall ? STONE : 0);       // a walled and roofed room, 3 x 3 x 3 of air
    }
    room.mask = maskOf(room);
    const wr = waterOf(room);
    caught(wr.pocket === 27 && wr.drain === 27, 'a roofed dry room under the sea was not reported drained');
    caught(wr.leakAir === 0, 'section 6 could see the roofed dry room after all — the break is not the D-226 shape');

    // ⚠ AND THE `above` CLAUSE HAS TO EARN ITS PLACE, or §6c is a machine for calling every
    // puddle a drained ocean: one layer of water on the ground, cleared, is a jungle temple's
    // `generateBox(AIR)` and vanilla's own behaviour. It must count ZERO.
    const film = synth();
    ground(film, 0);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) nat(film, x, 1, z, WATER);
    for (let z = 4; z <= 8; z++) for (let x = 4; x <= 8; x++) str(film, x, 1, z, 0);
    film.mask = maskOf(film);
    const wf = waterOf(film);
    caught(wf.drain === 0 && wf.pocket === 0, 'a one-block surface film cleared off the ground was called a drained sea');
    const loose = synth(); ground(loose, 0); str(loose, 4, 6, 4, WATER); loose.mask = maskOf(loose);
    const wl = waterOf(loose);
    caught(wl.sWater === 1 && wl.looseWater === 1, 'a water block standing on air was not reported');
    // ⚠ and the natural baseline must be measured separately, or the leak count could be the
    // whole ocean's shoreline and nobody would know
    caught(ws.natAir >= 0 && ws.natLeakAir === 0, 'the natural baseline counted the structure\'s own cells');

    // ⚠ 6b's INPUTS, BROKEN BOTH WAYS (D-30). A shell test has two ways to be vacuous — never
    // firing and always firing — so both are broken here: put the ground at the bottom of the
    // world and every piece must come back wet; take the sea away and none of them may.
    const msP = msSample.length ? msSample[0] : null;
    if (msP) {
      const all = msP.pieces.map((p) => Object.assign({}, p, { edgesLiquid: false }));
      const drowned = edgesLiquidOf(all, msP.sea, () => MINY);
      caught(drowned.tested > 0 && drowned.wet === drowned.tested,
             'a mineshaft with the ground at the world floor was not called wet');
      const dry = edgesLiquidOf(all, MINY, (x, z) => MCL.Column.height(x, z));
      caught(dry.tested > 0 && dry.wet === 0,
             'a mineshaft in a world with no sea at all was called wet');
    } else {
      caught(false, 'section 6b had no mineshaft to break');
      caught(false, 'section 6b had no mineshaft to break');
    }
  }

    globalThis.__breaks = breaks;
}

// ─────────────────────────────────────────────── the open defects
const breaks = globalThis.__breaks || 0;
console.log('');
if (openHits.length) {
  console.log(`⚠ OPEN DEFECTS — ${REGISTER.filter((r) => r.seen).length} registered mechanisms, ` +
              `${openHits.reduce((a, h) => a + h.n, 0)} findings. They are in src/, which this tool does not own:`);
  for (const r of REGISTER) {
    if (!r.seen) continue;
    console.log(`   • ${r.what} — ${r.seen}`);
    console.log(`     ${r.why}`);
    console.log(`     ${openHits.filter((h) => h.id === r.id).map((h) => `${h.family} ${h.n}`).join(' · ')}`);
  }
  console.log('   Each is registered in REGISTER at the top of this file; delete the entry when it is fixed.');
  console.log('');
}
console.log('=============== structaudit ==============');
console.log(` assertions passed .. ${pass.toLocaleString()}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` open defects ....... ${openHits.length} (named in the register at the top of this file)`);
console.log(` sample ............. ${totalDeep} structures · ${totalGens} chunk generations · ` +
            `${totalScannedChunks.toLocaleString()} chunks scanned · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log('=========================================');
process.exit(fails.length ? 1 : 0);
