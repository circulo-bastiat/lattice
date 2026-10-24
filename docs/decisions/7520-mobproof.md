# #7520 Mob proof matrix

A mob is PROVEN while all 7 dimensions are green on the latest full run: model, texture, animation, drops, spawn, lockstep, goals.
Replaces the audit-erase rule.

## Schema (dimension issues emit exactly this)
`tools/mobproof/out/<dimension>.json` (gitignored): `{ "<mob>": { "pass": bool, "checked": [..], "notCovered": [..], "failed": [..quoted rows..] } }`
for every mob in `tools/mobl3-mobs.json` (91). Absent file, absent mob, or non-boolean `pass` = MISSING (never green).
Extra rules: lockstep needs `tools/referee/lanes.d/*.json` with `"mob"`; goals is red while the mob has a key in `tools/goalaudit-known.json` `filed`.
`notCovered` lives in a shrink-only ledger per dimension.

## Outputs
`node tools/mobproof.mjs` -> `tools/mobproof/matrix.json` + `matrix.md`. `tools/mobproof-proven.json` is the committed proven list;
`full.mjs` (applyProven) opens `PROVEN <mob> regressed: <dimension>` (severe, 01 BUGS, deduped by title) and removes the mark; newly green mobs are added.
`go.mjs status` prints `proven N/91`. Check: `mobproofcheck`. Gate M (#585) closes only at proven = roster.
