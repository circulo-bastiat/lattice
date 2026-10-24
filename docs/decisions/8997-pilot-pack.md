# #8997 — pilot pack: 2 salts per hosted job is the default

Lanes cow and skeleton, salts 0..19, via `mirror.mjs pilot`, PACK=1 vs PACK=2 (plus a second PACK=1 skeleton run as a noise baseline).
Time: cow 292 s (P1) / 307 s (P2); skeleton 737 s (P1) / PACK=2 similar-order (mirror queue noise).

| lane | salts differing between P1 and P2 | same salts differing between two P1 runs |
|---|---|---|
| cow | 2, 15, 19 (2/19 only swap a/b; 15 same flips) | known server-unstable (2, 15 per #8628) |
| skeleton | 2, 15, 16, 19 | 2, 15, 16, 19 (identical set) |

Every other salt (17 cow, 16 skeleton) gives identical (same, a, b) in both modes. Every difference is on a salt where the real server
disagrees with itself run to run (skeleton P1 vs P1 differs on exactly the same four), so no STABLE salt differs: PACK=2 is the default
(`pilotPack()` in tools/infra/mirror.mjs; `MCLITE_PILOT_PACK=1` restores one salt per job). A pilot takes 11 mirror jobs instead of 21.
Check: tools/pilotpackcheck.mjs (field 5 of .pilot-args for unset/1/2).
