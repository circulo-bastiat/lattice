# PROFILE — the four hardware tiers, and what each one actually measured

PLAN F9's other half. `tools/bench.mjs` writes JSON; this is where the numbers mean something.

⚠ **Read the caveat before the tables.** Every number below was measured in **headless
Chromium on SwiftShader**, a software rasteriser. That has three consequences and they are not
small:

1. **`fps` and the absolute millisecond figures are meaningless as predictions.** SwiftShader is
   perhaps two orders of magnitude slower than an RX 6800XT and perhaps one slower than a 2200G
   iGPU. A p95 of 80 ms here does not say a 2200G will see 80 ms.
2. **Ratios and counts ARE meaningful**, because they are properties of the engine rather than
   of the renderer: triangles per frame, draw calls per frame, sections drawn versus culled,
   resident chunks, world memory, arena memory. Those are the same numbers on any GPU.
3. **Relative comparisons on the same machine are meaningful** — before against after, occlusion
   on against off, preset against preset. That is what the bench is for and it is why
   `docs/bench-before-roster.json` was captured before the id swap.

Nothing here replaces running the game on the real machines. When Dan runs the in-game benchmark
(`18_bench.js`) on the 2200G, those numbers belong in this file beside these, clearly labelled,
and they are the ones that decide anything.

---

## The four tiers

The names are the owner's target machines, because "8 chunks" means nothing to a player and
"this is the one for a Celeron" does. Defined in `src/16_settings.js`.

| preset | the machine | render distance | DPR | AO | mips | leaves | workers | chunk cap |
|---|---|---|---|---|---|---|---|---|
| `celeron` | Intel Celeron / any 2-core iGPU laptop | 4 | 0.75 | off | off | fast | 1 | 160 |
| `low` | **Ryzen 5 2200G iGPU — the machine this project exists for** | 8 | 1.0 | on | on | fast | 3 | 420 |
| `medium` | Ryzen 5 3600 + RTX 3060 | 12 | 1.5 | on | on | fancy | 4 | 900 |
| `high` | Ryzen 5 7600 + RX 6800XT | 16 | 2.0 | on | on | fancy | 4 | 1600 |

Read the differences as a story: everything that costs the CPU per frame shrinks going left
(workers, streaming budget, tick budget), everything that costs the GPU per pixel shrinks too
(render distance, DPR, mipmaps), and the two things that only cost MEMORY — occlusion culling
and the resident chunk cap — get *more* aggressive going left, because on these machines memory
bandwidth is the wall and not drawing something is always free.

### How a tier is chosen

`S.detect()` runs a **timing probe** first, because it is the only thing that measures the
machine rather than describing it: > 90 ms → celeron, > 45 → low, > 22 → medium, else high.
Core count and `navigator.deviceMemory` can then only pull the choice **down**, never up, and a
missing WebGPU adapter caps it at medium.

Guessing low costs the player one menu click. Guessing high costs them the first two minutes of
the game at 9 fps, which is when they close the tab.

---

## Measured, 6 September 2026, after the block-id swap

`node tools/bench.mjs --json docs/bench-after-roster.json`, SwiftShader, 2 cores, one worker.
Full data in `docs/bench-after-roster.json`; the "before" half is `bench-before-roster.json`.

| preset | tris/frame | draws | sections drawn | sections culled | resident chunks | world MB | arena MB |
|---|---|---|---|---|---|---|---|
| celeron | 925 | 3 | 3 | 332 | 87 | 1.8 | 5.0 |
| low | 30,884 | 77 | 77 | 772 | 271 | 5.7 | 12.2 |
| medium | 98,590 | 234 | 232 | 1,483 | 552 | 11.8 | 22.4 |
| high | 238,598 | 496 | 283 | 1,489 | 939 | 20.2 | 22.4 |

Frame times, for ratios only:

| preset | median | p95 | stall % |
|---|---|---|---|
| celeron | 21.0 ms | 29.9 ms | 2.1 |
| low | 29.8 ms | 80.5 ms | 45.1 |
| medium | 50.0 ms | 152.2 ms | 75.7 |
| high | 79.5 ms | 250 ms | 85.7 |

### Three things these numbers say

**The tiers are separated by roughly 3x each in triangles**, which is what you want: a player
who drops a tier gets a real improvement rather than a rounding error. celeron → low is 33x,
which is a bigger jump than the others and reflects render distance 4 → 8 being a 4x area
change on top of the DPR and AO differences.

**Draw calls track sections drawn almost exactly** at every tier except `high`, where 496 draws
serve 283 sections — the difference is the cutout and translucent passes, which fancy leaves
turn on. That is the one number that would be worth attacking if `high` were the target.

**Arena memory saturates at 22.4 MB** from medium upward while resident chunks keep climbing to
939. The arenas are recycled and the world data is not, which is why `worldMB` doubles from
medium to high and `arenaMB` does not move at all.

---

## The occlusion A/B

Same preset (`low`), same seed, occlusion culling off and on. This is the single largest
rendering win in the project and the reason it is on at every tier including celeron.

| | tris/frame | draws | sections drawn | median | p95 |
|---|---|---|---|---|---|
| occlusion OFF | 44,066 | 104 | 104 | 26.9 ms | 124.2 ms |
| occlusion ON | 27,806 | 70 | 70 | 30.3 ms | 101.1 ms |
| | **−37%** | **−33%** | **−33%** | +3.4 ms | **−23.1 ms** |

⚠ **The median gets slightly WORSE and the p95 gets much better.** That is the honest shape of
it: the visibility flood costs a little every frame and saves a lot on the frames that were
going to be slow. On a machine that is comfortably above its target frame time you would notice
only the cost; on the 2200G, where the p95 is what makes the game feel bad, you notice only the
saving. It is on everywhere for that reason and the trade is written down here so nobody
"optimises" it away by looking at the median.

---

## What the id swap did to these numbers

Full discussion in `docs/PLAN.md` §15.9. In one line: **the `low` preset got 20% faster at p95
while drawing more triangles**, because the real 6-bit occlusion mask replacing a per-block
boolean, and the model path finally culling against its neighbours, more than paid for the
geometry that 900 blocks added.

| preset | p95 before | p95 after | tris before | tris after |
|---|---|---|---|---|
| celeron | 41.9 ms | **29.9 ms** | 1,619 | 925 |
| low | 100.2 ms | **80.5 ms** | 29,504 | 30,884 |
| medium | 182.5 ms | **152.2 ms** | 86,417 | 98,590 |
| high | 250 ms | 250 ms | 172,740 | 238,598 |

`high` is the exception and is expected to be: it was already pinned at the cap, and it is the
only tier with fancy leaves, so it pays the full price of plants having real models.

---

## How to re-measure

```
node tools/bench.mjs --json docs/bench-after-roster.json
```

Takes about four minutes. It runs all four presets plus the occlusion A/B, generating and
meshing a real world each time. ⚠ It is **not** in `tools/suite.mjs` and should not be: it is a
benchmark, not a check, and a four-minute stage would stop people running the suite.

Before a change that could plausibly move the frame time, copy the current JSON to
`bench-before-<what>.json` first. A benchmark with nothing to compare against is a number
nobody can act on.
