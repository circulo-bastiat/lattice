# 11247 — Resource Packs / Data Packs screen (PackScreen)

Ported from `.decomp/.../gui/screen/pack/{PackScreen,PackListWidget,ResourcePackOrganizer}.java` into `src/15fp_packs.js`
(`NS.PackScreen`; Options screens `packs` and `datapacks`). Lists 200 wide at `w/2-4-200` and `w/2+4`, top 32, rows 36, Done at `w/2+4, h-48, 150x20`.

Rulings:
- **Open Pack Folder** is a disabled button (`Options.OWED`): a browser page has no folder to open. Drag-and-drop copying (`filesDragged`, `DirectoryWatcher`) is not ported for the same reason.
- **Pack profiles are the built-in ones only**: the pinned, always-enabled `vanilla` pack for resources and for data (1.18.2 ships no other built-in data pack). Programmer Art is NOT offered: vanilla downloads it from the asset index and its description lives in a zip we do not have. The organizer logic (enable/disable/move/pinned rules, `InsertionPosition.insert`) is generic and is tested with injected profiles.
- Icons are a grey placeholder (the `unknown_pack.png` stand-in); the arrow sprite sheet is drawn as `> < ^ v` glyphs on the same 32x32 hover overlay and the same hit zones as `PackListWidget.mouseClicked`.
- **Done and Esc both apply** (`PackScreen.close()` is the only exit and calls `organizer.apply()`); Done is inactive while Selected is empty (`updatePackLists`).
- Applying persists the enabled names (lowest priority first) to `resourcePacks` / `dataPacks` in options. Textures are baked at build time (D-12), so an applied resource pack changes nothing visible.
- There is no filter box: 1.18.2's PackScreen has none.
- Data Packs is reached with `NS.PackScreen.open('data')` — #11230 calls that from Create New World.
