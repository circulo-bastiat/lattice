# #19 — the survival rules are written once, against a level (KW-25)

**Ruling.** `NS.Survive` (`src/02k_survive.js`, SHARED, so it is in the worker bundle) holds vanilla's
`canSurvive` rules as they were in `07_world.js`, written against a LEVEL: `getBlock`, `loadedAt`,
`tag`, `light`, `sky` (`-1` = "this level cannot answer"). `World` is the live level; `Features.supported`
is the worldgen level over the scratch buffer. Both doors now ask the jar rule FIRST and the support
class second, so worldgen can no longer write what the first edit beside it would break.

**Decided with it (the two questions the issue carried):**
- *Does the shared module go into the worker bundle?* Yes: it is small, has no DOM and no tag registry
  of its own. The build.mjs argument that "no worker asks a tag question" stays true because the worker
  level answers tags out of `worldgen.bin`, not `02f_tags.js`.
- *What does worldgen answer for tags and light?* Tags: the eleven the rules name (`RULE_TAGS` in
  `tools/pack-worldgen.mjs`, indexed by `States.inRuleTag`), asserted equal to the rule source and to
  `Tags.stateIn` for every state by `tools/survivegatecheck.mjs`. Light: `-1` — the rule answers "no
  opinion" and the class decides; the mushroom's light half stays where D-241 put it (`featureSurvives`).
- *Rule 29 (big dripleaf stem) is not asked at write time*: `block_column` writes upward with
  `setBlock`, never `canSurvive`, so the stem is written before the head above it exists.

**Three real bugs the gate found (vanilla read from `.decomp/`):**
- `04k_feat_trees.js` picked vine/cocoa/bee-nest states by hand-computed local index in declaration
  order; vanilla sorts a block's properties BY NAME, so south-facing vines were `up` and east-facing were
  `south`. States are now built with `States.withProp`.
- Rule 35 (vine) refused on the first dead face; `VineBlock.canPlaceAt` drops dead faces and keeps the
  vine while ANY is good (lichen, `MultifaceGrowthBlock`, is all-or-nothing and stays so).
- Rule 13 asked the GROUND of small dripleaf's upper half; vanilla sends the upper half to the
  double-plant question (same block below, lower half).

**Residue (measured, printed, not asserted):** 2 feature blocks per 121 chunks below sea level
(a glow lichen, a vine) — the carver-cut approximation `04j`'s header already names, and vine columns
whose upper cells a later tree's leaves overwrote, which vanilla's decoration order does too. The
pre-#19 count on the same chunks was 147. The calcite geode cell in carved air is its own question.
