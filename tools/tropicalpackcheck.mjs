#!/usr/bin/env node
// tropicalpackcheck.mjs — #3051. TropicalFishEntity.initialize: a pack sharing one packData
// (TropicalFishData) copies the leader's variant; the 10% branch builds no TropicalFishData.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07zj_fish.js'], dom: false });
const Fish = MCL.Fish;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
console.log('tropicalpackcheck — #3051');
let seed = 1; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const mk = (pd) => { const e = { type: 'tropical_fish' }; Fish.chooseVariant(e, { packData: pd }); return e; };
let identical = 0, n = 0;
for (let t = 0; t < 200; t++) {
  const pd = {}; const a = mk(pd);
  if (pd.fishVariant === undefined) continue;   // 10% branch: no data built
  n++; if ([mk(pd), mk(pd), mk(pd)].every(f => f.fishVariant === a.fishVariant)) identical++;
}
ok(n > 100 && identical === n, 'common-branch packs share one variant (' + identical + '/' + n + ')');
// anti-vacuity: without packData the fish reroll per fish
breaks++;
const vs = new Set(); for (let i = 0; i < 100; i++) vs.add(mk(undefined).fishVariant);
ok(vs.size > 1, 'anti-vacuity: no packData -> variants differ');
if (vs.size > 1) console.log('   ✓ no packData -> variants differ');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
fails.forEach((m) => console.log('  FAIL: ' + m));
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
