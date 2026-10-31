#!/usr/bin/env node
// vexlightcheck.mjs — #1757: VexEntityRenderer.getBlockLight returns 15 (like wither).
import { loadEngine } from './loadsrc.mjs';
const ER = loadEngine({ extra: ['07j_entityrender.js'], dom: false }).EntityRender;
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const f = (t) => ER.fullBrightBlockLight({ type: t });
ok(f('vex') === true && f('wither') === true, 'vex and wither full-bright');
ok(f('wither_skull') === true, '#4893 wither_skull full-bright');
ok(f('zombie') === false && !ER.fullBrightBlockLight(null), 'others not');
okAv(f('vex') !== f('zombie'), 'vex differs from zombie');
{ const sv = ER.fullBrightBlockLight; ER.fullBrightBlockLight = (e) => e.type === 'wither'; okAv(f('vex') !== true, 'dropping the vex case is caught'); ER.fullBrightBlockLight = sv; }
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) { for (const m of fails) console.log('  - ' + m); process.exit(1); }
console.log('vexlightcheck: ALL GREEN');
