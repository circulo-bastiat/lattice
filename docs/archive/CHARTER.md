# CHARTER — what MC-Lite is for

## The one-line version

Cut the expensive parts down. Keep the cheap parts perfect.

## Where the line falls

**Expensive — allowed to be clever instead of faithful:**

- Terrain generation. Three cheap 2D noise fields through splines, not a 3D density stack.
- Meshing. Greedy meshing, palette-compressed sections, aggressive culling.
- Lighting. The cheapest thing that still *looks* like Minecraft.
- Draw submission. Batching, visibility graphs, frame budgeting.

These are expensive **per frame, forever**. A 5% fidelity loss here buys a machine that
can run the game at all. That trade is the entire reason this project exists.

**Cheap — must be exactly right:**

- The GUI. Inventory screens, crafting grids, the hotbar, the pause menu, the death
  screen, tooltips, the F3 overlay.
- Inventories and crafting. The real recipe set, real stacking rules, real furnace fuel
  values, real drag-splitting behaviour.
- The survival loop. Hearts, hunger, saturation, exhaustion, damage types, death,
  respawn, XP.
- Gamemodes. Creative, survival, spectator, with the correct rules in each.
- Block and item behaviour. Break times, tool tiers, drops, placement rules.
- Mobs, when they come.
- Sounds.

These cost **tables and 2D drawing**. Being exactly right costs development time and
almost no frames. There is no performance argument for approximating them, so there is
no excuse for approximating them.

## The test

> Does real Minecraft do it?

If yes, and it is not worldgen or rendering: **do it exactly.**
If yes, and it is worldgen or rendering: do the cheapest thing that reads the same.
If no: do not add it, unless it is an optional switch that changes nothing observable.

## Version target

**1.18.** Chosen because MC-Lite is doing big caves, and 1.18 is where the cave and cliff
generation landed. The block roster target is **all of 1.18's block states**, not a
survival-relevant subset — Dan asked for the full set explicitly.

## Audience

Dan and a few friends. Non-commercial, no redistribution. That is why using his own game's
texture assets locally is reasonable, and why they stay out of anything shareable.

---

# The three parities, and the rule — adapted from MineHTML's Track C

MineHTML's `plan/PLAN.md` §7c is its "Celeron mode" plan, and it is the sharpest thing
either project has written about what "cheaper" is allowed to mean. It exists there as a
*future* track. Here it is the **present tense** — it is what MC-Lite is.

## Every performance conversation conflates three different claims

| | the claim | what it means | does MC-Lite keep it? |
|---|---|---|---|
| **Hard parity** | same seed in → **byte-identical** world out vs real Minecraft | a block-by-block diff passes | ❌ **No — worldgen and rendering give this up, and ONLY these** |
| **Soft parity** | **statistically indistinguishable** — same biome shapes, ore density per depth, tree spacing, cave volume | a screenshot passes; a diff does not | ✅ **Yes** |
| **Coherence** | the world **obeys its own rules** — rivers reach the sea, caves connect, trees stand on dirt, ore sits in stone, nothing floats or is half-built | not a comparison to Minecraft at all; a self-consistency bar | ✅ **Yes, absolutely, no exceptions** |

▶ **A change that touches only the first row is in scope. A change that touches the third
row is not a cheap implementation — it is a bug**, on any machine, at any quality preset.

That distinction is what stops "MC-Lite doesn't need parity" from becoming an excuse.
Everything outside worldgen and rendering keeps **all three**.

## RULE 1 — cite this by name

> **Every approximation must REPLACE one deterministic rule with a cheaper deterministic
> rule. It may NEVER DELETE an invariant.**
>
> ✅ **Allowed:** compute a leaf's distance-from-log with a cheap local scan instead of a
> full relaxation — still deterministic, still always 1..7, still lower near logs.
>
> ❌ **Not allowed:** skip leaf distances entirely. Now leaves decay wrongly and the world
> contradicts itself.

Grade every cheap implementation against that one sentence before anything else.
The coherence row above is Rule 1 restated as a category instead of an example.

## Quality presets are a PROFILE, never scattered `if`s

MineHTML's §7c.3, and it is non-negotiable here too:

> Celeron mode is not `if` statements sprinkled through the engine. That shape is how a
> speed change quietly becomes a correctness change six months later, with nobody able to
> say which line did it.

So: a **profile** is one object chosen at boot, holding **swappable named strategies** —
lattice step, octave count, feature scaling, meshing style, culling, resolution scale,
lighting method. The presets ("Celeron", "Low", "Medium", "High") select a profile; they
do not branch through the code.

✅ **Done, session 2 (F9 / D-27).** The presets are one object resolved at boot in
`src/16_settings.js` — render distance, DPR, AO, mips, leaves, worker count, chunk cap — and
`docs/PROFILE.md` records what each tier measured. The audit happened before the roster work,
which was the point: retrofitting a profile boundary after 900 blocks and a non-cube mesher have
grown `if (tier < 2)` through them is enormously more expensive than doing it first.

**And MC-Lite's determinism requirement gives the profile boundary a second job**: the
save format regenerates unmodified chunks from the seed (`docs/ARCH.md`), and structures
are decidable from `(seed, chunk)` alone (`docs/STRUCTURES.md`). So a profile may change
*how expensive* generation is, but **a given profile must be deterministic**, and changing
profile must be treated as changing world — or saves silently rot.

## Source

Dan's MineHTML project, `plan/PLAN.md` §7c (Track C, filed 20 Aug 2026), read 6 Sept 2026,
read-only. Its framing; MC-Lite's application.
