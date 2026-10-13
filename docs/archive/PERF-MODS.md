# PERF-MODS — what to steal from Lithium, C2ME, Async, Sodium, Starlight

Dan asked for the async question to be researched properly, and pointed at MineHTML's own
`MODS.md` as prior art. That document is thorough and its analysis is sound — but it was written
under **MineHTML's** rules, where *everything* must be bit-identical to vanilla.

**MC-Lite's charter is different, and it changes several of the answers.** That is the
useful part of this document: not repeating MineHTML's reasoning, but marking where our
looser constraint legitimately unlocks something theirs forbids — and where it does not.

## The key measurement, inherited

MineHTML measured that **scaled to one core, vanilla generates a chunk in ~300 ms — the
same order as a JS reimplementation.** The ~10× wall-clock gap is **parallelism, not
per-chunk inefficiency.**

That single fact justifies D-14 on its own. Chasing constant factors in the generator is
chasing the wrong thing; the win is running more of it at once.

## Mod by mod, translated to MC-Lite

### C2ME — parallel chunk generation ✅ take it, it is the main event
Worldgen, meshing and lighting off the main thread, worker count scaled to the machine,
a job graph, and cancellation for work the player walked away from. This is the only
structural speed gap either project has. **Already locked as D-14.**

Design notes: chunk generation must never run inside the render loop (MineHTML's §9.13 is
a warning written from experience). Cancellation matters more than raw throughput on a
2200G — generating chunks the player has already walked away from is the most expensive
possible way to be idle.

### Lithium — optimise logic, change no behaviour ✅ take the *mindset*, wholesale
Lithium's rule — "no behaviour change" — is exactly MC-Lite's parity requirement for
everything that is not worldgen or rendering. Its techniques are the checklist:
**avoid re-scanning, cache what vanilla recomputes, index instead of iterate.**

This is the right lens for the survival loop, inventories and eventually mobs: they must
be *behaviourally exact* (D-8), so the only permitted speed work on them is Lithium-shaped.

### Sodium — the chunk renderer ✅ DONE, W12
Greedy meshing, mesh building off the render thread, compact vertex formats, better culling —
and the **chunk visibility graph**, which was the last one outstanding: the mesher writes a
15-bit face-pair mask per section and `floodVisible` walks the section grid from the camera, so
whole regions behind a wall are never submitted (`docs/ARCH.md` §9). ⚠ Its two real bugs and its
one deliberate conservatism are D-171, D-175 and D-173 — read them before touching the flood.

⚠ Greedy meshing only stays correct if the face-culling rules stay exact. Get it wrong
and the world looks wrong specifically **through glass and leaves**.

### Starlight — faster lighting ⭐ **MC-Lite may take this; MineHTML may not**
Starlight is famously **subtly non-identical** to vanilla at the edges — it changed light
update *ordering*, and there were visible differences during its transition.

For MineHTML that is disqualifying: lighting must match vanilla exactly.
**For MC-Lite, lighting is explicitly on the cheap-implementation side of the charter.**
"The cheapest thing that still looks like Minecraft" is the standard. So a Starlight-shaped
rewrite is permitted here.

**This is the clearest case where our charter buys something theirs cannot have.**
⚠ The caveat still applies: do not replace lighting we have never verified *looks* right
with something faster that looks different. Get it looking correct first, then make it fast.

### Async (the mod literally called "Async") ⛔ **live-world parallelism stays OUT — D-453 (researched directly, 21 Sep 2026)**
The Modrinth mod **Async** (Fabric/NeoForge/Quilt, 1.21.x+, self-described alpha) does three
things and only these: **parallel entity ticking**, **async random ticks** (experimental, off by
default), **parallel mob spawning** (off by default). It does NOT touch chunk generation, meshing
or lighting — that is **C2ME**, a different mod, already ours as D-14.

⚠ **Correction to this doc's earlier objection.** An older version rejected Async because "async
random ticks abandon determinism, and our saves + structures depend on determinism." That
over-reached: saves (regenerate untouched chunks from the seed) and the structures invariant
(decidable from `(seed, chunk)`) are **worldgen** properties, threatened only by non-deterministic
*generation* — which C2ME-shaped pure-function parallelism preserves by construction. Entity and
random-tick parallelism run at RUNTIME, after a chunk exists, and a ticked chunk is a *modified*
(saved) chunk anyway. The real reasons Async stays out are two OTHER ones:

1. **In-tick parity.** Vanilla ticks entities and blocks in one fixed order; parallelising makes
   their interactions (a mob grabbing an item, an arrow hitting a mob) a race. The charter forbids
   that for everything but worldgen/render.
2. **No SharedArrayBuffer.** Live-world parallelism needs shared mutable memory across threads. The
   only browser primitive, SharedArrayBuffer, requires cross-origin isolation (COOP/COEP response
   headers) and so is unavailable to a double-clicked `file://` file (Hard constraint 2). `file://`
   is a *secure context* but never *cross-origin isolated*; the coi-serviceworker header trick can't
   register a service worker from `file://`; the `WebAssembly.Memory({shared:true})` back-door is
   closed and would trip "no WASM" (Hard constraint 4) anyway; no public flag re-enables it (2026).

▶ **So: parallelise generation, meshing and lighting (C2ME-shaped, deterministic pure functions —
D-14). Do NOT parallelise entity ticks, random ticks or mob spawning.** The one sliver that COULD
fit the pure-function pattern — offloading a read-only spawn-candidate SCAN — was measured in a
controlled experiment (`tools/_asyncspawnexp.mjs`): the pattern frees main-thread time on a HEAVY
scan (50.9 → 5.7 ms main-thread), but MC-Lite's actual spawn is a ~0.1 ms random SAMPLE, so an
offload would be a ~57× net loss. Nothing here is scan-heavy, so nothing is built;
`tools/asyncguardcheck.mjs` guards the ruling. Full record: **D-453**.

Also worth knowing: **Async is alpha**, its own page warns of incorrect entity behaviour and
crashes, and **Moonrise is incompatible with it** because they fight over the same ticking.

### FerriteCore — memory ◐ structurally already done
Palette + packed indices per section, uniform sections collapsing to nothing — MC-Lite
already does the FerriteCore thing where it counts. The remaining analogue is the texture
and model side, which matters more once the full 1.18 roster and its atlas land (D-4/D-6).
⚠ **Do not optimise memory before measuring it.**

### ImmediatelyFast ❌ inapplicable
Batches immediate-mode rendering. Neither engine has an immediate-mode path to batch.

### Alternate Current, Tectonic, JEI, Controlling, AppleSkin — not perf questions
Alternate Current deliberately *fixes* a vanilla redstone bug, which is a parity failure
under D-1. Tectonic moves every block by design. JEI/Controlling/AppleSkin are UI features,
and under D-8 they would have to match vanilla's screens exactly — so they are content
decisions, not performance ones.

## What this means for the plan

1. **C2ME-style parallelism, including lighting** — locked (D-14).
2. **Lithium's discipline** applied to every parity system: cache what vanilla recomputes.
3. **Sodium's visibility graph** as the next rendering win after the current perf pass.
4. **Starlight-shaped lighting is allowed**, but only after lighting looks right.
5. **No parallel entity ticks / async random ticks / mob spawning** — ruled out by in-tick
   parity AND no SharedArrayBuffer from `file://`, and measured a net loss for the one
   pattern-compatible sliver (D-453). The read-only-scan offload pattern is D-14's and stays
   available for any future scan-heavy subsystem.

## Source

Dan's MineHTML project, its own `MODS.md` (24.5 KB), read 6 Sept 2026, read-only.
Its sections 1 and 1b are the substantive analysis; this document is the MC-Lite
translation, not a replacement.
