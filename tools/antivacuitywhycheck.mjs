// #8395: the lander's anti-vacuity gate names WHICH case it hit. Fixture outputs for ok / 0 breaks / failed / no row / skipped.
import { judge, splitByKind, dropUnfit } from './infra/vacuity.mjs';
import { readFileSync } from 'node:fs';
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
// the split: browser stages leave the --fast run (it would skip them), everything else stays in it; a browser stage that ran WITHOUT --fast is judged by its row
{ const sp = splitByKind(['a', 'b', 'c'], { a: 'check', b: 'browser' });
  ok(JSON.stringify(sp) === JSON.stringify({ fastIds: ['a', 'c'], browserIds: ['b'] }), 'splitByKind separates browser stages');
  ok(judge(['b'], ' ✓ b      900 ms  4 assertions, 0 failures, 2 breaks caught', { b: 'browser' }, false) === null, 'browser stage run without --fast with breaks passes');
  ok(/b ran but caught 0 breaks/.test(judge(['b'], ' ✓ b      900 ms  4 assertions, 0 failures', { b: 'browser' }, false)?.why), 'browser stage without breaks still refused');
  const land = readFileSync(new URL('./infra/land.mjs', import.meta.url), 'utf8');
  ok(/splitByKind\(ids, kinds\)/.test(land) && /suite\(\['--only', browserIds\.join/.test(land), 'land.mjs runs browser stages WITHOUT --fast');
  for (const [src, nm] of [[land.replace("suite(['--only', browserIds.join(',')])", "suite(['--fast', '--only', browserIds.join(',')])"), 'browser run back under --fast'], [land.replace('splitByKind(ids, kinds)', 'null'), 'split removed']]) { if (!(/suite\(\['--only', browserIds\.join/.test(src) && /splitByKind\(ids, kinds\)/.test(src))) caught++; else ok(false, 'break not caught: ' + nm); } }
ok(caught === 7, 'both land.mjs breaks caught');
// hosted-unfit stages are not run by the lander's gate (the hosted CPU renderer cannot judge them); everything else still is
{ const land = readFileSync(new URL('./infra/land.mjs', import.meta.url), 'utf8'), c0 = caught;
  ok(JSON.stringify(dropUnfit(['a', 'b', 'c'], { b: 'why' })) === JSON.stringify(['a', 'c']), 'dropUnfit removes only the listed stage');
  ok(JSON.stringify(dropUnfit(['a', 'b'])) === JSON.stringify(['a', 'b']), 'no list drops nothing');
  ok(/dropUnfit\(added\.flatMap/.test(land) && /hosted-unfit\.json/.test(land), 'land.mjs drops hosted-unfit stages before judging');
  if (!/dropUnfit\(added\.flatMap/.test(land.replace('dropUnfit(added.flatMap', '(added.flatMap'))) caught++;
  if (dropUnfit(['a', 'b'], { b: 1 }).length === 1 && dropUnfit(['a', 'b'], {}).length === 2) caught++;
  ok(caught === c0 + 2, 'hosted-unfit breaks caught'); }

console.log(`${n} assertions, ${bad} failures, ${caught} breaks caught`); process.exit(bad ? 1 : 0);
