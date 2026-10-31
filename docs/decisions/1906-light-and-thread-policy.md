# #1906 C2ME-8 — lighting off the main thread: CLOSED by measurement; thread policy ruling

## Light (from #1899, rd 12, seed 1337)
light + heightmap = **2.6% of chunk cost**, below the 5% threshold. Light for a fresh chunk is already computed inside the
worker's genColumn and delivered with the column; edit-time relight stays on main. Nothing to move. No code change.

## Thread policy
Existing Auto (D-36): `workers = clamp(cores - 1, 1, 4)`; ceiling `workersMax = cores` (D-428).
Data (1899 `--scaling`, rd 8, 6 cores): generation 6.1 s (1) -> 3.5/3.1/2.95 s (2/3/4) -> flat for 6/8; 1902 close-out: zero drift pool 1..8,
heap/worker 48 MB (pool 1) .. ~25 MB (pool 4-8). Gain stops at 3-4 workers, which Auto already yields on >= 5 cores, so the cap of 4 stands.
MineHTML's clamp(round(cores/3),2,6) would give 2 on a 6-core and 1->2 on 4 cores; ours (3 on 4 cores, 4 on 6+) matches the measured knee better.
Not re-measured on a real GPU/desktop ladder (7600/3600/2200G): this host has 4 shared cores.

## Owed
- Settings slider: show "cores left for main thread" (= cores - workers) and warn above the knee (workers > 4 or > cores-1).
- Workers report wanted/alive/busy-in-last-second + heap per worker (reporting is #1898).
