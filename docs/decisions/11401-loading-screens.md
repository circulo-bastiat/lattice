# #11401 — every loading/progress screen, and the stale-assets class

Dan, 12 Nov: "i still see some of the old loading screens".

## Audit: every screen the game can show between "page opened" and "playing" (walked in the built dist by `tools/loadingwalkcheck.mjs`)

| Moment | What is drawn | Vanilla source | Status |
|---|---|---|---|
| First boot, before the GUI atlas decodes | solid `#EF323D` fill, no text | `SplashOverlay` (MOJANG_RED; the logo texture is not embedded) | was the OLD "MC-Lite" bar screen (`H.drawLoading`) — removed in #11410 |
| Create New World / Play Selected World, before warm-up has a chunk grid | "Loading terrain..." on dirt | `DownloadingTerrainScreen` | vanilla |
| World warm-up | chunk-status map + "N%" | `LevelLoadingScreen` | vanilla |
| Pause > Save and Quit to Title | "Saving level" on dirt (the page then reloads) | `ProgressScreen` | vanilla |
| Nether/End portal, death > respawn, End exit | NO screen (instant teleport, no chunk load) | vanilla shows `DownloadingTerrainScreen` for a moment | not an old screen; owed only if Dan asks for the brief vanilla flash |
| Fatal error | `Hud.mode = 'fatal'` text panel | n/a | an error report, not a loading screen |

`Hud.mode` has exactly five values (`loading`, `saving`, `title`, `game`, `fatal`); `loadingwalkcheck` pins that and the three call sites of the Progress screens.

## Stale-assets hypothesis (from the issue)

The regenerated-assets build (`go.mjs start` regenerates `assets/` from this commit) still contained `H.drawLoading` with the "MC-Lite" bar, so the old screen was a game bug, not stale assets alone. The class is still real (Dan's assets were from 27 Oct, `build-gui.mjs` changed 7–8 Nov), so `build.mjs` now refuses when any `tools/extract-*.mjs` / `tools/build-*.mjs` is newer than the oldest `assets/*.bin` (warn only on CI; `MCLITE_ALLOW_STALE_ASSETS=1` overrides). Proven by `tools/staleassetscheck.mjs`.
