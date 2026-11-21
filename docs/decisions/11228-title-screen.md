# 11228 — the vanilla title screen is the root screen

- Ported from `TitleScreen.java` / `RotatingCubeMapRenderer.java` (.decomp): layout (y0 = height/4+48, 24-px rows, bottom row at y0+84), logo,
  edition, splash (date specials + `texts/splashes.txt`, shipped in the gui payload), version, copyright. Checked by `titlescreencheck` at GUI scales 1-3.
- **Panorama (ruling):** the 1.18.2 jar's six `panorama_N.png` are 1x1 stubs (RGB 98,111,113) and the overlay is transparent, so a cube map has nothing to
  project. The renderer keeps vanilla's clock (`time`, pitch = sin(t*0.001)*5+25, yaw = -t*0.1) and draws the stub colour with bands that travel with the yaw.
- **Quit Game (ruling):** a page cannot close itself unless a script opened it. Quit calls `window.close()` and, since the tab normally survives,
  shows a black "Minecraft has closed. You can close this tab." screen.
- **Singleplayer** opens the old seed/climate panel (now `Hud.drawCreateWorld`, with a Back button / Escape) until the world list (separate unit)
  replaces it; the climate/Earth toggle stays reachable there. **Multiplayer / Minecraft Realms** are drawn inactive (no networking, vanilla's
  `isMultiplayerEnabled == false` look). **Options... / language / accessibility** open the existing `NS.Options` screens; Done/Escape return to the title.
- The copyright line is drawn and hit-tested, but `CreditsScreen` does not exist yet (owed).
- #11244: `CreditsScreen` now exists (`src/15m_credits.js`, opened from the copyright line). Its background is a flat colour at vanilla's fade brightness because the options-background tile is not in the gui payload; the End path (end.txt) is not wired, postcredits.txt is.
