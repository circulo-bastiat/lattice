# 289 — G20 particle cost bench

`node tools/bench.mjs --profile low --particles` runs preset low with 8 smoke spawns/frame through
`Particle.spawn` under Particles All / Decreased / Minimal (`MCL.Bench.start({particles, particleLoad})`).

Result in the headless container (software GL, ~12 fps, so frame time is dominated by terrain):

| Particles | fps | meanMs | p95Ms |
|---|---|---|---|
| All | 12.7 | 78.7 | 204.6 |
| Decreased | 12.6 | 79.4 | 198.5 |
| Minimal | 13.2 | 76.0 | 196.4 |

Particle cost is inside run-to-run noise here (<=3 ms mean). The bench booted fine; the 45 s boot
timeout in the issue did not reproduce. A GPU-box run is still the number that matters for the 2200G.
