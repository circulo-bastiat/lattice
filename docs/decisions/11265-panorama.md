# 11265 — title panorama (RotatingCubeMapRenderer)

Supersedes the stub-colour ruling of #11228. `jars/1.18.2/panorama/panorama_0..5.png` are REAL 1024x1024 faces in this project's jar set
(the 1x1 stubs were only inside the .jar), so the panorama is real.

- `src/15m_title.js`: port of CubeMapRenderer/RotatingCubeMapRenderer: fov 85, pitch `sin(t*0.001)*5+25`, yaw `-t*0.1`, modelview RX(180)*RX(pitch)*RY(yaw),
  face quads from the decomp. Rasterised per pixel at ~w/4 (max 320 wide) and scaled up smoothed (stands in for the 4 blur passes); fade-in 1000 ms over black
  (TitleScreen's backgroundFadeStart); overlay drawn if it is not transparent.
- Source order (`tools/gen-panorama.mjs`, run by every `build.mjs`, writes gitignored `src/15m_panorama.gen.js`, faces box-downscaled to 256):
  1. `jars/1.18.2/panorama/panorama_N.png` (+ `panorama_overlay.png`)  2. the same files inside the jar  3. `tools/panorama-custom/panorama_0..5.png`,
  else ONE equirectangular photo `tools/panorama-custom/equirect.png` (or `node tools/gen-panorama.mjs --equirect photo.png`) converted to six faces  4. none real -> stub fill.
- Any face 1x1 = stub. All stubs: the screen keeps the stub colour and `panoramacheck` prints `PANORAMA STUBBED` (a skip, never green).
- `tools/png.mjs` now decodes packed (1/2/4-bit) palette PNGs (panorama_4 is 4-bit).
- `tools/panoramacheck.mjs`: synthetic six-colour faces, two screenshots 1 s apart, pixels changed and not flat; 3 breaks caught (frozen clock, no draw, identical frames).
