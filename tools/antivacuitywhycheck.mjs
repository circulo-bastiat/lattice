// #8395: the lander's anti-vacuity gate names WHICH case it hit. Fixture outputs for ok / 0 breaks / failed / no row / skipped.
import { judge } from './infra/vacuity.mjs';
let n = 0, bad = 0, caught = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
const run = (v) => {
  const out = [' ✓ aaa      12 ms  5 assertions, 0 failures, 3 breaks caught', ' ✓ bbb      12 ms  5 assertions, 0 failures',
    ' ✗ ccc      12 ms  boom', '   detail line 1', ' · eee      0 ms  skipped (--fast)', 'tail'].join('\n');
  return [judge(['aaa'], out, {}, true), judge(['bbb'], out), judge(['ccc'], out), judge(['ddd'], out),
    judge(['eee'], out, { eee: 'browser' }, true), judge(['eee'], out, { eee: 'check' }, true), judge(['aaa'], v)];
};
const [a, b, c, d, e, f] = run();
ok(a === null, 'ok with breaks passes'); ok(/bbb ran but caught 0 breaks/.test(b?.why), '0 breaks');
ok(/ccc FAILED/.test(c?.why) && c.out.startsWith(' ✗ ccc') && /detail line 1/.test(c.out), 'failed: row+block first');
ok(/ddd has no result row/.test(d?.why), 'no row'); ok(/eee is a browser stage SKIPPED/.test(e?.why), 'skipped browser');
ok(f === null, 'skipped non-browser passes');
ok(new Set([b.why.split(' ')[2], c.why, d.why, e.why]).size === 4, 'four distinct texts');
// breaks: damage the data, each must flip the verdict
const row = ' ✓ aaa      12 ms  5 assertions, 0 failures, 3 breaks caught';
for (const [o, want] of [[row.replace('3 breaks', '0 breaks'), true], [row.replace('✓', '✗'), true], [row.replace('aaa', 'zzz'), true], [row.replace('✓', '·'), false], [`free text aaa 12 ms\n`, true]]) {
  const r = judge(['aaa'], o, { aaa: 'browser' }, true); if (!!r === want || (want === false && r)) caught++;
}
ok(caught === 5, 'breaks flip verdict');
console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`); process.exit(bad ? 1 : 0);
