// tools/shapefloodcheck.mjs - #5103 (11 Oct): with FILL_TESTERS set, brain.mjs overwrote the shape AFTER fillShape() decided `changed`,
// saved the overwritten shape, and so saw a change on EVERY fill pass: each pass posted a fill-shape line, each post woke the brain
// again (buses #5088-#5102 filled in ~30 min each overnight). The override must recompute `changed` against the saved shape. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8');
const verdict = (S) => {
  const bad = [];
  const i = S.indexOf('[FILL_TESTERS=${TS}: workers and testers set separately]');
  const j = S.indexOf('if (shape.changed) await post(');
  if (i < 0) bad.push('the FILL_TESTERS override line is gone (update this check)');
  if (j < 0) bad.push('the fill shape is never posted (update this check)');
  const between = i >= 0 && j > i ? S.slice(i, j) : '';
  if (!/shape\.changed = !H\.shape \|\| shape\.workers !== H\.shape\.workers \|\| shape\.total !== H\.shape\.total;/.test(between))
    bad.push('after the FILL_TESTERS override, shape.changed is not recomputed against the saved shape: every pass posts a fill-shape line and wakes the brain again');
  return bad;
};
const BREAKS = [
  ['no recompute', (S) => S.replace(/\n    shape\.changed = !H\.shape[^\n]*/, '')],
  ['compares workers only', (S) => S.replace(' || shape.total !== H.shape.total;', ';')],
  ['recompute after the post', (S) => S.replace('if (shape.changed) await post(', 'if (shape.changed) await post0(')],
];
const real = verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { if (verdict(mk(SRC)).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`shapefloodcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
