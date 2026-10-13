# #1397 — the red browser/node set of #1241, audited

Reproduced with real headless Chromium. The "leaked live mobs" theory was **wrong for becheck**; sorted:

- (a) leaked-mob class: **0** of the 3 stages still red. `becheck` already held `Spawn.ready=false` + `EntityList.clear()` (D-407).
- (b) real/stale-code bugs: **3**.
  - becheck "one entity drawn (5)", "no leftover geometry (4 drawn, 168 quads)", "in the frame buffer": the extras were never in
    EntityList - they are `ER.spawnerDisplays` (#168), the spinning mini-mobs of the generated world's own spawners in ER.RANGE.
    Fix: the check stubs `spawnerDisplays` (EL.clear can't reach virtual entries).
  - becheck "61 named items (62)": a pin that rotted; now `>= 61`.
  - bedcheck "storm was reset": test set `raining` only; vanilla gates resetWeather on isRaining() = rain gradient > 0.2; test sets rainLevel.
  - golemanimcheck: `ER.golemDelta` was defined twice (#730 `atk`, #733 `attack`); #733 shadowed it, the check still fed the dead one.
    Dead #730 code removed; check uses the live ctx keys. The game was never wrong.
- (c) flaky: **0** observed ("world finished streaming" passed on a rerun).
