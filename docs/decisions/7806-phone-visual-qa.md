# 7806 - phone app A: visual QA harness

- `tools/phone-web/qa/serve.mjs`: built site + deterministic mock GitHub (40 issues in all states incl. long titles, 8 runs, 2 usage accounts, real mobproof matrix, 3 requests).
- `qa/shoot.mjs`: every screen in `qa/screens.json` at 360x640 / 390x844 / 430x932, dark + light, PNGs in `_status/phone-shots/` + `report.json`; rules hscroll, tap (44px), contrast (4.5/3), font (14px, captions 12px = `.cap`/`<small>`), clip, bar (content clears the bottom bar), safe (env(safe-area-inset-bottom)).
- Uses `tools/cdp.mjs` (Chromium over CDP), not Playwright: Playwright is not installed on the runners, and phonerunscheck already works this way.
- Mobile emulation widens `innerWidth` when a page overflows, so the audit is given the requested width instead of reading it back.
- **Baseline**: the 31 violations the app has today are frozen in `qa/baseline.json` (screen|rule|selector). The check fails only on NEW ones; B..E shrink the baseline with `node tools/phone-web/qa/shoot.mjs --update-baseline`. A later issue adds a screen by adding a line to `screens.json`.
- `phonevisualcheck` breaks (injected into a copy of the build): 600px element, 30px button, light-grey-on-white, 300-char unbroken title, content under the bar - 5 breaks caught.
- Cost ~65 s matrix + ~25 s breaks (> 90 s): kind `browser`, runs on the mirror full run, not in `--core`.
- Not checked: touch-only behaviours (pull-to-refresh), real iOS safe-area insets (only that the stylesheet uses them).
