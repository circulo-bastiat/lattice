# ARCH — the map

⚠ **This is a REFERENCE, not required reading.** Twenty-two `src/` headers cite a section of it
by number, and for three sessions those citations pointed at a document that did not exist —
which is worse than no citation, because it reads as evidence that the thing was written down.
This is that document. **Look up the section the code cites; do not read it end to end.**

What it is: where each thing lives, what the formats are, and which invariants the code depends
on. What it is NOT: the plan (`PLAN.md`), the reasons (`DECISIONS.md`), or the state of the work
(`NEXT.md`). Every number here is one a tool can reproduce — if it disagrees with the suite, the
suite is right and this file is stale.

---

## §1 The rules of the codebase

* **One self-contained `.html` file**, opened from `file://` by double-clicking. No ES modules,
  no CDN, no `fetch()` at runtime, no `SharedArrayBuffer`. Workers come from a Blob URL (D-11).
* **`src/` is numbered and concatenated in order** by `build.mjs`. Each file is an IIFE against
  the single global `MCL`. Load order is the file order; a module may use anything numbered
  below it and must not assume anything numbered above it exists at load time.
* `src/00..05` plus `src/workers/chunk.worker.js` form the **worker bundle** — the same source
  the main thread runs, not a copy (D-38). `tools/loadsrc.mjs` lists it; `doccheck` asserts that
  `build.mjs` and `src/` agree.
* **A block id is a registry REAL STATE** (§3), not an index into a small table. State 0 is air
  by construction (D-103).
* Pure JS, no WASM. No npm dependency anywhere in the build (D-17/D-18).

## §2 The namespace and the constants — `src/00_ns.js`

`MCL.CFG` is the single source of every size in the engine. The ones other sections refer to:

| constant | value | what it fixes |
|---|---|---|
| `SECTION` / `SECTION_VOL` | 16 / 4096 | a section is 16³ |
| `WORLD_MIN_Y` / `WORLD_MAX_Y` | −64 / 256 (exclusive) | the vertical range; `setBlock` refuses outside it |
| `SECTIONS_Y` / `CHUNK_H` | 20 / 320 | a column is 20 sections tall |
| `MAX_QUADS` | 16,383 | 4 vertices each → 65,532 indices, inside a `Uint16` index buffer (D-25) |
| `LAYER_OPAQUE/CUTOUT/TRANSLUCENT` | 0 / 1 / 2 | the three render layers, in draw order |
| `MESH_MAGIC` / `MESH_HEADER_BYTES` | `'MSH2'` / 64 | the mesh buffer (§8) |
| `VERTEX_BYTES` / `QUAD_BYTES` | 8 / 32 | the greedy stream (§8) |
| `MODEL_VERTEX_BYTES` / `MODEL_QUAD_BYTES` | 16 / 64 | the model stream (§8) |
| `MODEL_UNITS_PER_BLOCK` | 256 | model geometry is fixed-point in 1/256 of a block |
| `UPLOADS_PER_FRAME` | 4 | GPU upload budget (D-43) |

`MCL.CH` is the chunk state machine (§5): `EMPTY 0, GENERATING 1, GENERATED 2, LIT 3, MESHING 4,
READY 5`. `MCL.ENV` answers what the host can do — worker, Blob URL, WebGPU, WebGL2, core count.

## §3 The registry and the state tables — `src/02b_registry.js`, `src/02c_states.js`

Two indexings, and keeping them apart is most of the work:

* **VISUAL state** — what a block looks like. 8,933 of them. What the mesher and the occlusion
  mask use.
* **REAL state** — what a block IS. 20,344 of them. What placement, collision, lighting, the save
  format and the player's hotbar hold. Every real state maps to exactly one visual state; never
  the reverse.

`Reg` decodes the packed blob into typed arrays: `names`, `visFirst`/`realFirst` (per block),
`hard`, `resist`, `emit`, `filter`, `flags`, `stack`, `tools`, `defaultState`, `occlusion`,
`toVisual`, `shapeOf`. The flag byte carries `TRANSPARENT 1`, `DIGGABLE 2`, `LOOT 4`,
`NEEDS_TOOL 8`, and bits 16|32 as the **support class** (0 none, 1 floor, 2 ceiling, 3 any face —
D-140).

`States` (`SR`) spreads all of that per REAL state into flat arrays the hot loops index directly:
`opaque`, `lightSolid`, `solid`, `emit`, `atten`, `hard`, `geom` (NONE/CUBE/MODEL), `layer`,
`cull`, `anim`, `selfCull`, `support`, `block`. **Nothing works before `Reg.init()`** — on the
main thread and in every worker.
⚠ **`opaque` and `lightSolid` are different questions and are not interchangeable** (D-156).
`opaque` is opaque BY MATERIAL and owns FACE CULLING; `lightSolid` is vanilla's
`getLightBlock === 15` and is the only one light may ask. 196 blocks — every slab, stair, wall,
fence, carpet, snow layer, farmland and dirt path — are the first and not the second.

## §4 The section codec — `src/03_section.js`

A section is `{ u, p, b, d, n, l, lu }`:

* `u >= 0` — the section is UNIFORM and `u` is the block id. No arrays at all.
* otherwise `p` is the palette (`Uint16Array` of real states), `n` its length, `b` the bits per
  index (1, 2, 4, 8 or 16 — `BITS_FOR_COUNT`), and `d` a `Uint32Array` of packed indices.
* light is a byte per cell, **sky in the high nibble, block in the low** (D-18); `lu >= 0` means
  the whole section shares one light byte and `l` does not exist.

Growth is one-way (`grow` widens `b`); `compact()` shrinks and re-uniforms and runs on idle
frames only, never on the edit path (D-21).

## §5 The World — `src/07_world.js` (main thread only)

A chunk record is a COLUMN: `{ cx, cz, sec[20], hmap, biome, state, meshDirty, meshed, vis[20],
lastUse }`. `state` walks `MCL.CH` (§2).

Invariants the rest of the engine depends on:

* **`setBlock` dirties every section whose 18³ mesh neighbourhood contains the voxel** — the six
  face neighbours AND the diagonals, because baked AO reads them. Missing this is the most common
  bug in the file.
* `setBlock` is also the ONE place a block changes, so it is where persistence (§13) and the
  light engine (§14) are notified.
* **`setBlock` enforces block support in both directions** (D-155): it REFUSES a support-ruled
  state that fails `World.canSurvive`, and after the write it drains a queue over the six face
  neighbours, breaking anything that can no longer survive. `World.canSurvive` is the live twin of
  `Features.supported` (§6) and must give the same answer, including counting an unloaded
  neighbour as support. The save replay writes through `Section.set` and is deliberately not
  judged by it.
* `setLight` writes the byte and does NOT dirty anything: the light engine marks sections itself,
  once per changed cell (D-142).
* Streaming is a **spiral**, nearest first, cached per radius. ⚠ **Generation walks
  `spiral(rd + 1, 1)` and meshing walks `spiral(rd)`** — a section is meshable only when all eight
  neighbouring columns exist, and the furthest of those sits at d² = (rd+1)² + 1 (D-147).
* ⚠ **Meshing is nearest first in THREE dimensions** (D-198): the spiral orders columns, and inside
  a column `sy` walks outward from the camera's own section, in two passes — pass 0 takes the
  sections with `d² + Δsy² ≤ rd²` (the spiral's disc, made a hemisphere) and pass 1 takes the rest.
  Nothing is skipped, only ordered. Bottom-up meshed the deepslate under your feet before the
  ground in front of your face, and that is what a large render distance turns into a white flash.
* ⚠ **`maxMeshPerFrame` is scaled by `World.load` but never below the free slots in
  `maxMeshInflight`** (D-198). The first budget costs main-thread time (a snapshot, 0.05 ms); the
  second costs worker time. Scaling the first below the second throttles the WORKERS.
* Eviction has two rules and needs both: distance past `rd + evictMargin`, then a resident CAP
  that drops the FURTHEST (D-89). A column that goes away cancels its in-flight jobs (D-87).

## §6 Worldgen — `src/04*.js` (worker side)

`Gen.genColumn(cx, cz)` is a pure function of (seed, cx, cz) and runs in this order:

1. the column functions — `Column.height` / `climate` from the splined 2D fields (W3)
2. the biome, from the climate, at quart resolution (W4/W5)
3. the surface rules over the noise terrain (W6)
4. the cheese caves (`04b`), then the three configured carvers (`04i`, W7)
5. the features (`04j` + the five family files, W8) — anchors, providers, predicates, the 14
   placement modifiers, then the generators
6. `lightPass` — sky straight down the column, then a column-local BFS (§14)
7. pack each section into the codec of §4

⚠ Steps 4 and 5 are in vanilla's order and must stay there: a feature placed before a carve would
be carved away. ⚠ A feature's `run` is called ONCE PER TARGET CHUNK with identical arguments
(D-136), so it must draw every random it needs before it reads a block.

## §7 Jobs, workers and the snapshot — `src/09_jobs.js`

The worker bundle is turned into a Blob URL once (D-11). Messages: `init`, `gen`, `mesh`, `opt`,
`cancel`; replies `ready`, `gen:done`, `mesh:done`, `err`. Each worker decodes its own registry
(~70 ms, in parallel) rather than receiving 2.3 MB of typed arrays.

A **mesh snapshot** is 27 section COPIES — the 3×3×3 around the section being meshed — sent by
structured clone; the worker does the unpack (D-40). The snapshot objects come from a POOL and
are handed back the instant `postMessage` returns, because that clone is synchronous (D-88). The
spare section copies live in a side map, never on the snapshot itself, or they would be cloned too.

## §8 The vertex formats — `src/05_mesher.js`, both backends

**The mesh buffer**: 64-byte header, then the greedy stream, then the model stream. The header is
`Int32Array(16)`: magic, three quad counts, three offsets, and `hdr[7] = visibility mask` (§9).

**Greedy stream — 8 bytes a vertex, two uint32s.** Both backends decode these exact bits:

```
data0:  x:0-5  y:6-11  z:12-17  face:18-20  ao:21-22  sky:23-26  block:27-30  flag:31
data1:  tile:0-11  uRep:12-19  vRep:20-27  corner:28-29  tint:30-31
```

Positions are per-section integers 0..63 (a greedy quad may span a section face by one), `tile`
is the atlas ARRAY LAYER, `uRep`/`vRep` are the merged run lengths, and `sky`/`block` are the
light nibbles for this vertex.

**Model stream — 16 bytes a vertex.** Non-cube geometry (stairs, fences, plants, everything the
greedy path cannot merge): fixed-point position in 1/256 of a block, and ⚠ **per-face light for
all six neighbours packed into two uint32s** (D-132), because a plant stands in air and takes the
light of the cell it looks into, not of its own cell.

## §9 The camera, the frustum and the visibility flood — `src/10_camera.js`, `src/10_gfx.js`

`Cam` holds position, yaw/pitch, fov, near/far, the three matrices and **six frustum planes in
`Float64Array`** (D-149). `aabbVisible` is the centre/extent test: 6 planes × 7 flops, no branch.

The **visibility mask** is 15 bits per section, one per pair of its six faces, meaning "a
connected run of non-opaque blocks joins these two faces". The mesher computes it and the header
carries it (§8); an unloaded section reports `0x7FFF` so the flood runs through the load frontier
rather than stopping at it.

`floodVisible` is a breadth-first walk of the SECTION GRID from the camera's own section: never
reverse a horizontal direction, honour the pair mask, stay inside the render distance — and ⚠
**not** inside the frustum, which is a draw-time question and moved there in session 4 (D-145).
The 3×3×3 around the camera is seeded unconditionally.

Its queue holds `(2r+1)² × 20 × 4` steps and ⚠ **an overflow is not a negative answer** (D-198):
the frame that runs out of queue sets `_flood.overflow`, `floodHas` then returns true for every
section, and the frame falls back to the frustum alone. `Gfx.stats().floodQueue` and
`.floodOverflows` are how a check sees it; `soakcheck` §5d fences the headroom at 90%.

Draw lists are built per layer, sorted near-to-far for opaque and cutout and far-to-near for
translucent, and grouped by vertex ARENA so a bind is per arena and not per section (D-86).

## §10 The frame — `src/17_main.js`

Order, and it is not arbitrary:

0. `Tint.follow` — re-anchor the biome colour window if the player has neared its edge (§12).
   ⚠ The map's UPLOAD is not a step in this list and must not become one: it is driven by the
   write, which happens between frames (D-214).
1. input, then fixed-step physics ticks (accumulator), then interpolate the player
2. retarget (the DDA, §15), act on held buttons, update particles
3. **frame budget**: `World.load` from the recent frame times — at target it is 1, and it falls
   toward 0.2 as frames get long, so the streamer backs off BEFORE the next hitch (D-87)
4. `Light.step(budget × load)` — bounded, resumable (§14)
5. `World.stream(camCx, camCz, renderDistance)` — generate, mesh, evict (§5)
6. `Gfx.render` — flood, cull, sort, draw (§9)
7. HUD (§17), then `Save.tick`, then the adaptive render distance (§16)

## §11 The two backends — `src/12_gfx_webgl2.js`, `src/11_gfx_webgpu.js`

Both consume the SAME vertices (§8) and must render identically. WebGL2 is the default;
⚠ the WebGPU path is unproven on real hardware (world renders black; F9 switches back). The
frontend owns the draw list and the uniforms; a backend owns no policy at all. Per-section
uniforms are `uOrigin` (world position of the section, plus the layer mode) and the frame's
`uViewProj`, `uCamTime`, `uFogCol`, `uParams`, `uTint`.

## §12 The atlas and the tint map — `src/06_atlas.js`, `src/06b_tintmap.js`

The atlas is a 2D **texture ARRAY**, one 16×16 tile per layer, so layers cannot bleed into each
other and REPEAT wrapping makes the greedy mesher's run lengths exact with no UV inset (D-50).
Layer order is an INTERFACE: `tilecheck` asserts the first 57 layers against the engine's own
table. Transparent texels carry the colour of their nearest opaque neighbour (D-146).

The tint map is a quart-resolution RGB image of the loaded area, three layers (grass, foliage,
water), filled per chunk column from the biome array; bilinear filtering gives the border blend
for free (D-121). It re-anchors when the player nears the window edge.

⚠ **The WRITE drives the upload, not the frame (D-214).** `Tint.fillChunk` is called from
`World.installChunk`, which runs in a worker promise BETWEEN frames. The map keeps a dirty
rectangle and a `sink` — the live backend's uploader, registered when its tint texture is
created — and `flush()` runs it the moment the bytes change, so one arriving chunk costs a
4×4×3 sub-box rather than the whole 768 KB. `held` batches a refill into one upload and a
re-anchor into two. Both backends still call their own uploader from `beginFrame`; that is a
safety net for the first frame, a restored context and an F9 swap, not the mechanism.

## §13 Persistence — `src/16b_save.js`

Every edit is journalled at `World.setBlock`. The format is one flat buffer, base64 into one
localStorage key: magic, version, chunk count, then a **name palette** — (block name, local state
index) pairs, so a world of stone and dirt carries two entries rather than nine hundred — then
per chunk `cx`, `cz` (int32) and six bytes per edit (u32 cell index + u16 palette index). A save
survives a registry reorder because it resolves names, not ids; a name this build no longer has
becomes air and is COUNTED (`unknownNames`). `Save.applyTo` replays a column's edits inside
`installChunk`, before the dirty mask is computed.

## §14 Lighting — `src/04_worldgen.js` (`lightPass`) and `src/08_lighting.js`

Two halves. The worker's `lightPass` lights a column against itself: sky straight down, then a
column-local BFS. The main thread's engine finishes the job — the chunk SEAMS it cannot see, and
the player's edits — in bounded slices (D-142).

Vanilla's rules, exactly: block light falls by `max(1, opacity)` a step; sky light does the same
sideways and upward but falls **straight down through a zero-opacity cell for free**; a
**`lightSolid`** block — not merely an `opaque` one, see §2 and D-156 — holds no sky light,
⚠ **but an emitter holds its own emission whatever its opacity** (D-150). Removal is the two-pass algorithm: clear what this source lit, re-seed from anything
brighter, then propagate.

The engine reads and writes through an ADAPTER, never through `World` directly, which is what
lets `lightcheck` run the real engine over a hand-built room — and what will make moving it to a
worker a new adapter rather than a rewrite. Its queue stores x and z whole (D-148).

## §15 Physics and targeting — `src/14b_physics.js`, `src/14c_raycast.js`

Collision is against the REAL per-state shapes (898 blocks × 4,105 shapes), with `FULL_CUBE`
kept by IDENTITY as the fast path. `clip` sweeps the player AABB against every shape in range.
Targeting is a DDA that returns the block AND the face entered by, and the outline is drawn from
the SAME boxes the DDA selects on, or it teaches the player the wrong aim point.

## §16 Settings and presets — `src/16_settings.js`

Four presets on the hardware ladder (7600 → 3600 → 2200G → Celeron), chosen by a boot probe and
overridable. A preset sets render distance, mesh detail, AO, fog, the streaming caps, the light
budget and the target frame time. The **adaptive render distance** (D-46) nudges rd by one every
couple of seconds against measured frame time — ⚠ freeze it (`Settings.adaptive = false`) before
any A/B measurement or it will move the world under the test (D-145).

## §17 The HUD — `src/15_hud.js`

A second 2D canvas over the GL one: loading screen, crosshair, selection box, hotbar, F3 debug,
menus, the title screen. It projects world points with the camera's `viewProj` for the selection
box and the particles. Nothing in it touches the world; it reads.
