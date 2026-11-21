# ASSETS — where the blocks and textures actually come from

## The finding, 6 Sept 2026

Dan's own installed jars carry the entire block roster as data — blockstates, models and
textures, one file per thing. The target is 1.18.2 (D-2); `docs/JAR-INVENTORY.md` has the
measured counts. That changed the plan for the block roster completely.

## Do not hand-write 800 blocks

The naive reading of "all of 1.18's block states" is a registry typed out by hand. That
is weeks of work, it will be wrong in a hundred small ways, and every one of those ways
is a parity bug in exactly the area the charter says must be perfect.

**Generate it instead.** The blockstates and model JSON files *are* the specification:
which blocks exist, which states each has, which model each state uses, what geometry
that model has, which texture goes on which face, and how it rotates. Mojang already
wrote the answer down. Parsing it is a build step, not a research project.

This is the single highest-leverage decision available on the block roster, and it is
also the honest one — a generated registry cannot quietly disagree with the real game
the way a typed one will.

### The pipeline

⚠ **This section was written in session 1 as a PLAN and the pipeline that got built is not
shaped like it.** The names below are what actually run; `tools/suite.mjs` lists them in order
and is the authority.

```
his .minecraft jars (1.18.2 + 1.13.2)
  -> tools/extract-blocks.mjs      read the zip, no external deps: the roster and every state
  -> tools/build-atlas.mjs         resolve model inheritance, collect every texture referenced
  -> tools/bake-geometry.mjs       elements, faces, uv, rotation, uvlock, cullface, tint —
                                   resolved at BUILD time into 4,027 parts / 41,389 quads
  -> tools/extract-items.mjs       1,235 item models
  -> tools/pack-geometry.mjs       the binary pack, round-trip verified
  -> tools/pack-runtime.mjs        -> src/19_data.gen.js, the registry, never hand-edited
  -> assets/atlas.*                deduplicated texture atlas + tile index
```

✅ **The mesher's non-cube path exists and is verified.** Session 1 wrote here that "today it
only knows full cubes"; F8 closed that — the MODEL stream carries 17,356 of the 20,344 real
states, `meshcheck` covers the round trip (1,269 assertions) and `tools/mesh-reference.mjs`
compares 23 hand-written cases quad by quad against the baked output. The render audit in
PLAN §23 then found every one of those faces was wound inside out, which is a different
lesson and worth reading.

## Textures — the era problem, stated honestly

Dan wants the **pre-1.14** look ("the old ones"). Two facts collide:

1. `1.13.2.jar` is installed and is a required build input: **64% of the atlas's 768 layers
   come from it** (502 of 781 requested tiles; `build-atlas.mjs` prints it), and every fallback
   to a modern texture is named in the build's own report. The target is 1.18.2 (D-2) and the
   atlas is the 1.13.2 look over it.
2. **Mojang's "Programmer Art" pack is bundled in no jar on the machine** — checked, zero
   entries. It shipped as a built-in from 1.14 until it was dropped, and it would have been the
   perfect answer: the old textures, maintained to cover modern blocks.
3. Even with a 1.13.2 jar, **blocks added after 1.13 have no old texture** — deepslate,
   copper, amethyst, sculk, the whole 1.17/1.18 cave set. A pure pre-1.14 atlas cannot
   cover a 1.18 roster. There is no way around this; it is a fact about the world.

**The resolution:** old textures where they exist, modern textures for blocks that did
not exist then. Record which came from where so the seam is visible and deliberate rather
than a mystery.

✅ **1.13.2 is installed** (session 1) and is a required build input. ⚠ **No tool may hard-code
where the jars live** — `tools/paths.mjs` probes `MCLITE_JARS`, a gitignored
`mclite.config.json` and the launcher `versions` folders on all three platforms, in both the
flat and nested layouts. See `docs/JAR-INVENTORY.md` for why that exists.

## "Exact quality, smaller in the game"

The requirement is lossless — the pixels must be the old pixels. So:

1. **Deduplicate.** Many blocks share tiles; hash every 16x16 and pack uniques only.
2. **Shared indexed palette.** Old Minecraft textures use very few distinct colours across
   the whole set. One global palette turns 24-bit RGBA into 8-bit indices before any
   image compression runs.
3. **Lossless WebP** for the atlas, not PNG. Typically 30-50% smaller at identical pixels.
4. **Base64** costs a flat +33% on whatever survives. Budget for it.

Measure and report the real number. Do not claim a saving that was not measured.

## Licensing

The assets come from Dan's own installed copy, on his own machine, for a project whose
audience is him and a few friends: non-commercial, no redistribution. The atlas build is
a **local step**, and the generated atlas is not committed anywhere shareable. If MC-Lite
is ever distributed, the atlas has to be rebuilt from freely-licensed textures first.
Keep `assets/` out of any public repo, and keep the build able to run without it.
