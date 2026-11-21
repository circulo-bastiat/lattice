# #11400 - menu text "underlines" and stale assets

- Cause found in code: `drawRun` blitted each glyph quad at fractional device coordinates (fractional dpr, centred text), so the
  quad sampled a neighbouring atlas row = a 1px line. Fix: `G.snap` per glyph quad (landed earlier on this issue).
- `tools/menutextcheck.mjs` (browser, real Gui font sheet): every label on Title, Options, Select World, Create New World, at GUI scale 1-4 x
  dpr 1/1.25/1.5/2 x fractional origins; any device pixel outside the glyph's own ink rows (+shadow) that is not background fails.
  Fails on the unsnapped code (569 of 1872 renders), passes on the fix. `textsnapcheck` stays as the fast stub-canvas guard.
- Stale assets class fix: `gen-data.mjs` writes `assets/.gen-stamp.json` (hash of every extract-/pack-/build-/gen-/merge-/bake- tool);
  `build.mjs` refuses when the generators on disk differ or the stamp is missing (override: `MCLITE_ALLOW_STALE_ASSETS=1`).
  `go.mjs` treats an assets/ without the stamp as not ready and regenerates. Guard: `tools/assetstampcheck.mjs` (core).
- Not done: screenshots, and the same-commit regenerate-vs-Dan's-old-assets A/B (his assets/ is not on this runner).
- Known hole: running `gen-data` alone re-stamps, so it can vouch for a generator output you did not rerun.
