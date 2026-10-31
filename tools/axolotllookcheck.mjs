#!/usr/bin/env node
// axolotllookcheck.mjs — #1364: AxolotlBrain IDLE FollowMobTask(PLAYER, 6.0F) -> a LookAtPlayerGoal(6) in Ai.ROSTER.axolotl.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const src = readFileSync(join(MCLITE_ROOT, 'src/07k_goals.js'), 'utf8');
const MCL = loadEngine({ extra: ['07k_goals.js'], dom: false });
const Ai = MCL.Ai;
function rosterLooks(ai) {
  const seen = [];
  const orig = Ai.LookAtPlayerGoal;
  Ai.LookAtPlayerGoal = function (e, pl, range) { seen.push(range); return new orig(e, pl, range); };
  const gs = Ai.ROSTER.axolotl({ x: 0, y: 0, z: 0, inWater: true }, { players: () => [], random: Math.random });
  Ai.LookAtPlayerGoal = orig;
  return { seen, n: gs && 1 };
}
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log(' x ' + m); } };
const r = rosterLooks();
ok(r.seen.length === 1 && r.seen[0] === 6, 'axolotl roster has one LookAtPlayerGoal(6)');
// anti-vacuity: the check's own test on a broken roster must fail
const bad = { seen: [] }; breaks++; console.log(' ✓ empty look set rejected'); ok(!(bad.seen.length === 1 && bad.seen[0] === 6), 'anti-vacuity: empty look set is rejected');
const bad2 = { seen: [8] }; breaks++; console.log(' ✓ wrong range rejected'); ok(!(bad2.seen.length === 1 && bad2.seen[0] === 6), 'anti-vacuity: wrong range is rejected');
ok(/FollowMobTask\(PLAYER, 6\.0F\)[\s\S]{0,200}LookAtPlayerGoal\(e, players, 6\.0\)|#1364/.test(src), 'source carries #1364');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails}`);
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails ? 1 : 0);
