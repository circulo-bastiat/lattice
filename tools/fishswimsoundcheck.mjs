#!/usr/bin/env node
// fishswimsoundcheck.mjs — #3176: FishEntity.getSwimSound = entity.fish.swim for all four fish; others unchanged.
import { loadEngine } from './loadsrc.mjs';
const MV = loadEngine({ extra: ['07zl_panda.js', '07zzp_mobvoice.js'], dom: false }).MobVoice;
let pass = 0, breaks = 0; const fails = [];
for (const t of ['cod', 'salmon', 'pufferfish', 'tropical_fish']) {
  breaks++; const r = MV.waterSound({ type: t }, 'swim');
  if (r === 'entity.fish.swim') { pass++; console.log('   ✓ ' + t + ' swims entity.fish.swim'); } else fails.push(t + ' swim = ' + r);
}
for (const [t, ev] of [['pig', 'entity.generic.swim'], ['zombie', 'entity.hostile.swim'], ['dolphin', 'entity.dolphin.swim']]) {
  const r = MV.waterSound({ type: t }, 'swim'); if (r === ev) pass++; else fails.push(t + ' swim = ' + r);
}
console.log(fails.join('\n'));
console.log(`fishswimsoundcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
