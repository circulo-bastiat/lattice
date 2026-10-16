// #7766: the verifier guard holds weakening PRs and passes additive ones. Breaks: each is a mutation of the guard's inputs that must flip a verdict.
import fs from 'node:fs'; import { guard, isProtected } from './infra/verifierguard.mjs';
const set = JSON.parse(fs.readFileSync(new URL('./protected.json', import.meta.url), 'utf8'));
let bad = 0, caught = 0; const fail = (m) => { bad++; console.log('FAIL ' + m); };
const f = (path, before, after) => ({ path, before, after });
const holds = (files, s = set, bc) => guard({ files, set: s, breakCounts: bc }).holds.length;
const q0 = JSON.stringify({ a: 'red since #1234 gpu' }), w0 = JSON.stringify({ waivers: { 'x.mjs': { classes: ['V1'], issue: 7708 } } });
// additive: must pass
const adds = [f('tools/stages.d/new.json', null, '[{"id":"n"}]'), f('tools/quarantine.json', q0, JSON.stringify({ a: 'red since #1234 gpu', b: 'flaky #5555' })),
  f('tools/vacuity-waivers.json', w0, JSON.stringify({ waivers: { 'x.mjs': { classes: ['V1'], issue: 7708 }, 'y.mjs': { classes: ['V2'], issue: 7709 } } })), f('tools/core.json', '{"checks":["a"]}', '{"checks":["a","b"]}')];
for (const a of adds) if (holds([a])) fail('additive held wrongly: ' + a.path);
if (!isProtected('tools/stages.d/x.json', set) || !isProtected('.github/workflows/ci.yml', set)) fail('glob missing');
// weakening: each must be held
const weak = { 'quarantine entry removed': [f('tools/quarantine.json', q0, '{}')], 'justification shortened': [f('tools/quarantine.json', q0, '{"a":"x"}')],
  'new entry without issue': [f('tools/quarantine.json', q0, '{"a":"red since #1234 gpu","b":"meh"}')], 'waiver removed': [f('tools/vacuity-waivers.json', w0, '{"waivers":{}}')],
  'waiver widened': [f('tools/vacuity-waivers.json', w0, JSON.stringify({ waivers: { 'x.mjs': { classes: ['V1', 'V3'], issue: 7708 } } }))], 'core check removed': [f('tools/core.json', '{"checks":["a","b"]}', '{"checks":["a"]}')],
  'stage deleted': [f('tools/stages.d/n.json', '[{"id":"n"}]', null)], 'stage entry dropped': [f('tools/stages.d/n.json', '[{"id":"n"},{"id":"m"}]', '[{"id":"n"}]')], 'protected set edited': [f('tools/protected.json', '{}', '{"x":1}')],
  'lander edited': [f('tools/infra/land.mjs', 'a', 'b')], '|| true': [f('tools/c.mjs', 'ok(x); // breaks', 'ok(x |' + '| tr' + 'ue); // breaks')], 'early exit 0': [f('tools/c.mjs', 'run(); // breaks', 'process.exit(' + '0)\nrun(); // breaks')],
  'SKIP exit 0': [f('tools/c.mjs', 'x // breaks', "console.log('SK" + "IP'); process.exit(" + '0); // breaks')], 'V4 no break list': [f('tools/c.mjs', 'x // breaks', 'x')] };
for (const [k, v] of Object.entries(weak)) if (holds(v)) caught++; else fail('weakening slipped through: ' + k);
const cf = [f('tools/c.mjs', 'x // breaks', 'x // breaks 2')];
if (holds(cf, set, { 'tools/c.mjs': { before: 5, after: 3 } })) caught++; else fail('break-count drop not detected');
if (holds(cf, set, { 'tools/c.mjs': { before: 3, after: 5 } })) fail('count rise held');
const small = { ...set, files: set.files.filter((x) => x !== 'tools/quarantine.json') };   // a protected file removed from the set is no longer guarded
if (holds([f('tools/quarantine.json', q0, '{}')], small)) fail('unprotected file still held (set not read)'); else caught++;
console.log(`${bad} failed; ${caught} breaks caught`); process.exit(bad ? 1 : 0);
