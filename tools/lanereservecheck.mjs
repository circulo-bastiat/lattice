#!/usr/bin/env node
// lanereservecheck.mjs - #9735: the phase lane (#3948) runs again: fillReserve gives it the first free reserve worker slot (0 lane runs in 500 brain runs since
// per-account switches emptied the universal pool), as a 1-worker pack on the mirror tagged `pl` (counted as running), and a lane pack that finds nothing posts
// `noclaim: phase` which the fill turns into the 20-min hold. Wiring checks, each with its break.
import { readFileSync } from 'node:fs';
import { laneSlots, LANE } from './infra/phaselane.mjs';
const B = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8'), S = readFileSync(new URL('./infra/mirror/pack-slot.sh', import.meta.url), 'utf8');
let asserts = 0, fails = 0, breaks = 0; const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const CFG = { fill: { phaseLane: { workers: 1 } } };
ok(laneSlots(CFG, [], false) === 1 && laneSlots(CFG, [`brain worker @${LANE}`], false) === 0 && laneSlots(CFG, [], true) === 0, 'laneSlots: one lane, none while one runs or the lane is held');
const W = [
  ['fillReserve computes the lane over VM runs and mirror `pl` packs', B, /let laneOn = laneSlots\(CFG, \[\.\.\.\(runs \|\| \[\]\)\.map\([^\n]*Array\(mirrorLane\)\.fill\(`brain worker @\$\{LANE\}`\)\], noClaimHold\(LANE, now\)\);/],
  ['the lane takes the first free reserve worker slot', B, /if \(laneOn && \(p\.role \|\| 'worker'\) === 'worker' && p\.n > 0\) \{\n\s+laneOn = 0; p\.n -= 1;/],
  ['on the mirror the lane is a 1-worker pack tagged pl', B, /packPlan\(\{ n: 1, account: LANE \}\)\.map\(\(b\) => \(\{ \.\.\.b, inputs: \{ \.\.\.b\.inputs, pool: 'pl' \} \}\)\)/],
  ['mirror lane packs count as a running lane', B, /mirrorLane = mr\.filter\(\(r\) => \/\^worker-pack pl x\\d\+\$\/\.test/],
  ['a `noclaim: <account>` bus line becomes the hold of that pool (lane and every account)', B, /for \(const name of \[LANE, 'default', \.\.\.\(\(CFG\.accounts \|\| \[\]\)\.map\(\(a\) => a\.name\)\)\]\) \{[\s\S]{0,500}writeFileSync\(f, String\(nc\)\)/],
  ['pack-slot claims phase issues for the lane', S, /\[ "\$ACCOUNT" = phase \] && export MCLITE_LANE=phase/],
  ['pack-slot posts noclaim: <account> when a packed worker finds nothing', S, /pack_post "noclaim: \$\{ACCOUNT:-default\}/],
];
for (const [n, s, re] of W) { ok(re.test(s), n); const br = s.replace(re, 'X'); if (br !== s && !re.test(br)) { breaks++; console.log(`  ✓ wiring "${n}" removed is caught`); } }
console.log(`lanereservecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
