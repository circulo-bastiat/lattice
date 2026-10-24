#!/usr/bin/env node
// dimskycheck.mjs — #263 G27j. The per-dimension sky frame (DimensionEffects port): no sun/moon/stars/sunrise
// in the Nether or End, fog = biome fog (Nether) or x0.15 (End), thick fog Nether only, overworld unchanged.
// Expected values are the jar's constants (DimensionEffects.java), not read back from the table.
import { loadEngine } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-5;

const M = loadEngine({ extra: ['02f_tags.js', '09b_sky.js'], dom: false });
const Sky = M.Sky, Dim = M.Dim;
Sky.init();
const fogIn = [0.2, 0.03, 0.03];
const frameIn = (d, t) => { Dim.cur = d; Sky.dayTime = t; return Sky.frame([0.5, 0.6, 0.9], fogIn, 12, 0.3); };

function run(tag) {
  const nether = frameIn('the_nether', 12500);          // dusk: the overworld would draw a sunset fan
  ok(nether.celestial === false, tag + 'nether: no sun/moon');
  ok(nether.starBrightness === 0, tag + 'nether: no stars');
  ok(nether.sunrise === null, tag + 'nether: no sunrise fan');
  ok(nether.thickFog === true, tag + 'nether: thick fog');
  ok(fogIn.every((v, i) => near(nether.fog[i], v)), tag + 'nether: fog is the biome fog, unadjusted');
  const end = frameIn('the_end', 18000);
  ok(end.celestial === false && end.skyType === 'end', tag + 'end: skyType END, no sun/moon');
  ok(end.thickFog === false, tag + 'end: no thick fog');
  ok(fogIn.every((v, i) => near(end.fog[i], v * 0.15)), tag + 'end: fog x0.15');
  const ow = frameIn('overworld', 6000);
  ok(ow.celestial === true && ow.skyType === 'normal' && !ow.thickFog, tag + 'overworld: normal sky');
  ok(ow.skyDarken > 0.9, tag + 'overworld noon bright');
  const ow2 = frameIn('overworld', 18000);
  ok(ow2.fog[0] < 0.2 * 0.9 + 0.5 && ow2.starBrightness > 0, tag + 'overworld midnight has stars');
  Dim.cur = 'overworld';
}
run('');

// anti-vacuity: break the data and require the check to notice
const keep = JSON.stringify(Sky.EFFECTS);
const attempts = [
  ['nether draws a sky', () => { Sky.EFFECTS.the_nether.skyType = 'normal'; }],
  ['end fog not x0.15', () => { Sky.EFFECTS.the_end.fogMul = 1; }],
  ['nether fog thin', () => { Sky.EFFECTS.the_nether.thickFog = false; }],
  ['nether fog dimmed', () => { Sky.EFFECTS.the_nether.fogMul = 0.15; }],
  ['end draws a sky', () => { Sky.EFFECTS.the_end.skyType = 'normal'; }]
];
for (const [name, brk] of attempts) {
  const before = fails.length;
  brk();
  try { run('[break] '); } catch (e) { fails.push('throw'); }
  const caught = fails.length > before;
  fails.length = before;
  Object.assign(Sky.EFFECTS, JSON.parse(keep));
  breaks++;
  if (caught) { pass++; console.log("   ✓ break caught: " + name); } else fails.push('anti-vacuity: not caught: ' + name);
}
console.log('================ dimskycheck =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
