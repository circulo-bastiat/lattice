# #7809 phone app D: Mobs tab
- `tools/phone-web/mobs.js` (pure, node + browser) builds the list from `tools/mobproof/matrix.json` (contents API, 5 min cache in app.js) and the optional sign-off ledger `tools/mobproof/signoff.json` ({ mob: true }; absent = "not started" for all, #7540 owns it).
- State names come from `tools/mobproof.mjs` (green / red / missing). Any other state shows as grey-amber "unknown state" and is never counted done.
- "Proven" is recomputed from the rows, not read from the file's total; phonemobscheck asserts the two agree on the real file.
- Category (hostile/passive/neutral/boss/vehicle/projectile/other) is a hand-kept table in mobs.js: the repo has no roster category table. Unlisted mobs default to passive, so a new roster mob needs a line there.
- Owning issue per dimension is fixed (#7521 model .. #7525 spawn, #7526 lockstep lanes, #1535 goals, #7540 sign-off); "Open issue" searches the repo for the mob name. #7521's number is from the brief, not verified.
- Check: `phonemobscheck` (19 breaks caught). The existing phone checks now copy mobs.js into their temp builds.
