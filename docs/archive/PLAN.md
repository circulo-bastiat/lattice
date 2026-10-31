# MC-Lite — MASTER PLAN

**Written 6 September 2026, session 1, overnight.** This is the document Dan asked for
before any further code: *"create a full, complete, heavily researched plan for mclite, in
both a w phase and g phase, and an x phase."*

It supersedes the ordering in `docs/NEXT.md`. It does **not** supersede `docs/CHARTER.md`
or `docs/DECISIONS.md` — those are the constitution; this is the schedule.

---

## 0. How to read this

Four tracks. Each stage has an **id**, a **precondition**, a **deliverable**, and an
**acceptance test that must exist and must fail before it passes**. A stage with no test is
not a stage, it is a wish.

| track | what it covers | parity stance |
|---|---|---|
| **F** — Foundation | asset extraction, the registry, the model system, the atlas, the profile, tooling, git | **PERFECT.** This is the cheap side of the charter. |
| **W** — World | worldgen, climate, caves, structures, lighting, meshing, streaming | **LITE with soft parity.** The one place deviation is licensed. |
| **G** — Game | the survival loop, inventory, crafting, block behaviour, GUI, sound, entities, mobs | **PERFECT.** Tables and 2D drawing. Costs time, not frames. |
| **X** — Extras | QoL mods, resource packs, shaders, accessibility | Additive. Never load-bearing. |

**The governing sentence, quoted so nobody has to go looking for it** (Dan, 6 Sept 2026):

> *"the cheap stufdf is PERFECT, like the gui in later stages, blocks looks, items, sounds,
> etc. but the expensive stuff (rendering (somewhat) and worldgen) are to follow the 'lite'
> of this project while keeping soft parity"*

**RULE 1**, adopted verbatim from MineHTML Track C and binding here:

> *Every approximation must REPLACE one deterministic rule with a cheaper deterministic
> rule. It may NEVER DELETE an invariant.*

The test of the whole project, restated: a person watching over Dan's shoulder
*"would probably be not very able to tell easily it wasnt minecraft with the old textures
on."* Every stage below is scored against that sentence, not against a feature list.

**Performance is not a track.** Dan: *"perf goes in w and g appropriately as i said."*
Sodium-style renderer work is W. Lithium-style logic work is G. C2ME-style parallelism is
W. Nothing performance-related is ever deferred to X.

---

## 1. What was measured on 6 September 2026, and what it changed

Seven findings. Each one is the reason a stage below is shaped the way it is. Every number
here was produced by a command against a real file, not recalled.

### 1.1 ⚠ `data/minecraft/worldgen/` is EMPTY in the 1.18.2 client jar

The only data directories in `1.18.2.jar` are:

| directory | entries |
|---|---|
| `data/minecraft/advancements/` | 1,141 |
| `data/minecraft/loot_tables/` | 986 |
| `data/minecraft/recipes/` | 1,058 |
| `data/minecraft/structures/` | **866 `.nbt`** |
| `data/minecraft/tags/` | 270 |

Every biome, noise, density function, noise setting, configured feature, placed feature,
carver, structure set, template pool and processor list is a **built-in registry defined in
Java**. In 1.16.2–1.17.1 they shipped as JSON in the jar; **1.18 moved them into code.**

Any plan that says "port the worldgen JSON out of the jar" is simply wrong for this
version. The first draft of this plan said exactly that. It has been corrected.

**Resolved the same night.** Mojang's own data generator would produce them
(`java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports`) but
`piston-data.mojang.com` is refused by the egress proxy from *both* the cloud container and
Dan's device VM, and that VM has Java 11 where 1.18.2 needs 17. So the route taken instead
is `misode/mcmeta`, branch `1.18.2-data` — the community's canonical mirror, which runs
Mojang's generator per version and commits the output verbatim. `raw.githubusercontent.com`
is reachable; the GitHub API and codeload are not, so the file list comes from the
`1.18.2-summary/registries/data.json` index on the same mirror, making the fetch
**exhaustive by construction rather than by crawling**. A crawl that misses a reference
fails silently, three stages later, as a missing biome.

`tools/fetch-vanilla-data.mjs` — **766 / 766 files, 0 failures, 5.7 s:**

| registry | files |
|---|---|
| `worldgen/biome` | 61 |
| `worldgen/noise` | 60 |
| `worldgen/density_function` | 23 |
| `worldgen/noise_settings` | 7 |
| `worldgen/configured_carver` | 4 |
| `worldgen/configured_feature` | 184 |
| `worldgen/placed_feature` | 220 |
| `worldgen/structure_set` | 17 |
| `worldgen/configured_structure_feature` | 31 |
| `worldgen/template_pool` | 126 |
| `worldgen/processor_list` | 33 |

**This is the single most important unblock of the session.** It converts W from "invent
something plausible" into "port data", which is exactly what Dan demanded:
*"absolutely not try to invent a whole new worldgen; most of the worldgen should be ported
from 1.18.2, only the preagreed stuff shouldnt."*

### 1.2 The block roster is fully extracted and proven

`tools/extract-blocks.mjs` against `1.18.2.jar`:

```
blocks 900   states 6,200   placements 12,864   unique models 1,563   textures 809
multipart blocks 60
shapes: box 4,056 · multi 4,149 · thin 3,448 · cube 805 · cross 177 · empty 124 · slab 105
models missing 0 · dangling textures 0 · empty states 0 · state explosions 0
```

Jar inventory, measured: 900 blockstates, 1,725 block models, 1,235 item models,
861 block textures, 457 item textures, 421 entity textures, 63 GUI textures,
835 block loot tables, 1,058 recipes, 133 block tags.

⚠ `docs/DECISIONS.md` D-5 still quotes the **1.21.1** figures (1,062 blockstates,
2,137 models, 1,012 textures) from before the version was settled. **F1 corrects it.**

### 1.3 Two real defects in the model interpreter, found by its own test

`tools/modelcheck.mjs` runs 55 assertions; the first run produced 5 failures, 3 of which
were real and are now documented in `tools/models.mjs`:

1. **Multipart `when` clauses enumerate only the TRIGGERING value.** `oak_fence.json` says
   `{"north":"true"}` four times and never mentions `"false"` at all. A naive reader
   concludes the fence has **one** state instead of sixteen. Every property domain must be
   unioned across the whole file *and* seeded with `{true,false}` for any property seen only
   with a boolean value.
2. **Blockstates files describe only what is VISUAL.** `waterlogged` on slabs and stairs,
   `powered` on doors — absent entirely, because they change no model. The state space from
   blockstates JSON is therefore a **lower bound**, not the truth.
3. Implicit UVs must be derived from the element's extent on the face's plane, not assumed
   to be `[0,0,16,16]`. A slab's side face is `[0,8,16,16]`, and getting this wrong is
   invisible on full cubes and wrong on everything else.

The check now carries an **anti-vacuity self-test**: it breaks the implementation three
ways and asserts each break is caught. A test suite that cannot fail is not evidence.

### 1.4 The old textures cover 65% and the seam is auditable

`tools/build-atlas.mjs`: 809 requested, **527 (65%) from 1.13.2**, 282 fallbacks to 1.18.2,
**0 missing**, 41 animated (frame 0 taken and recorded), 763 unique tiles after content
dedupe, atlas 448×448, **258 KB indexed PNG** (vs RGBA), 344 KB as base64.

Set difference on the raw directories: 1.18.2 has 818 block textures, 1.13.2 has 539,
**283 exist only in 1.18.2** — the 1.14→1.18 block families (bamboo, bees, campfires,
deepslate, copper, amethyst, sculk, dripstone, moss, azalea, froglights, candles, and the
nether 1.16 set). Those are exactly the fallbacks. Nothing else falls back.

⚠ **Programmer Art is NOT in the 1.18.2 jar** — measured, zero entries, same as 1.21.1.
The 1.13.2 jar is the only old-texture source and it is already in hand.

### 1.5 ⚠ Collision shapes are solved, and much better than planned

The first plan said `VoxelShape`s are compiled Java and would need ~60 hand-written
exceptions over a union-of-element-AABBs derivation. **That work is unnecessary.**
`PrismarineJS/minecraft-data`, `pc/1.17/blockCollisionShapes.json` (which `dataPaths.json`
maps 1.18 to) carries **898 blocks and 4,105 distinct shapes**, per state, as real AABB
lists — the actual `VoxelShape`s, not a guess. Reachable and fetched.

`pc/1.18/blocks.json` adds, per block: `hardness`, `resistance`, `emitLight`, `filterLight`,
`transparent`, `boundingBox`, `stackSize`, `material`, `harvestTools`, `defaultState`,
`minStateId`/`maxStateId` and the full `states` list — the ~880 floats §7 of the survey
called "not in the jar in any form".

Also fetched and cached: `items`, `foods`, `entities`, `materials`, `biomes`, `tints`,
`attributes`, `enchantments`, `sounds`, `language`.

**Consequence:** G's block-behaviour work loses its single biggest unknown, and the
occlusion mask (§1.7) gets a cross-check rather than being the sole source of truth.

### 1.6 Structures: half is free data, half is a bigger code job than it looks

All 866 `.nbt` template pieces **are in the client jar**; the 126 template pools, 33
processor lists, 17 structure sets and 31 configured structures are now fetched (§1.1). So:

| structure | how vanilla builds it | MC-Lite cost |
|---|---|---|
| village, bastion, pillager outpost | jigsaw + NBT | **data — nearly free once the pipeline exists** |
| woodland mansion, end city, shipwreck, ocean ruin, igloo, ruined portal, nether fossil, buried treasure | NBT pieces, some layout code | mostly data |
| **mineshaft** | **procedural Java** | **reimplement — no file to port** |
| **stronghold** | **procedural Java**, ~14 piece types, room grammar | reimplement |
| **dungeon** (`monster_room`) | procedural Java *feature*, not a structure | reimplement (small) |
| desert pyramid, jungle temple, witch hut, ocean monument, nether fortress | procedural Java | reimplement |

▶ **This inverts the intuition in `STRUCTURES.md`.** Phase S2 (mineshafts, dungeons) gets
**no help at all** from the NBT pipeline and is a *bigger* job than it looks; phase S4
(villages) gets nearly all of its content free and is a *smaller* content job than it looks.
The ordering in `STRUCTURES.md` is still correct — it is ordered by terrain difficulty, not
by content cost — but nobody should schedule S2 expecting to port a file. **§7 below
records this against each phase.**

Four traps in the NBT format, each of which is a known port bug:
- `minecraft:structure_void` in a palette means **"leave whatever is already there"**, not
  air. Treating it as air punches square holes in hillsides.
- ⚠ **CORRECTED, D-216 — THIS BULLET WAS BACKWARDS AND THE ENGINE BELIEVED IT FOR THREE
  SESSIONS.** It is the PLAIN `single_pool_element` that writes air; `legacy_single_pool_element`
  does **not**. Vanilla's `LegacySinglePoolElement.getSettings` pops
  `BlockIgnoreProcessor.STRUCTURE_BLOCK` and adds `STRUCTURE_AND_AIR`, which is the ignore-air
  form. Villages use the legacy form, so a village street does NOT dig its own air — and while
  MC-Lite believed otherwise every street cut a one-block trench into the ground and left the
  houses sharing its squares standing over a void: 3,111 ungrounded cells in one plains village,
  the largest component 254 cells, whole houses. Settled against the real game rather than by
  argument: in the golden 1.18.2 pregen the snowy village at chunk (−503, 92) lays
  `village/snowy/streets/straight_02`, whose layer 0 is 208 AIR cells, and its shoulders are
  intact grass_block **at the same y as the road**. If legacy wrote its air, every village road
  in Minecraft would have a trench along both sides. `single_pool_element` appears in exactly 60
  template pools and all 60 are `bastion/`, so the correction cannot touch anything an overworld
  generator places.
- `projection: terrain_matching` drops each column to the local surface. That is
  `STRUCTURES.md`'s "paths that follow contours" — **it is data, not a thing to invent.**
- Unconnected jigsaw blocks must be replaced by their `final_state`, or they stay visible
  in walls.

Size: 866 files. Re-encoded with one **global** palette, varint positions, RLE over sorted
positions, DEFLATE, base64 — budget **< 1.5 MB**, to be *measured before it is claimed*
(D-7's rule).

### 1.7 The occlusion mask is free, and it fixes the mesher for slabs and stairs

A block occludes a neighbouring face only if it presents a full 16×16 face on that side.
That is derivable at extraction time from the element AABBs already parsed, as a **6-bit
mask per state** — and it can now be cross-checked against §1.5's real collision shapes.

This is the cheapest possible answer to `PERF-MODS.md`'s warning that greedy meshing stays
correct only while the face-culling rules stay exact: it makes them exact, at zero runtime
cost, before the mesher ever runs.

---

## 2. The four tracks, and why the order is what it is

```
        F1 ─ F2 ─ F3 ─ F4 ─ F5 ─ F6 ─ F7 ─ F8 ─ F9         FOUNDATION
                    │         │              │
                    │         └──────────────┼──► G1 … G20   GAME
                    │                        │
                    └────────► W1 … W18 ─────┘               WORLD
                                    │
                                    └── S1 … S6              (structures, inside W)
                                                 X1 … X8     EXTRAS
```

**Why Foundation is first and is not negotiable.** Dan expects to wake to *"a block (and
non cube) roster that is literally perfect on looks, rotations, items perfect too."* Every
one of those words is Foundation. It is also the track where a mistake is cheapest to fix
and most expensive to discover late: a wrong UV rule found at F4 is an afternoon; found at
W12 it is a re-mesh of everything.

**Why W before G.** Dan: *"i really dont want worldgen to be perfected without minecrafts
roster of blocks"* — which is F before W — and then *"structures on ugly terrain still look
ugly"* (D-10), which is terrain before structures. But G's inventory and crafting want a
world to stand in, and G's block behaviour wants blocks that already exist.

⚠ **This used to say "W runs to its first gate, then G and the rest of W interleave", and
Dan has overruled it.** The gate is not at W12. **ALL of Track W — through the structures
stages W13…W18 — is finished before GATE W is breached and any G stage starts.** The reason
is D-10's, one step further on: structures on ugly terrain look ugly, and a G track built
against a world that is still growing structures gets rebuilt against the world that has them.

**Why X is last and small.** It is the only track whose absence nobody would notice.

---

## 3. TRACK F — FOUNDATION

*Parity stance: **PERFECT**. This is the cheap side of the charter and there is no excuse
for an approximation anywhere in it.*

### ✅ F1 — Correct the record
**Precondition:** none. **Status: this document.**
`DECISIONS.md` D-5 quotes 1.21.1's counts; `ASSETS.md` and `STRUCTURES.md` predate §1.1 and
§1.6. Rewrite them against the measured numbers. **Acceptance:** no number in any doc that a
tool cannot reproduce on demand — and therefore ⚠ **no bare `≈`**. Session 4's audit found four
approximations left standing and they are all the same case: a figure that is COMPILED JAVA and
that no tool in this repo can reach yet — per-block `SoundType`, which is **G13**'s. The rule as
it now stands, and as `doccheck` §8 enforces it: an approximation is allowed only on a line that
also names the stage or decision that will produce the real number — G13 for the sound types.
An approximation with no owner is a number nobody will ever go back and fix.

### ✅ F2 — Zero-dependency jar and PNG libraries
**Deliverable:** `tools/jarlib.mjs` (central-directory ZIP reader with ZIP64 and
`inflateRaw`), `tools/png.mjs` (decode colour types 0/2/3/4/6; encode with per-scanline
filter selection and an indexed-colour path). **Done.** No npm dependency anywhere in the
build, per D-17/D-18's spirit.
**Acceptance:** `inflatecheck` §6 — five hand-built images through both encode paths and back,
byte-identical, plus the indexed path measured (**28.5% smaller on a four-colour 64x64 tile, and
never larger than truecolour on noise**) and a corrupted file required to be rejected or to
decode differently. `modelcheck` covers `jarlib` by reading real models out of the jar.
⚠ Session 4's audit added that section: until then the PNG library was exercised only by the
build writing `atlas.png` and other checks reading it back, which proves the pair AGREE and
proves nothing about either against a case the atlas does not contain. It found two things
immediately — the encoder threw on a plain `Uint8Array` because it used Buffer methods on its
input, and `tools/pngdec.mjs` (the small reader the browser checks use) cannot decode the
indexed PNGs that `png.mjs` writes. The first is fixed; the second is stated where both are
imported, because two decoders that disagree about which files they can read is a trap.

### ✅ F3 — The real model system
**Deliverable:** `tools/models.mjs` — parent-chain resolution, `#var` texture chains,
`variants` and `multipart` (with `OR`/`AND`/`alternatives`), element `from`/`to`/`faces`,
`cullface`, `tintindex`, `uvlock`, x/y placement rotation, implicit UV derivation.
Dan: *"Implement vanilla's real model system."* **Done, 55 assertions, 0 failures,
anti-vacuity self-test included.** §1.3 records what it caught.

### ✅ F4 — The generated block registry
**Deliverable:** `assets/block-registry.json` + `assets/extract-report.json`. 900 blocks,
6,200 states, 12,864 placements, zero defects (§1.2). Never hand-edited; regenerating it is
the only way to change it.

### ✅ F5 — The atlas
**Deliverable:** `assets/atlas.png`, `atlas-index.json`, `atlas-report.json` — 65% old
textures, every fallback named, lossless, 258 KB (§1.4).

### ✅ F6 — Vanilla worldgen data
**Deliverable:** `tools/fetch-vanilla-data.mjs`, 766 files cached (§1.1). **This is what
unblocks W.**

### ✅ F7 — The constants merge
**Precondition:** F4, F6.
Merge into the registry, per state: hardness, resistance, light emission, `filterLight`,
`transparent`, `boundingBox`, `stackSize`, `material`, `harvestTools`, and **the real
collision AABB list** from §1.5; tool tags from `data/minecraft/tags/blocks/mineable/*`;
drops from the 835 block loot tables; display names from `lang/en_us.json`.
Emit the **6-bit occlusion mask** per state (§1.7) and **assert it against the collision
shapes** — a full-face occlusion claim that the collision data contradicts is a defect, and
this is the only stage where the two sources can be cross-examined for free.
**Acceptance:** `tools/constcheck.mjs` — every one of the 900 blocks has a hardness; every
state has a collision list and an occlusion mask; the two agree on every full cube; the 60
known-thin families (fences, panes, walls, carpets, doors, trapdoors, slabs, stairs, layers) are
each spot-asserted against a hand-written expectation.
⚠ **"and a sound type" was in this line until session 4's audit and was never true**: neither
the jar's data nor the PrismarineJS dataset carries a per-block `SoundType` — it is compiled
Java, it is ≈25 types over ≈880 blocks, and it is **G13's** job along with the `.ogg` files
themselves. The acceptance said the check asserted something the data cannot express, which is
worse than an untested claim because it reads as a tested one.

### ✅ F8 — The non-cube mesher — DONE, session 2
**Precondition:** F3, F7. **This is the stage Dan named in his goodnight message.**

⚠ **The number that justifies this stage: of 12,864 placements, only 805 are full cubes.
94% of the roster is not a cube.** A cube-only mesher is not "most of the way there"; it is
6% of the way there, which is exactly why the current build looks the way it does.

The mesher consumes the model interpreter's *quads* rather than assuming cubes. Greedy
meshing survives only for the `cube` class; `slab` (105) and `box` (4,056) emit axis-aligned
boxes; `cross` (177), `thin` (3,448) and `multi` (4,149) emit model geometry directly;
`empty` (124) emits nothing. Rotation, `uvlock`, `cullface` **and `tintindex`** are all
resolved at bake time so the runtime does no per-face maths — the tint index has to travel
into the vertex format here, because W5's biome colour dispatch has nowhere else to attach.
**Acceptance:** `tools/meshcheck.mjs` — the **round-trip test** from the survey's acceptance
list, and it is the test that stops rotation bugs recurring. For ≥20 hand-picked blocks
covering every geometry class (full cube; slab top/bottom/double; stairs in both halves and
all five `shape` values; fence with all sixteen side combinations; wall with `up`; pane;
torch on all four walls; cross plant; log on all three axes; door; trapdoor; redstone wire
cross) the emitted quads are compared against a reference and must match **exactly**,
including cullface identity *after* rotation and UV orientation *under* `uvlock`.

⚠ **Where the reference comes from matters more than the test does.** A dump generated by
the same interpreter proves only self-consistency — the exact failure mode `modelcheck`'s
anti-vacuity self-test exists to prevent. So the reference for these 20 blocks is
**hand-written**: each expected quad list is typed out from the model JSON by a human
reading, once, and checked in. It is 20 blocks precisely because that is how many can be
done honestly by hand.
Dan: *"mchtml is having issues with block rotation and states and looks and i dont even
want to have to think about that."* This test is the answer to that sentence.

### ✅ F8b — The runtime format — DONE, and it went further than planned
**Precondition:** F8. **Not started; this section exists so the next session starts with the
answer rather than the question, because it was measured tonight and the numbers are not
close.**

The engine's current registry is **per-block** with a `tiles[id*6]` cube assumption, so the
generated roster is not a drop-in for it — it is per-state with arbitrary geometry. That is
the real content of "wire it in", and it forces one decision first: how the baked geometry
gets into a `file://` HTML page.

Measured 6 Sept 2026, on the real data:

| encoding | bytes in the file | synchronous? |
|---|---|---|
| base64 of the raw binary | **2,520.6 KB** | yes |
| base64 of the deflated binary | **296.4 KB** | no — needs `DecompressionStream` |
| base-36 text, comma separated | 2,682.4 KB | yes |

⚠ **The page is opened from `file://`, so the browser never gzips it.** What counts is the
literal bytes on disk, which is why the base-36 option is a trap: it gzips to 232 KB and that
number is completely irrelevant here.

**Recommended: base64 of the deflated binary, decoded at boot with `DecompressionStream`,
with a JS inflate as the fallback.**

⚠ **What was actually built is better, and the reason is worth recording.** Writing the
fallback FIRST inverted the decision: once a synchronous inflate exists,
`DecompressionStream` buys nothing and costs a promise chain through the boot sequence, a
second code path to test and a feature check. `src/01b_inflate.js` is 210 lines of RFC 1951
and inflates the real 222 KB payload in **41 ms**, once. So there is one path, the boot
stays synchronous, and the workers use the same function with no capability test.

`tools/inflatecheck.mjs` proves it three ways: against Node's own inflate on the real
payload, against every DEFLATE block type including the ones the payload happens not to
use, and on the edges. ⚠ Its first run hung for two minutes — reading past the end of a
corrupt stream gives `undefined`, `undefined << n` is 0, and it decoded zeros forever. A
decoder that spins on bad input is worse than one that throws, because the symptom is a
frozen tab with no error. Bounds checks were added and three deliberate breaks now assert
they fire.

**Shipping payload, measured:**

| blob | base64 | what it is |
|---|---|---|
| block geometry | 296.8 KB | 4,027 parts, 41,389 quads |
| block constants | 38.1 KB | 900 blocks, 20,344 real states, 4,105 collision shapes |
| block atlas | 221.8 KB | **768 layers**, raw RGBA — smaller than the 344 KB PNG and no image decode at boot |
| item atlas | 132.3 KB | 534 sprite tiles |
| **total** | **0.71 MB** | against D-12's 15 MB |

The whole registry decodes in **71 ms in a real browser at `file://`**, and every field of it
is checked against the build's own JSON by `tools/regcheck.mjs` — **18,444 assertions**.

### ✅ F9 — Profile, tooling, git — DONE, session 2
**Precondition:** F8.
- **Profile refactor (D-27):** quality settings become one profile object resolved at boot,
  never scattered `if (lowEnd)` branches. Do it *now*, while the code is small.
- `git init`, a real `.gitignore` (`assets/` and `mcdata/` never leave the machine — D-6
  licensing), a first commit per stage from here on.
- ⚠ `tools/gitsweep.mjs`: refuse a commit that adds a file under `assets/` or `mcdata/`. **NOT
  BUILT.** What actually holds the line is `.gitignore` plus D-6, and `doccheck` does not know
  about it. Listed here so the gap is a gap rather than a claim.
- `tools/suite.mjs`: one entry point running modelcheck, constcheck, meshcheck, gencheck,
  gamecheck, shadercheck, smoke, bench — with a **non-zero exit on any failure**, because a
  suite nobody can fail is a suite nobody is running.

### ══ GATE F ══ — **BREACHED, 6 September 2026 (session 2)**
**All of F1–F9 green, plus the two blockers below, before any W stage starts.**

Every item is green and every one has a test that fails when it is broken:

| stage | what closed it | the test |
|---|---|---|
| F1 correct the record | PLAN §1, and session 2's `doccheck` for the sixty-one decision numbers that pointed at nothing | `doccheck` |
| F2 jar and PNG libraries | zero-dependency, in `tools/jarlib.mjs` and `tools/png.mjs` | every build stage |
| F3 the real model system | elements, rotation, uvlock, multipart, cullface, tintindex | `modelcheck`, `meshcheck` |
| F4 the generated block registry | 900 blocks, 8,933 visual states, 20,344 real | `regcheck` (18,444 assertions) |
| F5 the atlas | 781 textures, 768 layers, 64% from 1.13.2, alpha class per layer | `tilecheck`, `statecheck` |
| F6 vanilla worldgen data | 766 files, exhaustive by construction | `fetch-vanilla-data` |
| F7 the constants merge | 4,105 collision shapes, the harvest bracket, the 1.17 hardness hole | `constcheck` (6,504 assertions) |
| F8 the non-cube mesher | the model stream, neighbour cullface culling, and **23 hand-written reference cases matched quad for quad** | `meshcheck` (1,269 assertions) |
| F8b the runtime format | decoded at boot and in every worker in ~95 ms | `regcheck`, `statecheck` |
| F9 profile, tooling, git | `docs/PROFILE.md`, one runner over every check, and real git history in the project folder | `doccheck`, `suite` |
| B1 WebGL2 default | the world starts on WebGL2 and says why | `titlecheck` |
| B2 title menu | the game stops at a menu and takes typed input | `titlecheck` |

✅ **CLOSED, session 5: the project is an ordinary git working tree.** For three sessions it
lived as a git BUNDLE (`mclite.bundle`, regenerated each session) because the workspace could
not unlink files and git needs to drop temp objects constantly. The bundle and the tar shuttle
that carried it are both retired: `.git` is in the project folder on Dan's machine, and a
session commits there directly.

- **✅ B1 — WebGL2 is the default backend** (D-15). Done 6 Sept 2026. WebGPU renders a black world with a
  working GUI on Dan's RX 6800XT; F9 currently rescues it at runtime. Default must not be
  the broken path. WebGPU stays selectable and stays a stated goal.
- **✅ B2 — The title menu** (D-16). Done 6 Sept 2026. The game launches straight into the world, which is
  wrong, and the menu is the right home for the backend picker, the seed field and the
  quality preset.

---

## 4. TRACK W — WORLD

*Parity stance: **LITE, with soft parity.** This is the one track where deviation is
licensed — and the licence is narrow. Dan: **"most of the worldgen should be ported from
1.18.2, only the preagreed stuff shouldnt."** The pre-agreed deviations are exactly three,
listed in W0. Everything else is a port.*

### W0 — The three licensed deviations, and nothing else

| # | vanilla | MC-Lite | why | decision |
|---|---|---|---|---|
| 1 | 3D density-function terrain stack | **three cheap 2D fbm fields through splines, with terracing** | the density stack is the single most expensive thing in 1.18 chunk generation | D-21 |
| 2 | multi-noise biome placement from six compiled climate parameters | **latitude-driven climate model** — Hadley cells, ITCZ, subtropical highs, lapse rate, rain shadow, Whittaker lookup — **toggleable**, with vanilla multi-noise as the alternative | Dan asked for it explicitly and it is the point of this worldgen; the toggle keeps the port honest | D-22 |
| 3 | full 1.18 cave carver stack | **cheese + spaghetti worms + ravines, modestly cheapened** | Dan: *"the cheap caves where we can modestly and where it doesnt effect much in the terms of structures"* — the cheapening is capped by what structures need | D-21 + Dan, 6 Sept |

**Everything else in W is ported from the 766 files in §1.1.** Biome definitions, feature
lists, placement modifiers, ore distributions, tree shapes, surface rules, structure sets —
all data. If a stage below is tempted to invent, it is out of scope.

**RULE 1 applied to each deviation:** #1 replaces a density rule with a spline rule — the
invariant "height is a deterministic function of (x,z,seed)" survives and in fact gets
*stronger*, which §7 exploits. #2 replaces one climate lookup with another — the invariant
"biome is a deterministic function of climate parameters" survives. #3 replaces carver
counts with cheaper ones — the invariant "a carved cell is carved identically from any
approach direction" survives. **No invariant is deleted by any of the three.**

### ✅ W1 — The data loader — DONE, session 2
**Pre:** F6, F9. Parse the 766 cached files into a compact runtime form: interned strings,
numeric ids, a flat reference graph. Emit `assets/worldgen.bin`, decoded by `src/02d_wgdata.js` — **data only**; the
evaluator is hand-written. **Acceptance:** every id referenced by any file resolves; count
of dangling references is **zero**, and a non-zero count fails the build.

### ✅ W2 — Noise parity — DONE, session 2
**Pre:** W1. Port Mojang's improved-Perlin and the `NormalNoise` octave stack exactly,
seeded from the `worldgen/noise` parameters. **Acceptance:** `tools/noisecheck.mjs` — a
**statistical referee**: sample each of the 60 noise functions over a fixed grid and compare
mean, variance, min, max and the histogram against published vanilla figures. Dan chose this
verification method explicitly over golden files, because a golden file proves you match
yourself.

### ✅ W3 — The column function — DONE, session 2
**Pre:** W2. The three splined 2D fields (continentalness, erosion, weirdness → offset,
factor, jaggedness), terracing, and the **pure `height(x,z)` and `climate(x,z)` functions**
that everything downstream leans on. Spline point tables lifted from
`density_function/overworld/{offset,factor,jaggedness}.json` — data, not invention.
**Acceptance:** `gencheck` ASCII cross-sections, reviewable without a GPU; height is
byte-identical when sampled in three different orders.

### ✅ W4 — The climate model, toggleable — DONE, session 3
**Pre:** W3. Latitude bands, ITCZ, subtropical highs, lapse rate, rain shadow, Whittaker
lookup. World scale a world-creation setting (default 12,000 blocks equator-to-pole).
**The toggle is part of this stage, not a later one** — build both paths at once or the
vanilla path never gets built. **Acceptance:** with the toggle off, biome placement must
reproduce vanilla's climate-parameter dispatch; with it on, a pole-to-equator transect must
show the Köppen-plausible band order, asserted as an ordering test, not eyeballed.
✅ **The open item is closed** (D-112): `MultiNoiseBiomeSource.Preset.OVERWORLD` is on the
mirror after all, in a twelfth registry nobody had looked in —
`data/minecraft/dimension/overworld.json` carries the dimension's `biome_source` fully
expanded, which is the preset already compiled: **7,578 entries over 50 biomes**. The third
route this plan listed would have produced a wrong table quietly; see D-112.
**Delivered:** `tools/pack-biomeparams.mjs` (the table, quantised to i16 exactly as vanilla
quantises, plus a **baked R-tree** — D-113), `src/04e_climate.js` (the dispatch),
`src/04f_earth.js` (the physical model), the two world-creation settings on the title screen
(D-111), and `tools/climcheck.mjs`: **151,357 assertions, 11 deliberate breaks caught**,
including the ordering test run against the vanilla mode and required to FAIL.
Both acceptance halves met. §19 has the three bugs it uncovered.

### ✅ W5 — Biomes — DONE, session 3
**Pre:** W4. All 61 biome files: colours (grass, foliage, water, fog, sky), precipitation,
temperature, `spawners`, `spawn_costs`, `carvers`, `features` (the eleven decoration steps
in order). Colour dispatch from the colormap PNGs in the jar with vanilla's exact indexing:
`i = (1 − temperature) × 255`, `j = (1 − humidity × temperature) × 255`,
`colour = colormap[(j << 8) | i]`, plus the fixed overrides (birch `0x80A755`, spruce
`0x619961`, lily pad `0x208030`, the swamp perlin threshold, dark forest's
`(c + 0x28340A) / 2`). **Acceptance:** every biome renders its vanilla colour triple; the
`spawners` lists survive into the registry unmodified for G's use later.
**Delivered:** `tools/pack-colormaps.mjs` (the two ramps out of the jar, 52.7 KB deflated, with
the indexing pinned by four vanilla colours at build time), `src/04g_biomes.js` (the 61 biomes
resolved — colours, weather, the height-adjusted temperature, and the four lists passed through
by reference), `src/03b_noise.js`'s second noise stack (`java.util.Random` and Mojang's
`SimplexNoise` / `PerlinSimplexNoise`, which three fixed-seed biome noises need — D-118),
`tools/biomecheck.mjs` (**10,704 assertions, 12 breaks caught**, including a hand-written
colour reference covering all 61) and `dist/biomes.html`, a page of every biome and every
colour it carries. §20 has the four findings.
⚠ **The RENDER seam was deferred to W6, deliberately, and landed there** (§21.4). At the end of
W5 the colours were computed and proven but nothing in the game took one, because the world still
generated its biomes from session 1's twelve-value enum and tinting by the 1.18.2 map would have
painted a desert's yellow onto a forest's floor.

### ✅ W6 — Surface rules, and the moment the new world replaces the old one — DONE, session 3
**Pre:** W5. The `surface_rule` trees from the 7 `noise_settings` presets, ported as an
interpreter over the `material_condition`/`material_rule` types (11 and 4 of them). This is
what puts grass on dirt, sand at shorelines, deepslate below y=0, and the biome-specific
surface blocks. **Acceptance:** cross-sections show correct surface stacks in ≥10 biomes.

⚠ **This is also where W3's height function, W4's biome dispatch and W5's colours all reach the
game at once**, and that is not three separate jobs bolted on afterwards — it is why W6 is the
stage it is. Three things swap over together:

1. `src/04_worldgen.js` stops using session 1's spline stack and calls `Column.height`.
2. A chunk's biome array stops holding session 1's twelve-value enum and holds
   `Climate.biomeAt`'s answer — one of the 61 registry biomes.
3. **The tint seam.** Grass, foliage and water were three colours hard-coded in `10_gfx.js`'s
   `SHADE.TINT`, selected by a 2-bit vertex field. They had to become the biome's colours,
   blended across biome borders the way vanilla's `biomeBlendRadius` does, or a border is a hard
   line and reads as a bug.

   The design W5 leaves for it, and the reason it was not built early: **a tint texture keyed on
   world position, not a per-vertex colour.** A per-vertex RGB needs a third 32-bit word on the
   greedy path — measured: `data0` and `data1` have three and two spare bits — which is +50% on
   the vertex memory of the format that carries almost all of the world by volume. A texture
   costs nothing per vertex, because the shader already reconstructs world position from the
   section origin; it is a quart-resolution (one texel per 4 blocks) RGB image of the loaded
   area with three layers for the three tint channels, filled per chunk column from the biome
   array the generator already produces, and **bilinear filtering gives the border blend for
   free**. `shadercheck` gets the new sampling expression; both backends get the upload.


The three are one stage because doing any of them alone leaves the world visibly
inconsistent: new colours on old ground, or new ground with old colours.

**Delivered:** all three swaps, in one stage, as designed.
`src/04h_surface.js` (the `surface_rule` interpreter — 4 rule types, 11 condition types, with
`above_preliminary_surface` reconstructed as a bilerp of the preliminary height and the two
optimisations that make a full-column walk affordable: a GUARD that skips the rule tree entirely
above the first branch that can fire, and a CONST RUN that fills −59..min-surface with deepslate
in one loop), `src/04_worldgen.js` rewritten around `Column.heightAndClimate` with a quart-
resolution biome pass, `src/06b_tintmap.js` (the tint map), the tint texture and sampling in both
backends, and four checks: `tools/surfcheck.mjs` (**11,255 assertions, 9 breaks**, against a
hand-written 33-biome stack reference driven off REAL columns found by height band),
`tools/tintcheck.mjs` (**34,640 assertions, 9 breaks**), the tint block in `tools/titlecheck.mjs`
(the seam proven in the shipped file, in a browser) and `shadercheck`'s cross-language check of
the new sampling expression. §21 has the findings, including the two-block shift `tintcheck`
found in the shader on its first run.

### ✅ W7 — Carvers and caves — DONE, session 3
**Pre:** W6. The 4 configured carvers, plus deviation #3's cheese/worm/ravine set.
The cheapening is bounded by one rule: **a cave that a structure will later occupy must be
carved identically whether it is reached from the north or the south.** That is the
invariant RULE 1 forbids deleting, and it is what makes S2 possible at all.
**Acceptance:** determinism under three different chunk orders; cave volume per region
within a stated band of vanilla's.

**Delivered:** `src/04i_carvers.js` — the three overworld carvers (`cave`,
`cave_extra_underground`, `canyon`) read out of their own JSON and honoured field by field, as a
random walk of ellipsoids applied by asking every chunk within range what it sends into this one.
`tools/cavecheck.mjs` (**5,259 assertions, 8 breaks**) closes both stated acceptance criteria and
the invariant: five approach directions and three chunk orders, byte for byte. The cheapening is
D-123 and it is the only one taken — each source chunk's walk is generated ONCE and bucketed by
target chunk rather than regenerated 289 times — so the range, the tunnel counts and the radii are
all vanilla's. Measured: **0.3–0.9 ms of carvers on a 7.5 ms chunk.** Session 1's noise ravine is
gone (D-126), superseded by the canyon carver. §22 has the findings, including the two that
changed what the world looks like: caves now reach daylight (D-127) and a ravine is a slot rather
than a cathedral (D-125).

### ✅ W8 — Features and ores — DONE, session 3
**Pre:** W7. The 184 configured features and 220 placed features, with the 15 placement
modifier types. Ore distributions, trees (10 foliage placers, 7 trunk placers, 5 tree
decorators), plants, vegetation patches. **Nearly all of this is data**; the code is the
modifier interpreter. **Acceptance:** ore-per-chunk histograms compared to vanilla's
published distributions — statistical referee again, not golden files.

**Delivered:** `src/04j_features.js` — the pipeline: the anchors, the int/height/state
providers, the block predicates, the 14 placement modifiers the overworld uses, the recursive
`compileInline` that resolves a feature reference whether it names a configured feature, names a
PLACED one or inlines a whole object, and the `ore`/`scattered_ore`/`disk` generators. Then five
generator families registering against the published `Features.api` contract: `04k` trees,
`04m` water, `04n` terrain, `04p` cold and cave, `04q` coral — **32 registered generator types
over about 2,970 lines**, written in parallel by five full-strength sub-agents (D-138,
`docs/AGENTS.md`). `tools/featcheck.mjs` (**659 assertions, 5 breaks**) closes the stated
acceptance in the only two halves that are honestly checkable: the ore PEAKS come out of the
height providers in the JSON and are asserted exactly — `ore_diamond` peaks at y=−59, `ore_copper`
at 48 — while the per-chunk COUNTS are asserted for shape and order with the gap to vanilla
stated rather than papered over, because the blob algorithm is compiled Java. Section 3 carries
W7's invariant forward: **a chunk's decoration is a function of (seed, chunk) and of nothing
else**, proved from four approach directions. Coverage: **145 of 184 configured features and 160
of 220 placed features compile; 36 of 53 generator types have at least one working feature.**
Everything that does not is COUNTED and NAMED by the check itself, so a feature going missing is
a failure rather than a silence. ⚠ Session 1's nine hand-written ore bands, its `treePass` and
its `plantPass` are gone. §24 has the findings, including D-137, which is a fix that was built,
measured at 86 ms a chunk and then rejected in writing.

### ✅ W9 — Lighting — DONE, session 4
**Pre:** W8. Starlight-style: light propagates on the worker, not the main thread, with a
correct BFS and no main-thread stalls. ⚠ `PERF-MODS.md` records that Starlight is
*subtly* non-identical to vanilla — so the target is **vanilla's rule set at Starlight's
schedule**, and the check asserts the rule set.
**Acceptance:** `lightcheck.mjs` — a hand-built room with windows, overhangs and a
staircase; every cell's light level asserted against a hand-computed table.

**Delivered:** `src/08_lighting.js` — the 39-line stub is now the engine: two rings, a removal
pass and a propagation pass, both channels through one code path, budgeted by microseconds and
resumable mid-BFS. `World.setLight` is its one writer; `World` seeds it at two moments — a chunk
becoming resident (`Light.queueBorder`, which fixes the seam `Gen.lightPass` cannot see) and any
block edit (`Light.queueEdit`, which was a `TODO` and meant **placing a block changed no light at
all**). `tools/lightcheck.mjs`: **100 assertions, 6 deliberate breaks caught**, every number in
its tables worked out from the three rules and typed by hand, and the engine driven through its
adapter over a hand-built sealed room rather than through a copy of itself.

⚠ **Two rules were wrong, in the shipped worker pass as well as in the stub**, and W9 is where
they were found (both in D-142):

1. **The propagation cost is `max(1, opacity)`, not `1 + opacity`.** Vanilla charges one level
   for the step OR the block's opacity, whichever is larger, so a water block costs exactly what
   air costs. The old formula made the first cell under water 13 where vanilla says 14, and the
   error compounded with depth — every underwater cave and every ocean floor was too dark.
2. **Full sky light falls straight down for free**, which is why a shaft under a hole in a roof
   is 15 all the way to the floor. The old column seed kept a once-attenuated level all the way
   to bedrock instead, so a single water block in a roof dimmed the whole column below it.
   The removal pass needs the matching exception — a 15 under a 15 is derived light — or sealing
   the hole leaves a lit shaft hanging under the new block.

⚠ **The schedule is staged and it is written down as such (D-142).** The bulk pass stays on the
worker where it already was; the seam and edit passes run on the main thread in bounded slices
(`Settings.lightBudgetUs`: 800 low, 2,000 default), which delivers "no main-thread stalls" without
delivering "on the worker". Moving them off-thread needs a column and its eight neighbours shipped
per seed, and that transport is **W11's** job for all three of worldgen, meshing and lighting at
once. The engine is written against an adapter precisely so that move is a new adapter.

### ✅ W10 — Meshing and streaming at scale — DONE, session 4
**Pre:** F8, W9. Chunk visibility graph, vertex arenas, palette + bit-packed sections,
cancellation for chunks the player walked away from. **Acceptance:** `bench.mjs` on the
2200G profile hits the stated frame budget with the full 900-block roster loaded.

**What was already built, and what session 4 added.** Every mechanism this stage names had
landed early — the spiral request order and the two-rule eviction in `07_world.js` (D-89), the
snapshot pool (D-88), job cancellation (D-87), the 15-bit visibility mask and the flood that uses
it (D-85, ARCH 9.1), and palette + bit-packed sections since F. **None of it was asserted by
anything**, which by this project's own standard means none of it was done. `tools/streamcheck.mjs`
(**30 assertions, 5 breaks caught**) is the stage: the spiral is nearest-first and cached; a
column past `rd + margin` is evicted and the resident CAP drops the FURTHEST rather than the
newest; a cancelled job releases its in-flight slot in both directions (a leaked slot is
invisible in play and halves throughput); 180 meshes allocate at most one snapshot; an all-air
section reports `0x7fff` and a solid one reports `0`, which is what turns 525 sections into 86
drawn. Measured on the suite's own machine: **p50 0.45 ms and p95 13.6 ms a section, 19.4 KB of
geometry per non-empty section**, asserted as a regression fence rather than as a hardware claim.

⚠ **`bench.mjs` cannot be the whole acceptance, and D-143 says why.** The bench needs a GPU: in
the container the suite runs in, GL is SwiftShader and it reports 15 fps for reasons that have
nothing to do with this code. The hardware question — does it hit the budget on the 2200G — is
Dan's to answer on Dan's machine, and it stays in NEXT.md's "what a human should look at". What
CI can prove is everything W10 actually built, and that is what `streamcheck` proves.

### The W gate — what session 4's closing pass found, and what found it

⚠ **Sixteen real bugs, and not one of them by re-reading code.** This table is the argument for
every check in the suite that costs more than a second to run.

| bug | found by | fix |
|---|---|---|
| 5,684 plants standing in mid-air per 169 chunks | Dan, playing | D-140 |
| 158 spawners in open air, 5.5 dungeons a chunk | the same report, audited | D-141 |
| an edit changed NO light — `Light.step` was a stub | picking up W9 | §W9 |
| two vanilla light rules wrong in the shipped worker pass | writing `lightcheck`'s tables by hand | D-142 |
| the border pass seeded one cell per face, and was a no-op for any adapter loaded in a band of y | `parcheck` §5, first run | D-144 |
| a hole in the world underground: culling hid what you could see | `cullcheck`, first run | D-145 |
| every tree in the world mottled with black holes | LOOKING at a screenshot | D-146 |
| the outermost ring of the world could never be meshed | flying underground and looking | D-147 |
| the same fix, still wrong on the diagonals — 29 sections dirty for ever | `soakcheck`, first run | D-147 |
| the light queue had a 2,048-block world in it | arithmetic on a coordinate a soak flight reached | D-148 |
| nothing draws past ~3,000,000 blocks | flying to the world border | D-149, **open**, scoped |
| a player-placed glowstone lit nothing — every light test used a torch | an audit probe underground | D-150 |
| the whole game collided as full cubes: `shapesFor` was a stub, and `physcheck` §1 asserted it | a test that walks into a SLAB | D-152 |
| a fence 1.5 blocks tall could be jumped: `clip` never looked at the cell below | the same test, jumping | D-152 |
| breaking a block left the hole dark — nothing seeded its neighbours | `fuzzcheck`, first run | D-153 |
| no light spread sideways inside a tree: the spread ceiling was the pre-feature terrain height | `fuzzcheck`, first run | D-154 |
| plants left floating by breaking the block under them — `setBlock` sent no block update | auditing Dan's floating grass past D-140 | D-155 |
| `fuzzcheck` §3 measured that and passed it: its fence allowed half the plants to float | reading the assertion instead of its result | D-155 |
| every slab, stair, wall, fence, carpet and snow layer was a full light blocker — snowy peaks rendered black | `facecheck` §3 re-run at a second seed | D-156 |
| `facecheck` §3 measured that and passed it too: its fence allowed 5% of faces to be black | the same reading | D-156 |
| placement never chose a state: every stair faced north, a torch on a wall stayed a floor torch | Dan, from play | D-157 |
| a wall torch did not fall when its wall was mined — no support class could describe it | following D-157 through | D-158 |
| leaves rendered GREY on every preset below medium: the shader weighted the tint by texel alpha | LOOKING at a screenshot | D-159 |
| the render distance slider did nothing on a fast machine — the adaptive band came from a preset | Dan, from play | D-160 |
| 95% of the world was terraced in identical 3-block steps | Dan, from play; then a step histogram | D-161 |
| a settings change dropped every GPU mesh, flashing the whole screen sky-blue | Dan, from play; then a per-frame draw-list watch | D-162 |
| the suite could not see a colour at all — `palettecheck`, and its first design could not either | reintroducing D-159 to validate the new check | D-163 |
| `lightcheck` did not catch D-156: it asserted the tables and never called the shipped adapter | reintroducing all ten fixes, mechanically | D-164 |
| plants grew out of tree canopies and towered on each other — "solid" includes LEAVES | Dan, from play | D-165 |
| the celeron preset dropped grass and flowers — Dan's ruling: not a frame worth having | Dan, from play | D-166 |
| a torch stuck to the underside of blocks: the STANDING half of a wall pair had no rule at all | Dan, from play | D-167 |
| underwater plants carved air holes in the ocean — the cell held no water | Dan, from play | D-168 |
| the support rule had three implementations and `floatcheck` held the stale one | D-165 landing in two of the three | D-169 |
| every screenshot comparison read 3-channel PNG as RGBA, and ignored the bottom quarter entirely | chasing a flaky `cullcheck` and a `mean NaN%` in its own message | D-170 |
| a section outside the flood's grid was reported OCCLUDED — a band of missing horizon | `cullcheck`, once D-170 let it see | D-171 |
| our peaks are ~37 blocks taller than vanilla's own arithmetic: `TerrainShaper.offset` subtracts 0.50375 in JAVA | deriving vanilla's height map from the shipped `depth.json` | D-172, open, Dan's call |
| the flood's far-field conservatism, separated from its two real bugs and pinned | restructuring cullcheck rather than widening it | D-173 |
| `palettecheck` §1's bound was chosen, not derived; and AO cannot move saturation at all | D-166 breaking it | D-174 |
| **the white flash**: a shrinking render distance culled every mesh outside the flood grid at once | measuring the draw list across a render-distance sweep on both builds | D-175 |
| **stairs were placed backwards** — one facing rule where vanilla has two | measuring the raised step out of the collision shape | D-176 |
| glazed terracotta does not rotate: the greedy vertex format has no bits for a per-face UV rotation | sweeping every rotatable block for values that produce identical geometry | D-177, open |

**Seven lessons, in the order they were learned:**

1. **A check that never looks at the picture cannot see the world.**
2. **A test that runs at the origin tests the origin.**
3. **When a test picks an example, check whether it picked the easy member of the family.**
4. **A fence written around a known gap will pass an unknown one.** `fuzzcheck` §3 asserted "at
   most half of them may float" and read 55 of 167 as a PASS for as long as the bug existed;
   `facecheck` §3 asserted "at most 5% of upward faces may be black" and read 45 of 1024 the
   same way. Both are now exact.
5. **A check that runs at one seed tests one seed.** D-156 was invisible at the seed `facecheck`
   ships with and obvious at the next one tried.
6. **The suite tests what the engine computes; the player sees what it draws.** Six of these
   bugs came from Dan PLAYING, past a suite of thirty-odd green checks. D-159 was three
   instructions downstream of a mesh every check agreed was correct, D-162 was a frame with
   nothing in it, D-160 was a control loop quietly undoing a slider. None is visible from a
   data structure.
7. **A check that reimplements the rule tests the copy** — and this one cost more than the rest
   put together. `lightcheck` missed D-156 because it built its own light adapter; `floatcheck`
   would have passed the world Dan was complaining about because it kept its own support rule;
   `gamecheck` asserted stairs faced the wrong way because it was written from the same wrong
   belief as the code. The fix is always the same: call the function the game calls, or assert
   against the DATA — a collision shape, a shipped density function — rather than against a
   memory of what the rule was supposed to be.

### ☐ W10b — the remaining hardware run
`bench.mjs --profile low` on the 2200G, with the full roster resident. Owner: Dan.

### ◐ W11 — C2ME-style parallelism — determinism DONE session 4; the light transport is open
**Pre:** W10. Worldgen, meshing *and* lighting off the main thread; a real job graph;
worker count scaled to the machine; cancellation. D-14 chose this now because retrofitting
it is far more expensive than designing it in.
⚠ **`async` (the mod) is BANNED** — `PERF-MODS.md` records that parallel random ticks break
determinism, and determinism is the invariant every check in this plan rests on. Lithium's
no-behaviour-change logic optimisation is welcome; Async is not.
**Acceptance:** the determinism test from W3/W7 must still pass **with parallelism on and
worker count varied between 1, 2 and 8** — three runs, byte-identical output. This is the
only test that catches a data race, and it must exist before W11 is called done.

**`tools/parcheck.mjs` — 17 assertions, 3 breaks caught — is that test, and it exists.** ⚠ The
race it can actually catch is not the classic one: MC-Lite's workers share nothing (no
`SharedArrayBuffer`; `file://` forbids it), so two threads cannot write one array. What they CAN
do is diverge through a per-worker CACHE — the carvers' path cache, the features' placement
cache, the biome memo — whose contents depend on which columns that worker happened to be dealt.
So `parcheck` deals a 49-column region across **1, 2 and 8 independent engine instances**
round-robin, and again reversed and shuffled across four, and compares every block of every
column: byte-identical, all five runs. It also meshes one section in two instances and compares
the geometry and the visibility mask, and — §5 — settles the border light for six chunks in two
different ARRIVAL ORDERS and compares every lit cell.

⚠ **§5 caught two real bugs in W9's border pass on its first run**, which is the entire argument
for writing it: `queueBorder` had its two ternaries the wrong way round and seeded one cell of
each x-face and the diagonal of each z-face instead of the sixteen it meant to; and it asked
whether the neighbour was loaded ONCE, at y = −64, which is fine for the world's own adapter and
made the whole function a no-op for any adapter loaded only in a band of y. Light stopped dead at
chunk borders, and no other check in the suite could see it.

**What is still open**, and it is the transport, not the algorithm: worldgen and meshing are
off-thread and have been since F, the pool is sized from `hardwareConcurrency` clamped by the
preset (D-36, D-84), and cancellation is proven by `streamcheck`. **Lighting's seam and edit
passes are still on the main thread** (D-142), and the measurement that says how much that costs
is D-144: **1.64 ms per column of seam settling and 2.0 ms for 200 block edits**, against a
per-frame budget of 800–2,000 µs that slices it. It is bounded, it is small, and moving it needs
a column and its eight neighbours shipped per seed — so it is worth doing as part of the job
graph rather than on its own.

### ✅ W12 — Renderer parity pass (Sodium-style) — DONE, session 4
**Pre:** W11. Batched draws, reduced state changes, frustum + occlusion culling driven by
the visibility graph. D-13: **no** Distant-Horizons-style far LOD, nothing that makes a
screenshot look un-Minecraft. **Acceptance:** `shadercheck` + `bench` on all four rungs of
the hardware ladder; a screenshot diff against the pre-pass build shows *no visible change*,
which is the point.

⚠ **A DIFF AGAINST A STORED BASELINE IMAGE WOULD BE A GOLDEN FILE**, and `noisecheck`'s header
already says what those are worth: it proves you match yourself. `tools/cullcheck.mjs` takes the
diff against the SAME BUILD with the optimisation switched off — the game has had the switches on
F7 and F8 since session 1 — so the claim is the stronger one: *the fast path draws exactly what
the slow path draws*, on this machine, this run, on whatever the world generated. **17
assertions, 2 breaks caught**, run as a browser stage.

**What it found, on its first run: a hole in the world.** The occlusion flood refused to enter a
section outside the frustum, so a section reachable only through off-screen sections was dropped
— 3,160 wrong pixels of a 435,000-pixel frame underground, all of them brighter with culling on.
D-145 moved the frustum test to draw time, where vanilla and Sodium have it. The result is
pixel-identical on the surface and underground, and **18 sections drawn where the frustum alone
draws 22 and the old flood drew 27**. The batching numbers are asserted too: **1.06 draw calls
per section drawn and 0.58 buffer binds per draw**, which is what "batched draws, reduced state
changes" means when it is measured instead of asserted in prose.

⚠ D-145 also records the measurement trap that nearly reversed the decision: the adaptive render
distance (D-46) reacts to the slower frames of the un-optimised path and pulls the world in, so
**any A/B screenshot of this game freezes `Settings.adaptive` first.**

The bench half stays with the hardware, exactly as W10's does (D-143).

### Structures — W13 … W18. **See §7**, which replaces `STRUCTURES.md`'s cost estimates
with §1.6's measured ones and keeps its ordering.

---

## 5. TRACK G — GAME

*Parity stance: **PERFECT.** Dan: "literally everything except worldgen and maybe rendering
should be absolutely full parity, i really mean that." Every stage here is tables and 2D
drawing. Exactly right costs time, not frames — which is why there is no excuse.*

Ordering principle: **substrate → world interaction → survival loop → interface → content**.
Mobs are last, by D-9.

### ✅ G1 — Tags and the tag substrate
**Pre:** F7. The 270 tag files, with recursive `#tag` references. Everything downstream
(mining, crafting, burning, biome sets) is expressed in tags, so building it first stops
five later stages from each inventing their own set logic. **Acceptance:** every tag
resolves; cycles are detected and rejected.

### ✅ G2 — Block behaviour and block entities
**Pre:** G1, F7. Five layers, in this order because each needs the last:
1. **Placement** — what state a block takes from the placing context (facing, half, axis,
   `waterlogged`, connections). ⚠ §1.3's finding bites here: `waterlogged` and `powered`
   are **not in blockstates JSON** and must come from `blocks.json`'s state list.
2. **Neighbour updates** — connection recomputation for fences, walls, panes, redstone,
   stairs' `shape`.
3. **Random ticks** — crops, grass spread, fire, leaf decay. Deterministic, single-threaded
   (see W11's ban on Async).
4. **Scheduled ticks** — water, lava, redstone timing.
5. **Block entities** — chests, furnaces, signs, hoppers, spawners.

**Acceptance:** `gamecheck.mjs` scenario tests: place a fence next to a wall and assert both
connection states; flow water down a staircase and assert the level at each step; grow a
crop through all eight stages; light a fire under a stone slab and assert it goes out.

### ✅ G3 — Mining, drops and tools
**Pre:** G2. The **break-time formula**, ported exactly:
```
speed = (correct tool ? toolSpeed : 1)
      × (efficiency ? level² + 1 : 1) × (haste ? 1.2^level : 1) × (fatigue ? 0.3^min(level,4) : 1)
if (in water && !aqua affinity) speed /= 5
if (!onGround)                  speed /= 5
damagePerTick = speed / hardness / (canHarvest ? 30 : 100)
ticks = ceil(1 / damagePerTick)
```
Tool tiers: wood 2, stone 4, iron 6, diamond 8, netherite 9, gold 12. Drops from the 835
loot tables, with `apply_bonus` (`ore_drops`, `uniform_bonus_count`,
`binomial_with_bonus_count`), `explosion_decay`, `survives_explosion` — Fortune and Silk
Touch are therefore **data**, not special cases.
**Acceptance:** a table of ≥30 (block, tool, enchantment) triples with hand-computed break
times, asserted to the tick.

### ✅ G4 — Player physics — DONE, session 8 (D-250, D-251)
⚠ **The constants below were meant to be typed in from this document, and one of them is WRONG.**
Fall damage here reads `max(0, floor(distance − 3))`; vanilla's `calculateFallDamage` is
`Mth.ceil((distance − 3 − jumpBoost) × multiplier)` — a 4.5-block fall is 2 damage in the game and
1 under this line. The port follows the bytecode (D-251), the same way §25.3's G3 formula was
followed rather than believed. Friction, speedFactor and jumpFactor are FIELDS on
`BlockBehaviour` and are now reflected out of the 1.18.2 server jar into
`tools/golden/physics-1.18.2.tsv` (D-250) rather than remembered; `movecheck` holds all of it, and
computes every expectation from vanilla's law in closed form rather than asking the engine.
⚠ Creative flight stayed out: it is abilities-driven in vanilla and belongs to **G6**.

**Pre:** G2. The constants, ported and then **audited against `ARCH.md`'s existing claim**
that MC-Lite already uses vanilla numbers: gravity 0.08/tick, vertical drag 0.98, jump 0.42
(+0.1 per jump-boost level), sprint-jump bonus 0.2 forward, walk 0.1, sprint ×1.3, sneak
×0.3, air acceleration 0.02, ground acceleration `0.1 × (0.6 / slipperiness)³`, step height
0.6, eye height 1.62, hitbox 0.6 × 1.8 (1.5 sneaking), fall damage
`max(0, floor(distance − 3))`. Slipperiness: default 0.6, ice 0.98, packed ice 0.98,
blue ice 0.989, slime 0.8. Soul sand speed 0.4; honey speed 0.4, jump 0.5.
**Acceptance:** ≥15 movement traces (flat sprint, ice sprint, 3-block jump, sprint-jump
distance, ladder climb, water descent, slime bounce) asserted against vanilla-derived
positions per tick.

### ✅ G5 — The survival loop — DONE, session 8 (D-252)
Ported from `FoodData.tick`, `FoodData.eat`, `Player.getXpNeededForNextLevel` and
`CombatRules.getDamageAfterAbsorb` in the 1.18.2 server jar rather than from the constants below.
⚠ The acceptance asked for a hand-computed reference for every tick of a 10-minute session; that
is a second copy of the code and it agrees with the original about its bugs, so `survcheck`
asserts CLOSED FORMS instead — see D-252. The XP curve here and the game's own form are compared
level by level, because two algebraically identical formulas with different boundaries is exactly
where an off-by-one hides. ✅ `Hud.drawSurvival`'s placeholder is DELETED — G11 draws the row from
vanilla's `icons.png` (D-274), and D-276 records that the deletion had to happen twice, because the
first attempt left the old block in the file where it silently kept winning.

**Pre:** G4. Health, hunger, saturation, exhaustion, regeneration, starvation, damage types,
death, respawn, XP. Constants: 20 hunger points; saturation ≤ food level; exhaustion
threshold 4.0 (spends 1 saturation, then 1 food); regen at food ≥ 18 every 10 s costing 6
exhaustion; starvation damage at 0. Exhaustion per action: sprint 0.1/m, jump 0.05,
sprint-jump 0.2, block break 0.005, damage taken 0.1, swim 0.01/m. XP to next level
`2L + 7` (L<16), `5L − 38` (16≤L<31), `9L − 158` (L≥31).
**Acceptance:** a scripted 10-minute session (sprint, jump, mine, take damage, eat) with the
hunger and XP curves asserted at every tick against a hand-computed reference.

### ✅ G6 — Gamemodes — DONE, session 8 (D-253)
`GameType.updatePlayerAbilities` ported field for field, which is what makes adventure and
spectator expressible at all: the old `creative` boolean decided instant break, flight AND damage
together and had nowhere to say "may fly but may not build". ⚠ Half of `modecheck` READS THE
SOURCE — D-139's rule is that a stage which replaces something is not done until the something is
deleted, so §6 scans `src/` for any surviving read of the boolean and §7 asserts the five call
sites now read the ability each one meant. Reach (5.0 / 4.5) is the one hand-sourced number: it
is decided client-side and this project reflects the server jar.

**Pre:** G5. Survival, creative, spectator, adventure — full parity per D-8. Reach
distance, instant break, flight, no-clip, damage immunity, the creative inventory.

### ✅ The placement class — closed session 9 (D-263, D-264)
⚠ Not a numbered stage: Dan reported *"placing blocks can overwrite others"* and it cut across
G2, G4 and G7. `14_player.js` was deriving vanilla's `Material.isReplaceable()` FROM GEOMETRY —
139 blocks and 2,590 real states against vanilla's 28 blocks / 774 states — so fence gates,
buttons, pressure plates, rails, levers, saplings, flowers, corals, cobweb, sugar cane and every
crop could be deleted by putting a block on them, in both directions. The table now comes out of
the jar's bytecode (`tools/extract-materials.mjs`, 898/898 blocks resolved, no mappings needed),
the seven Java overrides of `canBeReplaced` are implemented with their `getStateForPlacement`
partners, and `placecheck` holds all of it.
⚠ **The same golden table carries every block's MATERIAL**, which changes two later stages:
**G9's furnace burn times** and **G13's `SoundType`** are no longer "hand-table it".
⚠ **D-264 is DECLARED, NOT FIXED**: the raycast uses collision shapes where vanilla uses
interaction shapes, so a flower's outline is a full cube. It belongs with **G10**, which wants
the same baked data for the block-breaking overlay.

### ◐ G7 — Items, the item registry and item models
✅ **Session 8 closed the tint half (D-259)**: all 77 two-layer items — 67 spawn eggs, 5 leather
pieces, 4 potions, the map and the firework star — carry vanilla's own colours, reflected and
disassembled out of the 1.18.2 server jar. `firework_star`'s is hand-sourced because `ItemColors`
is client code. ⚠ Still owed and still ◐: the **67 block-entity item models** (chests, signs,
banners, beds, skulls — a live-model render G17 also needs), and the runtime item table itself,
which arrives with **G8**'s inventory because nothing draws an item stack before then.

**Pre:** F7. All 1,235 item models, resolved through the same interpreter as blocks;
`item/generated` layer stacking, `item/handheld` transforms, `display` transforms per
context (gui, ground, fixed, thirdperson, firstperson). Stack sizes, durability, tool tiers,
attack damage and speed from `items.json`; food `nutrition`, `saturationModifier`,
`isFastFood`, `canAlwaysEat` from `foods.json`.
Dan: *"items perfect too."* **Acceptance:** every item renders in the GUI at the correct
scale and rotation; a visual sheet of all 1,235 is generated and reviewed once.

### ✅ G8 — Inventory — COMPLETE, session 9 (D-260, D-261, D-265, D-266)
✅ **The CLICK half landed**: `src/14g_menu.js` is the whole of `AbstractContainerMenu.doClick` off
the bytecode — pickup, quick-move, swap, clone, throw, pickup-all and the quick-craft DRAG (three
types by three stages), plus `moveItemStackTo`, the `Slot` model and the 46-slot player menu.
`invcheck` is **153 assertions, 0 failures** over six sections of scripted click sequences.
⚠ **D-265 records the two bits that decide whether drags work at all** — the quick-craft header
and type read backwards from what the mask builder suggests, and writing them the obvious way
failed all eleven drag assertions at once.
⚠ **D-266 is a DECLARED deviation**: shift-clicked armour does not auto-equip, because
`Mob.getEquipmentSlotForItem` is compiled Java and is not extracted yet. The branch is absent
rather than approximated from a name suffix.
⚠ The crafting RESULT slot and the 2x2 grid exist and stay empty: matching a recipe is **G9's**,
and a slot missing until then would mean G9 had to change this file to add it.

#### The storage half, session 8 (D-260, D-261)
✅ The item table reaches the runtime (**D-260**), and `src/14f_inventory.js` has the stack, the
41-slot index space and `Inventory.add`'s search order — **the selected slot, then the OFFHAND at
40, then a scan of 0..35**, read out of the bytecode because no count can see it (**D-261**).
`invcheck` holds it. ⚠ **Still owed: the CLICK half** — `AbstractContainerMenu.doClick` (pickup,
quick-move, swap, clone, throw, and the quick-craft DRAG: three types by three stages), 777
instructions, disassembled and waiting at `tools/golden/javap.AbstractContainerMenu.txt`. A
half-written click table is worse than none, so it was not started at the end of a session.

**Pre:** G7. Real slot model, stacking, shift-click, drag-splitting (left = even split,
right = one each, middle = fill in creative), hotbar, offhand, armour slots, the crafting
grid, creative tabs and search. This is 2D drawing and a state machine, so per D-8 it is
**exactly right or it is wrong**.
**Acceptance:** ≥40 scripted click sequences against expected slot states, including the
drag-split edge cases that every clone gets wrong.

### ✅ G9 — Crafting, smelting and the rest — COMPLETE, session 9 (D-267, D-268, D-269)
✅ **All 1,058 recipes.** 1,045 are data in the jar (`tools/pack-recipes.mjs` → 16.9 KB deflated,
378 distinct ingredients, tag references left unflattened so `pack-tags`'s blob stays the single
source of truth); **13** — not twelve, PLAN had it wrong — are `crafting_special_*` and all
thirteen are implemented in `src/02h_recipes.js`.
✅ **The NBT layer landed with it** (D-267): stacks carry a deep-copied tag, compared
order-insensitively over objects and order-SENSITIVELY over arrays. G14 wants the same layer.
✅ **Furnace burn times are GENERATED, not hand-tabled** (D-269) — and carry the
`#non_flammable_wood` exclusion that makes crimson and warped wood members of `#planks` and still
not fuel. ⚠ PLAN's instruction to "hand-table them and mark the table as hand-sourced" is
retired, and so is the same instruction in **G13** for `SoundType`.
✅ **The colour tables are generated too** (D-268): 16 dye colours with the firework column
distinct from the diffuse one, and 13 flower effects.
`craftcheck` is **1,299 assertions, 0 failures, 8 breaks**, and §2 is not a sample: every one of
726 crafting, 112 cooking, 198 stonecutting and 9 smithing recipes is built from its own
ingredients and crafted. **0 collisions.**

#### The original plan for this stage
### ☐ G9 — Crafting, smelting and the rest
**Pre:** G8, G1. The 1,058 recipes (shaped, shapeless, smelting, blasting, smoking,
campfire, stonecutting, smithing), with tag-based ingredients from G1.
⚠ **Furnace fuel burn times are the one part not in the jar** — they are a hard-coded map in
`AbstractFurnaceBlockEntity.getFuel()` and D-8 names them explicitly. Hand-table them and
mark the table as hand-sourced. Smelting `cookingtime` and `experience` **are** in the data.
**Acceptance:** every one of the 1,058 recipes is exercised once, and the recipe book
returns the same match set as vanilla for ≥50 sampled grids.

### ✅ G10 — The player hand, swing and first-person view — COMPLETE, session 9 (D-270…D-273)
✅ `src/14i_hand.js`: the six-tick swing with its halfway rule and its -1 start, the attack
cooldown, and the ten crack stages clamped at 9. `handcheck` — 63 assertions, 6 breaks.
✅ The ten `destroy_stage` textures are forced into the atlas by name (D-270): no model references
them, so the model walk could not find them and the atlas shipped without them.
✅ The breaking overlay and the first-person hand are drawn on the HUD canvas (**D-273**, a
declared rendering deviation) and verified by **`g10check`**, the first browser stage that reads
the HUD's own 2D canvas — 16 assertions, 4 breaks.
⚠ **D-271 is open and named**: the per-item attack speed is a compiled-Java attribute modifier and
is not bound, so every item swings at the base 4.0. The route is the same `Items.<clinit>` walk.
⚠ **D-272** declares the hit-particle cadence (four ticks) rather than leaving it unmeasured.
⚠ **D-264 is still open**: outline shapes are not baked, so a flower's selection box is a full
cube. It belongs here and did not fit; it needs build-time shape data beside F7's 4,105 collision
shapes.

#### The original plan for this stage
### ☐ G10 — The player hand, swing and first-person view
**Pre:** G7, G4. Held item rendering, swing animation, block-breaking overlay with the ten
crack stages, hit particles, attack cooldown.

### ✅ G11 — GUI and HUD — COMPLETE, session 9 (D-274…D-281)
✅ `tools/build-gui.mjs` lifts **eight sheets** out of the 1.13.2 jar — widgets, icons, the
inventory/crafting-table/furnace/chest backgrounds, the legacy font and the default skin — as
**1,617 KB raw → 39.6 KB deflated**. The **glyph widths are measured** from `ascii.png`, exactly as
vanilla's `FontTexture` does, not tabled (D-274).
✅ `src/15b_gui.js` decodes them and owns every rectangle, the 46-slot layout, the tinted font
cache with vanilla's `(rgb & 0xFCFCFC) >> 2` shadow, and the survival HUD's layout **as data**
(D-279) so the anchors can be asserted rather than trusted.
✅ `src/15_hud.js` draws the vanilla hotbar and selector, item icons with counts and durability
bars, the real survival row (hearts, hunger, armour, air, XP bar and level), the held item's name
at vanilla's own anchor with its 40-tick fade (D-277), and the 46-slot inventory screen driven by
G8's `Menu.doClick`. The player is drawn into the preview window front-on (**D-278**, declared; the
lit, rotating 3D model belongs to G17).
✅ **`tools/guicheck.mjs`** — every rectangle asserted against vanilla's PIXELS rather than against
itself, all 46 slots against the slot artwork, all 94 printable glyph widths re-measured, and the
HUD's row geometry as arithmetic. **107 assertions, 10 breaks.**
✅ **`tools/dupcheck.mjs`** — one definition per name per module (**D-276**). It is here because
this stage is where the class was found: a 404-line block of `15_hud.js` was duplicated and the
stale copy won, and the same scan found `P.heldItem` shadowed, which had turned **every pickaxe
into a bare hand**. 81 assertions, 5 breaks.
⚠ **D-280**: the ten crack tiles were the only prefixed keys in an atlas of 791 bare ones, and the
runtime had grown a second lookup to cope. One spelling; the fallback is deleted.
⚠ **D-281**: the browser stages are run ONE AT A TIME on a two-core box.
⚠ **Still open and named**: the effect icons, chat, and the container screens beyond the player's
own (`crafting_table`, `furnace` and `generic_54` ship in the blob and nothing draws them yet) —
they need G9's menus wired to blocks, which is G2's block-entity half.

### ✅ G10b — The BLOCK ICON and the first-person HAND, as MODELS — COMPLETE, session 10 (D-311)
Dan, playing: *"there is no hand model, the item in block model is not even close, and many blocks
have wrong textures in hotbar and in world."* All three were one finding with three faces.
✅ `src/15d_blockicon.js` — a software rasteriser that renders a BLOCK STATE through its real model
at vanilla's `gui` display transform (rotation [30, 225, 0], scale 0.625), z-buffered, back-face
culled, with the per-face shade and the biome tint the world mesher uses. The flat item-sheet
sprite was never a block icon; it is vanilla's fallback for a block with no model, and 112 blocks
still legitimately use it.
✅ The same rasteriser at `firstperson_righthand` ([0, 45, 0]) draws the HELD block, and
`BI.renderArm` draws the ARM out of the 64×64 skin's own six faces — so the hand exists.
✅ `tools/texaudit.mjs` — the "wrong textures" half, and the answer was that the ENGINE was right:
318 cube blocks × 6 faces and 471 model blocks, **0 wrong, 0 missing from the atlas**. It produced
three FALSE POSITIVES first, and each was a lesson: the atlas dedupes by SHA-1 so two names can
share a layer; a clean permutation of faces is the signature of a missing x/y rotation; and
`placementsFor(bs, {})` matches only unconditional variants, which is why 640 of 900 blocks looked
unresolved.

### ✅ G10c — The BLOCK-ENTITY ITEM MODELS — COMPLETE, session 10 (D-317)
⚠ **Sixty items in the creative inventory drew NOTHING.** Every chest, all 17 shulker boxes, all
16 beds, all 16 banners, the six heads, the conduit and the shield are `builtin/entity` in vanilla:
no item sprite, no block model, drawn by running a BLOCK-ENTITY RENDERER into the slot. G11b found
it and named it; this is the stage that fixes it.
✅ **`tools/extract-models.mjs`** — the **fourteenth** bytecode-referee table (D-263): **70 layers,
310 boxes**, out of `CubeListBuilder.create().texOffs(0, 19).addBox(1, 0, 1, 14, 10, 14)`. There is
no JSON for a chest's lid anywhere in any version of the jar. Five classes identified by shape,
`LayerDefinitions` and `ModelLayers` found TOGETHER by the pair nothing else in the jar forms.
✅ The **40 entity textures** ride in the GUI payload (+78 KB deflated), their colour list read from
the dye table rather than typed; the **boxes, the 67 `builtin/entity` gui transforms and the 16
`DyeColor.textureDiffuseColors`** ride in `assets/models.bin` (6 KB).
✅ `src/15h_bemodel.js` renders them — one z-buffer, winding-culled, per-family Y flip, per-item
rotation out of the jar, fitted to the slot by projecting the corners once.
✅ **`tools/bemodelcheck.mjs` — 740 assertions, 6 breaks.** The roster is closed against the JAR's
own `builtin/entity` parent chains (60 items: 53 drawn, 7 named owed), the UV layout against the
PLAYER SKIN's documented coordinates, and all 310 boxes against the golden table.
✅ **`tools/g11bcheck.mjs` §9** — the icons drawn: 53 of 60 covered, the six families six different
pictures, a shulker box solid rather than hollow (the inside-out failure), red and blue banners the
same SHAPE and different COLOUR (one texture, sixteen tints) and red and blue beds different
colours (sixteen textures).
⚠ **A DECLARED DEVIATION.** Vanilla positions each of these by its renderer's own `translate` and
then applies the item's gui translation and scale. MC-Lite reproduces the ROTATION exactly —
that is what decides which faces you see — and then CENTRES the model on its projected extent
instead of reproducing five renderers' preambles. Nothing is ever cropped, which is the failure a
slightly-wrong translate would produce.
✅ **FIVE OF THE SEVEN CLOSED, session 10 (D-324): 58 of 60 drawn.** ⚠⚠ **The reason written here
for the gap was wrong** — the head layers are not registered in a loop over `SkullBlock.Types`;
`createRoots` holds one skull definition in a LOCAL and puts it under five names, and the boxes
were in a `createMesh()` the walk skipped because of its RETURN TYPE. Teaching the walk a two-slot
local memory and one hop of delegation took it from **82 layers to 147** and from **310 boxes to
699** — most of what G18 will need. Each head is one 8x8x8 cube at `texOffs(0, 0)`; only the sheet
differs (64x32 mob skull, 64x64 player and zombie head), which is why vanilla has two factories.
⚠ **OWED, NAMED: two.** The dragon head — its layer is among the nine the walk still cannot
build — and the conduit, whose renderer assembles its parts without registering a layer at all.
`BE.OWED` names them and `g11bcheck` §9 fails if a blank icon is not on that list.

### ✅ G10d — The ARM, PUT THE RIGHT WAY UP — COMPLETE, session 10 (D-320)
⚠⚠ **Dan, three times: *"the hand I can see is reversed: the sleeve is where the arm should be and
vice versa."*** He was right, and the whole suite was green while it was true.
✅ **The cause was a coordinate space.** `BI.ARM`'s UV table is `PlayerModel`'s own
(`texOffs(40, 16).addBox(-3, -2, -2, 4, 12, 4)`), and Mojang writes that table in a space whose
**+Y points DOWN**. The rasteriser read it in a **+Y-UP** space, so the shoulder cap went on the
bottom of the box and the four side faces ran their texture hand-to-shoulder. This is D-314 in a
second file: one table, two readers, different conventions, nothing asserting they agree.
✅ **The reason it survived testing was a fudge, not the bug.** `Hud.drawHand` drew the arm through
a hand-picked `ctx.rotate(-0.55)` — and given a free rotation in the drawing layer, almost any
orientation can be talked into the corner of the screen. `iconcheck` §1 had pinned the hand's
ROTATION CONSTANTS against `block/block.json` and passed for months; nothing had ever asked which
end of the arm was the hand.
✅ **`BI.armPose` / `BI.armSprite`** — `ItemInHandRenderer.renderPlayerArm` ported whole from the
1.18.2 jar (class `eqo`), axis constants identified by their VALUES in `k`'s static block rather
than by name (D-263): `rotY(45) · rotY(f6·70) · rotZ(f5·−20) · rotZ(120) · rotX(200) · rotY(−135)`,
with all four translations. **`rotX(200)` is the turn-over** that stands in for the entity
renderer's `scale(-1, -1, 1)`, which the hand path does not apply.
✅ **Vanilla's projection, not an orthographic sprite.** In 3D the right arm points up, away and
slightly RIGHT; on screen it leans up and LEFT, because it sits right of centre and recedes. The
first repair got the arm the right way up and still leaned it the wrong way. `armSprite` now runs
the full chain through vanilla's own perspective (the base FOV, `getFov(camera, partial, false)`)
and returns the sprite **and where it goes**; `Hud.drawHand` blits it and may not rotate, scale or
position it. The old `armCanvas(size, rotX, rotY)` is deleted, not left beside it (D-139).
✅ Perspective-correct texturing (`u/w`, `v/w`, `1/w`), shade from the ROTATED normal, and the
**sleeve** — `rightSleeve`, `texOffs(40, 32)`, inflated 0.25 — which vanilla's `renderHand` draws
and MC-Lite never had. Steve's overlay is empty, so its absence was invisible on the one skin
everybody tests with.
✅ **`tools/iconcheck.mjs` §6/§7 — 104 assertions, 5 new breaks.** The new ones are about PIXELS:
a synthetic skin with a shoulder-to-hand colour ramp is rendered through the real `armSprite`, and
the hand-ward quarter of the drawn pixels must sit ABOVE the shoulder-ward quarter, the arm must
run off the bottom edge, be in the right-hand half, lean left, have its sleeve over the bare arm,
and be wider at the near end than the far end.
⚠ The first draft of that check looked for the shoulder DECILE, found none — vanilla's shoulder is
legitimately off the bottom of the screen — and passed on a `NaN`. **A check whose subject can be
absent must assert that it is present before it compares.**
✅ **`tools/bemodelcheck.mjs` §2 rewritten — 748 assertions.** It used to regex `BI.ARM` out of the
source text, which made it a reader of one file's spelling (D-313). It now compares the two LIVE
unwraps — `BEModel.faceRects` (the chest and the bed) against `BlockIcon.boxFaces` (the arm) — and
its break swaps the arm's two caps and watches the agreement fail.

### ✅ G11b — The CREATIVE INVENTORY — COMPLETE, session 10 (D-312, D-313)
⚠ **This stage is what makes D-312 correct rather than merely destructive.** D-312 deleted the
nine pre-filled hotbar slots a new world used to start with. In creative there is then exactly one
way to obtain a block, and this is it — so the deletion and this screen belong in one commit, which
is D-139 read from the other side.
✅ **`tools/extract-creative.mjs`** — the **twelfth** bytecode-referee table (D-263). Thirteen
`CreativeModeTab` constants in twelve columns (`TAB_MATERIALS` is the same OBJECT as `TAB_MISC`,
stored into a second field), the tab of every one of the 1,101 items, and each tab's icon read out
of its own anonymous subclass. Closed against two sources it did not generate: the jar's own
`lang/en_us.json` (thirteen `itemGroup.*` keys, both directions) and `_registries.json` (1,101
items, both directions). **1,083 items placed, 18 in no tab at all.**
✅ The tab is ONE BYTE PER ITEM in `items.bin`, beside the item it describes, with the twelve-entry
tab strip in the same header — because a column number in a row means nothing without the strip
that says what column 6 is.
✅ `src/15e_creative.js` owns the geometry and the page model and **classifies nothing**;
`Hud.drawCreative` draws it on vanilla's four creative sheets (+8 KB deflated). `E` opens it when
`instabuild` is set. The picker is also the bin, which is vanilla's rule and the reason creative
has no visible trash slot.
✅ **`tools/creativecheck.mjs`** — the shipped table against the golden TSV both ways, the page
model against that, and every slot coordinate against `tab_items.png`'s own 0x8B8B8B slot
interiors. **6,397 assertions, 7 breaks.**
✅ **`tools/g11bcheck.mjs`** — the half that looks at the picture: twelve tab buttons with ink in
them and twelve DIFFERENT pictures, 45 cells with 45 different icons, a block clicked into the
hotbar through the real click path. **25 assertions, 4 breaks.**
⚠ **OWED, named**: the HOTBAR tab's nine saved toolbars (ctrl+number to load, ctrl+X+number to
save) need an options file MC-Lite does not have. The tab draws and is empty, and
`Creative.OWED` says so.
⚠ **D-313's own lesson**: the first draft of `15e_creative.js` classified all 1,100 items with
eight ordered regexes typed from memory, in a file whose header said the contents must come from
the item table and not from a list typed here. It had eleven tabs, in the wrong order, with
`hotbar` missing. **A hand-written classification is its own authority, and nothing in the engine
can disagree with it.**

### ✅ G11c — VANILLA'S OPTIONS TREE — COMPLETE, session 10 (D-315)
Dan: *"remove the old settings menu and wire it into the gui of the real game."*
✅ `src/15f_options.js` — Game Menu → Options → **Video Settings / Controls / Music & Sounds /
Language**, drawn on `widgets.png`'s three real button sprites (y=46 disabled, y=66 normal, y=86
hovered, each 200×20) and the legacy bitmap font. Sliders are the disabled sprite with a live
8-wide knob and they FOLLOW THE POINTER; Done and Escape both walk back one screen.
✅ Vanilla's layout constants, not ratios: 150×20 at `width/2 - 155`, columns 160 apart, rows 24
apart, title at y=15, Done 200 wide at `height/6 + 168`. Vanilla's options screen does not reflow
and neither does this one.
✅ MC-Lite's own controls are folded into Video Settings AFTER vanilla's, which is where OptiFine
has always put its own: preset, resolution cap, renderer, plants, mipmaps, occlusion, prepass,
adaptive distance, wireframe.
✅ **Ten sound sources, as a real gain graph** — one `GainNode` per `SoundSource` feeding the
master, not ten numbers nothing reads. Six have nothing routed into them yet and
`Sound.OWED_SOURCES` names what each waits on.
✅ **D-139: the old screen is DELETED.** `pauseRows()` and its rectangle painter are gone, and
`optionscheck` §5 reads `15_hud.js` and fails if they return.
✅ The modal background is vanilla's own GRADIENT (`0xC0101010` → `0xD0101010`), not a flat wash.
✅ **`tools/optionscheck.mjs`** — the sprites against `widgets.png`'s pixels in both directions,
the layout constants (including that the two columns are symmetric about the centre with a
10-pixel gutter), the tree, the ten sources, and the deletion. **231 assertions, 7 breaks.**
✅ **`tools/g11bcheck.mjs` §8** — the browser half: the tree walked, the hover sprite proven to
change the picture, the FOV slider dragged end to end, and the menu text proven to be the bitmap
font (2,724 pure-white pixels) rather than the browser's.
⚠ **Ten buttons vanilla has that this does not** — Advancements, Statistics, Open to LAN, Skin
Customization, Online, Chat Settings, Resource Packs, Accessibility, Key Binds, Force Unicode
Font — are drawn DISABLED rather than left out, because a player reads a menu by shape. Every one
is named in `Options.OWED`, both directions.

### ✅ G12b — BRIGADIER AND THE PLAYER COMMANDS — COMPLETE, session 10 (D-316)
Dan: *"when are commands coming?"*, and then, asked how: **"real parser, player commands first"**.
✅ **`tools/extract-commands.mjs`** — the **thirteenth** bytecode-referee table (D-263). All **74**
of vanilla's commands, each with the **operator level** its root requires and its **aliases**
(`/tp`→`/teleport`, `/xp`→`/experience`, `/w` and `/tell`→`/msg`), read out of `Commands`' own
registration calls and closed against that class's constructor in both directions.
✅ `src/14h_brigadier.js` — the parser: a `StringReader` with brigadier's own character class, an
error that CARRIES ITS CURSOR, literal and argument nodes, `requires`, `redirect`, the
try-every-relevant-child parse with vanilla's best-of-several-partials ordering, `execute` with
vanilla's one-exception rule, and tab completion that returns the cursor of the WORD.
✅ `src/15g_commands.js` — Minecraft's argument types (`game_mode`, `entity` selectors with
`@p @a @r @s @e` and `[type=,limit=,distance=]`, `item_stack`, `entity_summon`, `time` with its
`d`/`s`/`t` units, `vec3`/`block_pos` with `~` and `^`) and the nine commands: **/gamemode /give
/time /weather /teleport (/tp) /kill /seed /help /summon**.
✅ **EVERY WORD THE PLAYER SEES IS A LANG KEY.** Brigadier is not in the jar, so there was no
bytecode referee for its text — but Mojang translate those messages, so `parsing.int.expected`,
`command.unknown.argument` and `command.context.here` are all in the `en_us.json` this game
already ships. `commandcheck` §5 tokenises both modules and fails on any hard-coded English.
✅ Chat runs a leading `/` as a command rather than saying it, prints failures in red with
`<--[HERE]` underneath, and Tab completes.
✅ **`tools/commandcheck.mjs`** — **144 assertions, 8 breaks**: the roster and the levels against
the golden table, the reader and the dispatcher against brigadier's rules, and each command
asserted by the STATE it changed rather than by returning ok.
⚠ **OWED, NAMED AND COUNTED: the other 65 commands.** `commandcheck` lists them against the
golden table every run, so the gap is a list rather than a feeling.

### ✅ G12c — THIRTEEN MORE COMMANDS, AND THE GAME RULES — COMPLETE, session 10 (D-319)
✅ **`tools/extract-gamerules.mjs`** — the **fifteenth** bytecode table: all **35** game rules with
their TYPE and their DEFAULT, out of `GameRules.<clinit>`. ⚠ The TYPE is the descriptor of the
factory the default is passed to, not the constant: `randomTickSpeed` defaults to 3 and
`doFireTick` to 1, and reading the value to decide the type calls one of them a boolean.
⚠ And the factory has **two overloads** — `create(boolean)` and `create(boolean, BiConsumer)` —
so demanding the short one read 33 of the 35 and called that the roster.
✅ **`minecraft:block_state`** — a block id with `[property=value,…]`, resolved through the
registry's own `Reg.PROP` / `Reg.PVAL` and `States.withProp`. ⚠ It distinguishes vanilla's TWO
errors: `property.unknown` is "this block has no such property" and `.invalid` is "that property
does not take that value" — `facing` is a real property name, so checking only the global table
said `stone[facing=east]` had a bad value.
✅ **/setblock** (replace · destroy · keep), **/fill** (+ hollow · outline, capped at vanilla's
32,768), **/clear**, **/experience** (+ **/xp**, points and levels, which are not the same
number), **/defaultgamemode**, **/say**, **/me**, **/msg** (+ **/tell**, **/w** — three different
lang formats), **/playsound**, **/stopsound**, **/spawnpoint** and **/setworldspawn** (two
different fields), **/gamerule**.
✅ `Sound.stopAll` ducks a category's gain node, which is what vanilla's `stopSound` is.
✅ **`tools/commandcheck.mjs` — 277 assertions, 11 breaks**, every command asserted by the STATE
it changed: the block written, the 27 blocks a 3×3×3 fill wrote, the middle of a hollow fill being
air, thirty LEVELS being over a thousand points, and the day/night clock really stopping.
⚠ **22 of vanilla's 74 implemented; 52 owed and named on every run.**

### ✅ G12d — SIX MORE COMMANDS, AND `/execute` — COMPLETE, session 10 (D-325, D-326, D-327)
✅ **/clone** (replace · masked · filtered × normal · force · move), **/locatebiome**, **/list**,
**/tellraw**, **/title** (+ **/subtitle**, **/actionbar**, **times**, **clear**, **reset**) and
**/execute**. ⚠ **29 of vanilla's 74 implemented; 45 owed and named on every run.**

✅ **`/locate` (D-355, session 12).** ⚠ **It is not `/locatebiome` with a different predicate.** A
biome is a field to be sampled; a structure's placement is a GRID, so vanilla walks rings of
REGIONS and tests each region's one candidate chunk. ⚠⚠ **And the PRIMITIVE mattered more than the
loop**: the first draft asked `startsNear` — "what touches this chunk", all seventeen sets, which
builds a 16x16-region block of the start cache per call — and since consecutive candidates land in
different blocks, **seven calls did not finish in two minutes**. `startsOfRegion` is the one region
of the one set, and the same seven take 16-700 ms. ⚠ The STRONGHOLD branches to its ring positions
rather than searching, and `commandcheck` makes `startsOfRegion` THROW in that test so a
fall-through explodes rather than merely failing. ⚠ Vanilla's first-hit-on-a-ring quirk is
reproduced, not improved. ⚠ `structcheck` §10b holds the half a stub cannot: with the real
generator, `startsOfRegion` and `startsNear` must agree about every start's own chunk.

✅ **`Brigadier.redirect(target, modifier)` and `D.runChain`** — the machinery `/execute` needs and
nothing before it did. Each clause is a node that redirects back to `execute` carrying a modifier
from "the context parsed here" to "the source the rest of the line runs against", and the chain is
walked at EXECUTE time, not parse time. Applying a modifier while parsing would fix the source
before the selector had anything to select, and `as @e` would mean "the first one" for ever.
Supported: `as`, `at`, `positioned` (+ `positioned as`), `rotated` (+ `rotated as`), `align`,
`anchored`, `if`/`unless` with `block`, `blocks` and `entity`, and `run`. `C.EXECUTE_OWED` names
the six that are not — `store`, `facing`, `in`, and `if score|predicate|data` — each waiting on a
system that does not exist.

⚠⚠ **A CHAIN, NOT A MERGE.** The redirect used to fold the parent's arguments into the child's one
namespace, which is fine until a line uses the same argument NAME twice —
`/execute positioned 1 2 3 positioned 4 5 6 run …` is legal and common, and its two `pos`
arguments collapsed into one. Vanilla keeps a `CommandContext` per redirect level; so does this.

⚠⚠ **AND THE INSTRUCTIVE ONE: `parseNodes` RETURNS THE DEEPEST CONTEXT, NOT THE ONE IT JUST
MADE.** Writing `sub.context.parent = ctx` as the recursion unwound set the *same field* at every
level and the last write won, so a four-level `/execute positioned … positioned … run …` collapsed
to **two levels** and silently dropped every clause but the first. It parsed, it ran, it reported
success, and it ignored most of what you typed. The fix walks to the top of what came back and
links there. **A field that every level of a recursion writes is a field only the last level
owns.**

⚠⚠ **VANILLA'S ROTATION ARGUMENT IS DEGREES AND THIS ENGINE STORES RADIANS.** `Player.yaw` goes
straight into `Math.cos`, so `rotated 90 0` was fourteen and a bit turns and landed the block
somewhere that merely looks random — **a check asserting only "somewhere different" would have
accepted it**, so `commandcheck` asserts the landing cell is on an AXIS. The two conventions agree
otherwise: yaw 0 is +Z and pitch −90 is up, in both.

⚠ **`@s` IS THE SOURCE'S ENTITY, NOT THE PLAYER**, and `^` uses the SOURCE's rotation and anchor.
Before `/execute` the two were always the same; afterwards, reading the player directly makes
`execute as … run … @s` and `execute rotated … run … ^ ^ ^1` silent no-ops that look like the
clause was ignored. ⚠ **A fork returns the COUNT of sources; one source returns the command's own
result** — `/execute as @e run …` over three entities returns 3, `/execute run seed` still reports
the seed, and a selector that matches nothing runs nothing and is **not an error**.

⚠⚠ **IMPLEMENTING IT EXPOSED A WRONG ROW IN THE REFEREE.** `extract-commands` decided an alias was
"a literal other than the first, followed by a redirect" — true of `/teleport`'s `tp` and **also
true of every clause of `/execute`, which redirects to its own node**. The golden table listed
`run`, `positioned`, `rotated`, `entity`, `align`, `anchored`, `in`, `score`, `value` and `max` as
ALIASES of `/execute`, and nothing noticed for two sessions **because nothing had implemented
`/execute`**. The rule is now vanilla's actual shape: an alias registration is **tiny** — a second
`dispatcher.register` whose builder holds one literal and a redirect. That removed ten false
aliases **and found a real one nobody had**: `teammsg → tm`. **A referee table is only checked
where something reads it.**

⚠⚠ **A CLONE READS EVERY SOURCE BLOCK BEFORE IT WRITES ANY, AND THAT IS NOT AN OPTIMISATION.**
With `force` the boxes may overlap, and a loop that writes as it reads copies its own output —
shift a column up by one and the bottom block smears the whole way. `move` clears the source
**after** the copy and only where the destination did not land on it. `commandcheck` has a smear
test: a column with a hole in it, moved up one with `force`, and the hole has to move with it.

⚠ **`findBiomeHorizontal` IS A RING WALK IN QUART COORDINATES, NOT A FILLED SQUARE.** Biomes are
constant inside each 4×4×4 cell, so vanilla searches the quart grid and samples only the BOUNDARY
of each ring, everything inside having been covered by a smaller one.

⚠⚠ **THE RULING (D-325): WHAT A COMMAND MAY COST ON THE THREAD THAT DRAWS.** Vanilla's radius
(6,400) and step (8) are kept exactly; running them to exhaustion is not. `Climate.biomeAt` costs
**58 µs** and a miss walks all **160,801** cells, so asking for a biome that is not nearby would
lock the tab for **9.3 seconds** — vanilla pays that on a server thread, this game would pay it on
the one that draws the frame. The search gives up after **half a second** and reports
`commands.locatebiome.notFound`, whose own wording — *"within reasonable distance"* — is already
the honest answer. ⚠ It is a REAL deviation and it is **not silent**: on a slow machine a findable
biome can come back as not-found. Quietly shrinking the radius fails the same way and lies about
why. `C.LOCATE_MS = 0` disables the budget; `commandcheck` turns it off to test the search, then
sets it to 20 ms with a deliberately slow lookup to prove the budget bites. ⚠ **And the clock is
read once every 256 samples** — `Date.now()` costs more than a fifth of a biome lookup, and a
budget that spends a quarter of itself on measuring is not a budget.

✅ **`Text.fromJson` — a real JSON component parser**, which any command, sign or book will need.
⚠⚠ **AN ARRAY IS NOT A LIST OF SIBLINGS: ITS FIRST ELEMENT IS THE PARENT.** Vanilla folds
`["a","b","c"]` into `"a"` with `b` and `c` as its `extra`, so the FIRST element's style is
inherited by all the rest. A bare container instead gives a line whose first word is coloured and
whose remainder mysteriously is not — close enough to right that nobody files it. `commandcheck`
asserts the inheritance, not just the concatenation. ⚠ Vanilla puts style keys at the TOP level of
a node (`{"text":"hi","color":"red"}`) while this engine keeps them under `.style`, so `fromJson`
lifts them; `false` is kept and is **not** the same as absent. ⚠ `T.JSON_OWED` names the six kinds
this engine cannot do — `score`, `nbt`, `selector`, `keybind` and the two events — and `/tellraw`
raises `argument.component.invalid` **with the reason in it**, because a `/tellraw` that silently
prints nothing is indistinguishable from a broken command.

✅ **The title overlay** — `H.titles`, `H.tickTitles`, `H.drawTitles`, vanilla's 10/70/20 default
times and the 60/20 action bar. ⚠⚠ **A SUBTITLE ALONE SHOWS NOTHING, AND THAT IS VANILLA**:
`Gui.render` opens with `if (this.title != null && this.titleTime > 0)` and draws the subtitle
INSIDE that. It is the commonest confusion about the command and reproducing it is the point.
⚠⚠ **THE FADE RAMP'S TWO TESTS MUST NOT BE `else if`.** `time` counts DOWN, fading in while
`time > fadeOut + stay` and out while `time <= fadeOut` — and with `stay` at **zero both are true
at once**, where only the fade-out answer is right. As an if/else-if a title snaps off instead of
fading the moment somebody sets `stay 0`. `H.titleAlpha` is a pure function for exactly that
reason and `commandcheck` walks it tick by tick, including the `stay 0` case. ⚠ **The clock ticks
at 20 Hz, not on the frame** — a fade driven by the frame rate runs at a different speed on every
machine, which is why vanilla counts these in ticks; `H.tickTitles` rides with `Chat.tickChat`.

⚠ **THE TWO LANG KEYS ARE PASSED WHOLE, NOT BUILT BY CONCATENATION.** `commandcheck` §6 scans
these files for the translation keys they use and asserts every one is in the shipped table; a key
assembled at runtime is invisible to that scan — and `commands.title.times`, the base it would
have seen, is not a real key at all. **A string the check cannot see is a string nobody notices is
missing until it renders as its own key on screen.**

⚠ **`readUnquoted` STOPS AT `:` — FOR THE SECOND TIME** (D-316 was the first). `M.oneOf` read
`minecraft:plains` as `minecraft` and rejected every namespaced value. An id is not a word, and
the parser has two readers for that reason.

⚠ **`/difficulty` was in this batch and Dan pulled it**: *"dont worry about /difficulty until all
its wirings are implemented fully."* Storing a difficulty that changed nothing would have been the
command as theatre.

✅ **`tools/commandcheck.mjs` — 415 assertions**, every command asserted by the STATE it changed.

#### The original plan for this stage
### ☐ G11 — GUI and HUD
**Pre:** G8. Hotbar, health, hunger, armour, XP bar, effect icons, the crosshair, the
debug (F3) screen, chat, the pause menu, all the container screens. Fonts from
`textures/font/ascii.png`; widgets from the 63 GUI textures.
D-23: **copy from MineHTML for GUI, damage, hunger and inventory — read-only**, and adapt to
MC-Lite's architecture rather than importing MineHTML's assumptions. A MineHTML session may
be running: `C:\claudeisthegoat` is **never written to**.

### ✅ G12 — Text, components and messages — COMPLETE, session 9 (D-282, D-283)
✅ `tools/pack-lang.mjs` packs **vanilla's whole `en_us.json`**, not a hand-picked subset, and
asserts a display name exists for every block and item in the two registries. The 18 keys whose
name cannot be derived from the registry id — the 16 wall banners and the 2 item frames — are an
**explicit override table, and the tool asserts the override set is exactly those 18** (D-282), so
a nineteenth exception cannot be quietly absorbed.
✅ `src/02i_text.js` — the table, the formatter and text components. ⚠ **`T.format` keeps ONE
sequential counter and `%N$s` does NOT advance it**; getting that wrong shifts every later argument
in any string that mixes the two forms, which vanilla's death messages do.
✅ `src/15c_chat.js` — the chat pipeline with vanilla's own fade curve
(`d = 1 − ticksAgo/200; d *= 10; clamp; return d*d`), word wrapping over **runs** rather than plain
text so a colour cannot be lost at a line break, and re-wrap driven from the **scrollback** rather
than from the already-wrapped lines (D-283) — re-wrapping the output is how a resize slowly
shreds a message.
✅ **`tools/textcheck.mjs`** — 75 assertions, 8 breaks, graded against vanilla's own
`translation.test.*` strings. ⚠ **Five of this file's first assertions were wrong about vanilla**
and the source settled each one; the file says which, because a check that was silently corrected
to agree with the code is not evidence.
✅ **`tools/chatcheck.mjs`** — 78 assertions, 8 breaks, including the fade curve to the tick and
the bottom-up draw order that made a wrapped message read in reverse.

#### The original plan for this stage
### ☐ G12 — Text, components and messages
**Pre:** G11, G1. Translation keys from `lang/en_us.json`, text components, death messages,
the chat pipeline. Small, and everything above wants it.

### ✅ G13 — Sound — COMPLETE, session 9 (D-284…D-287)
✅ **`tools/extract-soundtype.mjs` — the bytecode referee's FIFTH table** (D-263, D-285). The plan
below said "hand-tabled or taken from `minecraft-data`"; neither was needed. `SoundEvents` (`ahk`,
1,203 fields) and `SoundType` (`ckg`, 76 constants, 380 reads = exactly five each) were read from
the obfuscated 1.18.2 jar, and the field ORDER `break,step,place,hit,fall` was **derived** from
cases that cannot be in doubt — **66 blocks agree, 0 disagree**. The result is
`tools/golden/block-soundtype-1.18.2.tsv`: **898 blocks, 75 distinct types**, 280 of them on the
default.
✅ **`tools/pack-sounds.mjs`** — the subset rules, then ffmpeg to **32 kbps mono Opus**, cached by
source hash. **1,214 files, 22.20 MB Vorbis → 4.16 MB Opus (5.34×)**. The alternative (fewer
sounds at original quality) was measured and rejected: this way the whole non-mob set fits.
⚠ **D-284 — the payload is a deflated header and a RAW body.** Opus is incompressible;
deflating the whole thing bought 9.89%, *all of it from the JSON*, and cost a decompression pass
over four megabytes. The format is `[u32 zlen][u32 hlen][deflated header][raw Ogg clips]`.
✅ `src/02j_sounds.js` — the weighted roll (vanilla's `nextInt(totalWeight)`, **not** uniform),
lazy per-clip decode, linear attenuation to 16 blocks, and the five block hooks at
`BREAK_VOLUME 0.8` / `STEP_VOLUME 0.15` / `PITCH_JITTER 0.1`. Footsteps are driven by **distance
travelled**, re-based on actual distance, so a sprint steps oftener with no second timer.
✅ **`tools/soundcheck.mjs`** — **70 assertions, 11 breaks.** The tables are asserted exactly
against the golden TSV; the 18-event FLOOR of first-minute sounds must be voiced.
⚠ **D-287 — the silent events are vanilla's, and that is now PROVEN rather than assumed.** The
pack reports five silent events (`block.fungus.fall/hit`, `block.roots.fall/hit/step`). All five
carry `"sounds": []` in vanilla's own `sounds.json`, three of them **with a subtitle Mojang wrote
for a sound never shipped**. Eleven events are empty in 1.18.2; six are mobs or music and the
selection excludes them, leaving exactly five.
`tools/golden/silent-events-1.18.2.tsv` records all eleven and soundcheck asserts the set **in
both directions** — a clip that fails to cross turns it red, a sound Mojang never recorded does
not. The transport's provisional "at least 150 clips" floor is **deleted**, not left beside the
real assertion (D-139).
✅ **`tools/g13check.mjs`** — the real browser. **1,214 of 1,214 clips decode** through
`OfflineAudioContext` (so no gesture is needed), **1,149.5 s of audio**, shortest 0.044 s, longest
13.32 s. 25 assertions, 3 breaks. ⚠ Headless Chromium keeps the `AudioContext` **suspended**, and
the engine reports that honestly rather than counting a play — which is itself asserted.
**Acceptance — met.** The sound payload is **4.19 MB raw → 5.58 MB base64**; `dist/mclite.html` is
**9.66 MB against D-12's 15 MB, 62.9% used**, with base64's +33% already applied.

#### The original plan for this stage
### ☐ G13 — Sound
**Pre:** G2. `sounds.json` maps events to files with weights, pitch and volume ranges.
⚠ **The `.ogg` files are NOT in the jar** — they live in the launcher's content-addressed
`assets/objects/` store, indexed by `assets/indexes/1.18.json`. So this stage begins with an
index read on Dan's machine, then a subset selection (block steps, breaks, places, UI,
ambience), then base64. Per-block `SoundType` is compiled Java (G13): ≈25 sound types across 880
blocks, hand-tabled or taken from `minecraft-data`'s `sounds.json`.
**Acceptance:** `sounds-report.md` states the real subset byte count and the total against
D-12's 15 MB ceiling, **with base64's +33% already applied**.

### ✅ G14 — Persistence — COMPLETE, session 9 (D-286…D-291)
⚠⚠ **THE STAGE'S REAL FINDING WAS THAT THE SAVE WAS THREE STAGES BEHIND THE GAME** (D-288).
The acceptance test below was already passing before this session began — the format IS
name-keyed and DOES survive a shuffled registry. What nothing asked was whether the format
CONTAINED THE GAME. `Player.toJSON` wrote nine BLOCK STATES, which is what a hotbar was in
session 2; G8 gave the player 41 slots of item stacks and G5 gave them health, food and
experience, and none of it was ever written. Measured, not argued:
```
 slot 0  diamond_pickaxe  count 1  damage 137  ->  saved as state 0, which is AIR
 slot 1  cobblestone      count 64             ->  saved as a state; the 64 is gone
 slots 9..40  27 main + 4 armour + the offhand ->  no field existed at all
```
`savecheck` was green across every bit of it, with 51 assertions and 3 breaks. That is D-276 a
third time: *a check that passes proves only what it touches.*

✅ **v4** writes the inventory (by item NAME — `NS.Items` is generated from the jar exactly like
`NS.Reg`) and the survival state (every number **clamped on the way in**; ⚠ NaN is the one that
does not announce itself, failing every comparison so the player silently stops healing for ever).
✅ **A v3 save is MIGRATED, a v2 save is still REFUSED** — v2 stored numbers into a vanished
table, v3 stores names, and a name still means what it meant. Each v3 entry becomes ONE of that
block's item; a block with no item becomes an empty slot rather than a guess.
⚠ **D-286** — the transport's provisional floor is DELETED, not demoted.
⚠⚠ **D-288b — TWO VERSIONS, BECAUSE THERE ARE TWO FORMATS.** Bumping `S.VERSION` for the
inventory would have made `decode` reject every existing BLOCK-EDIT BLOB, whose header carried the
same constant: every block every player had ever placed, gone, to record a field about items.
`DATA_VERSION` (3, untouched since session 2) and `VERSION` (4) are now separate and `savecheck`
asserts they are DIFFERENT.
✅ **`savecheck`: 172 assertions, 15 breaks** (was 51 / 3), shuffling BOTH registries.
✅ **`g14check`: 44 assertions, 10 breaks** — a real browser, a real `Page.reload`, the title
screen's own Continue. Every slot back with its count and damage, survival to the decimal, and the
block broken before the reload still broken.
**Acceptance — met, and then some.** The shuffled-registry test passes for blocks AND items.

#### What the stage turned up on the way, none of it about saving
⚠⚠ **D-289 — NO FURNACE HAS EVER SMELTED ANYTHING.** G2 left `BE.smeltResult`/`BE.fuelValue` as
hooks for "a later stage"; G9 shipped 1,058 recipes and the compiled-Java fuel map, and **neither
hook was ever assigned anywhere in the engine.** `behavcheck` was green — honestly so — against
its own two-item stub. The blocker underneath was a stack-shape mismatch (`{item,count}` from G2
against `Inv.stack` from G8), because `cookingFor` takes a stack and returns one. Hooks deleted,
one stack type, `behavcheck` on the real tables. ⚠ Still not reachable by a player: nothing puts
an item in a furnace until G11's container screens land.
⚠⚠ **D-290 — THREE DEAD READS.** `P.eyesInWater` against physics's `eyeInWater`, and `P.armour`
against survival's `armor`. No error, no warning: `!!undefined` is `false` and `undefined | 0` is
`0`. **The underwater mining penalty never applied and the armour and air rows were never drawn.**
`dupcheck` §5 now asks whether every property read on the player is one something writes.
⚠⚠ **D-291 — ARMOUR, THE SIXTH REFEREE TABLE.** `Sv.afterArmor` carried vanilla's own damage
formula for four stages and never once had a non-zero input. `ArmorMaterials` picked BY USE —
`Items.<clinit>` reads it 25 times, 6×4+1, which is the armour roster itself — and it corrected
two of my assumptions while being written (TURTLE is `{2,5,6,2}`, and the int after the array is
the enchantment value, not the durability multiplier). `survcheck` §5b wears all 25 pieces.

#### The original plan for this stage
### ☐ G14 — Persistence
**Pre:** G8, W10. Name-keyed saves, not index-keyed — so a registry regeneration cannot
silently reinterpret an old world. Save format versioned from day one.
**Acceptance:** save, regenerate the registry with a deliberately shuffled id order, load,
and assert the world is unchanged. This test is the entire reason for the design.

### ✅ G15 — Redstone — SPLIT INTO FOUR, **ALL FOUR COMPLETE**, session 9 (D-294, D-297 … D-299)
⚠ **THE SPLIT IS A RULING, NOT A PARTIAL.** The acceptance below wants a piston door, and
pistons are block-moving, a `moving_piston` block entity, push limits and sticky retraction — a
stage on their own. So:
- **✅ G15a — THE SIGNAL.** Sources (redstone block, lever, button, pressure plate, torch), wire
  propagation, strong vs weak power, what conducts, and the neighbour-update path. **Complete.**
- **✅ G15b — THE DIODES.** Repeaters (delay, lock, diode, booster, pulse extender), comparators
  (compare, subtract, side input, container reading through a solid block), the analog-output
  table, and vanilla's tick PRIORITY classes. **Complete.**
- **✅ G15c — THE PISTONS.** `PushReaction` (the ninth golden table), `isPushable`'s four extra
  refusals, the full `PistonStructureResolver` (twelve-BLOCK limit, the backward walk, slime/honey,
  the collision re-order), quasi-connectivity, the two-tick `PistonMovingBlockEntity`, sticky
  retraction and a working 2×2 piston door. **Complete.**
- **✅ G15d — THE OBSERVER**, and the SOURCE set closed: the other eight sources are named in
  `Rs.OWED_SOURCES` with the stage each waits for (G8, G11, G16, G17, G18), and `redcheck` asserts
  that every row of the golden table is either live or on that list. **Complete.**

✅ Every rule is out of the **bytecode**: redstone is pure code in vanilla, in no JSON file and no
tag. Classes located BY USE — `Blocks.<clinit>` puts the block's name literal immediately before
its `new <class>`.
⚠ **`max(blockSignal, wireMax − 1)`** — the decay is on the WIRE term only, so a source beside a
wire gives it **15, not 14**. ⚠ A wire **switches its own signal off** while it recomputes, or it
reads its own power back through the block beside it and latches at 15. ⚠ The vertical rules are
**asymmetric**: climb only if the cell above the LOWER wire is open; step down only past a
NON-conductor.
✅ **`isRedstoneConductor`** = a full collision cube minus seven exceptions, and the seven are
identified by USE — only one of three `StatePredicate` setters names `redstone_block` and
`observer`, neither of which can belong to the suffocation or view-blocking predicate.
✅ **`tools/redcheck.mjs` — 80 assertions, 5 breaks**, asserted as CIRCUITS: a run that decays
15→0, a lever through a block, a staircase up and down, a roofed staircase that must NOT climb,
a NOT gate, a **NOR truth table**, a T junction, two sources that give 15 rather than 16, a torch
that does not power the block it stands on, and a torch tower.
⚠⚠ **THREE BUGS, ALL FOUND BY BUILDING A CIRCUIT AND NONE VISIBLE TO A RULE TEST** (D-294): an
inverted direction convention that the wire run could not see because a redstone block answers
the same in every direction; `propName(…) === true` against a property that reads back as the
STRING `'true'`, which silenced every lever and torch; and a consumer sweep bounded by a radius
rather than by what actually changed. Plus one in the check's own fixture, which replaced the
source with stone.
✅ **Torch burnout is IN** (D-354, session 12). The 60-tick window and the 8 toggles were already
measured; what was missing was the per-position history. ⚠ **The two edges are not symmetrical**:
vanilla LOGS a toggle when the torch goes out and COUNTS without logging when it wants to come
back — logging on both would burn a torch out in half the time. The list is per LEVEL, the count
is per POSITION, and it is trimmed by TIME. **G15b's clock now burns out where it used to run for
ever**, and `redcheck` §5b asserts the burnout, the recovery, and that other positions' toggles do
not spend this one's budget.

#### G15b — the diodes (session 9, D-295 … D-297)
✅ **Two more golden tables, from one scan** (`tools/extract-analog.mjs`, D-263's method, seventh
and eighth time): **38 signal sources** and **61 analog blocks**, every class found by keeping the
overrides of `isSignalSource` / `hasAnalogOutputSignal` across all 6,352 classes and named through
`Blocks.<clinit>`. ⚠ Which obfuscated method is which is anchored on a LEVER (a source, not
readable) and a CHEST (readable, not a source) — both directions, four assertions.
✅ **The repeater**: FACING points at the INPUT (pinned by `getInputSignal` and
`updateNeighborsInFront` from opposite ends), `DELAY * 2` game ticks, a diode, a booster, the
pulse extender, and the LOCK — which ⚠ only another DIODE can apply, never dust or a lever.
✅ **The comparator**: compare vs subtract (they differ at EQUAL strengths, which is the whole
point of the mode), the side input, the analog override that REPLACES the redstone reading, the
one-block gap, and the container formula `floor(f * 14) + (i > 0 ? 1 : 0)` with `f` divided by the
SLOT COUNT. Its 0..15 lives in a `ComparatorBlockEntity`, where vanilla puts it.
✅ **`redcheck` is now 291 assertions and 13 breaks.** New named circuits: a **repeater clock**
with the half-period measured (a loop that bypasses the repeater still oscillates — at the torch's
two ticks), an **RS NOR latch** driven from a known state and asserted to HOLD, a **1+2+3+4 delay
line** that arrives on game tick 20, the **subtract truth table** 36/36, a comparator reading a
**chest through a solid block**, and the repeater **lock** as a latch.
⚠⚠ **THREE MORE G15a BUGS, ALL IN THE HALF A STRAIGHT RUN CANNOT SEE** (D-296): the wire asked
the connection on the wrong side (`direction` rather than `direction.getOpposite()`); the
axis-COMPLETION rule was missing, and G15a was masking it by claiming a redstone LAMP was a valid
wire connection; and **every wall torch was oscillating**, because it used the standing torch's
`dir != UP` and therefore powered its own support and read that back as its input. ⚠ G15a's NOT
gate and NOR table passed anyway — the torch happened to be lit on the tick they read it.
⚠ **And the check's own fixture**: it wrote twenty cells into the array and poked one, so the far
end of a circuit was never looked at. Placements now notify from every cell, as `Behave.changed`
does in play.
#### G15c — the pistons (session 9, D-298)
✅ **The ninth golden table** (`tools/extract-push.mjs`): every block's `PushReaction`, from the
material's builder chain PLUS the fourteen block-level overrides — ⚠ a table built from materials
alone is wrong for about sixty blocks, every door and every glazed terracotta among them. Packed
one byte per block into `block-runtime.bin`.
✅ **`isPushable` carries four rules the table does not**: obsidian/crying obsidian/respawn anchor
BY NAME, destroy speed −1 (bedrock, barrier, portals), an already-EXTENDED piston, and ⚠ **anything
with a block entity** — which is why a chest and a stone with the same NORMAL reaction give
opposite answers. ⚠ And AIR is pushable, which is how a push line ENDS rather than fails.
✅ **The resolver, faithfully**: ⚠ twelve **BLOCKS** not twelve cells (a slime blob spends the same
budget as a column), the **backward walk** that drags what is stuck behind a slime block, ⚠ slime
and honey NOT sticking to each other, and `reorderListAtCollision` — the order decides which cell
is written first, and the wrong order overwrites a block that has not moved.
✅ ⚠⚠ **QUASI-CONNECTIVITY, DELIBERATELY**: the piston asks all six sides of the cell one block
above it. Every BUD switch in the game is built on it. ⚠ And the edge is not where it looks — a
strongly-powered block TWO above still reaches it; three above does not.
✅ **Two ticks, not one**: `progress += 0.5F` per tick, so the cells change in the firing tick and
the block LANDS two ticks later.
✅ **`tools/pistoncheck.mjs` — 84 assertions, 7 breaks**, asserted as contraptions: a one-block
push measured tick by tick, the twelve/thirteen threshold MEASURED rather than asserted, a torch
destroyed and an obsidian block refusing, quasi-connectivity at one/two/three blocks up, sticky
retraction against a plain piston, a slime block dragging a perpendicular neighbour, honey refusing
to stick to slime, and **a 2×2 piston door cycled five times**.
⚠ **Named gaps**: the moving block is not DRAWN part-way between cells (renderer, and rendering may
be cheap); entities riding a piston are G17's.

#### G15d — the observer, and closing the source set (session 9, D-299)
✅ **The observer is a ONE-SHOT**: it fires only when the block it FACES changes, only when it is
not already powered, and its output is a fixed **two-tick pulse** however long the change lasts.
⚠ The `!powered` guard is the whole block — without it a stream of changes re-arms the pulse and
it becomes a level detector. Its `FACING` is the eye; the output comes out of the BACK.
✅ **The source set is closed.** `redcheck` §8 drives every row of `signal-sources-1.18.2.tsv` to
its powered form and asks whether it emits anything at all.
⚠⚠ **AND THAT FOUND BOTH WEIGHTED PRESSURE PLATES SILENT** — they carry `power` (0..15), not
`powered`, so the generic boolean branch read a property they do not have and emitted nothing.
**The third member of D-290's family**, after `!!undefined` and `propName(…) === true`.
⚠ A pressure plate's STRONG power is now explicit (`dir == UP` only) rather than reached through
`attachedDir`'s default, and all six directions are asserted.
✅ **`redcheck` is 329 assertions and 14 breaks** across G15a, G15b and G15d.

⚠ **Still owed:** vanilla's intra-tick ORDERING quirks beyond the priority classes, the item frame
a comparator reads off the block in front of a container, and the five analog blocks on the named
OWED list (three command blocks, jukebox, lectern, sculk sensor, detector rail) — each needs
entity or item state from a stage that has not run.

#### The original plan for this stage
### ☐ G15 — Redstone
**Pre:** G2. Wire power propagation, repeaters, comparators, pistons, observers, the update
order. It is the single fiddliest parity item in the game and it is deliberately placed
after the loop is stable and before mobs.
**Acceptance:** ≥20 known circuits (clock, T-flip-flop, piston door, comparator subtract)
asserted tick-by-tick.

### ✅ G16 — The sky, celestial bodies and fog — SPLIT IN TWO; **BOTH HALVES COMPLETE**, session 9 (D-300, D-303, D-304)
⚠ **THE SPLIT IS A RULING, NOT A PARTIAL.** The CHARTER lets rendering be cheap and demands
everything else be exact, and the sky is the first stage that is both. Its NUMBERS are parity and
its PICTURE is not, so:
- **✅ G16a — THE SKY'S NUMBERS.** The day/night cycle, the sun's angle, the moon's phase, sky
  colour by biome and time, fog colour by biome and render distance, the star FIELD, the weather
  cycle, and all of it wired into every frame and into the save. **Complete.**
- **✅ G16b — THE SKY'S PICTURE.** The celestial BODIES: the sun, the moon's eight frames, the
  ~785 star quads and the two discs, as a real draw pass in WebGL2. **Complete for WebGL2**;
  WebGPU's sky bodies are declared OWED below. **Session 9.**

✅ **Every rule out of the bytecode** (`09b_sky.js`), classes found BY USE: `DimensionType` is the
one whose `(long)->float` divides by 24000 and takes a cosine; `ClientLevel` is the only class in
the jar that uses the luma constant `0.59f`.
⚠⚠ **NOON IS `timeOfDay` ZERO, NOT 0.25** — it is the sun's ANGLE, and the `- 0.25` is what puts
the sun overhead at dayTime 6000. The check's first four anchors were all wrong.
⚠⚠ **THE WEATHER LEVELS MOVE BY `0.01` A TICK, NOT `1/12000`** — a storm arrives in five seconds,
not ten minutes — and all four timer ranges are INCLUSIVE `(min, max)` pairs.
⚠ **The fog's blue channel is not the other two** (`0.91/0.09` against `0.94/0.06`), and rain
scales red and green by 0.5 but blue by only 0.4. Neither is guessable.
⚠ **The star field reproduces the REJECTED candidates**: 1,500 draws, ~785 stars, and a reject
still consumes its four `nextFloat`s — so `skycheck` asserts the yield against the unit ball's
fraction of its cube and asserts two engines build a bit-identical array.
✅ **`tools/skycheck.mjs` — 115 assertions, 6 breaks**, and **the envelope is v5** (the block
bytes did not change, so `DATA_VERSION` stays 3 — D-288b).
⚠ **The sky was a hard-coded `[0.62, 0.76, 0.98]`** used as both the clear colour and the fog
colour, so the world never got dark and the fog never took a biome's tint.

#### ✅ G16b — the sky as a PICTURE, and the two bugs only a picture could show (D-303, D-304)
`src/09b_sky.js` grew the geometry (`buildSkyDisc`, `celestialMatrix`, `celestialQuad`, `moonUV`)
and `src/12_gfx_webgl2.js` a fifth program, `progSky`: disc → stars (additive) → sun → moon →
dark disc, depth writes off, straight after the clear in `beginFrame`. `tools/build-gui.mjs` packs
`environment/sun.png` and `environment/moon_phases.png` as two more GUI sheets.

⚠⚠ **`skycheck`'s 141 numbers were green while the sky pass drew neither the sun nor the moon.**
Both bugs are the shapes D-289/D-301/D-302 warned about, one scale down:
- **A value that never arrived.** `build-gui.mjs` packed the two sheets and `assets/gui.bin` held
  them — but `tools/gen-data.mjs` had not been re-run, so `src/19_data.gen.js` still carried the
  EIGHT-sheet blob. `texFromSheet` returned null for both and `initSky` skipped them in silence.
  ⚠ **`node build.mjs` alone does not rebuild the data module from a changed asset.** The suite
  runs `build-gui` → `gen-data` → `build` in that order and would have caught it; a bare rebuild
  after editing an asset generator will not. Run the pipeline, not the last stage of it.
- **Code that ran on the wrong number (D-304).** The sky pass projected with the WORLD's matrix,
  whose far plane is the fog wall — `rd * 16 * fogEnd + 16`, which is **76.8 blocks at the Celeron
  preset** — and the sun and moon sit at `CELESTIAL_DIST` = 100. On the bottom rung of the
  hardware ladder both were clipped away entirely, at every hour of every day. The sky pass now
  builds its own projection at `Sky.SKY_FAR` = 1024 via `Cam.skyViewProj`, wide enough for the
  512-radius disc too, so the horizon is sky rather than a far-plane cut.

✅ **`tools/skyviewcheck.mjs` — 24 assertions, 4 breaks**, green at the default preset and at
Dan's medium. Every assertion compares two moments of the same world: noon against midnight, the
sun against the sky beside it, the stars against the black between them, the full moon against the
new, and the sky pass on against off. The decisive break forces an 80-block sky far plane and
shows the sun vanish while the disc stays — the bug that shipped, reproduced on demand.
⚠ **It measured the CROSSHAIR and called it the sun** on its first run: `#ui` is its own canvas
stacked over the GL one and `Page.captureScreenshot` composites the two. The overlay is hidden
before anything is measured.
⚠⚠ **It passed at the Celeron preset and failed at Dan's medium** (D-196 again): at render
distance 12 the spawn's TREES are generated and meshed, and the camera was looking up through a
canopy. It now flies to y=220 first, so the same picture is under test at every preset.
⚠ **The moon's eight phases are asserted as a whole lunar month** — lit-pixel counts 1593, 993,
808, 323, **0**, 285, 785, 1080 — with vanilla's new moon at cell 4 of the 4×2 grid drawing
nothing at all. Four samples could not have told a UV grid from a fixed cell.
☐ **OWED: WebGPU's sky bodies.** `GfxGPU` still clears to the fog colour and draws no sky pass;
`skyviewcheck` asserts the backend is WebGL2 and says so. WebGPU is black on real hardware
regardless (CHARTER constraint 3).

### ⚠⚠ THE LARGEST FINDINGS OF SESSION 9 — the world never ticked, and the circuits read chunks
#### `Behave.tick()` was never called (D-301)
The main loop ran `Player.tick()` and nothing else. **No scheduled tick had ever run in any
build**: fluids never spread past their first update, fire never burnt out, no furnace ever
smelted (D-289 fixed the HOOKS and the loop they live in was never called), and G15's torches,
repeaters, observers and pistons would each have started and frozen. `Piston.init` was never
called either.
⚠⚠ **Every check was green across it**, because every check drives the tick ITSELF —
`redcheck.runTicks`, `pistoncheck.ticks`, `behavcheck`'s own loop. Each honestly proves the RULE
and not one proves the GAME runs it. **`tools/tickcheck.mjs`** now asks the SHIPPED BUNDLE whether
every `*.tick*` is reachable from the loop, and `smoke` measures `Behave.gameTime` in a real
browser — a number that was zero for ever beside a `Main.ticks` in the hundreds.

#### `NS.World.get` takes CHUNK coordinates (D-302)
`World.get(cx, cz)` returns a CHUNK; the block accessors are `getBlock`/`setBlock`. `Redstone`
and `Piston` were initialised with `NS.World` itself, so **every `w.get(x, y, z)` answered with a
chunk object or `undefined`** and no circuit in the game has ever done anything. Both modules take
`Behave.w` — the adapter that has always been right — and refuse to be `ready` without it.
⚠⚠ **`redcheck` HID IT WITH ONE LINE OF ITS OWN FIXTURE**: `M.Behave.w = w` overwrote the adapter
with the check's own object, so 330 assertions across twenty circuits exercised **an interface the
game does not have**. Both fixtures now read through the same adapter and assert that they do.
⚠ **Three instances of one failure, at three scales, all in one session:** D-289 a hook nothing
filled (the value never arrived); D-301 a function nothing called (the code never ran); D-302 an
object that meant something else at the call site (the code ran on nonsense). Every one behind
hundreds of honest green assertions, and every one needing the GAME to show it.

#### `tools/worldcheck.mjs` — the browser stage that found the second one on its first run
It boots the real page, puts water, fire, a torch, a piston and a furnace in a real world, lets
the real loop run for seconds, and looks. **32 assertions, 2 breaks.** It shows water spreading
1 → 14 cells, fire burning out on bare stone, a torch flipped by the GAME two seconds after its
input arrives, a piston holding `moving_piston` mid-flight and landing its block, and **a furnace
putting an iron ingot in its output slot — the first this project has ever produced.**
⚠ Its decisive assertion is an EXPERIMENT, not an outcome: it removes `Main.worldTick` from the
running page, shows the same water sitting still for five seconds, puts it back, and shows it
spread. The difference is one call.

### ◐ G17 — Entities: the substrate — SPLIT IN THREE (a RULING, session 9); **G17a AND G17b COMPLETE, G17c's RENDERER COMPLETE (session 10, D-321)**
**Pre:** G5. Entity registry, hitboxes, physics, collision, rendering, item entities,
falling blocks, projectiles, TNT. Everything mobs need that is not AI.

⚠ **THE SPLIT IS A RULING, NOT A PARTIAL — and it is the same ruling G15 and G16 got.** G17 as
written is four stages wearing one number: a data table, a movement core, a set of concrete
entities and a renderer. They have different referees and different acceptance tests, and one of
them is already mostly built. Declaring the split is how the next session starts in the right
place instead of half-building all four (D-294).

- **✅ G17a — THE TABLE. Complete, session 9 (D-306).** Every entity type's id, hitbox, fire
  immunity, client tracking range and update interval, read out of the 1.18.2 bytecode by
  `tools/extract-entities.mjs` into `tools/golden/entity-types-1.18.2.tsv`, packed by
  `tools/pack-entities.mjs`, read by `src/07h_entities.js`, asserted by
  **`tools/entitycheck.mjs` — 113 types, 42 assertions, 6 breaks.**
  ⚠ **The set is closed against `.mcdata/1.18.2/_registries.json`**, the game's own registry
  dump, in BOTH directions: 113 types, 0 missing, 0 extra. A count the extractor checks against
  itself proves nothing.
  ⚠⚠ **A builder method is its name AND its descriptor.** `a` is `of`, `sized`, `immuneTo` and
  `clientTrackingRange` on the same class; keying by name gave polar_bear, wither,
  wither_skeleton and snow_golem NO DIMENSIONS while the other 109 looked perfect.
  ⚠ **Zero is a size** — `marker` and `lightning_bolt` are `sized(0, 0)`, and that set is closed
  at exactly two.
  ⚠ **The box is feet-at-the-position with the footprint centred on it.** The other obvious
  reading is self-consistent, passes every rule test, and buries every mob to the waist.
  ✅ **AND IT CARRIES THE IMPLEMENTATION CLASS FOR 112 OF THE 113.** Every registration passes its
  constructor as a method reference, which compiles to an `invokedynamic` whose bootstrap entry
  names the class — so the obfuscated class behind `item` or `falling_block` is written down in
  the jar and every later stage can find it BY USE. Only `player` has none, because the client
  constructs it itself. ⚠ `javap -c` does not print that attribute; `javap -v` does.
  ⚠ **There is no JSON for any of this.** No data pack file, no tag, and nothing in
  `minecraft-data` that was not itself typed in from somebody's memory of the wiki. It is
  `EntityType.<clinit>`, one long `register("zombie", Builder.of(...).sized(0.6F, 1.95F)...)`
  chain, and the tenth application of the referee's rules (D-263).
- **✅ G17b — THE MOVEMENT CORE. Complete, session 9 (D-308).** ⚠ **Most of this already exists and was written entity-shaped
  rather than player-shaped**: `src/14b_physics.js` is `Ph.move(e, dx, dy, dz)`,
  `Ph.tick(e, cmd)`, `Ph.frictionOf(e)` — the collision sweep, the step-up, the fluid handling
  and the fall-damage arithmetic all take an entity and none of them mention the player. What is
  missing is the per-type constants, and an entity LIST the world ticks — the same shape of hole
  D-301 was, so **write the list and then ask who CALLS it in the shipped file.**
  ✅ **ITS CONSTANTS ARE ALREADY MEASURED AND WAITING** (D-307): `tools/extract-entity-motion.mjs`
  → `tools/golden/entity-motion-1.18.2.tsv` carries the per-class gravity for ten types including
  `item` 0.04, `falling_block` 0.04, `tnt` 0.04 and `experience_orb` 0.03. ⚠ **Nothing in the
  runtime reads it, deliberately** — a constant the shipped file carries but nothing consumes is
  D-289's shape, so consuming it is G17b's first act, not G17a's last.
  ✅ **BOTH DRAG SHAPES ARE READ** — `scale(0.98)` and `multiply(f, 0.98, f)`, the second
  resolved structurally rather than by simulating the operand stack: the horizontal factors are
  the same computed value pushed twice, so the flanks of the literal must be identical AND
  non-literal. ⚠⚠ Without that second clause an item's drag reads **−0.5**, because
  `multiply(1.0, −0.5, 1.0)` — the landing bounce — is symmetric too. **Eight types carry both
  constants and `EntityList` will simulate exactly those eight.**
  ☐ **OWED: the 102 entity types whose tick is inherited from a superclass**, named in the
  table's own header, narrowing the set `EntityList.spawn` accepts rather than being papered
  over.
  ⚠⚠ **THE NAIVE SUPERCLASS WALK WAS BUILT AND REJECTED** (D-309): fifteen lines, takes the owed
  list to a handful, and unsound — it handed `ender_dragon` a superclass's gravity because it
  could not tell an override from an inheritance.
  ✅ **The override test EXISTS** — D-309's first version wrongly said it did not — and it was
  built: the JVM dispatches on name AND descriptor, so an override always shares its parent's
  signature, and attributing the literal to a `name(descriptor)` lets a walk refuse when a class
  below declares it.
  ⚠⚠ **AND THE WALK IS STILL REJECTED, FOR A BETTER REASON: the method holding the literal need
  not be on the TICK PATH.** With the override test in place the walk gave `ender_dragon` a
  gravity of 0.04 from a method two classes up that nothing below overrides — the right answer to
  the wrong question. A class can hold a gravity-shaped statement in a helper that runs only in
  water, only in lava, or only while ridden. **An entity's own class is the one place where "adds
  a constant downward push" and "falls at this rate" reliably coincide.** G17c reads the
  superclasses it needs ONE AT A TIME, checking each statement is on the unconditional path. ⚠ **`arrow` is the SECOND SHAPE, and it has been read out of the jar rather than
  remembered**: `AbstractArrow` does `setDeltaMovement(vec3.x, vec3.y - 0.05F, vec3.z)`, which
  disassembles to `getfield Vec3.x` … `getfield Vec3.y / ldc2_w 0.05 / dsub` … `getfield Vec3.z`
  and a Vec3 constructor — no `.add()` anywhere. It is identifiable structurally without knowing
  which field letter is `y`: **the y is the component that has a constant subtracted from it,
  flanked by two plain getfields of the same object.** That is G17c's second extractor, and it is
  written down here so the next session starts from a verified shape instead of a guess.

  **`src/07i_entitylist.js`** is the list — spawn, remove, and one tick of the shared motion —
  called from `Main.worldTick`, with **`tools/entlistcheck.mjs` at 31 assertions and 5 breaks.**
  ⚠⚠ **AND `worldcheck` §5b PROVES IT IN A REAL BROWSER**, because `entlistcheck` drives the tick
  ITSELF and is therefore silent about the game — the exact shape D-301 hid in for nine sessions.
  It spawns a falling block in the running page, touches nothing, and watches `Main.worldTick`
  drop it 10 blocks onto a floor in 50 ticks; its break removes `EntityList.tick` and shows the
  NEXT block sit at age 0 for five seconds. **`worldcheck` is now 40 assertions and 4 breaks.**
  ⚠⚠ **WRITING THE FIRST NON-PLAYER ENTITY FOUND TWO PLACES WHERE "ENTITY-SHAPED" WAS A PROMISE
  THE BODY DID NOT KEEP** (D-308): `Ph.move` took the collider's HEIGHT from the entity and its
  WIDTH from `Ph.W`, the player's 0.6 — so a 0.98-wide falling block would have fitted through a
  gap it cannot fit through; and landing ran the player's fall damage, slime bounce and bed
  bounce for anything that touched the ground. The second crashed loudly only because
  `Ph.landed` reads the world; had it been pure arithmetic, TNT would have been taking fall
  damage for ever with every check green.
  ⚠ **The order is gravity, then move, then drag** — `FallingBlockEntity.tick` verbatim — and the
  check compares a hundred ticks against the recurrence written out by hand.
  ⚠ **`EntityList.spawn` REFUSES an unmeasured type.** Eight spawnable, 105 named as owed.
  `zombie` proves the rule: its tick is inherited from a superclass this engine has not read, so
  it is refused rather than lent the 0.04 that four other types use.
- **◐ G17c — THE CONCRETE ENTITIES AND THEIR PICTURE — the RENDERER is done (D-321).**
  ✅ `src/07j_entityrender.js` — an entity is a §8 mesh with **no greedy quads in it**, built from
  the same baked geometry the world uses and drawn by the model stream both backends already
  have. **No shader, no vertex format and no backend method changed.** One buffer a frame for all
  entities, one draw call per layer, anchored at the camera's block because a model position is
  i16 in 1/256 of a block and wraps at 128.
  ✅ **falling_block and tnt**, with vanilla's own constructor defaults read out of the jar
  (`FallingBlockEntity` = class `blh`: sand, dropItem, fallDamageMax 40; `PrimedTnt` = `blj`:
  fuse 80 and the 0.02 hop). `ER.OWED` names the other six spawnable types and the check fails if
  that list goes stale in either direction.
  ✅ **`tools/g17ccheck.mjs` — 83 assertions, 7 breaks.** §1 is the one that matters: `emit` is a
  SECOND writer of the model vertex stream, so it is asserted **byte for byte** against
  `Mesher.emitModelBlock` across twenty states at four cells each, and the break re-creates D-314
  by un-mapping `MESH_OF_DIR`.
  ✅ **`tools/g17cbcheck.mjs`** — the mandatory browser half: it spawns a falling block three
  metres from the eye in the shipped file, asserts the pixels changed, that they kept changing as
  it fell, and that **tnt and sand are different pictures** — the last because a renderer that
  ignored the state would pass everything else. Every claim is against a control pair (D-234).
  ✅ **ITEM ENTITIES** (D-323) — the same block model through `block/block.json`'s `display.ground`,
  with `ItemEntityRenderer`'s bob and `ItemEntity.getSpin`. ⚠ **The bob is on a ten-tick period and
  the spin on a twenty-tick one**; equal periods read as one mechanical wobble. The five PoseStack
  steps collapse to one matrix and a lift, and `g17ccheck` §9 checks that algebra against the
  uncollapsed chain over sixty samples — a simplification is the kind of thing that is nearly right.
  ☐ **OWED, NAMED:** sprite items (a billboard of the ITEM atlas, which the model shader does not
  sample) and the 2-5 copy stack pile — both in `ER.OWED_ITEM`; experience orbs, the projectiles,
  and the four mobs the motion table already admits — in `ER.OWED`. TNT's white flash overlay is a
  declared deviation.
  ⚠ **This is where a browser check is mandatory** — G16b is the argument: a stage whose output is
  a moving picture and whose checks only hold numbers is a stage that can ship drawing nothing
  (D-303, D-304).

### ◐ G17d — MELEE COMBAT — THE SUBSTRATE IS COMPLETE, session 11 (D-336, D-338)
Dan, session 11: *"there is no combat and no mid air punching without looking at anything (its
fine if this is allocated for later, if not, do it fully now)"*. It was allocated nowhere, so it
was built — and what "fully" means here has a hard edge, which is why this stage is ◐ and not ✅.

✅ **The swing fires on the CLICK** (D-334), hit or miss, with vanilla's ten-tick `missTime`, and
it keeps swinging once a tick while a block is being mined. `Hand.swing` had been complete and
correct since G10 and its only two callers were "a block broke" and "a block was placed", so a
punch at the sky did nothing and in survival a punch at stone did nothing until the stone gave
way. ⚠ **The model was finished and the input edge that drives it was never written** — the same
shape as D-330's slider, and `handcheck` could not see it because `handcheck` calls `H.swing()`
itself.

✅ **`tools/extract-itemattrs.mjs`** — the EIGHTEENTH bytecode table: attack damage and attack
speed for all 30 tools, out of the tool constructors in `Items.<clinit>`. It pays **D-271**, which
had left `Hand.attackSpeedTable` null for fourteen sessions with every item in the game swinging
at the base 4.0. ⚠ The sword is told from the other four tool classes **by its superclass** — four
extend `DiggerItem` and `SwordItem` does not — because only a sword sweeps.
⚠ **A ROUNDING ASSUMPTION WAS WRONG AND AN ANCHOR CAUGHT IT**: the first version rounded to a
sixteenth "because vanilla's modifiers are all multiples of 1/16". A sword's is −2.4, so its speed
is 1.6, and 1.6 × 16 is 25.6. The assertion that a diamond sword swings at exactly 1.6 failed on
1.625, which is what an anchor on a case that cannot be in doubt is FOR.

✅ **`tools/extract-entityattrs.mjs`** — the NINETEENTH: max health, movement speed, attack damage,
follow range and knockback resistance for every type, resolved through the SUPERCLASS CHAIN.
**74 of the 113 types have a max health and 39 do not**, and that split is vanilla's own definition
of a living entity — so "can this be attacked" is a fact about the jar rather than a list somebody
keeps. ⚠⚠ **AND IT MIS-READ EVERY PASSIVE MOB UNTIL THE RETURN TYPE WAS CHECKED** (D-306, a third
time): `AttributeSupplier.Builder.add(Attribute)` and `LivingEntity.getAttributeValue(Attribute)`
take the same single parameter and differ only in what they RETURN. Matching the parameter alone
read `getAttributeValue(ATTACK_DAMAGE)` as a bare add, and **every cow, sheep and bat came out
carrying an attack damage of 2** — a wrong number that looked entirely reasonable on every row.
⚠ A mob that adds an attribute with NO value takes the attribute's own default, which is where a
zombie's twenty hearts actually live: nothing in `Zombie` says 20.

✅ **`src/14j_combat.js`** — entity picking (the nearest entity inside the reach ray, its box
inflated by vanilla's 0.3, and it only wins when it is nearer than the block), `LivingEntity.hurt`
with its invulnerability gate, `LivingEntity.knockback`, and `Player.attack` with the cooldown ramp
`0.2 + h²·0.8`, the 1.5× crit and its five preconditions, the sprint knockback, and the sword
sweep. ⚠⚠ **A SECOND HIT INSIDE THE GRACE PERIOD IS DOCKED, NOT IGNORED**: while
`invulnerableTime > 10` a new hit lands only the amount by which it EXCEEDS the one that bought
the grace. Reading the grace as a plain "ignore" is the obvious reading and makes every weapon in
the game feel identical.
✅ **`tools/combatcheck.mjs` — 81 assertions, 8 breaks.**

◐ **WHY THIS IS NOT ✅, AND IT IS THE HONEST HALF.** Eight entity types can be simulated and three
can be DRAWN, none of them a mob. So the whole of this can be pointed only at a turtle, a dolphin
or a guardian that nothing renders. Dan's rule the same night was *"do not half do a feature"*, and
a zombie you cannot see is exactly that — so the substrate is complete and asserted, the picture is
**G18's**, and `combatcheck` §6 carries an assertion that FAILS the day a mob shape is added, so
the "substrate only" note cannot outlive the limitation it describes (the D-324 rule).
⚠ `Cb.OWED` names the eight parts that need systems this engine has not built — enchantments,
Fire Aspect, mob loot, experience, the sounds and particles — and `combatcheck` holds it closed.

✅ **THE EXTRUDED SPRITE MODEL — a dropped stick is on the screen** (D-341, D-342, D-344,
session 12). `ER.OWED_ITEM` carried "sprite items (no block model)" as a written-down deviation
while every headless check stayed green and a dropped stick, apple, ingot and diamond were
INVISIBLE. Vanilla has no billboard: `ItemModelGenerator` extrudes the sprite one sixteenth of a
block deep with a ring of merged side quads, and that geometry is compiled Java — so it came out
of the jar as the **20th referee table**, `tools/golden/itemmodel-1.18.2.tsv`, and goes through
`bakelib.bakeModel`, the same baker every block uses.
⚠ The item sprites now ship as texture-array LAYERS appended to the block atlas (D-341), because
the world's model stream samples that array by layer index; the HUD cuts its 2D sheet out of the
same pixels. **One source of item pixels in the file**, and smaller than the PNG it replaced.
⚠ **The model decides which picture an item gets, not `isBlock`**: `rail`, `torch`, `ladder`,
every sapling, flower and candle place a real block state and are still drawn flat.
⚠ **The 2-5 copy stack pile is exact**, so the second `OWED_ITEM` entry is gone as well:
`java.util.Random` is a 48-bit LCG and the referee pins the port against a **real JVM**.
⚠ **Item tints are baked into their own atlas layers** (D-344) — 123 (sprite, colour) pairs — so
a dropped spawn egg is the colour the inventory shows. The HUD's old `source-in` composite
REPLACED the colour where vanilla MULTIPLIES, so that path was wrong as well as duplicated; it is
deleted.
✅ **`tools/spritecheck.mjs` — 58 assertions, 6 breaks**, a BROWSER stage: it drops a stick in
front of the camera and asserts the PIXELS, and holds the ground transforms, the span sides, the
tint multiply and `java.util.Random` against the bytecode table.
⚠ `ER.OWED_ITEM` is down to ONE entry — the 67 `builtin/entity` items (chests, beds, banners,
skulls, shulker boxes), which need a block-entity renderer. That is **G17e's**.

### ✅ W8b — WHAT MAY STAND ON WHAT — SEVEN FAMILIES CLOSED, session 12 (D-346)
`NEXT.md` carried "a torch can be placed in mid-air" for three sessions and it was **stale**:
`World.setBlock` has refused an unsupported placement since D-155. Measured rather than assumed,
what actually floated was **rail, snow layer, cactus, lever, button, door, carpet** and pressure
plates — families whose rule `pack-runtime.mjs`'s material-derived class cannot express.

✅ **`tools/extract-support.mjs`** — the **21st referee table**. `canSurvive` is identified by
SHAPE AND COUNT, and ⚠ **there are two candidate descriptors**: the other takes a `BlockGetter`
rather than a `LevelReader` and is `propagatesSkylightDown`, with 46 overriders of its own. They
are told apart by asking which level interface EXTENDS the other. **56 overriders; 267 of 898
blocks have a rule across 55 owner classes**, and a block's rule is whichever ancestor overrides
the method — exact, not a grouping.
✅ **The three support types.** FULL is the whole face, CENTER a 2x2-pixel patch at the middle,
RIGID the outer two-pixel rim. A fence passes CENTER only (torch yes, rail no); a **hopper is the
reverse** — a rim with a hole — so it takes a rail and refuses a torch. One `States.faceCovers`
primitive over the collision boxes answers all three; the rectangles come from the enum's own
subclasses.
⚠⚠ **TWO OF MY OWN READINGS WERE WRONG AND IDENTIFICATION BY USE CAUGHT BOTH.** Exactly two
blocks override `getBlockSupportShape` — snow and **soul_sand**, which returns a WHOLE BLOCK
though it is 14/16 tall. That is why redstone, rails and repeaters sit on it, and the collision
shape alone refuses all three.
⚠ **THE GATE WAS SHUT**: `setBlock` consulted `canSurvive` only when the OLD class was non-zero,
so every new rule was dead on arrival — D-330's slider and D-334's swing a third time.
✅ **TWELVE RULES OVER 169 BLOCKS**: rails and diodes, pressure plates, snow, cactus, buttons and
levers, doors, carpets, candles, coral, coral wall fans, banners/signs/candle cakes, wall banners
and wall signs. ⚠ A rule may serve several OWNER CLASSES — a repeater's `canSurvive` is
byte-for-byte a rail's — and each family is asserted separately so a future divergence fails.
✅ **`Material.isSolid`, derived by elimination and anchored on COBWEB.** Three rules read the
MATERIAL of the block below and nothing here carried it. It is the ABSENCE of a builder call, and
two candidates survive elimination because `nonSolid()` and `noCollider()` travel together —
except in `Material.WEB`, which has no collider and is still solid. ⚠ The distinction IS the rule:
a banner stands on a **cobweb** and NOT on a **ladder**. `block-materials-1.18.2.tsv` grew a
fourth column; 224 of 898 blocks are non-solid.
✅ **`tools/supportcheck.mjs` — 113 assertions, 6 breaks**, asserting every rule in BOTH
directions, because **a rule that refuses a LEGAL build is worse than one that allows an illegal
one**.
⚠⚠ **TWO BUGS IN THIS STAGE'S OWN WORK, BOTH FROM ASSERTING HALF A RULE.** The wall-attachment
direction table was INVERTED and nothing caught it, because the check asserted that a lever HAS a
rule and never placed one on a wall; and the ladder test set a ladder into open air, which was
correctly refused, leaving the previous line's cobweb in the cell — so the check was **measuring
its own setup**. Both are now asserted.

◐ **98 BLOCKS WERE STILL OWED AT THE END OF D-346** — counted in `DATA.supportOwed`, named by
the referee, chosen in `tools/supportrule.mjs` in the open. **W8c closed 97 of them.**

### ✅ W8c — THE OTHER 97, AND THE SECOND LEVEL OF THE RULE, session 12 (D-348..D-351)

⚠⚠ **"THE BUSH FAMILY ALREADY HAS A WORKING MATERIAL-DERIVED RULE" WAS THE TRAP.** The 37-block
family shares ONE `canSurvive`, and its whole body is *fetch the state below, hand it to
`mayPlaceOn`* — which is **overridden seventeen times beneath it**. Treating them as one rule
plants **nether wart on grass** and floats a **lily pad on stone**, and both builds pass a check
that only asserts "it does not float". **A family is a family of RULES, not of blocks** (D-348).

✅ **The referee grew a second level.** `extract-support.mjs` finds `mayPlaceOn` by what the
delegating `canSurvive` DOES — fetch the position below, call a method on ITSELF taking
(BlockState, BlockGetter, BlockPos) — so the twin trap next door (`propagatesSkylightDown`, the
identical descriptor) is disarmed by construction. **19 overriders, 52 blocks, 17 ground owners**,
written as `ground` rows.
✅ **Twenty-six more rules, 266 of 267 blocks ruled.** Torches, wall torches, ladders, tripwire
hooks, amethyst clusters, lanterns, cake, mushrooms, crops, double plants, soul fire, redstone
wire, farmland and dirt path (which look **up**), sugar cane (whose water is beside the **ground**,
not beside the cane), cocoa (which looks ALONG its facing), bamboo, bubble columns, hanging roots,
spore blossoms, both dripleaves, pointed dripstone, the bell, the piston head, the four growing
plants, vines, glow lichen, both chorus blocks and scaffolding.
⚠ **A THIRD OF THEM WERE RULES THAT ALREADY EXISTED.** A torch's body is byte for byte a candle's;
a ladder's is a coral wall fan's; a cake's is a banner's. Naming rules by a REPRESENTATIVE BLOCK
is what made that visible, and `supportcheck` asserts the sharing rather than assuming it.
✅ **`tools/extract-occlusion.mjs` — the 22nd referee table** (D-350), and the mushroom is why.
`isSolidRender` is `canOcclude && a full-cube OUTLINE`, and the `transparent` flag this engine had
comes from the third-party dataset, not the jar. ⚠ It agreed on all 898 blocks — the old table was
right, and is now PROVED right rather than trusted. ⚠ **A helper is a name AND a descriptor**: the
first draft looked one up by name and `oak_leaves` came out occluding, because `Blocks` has a
dozen static methods called `a`. ⚠ And the table carries a second column because **soul sand**
overrides its COLLISION shape and not its outline, so a collision-based test refuses a mushroom
where vanilla allows one.
⚠⚠ **A BUG IN SHIPPED CODE, FOUND BY READING** (D-349): rule 4, the cactus, read `SR.solid[...]`
— a per-STATE table — with a BLOCK index. The check had asserted a cactus **on sand** and **in
mid-air**, never **beside** anything, which is the only direction the bug was in.
⚠⚠ **AND A RULE THAT CANNOT BE EVALUATED MUST SAY SO, NOT SAY NO** (D-351). `02f_tags.js` is
optional; without it every tag rule refused everything and `fuzzcheck` failed with *"a plant was
refused a placement onto dirt"*. `tagBelow` now records an unanswered question and `surviveRule`
returns -1 — "no opinion" — falling through to the material class.
✅ **`supportcheck`: 113 assertions -> 278, 6 breaks -> 24.** Every new rule in BOTH directions,
every block and tag the rules name asserted to be one the jar names, and the scenes verify
themselves — which caught four of them placing floating blocks.

◐ **ONE BLOCK REMAINS OWED: `fire`**, which needs the per-block ignite-odds map. `World.OWED_GROUND`
names it and `supportcheck` asserts the list is exactly one long, so it fails the day it closes.

### ✅ G10d — THE FIRST-PERSON HAND, AS REAL GEOMETRY — session 13 (D-359)
Dan, session 13: *"items in your hand are still not even close to vanilla … theres no sway in the
hand and hand models like the real game."* The held item had been a software-rasterised sprite
blitted onto the 2D HUD canvas since G10b; **a blit has three degrees of freedom and vanilla's
hand needs twelve**, which is why four sessions of tuning (D-273, D-311, D-320, D-328) did not
converge. The 2D path is deleted and the item and arm are geometry, drawn in their own pass after
the world and after a depth clear — vanilla's own `RenderSystem.clear(256)` before
`renderItemInHand`.

Every constant comes out of the client jar by float fingerprint
(`tools/extract-handrender.mjs`), and `handposecheck` holds the port against it: 32 constants,
the composition against a second row-major implementation, and the swing, the equip dip and the
0.1 look-lag as differences rather than absolutes. Per-item `firstperson_righthand` transforms —
seventeen distinct ones — are packed in the item table. **Closes the place-FPS report as well:
5.1 ms a frame of software rasterisation during every swing became 0.07 ms, and `inputcheck` §2b
asserts the rasteriser is not entered at all.**
**Checks:** `handposecheck`, `inputcheck` §2b, `texaudit` §3b.

### ✅ G19 — RIGHT-CLICK: the block's own `use`, then the item's — session 13 (D-361)
⚠ **G19 IS THIS, AND ONLY THIS.** It used to also name the Nether and the End; that is **G27**
now (the renumber, below). AUDIT §3.
**`Player.act`'s right-button branch was `placeBlock()` and nothing else**, so no block in the
game had a right-click behaviour and no item whose use is not placement did anything. `Use` is
vanilla's `MultiPlayerGameMode.useItemOn` order — block `use`, item `useOn`, placement last, with
the sneak clause. Doors (both halves; iron refuses by MATERIAL), trapdoors, fence gates that turn
to face you, levers, buttons at 30/20 ticks on a scheduled tick, repeaters, comparators, TNT
priming, candle and campfire lighting, hoe, shovel, axe, both buckets.
◐ **Ten interactions are NAMED as owed** on `Use.OWED`, each with the stage it waits for, and
`usecheck` holds the list closed: container and crafting screens (G19b), sleeping (G19c), eating
(G19d), the remaining item uses (G19e), throwables and vehicles (they need entity types on
`EntityList.owed()`), bone meal (G20), and **spawn eggs (G18)**.
**Checks:** `usecheck`.

### ⚠⚠ THE G-STAGE RENUMBER — 17 September 2026, Dan's ruling

**"G19" meant four different things and "G20" meant two**, depending on which file you opened
(AUDIT §3.1). Every owed gap in this codebase is a list that names the stage that will close it,
so an ambiguous id makes that whole discipline unreliable — and it already cost one: the daylight
detector's owed row cites "G16 builds both", G16 is complete, and nothing noticed for four
sessions (AUDIT §2.11).

**The rule: anything already SHIPPED keeps its number. The two unstarted stages that caused the
collision move up. The eight new stages take the numbers after them.** `G19` stays right-click,
because it shipped as D-361 and `usecheck` cites it.

▶ **`tools/stagecheck.mjs` (pass 15) holds this closed**: it fails on any `G<n>` citation in
`src/`, `tools/` or `docs/` that is not on this roster, **and on any owed row citing a stage that
is already complete** — which is the §2.11 bug, generalised into a machine.

| Was | Is now |
|---|---|
| G19 = the Nether and the End | **G27** |
| G20 = statistics, advancements, scoreboard | **G26** |
| "G19" in `15f_options.js` (advancements, stats, accessibility) | **G26** |
| "G19" in `02j_sounds.js` (music, ambience) | **G26** |
| "G16c" in `02j_sounds.js` (weather) | **G20** — there is no G16c; G16 is complete |
| "G20 farming" in `14l_use.js` (bone meal) | **G24** |
| "G17c" in `15e_creative.js` (the 60 blank icons) | **G17e** — corrected 17 Sept |

---

### ☐ G17e — THE BLOCK-ENTITY ITEM RENDERER
**Pre:** G10c, G17c. The 67 `builtin/entity` items — chests, ender and trapped chests, seventeen
shulker boxes, sixteen beds, sixteen banners, six heads, the conduit, the shield. `15h_bemodel.js`
already draws 58 of 60 into a GUI slot (D-317, D-324); what is owed is the same layers **in the
world**, so a dropped chest and a placed bed are drawn, closing `ER.OWED_ITEM`'s last entry.
⚠ The two that stay owed are honest: the dragon head's layer is one of the nine
`extract-models` cannot build, and the conduit registers no layer at all.
**Checks:** `bemodelcheck`, `g17ccheck`, `creativecheck`.

---

### ◐ G18 — MOBS. **SPLIT INTO SIX.** — status (s116, D-630): d/e done, a/b/c/f ◐; what is left is QUEUE row 0.2's own checklist, not these headings
**Pre:** G17a–d. **Last, by D-9**, and at full parity when it comes — Dan, 17 Sept:
*"with the exact GUIs and textures of the processes like sheep hearts and trade UIs too. don't
tell them to be lazy on this and make sure everything that they do is testable and the tests
aren't vacuous."* D-9 names this as the **one parity item with a real runtime cost — measure it on
the 2200G** before and after.

⚠⚠ **MOST OF THE SUBSTRATE IS ALREADY BUILT, AND `AUDIT §4b` COUNTS IT.** 138 model layers and
699 boxes are extracted from the bytecode and cover nearly every mob in the game; the box→face UV
layout is derived and asserted against the player skin; `15h_bemodel.js` already rasterises those
boxes; every mob's health, speed, attack damage, follow range and knockback resistance is in
(D-336); the whole melee path is in (D-338); and `B.spawners(i)` has carried each biome's spawn
list since W5. **G18 is not "build a mob system from nothing."**

#### ◐ G18a — the mob RENDERER, the TEXTURES, and `setupAnim` — mobs drawn + textured + animated (sessions 73-96); open: player skin, mob sound sources (O.OWED, S.OWED_SOURCES)
Four jobs, all named:
1. **The eight missing layers** — `creeper`, `pig`, `silverfish`, `endermite`, `wither`,
   `ender_dragon`, `tropical_fish`, `sheep_fur`. ⚠ **Two of them are a creeper and a pig**, so
   this is not a tail that can be deferred.
2. **The mob texture sheets**, from the **1.13.2** jar per the locked pre-1.14 ruling, through the
   same lossless path the block atlas uses.
3. **A world-space consumer of the layer table** — the boxes emitted as §8 model-stream quads with
   a per-part transform. The format already carries what is needed; this adds a consumer, not a
   renderer.
4. **`setupAnim`, the TWENTY-FIRST bytecode table** — head yaw/pitch tracking, the limb-swing
   cycle, and the per-mob specials (a creeper's swell, a spider's leg pairs, a squid's tentacles).
⚠ **The first mob that can be SEEN closes `combatcheck` §6's standing assertion and turns G17d
from ◐ to ✅.** It also closes `Use.OWED`'s spawn-egg row.
**Acceptance:** a browser stage that spawns one of each drawable mob in front of the camera and
asserts the PIXELS, the way `spritecheck` does for a dropped stick.

#### ◐ G18b — mob AI: the goal selector, the goals, and pathfinding — STARTED, session 26, D-382; every rostered mob has its real goal list by s115, residue on `Ai.OWED`
`Ai.GoalSelector` (`src/07k_goals.js`) has vanilla's priority + flag model, a generic
`pathTypeAt`/`groundLevel`/A* (built on already-verified collision/fluid data, NOT the jar's own
per-block `BlockPathTypes` table — that stays `Ai.OWED`, named rather than guessed, D-382), and
eight goals rostered for `cow`/`zombie` only — the two mobs this pass's own acceptance list
exercises. `tools/goalcheck.mjs` (41/0, 3 breaks) proves it against SYNTHETIC entities.
⚠ **`EL.spawn('cow'|'zombie')` no longer refuses (D-390, session 30)** — the gravity gap was
LivingEntity's own generic `travel()` gravity, applied ~1,170 bytecode offsets after the constant
is loaded, which three earlier sweeps' patterns did not span. Nothing here is wired into a live
per-tick loop yet — that is still open, and is the next actual step, not the gravity gap. ⚠ Eight more goal types remain `Ai.OWED`
(`BreedGoal`, `TemptGoal`, `FollowParentGoal`, `HurtByTargetGoal`, `AvoidEntityGoal`,
`RangedBowAttackGoal`, `SpiderAttackGoal`, `LeapAtTargetGoal`) and the door-breaking half of
`ZombieAttackGoal`. A mob that moves plausibly and is not vanilla's mob is the exact failure this
project's referee exists to catch: **pin the path against real server behaviour, not against a
look** — the per-block node-type table is exactly where that still has to happen.

#### ◐ G18c — SPAWNING — rules CLOSED D-570/D-573/D-582 (rules, despawn, caps); spawner cages D-621; open: spawn eggs for most mobs (Use.OWED)
`MobCategory` and its caps, the light and block placement rules, pack spawning, the biome
`spawners`/`spawn_costs` already carried, despawn distance and the persistence flag, and the
spawner block. **Closes `Use.OWED`'s spawn eggs.**

#### ✅ G18d — mob DROPS, and the loot tables — DONE, session 25, D-381
`pack-loot.mjs` now packs the 91 entity tables plus the one `gameplay/fishing/fish` reference
target (chest tables still deferred to G19b), and `07e_loot.js` interprets the six verbs those
add. `Cb.dropLoot` runs them on death and pops real item entities; looting is carried as a
parameter, forced to 0 until G22. `tools/mobslootcheck.mjs` holds it (24/0, 3 breaks caught).
**Closed** `Cb.OWED`'s "mob loot" entry; "experience" is still **G21**'s.

#### ✅ G18e — BREEDING, TAMING, BABIES — **and their particles and GUIs** — CLOSED D-574/D-576 (residue `Tm.OWED`/`Br.OWED`)
Breeding items per family, the love-mode timer and cooldown, **the heart particles** (Dan named
these explicitly), baby scaling and the child model variants, taming with its chance rolls, wolf
and cat collars, horse and llama inventories and their SCREENS, leashing, and the anger timers.
⚠ **The particles are not decoration here** — they are how a player reads the state machine, so
they are part of the feature and not a follow-up.

#### ◐ G18f — VILLAGERS: professions, the TRADING SCREEN, restocking, raids — built D-478..D-615; awaiting the lane's full-suite confirm (QUEUE 0.2)
Professions and their workstation blocks, the offer tables, **the trading screen itself** with its
scroll list, the disabled-offer state, the XP bar and the level badge, restocking on the
workstation, gossip and price adjustment, iron golem spawning, and the raid/pillager loop.
⚠ Villages already generate (W17), so **empty villages are a visible hole** and this stage is what
closes it.

---

### ☐ G19b — CONTAINER SCREENS, AND THE CRAFTING TABLE SCREEN
**Pre:** G8, G19. Chest, double chest, ender chest, barrel, shulker box, furnace (and blast
furnace and smoker) with its three slots and burn arrows, hopper, dispenser, dropper, brewing
stand, and **the crafting table screen — the 3x3 grid exists and the SCREEN does not.**
The menu model in `14g_menu.js` is `AbstractContainerMenu.doClick` off the bytecode already, so
this is new screens over a complete substrate. **Closes** two `Use.OWED` rows and unblocks
`Rs.OWED_SOURCES`'s `trapped_chest` and `lectern`.

### ☐ G19c — SLEEPING
Beds, the sleep animation and camera, the night skip and its multiplayer rule, the spawn point,
the "monsters nearby" and "not tired" refusals, and the explosion in the wrong dimension.

### ☐ G19d — EATING, THE USE-ITEM HOLD, AND THE OFFHAND
Vanilla's use-item hold and its tick count, eating with its animation, particles and sound, the
food and saturation values already carried from `foods.json`, potion drinking, and **the offhand,
which is not drawn** — the golden table has both its frames and `guicheck` names the gap.

### ☐ G19e — THE REMAINING ITEM USES AND INTERACTABLE BLOCKS
Shears, fire charge, lead, name tag, written book, spyglass, honeycomb waxing; note blocks,
jukeboxes, lecterns, cauldrons, composters and the bell. **Closes the last two `Use.OWED` rows.**

---

### ☐ G20 — WEATHER, AND THE PARTICLE ENGINE
**Pre:** G16. **Two halves, and the particle half is the one everything else is waiting on.**
* **Weather:** rain and snow by biome temperature, thunder, the sky and light-level changes,
  lightning strikes and the lightning rod, the rain sound source, and **the sunrise/sunset band**
  that G16b left undrawn.
* **Particles:** vanilla's particle types and their behaviour — block break, crit, sweep, smoke,
  splash, flame, heart, damage indicator, portal. ⚠ **This closes the "attack sounds and the
  crit/sweep particles" row of `Cb.OWED`**, and G18e's hearts depend on it. — the particle half
  DONE D-658 (crit/enchanted_hit emitters, sweep, damage indicator); the sounds wait on D-12.
⚠ There is no `G16c`; `02j_sounds.js` cites one and is corrected to **G20** by pass 15's sweep.

### ✅ G22a — THE ENCHANTMENT ROSTER
All 37 enchantments diffed against the jar (`tools/enchroster.mjs`).

### ☐ G21 — EXPERIENCE: ORBS, LEVELS, THE BAR
**Pre:** G17c, G18d. The orb entity and its merge and attract behaviour (`ER.OWED` carries
`experience_orb`), the level curve, the drop-on-death rule, and the XP costs the anvil and the
enchanting table will charge. **Closes** `Cb.OWED`'s "experience" row.

### ✅ G22b — THE ENCHANTING TABLE BLOCK
Bookshelf power by line of sight through `isAir` (`src/14d_survival.js`, `enchtable`).

### ☐ G22 — ENCHANTING, ANVILS, GRINDSTONE, AND THE 37 ENCHANTMENTS
**Pre:** G19b, G21. The enchanting table with its bookshelf power, the seeded offer roll and the
obfuscated Galactic label; anvil repair, combine and rename with its cost and the "too expensive"
rule; the grindstone. Then the enchantments themselves — **which is what closes four of
`Cb.OWED`'s eight rows**: Sharpness/Bane/Smite, the Sweeping Edge ratio, Knockback, Fire Aspect,
and Thorns damaging the attacker.

### ✅ G23d — DAMAGE, BREATH AND MINING EFFECTS
Fire resistance's damage gate, water breathing/conduit power in `tickAir`, haste and mining fatigue through `StatusEffectUtil` (`src/07q_effects.js`, `effectenvcheck`).

### ✅ G23f — EFFECT PARTICLES AND VISIBILITY
The swirl particles, ambient flag, POTION_SWIRLS colour and `updatePotionVisibility` invisibility (`src/07q_effects.js`, `effectparticlecheck`).

### ◐ G23k — VIEW EFFECTS
Night vision curve, blindness fog/colour, nausea ramp+wobble as numbers (`src/14kd_effectview.js`, `effectviewcheck`); renderer wiring and glowing outline owed.

### ✅ G23e — EFFECT HUD
Top-right beneficial/harmful rows with the blink alpha, and the inventory effect list (`src/15_hud.js`, `effecthudcheck`).

### ☐ G23 — BREWING, POTIONS, STATUS EFFECTS
**Pre:** G19b. The brewing stand and its fuel, the recipe tree, the potion registry already
carrying its colours from D-259, splash and lingering potions, and **the status effect system** —
which `Cb.OWED`'s "Blindness suppressing a critical hit" row is waiting on.

### ✅ G23b — EFFECT ATTRIBUTE MODIFIERS
StatusEffects.java's modifier table (uuid/amount/operation) in `src/07q_effects.js`, read through `ES.attrValue` by player/mob speed, FOV, attack cooldown and loot luck (`effectattrcheck`).

### ✅ G23c — MOVEMENT STATUS EFFECTS
Slow falling, dolphin's grace, jump boost and speed/slowness reads in `LivingEntity.travel`/`jump`/`computeFallDamage` (`src/14b_physics.js`, `effectmovecheck`).

### ✅ G24b — PLANT STEM GROWTH
AbstractPlantStemBlock.randomTick: kelp, weeping/twisting vines and cave vines grow their head (`src/07b_behaviour.js`, `plantstem`).

### ◐ G24i — FISHING ROD AND BOBBER
FishingBobberEntity wait timer (Lure, rain), the 5x4x5 open-water scan and reeling (`src/07zzq_fishing.js`, `fishing`).

### ✅ G24j — BOBBER AND FISHING LINE RENDERING
Bobber billboard, 16-segment line and the rod's cast model (`src/07j_entityrender.js`, `bobberdraw`).

### ☐ G24 — FARMING AND FISHING
**Pre:** G19d. Crop growth and its light and hydration rules, bone meal (`Use.OWED` cites a
"G20 farming" that does not exist — it is this stage), trampling, the composter, and sweet
berries; the fishing rod, the bobber (`ER.OWED` carries `fishing_bobber`), the catch timer and the
fishing loot tables. Animal food is G18e's.

### ✅ G22d — THE ANVIL
Anvil repair, combine and rename with its cost and the Too Expensive cap (`src/07zzp_anvil.js`, `anvilcheck`).

### ☐ G25 — VEHICLES, FRAMES, PAINTINGS, ARMOUR STANDS, NOTE BLOCKS
**Pre:** G17c, G18a. Boats and their passengers, minecarts and **all six rail types** with their
powered and detector behaviour, item frames and their comparator output, paintings and their
motive table, armour stands with their poses and slots. ⚠ **And the moving piston block, drawn
part-way between its cells** — named in `NEXT.md` and owned by nothing until now.
**Closes** `Rs.OWED_SOURCES`'s `detector_rail`, `target` and `tripwire_hook`.

### ☐ G26 — STATISTICS, ADVANCEMENTS, SCOREBOARD — **and the options screens they unblock**
**Pre:** G12. The 1,141 advancement files are data; the statistics counters are a table. Wide
rather than deep. ⚠ **It also closes four `O.OWED` rows** — Advancements, Statistics,
Accessibility Settings and Chat Settings — and `S.OWED_SOURCES`'s music and ambience.
**Was G20.**

### ✅ G22e — THE GRINDSTONE
Grindstone screen, disenchant and XP return (`src/07zzq_grindstone.js`, `grindstonecheck`).

### ✅ G22f — TOOL-SIDE ENCHANTMENTS
Efficiency, Silk Touch, Fortune, Unbreaking wear and Mending read off the held stack (`tools/enchtoolscheck.mjs`).

### ✅ G26a — THE STATISTICS SUBSTRATE
Stat/StatType/Stats/StatHandler/StatFormatter tables, counters, save round-trip (`src/07zzo_stats.js`, `statscheck`).

### ✅ G26b — THE STATISTICS SCREEN
StatsScreen general/items/mobs lists, live pause button, O.OWED 'Statistics' struck (`src/15fs_stats.js`, `statsscreencheck`).

### ✅ G27b — THE NETHER AND END BIOME SOURCES
MultiNoiseBiomeSource NETHER preset + TheEndBiomeSource (`src/04y_biome_dims.js`, `dimbiomecheck`).

### ◐ G27c — NETHER TERRAIN
NS.NetherTerrain density, slides, lava sea, bedrock gradients, nether surface rules (`src/04yn_nether_terrain.js`, `netherterraincheck`). Owed: hook into WG.generate, Nether golden in vanillacheck.

### ◐ G27d — NETHER CARVERS AND FEATURES
Part 1: `src/04z_feat_nether.js` (basalt, delta, blobs, glowstone, vines, nether vegetation; `netherfeaturecheck`). Owed: huge_fungus, nether_cave carver, nether springs.

### ◐ G27e — THE END TERRAIN AND FEATURES
NS.EndTerrain end_islands density, slides, end stone fill, EndSpikeFeature, podium, gateway, chorus (`src/04za_end.js`, `endterraincheck`). Owed: hook into WG.generate, End golden in vanillacheck.

### ◐ G27j — DIMENSION RENDERING
Per-dimension sky frame (DimensionEffects port: no sun/moon/stars in Nether/End, fog rules; `dimskycheck`). Owed: End sky box, fog range in applyFog, Nether ambient light, lava/soul-sand particles.

### ◐ G27m — NETHER-SPECIFIC BLOCK BEHAVIOUR
Wither summon/skull/boss bar, magma, soul speed and RespawnAnchorBlock.onUse (`Sleep.useAnchor`, `nethermischeck`). Owed: lodestone compass, wither rose, nether gold/debris tool checks.

### ✅ G26c — ADVANCEMENT DATA
1141 advancement files packed and AdvancementProgress (`src/02l_advancements.js`, `advancementcheck`).

### ☐ G26d — ADVANCEMENT CRITERIA
**Pre:** G26c. The server player's criteria triggers and grants, on top of the G26c data.

### ✅ G26e — ADVANCEMENTS SCREEN
Layout port of AdvancementsScreen/Tab/Widget (`src/15m_advscreen.js`, `advscreencheck`).

### ✅ G26f — SCOREBOARD SUBSTRATE
Scoreboard port plus sidebar/list/belowName HUD slots (`src/15k3_scoreboardhud.js`, `scoreboardcheck`).

### ☐ G27 — THE NETHER AND THE END
**Pre:** W6, G17, G18. The other two `noise_settings` presets and their biomes are already in the
766 files. Portals and dimension transitions, the Nether's own mobs and structures, the End
islands and the gateway, and **the dragon fight** — a boss AI, a multi-part entity, the crystals
and the pillars. ⚠ **Realistically a pass and a half on its own; it is scheduled as passes 21–22.**
**Was G19.**

---

### ══ GATE G ══
Whole-game parity. The bar is Dan's sentence: *a person watching over your shoulder cannot
easily tell it is not Minecraft, with the old textures on.*

---

## 6. TRACK X — EXTRAS

*Additive only. Dan: **"perf goes in w and g appropriately"** — nothing here is ever a
performance excuse, and nothing here is load-bearing.*

### ☐ X1 — Jade-style block inspector
Look at a block, see its name, its mod source, its tool, its progress. Data already in F7.

### ☐ X2 — AppleSkin-style food overlay
Saturation and the exhaustion bar, drawn over the hunger bar. Data already in G5.

### ☐ X3 — Mouse Tweaks
Drag-move, drag-split, scroll-transfer in containers. Sits directly on G8's slot model.

### ☐ X4 — Controlling
Searchable keybinds with conflict detection.

### ☐ X5 — Resource-pack loader
Load a `.zip` from the file picker and override atlas tiles at runtime. `file://` forbids
`fetch`, so this is a `FileReader` path and **the atlas must be rebuildable at runtime**,
which is a real constraint on F5's design — noted here so F5 does not accidentally forbid it.

### ☐ X6 — Shader loader
A small, safe subset: the backends already compile shaders, so this exposes the slot.
D-13 caps ambition: nothing that stops it looking like Minecraft.

### ☐ X7 — Screenshots, video capture, F3 extras

### ☐ X8 — Accessibility
Colourblind palettes, UI scale, subtitles (already keyed by G13's `sounds.json`), sensitivity
and FOV, key remapping without conflicts.

---

## 7. STRUCTURES — W13 … W18

`STRUCTURES.md`'s **ordering is correct and is kept**: it goes from structures that do not
care about terrain shape to structures that must negotiate with it, which is the right axis
because deviation #1 makes MC-Lite's terrain harder-edged than vanilla's. What changes is
the **cost** attached to each phase, per §1.6, and the addition of the pipeline stage that
`STRUCTURES.md` did not know it needed.

**The invariant, restated because everything here depends on it:**

> A structure must be decidable from its own chunk plus a bounded neighbourhood, from the
> seed alone, **without generating neighbouring terrain first.**

Break it and you get either infinite recursion (chunk A needs B needs A) or structures that
differ depending on which direction the player walked in. The three passes:

```
1. start pass   hash(seed, cx, cz) -> does a structure start here? which? what rotation?
                pure, no terrain, no neighbours, no allocation
2. piece pass   expand the start into placed pieces with bounding boxes. MAY query the
                cheap column function height(x,z)/climate(x,z) for any point — that is a
                splined 2D evaluation, not a chunk generation, so it is safe
3. write pass   while generating chunk C, ask which pieces overlap C, write only that part
```

**Step 2 is the whole trick, and it is a place where the cheap worldgen is strictly better
than the expensive one.** Vanilla cannot cheaply ask "how high is the ground at this
arbitrary point" without generating a chunk; MC-Lite can, because deviation #1 made height a
pure function. RULE 1 predicted this: replacing a rule with a cheaper deterministic rule
sometimes *buys* capability.

Three adaptation tools, in increasing cost: **fit** (place at sampled height, no terrain
change), **beard** (synthesise support under, shave above, blend at the edges), **excavate**
(carve into the hillside and wall it).

### ☐ W13 — S1: scatter (fit only)
**Pre:** W8. Boulders, gravel patches, fallen logs, mossy rocks, small ruins. No adaptation,
no bounding-box negotiation, tolerant of any slope. **Highest visual return per unit of
work** — it is what kills the smooth-noise look Dan flagged. Content is `configured_feature`
data already fetched. **Acceptance:** determinism across three chunk orders; density per
biome within band.

### ☐ W14 — S2: underground — ⚠ *reimplementation, not a port*
**Pre:** W7, W13. Mineshafts, dungeons, caches. They live in cavities the carvers already
made and never touch the surface, so adaptation is not needed — but **§1.6 is the correction
that matters here: mineshafts, `monster_room` dungeons and strongholds are procedural Java
with no data file to port.** Corridors, crossings, rooms, rails, cobwebs, chests, and the
stronghold's ~14-piece room grammar are all code. Schedule it as such.
This is also what makes the big 1.18 caves worth exploring instead of empty, which is the
reason big caves were chosen in the first place (D-2).
**Acceptance:** `structcheck.mjs` determinism (same region, two different chunk orders,
byte-identical) — **this test must exist before S2 starts**, because S2 is the first
structure work that can break the recursion invariant.

### ☐ W15 — The NBT and jigsaw pipeline — *new stage; `STRUCTURES.md` did not have it*
**Pre:** W14. Everything §1.6 lists as free content needs this first:
- `tools/nbt.mjs` — gunzip + NBT reader/writer, zero dependencies
- the 866 `.nbt` pieces re-encoded: one **global** palette across all pieces, varint
  positions, RLE over sorted positions, DEFLATE, base64
- `structure_void` handled as **"leave what is there"**, never as air
- ⚠ the OTHER way round from what this list said until D-216: **plain** `single_pool_element` writes air, `legacy_single_pool_element` does not
- `palettes` (plural) chosen per placement, seeded from the piece position
- the 10 processor types and 8 predicate types
- the jigsaw matcher: for each connector, weighted-shuffle candidate elements, try each
  rotation, match `name`/`target` pairs, respect `aligned` vs `rollable`, translate so the
  mating connector sits in front, reject on bounding-box intersection, recurse to the depth
  budget (`size`: villages 6, bastions 6, outposts 7), then fall back to the terminator pool
- unconnected jigsaws replaced by their `final_state`
**Acceptance:** NBT round-trip — read all 866, re-encode, decode, assert the block list is
identical; report bytes before and after against D-12's ceiling. Plus a jigsaw assembly test
that asserts the same `(seed, chunk)` produces the same piece list across 100 runs.

### ☐ W16 — S3: small surface buildings (beard)
**Pre:** W15. Single-piece structures: huts, towers, wells, ruined portals, igloos.
One bounding box, one flatness test, one beard. **This is where terrain negotiation gets
built and debugged — on something small enough that failures are cheap and obvious.**
**Acceptance:** no floating and no burial — for each placed piece assert its floor is
supported and its door is reachable; ASCII cross-sections in the doc.

### ☐ W17 — S4: villages (jigsaw + beard)
**Pre:** W16. Only now, and Dan was right that they are hard. Needs, in order: a
flatness/suitability score per candidate centre sampled from the cheap column function
across a radius, **rejecting terraced and steep ground outright**; jigsaw assembly from W15;
paths that follow contours — which is `projection: terrain_matching`, **data, already
fetched**; per-building beard blended into the landscape.
Content is nearly free (§1.6). The work is the negotiation.

### ☐ W18 — S5/S6: the rest
Bastions, outposts, mansions, monuments, fortresses, end cities, shipwrecks, ocean ruins,
nether fossils, buried treasure, ancient-city-style deep structures. Mixed data and code per
§1.6's table. Placement from the 17 `structure_set` files (`spacing`, `separation`, `salt`)
— stolen wholesale, because per `STRUCTURES.md` this is structure *logic*, not worldgen
shape, and logic should be faithful.

**What to steal and what not to**, unchanged from `STRUCTURES.md`:
**Steal** the start/piece/write shape, the jigsaw connector model, the adaptation modes, and
spacing-and-separation placement. **Do not steal** density-function-driven terrain
negotiation — it assumes terrain MC-Lite does not have.

**Cost rule for all six:** structures must not measurably move chunk generation time on the
2200G budget. Measured, not asserted.

### ══ GATE W ══ — **BREACHED, 8 September 2026 (session 8)**

⚠ **Dan's ruling, and it moved the gate:** ALL of Track W, W1 through **W18 inclusive**, is
green before any G stage starts. The gate is NOT at W12, and the old "W runs to its first
gate, then G and the rest of W interleave" is dead (§2).

⚠ **This header said NOT BREACHED until session 9 and had done for two sessions**, while
`docs/NEXT.md` said Track W was complete 18 of 18 and its gate breached. Both cannot be true and
the reader who believes the wrong one starts the wrong work. The list it carried — W10b, W11's
light transport, `structcheck.mjs`, W13–W18 — is closed except W11's light transport, which is
**not Track W's**: Dan, session 5, *"light is supposed to be g phase"*. D-149, D-172 and D-177
are all settled. ⚠ `doccheck` does not compare two documents' claims about the same gate; that
this stood for two sessions is the argument for the check that would.

---

## 8. The suites

Every check is a real program with a non-zero exit code. `tools/suite.mjs` runs all of them.

**Measured on Dan's machine, session 5:** `node tools/suite.mjs --fast` →
**707,098 assertions · 182 deliberate breaks caught · 0 stages failed, over 37 checks, in
75 s.** ⚠ `--fast` skips the six browser-driven checks because Chromium is not installed
there; the full run has never been made on this machine. `node tools/gencheck.mjs` →
**13.5 ms per chunk** (49 chunks, seed 1337).

⚠ **The per-check assertion counts that used to be in this table are gone, deliberately.**
Every run of `tools/suite.mjs` prints them, they moved every time a check grew, and three
documents disagreed about them within two sessions. The project's own rule — a number that
cannot be reproduced by running the suite is wrong — makes the suite's own output the record.
This table says what each check is FOR, which does not rot.

| tool | what it is for |
|---|---|
| `modelcheck.mjs` | the model interpreter + placement rotation |
| `constcheck.mjs` | F7 constants, collision, occlusion |
| `meshcheck.mjs` | F8 round-trip: rotations, uvlock, cullface |
| `regcheck.mjs` / `statecheck.mjs` | the generated registry, and the REAL-vs-VISUAL state tables (`docs/ARCH.md` §3) |
| `itemcheck.mjs` | G7 items: kinds, layers, inventory models, constants |
| `tilecheck.mjs` | the atlas layer order, which is an INTERFACE the engine's own table asserts |
| `wgcheck.mjs` | W1: the vanilla worldgen data loads and every field survives packing |
| `noisecheck.mjs` | W2 statistical referee vs published vanilla |
| `colcheck.mjs` | W3 the column function |
| `climcheck.mjs` / `biomecheck.mjs` | W4/W5: the multi-noise climate table and biome assignment |
| `surfcheck.mjs` / `tintcheck.mjs` | W6 surface rules, and the tint texture's half-texel seam (D-122) |
| `cavecheck.mjs` | W7 carvers: the (seed, chunk) invariant and cross-sections |
| `featcheck.mjs` | W8 features, placements, ore peaks, the (seed, chunk) invariant |
| `facecheck.mjs` | is there a face between the player and the sky, under every quality preset |
| `floatcheck.mjs` | nothing stands on nothing; the dungeon gate |
| `lightcheck.mjs` | W9: vanilla's light rules by hand, the same room 5,000 blocks out (D-148), opaque emitters (D-150), and a real 5×5 region with no seam |
| `streamcheck.mjs` | W10: spiral, eviction, cancellation, the pool, the vis mask, throughput, and how far from spawn the frustum test is honest (D-149) |
| `parcheck.mjs` | W11: the same world from 1, 2 and 8 engines, and light in any arrival order |
| `gencheck.mjs` | terrain, ASCII cross-sections, chunk-generation timing, and the D-178 leaf fence |
| `fuzzcheck.mjs` | 2,000 seeded random edits from the real roster, then the invariants: no light seam, every touched section re-meshes, every edit round-trips, the world stays deterministic |
| `savecheck.mjs` | the save format round trip, and a name this build no longer has becoming air |
| `emitcheck.mjs` / `inflatecheck.mjs` / `physcheck.mjs` / `raycheck.mjs` | emitters, the inflate path, player physics, and the DDA the outline is drawn from |
| `shadercheck.mjs` | both backends compile and agree |
| `gamecheck.mjs` | G scenarios |
| `placecheck.mjs` | **what a placed block may destroy** (D-263): vanilla's `Material.isReplaceable` block for block against the bytecode, the seven Java overrides of `canBeReplaced` and their `stackOnto` partners, the old geometric rule re-run so it cannot return, and D-264's targeting gap measured and pinned |
| `gatecheck.mjs` | every stage of F and W maps to a check, every check is in the suite, every check can fail, every module is loaded by one |
| `doccheck.mjs` | the citations, the reading budget, the dangling references, the approximations |
| `structcheck.mjs` | determinism, no float/burial, cross-sections, cost — ⚠ **not written; owed before W14** |
| **browser-driven — ⚠ need Chromium, which is NOT on Dan's machine** | `--fast` skips all six |
| `titlecheck.mjs` | B1 + B2 in a real browser at `file://` |
| `smoke.mjs` | `file://` boot, no console errors |
| `cullcheck.mjs` | W12: culling changes the cost and never the picture, and a glowstone you place is a glowstone you SEE |
| `soakcheck.mjs` | flies 1,600 blocks **a million blocks from spawn** (D-148) and asserts the SHAPE of the samples: nothing stuck, nothing leaking, the queue draining, an edit still lighting correctly out there |
| `palettecheck.mjs` | screenshots, judged by `pngdec.mjs`'s `meanLuma` rather than by an in-page counter |
| `flashcheck.mjs` | the white-flash probe — ⚠ **written but never run against a live build**, so its 50% threshold is a starting point and not a validated fence (D-164). See §9 risk 9. It also closes a real coverage gap: `Settings.applyPreset` writes `S.renderDistance` DIRECTLY (`16_settings.js:218`) and can jump it by more chunks in one call than the slider ever does, but `cullcheck` §2e's sweep only ever calls `setRenderDistance` |
| **not tests** | |
| `bench.mjs` | the four hardware rungs |
| `build-gallery.mjs` | renders all 900 blocks and 1,100 items to look at → `gallery.html` |
| `pack-geometry.mjs` | binary pack + a decode-and-compare round trip |
| `gitsweep.mjs` | refuses to commit `assets/` or `mcdata/` — ⚠ **never written**; `.gitignore` and D-6 hold it instead |

**The anti-vacuity rule, from Dan:** *"test this ultra rigorously and make sure every test
does something."* Every suite must contain at least one deliberately broken variant that it
is asserted to catch. A test that cannot fail is not evidence, and `modelcheck` already
works this way — the other suites follow it.

---

## 9. Risk register

| # | risk | why it is plausible | mitigation |
|---|---|---|---|
| 1 | Worldgen data source disappears or the mirror moves | one host, one branch name | **Already cached locally**, 766 files. Never re-fetch during a build. |
| 2 | ~~The multi-noise parameter table stays unavailable~~ | ~~not on the mirror; the generator route is blocked~~ | **CLOSED, session 3.** It was on the mirror, in `dimension/overworld.json` — see D-112. 7,578 entries, packed, and asserted field-by-field against the source every run. |
| 3 | 15 MB ceiling breached | atlas 344 KB (b64) + structures ~1.5 MB + sounds unknown + code | G13 must report the running total **with base64's +33% applied**. Sounds are the variable; villages-only is the documented fallback for structures. |
| 4 | Parallelism breaks determinism | W11 is the classic place for it | The W11 acceptance test runs the same seed at worker counts 1, 2, 8 and demands byte-identical output. Async stays banned. |
| 5 | Terraced terrain rejects too many village sites | deviation #1 makes harder edges than vanilla | W17's suitability score is tunable; failing that, the beard budget rises. Measure the rejection rate before tuning. |
| 6 | Rotation and state bugs recur | they are live in MineHTML right now | F8's round-trip test, and Gate F blocks W on it. |
| 7 | WebGPU stays black | unexplained on an RX 6800XT | B1 makes WebGL2 the default so the failure is not on the critical path. Diagnose behind the menu. |
| 8 | Old-texture seam looks obvious | 283 of 1.18.2's 818 block textures have no 1.13.2 original, and the atlas actually falls back on **279 of the 781 tiles the roster requests** (`build-atlas.mjs` prints both) | The fallback list is generated and reviewable; if a specific block jars, it is one entry to hand-fix, not a redesign. |
| 9 | ✅ **CLOSED — and it had been closed for a whole session (D-249)** | the risk read "there is **no `webglcontextrestored` listener anywhere in `src/`**". There is one, at `12_gfx_webgl2.js:348`, and it is complete: it re-runs the entire init — shaders, index buffer, arenas, atlas, tint texture — and then calls `Gfx.onBackendRestored()`. **D-194 added it and this register was never updated**, which is how session 8 opened by naming a closed risk as the likeliest cause of the white flash. ⚠ The flash it was standing in for turned out to be `desynchronized: true` (**D-247**): a compositor-level substitution that no in-page instrument can see, because every one of them reads the buffer the ENGINE wrote | The flag is out and `shadercheck` §11 asserts the whole context-attribute set so it cannot return by accident; `lumacheck` §4 asserts `Gfx.contextLosses === 0` across its run, so a real loss cannot pass unnoticed either. ⚠ Still owed, and still true: **`Gfx.drawn` should be sourced from what the backend SUBMITTED**, not from list length |
| 10 | `Settings.load()` does not re-validate `fov` | the HUD clamps 50–110° but the localStorage replay is a `typeof` check only (`16_settings.js:327`), so a corrupted save with `fov: 0` loads unclamped | Traced: `aabbVisible`'s `dist` goes `NaN` and `NaN < 0` is false, so culling **fails open** and draws more, not less. Not the flash cause, and benign — but it is a validation hole, recorded so it is not rediscovered |

### The white-flash audit's ruled-out paths, so nobody enumerates them twice

Every path in `src/` that could collapse a frame was enumerated and checked against the
report. All of them are fenced except risk 9 above:

- **Dropping resident GPU meshes.** `Gfx.dropAll()` survives in exactly three callers, all
  deliberate: `Save.erase()` (player-initiated world reset), `Main.applyBackend()` (F9, the one
  place the code documents as legitimately losing its buffers, immediately followed by
  `World.remeshAll(true)`) and `Bench.start()` (offline only). D-162 removed it from
  `Settings.push`. A mass `World.evict()` cannot collapse a frame either — `dropMesh` is
  throttled by `flushUploads`'s `uploadsPerFrame`, so hundreds of evictions drain over many
  frames. Arena destruction is reachable only from a backend swap; `release()` only frees an
  already-empty arena.
- **The flood grid.** D-171/D-175 fixed the mechanism, not the call site: `floodHas` returns
  `true` (frustum decides) both outside the scratch grid and in the square's corner wedges, so
  it does not care who changed the render distance. Queue overflow would make isolated holes,
  not a frame-wide collapse.
- **Draw lists and pools.** The per-frame `list*.length = 0` is rebuilt in the same call;
  `_snapPool` feeds future mesh JOBS, never what is currently drawn; `dropMesh`/`flushUploads`
  replace in place, so no frame has a section with neither buffer.
- **The camera.** `aspect` is `Math.max(1, …)` before any divide, pitch is clamped short of
  gimbal, and D-149's Float64 planes already cover the far-from-origin case. `frozenFrustum`
  (F7) can cull everything if left on while flying far — that is what the debug key does.

---

## 10. Session protocol

1. Read `CLAUDE.md`, then `CHARTER.md`, then this file's §2 and the next unchecked stage.
2. Do **one stage**. Write its test **first**, watch it fail, then make it pass.
3. Run `tools/suite.mjs`. It must exit 0.
4. Commit. Update the checkbox here and `NEXT.md`.
5. Never re-litigate `DECISIONS.md` without Dan.
6. `C:\claudeisthegoat` (MineHTML) is **READ-ONLY**. A session may be running there.
7. Usage: stop at ~97% of the window; **never touch usage credits** (D-24).


---

## 11. Appendix — the data substrate, and where every fact comes from

Recorded so that no future session has to rediscover any of it, and so that a claim in this
plan can always be traced to a file rather than to a memory.

| source | on disk at | what it gives | how it was verified |
|---|---|---|---|
| `1.18.2.jar` (client) | wherever `tools/paths.mjs` finds it — `MCLITE_JARS`, `mclite.config.json`, or a launcher `versions/` folder; ⚠ never a hard-coded path | 900 blockstates, 1,725 block models, 1,235 item models, 861 block textures, 457 item textures, 421 entity textures, 63 GUI textures, 986 loot tables, 1,058 recipes, 270 tags, **866 structure `.nbt`**, `lang/en_us.json`, colormaps | `version.json` reads `id: 1.18.2`, `world_version: 2975`, `pack_version {resource: 8, data: 9}`, built 2022-02-28 |
| `1.13.2.jar` (client) | same | **the old textures** — 539 block textures, 527 of which the roster actually uses | set difference against 1.18.2 run in `build-atlas.mjs` |
| `misode/mcmeta`, branch `1.18.2-data` | `<root>/.mcdata/1.18.2/` (gitignored, `paths.mjs`'s `MCDATA`) | **the 766 worldgen files that are not in the jar**, and — session 3 — `dimension/overworld.json`, which carries the **compiled multi-noise climate table**: 7,578 parameter entries over 50 biomes (D-112) | 766/766 fetched, every file JSON-parsed on arrival, 0 failures; the dimension file re-verified field-by-field against the packed blob by `climcheck` |
| `misode/mcmeta`, branch `1.18.2-summary` | `_registries.json` | the exhaustive id list per registry — the reason the fetch is complete by construction | registry counts match §1.1's table exactly |
| `PrismarineJS/minecraft-data`, `pc/1.18` + `pc/1.17` | `<root>/.mcdata/pc/` (`paths.mjs`'s `MCDATA_PC`) | hardness, resistance, light, stack size, tools, materials, **898 blocks × 4,105 collision shapes**, items, foods, tints, attributes, enchantments, sounds, language, entities, biomes | `dataPaths.json` consulted for which version directory 1.18 actually resolves to per file — `foods`, `blockCollisionShapes` and `tints` map to `pc/1.17`, not `pc/1.18` |
| the launcher's asset store | `%APPDATA%\.minecraft\assets\objects/` + `indexes/1.18.json` | **the `.ogg` sound files**, which are in no jar | G13; not yet read |

**Not yet obtained, and named so it is not forgotten:**
1. ~~The compiled overworld multi-noise climate parameter table (W4's open item).~~ **Obtained,
   session 3**, from `data/minecraft/dimension/overworld.json` on the same mirror — see D-112.
   It is a third source in `fetch-vanilla-data.mjs` and is fetched by the same command.
2. The `.ogg` subset (G13).
3. Per-block `SoundType` assignments — ≈25 types over ≈880 blocks (G13).
4. Furnace fuel burn times — hard-coded in `AbstractFurnaceBlockEntity.getFuel()` (G9).
5. Mob AI goal lists, `NaturalSpawner`'s caps, pathfinding node costs (G18).

Everything else this plan needs is already on disk.

**Licensing (D-6):** all of it is Mojang's, obtained from Dan's own installation or from a
mirror of Mojang's own generator output. It stays local. `assets/` and `mcdata/` are never
committed to a shareable repo. ⚠ `tools/gitsweep.mjs` was to enforce that mechanically and was never written; `.gitignore` and D-6 are what hold it
rather than by good intentions.

---

## 12. Session 1 log — what was actually done, 6 September 2026

Written at the end of the night so the next session starts from facts rather than from this
plan's intentions.

**Done, with the measurement that proves it:**

| # | work | evidence |
|---|---|---|
| 2 | ⚠ Discovered `data/minecraft/worldgen/` is empty in the 1.18.2 client jar, which invalidated the first plan's whole W track | §1.1 |
| 5 | ⚠ Found and fixed the wall bug: domains inferred from multipart `when` clauses gave every wall 32 states instead of 162 | 23 blocks, **5,465 unreachable states → 0** |
| 7 | Derived the 6-bit occlusion mask and cross-examined it against collision | **1,738 disagreements → 0** |
| 8 | ⚠ Found and fixed the occlusion plane bug (15 instead of 16): nothing in the game could ever occlude upward | `fully-occluding 0 → 1,896 states` |
| 9 | ⚠ **Found and fixed the placement rotation**: it used the standard right-handed convention; Mojang's is the opposite. Every stair, trapdoor, torch, log, chest, furnace and door in the game was rotated the wrong way — and stone looked fine throughout | 4 ground-truth files, 30 assertions in `modelcheck` §11 |
| 10 | ⚠ Found and fixed one-of vs all-at-once: `variants` lists are RANDOM ALTERNATIVES. Every stone block was shipping four coincident copies of itself | `groupsFor()`; quads 125,153 → 119,911 |
| 12 | ⚠ Measured the per-state design at **11.8 MB** and redesigned to per-placement | **4.5 MB, 59.5% saved** |
| 15 | ⚠ Found and fixed: the seed typed at the title was overwritten by the saved one on the second boot pass | `titlecheck` |

**The binary pack, and the one field width worth remembering.** `tools/pack-geometry.mjs`
takes 4,528.9 KB of JSON to 1,890.4 KB of fixed-layout binary to **222.3 KB deflated, 296.4 KB
as base64** — the number D-12 actually counts. ⚠ Every field width is asserted against the
measured data before packing, which is how it was noticed that **positions run −118..374
sixteenths**: model geometry leaves the unit cube in both directions, so they are i16 and not
u8. The packer carries the engine's own reader and round-trips the whole thing before
reporting a number. Round-trip: identical.

### Session 1, continued — items and the gallery

| # | work | evidence |
|---|---|---|
| 17 | ⚠ Learned that ~135 files under `models/item/` are **not items** — templates (`generated`, `handheld`) and override frames (`clock_01..63`, `compass_00..31`, `bow_pulling_0..2`). Requiring layers or constants from them produced 141 phantom gaps | 0 unclassified, 0 missing constants |
| 18 | ⚠ Learned that a block item uses its **own inventory model**, not the blockstates entry — a fence item is `oak_fence_inventory` (one post, one arm), a trapdoor item is `oak_trapdoor_bottom`. Looking them up in the blockstates geometry reported 59 blocks as "missing" that were never missing | 531 baked 3D item parts, 4,450 quads, 0 missing |
| 19 | ⚠ Found one texture reachable **only** from an item model (`block/structure_block`, which no blockstate uses) and unioned it into the atlas | 809 → 810 textures, the last item gap closed |
| 21 | ⚠ Recorded the honest gap: **77 real items are two-layer TINTED sprites** whose colours are compiled Java — 67 spawn eggs, 4 leather armour, 3 potions, tipped arrow, firework star, filled map. They render grey, and `itemcheck` asserts the count so it cannot drift | flagged `needsTint`, noted in the gallery footer |
| 23 | ⚠ Two gallery bugs worth recording: rotating the whole grid instead of each block (a diagonal smear), and winding the item sprites clockwise so all 610 were emitted, counted, and then back-face culled — an empty page with a working tooltip | both fixed |

**Where G7 stands:** the item *data* is complete and proven; the item *renderer* exists only
in the gallery. Wiring it into the game's inventory is G8's job and depends on the same
engine work F8 is waiting on.

---

## 13. Session 1, third stretch — the roster reaches the engine

| # | work | evidence |
|---|---|---|
| 27 | ⚠ Its first run **hung for two minutes**: reading past the end of a corrupt stream decoded zeros forever. Bounds checks added at four places | the three anti-vacuity breaks now fire instead of spinning |
| 32 | ⚠ **Found a double-tint bug I had just introduced.** The first version baked the plains grass colour into the tiles — but the legacy blocks already carry a `tint` field the shader multiplies by, so grass and leaves were tinted twice. Invisible in the snow biome the smoke test spawns in | the textures stay greyscale; the existing tint machinery does its job, which is also what W5 needs |
| 33 | ⚠ **Vanilla spells the same texture two ways** — `block/stone` in one model, `minecraft:block/sand` in another. 676 of 810 atlas keys carried the prefix and 134 did not, and **43 of 57 legacy tile lookups missed because of it**. Normalised at the source | 810 keys → 781, and the three suites that hard-coded the old spelling caught the change |
| 34 | **Layer order is now an interface.** `build-atlas.mjs` reserves layers 0..56 for exactly the tiles `B.T` names, in `B.T`'s order — so one atlas serves both the legacy path and the model stream with no runtime remap | `tilecheck`, 185 assertions |
| 36 | ⚠ Wrote `x << 4` where the unit needed `x * 256` — every block at a sixteenth of its position, the whole world in one corner | caught by emitcheck's first run; now an asserted break |
| 40 | Workers decode the registry **on their own threads, in parallel** — 334 KB of bytes cloned instead of 2.3 MB of typed arrays | `regMs` in the ready message |

⚠ **WebGPU still ignores the model stream.** It renders a black world anyway (D-15) and is not
the default, so the stream was built on the backend that works. `11_gfx_webgpu.js` needs the
same second pipeline before WebGPU is worth returning to. Everything else this section listed
as "not done" — the roster in the world, occlusion driving the mesher — landed in session 2.
### Session 1, fourth stretch — the culling rule

| # | work | evidence |
|---|---|---|
| 43 | And proven **not vacuous**: **2,640 of 8,933 visual states occlude some faces but not all**, and every one of them is a face the boolean rule would have judged wrongly | section 4 |
| 44 | ⚠ Found the fluid case. `block/lava.json` is `{"textures":{"particle":"block/lava_still"}}` — a model with a group and **no elements**, so the derived mask is 0. That is "not described by a model", not "occludes nothing"; without the fallback every lava lake draws its own hidden interior | lava was the one block of the 49 that changed |
| 45 | ⚠ And found that the fluid test had to be the **quad** count, not the group count — lava has a group. The first fallback missed it and the same test said so a minute later | both are now asserted |
| 46 | ⚠ The registry↔mesher face translation reads backwards until you follow it through, and the first draft of the test got it wrong: a block whose only covered side is EAST culls the **−X** faces of whatever is to its east | six directions asserted individually, plus a mirrored-translation break |

**Suite: 26,533 assertions · 38 deliberate breaks caught · 0 failures.**

### Session 1, fifth and sixth stretches — WebGPU's model pipeline, and shadercheck

`11_gfx_webgpu.js` carries the same second stream the GL backend does: `vs_model` in the WGSL,
three model pipelines sharing the cube path's fragment stage and depth/blend state, its own
arena pool at 64 bytes a quad, and `drawSectionModels` / `endModelPass` with the same contract
as GL so the frontend needs no branch. ⚠ **It is written, not proven** — no WebGPU adapter in
the container, and Dan's card renders black on that backend (D-15), so none of it has drawn a
pixel.

Two lessons out of it, both about the SHADER TESTS rather than the shaders:

- ⚠ **The WGSL is assembled as an array of source lines, so an insertion changes what the line
  before it applies to.** Inserting the model shader between `'@vertex',` and `'fn vs_pos('`
  stripped `vs_pos` of its stage attribute and silently deleted the depth-prepass entry point.
  `shadercheck`'s entry-point test caught it.
- ⚠ **A test that fails when a file is merely REARRANGED is a test nobody trusts the third
  time.** The cross-backend constant check sliced the WGSL "from `fn fs_main` to whatever comes
  next"; adding `vs_model` between `fs_main` and `vs_pos` made the fragment slice swallow the
  whole model vertex shader and report a 38-constant drift that did not exist. The extractor
  now brace-matches a function BY NAME and asserts both that it found something and that the
  fragment slice holds exactly one function. For the same reason the pipeline count is
  asserted by NAME, not as a number — adding a sixth cube pipeline and forgetting a model one
  still fails.

**The substantive result:** `vs_model` in WGSL and `VS_MODEL` in GLSL cross-check for identical
bit decoding and identical float constants, the way the cube shaders always have (D-3, D-52).
The model stream cannot drift between the backends without a test saying so.

### Session 1, seventh stretch — collision against real shapes

`clip()` is the only collision primitive in the project and every movement goes through it. It
assumed each solid voxel fills its whole cell — true for the 49 legacy blocks, false for most
of the roster: a slab you cannot step onto, a player stopped in mid-air beside a fence.

The general path was added **beside** the old one, never replacing it. `Ph.shapeAt` returns
`Ph.FULL_CUBE` **by object identity** and `clip` tests that identity, so the common case runs
byte-for-byte the code it always did. `Ph.shapesForState` reads the real AABBs out of
`Reg.shapeOf` / `Reg.shapeBox` — 4,105 shapes at 1/1024 of a block, exact for every multiple of
1/16 vanilla uses.

⚠ **Two bugs, one in the code and one in the test, with identical symptoms — a `0` where a
distance was expected.** The real one: a box the probe had already PASSED was clamped to zero
distance and then won the "nearest box" comparison, so any shape with a box above the probe
stopped a falling player dead. Clamping is only meaningful when the probe is genuinely INSIDE
the box. The test's: two of its probe boxes started already overlapping the cell they swept
into, so `clip` correctly answered "you cannot move" and the assertion read it as a failure.
**The only way to tell the two apart is to check the geometry of the probe before blaming the
code.**

### Session 1, eighth stretch — the save format was not what the docs said

⚠ **`docs/NEXT.md` claimed saves were already name-keyed — "G14's whole point". They were
not.** Format v1 stored a raw `u16` block id per edit, which is safe only while the id table
never changes, and replacing that table is exactly what the generated 1.18.2 registry does. A
v1 save loaded against a different roster reinterprets every block silently: a cobblestone
house comes back as whatever now holds id 2, with no error and no way to notice.

**This is the most dangerous kind of wrong thing, because it was written down as already
handled. It was found by going to write the test the document asked for.**

Fixed by the name palette (`docs/ARCH.md` §13). A name this build no longer knows becomes
**air and is COUNTED** in `Save.unknownNames` rather than mapped onto whatever now holds that
number — losing a block is recoverable, a house made of the wrong block is not. `savecheck`
rotates every block id by 7 between save and load, the closest thing to what the registry swap
would do, and one deliberate break reproduces the v1 reading and asserts it lands on the WRONG
block, so the palette cannot quietly stop mattering.

⚠ **v1 saves are refused, not misread.** Anyone with a world from before that day lost it —
the right trade that early, and the last moment it would have been.

---

## 14. Session 1 — the crosshair learns the shapes, and four things that were not in the suite

Collision read the real AABBs while targeting still stepped whole cells — a half-finished state
with a specific way of being wrong: a player could *stand* on a slab correctly and *break* it by
aiming at the empty air above it, because two pieces of code disagreed about where the block is.
`src/14c_raycast.js` closes it: the DDA still finds the cell, but on a hit it asks
`Physics.shapeOf` for the boxes and, when the answer is not `FULL_CUBE` **by object identity**,
runs a slab-method ray/AABB test. A miss is not a hit — the loop carries on to the next cell,
which is what stops a ray dying on a fencepost it passed beside.

### ⚠ The defect it found, and why vanilla splits collision from outline

A fence's collision box is **1.5 blocks tall**. Unclamped, a ray from overhead reported a hit at
`y = 1.5` — a point the DDA had already travelled past, in a cell it had already rejected as
air. The crosshair would select a fence post *through* the block on top of it, at a distance
shorter than one already tested. **That is an ordering violation, not a cosmetic error**: every
consumer of the DDA assumes distances increase.

`hitShape` clamps each box to its own cell, which is why vanilla keeps collision shapes and
outline shapes apart — a wall's outline box is one block tall while its collision box is 1.5.
The clamp is a no-op on both horizontal axes for every shape in the registry and bites
vertically on the fence and wall posts: **3,533 of the 4,105 distinct shapes**, which is 21 box
shapes multiplied by the wall state space, and the clamped-off part sits in the cell above,
which the DDA visits on its own.

⚠ **The clamp changed what the identity test is FOR, and that is the sort of thing that quietly
rots.** Before it, `shape === FULL_CUBE` was a correctness claim as well as a cost one. After
it, the general path gives the same answer for a full cube — so the fast path is now purely a
cost claim, **and a cost claim that nothing measures is a comment.** So `Ray.shapeTests` counts
the slab tests a cast needed, and `raycheck` asserts it is **0** across 20,000 rays through a
world of full cubes: the anti-vacuity mutation for that line no longer changes any answer, it
changes the counter, and that is what catches it.

The outline had to follow, because outlining the whole cell while targeting the real shape is
worse than doing neither — the outline is what teaches a player where to aim. `Ray.selectionBoxes`
returns the same clamped boxes `hitShape` tests against (`Ray.UNIT_BOX` by identity for a full
cube, so the HUD's common path allocates nothing), and `raycheck` asserts the outline boxes are
EXACTLY the clamped collision boxes — 11,457 of them, none with zero volume, since a zero-volume
box draws as a flickering line. A block with no collision boxes at all (a flower) outlines as a
cube, because there is nothing else to draw and it is still breakable.

⚠ **Two of the three failures on its first run were the TEST being wrong**: the "wall" behind
the slab was given the same block id as the slab, so `shapeOf` made it a slab too and the ray
correctly hit nothing. That is the second time a fixture was built already-failing — physcheck's
probe boxes were the first — and **the pattern is identical both times: a fixture assembled from
one convenient constant instead of two distinct ones.**

### ⚠ A check that is not in `suite.mjs` is a check that does not exist

This is the section `tools/bench.mjs` cites, and it is the reason `gatecheck` now asserts that
every check in `tools/` is listed in `suite.mjs` and that every module is loaded by one.

`gencheck`, `gamecheck`, `smoke` and `bench` all existed, all passed the last time anyone ran
them, and **none of them was in the suite**. Three were broken:

- `gencheck` failed on its first run inside the suite with *"a fast leaf inside stone emits
  nothing at all"*. `M.cullMask()` derives its mask from `B.opaque`, and `B.setFastLeaves`
  **mutates `B.opaque` at runtime** (D-93). The mask was built once, under fancy leaves, where
  a leaf culls nothing — so with fast leaves on, every stone face touching a leaf was still
  emitted, into a block that was now a fully opaque cube. A canopy full of hidden interior
  faces: the option would have measured *slower* on the machine it was written for. The cache
  now records the flag it was built under and rebuilds when it changes, and `cullcheck` toggles
  fast leaves WITHOUT resetting and requires the mask to change on its own.
- `smoke` and `bench` had been broken since B2 for the same reason: the title screen sits in
  front of the world and **nothing generates until Play is clicked**, so a harness that loads
  the page and waits is waiting for something that will never happen. `smoke` then threw on the
  first undefined field and reported the least informative thing available — that `MCL` was
  missing, when `MCL` was right there with thirty-two members on it. Both press Play now.

### 14.1 The "before" baseline, captured while it still meant something

`docs/bench-before-roster.json` (and `bench-after-roster.json`) hold the full tables; only the
row worth reading twice is repeated here.

⚠ **They are SwiftShader numbers.** Headless Chromium rasterises on the CPU, so the fps column
is not an fps claim about anything and never will be — `bench.mjs` says so at the top of its own
source. What it measures honestly is the CPU side of the frame and the geometry actually
submitted, which are exactly the columns a roster swap moves.

| low preset | fps | mean | p95 | tris/frame | draws | occluded |
|---|---|---|---|---|---|---|
| occlusion **off** | 15.6 | 64.0 ms | 180.3 | 40,016 | 86 | 0 |
| occlusion **on** | 19.2 | 52.2 ms | 105.0 | 28,702 | 66 | 535 |

The visibility graph removes **28% of the triangles and 23% of the draw calls**, and cuts p95
from 180 ms to 105 ms. That is a property of the world and the camera path, not of the renderer,
so it is the one row that will read the same on a 2200G — and the first to re-run when far more
non-cube geometry gives the flood fill more to reason about.

### 14.2 ⚠ `B.hard` is SECONDS TO BREAK, not hardness

Found by `swapcheck` (since retired, §15.12) before the id swap was written, and it is the most
expensive unit mismatch in the project. A direct comparison of the legacy table against
`block-constants.json` reported 42 differences. They were not differences. `B.hard` is consumed
by the player as seconds — `P.breakProgress += dt / hard` — while `c.hardness` is Mojang's raw
hardness. Vanilla's conversion:

```
ticks   = hardness * (harvestable bare-handed ? 30 : 100) / speed     (speed 1, bare hand)
seconds = ticks / 20
```

Stone: `1.5 * 100 / 20 = 7.5 s`, exactly what the legacy table says. Dirt: `0.5 * 30 / 20 =
0.75 s`, also exact. **A swap that assigned `hardness` straight into `B.hard` would have made
every block in the game five times faster to break, while looking like a tidy simplification in
the diff.**

Two related findings kept: `Reg.defaultState[]` is a LOCAL index, not a global one — oak_leaves
is the witness, its vanilla default `distance=7, persistent=false` is the last of its fourteen
states and the packed value is 13, so `real = Reg.realFirst[bi] + Reg.defaultState[bi]`. And
`sculk` is a 1.19 block with **no 1.18.2 equivalent**, so it was named rather than given a fake
one; `short_grass` is 1.20's name for 1.18.2's `grass` and is aliased.

### 14.3 ⚠ The suite could only ever run on one machine — twice

Every tool began `const ROOT = '/home/claude/lowvox'`. Twenty-three of them, being synced to a
copy of the project where they could not run at all. Each tool now derives the root from its own
location. **This came back in session 5 in the same shape** — twenty tools defaulting to
`/home/claude/jars` and `/home/claude/mcdata` — and `tools/paths.mjs` is the permanent answer;
see `docs/JAR-INVENTORY.md`. ⚠ **A default that names one machine is a bug on the second one.**

⚠ The mechanical rewrite broke four files and the suite caught all four in one run: the injected
block landed inside a multi-line ternary in three of them and between `import {` and its own
closing brace in the fourth. That is the argument for doing this kind of edit with the runner in
the loop rather than by eye.


# 15. Session 2 log — 6 September 2026

Session 1 ended with the roster at the engine's door: 900 blocks decoded, packed, and reaching
every worker, an atlas that is an interface, physics and targeting reading real collision
shapes — and a world that could still only store 49 hand-written block ids. This session took
that wall down, and found five things on the way that had nothing to do with the wall.

## 15.1 The session opened on ten red stages, for a reason in no document

⚠ **A generated input that has to be KEPT is an input that can go missing.** Three build stages
— `merge-constants`, `extract-blocks`, `extract-items` — read a second dataset out of `<out>/pc/`
(PrismarineJS `minecraft-data`, the source of the 4,105 collision shapes, the loot tables, the
materials and the tints, D-31) and **nothing fetched it**. It had been downloaded by hand in
session 1 and the fact never reached a file, so D-6's reproducibility claim was false in exactly
the way D-6 exists to prevent.

`fetch-vanilla-data.mjs` fetches both halves now, and ⚠ **the pc half must resolve each
dataset's real version through `minecraft-data`'s own `dataPaths.json` rather than guessing**:
there is **no `pc/1.18.2` directory at all**, `blocks` and `items` live at `pc/1.18`, and
`blockCollisionShapes` and `tints` are still at `pc/1.17`. A guessed path 404s on precisely the
two files that matter.

## 15.2 ⚠ 122 blocks had hardness 0, and 79 of them should not have

`pc/1.18/blocks.json` reports **hardness 0 and resistance 0 for every block added in 1.17** —
the entire deepslate family, all sixteen copper blocks, the amethyst buds, smooth basalt, tinted
glass, the infested variants. Left alone, 79 full solid blocks are instant to break. Nothing in
the project would have said so; the number is only visible if something asks "is any full
diggable block still at hardness 0?", and nothing did.

Patched from `pc/1.19`, and the patch is *licensed* rather than assumed: the two datasets agree
on **658 of 658** blocks where 1.18 has any value at all, with the only differences being
unbreakable blocks moving from `null` to `-1`, an encoding change. `merge-constants` recomputes
that agreement every run and `constcheck` asserts it, so the day 1.19 diverges the build says so
instead of quietly taking the newer number. 43 blocks are left at 0 because that is their real
value — flower pots, TNT, lily pads, sea pickles, slime, honey, scaffolding, comparators.

## 15.3 ⚠ The harvest bracket: `NEXT.md`'s homework, answered by a field nobody had opened

`docs/NEXT.md` filed this as the one piece of homework inside the swap. Break time by hand is

```
seconds = hardness * (the tool can harvest it ? 30 : 100) / 20
```

and the bracket is vanilla's `requiresCorrectToolForDrops`, which is set in Java. `NEXT.md`
had ruled out `needsTier` (null for stone, dirt and oak_log alike) and `mineable/pickaxe`
(contains rails and ice, both of which drop bare-handed) and proposed the `needs_*_tool` block
tags as the least-bad proxy.

minecraft-data carries the real property, as the **presence of `harvestTools`**. Checked block
by block: stone yes, iron bars yes, coal ore yes, obsidian yes, cobweb yes; dirt no, oak log no,
rail no, **ice no, glass no** — including both blocks `NEXT.md` named as the ones a cheaper
proxy gets wrong.

It is proven rather than argued. With this bracket, the derived break time reproduces
`src/02_blocks.js`'s hand-written table **exactly** on all twelve blocks that previously
disagreed: stone 7.5 s, cobblestone 10, deepslate 15, coal ore 15, deepslate coal ore 22.5, and
the soils and woods unchanged. Twelve independent confirmations from a table typed out months
earlier by a person who was reading the game rather than the data. (D-102)

## 15.4 ⚠ Air is pinned to block 0, and it is load-bearing

`extract-blocks.mjs` sorted blockstate files alphabetically, which puts `air` at index 16. Once
a cell holds a registry real state, three zero-filled typed arrays — the section palette, the
mesher's 18³ scratch volume, and every neighbour-padding read — all mean "nothing here" by
holding zero. With air at 16, **state 0 is `acacia_button[face=ceiling,facing=east,powered=false]`**
and a chunk edge grows a wall of buttons.

Air is now pinned first and everything else stays alphabetical. `regcheck` asserts the whole
chain (block 0, `realFirst[0] === 0`, exactly one state, `toVisual[0] === 0`, occludes nothing,
and the remaining 899 still sorted) and breaks it deliberately to prove the assertion works.
(D-103)

## 15.5 `src/02c_states.js` — the table the swap actually needed

The world stores a real state; the hot loops need the same O(1) parallel arrays they always had,
20,344 entries long instead of 49. Every array is derived from `NS.Reg` at boot, on the main
thread and in every worker, in about 95 ms:

| field | from |
|---|---|
| `block`, `vis` | `realFirst`, `toVisual` |
| `opaque` | the material flag — glass is a full cube and is *not* opaque |
| `cull` | the 6-bit geometric occlusion mask, ANDed with `opaque`, with the no-model fallback |
| `faceCull` | the same mask in the other direction, for the model path |
| `emit`, `atten` | `Reg.emit`, `Reg.filter` |
| `hard` | `Reg.breakSeconds` — SECONDS, from hardness and the harvest bracket |
| `solid` | whether the collision shape has any box at all |
| `geom`, `alt1`, `multi` | full cube fast path vs the baked model stream |
| `layer` | the atlas alpha class, plus the short list vanilla keeps in Java |
| `anim`, `selfCull` | also Java-side, also short and explicit |

**1,683 real states are full cubes; 17,356 are models; 1,303 draw nothing.** By volume the world
is overwhelmingly the first group, which is why the greedy path still carries the frame.

Two derivations are worth naming.

**The render layer (D-105).** Vanilla's `RenderType` is assigned per block in Java and is in no
data file. Hand-writing it worked for 49 blocks and does not scale to 900. `build-atlas.mjs` now
measures an **alpha class per atlas tile** from the pixels — 0 opaque (every pixel a=255),
1 cutout (only 0 and 255), 2 blend — giving 449 / 272 / 47 across the 768 layers. A texture with
a hole needs the alpha test whatever a table says. On top of that sits the short explicit list of
blocks vanilla puts in the sorted pass despite opaque textures: stained glass, ice, honey, slime,
tinted glass, the portals. That list is Java's alone and is marked as such.

**Fluids (D-106).** `block/water.json` and `block/lava.json` carry a particle texture and no
elements, because vanilla draws fluids from a dedicated renderer that varies the surface height
per corner. Classified honestly, both are "no geometry" and a lake draws nothing. Each gets a
**fabricated full-cube part** appended past the registry's own — safe because a part number is
only ever used to read `partTiles`/`partTint`/`partShade`, never to index the registry.

`tools/statecheck.mjs` re-derives **every field of every one of the 20,344 states independently
from the JSON** — 262,462 assertions — and then does the thing that matters most on a swap: for
the 47 blocks the world used to hold, it compares the new tables against the old hand-written
ones. **417 fields identical, 15 named corrections, 0 surprises.** Four of the corrections are
places the old table was simply wrong about vanilla: grass block and cactus belong in the cutout
pass, lava self-culls, and air is not unbreakable.

## 15.6 The swap itself

Nine source files and eleven checks. `03_section.js` needed nothing — a palette entry was
already a `u16`. What changed: `04_worldgen.js` (names resolve to states; ore pairs built from
names), `05_mesher.js` (both paths), `07_world.js`, `08_lighting.js` via worldgen, `09_jobs.js`,
`14_player.js`, `14b_physics.js`, `14c_raycast.js`, `15_hud.js`, `16b_save.js`,
`workers/chunk.worker.js`.

Three things are worth writing down.

**The mesher has two paths and only two (D-104).** Full cubes take the greedy path; everything
else goes through the baked model stream. The old `emitCross` — two diagonal quads standing in
for a plant — is deleted, not deprecated, along with `legacyVisual()` and the 49-entry
`cullMask()` that had to be invalidated by hand whenever fast leaves toggled. A plant draws the
model vanilla draws because there is no second path for it to fall down.

**Random variants are hashed on WORLD position, resolved once per voxel.** Stone has four
alternatives (two textures × two rotations) chosen by position. Resolving them per face would
mean six hashes a voxel; resolving them in `unpack()` means one, stored in a third scratch
volume beside blocks and light. The coordinate is the world one, not the section-local one —
a local hash restarts the pattern every 16 blocks, which is a visible grid across any large
stone face.

**Fast leaves moved with everything else.** It used to mutate the 49-entry block table, and the
cull mask derived from it had to be invalidated by hand — a bug `gencheck` found once already.
`States.setFastLeaves` writes the cull mask directly, so there is nothing left to invalidate.

## 15.7 ⚠ Two real bugs the swap uncovered

**`packSection` masked every block id with `& 1023`.** A 10-bit mask and a 1,024-entry palette
lookup table, correct and invisible while the world held 49 ids. With 20,344 states, every state
above 1023 aliased onto another block. The world **generated, meshed, lit and drew** — it was
simply a different world, made of whatever `state & 1023` happened to name. No crash, no error,
no console warning. What caught it was `gencheck`'s block histogram: *trees were placed (0.0 log
per chunk)*, *ores: 0 of 16 variants present*, *ground cover: 1,794,162 cross blocks*. Three
numbers that are obviously wrong, in a check that only exists because somebody decided statistics
about the world were worth asserting.

**The model path never culled against neighbours.** A baked quad carries the direction whose
neighbour is allowed to remove it — vanilla's `cullface` — and nothing read it. Harmless while
the path drew five plants and a torch, none of which have a cullface at all. With 900 blocks in
the world, a floor of slabs draws its own hidden underside on every block: 512 invisible quads a
section, in the pass that cannot early-Z them away. Each cell now gets a 6-bit "which of my faces
does a neighbour cover?" mask, and both the counting pass and the emitting pass take it — they
must agree or the buffer is the wrong size, which is itself asserted.

## 15.8 The save format, v3

A name is no longer enough: a cell holds `oak_stairs` facing east, bottom half, not waterlogged,
and there are eighty of those. v3's palette is **name plus the block's LOCAL state index**, and
load resolves `realFirst[block] + local`. The local index is the right thing to persist — a
global state id moves the moment *any earlier block* in the registry gains a property, a local
one only moves if that block's own state space changes. v1 and v2 saves are refused rather than
reinterpreted, because their numbers indexed a table that no longer exists.

`savecheck` was rewritten to prove it the hard way: it **reorders the entire registry** between
save and load — every block's global state ids change — and requires every edit to come back as
the same block in the same state. It also shrinks a block's state space and requires the
out-of-range local index to clamp to that block's default rather than walking into the next block
along. Its three anti-vacuity cases include the v2 behaviour itself (resolve the name, drop the
local index), which lands on the wrong stair.

## 15.9 The bench: faster while drawing more

`tools/bench.mjs` against `docs/bench-before-roster.json`. SwiftShader, so `fps` means nothing
and the ratios mean everything.

| preset | tris/frame | draws | median | p95 | stalls |
|---|---|---|---|---|---|
| celeron **before** | 1,619 | 6 | 28.7 ms | 41.9 ms | 22.0% |
| celeron **after** | 925 | 3 | **21.0 ms** | **29.9 ms** | **2.1%** |
| low **before** | 29,504 | 69 | 39.8 ms | 100.2 ms | 61.1% |
| low **after** | 30,884 | 77 | **29.8 ms** | **80.5 ms** | **45.1%** |
| medium **before** | 86,417 | 210 | 56.3 ms | 182.5 ms | 84.1% |
| medium **after** | 98,590 | 234 | **50.0 ms** | **152.2 ms** | **75.7%** |
| high **before** | 172,740 | 370 | 66.1 ms | 250 ms | 85.4% |
| high **after** | 238,598 | 496 | 79.5 ms | 250 ms | 85.7% |

**The 2200G-shaped preset (`low`) got 20% faster at p95 while drawing more triangles.** The real
6-bit occlusion mask replacing the per-block `opaque` boolean, plus the model path finally
culling, more than pays for the geometry the swap added. At `high` the extra 38% of triangles —
plants with real models, grass blocks moved to the cutout pass, fluids drawing — costs what it
costs; that preset was already pinned at the cap before and after.

The occlusion A/B still holds: at `low`, occlusion culling removes **37%** of the triangles
(44,066 → 27,806) and 22 ms off p95.

## 15.10 ⚠ Sixty-one decision numbers pointed at nothing

`src/` and `tools/` cited decision numbers up to **D-93**. `docs/DECISIONS.md` documented
**D-1 … D-32**. Every citation from D-33 up — `(D-41)`, `(D-57)`, `(D-85)`, `(D-93)` — pointed
at a document that did not contain them. That is worse than having no numbers: a reader sees a
citation and assumes it is written down, so nobody checks.

All sixty-one are backfilled from what the code actually says, with the file that says it. Six
numbers are cited nowhere and are recorded as unused rather than invented. Eleven session-2
decisions are added as D-100 … D-110.

`tools/doccheck.mjs` now enforces it, and two other drifts that have already bitten this project:
**every `*check.mjs` in `tools/` must be listed in `suite.mjs`** (session 1 found four checks
living outside the runner, two of them silently broken), and **`build.mjs` must list exactly the
modules that exist**. It also caught six zero-padded citations (`D-03`, `D-08`) that a naive grep
would have missed.

## 15.11 `titlecheck` had never run on this machine

It began `import { chromium } from 'playwright'`. There is no `package.json` in this repo — D-6's
rule applies to `node_modules` too — so the check was un-runnable anywhere playwright had not
been installed by hand with a browser build matching the library version. It was the one red
stage in the suite that had nothing to do with the swap.

`tools/smoke.mjs` had already solved this correctly: spawn whatever Chromium is on the box with
`--remote-debugging-port` and drive it over the DevTools protocol with nothing but node's own
`http` and `WebSocket`. That harness is now `tools/cdp.mjs` and both files use it (D-109).

While rewriting it, `titlecheck` gained the assertion this whole session is about: it walks the
spawn column of a real running world and requires the ids to be **above anything the 49-id table
could hold**, and every one of them to resolve to a name. It reports what it found —
`deepslate sand stone water`.

## 15.12 Retired

- `tools/cullcheck.mjs` — its subject was whether the 6-bit mask agreed with the `opaque`
  boolean for the 49 legacy blocks. There are no legacy blocks. `statecheck` derives the mask for
  all 20,344 states and inherits cullcheck's one irreplaceable number: **how many visual states
  occlude some faces but not all** (2,640 of 8,933), which is what says the mask is worth having.
  ⚠ **The NAME came back in session 4 for a different check**: today's `cullcheck` is W12's
  browser-driven one — culling changes the cost and never the picture — and shares nothing with
  the retired file but its filename.
- `tools/swapcheck.mjs` — it existed to de-risk this swap before anybody wrote it, and it did its
  job: its "seventeen field differences" list is what turned into §15.3's twelve confirmations.
  `statecheck` §3 does the same comparison better and against every state.

## 15.13 Where the suite stands

⚠ **The running totals that used to be quoted here are gone** — §8 carries the one measured
number, and `tools/suite.mjs` prints it on every run. What session 2 established and is still
true: `smoke` boots the built file from a real `file://` URL, plays for thirty seconds, breaks
and places a block, reloads, and finds the edit still there; and every check in `tools/` is in
`suite.mjs`, which `doccheck` asserts.
## 15.14 F8's hand-written reference, and the four conventions it corrected

`tools/mesh-reference.mjs` is F8's acceptance test as PLAN §3 specified it: **23 block states,
184 quads, every position and every UV number typed out from the model JSON in the jar**, and
compared to the baked output exactly. Nothing in it came from running the pipeline it tests.

It did not pass on the first run, and what it found is the point of having written it. Four
conventions were stated wrongly in the reference's own header, and the disagreement is what
settled each:

1. **Rotated quads keep their SOURCE corner order, transformed.** They are not re-emitted in the
   canonical order for their new direction. For a `y` rotation the two happen to coincide, which
   is why it took `oak_log[axis=z]` — an `x` rotation — to show the difference.
2. **A face's own `rotation: r` shifts the UV assignment BACKWARDS.** Settled by
   `block/door_bottom`'s `down` face, the only 90° face rotation in the reference; `oak_log`'s
   180° one cannot tell you, because 180 is the same shift either way.
3. **`uvlock` is a shift of the same kind, and it runs opposite ways on `up` and `down`.**
   Confirmed on two models with different source UVs — `block/stairs`' full tile and
   `block/fence_side`'s 2×9 strip — so it is a rule about the assignment, not about the rectangle.
4. **`x` and `y` placement rotations have opposite sin signs, and an ELEMENT's rotation turns the
   other way from both.** Mojang builds its placement quaternion from `(-x, -y)`, and negating
   the angle flips the sin terms — which lands on a different pair for X than for Y. The
   discriminator was which of a horizontal log's two end caps carries the model's 180° face
   rotation: it is the north one, so `x: 90` sends up→north, not down→north. On a symmetric cube
   the positions are identical either way and only the texture rotation differs, which is exactly
   the kind of bug that ships.

A fifth thing it found is not a convention but a format fact: **baked positions are quantised to
1/16 of a model unit**, so a cross plant's 0.8 is stored as 0.8125.

Two further guards came out of writing it:

* Every rotated case ALSO states, by hand, which way each of its quads ends up facing. The
  reference derives the same thing from its rotation formula, so a wrong formula contradicts the
  hand-written list **before** the baked data is consulted at all — without which a reference and
  a pipeline that share a misconception agree happily. It caught two of my own typos immediately.
* Three anti-vacuity cases feed the matcher a reference with one number changed — a position
  moved one unit, a UV normalised by min/max, a cullface dropped — and require it to notice.
  A comparison that always finds a match is the easiest possible way to write this test vacuously.

## 16. W1 — the data loader

`tools/pack-worldgen.mjs` reads the 766 cached worldgen files — **1.5 MB of JSON across eleven
registries** — interns every distinct string AND every object key into one table, replaces each
with its index, minifies and deflates. The result is **37.8 KB**, 50.4 KB as base64 in the
shipped file, decoded in 51 ms per thread by `src/02d_wgdata.js`.

**DATA ONLY, and that is the design.** Nothing in either file evaluates anything. W2 ports the
noise, W3 the column function, W5 the biomes, W7 the carvers, W8 the features — each hand-written
against the numbers these carry. A generated evaluator would be a second implementation of
Minecraft hidden inside a build tool, and no test could read it.

### PLAN's acceptance test, and the sentence in it that had to be decided

*"every id referenced by any file resolves; count of dangling references is zero, and a non-zero
count fails the build."*

The hard part is what counts as a reference, because a `minecraft:` string in these files is one
of four quite different things, and the first draft of the packer got one of them wrong:

| kind | example | what happens |
|---|---|---|
| a reference into these registries | `minecraft:ore_diamond` | 1,321 of them; must resolve |
| an **NBT structure template** | `minecraft:village/plains/houses/plains_small_house_1` | 773 of them; resolved against the **jar**, not these files |
| a block id | `minecraft:deepslate` | 1,346; checked against the 900-block registry |
| a TYPE naming a Java class | `minecraft:sequence`, `minecraft:ore` | 6,128; nothing to resolve to — reported as a histogram |

⚠ **The first run reported 773 dangling references and every one of them was the checker being
wrong.** A template pool's `element.location` is not a pool reference: it names an `.nbt` file in
`data/minecraft/structures/`, a registry that lives somewhere else entirely. Checking them
against the jar instead turned 773 false alarms into 773 real cross-source assertions — and
those are the ones that matter for W15, because a village pool naming a piece the build cannot
load is a village with a hole in it.

`location` is also a spline node's key, where the value is a number. Two unrelated meanings for
one field name is exactly the hazard of a check driven by field names, so both are written down
in the packer rather than left to be rediscovered.

### What came out of it

| registry | entries | distinct types |
|---|---|---|
| noise | 60 | — |
| noise_settings | 7 | 32 |
| density_function | 23 | 25 |
| biome | 61 | 47 |
| configured_carver | 4 | 5 |
| configured_feature | 184 | 105 |
| placed_feature | 220 | 29 |
| structure_set | 17 | 2 |
| configured_structure_feature | 31 | 30 |
| template_pool | 126 | — |
| processor_list | 33 | — |

**The type histogram is the work list for the rest of Track W**, and `wgcheck` prints it every
run: 25 density-function types for W3, 105 feature types for W8, 29 placement modifiers, 5
carver types for W7. The most common are worth knowing now — density functions are mostly `add`
(36), `mul` (36), `noise` (18) and `cache_once` (18); placement is dominated by `biome` (183),
`in_square` (170) and `count` (114).

### `tools/wgcheck.mjs` — 842 assertions

The packer's dangling count is enforced at build time (it exits non-zero). This is the other
half: **the packed blob must decode back to exactly the JSON it was made from.** Section 2 walks
all 766 entries and **40,292 nodes** and compares structurally — keys, array lengths and numbers
by `Object.is`, so a decoder that lost precision on `2.9802322e-8` is caught rather than
producing terrain a few blocks out.

That precision matters more here than the interning does. The intern step replaces object KEYS
and string VALUES with indices from the same table; a decoder that confused the two would produce
plausible-looking objects with numeric field names, and nothing downstream would notice until W3
read `min_y` and got `undefined`. The first anti-vacuity case is exactly that.

Section 3 spot-checks the entries W2 and W3 read first against the game: sea level 63, min_y −64,
height 384, noise cell 1×2, sampling 80/160, the three `terrain_shaper` splines present and keyed
on `continents`, the noise router's 15 entries, and the four climate noises' octave counts.

⚠ One number in that section is worth reading twice: **vanilla's world column is −64..320, and so
is MC-Lite's** (D-5, twenty sections of sixteen). That was fixed long before this data arrived
and it is why the column function in W3 can be a port rather than a rescaling.

## 17. W2 — noise parity

`src/03b_noise.js` is Mojang's 1.18.2 noise stack, ported: Xoroshiro128++ with the 128-bit seed
upgrade, MD5 (because `fromHashOf("octave_-10")` seeds every octave), improved Perlin with the
16-entry gradient table, the octave stack, and `NormalNoise`. All sixty noise fields build in
**39 ms** per thread.

**This is the one part of worldgen that is not allowed to be clever.** The charter licenses
MC-Lite to deviate on worldgen and D-58's "middle path" takes that licence for the SHAPE of the
terrain. It does not take it here: every downstream table — the climate parameters, the spline
points, the surface rule thresholds — is lifted verbatim from Mojang's files and is written
against these exact numbers.

### Four things that are easy to get wrong and produce a working, wrong world

1. **An amplitude of 0 does not mean "an octave that contributes nothing".** It means the octave
   is NOT CREATED, so it draws no randomness, so every octave after it gets different numbers.
   `temperature`'s amplitudes are `[1.5, 0, 1, 0, 0, 0]` — four of its six octaves do not exist.
   Building them and multiplying by zero gives a different world that looks perfectly fine.
2. **The octave's seed name is the ABSOLUTE octave index**, `"octave_" + (firstOctave + k)`, so
   temperature's first is `octave_-10` and not `octave_0`.
3. **Mojang reads an MD5 digest as two BIG-ENDIAN longs**, while MD5's own output words are
   little-endian. Getting that boundary wrong gives a working, deterministic, completely
   different world.
4. **1.18.2's normalisation is `(1/6) / (0.1 · (1 + 1/(o+1)))`**, where `o` is the span between
   the first and last non-zero amplitude. Later versions replaced this with a variance-based
   computation using the measured Perlin standard deviation 0.2702247831245211. Using the later
   formula moves every threshold in every spline.

Each of those four is an anti-vacuity case in `noisecheck`, constructed so that it fails if the
mistake is ever made.

### The referee, and its honest caveat

PLAN asked for a statistical referee compared against *"published vanilla figures"*, chosen over
golden files because *"a golden file proves you match yourself"*. **There are no published
vanilla figures.** Mojang publishes the noise PARAMETERS — all sixty, and this project has them
— but not the moments of the fields they produce, and inventing a table and calling it
"vanilla's" would be worse than having no test.

So `tools/noisecheck.mjs` does four things that between them pin the implementation without one:

* **Exact parity where reference values exist.** MD5 against RFC 1321's own seven test vectors.
  Xoroshiro128++ against a **second implementation written inside the check** from the published
  algorithm — including the seed upgrade — so agreement is between two implementations rather
  than one with itself. 200 draws each for six seeds.
* **Analytic bounds.** Every octave stack has a computable maximum; no sample of any of the sixty
  may exceed it, and each must come within 8% of it over eight periods, or octaves are missing.
* **The invariant `NormalNoise` exists to provide.** Sixty fields with wildly different octave
  counts — from `temperature`'s two live octaves to `jagged`'s sixteen — must come out with a
  comparable spread, because every spline downstream is written against a normalised field.
  Measured: **sd 0.137 to 0.389, a 2.8x spread**, against an assertion of 6x. A wrong
  `valueFactor` blows that band open immediately.
* **Structural properties.** Mean zero within four standard errors — with the effective sample
  count taken as the number of lowest-octave cells covered, not the grid size, because Perlin
  samples are nothing like independent. Skew under 1. A smoothed histogram that is not
  multimodal. Determinism across two builds. And sensitivity to BOTH seeds: changing the world
  seed changes all sixty fields, and two noises with identical parameters and different names
  must not be the same field.

⚠ Each field is sampled at a step tied to **its own lowest frequency**, so every one is measured
over the same number of its own periods. A fixed block step would sample `temperature`
(period ~1024) eight times inside one hump and `cave_cheese` (period ~256) across many, and their
statistics would not be comparable — which is the comparison the normalisation section rests on.

### What would make it stronger

Sample `temperature` at a hundred known positions with a known seed **in the real game** and
paste the numbers in. That turns the referee into a parity test. It needs somebody with 1.18.2
open and it is in `docs/NEXT.md` rather than pretended away.

### Measured

| noise | live/total octaves | firstOctave | mean | sd | min | max | bound |
|---|---|---|---|---|---|---|---|
| temperature | 2/6 | −10 | −0.045 | 0.375 | −1.069 | 1.001 | 2.222 |
| vegetation | 2/6 | −8 | −0.023 | 0.235 | −0.702 | 0.707 | 1.693 |
| continentalness | 9/9 | −9 | −0.001 | 0.360 | −1.087 | 1.052 | 3.658 |
| erosion | 4/5 | −9 | −0.039 | 0.324 | −0.935 | 0.933 | 2.419 |
| ridge | 3/6 | −7 | 0.013 | 0.327 | −0.902 | 1.011 | 2.857 |
| jagged | 16/16 | −16 | −0.025 | 0.315 | −0.905 | 1.082 | 3.137 |

Every one lands where a normalised Minecraft noise should: centred on zero, spread about a third,
extremes near ±1. The climate parameter tables in `worldgen/biome` are quoted on exactly that
scale, which is the strongest circumstantial evidence available offline that the port is right.

## 18. W3 — the column function

`src/04d_column.js` gives every later stage the two pure functions it leans on: `height(x, z)`
and `climate(x, z)`. Surface rules ask for the height, biomes for the climate, features for
both, and structures for the height at four corners before they place anything.

### What is ported, exactly

* the five 2D climate fields and the **shift** that displaces their sample positions —
  `shiftX = offset.get(x/4, 0, z/4) · 4` and `shiftZ = offset.get(z/4, x/4, 0) · 4`.
  ⚠ Note the argument order: `shift_b` is `(z, x, 0)`, not `(x, z, 0)`. Using the same order for
  both makes the field symmetric under swapping x and z, and every continent in the world
  stretches along one diagonal. An anti-vacuity case checks four points for exactly that.
* `peaksAndValleys`, the derived `ridges` coordinate — the fold that puts a river down the
  middle of a continent.
* the cubic spline evaluator and all three spline trees with their clamps, out of
  `noise_settings/overworld.noise.terrain_shaper` and the `terrain_shaper_spline` nodes.
* the jaggedness term: `jaggednessSpline · half_negative(jagged.get(x·1500, 0, z·1500))`,
  **coupling 1.0** — read out of `sloped_cheese.json`, not a chosen number.

### What is calibrated, and the honest reason

⚠ The first attempt derived the surface in closed form and the algebra was right and the world
was wrong. Worth writing down, because the reasoning looks airtight until it meets the data.

`density_function/overworld/depth.json`, with the two old-world blending terms removed (they are
identity in a fresh world), is `y_clamped_gradient(-64 → 1.5, 320 → -1.5) + offsetSpline`, and
the router's `initial_density_without_jaggedness` is `4 · quarter_negative(depth · factor)`.
`factor` is positive, `quarter_negative` preserves sign, `4` preserves sign — so the surface,
where density crosses zero, is where **depth** crosses zero, and depth is linear in y:

```
1.5 − (y + 64)/128 = −offset      ->      y = 128 + 128 · offset
```

Correct, and it produces a world whose oceans sit at **y = 100 or so** and which has no water at all.
The reason is that `sloped_cheese` also adds `base_3d_noise`, and that term does not merely
roughen the surface — **it carries a large part of the vertical range**, scaled per column by
`factor`. High factor holds plains flat; low factor lets a mountain swing tens of blocks. Take
the 3D term away, which is precisely the expensive thing PLAN W0's deviation #1 was granted to
avoid, and the vertical scale goes with it.

So the offset-to-height map is MC-Lite's, anchored on the heights the real game puts things at,
with vanilla's splines supplying the entire shape — where the oceans are, where the coasts are,
which continents are mountainous, where the rivers cut. It is one table of seven anchors in one
function, and **if a future session measures vanilla's real mapping, that function is the only
thing that changes.**

The second thing that is MC-Lite's own is the terracing (D-59): heights pulled toward multiples
of eight by an amount that rises as erosion falls, smoothstepped so a terrace edge is a cliff
and not a staircase.

### The world it makes

Over 14,641 columns spanning 120 km:

| p1 | p10 | p25 | p50 | p75 | p90 | p99 | max |
|---|---|---|---|---|---|---|---|
| 39 | 46 | 49 | 65 | 72 | 96 | 160 | 241 |

**43.5% below sea level.** Deep ocean floor around y 40, coasts just above 63, hills in the
nineties, mountains past 150 in about 1.6% of columns. `colcheck` asserts that shape with
deliberately wide bounds — the claim is "this is a Minecraft-shaped world", not "these are
vanilla's exact percentiles", which nothing offline can establish.

### `tools/colcheck.mjs` — 53 assertions

PLAN W3's acceptance, both halves.

**Purity, in three sampling orders.** Row-major, column-major, and a deterministic shuffle with
an unrelated column sampled between every pair — the last of which is what catches a cache keyed
on the wrong thing. All three must agree bit for bit, and so must a fresh `init` of the same
seed. This is the invariant PLAN W0 says survives deviation #1 and gets stronger, and §7's
structure placement leans on it hard: a village decides where to sit by asking the height at four
corners, from a different chunk, on a different thread, possibly hours apart.

**ASCII cross-sections, reviewable without a GPU.** Three lines across the world at 2.4 km each,
printed with `--print` and shape-asserted either way: each must contain land, contain water, and
vary by more than 25 blocks over its length.

⚠ One assertion had to be rewritten because the real data could not test it. The evaluator
extrapolates past its end points along the end derivative rather than clamping — but **both ends
of the offset spline have derivative 0**, so extrapolating and clamping give the same answer
there, and a check written against real data alone passes either way. The mechanism is asserted
on a synthetic ramp instead.

### Where it is not yet wired in

`src/04_worldgen.js` still generates terrain from session 1's own height function. That is
PLAN's own sequencing, not an unfinished hand-off: W5 supplies the biomes and W6 the surface
rules, and swapping the height function in before those exist would give a correctly-shaped world
made of the wrong blocks. W6 is where the two meet.

---

## 19. W4 — the climate, and the toggle

Session 3. Two questions live in this stage and they are not the same question:

1. **What are the six climate numbers here?** — two answers, and the toggle picks.
2. **Which biome do those six numbers select?** — one answer, vanilla's, in both modes.

That split is the whole design. The biome LIST, and every biome's colours, features, mobs and
loot, are "everything else" under the charter and get absolute parity; what W4 is licensed to
change is where on the map each one lands. So Earth mode hands its answer back as vanilla's own
`temperature` and `humidity` axes and the dispatch is unchanged (D-115). The other four axes —
continentalness, erosion, weirdness, depth — are terrain *shape*, and pass through untouched:
**Earth mode does not move a single ocean, river or mountain.** It decides whether the mountain
has a glacier on it.

### The open item, closed

`MultiNoiseBiomeSource.Preset.OVERWORLD` had been open since session 1 and was risk #2 in §9.
It is built in Java, is in no jar, and is in none of the eleven `worldgen/*` registries the
fetch tool mirrors. It turned out to be on the same mirror the whole time, in a twelfth place:
**`data/minecraft/dimension/overworld.json`**, because the data generator writes the overworld
dimension out too and a dimension carries its `biome_source` fully expanded. 4.3 MB of JSON,
**7,578 entries over 50 biomes**, verbatim from Mojang's generator.

Worth recording that the third route this plan proposed — "derive it from the 61 biome files'
own `climate` blocks" — would have produced a **wrong table quietly**. Those blocks carry 1.17's
`temperature`/`downfall`/`precipitation`, which are the *rendering* climate, not these six noise
axes. Nothing downstream would have complained.

### What the table needed, and what was measured before building anything

| measurement | result | what it decided |
|---|---|---|
| are the entries' ranges exact multiples of 1/10000? | **all 106,092 of them** | quantising to i16 the way vanilla does is lossless here, not a rounding this build chose |
| how many queries land INSIDE a box? | 20,025 of 30,000 in one box, 143 in two, **9,832 in none** | the answer is the box *nearest*, never the box containing — a containment test would return nothing a third of the time |
| does a precomputed cell grid work? | **11.6% disagreement** over 200,000 queries (5×6×9×7×3×13 cells, filled by nearest at cell centres) | rejected. The boxes overlap on every axis, so a cell centre does not represent its cell |
| linear scan vs R-tree | **131 µs vs 1.1 µs** | the tree is not optional: a chunk asks 1,536 times, so 200 ms/chunk against 1.7 ms |
| R-tree build cost | **85 ms** | so it is **baked** (D-113), not built on the main thread and in every worker at every launch |

### Three bugs, and why each was invisible

**1. The depth axis put cave biomes on the surface.** `density_function/overworld/depth.json`
is `y_clamped_gradient(y) + offset`, and porting it literally is correct — for vanilla, whose
surface is at `y = 128·(1 + offset)`. MC-Lite's is not: deviation #1 dropped `base_3d_noise` and
W3 anchors the surface on `HEIGHT_CURVE` instead. Under that curve the literal formula lands
squarely inside the `[0.2, 0.9]` band the cave biomes own, and the top two surface biomes in a
2,000-column sample came out **lush caves (338) and dripstone caves (304)**.

The fix is not a fudge factor. Vanilla's own axis is algebraically `(surfaceY − y) / 128` — the
distance below the surface, in units of 128 blocks — and `climcheck` §4 asserts that identity
across 3,000 points rather than asserting the claim. That form is the one that survives
deviation #1, and every cave biome's depth band keeps its vanilla meaning: 0.2 is 25.6 blocks
down, 0.9 is 115 blocks down (D-114).

It was invisible because the world still *worked*: every column got a biome, the biome had a
name, and nothing threw. Only a histogram of what the surface actually selected showed it —
the same shape of catch as session 2's `& 1023`.

**2. Vanilla's temperature axis is not ordered by temperature.** Read out of the shipped table:

```
        H0 arid          H1              H2        H3                       H4
  T3    savanna          savanna         forest    jungle                   jungle
  T4    desert           desert          desert    desert                   desert
```

The hottest, wettest place in the game — jungle — is in band **T3**, and band **T4 is desert at
every humidity**. Vanilla's top temperature band does not mean "hot", it means "hot and dry"; it
conflates the two axes at exactly one corner. A separable map from physical temperature to that
axis therefore cannot work, and the first version of `04f_earth.js` proved it by mapping 26.5 °C
to 0.88 and **putting a desert on the equator**. The lookup is a real 2D Whittaker table now
(D-116), with aridity — `P / PET` — as the second axis, because 400 mm is a desert at 30 °C and
a forest at 0 °C.

**3. A mode can delete content without saying so.** Earth mode's first working version reached
**47 of 50 biomes** over 58,101 sampled columns. Two of the three were structural and are fixed:
`warm_ocean` needs the top temperature band, which the Whittaker table reserves for hot-and-dry —
but there is no evapotranspiration deficit over the sea, so water gets a straight
temperature-to-band map (`T_SEA`), blended in *below* continentalness −0.19 so that it stops
where the sea stops. (Ramping it across −0.19…0.03 — the coast and near-inland bands, both dry
land — put 301 desert columns within ten degrees of the equator, where the model had just
correctly worked out it was raining 2,000 mm a year.) The third, `wooded_badlands`, sits at
temperature band 4 with humidity band 3 — hot *and* wet — in a table whose band 4 is desert at
every humidity. No physically-ordered climate can be in both places at once. But inside that band
the humidity axis has no other job left: every middle biome there is desert and every ocean is
warm ocean, so all it still chooses is which badlands variant appears where the erosion and
weirdness are extreme enough for any. It is re-purposed there to mean what the biome's name says
— how vegetated the desert's margin is. All 50 are reachable in both modes, and `climcheck`
asserts it, because a mode that deletes a biome deletes its features, mobs and loot with it.

### The acceptance, both halves

**Off.** `climcheck` §3 is a **hand-written table** — `MIDDLE_BIOMES`, `MIDDLE_BIOMES_VARIANT`,
the plateau and badlands rows, the peak rows, the two ocean rows and the bands that ignore
temperature: 95 cells, typed out from the Java they come from, all reproduced. §1 checks the
other direction, all 106,092 packed numbers against the 4.3 MB of JSON they came from. That is
the mesh reference's method, and it is the only one under which a wrong packer and a wrong
reader cannot agree with each other and both be called right.

**On.** The pole-to-equator transect, as a median climate zone per five degrees of latitude:

```
  |lat|     0   5  10  15  20  25  30  35  40  45  50  55  60  65  70  75  80  85
  zone      4   4   3   3   3   3   3   2   2   2   2   1   1   0   0   0   0   0
```

Never a step backwards, spanning all five zones, with deserts and badlands **89% inside
12.5–37.5°** — the subtropical high, which is the latitude of the Sahara, the Kalahari, the
Atacama and the Australian interior and falls out of the zonal precipitation table rather than
being placed — and jungle **entirely inside 27.5°**. The ocean warms toward the equator on the
same ladder.

And the thing that makes the ordering test mean anything: **it is run against the vanilla mode
and required to fail.** A climate that does not know which way is north must not be able to
satisfy a latitude ordering. Six more anti-vacuity cases break the R-tree's bounding boxes,
flatten each zonal table, remove the sea map and switch off the lapse rate, and every one is
caught.

### One thing W4 found in W3

Wiring the biome dispatch to `Column.height` surfaced a contradiction nothing had looked for:
W3 clamped its height to `maxY` — the **320** vanilla's noise settings declare — while MC-Lite's
world is 20 sections and stops at **256** (D-19). Measured on seed 1337, **2 of 160,801 columns**
come out at y=256, one block above a world that cannot hold them. Two in 160,000 is exactly the
rate at which a bug reaches a player as "one mountain had its top sliced off" and never reaches a
test that samples a neighbourhood; `colcheck` now walks 58,081 columns for it and carries the
wrong clamp as an anti-vacuity case (D-117).

### What is wired, and what is not

The two world-creation settings are on the title screen beside the seed, disabled once a saved
world exists, carried in the save envelope, and read once by `Gen.init` on the main thread and in
every worker (D-111). `titlecheck` boots the built file **twice** — the second time clicking
`Earth` and a world-scale button at their real pixels on the real title screen — and requires the
world that comes up to be generating in Earth mode, with the parameter having reached the
workers, and to survive a save/load round trip. F3 shows the dispatched biome and, in Earth mode,
the latitude, temperature, rainfall and aridity behind it.

What is *not* wired: `src/04_worldgen.js` still places blocks with session 1's own height
function, so the biome this stage computes does not yet decide what the ground is made of. That
is PLAN's sequencing, not an unfinished hand-off — **W5** supplies the biomes' contents and
**W6** the surface rules, and W6 is where the column function, the biome dispatch and the ground
finally meet.

---

## 20. W5 — the biomes, and the four things that were not in the data

Session 3. The biome files were already in the runtime blob from W1, so this stage is mostly a
*reader*: 61 entries, indexed, with their colours resolved and their four data lists — `spawners`,
`spawn_costs`, `carvers`, `features` — handed on by reference. `biomecheck` asserts that
last part twice, once by object identity and once by a full deep walk of **7,499 values** against
the JSON on disk, because "survive into the registry unmodified" is a claim about bytes and G18
will be reading those lists two months from now.

What the data does *not* contain is the arithmetic, and all four findings are there.

### 1. The colour is three layers, not one

A biome's grass colour is: an explicit override if it has one (three biomes do — the badlands
family), else the colormap indexed by its own temperature and downfall, and then a *modifier*
(two biomes have one). Four biomes override foliage. Miss any layer and most of the world still
looks right.

The indexing is the part with four ways to be wrong — `i` and `j` swapped, the
`humidity *= temperature` step dropped, the clamp missing, the truncation rounded — and **every
one of them still produces a plausible green**. So the packer refuses to write the blob unless
plains comes out `#91BD59`/`#77AB2F` and desert `#BFB755`/`#AEA42A`, and `biomecheck` carries a
hand-written table of all 61 biomes' four colours typed from the game rather than read from the
pipeline. Both grass modifiers are checked against the formula rather than against themselves:
dark forest's `((c & 0xFEFEFE) + 0x28340A) >> 1` — Java adds before it shifts, and the mask stops
the sum carrying between channels — and the swamp's, which ignores the biome's colour entirely
and picks one of two greens from a noise.

### 2. A second, older noise stack (D-118)

That swamp noise is `PerlinSimplexNoise` seeded from `LegacyRandomSource(2345)` — plain
`java.util.Random` and Mojang's `SimplexNoise`, neither of which 1.18 migrated to Xoroshiro. Two
more like it decide the height-adjusted temperature (`1234`) and the frozen-ocean patchwork
(`3456`, three octaves). So `03b_noise.js` now carries both stacks, and the old one is verified
against the JDK's own published outputs: `new Random(0).nextInt()` is −1155484576, the next is
−723955400, and `nextDouble()` is 0.730967787376657.

⚠ All three seeds are **constants**, not the world seed. Every world's swamps are mottled in the
same places relative to the origin. That looks like a bug and is vanilla.

### 3. `features` is not always eleven long

Mojang's generator truncates trailing empty decoration steps, so `end_barrens` has zero,
`the_end` five, `basalt_deltas` eight and the Nether biomes ten, while every overworld biome has
all eleven. The first draft of `biomecheck` asserted eleven everywhere and failed on ten biomes.
The fix is `Biomes.featureStep(i, step)`, which returns an empty list past the end — **not**
padding the array, which would edit data this stage is required to pass through untouched. The
same ten biomes are the ones whose fog is not `#C0D8FF`, and `the_void` is on the overworld side
of both lines despite never being selected.

### 4. The frozen-ocean modifier makes the water *warmer*

`temperature_modifier: frozen`, on the two frozen oceans, forces the temperature to **0.2** where
two of those fixed-seed noises agree — and 0.2 is *above* the 0.15 that decides rain from snow.
It fires on 49% of a frozen ocean, and that is what leaves open water in one. A port that read
it as "make it colder" would look right in a screenshot and behave backwards in every rainstorm,
so `biomecheck` asserts both that some of a frozen ocean is warm enough to rain and that not all
of it is.

### What a human can look at

`dist/biomes.html` — all 61 biomes, every colour each one carries as a labelled swatch, and both
colormap triangles drawn with a mark on the grass ramp for each of the 47 overworld biomes that
uses it. It is the same idea as `gallery.html` and `gencheck`'s cross-sections: an assertion can
prove a colour is *correct*, and only a person can say whether it looks right.

---

## 21. W6 — the surface rules, and the seam where three stages meet

Session 3. W6 is the stage where the new world replaces the old one, and it is one stage rather
than three because each of its parts is unusable alone: `Column.height` without the surface rules
is a correctly-shaped world made of stone, the surface rules without the biome dispatch put a
desert's sand on a taiga, and the tint without either paints a jungle's green onto ground that is
still generated from session 1's twelve-value enum.

The interpreter itself is small — 4 rule types and 11 condition types, ported straight from
`SurfaceRules` — and almost none of the work was in it. The findings below are all about the
things around it.

### 1. ⚠ `above_preliminary_surface` reads the TERRAIN, not the rules

Ten of the overworld's rules hang off this condition, and the name is misleading: it is not "am I
above the surface I have generated so far", it is a **second, cheaper height field** that vanilla
computes for exactly this purpose — the noise sampled on the 8-block cell grid, floored, minus a
slack, bilinearly interpolated across the cell, then offset by the column's own surface depth.

MC-Lite reconstructs it from `Column.height` the same way (`minSurfaceAt`: bilerp of
`floor((height − 8) / 8) · 8` at the four corners of the 16-cell, plus `surfaceDepth − 8`). Two
consequences fall out of it, and both were found the hard way:

* **A check cannot invent a surface height.** `surfcheck`'s first draft fed the interpreter
  made-up column heights and asserted the resulting stack; four biomes came out solid stone,
  because the condition looked at real terrain that was nowhere near the invented number. The
  check now finds REAL columns by height band (floor 40–56, above 64–95, slope 120–150, peak
  140–240) and asserts the stack those columns actually produce.
* **It is what makes the guard possible.** Because the condition is a pure function of position
  rather than of the rules' own progress, the whole tree can be analysed once per column.

### 2. The cost, and the two things that pay for it

A naive port evaluates the rule tree for every block in the column: 82,000 evaluations per chunk
at 0.35–0.9 µs each, which is 30–70 ms of surface rules on top of everything else and would have
made W6 the slowest stage in the generator by an order of magnitude.

Two optimisations take it to about 7,000 evaluations per chunk, and measured chunk generation to
**10.5–13 ms** end to end:

* the **guard** — the highest y at which any branch of the tree can fire, computed once per
  column from the tree's own conditions. Everything above it is air by construction.
* the **const run** — the tree's constant tail. Below the preliminary surface the overworld tree
  reduces to a single answer (deepslate from −59 up to `minSurface − 1`), and that range is
  filled with one loop and no evaluations at all.

⚠ The guard analysis picked the *bedrock* branch on its first run, because that branch's span
starts at negative infinity and compared as the largest. The low end is clamped to `minY` before
the spans are compared.

### 3. ⚠ TWO INDEX SPACES, and every chunk came out one biome

The climate table dispatches to **50** biomes; the registry holds **61**. Both are arrays of
biomes, both are indexed from zero, and neither one is a subset of the other in order. For one
debugging round the world generated a single biome everywhere, because a table index was being
used to look up a registry entry and the two happened to disagree almost everywhere.

The fix is `Climate.bindBiomes(Biomes)`, which rewrites the packed table's `bio[]` from table
indices to registry indices once at init — so the hot path pays nothing — and
`biomeOfTarget` **throws** if it is asked before that has happened. There is exactly one biome
index space in the running game, and it is the registry's (D-100's rule, applied to biomes).

The same class of bug, one layer down: `WG.names('biome')` returns bare registry ids (`plains`)
while every other file that names a biome — the climate table, the surface rules' `biome_is`
lists, the dimension JSON — writes `minecraft:plains`. `Biomes.names` is now namespaced always,
and a reachability check that had been silently matching nothing started matching everything.

### 4. The tint seam is a TEXTURE, and one texel is four blocks

D-121's design, built. Grass, foliage and water were three constants in `10_gfx.js`'s
`SHADE.TINT`, selected by a 2-bit vertex field; they are now three layers of a 256×256 RGBA8
array texture covering 1,024 blocks of world, filled one 4×4 patch per chunk as chunks arrive and
re-anchored when the player nears the edge (about once every 256 blocks of walking).

The reason it is a texture and not a per-vertex colour is measured rather than assumed: the
greedy vertex is two `uint32` with three and two spare bits, so a per-vertex RGB needs a third
word — +50% on the vertex memory of the format that carries almost all of the world by volume,
for a colour that changes once every few hundred blocks. The texture costs nothing per vertex
because the shader already reconstructs world position, and **bilinear filtering across the
4-block grid is the border blend**, done by the texture unit rather than by the CPU.

⚠ **One texel is four blocks, and that is not an approximation of vanilla — it is vanilla's own
resolution.** Biomes are stored and sampled at quart resolution, so a finer map would be
interpolating between duplicated values.

### 5. ⚠ The half-texel offset that was exactly backwards (D-122)

The first version of the sampling expression carried a `+ 0.5` and a confident note explaining
that without it the sample would read the corner of the texel and shift every biome border two
blocks north-west. `tintcheck` did the arithmetic on its first run and the offset was the thing
causing that shift, not preventing it.

`wp` is a VERTEX position, so it is a block corner. Quart cell *k* spans the continuous range
`[origin + 4k, origin + 4k + 4)` and its centre is `origin + 4k + 2`; a texel's centre in texture
space is `(k + 0.5)/N`. The single requirement is therefore

    uv(origin + 4k + 2) = (k + 0.5)/N    =>    uv(p) = (p − origin) · 0.25 / N

with no offset at all — and then a vertex at a cell boundary lands exactly halfway between two
texels, so the crossfade between two biomes is centred on the border rather than sitting two
blocks to one side of it. `tintcheck` §7 asserts both halves of that, at 601 cell centres and 601
boundaries, and its anti-vacuity section puts the `+ 0.5` back and requires the miss to be
exactly two blocks.

This is the clearest case yet for the rule that every check does arithmetic rather than
inspection: the code was wrong, the comment above it argued for the wrong thing in detail, and
the screenshot looked fine.

### What a human can look at

`gencheck --print` for the surface stacks as cross-sections, and the game itself: a jungle's
leaves now render `#30BB0B` and its grass `#59C93C`, against a badlands' `#90814D`, with the
border between two biomes a gradient four blocks wide rather than a line.

---

## 22. W7 — the carvers, and the four things a cross-section showed that no number did

Session 3. 1.18 makes caves out of two unrelated systems and MC-Lite now has both: the NOISE
fields, which deviation #1 made MC-Lite grow itself because they used to live inside vanilla's
density stack, and the CARVERS, which are data — three configured carvers, carried by all 50
overworld biomes, driving a random walk of ellipsoids. Session 1 had only the first, which is why
its caves were a tangle with no long tunnels, no rooms and no way out.

### 1. The invariant decides the architecture, not the other way round

W0's rule for deviation #3 is that *a carved cell is carved identically from any approach
direction*, and that single sentence rules out the obvious implementation. A tunnel is up to 240
blocks long, so "carve this chunk's carvers" is not a thing that can be done chunk by chunk: the
chunk being generated does not know what its neighbours are about to send into it.

Vanilla's answer, and MC-Lite's: **to carve chunk T, run the carvers of every chunk within range
of T and keep the part that lands in T.** Each source chunk's walk depends only on (seed, source
chunk), so T's result depends only on (seed, T) — whatever order the chunks are generated in, on
whatever thread, in whatever session. `cavecheck` §3 generates a 5×5 block row-major,
column-major and shuffled and compares every block of every chunk; §4 reaches one chunk from the
north, the south, the east, the west and spiralling inward and does the same.

### 2. The cheapening is the 288 wasted generations, and nothing else (D-123)

With a range of 8, vanilla regenerates each chunk's entire random walk **289 times** — once per
target chunk that might receive part of it — and throws 288 of them away. MC-Lite generates each
source chunk's walk once, files its ellipsoids under the target chunks they touch, and caches
that. A cache hit and a cache miss produce the same numbers, which is not an argument but an
assertion: `cavecheck` empties the cache in the middle of a run and requires the chunks that
follow to match the ones that came before.

⚠ **That is the whole of the cheapening.** The range is vanilla's 8, the tunnel counts are
vanilla's triple-nested `nextInt`, the radii and the floor levels come out of the JSON. None of
deviation #3's licensed shortcuts — fewer tunnels, a smaller range, a coarser lattice — turned out
to be necessary once the wasted generations were gone. Measured: **0.3–0.9 ms per chunk**, on a
chunk that takes 7.5 ms in total.

### 3. ⚠ What is NOT vanilla: the random sequence, stated plainly (D-124)

Every other stage in track W is checkable against a file. The carver algorithm is not: it is
compiled Java, and nothing in the jar states the order in which it draws its random numbers. A
port claiming sequence parity would be making a claim no test in this project could grade, so
MC-Lite does not make it. The CONFIGURATION is vanilla's, field by field. The SHAPE is vanilla's.
The SEQUENCE is MC-Lite's own PRNG, seeded per source chunk — and the invariant needs only that
the sequence be a deterministic function of the source chunk, which is exactly what `cavecheck`
proves.

### 4. Caves reach daylight for the first time (D-127)

Session 1's caves removed `stone` and `deepslate`. Vanilla's carvers remove **38 block states** —
dirt, coarse dirt, rooted dirt, podzol, grass block, mycelium, sand, red sand, gravel, both
sandstones, snow, packed ice, calcite, tuff, dripstone and all seventeen terracottas. The
difference is not a detail: with only stone and deepslate carvable, every cave in MC-Lite was a
sealed pocket, because the layer of dirt and grass over it was not something a carver could touch.
There had never been a cave entrance in this game. There are now — `cavecheck` measures **3.8% of
land columns** open within three blocks of their own surface.

⚠ And pointedly NOT ores, which is also vanilla: a tunnel through a vein leaves the vein hanging
in the air, which is how you find one.

### 5. ⚠ Two bugs that were invisible in every number and obvious in a picture

**The cathedral (D-125).** A ravine cannot be one ellipsoid, because its width table is indexed by
y and a node has one radius for its whole height. The first draft emitted a full-width disc at
every y — which is a CYLINDER, and with the canyon's `yScale` of 3 it turned a 20-block ravine
into a 45-block-tall, 50-block-wide box with a flat roof. Every number being measured at the time
was inside its band. The fix is one `sqrt(1 − ry²)`: each disc takes the ellipsoid's own profile,
and the table goes back to doing the only thing it is for, which is scalloping the walls.

**The drowned world.** `cavecheck`'s first volume sample was a 6×6 block of chunks, which is 96
blocks across — and the fake aquifer's noise has a wavelength of about 520. So the sample sat
entirely inside one aquifer region, measured "0.00% air below y=−32", and reported a world flooded
to the bedrock. It was a sample smaller than the thing it was sampling. The sample is now
scattered over 400 blocks, and the number it reports is **carved** rather than **air**, because a
carved cell under the water table is water and under y=−56 is lava, and measuring air alone calls
a flooded cave system "no caves at all".

Both of these are the argument for `gencheck --print` and for `--print` on every check that can
draw: an assertion proves a number is inside a band, and only a picture shows that the shape is
wrong.

### What a human can look at

Walk into a hillside. There should be a hole in it — that is new. Then find a ravine: they are
1% of chunks, they are a slot rather than a canyon-shaped room, and they open at the surface.

---

## 23. The render audit — five bugs, and why 554,000 assertions did not find one of them

Session 3, between W7 and W8, on Dan's instruction:

> *"im trying to play the game and a lot of block faces arent loading are are invisible, their
> are wrid walls in the deserts, do thorough audits of reach pervious stage before w8"*

Both symptoms were real. Neither had one cause, and none of the five defects was inside a stage —
every one of them was in a JOIN between stages, which is exactly where a suite of stage-local
assertions has no coverage at all.

### 1. ⚠ Every single-sided model face in the game was inside out (D-133)

The headline. Mojang's baked element corners wind the opposite way from MC-Lite's shared index
ramp, and the pipeline culls back faces, so **grass block tops, slabs, stairs, carpets and cactus
have all been drawn inside out — and therefore invisible — since the model stream landed in
session 2.** Cross-shaped plants survived, because a cross is two planes emitted twice, once each
way, so one of the two always faced the camera.

That is why the world looked the way it did: a field of grass tufts and flowers standing on
nothing, with the sky visible between them.

⚠ **`emitcheck` compared every emitted corner against the baked source, 120,000 times, and passed
throughout.** An inside-out quad has exactly the same four corners as a correct one. The check now
derives each quad's normal from the winding the GPU will see and requires it to point the way the
quad's own face says — and, in the same loop, asserts that the bakery's own corner order comes out
inverted, so the reversal cannot be quietly undoing something that was already right.
`gencheck` got the same assertion for the greedy corner table, which was correct and had never
been asked.

### 2. The desert walls were the carvers, from that morning (D-129)

`WorldCarver.getRange()` is **four**; the chunk loop in `applyCarvers` is **eight**. W7 used eight
for both, so every tunnel ran 240 steps instead of 112. A tunnel's pitch decays toward level, so
it holds its height for its whole length — and a 240-step tunnel that clipped a flat desert
stripped a two-hundred-block open TRENCH through it rather than leaving an entrance. The walls
Dan saw were the sides of the trench. Surface columns cut open by more than three blocks:
**6.93% → 0.90%** over the same 128-block square.

### 3. A graphics preset deleted the ground (D-130)

`Settings.crossModels = false` gated the entire model pass. D-56 gave that setting its name when
the pass carried tufts and flowers; session 2 made every block a real registry state and put
**4,573 occluding states** on it — every slab, stair, carpet, cactus, and `grass_block` itself,
whose side overlay is a second element. From then on the **Celeron preset** — the one a low-end
machine detects, and the 2200G is the real target — removed the surface of the world.

The setting now drops DECOR, derived rather than named: model geometry that covers no face of its
own cell and is not opaque by material. A flower is decor; a slab is not.

### 4. The draw list ignored half the geometry (D-131)

A section was put in a layer's draw list by its GREEDY quad count alone. With the world made of
real states that is no longer the same question: a forest section under `fancyLeaves: false`
carries its cube quads in the opaque layer and hundreds of model quads in the cutout layer, so
`quads[1]` is zero and the section never entered the cutout list. Measured on ordinary terrain:
**8 model-only layers over 68 sections, 2,854 quads** the old rule threw away.

### 5. Model quads were lit from inside their own block (D-132)

The greedy path always took the light of the cell a face looks INTO. The model path took the light
of the cell the block stands in — which is 15 for a plant standing in air, and **0 for a grass
block**, because an opaque block has no light inside it. Every grass block that did get drawn was
black.

### ⚠ What this says about the suite, which is the part worth keeping

At the moment Dan reported it, the suite ran **554,142 assertions with 126 deliberate breaks and
zero failures**, and every one of those numbers was honest. The generator was right, the mesher
was right, the state tables were right, the shaders were right. What no assertion in the project
did was **look at the picture**.

So two things were built, and they are the lasting part of this audit:

* **`tools/facecheck.mjs`** — real terrain, meshed under *every quality preset*, asked the one
  question the suite had never asked: is there a face between the player and the sky? It also
  holds the decor rule, the model-stream light contract, and the measurement that proves the
  draw-list bug was reachable rather than merely possible.
* **`titlecheck` now photographs the running world and asserts what is in it.** The player is put
  eighteen blocks above the ground looking straight down; the frame must not be sky, and must not
  be black. `tools/pngdec.mjs` is what turns the screenshot into pixels.

⚠ **A stage-local assertion cannot see a join.** Four of these five bugs were invisible to any
test that did not run the whole pipeline and then look at the result — and the fifth, the winding,
was invisible to a test that compared against the right data in the wrong question. That is the
lesson, and it is more valuable than the five fixes.

### What a human can look at

Stand in a plains. There should be grass under your feet, tufts and flowers in it, and no sky
between them.

---

## 24. W8 — the features, and the fix that was built, measured and thrown away

W8 is the stage where the world stopped being terrain and started being a place: trees with the
right trunk and foliage placers, flowers in the grass, springs in the hillsides, kelp and coral
in the sea, geodes and dripstone underground, and every ore where vanilla puts it. Almost none
of that is code — **184 configured features and 220 placed features are DATA**, already packed by
W1 — and the whole of W8 is the interpreter that honours it plus 32 generators that do the
writing.

### 1. The acceptance test splits in half, and saying so is the point

PLAN W8 asked for *"ore-per-chunk histograms compared to vanilla's published distributions"*.
That request cannot be met whole, and `featcheck` says which half it is meeting.

The **distribution** is decided by the height provider in the JSON. `ore_diamond` is a trapezoid
from y=-80 to y=-38 with plateau 0, so its mode is at -59, and that number is a property of the
data rather than of the implementation. `featcheck` samples the placements and asserts the peak
exactly — diamond at -59, copper at 48, coal at 93, gold at 8. Those are parity assertions in
the strict sense.

The **absolute count per chunk** is not. It depends on the blob algorithm — how many blocks a
`size: 9` vein actually writes into stone that is already there — and that algorithm is compiled
Java that nobody here can read. So the counts are asserted for shape and order (coal above
copper above iron above redstone above gold above lapis above diamond, and blob volume monotone
in size) and the gap is written into the check's own output. ⚠ **Mine over-generates the rare
ores by roughly 3-4x** — diamond 12.5 a chunk against vanilla's ~3 — and that is a NUMBER IN THE
GAP TABLE, not a passing test. It closes when somebody samples a hundred chunks in the real game
and pastes the counts in, exactly as W2's noise referee is owed.

### 2. The architecture is W7's, and the one sentence that makes it work (D-136)

W7 established that a chunk is carved by asking every chunk in range what it sends into this one.
W8 inherits that and adds one split: **the SOURCE chunk decides WHERE and the TARGET chunk
decides WHETHER.**

Placements — the positions a feature's modifier chain produces — are a pure function of (seed,
source chunk) and are cached. The GENERATOR is re-run per target, because what a feature writes
depends on what is already there: an ore blob replaces stone and leaves a diamond standing, a
tree stops at the first solid block. So a tree whose trunk is in one chunk and whose crown is in
the next is generated twice, once from each side, and both halves must agree.

That agreement is the contract's load-bearing clause, and it is a purity requirement on every
generator: **draw every random you need BEFORE any block read.** A generator that reads a block,
branches on it and then draws a random has a different rng stream in the two chunks, and the
crown grows in one and not the other. It is stated in `Features.api`'s header, it was in every
sub-agent's prompt, and `featcheck` section 3 is what proves it — four approach directions, byte
for byte.

### 3. ⚠ Two deviations that are deliberate, and both are about a number a player can see

**D-134 — a `heightmap` modifier reads W3's column function, not the chunk's live heightmap.**
Vanilla recomputes its heightmaps as each feature is placed, so a flower placed after a tree sees
the tree and sits on top of it. MC-Lite evaluates every heightmap query against the terrain
BEFORE any feature ran. That is not a shortcut taken to save time; it is what makes the
architecture above possible at all, because a source chunk's placements have to be computable
without generating that chunk's blocks. The cost shows up as a flower occasionally standing where
a tree now is.

**D-135 — `below_top` resolves against THIS world's top.** Vanilla's noise settings declare
-64..320; MC-Lite's world is -64..256 (D-19). An ore that runs "from y=136 to the top of the
world" runs to 255 here. Resolving against 320 and discarding whatever landed above 255 would
keep the SHAPE of the distribution and throw away a third of the ore; resolving against our own
top keeps the DENSITY. A player notices density. `above_bottom` and `absolute` need no such
choice, both worlds having the same floor — which is why the diamond trapezoid still peaks at
exactly -59.

### 4. ⚠ The fix that was built, measured, and rejected in writing (D-137)

A chunk's feature list is taken from the biome at its origin's SURFACE. `dripstone_caves` and
`lush_caves` are real biomes with real feature lists, and they are never anybody's surface
biome — so their dripstone clusters and moss patches compile, run correctly when driven directly
from the check, and **never appear in a generated world.**

The obvious fix is to offer the union of every biome in the column and let the per-position
`biome` placement modifier sort it out. It was built. It was measured: **86 ms a chunk, up from
15.** The reason is one number — `Climate.biomeAt` costs **38 microseconds**, because it
evaluates the column's climate and searches the R-tree on every call, and the union fix asks it
once per candidate placement.

Vanilla does not pay that. It computes the chunk's biome VOLUME once, at quart resolution, at the
biomes stage, and every later question is an array read. So the correct fix is a cached per-chunk
biome volume — which is a W11/W12 job, because it touches the generator's stage graph — and it is
**written down as one rather than half-done at five times the cost.** The measurement is the
whole value of the decision: without it this would have shipped as either an unexplained 6x slow
chunk or an unexplained missing biome.

### 5. Five files, five agents, and the contract that let them run in parallel (D-138)

32 registered generator types is more mechanical writing than one pass should do serially, and is exactly
the shape of work `docs/AGENTS.md` exists to route. The generators live in five files by family —
`04k` trees, `04m` water, `04n` terrain, `04p` cold and cave, `04q` coral — and each registers
itself through `Features.register` against a contract published before any of them started.

⚠ **All five recorded themselves as `claude-opus-5`, which is full strength, and that was
required rather than generous.** Writing a generator from vanilla's data is interpretation —
deciding what `trunk_vine_decorator` does from a JSON field name and the game's own behaviour —
and AGENTS.md's bright line forbids delegating interpretation to a weaker model however well it
might have gone. The machine that graded all five is `featcheck` plus `gencheck`'s
cross-sections.

The parallelism worked because the contract was written first. What the contract could not
prevent was the four bugs in section 6, every one of which was in the pipeline the agents were
writing against rather than in anything they wrote.

### 6. ⚠ Four bugs, and what each one says about where to look

* **The placement tuple was mis-indexed in `applyChunk`** — `p[2]` where `p[3]` was meant, and
  then `p[3],p[4],p[5]` where `p[4],p[5],p[6]` was meant. Every feature ran, at the wrong
  position, with the wrong placed-feature record. The lesson is old and keeps being true: a tuple
  of parallel arrays indexed by hand is a data structure with no type, and the only defence is a
  check that asserts a position rather than a count.
* **The ore radius formula summed where vanilla blends.** 4,032 diorite per chunk. It passed
  every structural assertion in the check because the structure was right; only the histogram
  caught it, which is the argument for section 1 existing at all.
* **`biomeAtMemo`'s key overflowed Int32 at negative coordinates**, so the memo returned another
  chunk's biome west and north of the origin. Found by a sub-agent reading the pipeline it had
  been told to call. The hash needed `Math.imul`.
* **`compileInline` resolved names against `configured_feature` only.** Ten tree types — taiga,
  savanna, grove, the windswept and old-growth sets — reported "not implemented yet" while the
  trees themselves compiled perfectly, because `trees_taiga`'s selector names
  `minecraft:spruce_checked`, which is a PLACED feature. ⚠ **Placed features never inline a
  feature and always name one; configured features do both.** The two registries are not
  symmetrical and a resolver that assumes they are fails silently on a tenth of the trees.

### 7. What is not there, counted

**145 of 184 configured features and 160 of 220 placed features compile; 36 of the 53 generator
types have at least one working feature.** The rest:

| not implemented | how many | why |
|---|---|---|
| `fossil_coal`, `fossil_diamonds` | 2 configured | a fossil is 8 NBT structure templates; W1 packs no structure registry. A W14 dependency, not a W8 gap |
| `pointed_dripstone` | 1 | needs the generator and `environment_scan` — and is blocked by D-137 regardless |
| `block_pile` (5 features) | implemented, unreachable | the five piles are village decoration; no biome lists them, so nothing compiles them until structures exist |
| Nether and End | 17 generator types | G19's dimensions, correctly out of scope |

### 8. ⚠ The close-out sweep, and the bug that a green suite could not see (D-139)

W8 was called done, the suite was green at 675,299 assertions, and a screenshot of a forest
looked correct. Then two full-strength sub-agents were sent over the documents and the source
looking only for statements that were FALSE. They came back with 42, and the first one was this:

> `src/04_worldgen.js:488` — `if (P.trees) G.treePass(cx, cz)` still runs session 1's legacy tree
> pass every chunk, so the surrounding comments (and `docs/NEXT.md`, `docs/PLAN.md`, which state
> `treePass` is gone) describe a deletion that never happened.

It was true. **The world had been growing two independent tree systems side by side for the whole
of W8** — vanilla's configured features, and session 1's four hand-written shapes chosen by
switching on a twelve-value biome enum. Measured over 200 chunks before the deletion: **29.8 logs
and 101.9 leaves per chunk with the legacy pass against 25.5 and 76.6 without it.** One log in
seven and one leaf in four came from the wrong system.

⚠ **No check in the suite could have caught it, and the reason generalises.** `gencheck` asserts
"trees were placed" and prints logs and leaves per chunk. `featcheck` asserts a tree is the same
tree from both sides of a chunk border. Both are true of a world with two tree systems in it. A
count cannot tell you that a quarter of what it counted came from somewhere it should not have.
**The acceptance test for a replacement stage has to compare against a world with the old system
OFF** — and none of them did, because turning the old system off was assumed to be a thing that
had already happened.

The same sweep found the rest of the class, all of it live and none of it read:

| deleted at the close-out | what it was costing |
|---|---|
| `G.treePass` and its five helpers | 4.3 logs and 25 leaves a chunk from the wrong system |
| the twelve-value biome enum: `G.BIO`, `LEGACY_MAP`, `LEGACY_OF`, `G.legacyOf`, `cBiome` | 256 table lookups a chunk, written into an array nothing read. Its own comment promised it would go when W8 landed |
| `F_TREEMIX`, `O_TREEMIX`, the `cMix` array | **256 `noise2` calls in every chunk generated for two whole stages**, read by nothing |
| 16 frequency and offset constants, `clamp1`, `fold` (D-58), `terrace` (D-59) | nothing — W6 left them behind, and they made the header above them a lie |
| `candidates()` | nothing — the union fix D-137 says was rejected, still sitting there implying cave biomes decorate |
| `params.trees`, `params.ores` | replaced by `params.features`; an explicit `false` under either old name is still honoured |

And 24 false statements in the documentation, including four references to documents that do not
exist. ⚠ **`docs/ARCH.md` is cited by twenty-two source files — every module header points at one
of its sections — and it has never existed.** `doccheck` §6 now asserts that it is the only
dangling document reference in the project, and that it is still missing, so writing it means
deleting an exemption rather than nobody noticing.

Chunk generation came out at **22.5 ms** afterwards, from 23.2.

### What a human can look at

Walk out of a plains into a forest and stand at the border. There should be trees of the right
species on each side, flowers of the biome's own list in the grass, and the occasional flower
sitting on a tree root where D-134 put it before the tree existed. Then dig straight down: coal
most of the way, copper in a band around 48, and nothing but deepslate and diamond below -50.
⚠ **And then look for a dripstone cave and fail to find one** — that is D-137, and it is
supposed to be missing until the biome volume is cached.


## Accepted gaps, moved out of NEXT

These need no owner: two closed in session 3, three that will not change, and two Earth-mode
costs. Kept here so `docs/NEXT.md` stays inside `doccheck` §7's reading budget.

| gap | size | where |
|---|---|---|
| ~~Overworld multi-noise climate parameter table~~ | **CLOSED session 3** — `dimension/overworld.json`, 7,578 entries (D-112) | — |
| ~~The biome tint seam~~ | **CLOSED session 3** — `src/06b_tintmap.js`, both backends, `tintcheck` (D-121) | — |
| The gallery cannot judge WINDING | it draws front faces where the engine draws back ones; it looked perfect while every model face was inside out (§23) | accepted, noted in the tool |
| The carvers do not reproduce vanilla's random SEQUENCE | impossible without the Java source; the configuration and the shape are vanilla's and the invariant is proved (D-124) | accepted |
| Vanilla blends biome colours over 5x5 blocks | ours gets a 4-block blend from bilinear filtering; one texel is four blocks because that is vanilla's own biome resolution | accepted (D-121) |
| Earth mode costs three column evaluations | the rain shadow samples two upwind points, memoised per column | `src/04f_earth.js` |
| The zonal climate tables are Earth's, not tuned by play | they give a Köppen-plausible ladder and a desert belt in the right place; whether the world is *fun* at 12,000 blocks to the pole is a question only playing it answers | `src/04f_earth.js`, `T_ZONAL` / `P_ZONAL` |
| `randomized_int_state_provider` places the source state | so a sea pickle placed by a feature has the source state's count rather than one to four. Small, visible, and the right size for the first item in a later pass | `src/04j_features.js`, W8's own leftover |
| The five `block_pile` features never compile | hay, ice, melon, pumpkin and snow piles are village decoration; no biome lists them, so nothing reaches them. The generator exists and is registered, and will light up when structures do | W14 |
| `pointed_dripstone` is not implemented | needs the generator plus `environment_scan` in `compileInline`; blocked by D-137 regardless, since nothing would place it | `featcheck` §5 |
| `fossil_coal` and `fossil_diamonds` do not generate | a fossil is 8 NBT structure templates and W1 packs no structure registry. Not a W8 gap — a W14 dependency, and the generator is already written and registered | `featcheck` §5 |


## 25. G1, G2 and G3 — the game layer arrives, and the six things that were not where PLAN said

*Session 6. `tagcheck` 176 · `behavcheck` 110 · `minecheck` 159 assertions, 18 deliberate breaks.*

### 25.1 G1 turned out to be 218 files, not 270

`data/minecraft/tags/` has 270 files and 52 of them are `worldgen/`, which **W13 already packed**
(D-183) because a structure's `biomes` field is a tag reference and it could not be placed without
them. Packing them twice would have been 6 KB of duplicate bytes and two answers to one question.
So `tools/pack-tags.mjs` takes the five REGISTRY directories — blocks 133, items 71, fluids 2,
entity_types 10, game_events 2 — and `tagcheck` §1 asserts that this payload plus `worldgen.bin`
account for all 270 (D-200). Flattening the 99 nested `#tag` references at build time means no
runtime code ever walks a tag graph; the cycle detector is proved on a synthetic pair inside the
BUILD, because vanilla's own tags have no cycle and a detector nobody trips might not work.

Cost: 70.2 KB of JSON → 23.6 KB binary → **9.8 KB deflated, 13.0 KB of base64**, decoded in 1.6 ms,
plus a 15.3 KB membership bitset (133 tags × 900 blocks) so `is this block in that tag` is a shift
and an AND rather than a 368-entry scan.

### 25.2 ⚠ The placement table carried six properties, and G2 and G3 both need all sixty-nine

D-157 built `block-runtime.bin`'s `MCLP` section for PLACEMENT — `facing`, `axis`, `half`, `type`,
`face`, `waterlogged` — and hard-coded those two name lists. So `States.propValue(state, PROP.age)`
returned −1 for every crop in the game, `type=double` could not be read off a slab, and **180 of
the 835 loot tables carry a `block_state_property` condition naming a property that was not there**.
The table is now every property the roster has: 69 properties, 120 values, 1,306 entries, +2.6 KB
deflated (D-204). Without it G2 cannot grow wheat and G3 drops one slab where vanilla drops two.

### 25.3 ⚠ PLAN's own G3 formula is wrong in three places, and the code follows vanilla

PLAN §5 writes Efficiency as a **multiplier** `(level² + 1)`, Haste as `1.2^level` and Mining
Fatigue as `0.3^min(level,4)`. Vanilla **adds** `level² + 1`, and only when the base speed already
exceeds 1; Haste is the linear `1 + 0.2·level`; Fatigue is the switch `0.3 / 0.09 / 0.0027 /
0.00081`. Efficiency V on a diamond pickaxe is 8 + 26 = **34, not 208**, and on DIRT it is 1,
because a pickaxe is not the right tool. CLAUDE.md's rule decides it: the game is the specification
and PLAN's block is a summary written from memory (D-203).

### 25.4 The compiled-Java gap G3 expected does not exist — `minecraft-data` already evaluated it

`getDestroySpeed` and `isCorrectToolForDrops` are Java overrides, but `materials.json` is the first
as a table (16 material classes × 31 items = 121 speeds, including shears-on-wool 5 and
sword-on-cobweb 15) and `harvestTools` is the second as a table, present exactly when
`requiresCorrectToolForDrops` is set and listing the items that answer true — **including cobweb's
swords-and-shears override, which no tier comparison produces**. The six tier speeds PLAN quotes
are reproduced from that data rather than typed, and `minecheck` §2 asserts it. `Tiers.java`'s
LEVEL integers are neither ported nor guessed: a level exists only to be compared with the
`needs_*_tool` tags, and `harvestTools` is that comparison's answer (D-201).

### 25.5 ⚠ Three break times are one tick longer than the wiki, and float32 is why

`progress = float(float(speed/hardness)/bracket)`, and for cobblestone bare-handed that is
0.0049999998882 — reciprocal 200.0000045, so it breaks on tick **201**. The same lands on obsidian
(5001) and cobweb (401) broken by hand; every other block in the table rounds the other way and the
rational and float answers agree. 44 hand-computed triples, all asserted to the tick (D-209).

### 25.6 The wall test is against the block above's DOWN FACE, not its volume

A bottom slab's volume contains no full-height column, so a volume test reads `low`; its down FACE
is a full 16×16 square, and vanilla's `getFaceShape(Direction.DOWN)` therefore reads `tall`. Every
wall under a slab in every village is the difference (D-206). The five test rectangles themselves
are `private static final VoxelShape` constants in `WallBlock.java` and are a **named gap**: they
are stated as a hand-sourced table and the check asserts the observable consequences instead.

### 25.7 What G2 owes G15, and what is deliberately not in it

Redstone is PLAN G15 and is not here. What G2 built for it is the **scheduler** — vanilla's
`LevelTicks`, ordered by (tick, priority, insertion) with duplicate positions collapsed — which is
what a repeater will hang off. Fluids already use it: water spreads 0 1 2 3 4 5 6 7 and stops,
overworld lava 0 2 4 6, a falling column resets the strength so an eight-step staircase carries all
the way down, two sources two apart make a third and lava never does, and a pool drains to nothing
when its source is taken away.

**Named gaps in G2:** fire's `setFlammable(block, encouragement, flammability)` integers are
`FireBlock.bootStrap()` and are not ported — the FAMILIES that burn come from tags, so fire goes
out exactly when vanilla's does and spreads at a rate this stage does not claim (D-210); vanilla's
`isRandomlyTicking` flag is compiled Java and unobservable where it differs from "has a rule"
(D-207); and which blocks have a BLOCK ENTITY is `BlockEntityType.java`, so the 34 types are a
hand-sourced list with five of them read through tags (D-208). Furnace smelting and hopper
transfer are counters here and recipes in G9 and slots in G8; both hang off a named hook.

### ✅ G26g — CHAT AND ACCESSIBILITY SETTINGS SCREENS
Chat Settings + Accessibility Settings screens, persisted GameOptions (`src/15f_options.js`, `chatoptscheck`). Owed: chat text scale/line spacing in the chat draw.
