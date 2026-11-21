# STRUCTURES — the plan

Dan: *"how do you intend to work structures, this needs more proper planning."*

He is right that it needs planning, and right that it is hard here specifically. This is the
argument; `docs/PLAN.md` §7 is the schedule, and it replaces this file's cost estimates with
§1.6's measured ones while keeping the ordering below.

⚠ **This IS scheduled work now.** It used to say structures were unscheduled. Dan has since
ruled that all of Track W — the structure stages W13…W18 included — is finished before GATE W
is breached and Track G starts. S1…S6 below are those stages.

## Why it is harder in MC-Lite than in Minecraft

Vanilla places structures against terrain it generates with a **3D density function**, and
it has a whole vocabulary for negotiating with that terrain: jigsaw pools, terrain
adaptation modes (`none`/`bury`/`beard_thin`/`beard_box`/`encapsulate`), heightmap
queries, and a two-pass system where structure *starts* are decided before terrain is
carved so chunks can agree with their neighbours.

MC-Lite's terrain is deliberately different: **splined 2D fields with terracing**, which
produces harder cliffs, flatter plateaus and sharper transitions than vanilla. That is a
feature for looks and a problem for structures. A village that assumes gentle 1.18 hills
will land half-buried in a terrace wall.

So the ordering below is not arbitrary — it goes from *structures that do not care about
terrain shape* to *structures that must negotiate with it*.

## The invariant that makes any of this work

**A structure must be decidable from its own chunk plus a bounded neighbourhood, from the
seed alone, without generating neighbouring terrain first.**

Break that and you get either infinite recursion (chunk A needs B needs A) or structures
that differ depending on which direction the player walked in. Vanilla solves it by
deciding structure *starts* in a separate early pass keyed only on `(seed, chunkX, chunkZ)`.
MC-Lite does the same:

```
1. start pass    hash(seed, cx, cz) -> does a structure start here? which one? what rotation?
                 pure function, no terrain, no neighbours, no allocation
2. piece pass    expand the start into placed pieces with bounding boxes.
                 may query the CHEAP column function (height, biome) for any (x,z) -
                 that is a splined 2D evaluation, not a chunk generation, so it is safe
3. write pass    while generating chunk C, ask which pieces overlap C, and write only the
                 part inside C
```

Step 2 is the whole trick: MC-Lite's height is a **pure function of (x,z)**. Vanilla
cannot cheaply ask "how high is the ground at this arbitrary point" without generating;
MC-Lite can, because that is what the middle-path worldgen bought us. Structure placement
is one of the places where the cheap worldgen is *better* than the expensive one.

## Terrain adaptation

Three tools, in increasing cost:

1. **Fit** — place at the sampled height, no terrain change. Boulders, ruins, trees,
   scatter. Works on any slope.
2. **Beard** — synthesise support under the piece and shave a little above it, blended
   over a few blocks at the edges. This is how vanilla stops a house floating. Needs a
   per-column "structure floor" buffer written during the piece pass and consumed by the
   surface pass.
3. **Excavate** — carve into the hillside and wall it. Expensive, needed for anything
   large on the terraced cliffs MC-Lite likes making.

## The order, and why

### Phase S1 — scatter (fit only)
Boulders, gravel patches, fallen logs, small ruins, mossy rocks. No terrain adaptation,
no bounding-box negotiation, tolerant of any slope. Also the highest visual return per
unit of work: it is what kills the "smooth noise" look Dan flagged.

### Phase S2 — underground (no adaptation needed at all)
Mineshafts, dungeons, small caches. The caves are already carved, so these structures
have a cavity to live in and never touch the surface. Mineshafts follow existing tunnels
rather than cutting their own, which sidesteps the whole problem. This is also what makes
the big 1.18-style caves worth exploring instead of empty, which is the point of having
chosen big caves in the first place.

### Phase S3 — small surface buildings (beard)
Single-piece structures: huts, towers, wells. One bounding box, one flatness test, one
beard. This is where terrain negotiation gets built and debugged — on something small
enough that failures are cheap and obvious.

### Phase S4 — villages (jigsaw + beard, and only now)
Only after S3 works. Needs, in order:
- a **flatness/suitability score** per candidate centre, sampled from the cheap column
  function across a radius, rejecting terraced and steep ground outright
- **jigsaw assembly**: pieces with typed connectors, assembled breadth-first with a piece
  budget and collision rejection
- **paths that follow contours** rather than cutting through them
- per-building beard, blended so the village sits in the landscape

Dan called villages hard. They are, and attempting them before S3 is the mistake to avoid.

## Verification

`tools/structcheck.mjs`, alongside the existing checks:

- **determinism**: generate the same region twice, in different chunk orders; the block
  data must be byte-identical. This is the test that catches the recursion invariant
  being broken, and it must exist before S2
- **no floating and no burial**: for each placed piece, assert its floor is supported and
  its door is reachable
- **ASCII cross-sections** through placed structures, in `docs/STRUCTURES.md`, the same
  way `tools/gencheck.mjs`'s ASCII cross-sections make terrain reviewable without a GPU
- **cost**: structures must not measurably move chunk generation time on the 2200G budget

## What to steal from vanilla, and what not to

**Steal:** the start/piece/write three-pass shape, the jigsaw connector model, terrain
adaptation modes, spacing-and-separation placement (`spacing`, `separation`, `salt`).
These are design, they are cheap, and per the charter this is not worldgen shape — it is
structure *logic*, which should be faithful.

**Do not steal:** the density-function-driven terrain negotiation. It assumes terrain
MC-Lite does not have.

---

## What landed in W13 and W14 — the cross-sections this document asked for

PLAN §7 supersedes the *cost* estimates above; the ORDER and the three-pass shape are unchanged
and are what shipped. W13 built the registry and the start pass (`src/04r_structures.js`,
D-183/D-184); W14 built the first piece grammar, the mineshaft (`src/04s_struct_mineshaft.js`,
D-185). `tools/structcheck.mjs` is the acceptance test this document's "Verification" section
asked for, and `node tools/structcheck.mjs --print` regenerates everything below.

The slices are through the first mineshaft within 40 chunks of the origin at seed 1337, which is
at chunk (25, −39) and has 176 pieces. Legend: `.` air, `o` stone or ground, `~` water,
`#` plank, `|` fence post, `=` rail, `*` cobweb, `X` spawner.

**Plan view, y = −25 — four chunks across.** The support arches read as the paired `|`s either
side of a corridor and the rails as the `=` down its middle. The wide `o` fields are the stone
the corridors were cut through; the wide `.` fields are the 1.18 caves they were laid into.

```
oooo.....oooo.....|.........|.......oooo.=.oo...oooooooooooooooo
oooo.....oooo...===============.....oooo.=.oo|.|oooooooooooooooo
oooo.....oooo.....|.........|.......oooo.=.oo...oooooooooooooooo
oooo....ooooooooooooooooooooooo.....oooo.=.oo...oooooooooooooooo
oooo....oooooooooooooooooooooooo...oooo..........ooooooooooooooo
oooo....oooooooooooooooooooooooo...oooo............|....|....|..
oooo...ooooooooooooooooooooooooo|.|oooo.........................
oooo...ooooooooooooooooooooooooo...oooo............|....|....|..
ooo....ooooooooooooooooooooooooo...oooo..........ooooooooooooooo
ooo....ooooooooooooooooooooooooo...ooooo...ooooooooooooooooooooo
```

**Side view, z = −616 — a corridor breaking into a cave.** The lintel planks (`#`) sit two above
the floor, the cobwebs (`*`) hang under them, and the cage (`X`) is a spider corridor's, placed
as a bare `spawner` block because this build has no block entities (D-141, D-185).

```
 -22 .....ooooooo...o.............ooooooooooooooooooo
 -23 .....oooo...........................#....#....#.
 -24 ...................................**.*...*...**
 -25 ..........oo................................X...
 -26 oooooooooooooooooooooooooooooooooooooooooooooooo
```

**What `structcheck` asserts about them**, beyond determinism: no rail is laid over air and none
has a solid block on top of it (the "no floating, no burial" pair this document asked for); no
piece ever reaches further from its own chunk than the write pass scans; and every one of the
four piece kinds is actually produced, because a grammar branch that never fires is a branch
nobody is testing.

---

## W15 through W18 — the pipeline, and the rest of the cross-sections

W15 built the NBT reader and the jigsaw pipeline (`tools/nbt.mjs`, `tools/pack-structures.mjs`,
`src/02e_templates.js`, `src/04t_jigsaw.js`; D-186, D-187). W16 built the BEARD this document
called for and five small surface buildings on it (`src/04u_struct_surface.js`; D-188). W17 built
villages and the pillager outpost (`src/04v_struct_village.js`; D-189). W18 built the rest —
shipwrecks, ocean ruins, buried treasure, the monument, the mansion (`src/04w_struct_rest.js`;
D-190) and the stronghold's own room grammar (`src/04x_struct_stronghold.js`; D-191).

**Where the phases above ended up.** S1 and S2 are W13/W14. S3 is W16 — and it did exactly what
this document predicted, *"where terrain negotiation gets built and debugged on something small
enough that failures are cheap and obvious"*: the fill/shave split, the downward fill over caves
and the flatness tolerances were all found on a desert pyramid and an igloo before a village ever
needed them. S4 is W17. S5/S6 is W18, minus the four structures that belong to dimensions this
build does not have (bastions, fortresses, end cities and nether fossils — G19's).

`node tools/nbtcheck.mjs --print` and `node tools/structcheck.mjs --print` regenerate everything
below. Legend as before, plus `!` lava and `X` a frame, spawner, chest or bookshelf.

**A plains village, 280 pieces, sliced through the middle of its start chunk.** The buildings are
the `#` blocks standing above the ground line; the run of `o` at y 65–66 is the terrain and the
street tiles laid into it.

```
  74 ...............................................##...............
  73 ..................ooo.........................#..#....###...###.
  72 .............ooo..oo....................###..#....#..#...###...#
  71 .............o#o.ooooo......................##.oo.####.........#
  70 ............oo#ooooooo.......................#....#..o.........o
  69 ............oo#oo........................#o..#...o#..#.........#
  68 ...........ooo#o...................o#####ooo.######..###########
  67 ...........ooo#o.....oooooo#####o###oooooooo...o.o...oooo.....oo
  66 ............######o######o#ooooooooooooooooooooooooooooooooooooo
```

**A pillager outpost, 75 pieces — the watchtower standing on its base plate.** This is the case
D-188's fill/shave split exists for: the tower's floor is twenty blocks up and is supported by the
plate, not by a pillar of dirt.

```
  87 ..................................####...####...................
  82 .................................#...........#..................
  81 .................................#############..................
  80 ..................................##.......##...................
  77 ...................................#.#######....................
  73 ..................................###########...................
  68 ..................................###########...oooooooooooo####
  67 ................................oooooooooooooooooooooooo########
```

**A stronghold corridor at y 22–25**, 24 pieces, found at one of the 128 `concentric_rings`
positions. Stone brick walls with a five-block interior, cut into the deep stone.

```
  25 ...o.ooooooooo#########oooooooooooooooooo.....oo..o....ooooooooo
  24 ..oooooooooooo#.......#ooooooooooooooooooo.....o..oo....oooooooo
  23 oooooooooooooo#.......#ooooooooooooooooooooo.....ooo....oooooooo
  22 oooooooooooooo#.......#ooooooooooooooooooooooo......oo.ooooooooo
```

**What the checks assert about all of it.** `nbtcheck`: all 866 templates re-encode byte for byte,
the packed blob decodes to the same block list as the jar, four rotations are the identity AND
move more than a quarter of the palette, and the same `(seed, chunk)` gives the same piece list
across 300 assemblies. `structcheck` §8–§10: 27 of the 31 structures have a grammar and the four
that do not are named, **every floor cell of every RIGID piece has an opaque block under it —
2,742 of 2,742, asserted as a zero and not as a band** (D-216), no interior is buried, and a
village has a town centre, streets AND houses — which is the one thing a piece count cannot tell
you, and the bug D-189 shipped.

⚠ **That sentence used to read "every placed building floor is supported" and it was not true.**
Until D-216 §9 scored a floor column supported when the cell under it was opaque **or** when that
cell lay inside a different piece's bounding box — and a village street's box is 13×2×11 of which
110 of the 143 ground cells are not road, so a house standing on a street square scored as
supported while standing on nothing. It printed 97.5% while `structaudit` §1 measured 3,111 of
village_plains' 10,334 structure-written solid cells in ungrounded components. A box is not a
block. §9 now derives each piece's base layer from the piece itself and asks the generated chunk
what is under it; the `terrain_matching` pieces, whose floor is wherever the drape put it, are
counted separately and printed: **2,069 of 2,099**, the residual named below.

---

## The structure AUDIT — `tools/structaudit.mjs` (session 6)

Dan, on a glitched underwater structure: *"dont go duckhunting glitches just build general
tools"*, *"dont pursue something specific just construct general tests that can catch everything
and compare everything"*. So this stage hunts no structure.

**The hole it fills.** `structcheck` holds 84,316 assertions and every one of them is about
PLACEMENT ARITHMETIC — the region grid, the template decode, the start cache, the determinism of
the write order. **None of them looks at the blocks.** That is NEXT.md's first standing lesson
(*a check that never looks at the picture cannot see the world*) applied to Track W's output.

**The one technique.** Generate every sampled chunk **twice** — once with `params.structures`
on and once with it off — and diff. The cells that differ are, by construction, exactly the cells
the structure pass is responsible for, whatever wrote them: a template block, a beard plinth, a
shave that removed terrain, a mineshaft's air. Nothing re-implements `writePiece` or asks a
grammar what it meant to do, which is what makes it general: a grammar landing in a later session
is audited the day it lands, with no new code.

**The sample.** Four seeds, vanilla climate by name (D-182), 147,456 chunks scanned for starts
(the start pass reads no blocks, so scanning is nearly free — 1,038 starts, 24 families), and one
instance of every family per seed generated twice inside a window of at most 3×3 chunks: 56
structures over 600 chunk generations, 12 s. `--deep` widens both.

| section | what it measures | what it asserts |
|---|---|---|
| 1 floating | 6-connected components of structure-written SOLID cells; whether each rests on natural ground; the underside-over-air fraction; **`dug`** — an ungrounded component's underside resting on air the structure wrote where the control world has ground (D-216); every count attributed to the sampled start's own **pieces** (`insidePiece`, §3's test — D-226; it was the bounding box) as well as to the window; and `⚠ CLIPPED` on any family wider than the window | **zero** cells with nothing solid anywhere below to y=−64; **zero** instances entirely ungrounded. The component histogram, its `own` attribution and `dug` are PRINTED; `dug` is a registered open defect, the histogram is not bounded at all — a balcony, a ledge, a hanging mineshaft support and a `feature_pool_element` tree are all ungrounded and all correct |
| 2 buried | terrain still standing inside a rigid piece's own box (`terrain_matching` excluded — its box is a fiction); the worst piece's KIND AND SHAPE printed beside its number | **no piece ≥75% buried** (D-226 — the deepest legitimate shape is a mineshaft staircase at 62.5%, which is the arithmetic of a 3-wide channel through an 8×8×3 box, and the referee's worst real ocean ruin is 29.8%) |
| 3 technical | `structure_block`, `jigsaw`, `structure_void`, `barrier`, `light`, `moving_piston`, the three command blocks | **zero of any kind but the one registered defect**, and **zero standing in terrain no structure wrote**; every offender's coordinates printed |
| 4 joins | every jigsaw piece's connectors recomputed from `tpl/rot/ox,oy,oz` and matched to its parent's — name pair reversed, facing opposite, socket on the front cell | zero orphans, zero unreachable pieces, zero roll mismatches, **no two boxes overlapping without a join** (D-189 allows the parent alone) |
| 5 spacing | every candidate chunk against the **jar's own** `structure_set` JSON: vanilla's offset window is `[0, spacing − separation − 1]` on both axes | every offset inside the window. Bounding-box overlaps counted, not forbidden — `mineshafts` has spacing 1 and vanilla's overlap too |
| 6 water | structure-written AIR against water (flooded on the first tick) and structure-written WATER over air (falls on the first tick), against the same statistic over untouched terrain, split by `insidePiece` into the sampled structure's own and the rest of the window (D-226) | both are registered open defects: the numbers are reported per family, and each registered mechanism must still reproduce |
| 6c drain | the question §6 cannot ask, because §6 needs surviving water to ask it: was this cell WATER in the control world with water above it, and is it AIR now? (D-226) | **zero** cells left dry under standing water, per family — a dry bubble under the sea. The raw drained count is printed: a surface film replaced by land is what vanilla's own `generateBox(AIR)` does |
| 7 anti-vacuity | 31 deliberate breaks, including the diff itself | every break caught (D-30) |

**Which structures section 4 applies to is a question for vanilla's data, not for this file**: a
structure is jigsaw-assembled exactly when its `configured_structure_feature` carries a
`start_pool`. Guessing by "it placed more than one template" calls an igloo a jigsaw structure —
igloo NBTs carry jigsaw blocks because Mojang authored them in the same editor.

**Result: 1,065 jigsaw pieces across six families reconstruct with zero orphans, zero
unreachable pieces and zero unjoined overlaps.** The assembler's join invariant holds.

### ⚠ What it found — the defect register

⚠ **The four numbered findings below are the session-6 report and all four are now FIXED** —
1, 2 and 3 by D-212 and 4 by D-216 — and each entry says so and says what replaced it. The
`REGISTER` in the tool holds what is still open, which after D-221 and D-226 is **two** mechanisms
and not these: `air-against-water` (92 cells, down from 133) and `wrote-air-then-stood-on-it` (190,
down from 404, and 172 of the 190 are vanilla's own mineshaft plank floor). `water-on-air` was the
third and is gone — D-221 took it to zero in the default sample *and* in `--deep`, and D-139's rule
is that the entry is then DELETED rather than left standing at zero, which §7 enforces.

A systemic defect is one line of one file and shows up in whichever families a
given sample happens to reach. So `REGISTER` at the top of the tool is keyed by **mechanism** and
never by family — a per-family list changes shape with the sample size, which is a threshold
fitted to a run (D-152, D-178) with extra steps. `--deep` proved it: the same three mechanisms
surfaced in nine families the default sample never touches. Each entry is reported loudly with
its per-family numbers and does not fail the run (the defects are in `src/`, which this tool does
not own); anything outside the registered mechanism still fails hard — a technical block that is
not a `structure_block`, or one standing in terrain no structure touched; and a registered
mechanism that stops reproducing anywhere in the sample FAILS, so a fix is not finished until its
entry is deleted (D-139). **No numeric budget is recorded anywhere.**

Default sample: 2,308 assertions · 27 deliberate breaks · 25 open findings · 12 s.
`--deep`: 3,850 assertions · 169 structures · 262,144 chunks scanned · 31 s.

1. **`structure_block` reached generated worlds — 42 in a 56-structure sample. FIXED, D-212** (0 now, asserted hard).
   `src/02e_templates.js:108–110` builds three palette flags (`structure_void`, `jigsaw`,
   `air`/`cave_air`) and `JG.writePiece` (`src/04t_jigsaw.js`) acts on those three. Vanilla places
   every one of these templates through `BlockIgnoreProcessor.STRUCTURE_BLOCK`, which strips
   `minecraft:structure_block` as well. **97 of the 866 packed templates contain 196 such cells** —
   `underwater_ruin` 98, `shipwreck` 44, `woodland_mansion` 34, `igloo` 1, `end_city` 19 — and every
   one that generates is written into the world as a real, visible structure block. A debug block
   standing inside a shipwreck is exactly what a player calls a glitch.
2. **The beard's SHAVE drained the ocean. FIXED, D-212.** `src/04u_struct_surface.js`, `SU.writeBeard`: the shave
   branch clears every cell from `base + 1` to `topY` with `A.set(..., 0)` whatever was in it,
   including WATER — so a structure under the sea gets an air bubble carved around it whose wall
   is air-against-water on every face. The FILL branch four lines above already has the rule the
   shave is missing: `if (cur !== 0 && NS.States.waterIn[cur]) break;  // never drain an ocean`.
   Measured: 47% of `ruined_portal_ocean`'s own air cells, 29% of `ocean_ruin_cold`'s.
   ⚠ **And the same branch had a second half, fixed in D-221:** it stopped *removing* the water and
   went on removing **the rock the water was standing on**, because the loop ran upward and treated
   a water cell as something to skip past. A submerged piece's box was dug out of the sea floor and
   the sea left sitting on the hole. The loop runs downward now and stops at the first liquid.
3. **Mineshaft corridors are carved into water. FIXED — D-212, then D-221.** D-212 stopped the
   carve draining the sea (the corridor floods instead of bubbling); D-221 gave it vanilla's actual
   rule. `MineShaftPieces` opens every `postProcess` with `if (this.edgesLiquid(box)) return;` — a
   piece whose grown box touches liquid is never built — and the direct port is forbidden here
   because `edgesLiquid` READS BLOCKS across up to eleven chunks, where a read outside the target
   returns −1 and the piece would exist in one chunk and not the next (D-185, and the bill D-213
   and D-217 already paid). The pure-position form is in `§ The liquid gate` below.
4. **A village street deleted the ground under the house beside it — FIXED, D-216.** Two writers,
   both in `src/`, and the second was hiding behind the first.
   · The template writer had `legacy_single_pool_element` vs `single_pool_element` **the wrong way
   round**. Vanilla's `LegacySinglePoolElement` swaps `BlockIgnoreProcessor.STRUCTURE_BLOCK` for
   `STRUCTURE_AND_AIR`, so the LEGACY form — every village and outpost piece — drops its air
   before it reaches the world, and the plain form (60 template pools, all `bastion/`) keeps it.
   MC-Lite wrote the legacy air and skipped the plain. A street tile is 208 air cells and 48
   `dirt_path`, so it laid its air over the surface block a house was standing on.
   · And the plinth reached the piece's **box floor** rather than its underside. A template whose
   bottom layer is `structure_void` — `desert_farm_2` is 67 void cells and three sandstone in
   layer 0 — stands a block higher than its box, and 100 of one desert village's 1,009 floor
   cells were over air for that reason alone. `JG.groundLy` is where the underside is now.
   · With the air rule fixed, the per-column drape vanilla actually specifies —
   `Projection.TERRAIN_MATCHING`'s `GravityProcessor(WORLD_SURFACE_WG, -1)`, i.e.
   `Column.height(x, z) + localY` — became safe and is back in `JG.writePiece`. It was removed in
   session 5 on the evidence of holes it appeared to dig; those holes were the street's own air.
   **Measured, default sample, before → after:** village_plains 35 components / 3,111 cells /
   largest interior 254 → **6 / 24 / 3**; village_snowy 22 / 502 / 222 → **12 / 48 / 9**;
   pillager_outpost 139 / 1,417 / 48 → **8 / 20 / 0**; village_taiga's 74 / 1,161 / 141 is
   unchanged and was never the village — see the `own` column.
   Worked example, seed 1337, plains village at chunk (−79, 90), x −1276 z 1476: floor cobblestone
   at y 68 with **grass_block at y 67** where there was air.

   ⚠ **The evidence is the real game, not a reading of the two names.** The golden 1.18.2 pregen
   (D-199) contains a vanilla snowy village at chunk (−503, 92) IN THAT SEPARATE GOLDEN-PREGEN
   REFERENCE WORLD used for this structure-legality check. ⚠ D-702/D-705 (sessions 138-139) went
   looking for this same coordinate as a LIVE MC-Lite repro spot for the ground-see-through bug
   and found plain forest there, not snow — flagged, not yet resolved: this could mean MC-Lite's
   own worldgen doesn't place a village there (a real, separate placement bug worth checking with
   `tools/vanillacheck.mjs` once a golden pregen is available locally) or that this coordinate was
   never guaranteed to match a LIVE in-browser seed-1337 world in the first place. Do NOT reuse
   (−503, 92) as a live repro coordinate without re-confirming it first. `village/snowy/streets/straight_02`
   is 16×2×16 — 48 `dirt_path` and 208 AIR in layer 0, 253 AIR in layer 1 — and in the generated
   world its road steps 93 → 94 → 95 down the slope while the ground on both shoulders is intact
   `grass_block` **at the same Y as the road**. If the legacy form wrote its air, every shoulder in
   every village in the game would sit one block lower than the road it flanks.

### ✅ And the check that used to say otherwise — corrected, D-216

`structcheck` §9 counted a floor column as supported when the block under it was opaque **or**
when that cell was `inAnother(...)` — inside a different piece's bounding box. A street's box is
mostly AIR, so a house standing on a street square scored as supported while standing on nothing,
and *"97.5% of placed floors are supported"* was measuring boxes rather than blocks. The comment
that claimed the hole had been closed by making `terrain_matching` pieces rigid was wrong in the
same way: the piece became rigid, its air did not become ground.

It now asks the block. `floorsOf(piece)` derives the piece's **base layer** — the lowest layer it
fills in at least a quarter of the columns it occupies, which is neither "the lowest solid cell in
each column" (that calls a roof eave a floor: 34 of `plains_tool_smith_1`'s 84 columns, one of them
over a wall torch) nor "the lowest layer with anything solid in it" (that is one column of a
pyramid's foundation pillar) — maps it into the world with the drape applied, and reads the
generated chunk one block below. **Rigid pieces: 2,742 of 2,742, asserted as a zero.** Draped
pieces: 2,069 of 2,099, printed. §11 breaks the new test three ways on the village it just
measured — the support taken away, the read moved to the wrong side of the floor, and the base-layer
rule undone so the eaves come back — and requires each break to be caught.

### What is left of it

`structaudit` §1's `dug` counts an ungrounded component resting on air the structure wrote where
the control world has ground, attributed to the sampled start's own **pieces** (D-226; it was the
start's bounding box, which is a hundred-block cube of mostly empty world for a village).

**The class was 404 cells and is 190 (D-226), and it was three mechanisms, not two.** Classified
block by block:

* **the feature pass building on ground the structure took — 180 of the 404, and CLOSED.** Every
  one of those was in a monument window and not one was prismarine: 164 dead coral blocks and 16
  the core's floating dais. The monument had drained the ocean (D-226), `04q`'s coral features
  ran over the hole, found air where they expected water and left the dead variant of themselves
  standing on it. A structure that drains the sea changes what the feature pass builds on top of
  it.
* **vanilla's own plank floor — 172 of the 190 left (90.5%), and it will not go to zero.**
  `MineShaftCorridor.postProcess` lays `oak_planks` at the corridor's floor row *because* the cell
  is air: `if (getBlock(level, x, -1, z, box).isAir()) placeBlock(PLANKS)`. `04s` transcribes that
  test verbatim and the hole under it is another corridor of the same mineshaft. It stays
  registered so that the 18 cells which are NOT it stay visible.
* **the draped street** — a `terrain_matching` street draped onto `Column.height` (the ground
  *before* the structure pass) crossing a terrace a neighbouring house's beard shaved *after* it.
  ⚠ The obvious fix is measured and worse: draping onto the written world makes the answer depend
  on how much of the structure has been written and took a desert village from 903 supported rigid
  floor cells to 901.

## The liquid gate — `edgesLiquid` as a pure function of position (D-221)

Vanilla's rule for a mineshaft piece is not "flood it", it is **do not build it**:
`MineShaftPieces` opens every `postProcess` with `if (this.edgesLiquid(level, box)) return;`, and
`StructurePiece.edgesLiquid` walks the six faces of the box grown by one block, returning true at
the first liquid. Porting that directly is forbidden by the invariant this whole document is
built on: it reads blocks over a box that spans up to eleven chunks, a read outside the target
chunk returns −1, and the piece's existence would therefore depend on which chunk is being
filled. That is D-185, and it is the same mistake D-213 (every tree built by one chunk and thrown
away by the other eight) and D-217 (a disk sliced at the same seam) each paid for once.

**The rebuild.** Two things here are pure: `Column.height(x, z)`, the natural ground, and
`seaLevel`. A cell holds sea water exactly when `Column.height(x, z) < y <= seaLevel`, so the whole
six-face walk collapses to **one scalar comparison**: the shell reaches `y0 − 1` at the bottom and
`y1 + 1` at the top, so it meets water iff `y0 − 1 <= seaLevel` **and** the lowest ground under the
grown footprint is below `min(seaLevel, y1 + 1)`. Water touching a side face at a lower y needs
ground lower still, so the top face's test covers all six. Same answer from all nine targets.

**Marked, not removed.** A flagged piece stays in the list and `write` returns 0 for it — which is
vanilla's own model (`postProcess` returns before writing) and keeps the start's bounding box, the
grammar's shape and `structcheck` §5's *"every mineshaft has exactly one room"* untouched. A first
draft filtered the list instead and deleted the room of three of 178 mineshafts.

**Two stages, because the exact test costs 120 ms.** `Column.height` is the whole spline stack at
~10 µs a column here, and the union of one mineshaft's grown footprints is ~12,000 columns —
measured over twelve starts at seed 1337: 8.6k–15.2k columns, 98–183 ms each. Paying that on every
mineshaft would have put ~10 ms a chunk on a 16.9 ms budget. So stage 1 screens the whole start on
a **capped** lattice (at most 24×24 samples — `SU.survey`'s "cap the count, not the spacing") and
only concludes *dry* when the lowest ground it saw is 8 clear of the highest cell any shell can
reach; stage 2, the exact one-block test, runs on the starts that survive. **The screen is fenced,
not trusted**: `structaudit` §6b re-derives the shell test in the tool, at one-block resolution,
over every piece that SHIPPED, and fails if one of them has sea water on its shell.

**What it costs and what it buys.** Over every start the audit's scan finds — 638 mineshafts,
134,985 pieces in 147,456 chunks — the gate flags **1,647 pieces, 1.22%**. `gencheck` moves from
14.83 to 14.97 ms a chunk (+0.9%).

**What it does not see, and the number that says why.** `Column.height` is the terrain before the
carvers, so the gate sees THE SEA and nothing else. MC-Lite's aquifer is a fake (D-67): one 2D
noise decides whether a region has a water table, and its water exists only in cells a *carver*
hollowed — a 3D fact no pure column function answers. Gating on `y0 − 1 <= aquiferLevel(x, z)`
instead drops **4,222 of 28,445 pieces (14.8%) across 136 mineshafts on four seeds and deletes 7
mineshafts outright**, to remove ~105 boundary cells. One corridor in seven of every mineshaft in
the world, most of them in dry rock a carver never touched, is a far larger deviation than the one
it fixes, so it is not done and the residue is registered instead.

### §6 before and after — the whole table

Default sample, four seeds, 147,456 chunks scanned, 56 structures deep-sampled. Both columns at
the same HEAD; only `04s` and `04u` differ.

| family | before | gate only (04s) | after (04s + 04u) |
|---|---:|---:|---:|
| ocean_ruin_cold | 233 | 0 | **0** |
| ruined_portal_ocean | 100 | 83 | **0** |
| ruined_portal_mountain | 63 | 63 | **14** |
| village_plains | 21 | 21 | **7** |
| mineshaft | 104 | 104 | 104 |
| shipwreck | 3 | 3 | 3 |
| jungle_pyramid · village_taiga · mineshaft_mesa | 2 · 2 · 1 | 2 · 2 · 1 | 2 · 2 · 1 |
| **total** | **529** | **279** | **133** |
| structure air against water | 0.37% | 0.20% | **0.09%** |
| natural air against water (same windows) | 0.02% | 0.02% | 0.02% |
| `water-on-air` (the third register entry) | 79 | 79 | **0 — entry deleted** |
| `wrote-air-then-stood-on-it` | 408 | — | **404** |

`--deep` (169 structures, 262,144 chunks): air-against-water **943 → 415**, 0.17% → 0.08%;
`ruined_portal_ocean` 241 → 1, `ruined_portal_swamp` 61 → 0, `village_taiga` 57 → 9,
`pillager_outpost` 132 → 115; `water-on-air` 67 → 0. Nothing rose in either sample. The one number
that moved the wrong way is `structaudit` §2's burial for `ocean_ruin_cold`, 16.0% → 16.8%, and it
is the trade the fix makes on purpose: the shave no longer digs the sea floor out from under the
water, so a little more terrain stands inside a submerged ruin's box.

### What is left in §6, named

Every remaining cell was classified individually — the adjacent water's y against `Column.height`
and `Caves.aquiferLevel`, whether it is natural or structure-written, and which way it lies:

* **the fake aquifer against a mineshaft corridor** — mineshaft 87, mineshaft_mesa 1 of the 92 in
  the default sample. Corridor air hollowed out of solid rock, natural water beside it at or below
  the column's water table. Vanilla's `edgesLiquid` would have abandoned the corridor; the
  position-only version of that gate costs 14.8% of all corridors, above.
  ⚠ **The `shipwreck 3` this list used to carry was never the shipwreck's** — it was a mineshaft
  corridor crossing the shipwreck's WINDOW. Until D-226 split every count in §1, §2 and §6 by
  `insidePiece`, a family label in `structaudit` was the name of the window rather than the name
  of the structure, and which family a defect landed on changed with what else a run sampled.
* **a structure cut sideways into the shoreline** — village_plains 3, swamp_hut 1. Control world
  solid, written world air, natural sea water **beside** it — never above, because D-221's
  downward shave closed every one of those.
  ⚠ **This arm was 21 cells and is 4 (D-226).** D-221's waterline break was a BLOCK READ, and
  every FILL in a structure runs before every shave: a plinth that had already reclaimed a
  shoreline left dirt where the sea had been, and the shave walked down through the waterline
  finding nothing to stop at. It now also stops on the pure form, `Column.height(x, z) < y <=
  seaLevel`. ruined_portal_mountain 10 → 0 and ruined_portal_jungle 1 → 0 with it.

### §6c — the drain, and the monument that no window was wide enough to see (D-226)

§6 asks whether there is water **left** beside a structure's air, so a writer that drains the whole
neighbourhood scores zero on it. The ocean monument hollowed itself out with `SU.Cells`'s `-1` air
marker and turned **41,362 cells of ocean into air per monument — 78.6% of every natural water cell
in its window** — and §6 called it clean for three sessions, because the deep window is 48 blocks
across and a monument is 58, so the sample lay entirely inside the bubble.

`SU.SEA` (`-2`) is the second clear marker: water at or below `seaLevel`, air above, a pure
function of `y` so D-185 holds. It is vanilla's own rule — every empty cell of an
`OceanMonumentPiece` goes through `generateWaterBox`, and `OceanMonumentBuilding.postProcess`
floods its box up to `max(getSeaLevel(), 64)`.

§6c is the measurement that would have caught it: **was this cell water in the control world, with
water directly above it, and is it air now?** The asserted form is narrower — the same cell with
water still standing somewhere above it in the finished world, which is a dry bubble a player digs
down through the sea floor and falls into. Every family is at zero.

**The referee, on the golden pregen at seed 1337.** Six real 1.18.2 monuments, clustered off their
prismarine and measured inside the cluster's own box: water **53.3–72.9%**, air **0.0–0.5%**,
natural terrain **6.6–34.7%**. MC-Lite's four, by the identical procedure: water **0% before the
fix and 66.9–69.5% after**. Six real ocean ruins: **9.1–29.8% buried and 0.0% air**, which puts
MC-Lite's `ocean_ruin_cold` 16.8% and `ocean_ruin_warm` 21–27% inside vanilla's own band — §2's
burial numbers are not defects.

⚠ **What the referee also found and this work did not fix: MC-Lite's monuments break the surface.**
Every real monument tops out at **y = 60**, three blocks under the waterline; MC-Lite's turrets
stand at **y = 66**. Vanilla plants the building at a fixed y and is 22 layers tall; MC-Lite
anchors it to the sea floor and is 29. Changing the anchor alone would bury it instead — a top at
y = 60 puts the floor at 32 and up to 65% of the box inside rock, against the referee's worst real
monument at 34.7%. Both numbers have to move together, with a picture. See D-226.

## How many structures the world has, and how that is measured (session 6, D-242 · D-243 · D-244)

`docs/NEXT.md` carried, for two sessions, *"vanilla places 122 structure starts where MC-Lite
places 98 — 80%, and nobody has taken it"*. Somebody took it. **The headline was not a
measurement**, three of the four causes underneath it were real, and the instrument that found
them is not a count.

### Why the count could not have found anything

Both numbers are draws. Vanilla picks its candidate chunk inside each spacing cell with a Java
LCG and MC-Lite picks its own with sfc32 — that is D-124, it is licensed, and it means the two
engines are sampling **different chunks** of the same box. So the right test on 122 against 98 is
the binomial share `p = m / (m + v)`:

| box | vanilla | MC-Lite | ratio | 95% CI on the ratio | two-sided p |
|---|---|---|---|---|---|
| seed 1337, 16,323 chunks | 122 | 98 | 0.803 | 0.61 – 1.05 | 0.106 |
| seed 4242, 8,394 chunks | 62 | 46 | 0.742 | 0.50 – 1.08 | — |
| pooled, before D-242/D-243 | 184 | 141 | 0.766 | 0.62 – 0.95 | 0.016 |

Per family it is worse: `mineshaft` 57/48 is 1.2 Poisson sigma, `mineshaft_mesa` 11/6 is 1.5,
`buried_treasure` 2/1 and `ruined_portal` 4/2 are coin flips. **Not one family in either world
is individually significant.** The pooled total is, marginally — and it points nowhere.

⚠ And the one family dense enough to measure on its own says the grid is right. The mineshaft
gate is a pure function of `(seed, chunk)`, so it can be sampled without limit: over **4,000,000
chunks** it fires 16,050 times against the configured 0.004 (z = +0.40), and +2.36, +0.95, −1.22
at three other seeds. The 54 gate passes in seed 1337's golden box against an expected 65 are
−1.4σ of that same unbiased draw. Mineshafts are 58% of the whole count and there is nothing
wrong with their rate.

### The instrument that did work: replay vanilla's own start chunks

For every start the real game placed, ask MC-Lite's placement machinery whether it would have
accepted **that chunk** — the same biome tag, the same probe y, the same site survey, the same
expansion — leaving out only the two things D-124 licenses to differ: the in-cell grid offset and
the probability draw. Vanilla ran those rules on those exact chunks and said yes. Every no is
MC-Lite disagreeing with the real game about a rule, and it names which rule.

| | refusals of vanilla's own 184 sites |
|---|---|
| before | **19 (89.7% accepted)** — flatness veto 10, dry-land veto 1, buried-treasure depth window 2, biome probe 6 |
| after D-242 and D-243 | **8 (95.7% accepted)** — 4 site veto (all named), 4 biome probe (all named) |

The four causes it found, in the order it found them:

1. **D-242 — the mineshaft asked the biome at its own depth.** `buildStart` probes at the
   structure's own y when no `preProbeY` is declared, and a mineshaft's own y is where 1.18 keeps
   `lush_caves` and `dripstone_caves`. The probe y was then determined **from the answer key with
   MC-Lite switched off**: only the quart cell holding y = 48…51 accepts the member vanilla chose
   at all 106 of its mineshaft starts. That is `QuartPos.fromBlock(50)`.
2. **D-243 — the flatness veto.** 10 of 184. Removed for `ruined_portal`, `shipwreck` and
   `igloo`; kept for the three compiled-Java pieces, where `structcheck` §9's hard zero proves it
   load-bearing; kept for `village_*` and `pillager_outpost`, where it is the largest remaining
   cause of the shortfall and is blocked on the beard (below).
3. **D-243 — the dry-land veto and the buried-treasure depth window.** 3 of 184, both pure
   additions; the biome tag already says everything they said. Gone.
4. **Two open findings, both wanting the bytecode referee rather than another count.** Vanilla
   placed a `pillager_outpost` at chunk (-12,-26) of seed 1337 whose **entire** biome column, in
   vanilla's own saved array, is `wooded_badlands` — a biome its eleven-entry tag excludes. So
   1.18.2's outpost does not consult its tag, while MC-Lite does; MC-Lite in turn omits the
   1-in-5 gate and the near-village exclusion the real `checkLocation` has, and the two errors
   cancel to 2 outposts against vanilla's 2. Separately, a **standard** `ruined_portal` at (14,13)
   stands on `wooded_badlands`, which its tag excludes, while y = 50…100 of that column is
   `dripstone_caves`, which it allows — a standard portal is buried underground half the time, so
   vanilla evidently probes at the portal's own vertical placement where MC-Lite probes the
   surface. `ruined_portal_ocean` at (-22,12) of seed 4242 is the mirror image.

### ⚠ The beard bug the veto was hiding, with its coordinates

Removing the village veto moves `structcheck` §9's sample — it examines the first village its
region scan finds — and the village it moves to has a site spread of **seven**, so this is not a
rough-terrain problem. Three rigid floor cells stand over air there:

| cell | template | why |
|---|---|---|
| (-10474, 67, -14139) and (-10474, 67, -14138) | `village/desert/houses/desert_library_1` | inside another piece's box: every fill runs, then every shave, so a neighbouring house's shave ran over the plinth this house stands on. An UNDERPIN pass after every shave fixes both — written, measured, and **not shipped**, because with the veto in place nothing in the suite can see it work |
| (-10464, 58, -14086) | `village/desert/houses/desert_small_house_4` | open air, and the underpin cannot reach it: the beard knows the piece's BOX underside (`JG.groundLy`) and this column's floor is a block above it |

**The beard must learn the template's per-column floor.** Then both village vetoes come out, and
that is worth 54% and 65% of MC-Lite's villages and 50% and 53% of its outposts at the two seeds.
`structcheck` §9 now prints the template and the coordinates with the failure, so the next
session starts from the bug report rather than from a regenerated world.

### What `vanillacheck` §7 holds now

`7a` the grid — candidate chunks per structure_set against the exact expectation for a uniform
in-cell offset, at 4σ of the binomial. `7b` the paired referee — acceptance of vanilla's own
start chunks, a **ratchet** at 90% (0.897 → 0.951 and 0.968). `7c` the ledger — every refusal
names its mechanism and stays under that mechanism's share of the family's vanilla sites, with a
stated minimum sample of four, because a 60% cap on n = 1 is a zero wearing a percentage.
`7d` the count, pooled, with its confidence interval printed beside it and banded at 0.6–1.4.
And the dead-grammar rule D-227 caught firing on luck is now paired and has no draw in it at all:
of the n chunks vanilla started a family on, MC-Lite must accept at least one.
