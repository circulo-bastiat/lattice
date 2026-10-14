#!/usr/bin/env node
// glowsquidlightcheck.mjs — #1570: GlowSquidEntityRenderer.getBlockLight against .decomp.
import { loadEngine } from './loadsrc.mjs';
const ER = loadEngine({ extra: ['07j_entityrender.js'], dom: false }).EntityRender;
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const g = (d, base) => ER.glowSquidBlockLight({ type: 'glow_squid', darkTicksRemaining: d }, base || 0);
ok(g(0) === 15, 'undamaged: 15 in the dark');
ok(g(100) === 0, 'darkTicks 100: 0');
ok(g(10) === 0 && g(5) === 7 && g(1) === 13 && g(100, 4) === 4, 'ramp (int)(15*(1-d/10)), max with base');
ok(ER.glowSquidBlockLight({ type: 'squid', darkTicksRemaining: 0 }, 3) === 3, 'squid untouched');
okAv(g(0) !== g(100), 'full-bright differs from darkened');
okAv(ER.glowSquidBlockLight({ type: 'squid', darkTicksRemaining: 0 }, 0) !== 15, 'plain squid is not full-bright');
okAv(g(5) !== 15 && g(5) !== 0, 'mid ramp is neither extreme');
{ const sv = ER.glowSquidBlockLight; ER.glowSquidBlockLight = (e, b) => b; okAv(g(0) !== 15, 'stub removes full-bright'); ER.glowSquidBlockLight = sv; }
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included, ${breaks} breaks caught)`);
if (fails.length) { for (const f of fails) console.log('  - ' + f); process.exit(1); }
console.log('glowsquidlightcheck: ALL GREEN');
