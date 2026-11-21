# 11229 / #11245 — the multi-world store

**Ruling.** Worlds live in IndexedDB `mclite.worlds`, store `worlds`, keyPath `id`. One record per world:
`{id, name, seed (64-bit string), lastPlayed, gameMode, difficulty, version ('1.18.2'), payload}`.
`payload` is the exact string `Save.save` already writes (chunk edits, player, gamerules, …), so the save
format (v5) is unchanged and `Save.load` is untouched.

**Why a localStorage hot slot stays.** `Save.load` runs synchronously at boot and `beforeunload` saves must be
synchronous; IndexedDB is async. The ACTIVE world's payload therefore also sits in `mclite.world` (Save.KEY),
its id in `mclite.worlds.active`. Every `Save.save` mirrors into the active record (writes are queued, the
active id captured at call time). `Worlds.open(id)` flushes the current world, installs the target payload in
the slot, sets `Save.frozen` (so unload/autosave cannot overwrite the swapped slot) and the caller reloads.

**Migration.** `Worlds.init()` at boot: a legacy single save with no world records becomes world 1, 'New World'.
`Save.reset` detaches, so the next save of a title-screen new world creates a fresh record.

**API** (Promises): list, create({name,seed,gameMode,difficulty}), open, rename, remove, duplicate (backup).
UI is #11229. `gameMode` in a created record is metadata only; a world's real mode is the player's in its payload.
Check: tools/worldsstorecheck.mjs (built page at file://).

## UI (#11229)
`src/15mw_selectworld.js` ports SelectWorldScreen / WorldListWidget / EditWorldScreen / the delete ConfirmScreen (layout from .decomp).
Singleplayer -> Select World (search box, list, Play Selected World, Create New World, Edit, Delete, Re-Create, Cancel).
Play = `Worlds.open(id)` + page reload with sessionStorage `mclite.autoplay` (boot presses Play), because a built world cannot be unbuilt.
Create New World = `Save.reset()` + the existing create panel; the first save makes the record, named "New World", "New World (2)", ...
Re-Create = `Worlds.create` with the same name/seed/mode, no edits. Edit World: rename, Make Backup (= duplicate); folder / optimize / icon /
export buttons are drawn disabled (no folder in a browser). Check: tools/selectworldcheck.mjs.
