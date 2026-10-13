# #407 — light face-shape test: full faces only, partial unions ruled out

The face-shape rule of `ChunkLightProvider.getPropagatedLevel` is implemented since #357
(`SR.sideMask`, `faceBlocked` in `src/08_lighting.js`, both channels, `Gen.lightPass`): a state that is
opaque and hasSidedTransparency blocks light through any face its culling shape covers completely.

**Ruling:** vanilla's `unionCoversFullCube(a, b)` also blocks when two PARTIAL faces together cover the
whole face (bottom slab beside top slab, two stairs' L-shaped sides). MC-Lite does not do this. It needs
per-state per-face shape rectangles, not the 6-bit `Reg.occlusion` mask. Lighting is on the cheap side of
the line (CLAUDE.md), the effect is a lit cell behind a partial-face seam, and no survival mechanic reads
it (mob spawning reads light, but through the same seam vanilla builds are rare). A deviation, not a bug.
Revisit only if the referee (`vanillacheck`) shows light diffs at such seams.
