# #2337 KW-CULL-B: the browser side shows no invisible faces (4 Oct 2026)

Browser half of #1889. Ran `livemeshcheck` in full (no --fast) on Chromium, WebGL2, mesh workers on,
MCLITE_PRESET=medium, rd 12. It passed twice through the suite (18/18 checks, 18 breaks caught) and once
directly (6 breaks caught).

- Renderer meshes compared with a from-scratch CPU `Mesher.mesh`. The comparison covers the covered area per
  face direction and the model-quad count, so geom-2 model-path cube blocks are included. It found **0**
  missing, stale, extra or shade differences in 2254 mid-flight section audits (187 rounds) and 729 settled
  sections at the end.
- The worker occluder table matches the main thread's table for 2907 states, with 0 differences.
- The occlusion flood misses 2 of 833 sections and 3 of 473 after breaks. Both are under the 1% that
  livemeshcheck already allows because vanilla's section graph is coarser than true sight-lines.
- Unlit faces: nothing drops a face because its light is 0. The model pass (`05_mesher.js`, geom 2) culls
  on `culls[]` and `selfCull[]` only and reads light just to shade the face. The only shader `discard` is
  the atlas alpha cutout (`06_atlas.js`). A light-0 face renders black, which is correct; it is not dropped.
- Unsettled sections are in flight by definition. The mid-flight audit ran 187 rounds and none of them
  diverged.

Outcome: no browser-only culling defect could be reproduced. If Dan sees a hole again, the next lead is a
`/ss` of that exact case. Read it against vanilla 1.18.2 `Block.shouldRenderFace` with cullpairaudit.
