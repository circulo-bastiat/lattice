#!/usr/bin/env node
// pilotmirrorcheck.mjs - #7585: lockstep pilot salts run one per hosted job on the public test mirror (ci-pilot.yml); a missing, foreign or
// garbled result must never count as a pass. Behaviour tests of acceptPilotResult, wiring rules over the real files, then anti-vacuity.
import { readFileSync } from 'node:fs';
import { acceptPilotResult } from './infra/mirror.mjs';
let asserts = 0, fails = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const files = { ci: rd('infra/mirror/ci-pilot.yml'), mirror: rd('infra/mirror.mjs'), pilot: rd('referee/lockstep/pilot.mjs') };
const good = JSON.stringify({ lane: 'cow', salt: 3, same: true, a: 'abcdef012345', b: 'abcdef012345' });
const behave = (accept) => [
  ['a matching result is accepted', !!accept(good, 'cow', 3)],
  ['a missing result is nothing', !accept('', 'cow', 3) && !accept(null, 'cow', 3)],
  ['a foreign salt is nothing', !accept(good, 'cow', 4)],
  ['a foreign lane is nothing', !accept(good, 'zombie', 3)],
  ['a result without hashes is nothing', !accept(JSON.stringify({ lane: 'cow', salt: 3, same: true }), 'cow', 3)],
  ['a non-boolean verdict is nothing', !accept(JSON.stringify({ lane: 'cow', salt: 3, same: 'yes', a: 'abcdef012345', b: 'abcdef012345' }), 'cow', 3)],
];
const RULES = [
  ['ci-pilot runs only on p/**', 'ci', /branches: \['p\/\*\*'\]/],
  ['ci-pilot has 20 jobs', 'ci', /i: \[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19\]/],
  ['each job runs pilot --one for its own salt', 'ci', /pilot\.mjs --one "\$lane:\$\(\(from \+ i\)\)"/],
  ['the jar comes from the private store secret', 'ci', /secrets\.STORE_URL/],
  ['each job reports on r/<id>.<i>', 'ci', /refs\/heads\/r\/\$id\.\$i/],
  ['the report step always runs', 'ci', /name: report\n\s+if: always\(\)/],
  ['mirror.mjs publishes ci-pilot.yml', 'mirror', /'workflows', 'ci-pilot\.yml'\), readFileSync/],
  ['runPilot deletes every r/<id>.<i> branch', 'mirror', /refs\/heads\/\$\{br\}`\)\.catch/],
  ['runPilot validates through acceptPilotResult', 'mirror', /const r = c && c\.content \? acceptPilotResult\(/],
  ['mirror.mjs has a `pilot` command', 'mirror', /cmd === 'pilot'/],
  ['pilot.mjs has --remote mirror', 'pilot', /'--remote', process\.env\.MCLITE_PILOT_REMOTE/],
  ['an unreachable mirror falls back to running here', 'pilot', /mirror unavailable \([^\n]*running here/],
  ['remote results go to the same cache and shared dirs', 'pilot', /for \(const d of \[cacheDir, sharedDir\]\)/],
];
for (const [m, v] of behave(acceptPilotResult)) ok(v, m);
for (const [name, f, re] of RULES) ok(re.test(files[f]), name);
// anti-vacuity: each rule must fail without what it demands; a lenient acceptor must fail the behaviour tests
let breaks = 0, missed = 0;
for (const [name, f, re] of RULES) { const m = files[f].match(re); if (m && !re.test(files[f].replace(m[0], ''))) { breaks++; console.log(`  ✓ break caught: ${name}`); } else { missed++; console.log(`  NOT CAUGHT ${name}`); } }
const lenient = (t) => { try { return JSON.parse(t); } catch { return null; } };
if (behave(lenient).some(([, v]) => !v)) { breaks++; console.log("  ✓ break caught: lenient acceptor"); } else { missed++; console.log('  NOT CAUGHT lenient acceptor'); }
console.log(`pilotmirrorcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails || missed ? 1 : 0);
