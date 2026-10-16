# MC-Lite — standing brief

## ▶ Dan says `cloud session` or `loop session` → read `RUN.md` and do what it says. Nothing else.

`RUN.md` is the only instruction file and wins over every other document. `node tools/go.mjs start` sets up,
claims the next GitHub issue (Track G phase order) and prints the brief; `node tools/go.mjs done` hands off or
queues the PR for the lander. There is no other bookkeeping.

## What this is

A browser Minecraft-alike that ships as **one self-contained `.html` file**, opened by
double-clicking, built to run on low-end hardware. Dan's second voxel project (not MineHTML; no shared code).

## The governing principle

> "This isn't supposed to be a knockoff. It's supposed to cut down on the expensive part
> while keeping the inexpensive parts perfectly."
> — Dan, 6 Sept 2026

That sentence decides almost every argument this project will have. Concretely:

| Area | Standard |
|---|---|
| Worldgen | **Cheap.** The "middle path": modern silhouette, cheap implementation. Deviating here is correct and intended — but a deviation is a RULING with a decision number, not an unexplained ratio. |
| Rendering | **Cheap, maybe.** Sodium-style tricks, aggressive culling, tiered quality. The picture should read as Minecraft; the method need not match. |
| **Everything else** | **ABSOLUTE FULL PARITY.** Not "close". Not "good enough". Dan said "I really mean that." |

"Everything else" includes: GUI, inventories, crafting, the survival loop, damage, hunger,
gamemodes, block/item behaviour, sounds, and mobs.

The reasoning: "everything else" is **cheap at runtime** (tables, rules, 2D drawing), so exactness costs
dev time not frames; terrain, meshing and lighting are the expensive parts, where MC-Lite may be clever.

**When in doubt: does real Minecraft do it? If yes, and it is not worldgen or rendering,
do it exactly.**

## Hard constraints — not preferences

1. **One self-contained `.html` file.** No external files, no CDN, no `fetch()` at runtime.
2. **It runs from `file://`.** Opened by double-clicking. So: no ES modules, workers only
   from Blob URLs, no `SharedArrayBuffer`, all assets embedded. This is the single most
   common way to break this project.
3. **WebGPU with a WebGL2 fallback.** Both must work and must render identically.
   WebGL2 is the default: WebGPU draws the world black on real hardware (F9 switches).
4. **Pure JS, no WASM.**
5. **World range −64 to 256**, deep dark preserved.
6. Target hardware ladder: 7600 → 3600 → 2200G → Celeron. The **2200G is the real target**.

## Where things are

```
mclite/
  dist/mclite.html   the shipped file - this is the deliverable, and `build.mjs` writes it
  src/               numbered modules; build.mjs concatenates them
  src/workers/       worker sources, inlined as strings by the build
  tools/             the checks. Run them. They are the only proof anything works.
  docs/              DECISIONS (frozen), decisions/ (one file each), archive/ (PLAN, ARCH, REFEREE, the old docs)
  assets/            GENERATED. Regenerated in ten seconds; never preserved between sessions (D-6)
  build.mjs          -> dist/mclite.html.  Always run it. It must exit 0.
  .mcdata/           GENERATED vanilla data cache, gitignored. `node tools/fetch-vanilla-data.mjs`
```

**This folder is the synced copy; work happens in a private clone** (`go.mjs start` makes it). Never write a
generated file into git (`.gitignore`, D-6).

## The one thing about this codebase that will surprise you

**A block id here is a registry REAL STATE** — one of 20,344 states of 1.18.2's 900 blocks, so
`oak_stairs` facing east in the bottom half and not waterlogged is one number. Section palettes,
the mesher's scratch volume, `World.getBlock`, the save file and the hotbar all hold one.

`src/02c_states.js` is the table every hot loop indexes by it; read its header before touching the
mesher, the worldgen or the save format. **State 0 is air by construction** (D-103), and **nothing
works before `NS.Reg.init()`** — on the main thread and in every worker.

## How to work on it

- **Mail first:** a bus message addressed to you is answered (`go.mjs reply`) before anything else (RUN.md).
- Work in the private clone `go.mjs start` prints, on the issue it claimed. Never on master, never in the synced folder.
- `node build.mjs` after every change (must exit 0); `node tools/suite.mjs --fast --only <checks>` as you go.
  `--core` is the lander's gate (the --fast set minus `tools/quarantine.json`). Browser stages run at
  `MCLITE_PRESET=medium`; the full suite with every browser stage runs on Dan's GPU for every new master.
- ⚠ **THERE IS A REAL VANILLA REFEREE — USE IT** (D-199). `tools/vanillacheck.mjs` compares this engine against
  chunks the real 1.18.2 server generated. Vanilla facts come from `.decomp/`, the extractors or the referee.
- **An open phase issue is what is still owed, not the whole phase** - most of it is built (entities, mob AI, spawning,
  combat exist). Check `src/` and the core checks before saying anything is missing.
- A new check is its own `tools/stages.d/<id>.json` and proves it can fail (anti-vacuity, D-30).
- **Surgical edits.** Never rewrite a file wholesale to make a small change.
- Parallel work inside a session goes through the **Workflow** tool only (Dan, 8 Sept 2026).
- A decision worth keeping is one file, `docs/decisions/<issue>-<slug>.md`. `docs/DECISIONS.md` is frozen history
  (D-1..D-8xx): look a number up when code cites it, never read it whole.

## Session close-out

`node tools/go.mjs done --msg "…" --try "…" [--finished]` (RUN.md step 4). The lander builds, tests and merges.
