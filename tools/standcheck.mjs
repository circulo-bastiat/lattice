#!/usr/bin/env node
// standcheck.mjs -- #320: armour stands end to end = placement yaw snap, slot-from-height (incl. small stand),
// swap, disabledSlots, two-punch break drops all contents. Runs the two source-level checks and sums their breaks.
import { spawnSync } from 'node:child_process';
console.log('standcheck -- #320, armour stands');
let caught = 0, bad = 0, asserts = 0;
for (const f of ['armorstandusecheck', 'armorstandcheck']) {
  const r = spawnSync(process.execPath, ['tools/' + f + '.mjs'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/(\d+) breaks caught/);
  const n = m ? +m[1] : 0;
  asserts += +((out.match(/(\d+) assertions/) || [0, 0])[1]);
  for (const l of out.split('\n')) if (l.includes('✓') && l.includes('break')) console.log(l);
  console.log(f + ': exit ' + r.status + ', ' + n + ' breaks caught');
  if (r.status !== 0 || n === 0) bad++;
  caught += n;
}
if (bad) { console.log('standcheck FAILED'); process.exit(1); }
console.log('standcheck: ' + asserts + ' assertions, 0 failures, ' + caught + ' breaks caught');
