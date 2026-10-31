// tools/tiagitcheck.mjs - #7765: the git-history recall proxy (tools/infra/tiagit.mjs) finds causes and judges catches correctly.
import { staticFiles, run } from './infra/tiagit.mjs';
import { touches } from './infra/tia.mjs';
let bad = 0, caught = 0;
const t = (ok, m) => { if (!ok) { bad++; console.log('FAIL ' + m); } };
const brk = (name, ok) => { if (ok) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };

const st = { id: 'tiagitcheck', file: 'tools/tiagitcheck.mjs' };
const f = staticFiles(st);
t(f.includes('tools/tiagitcheck.mjs') && f.includes('tools/infra/tia.mjs'), 'static set holds the stage file and its import closure');
t(touches(f, ['tools/infra/tia.mjs']) && !touches(f, ['docs/x.md']), 'touches() hit/miss');
t(staticFiles({ id: 'lockstep-x', file: 'tools/tiagitcheck.mjs' }).includes('src/'), 'lockstep stages depend on src/');

const r = run(1500);
t(Array.isArray(r) && r.every((x) => x.stage && x.fix && x.cause && x.fix !== x.cause), 'every pair has stage, fix, cause (cause != fix)');

// breaks: each broken input must flip the verdict
brk('empty static set misses everything', !touches([], ['tools/infra/tia.mjs']));
brk('wrong file is not a catch', !touches(f, ['assets/none.png']));
brk('dropped import closure loses tia.mjs', !touches(f.filter((x) => x !== 'tools/infra/tia.mjs'), ['tools/infra/tia.mjs']));
console.log(bad ? `${bad} problems` : `ok, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
