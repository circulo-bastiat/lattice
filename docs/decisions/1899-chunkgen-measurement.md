# #1899 C2ME-1 — chunk generation, MEASURED (seed 1337, medium preset, 6-core host, headless SwiftShader)

Tools: `tools/chunkgenprofile.mjs` (`--stages`, `--browser`, `--scaling`, `--golden`), golden `tools/golden/chunkgen-golden.json`,
judge `tools/chunkgengoldencheck.mjs` (3 seeds x 21x21 = 1,323 chunks, FNV-1a of sections+biome+heightmap+spawner/entity logs; 9 breaks caught).
Stage timing patches the TEXT of genColumn at load (worker bundle or node), shipped source untouched. There is no aquifer pass in this pipeline.

## Where the time goes (summed CPU ms over the settle window, pool 3)
| rd | gen in worker | mesh in worker | installChunk | mesh upload | clone (send) |
|---|---|---|---|---|---|
| 6  | 83% (26 ms/chunk) | 11% | 2.7% (0.9 ms) | 0.0% | 2.7% |
| 12 | 71% (30 ms/chunk) | 22% | 2.4% (1.0 ms) | 0.0% | 4.8% |
| 16 | 77% (32 ms/chunk) | 16% | 2.5% (1.0 ms) | 0.0% | 3.8% |

Generation dominates (MineHTML's 81% holds here); upload is ~0 ms (3-5 ms of 10-14 s); installChunk ~1 ms/chunk on the main thread.
Inside a chunk (rd 12): **features 80%** (of which random-select trees/vegetation 37%, ore/vein 12%, freeze_top_layer 4.5%, placement list build/sort/reject 22%),
surface rules 9%, climate 2.6%, noise caves 2.3%, carvers 1.3%, light+heightmap 2.6%, pack 0.8%, fill/biome-volume/structure ~0.
The stages before features total ~15% — the C2ME-style noise/biome work is NOT the cost here; decoration is.

## Churn
Mesh jobs per section: 1.3 (rd 6), 2.5 (rd 12), 2.1 (rd 16); 116/610/606 sections meshed more than once. Meshing never goes quiet at rd >= 8
(a column's re-dirtying by neighbour arrival and light borders), so "all meshed" is defined as every non-empty section of every column with a complete 3x3 meshed once.
The rim columns (incomplete 3x3) are never meshed by the game itself.

## Pool scaling (rd 8; `--scaling`)
Generation: 6.1 s (pool 1) -> 3.5 / 3.1 / 2.95 s (2/3/4) -> flat at 3.3 s for 6 and 8 (8 is clamped to the 6 cores). Stops at pool 3-4: workers ~80% busy, and the
browser's own main/compositor/raster threads share the same cores.
Meshing with the SHIPPED caps: 17.1 s -> 14.2 s at best — **it does not scale at all**. WHY: feed cap. `maxMeshPerFrame` (8) x frame rate = 240 jobs/s and 213 are issued.
With caps lifted (gen>=2x pool, mesh>=4x, per-frame>=4x pool): 15.9 s -> 4.2 s (3.8x at pool 6), still rising; at pool 6 the workers are 56% busy, i.e. the main-thread
feed (one `World.stream` pass per frame) is the next limit. Frame percentiles are unchanged by pool size (p50 33 ms, p95 67 ms under SwiftShader).
Caveat: headless frames are ~30 fps, so feed ceilings are lower than on a real GPU; the worker CPU numbers are real.

## What this says for the family
1. The first lever is decoration cost (features, 80% of a chunk), not the noise stack.
2. The second is the per-frame feed (maxMeshPerFrame, one stream pass per frame): more workers alone buy nothing at the shipped caps.
3. Any speed-up is judged by `chunkgengoldencheck`: it may change when/where a chunk is built, never what it contains.
