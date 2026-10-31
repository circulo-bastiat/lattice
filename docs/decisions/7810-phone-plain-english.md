# 7810 phone app E: plain English (partial)
Plain-words helpers live in `ui.js` (no new file, so build/sw/check file lists are untouched): `GLOSSARY` + `Help()` ("?" opens a sheet), `outcomeWord()`, `CONSEQUENCE`, `twoTap()`.
Done: raw HTTP text no longer reaches the screen (4 catch sites use `UI.plain`); Pause the fill now has a two-tap confirm with its consequence; "?" on the fill controls; `phonecopycheck` (6 breaks caught).
Owed: Home cards (Needs you, Workers, Usage rings with pace tick, Lander, Landed today), Runs outcome chips/filters/Stats sheet, restyle of Controls/Requests, onboarding steps with progress dots, "?" on every other card, `outcomeWord` wired into the run list.
`phonestatscheck` fails on master already ("deploy.mjs does not publish the landed master"), not from this change.
