#!/usr/bin/env node
// blaze11635check.mjs — #11635: proves BlazeEntityRenderer's engine side (07zzh_blaze.js module): model-kind pick, rod ring setAngles,
// full-bright light, shadow 0.5, and the blaze mobTick/init reachable from 07i_entitylist.js. SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-9;
function trial(patch) {
  const MCL = loadEngine({ extra: ['07i_entitylist.js', '07j_entityrender.js', '07zzh_blaze.js'], dom: false,
    patch: patch ? (f, s) => (f === '07j_entityrender.js' ? patch(s) : s) : undefined });
  const ER = MCL.EntityRender, o = {};
  const rest = { px: 0, py: 0, pz: 0 };
  const d0 = ER.setupAnimDelta('part0', 0, 0, 0, 0, false, 'blaze', { ageInTicks: 0, rest });
  o.ring0 = !!d0 && near(d0.dpx, 9) && near(d0.dpy, -2 + 1) && near(d0.dpz, 0);
  const d5 = ER.setupAnimDelta('part5', 0, 0, 0, 0, false, 'blaze', { ageInTicks: 10, rest });
  const a5 = Math.PI / 4 + 10 * Math.PI * 0.03 + 1;
  o.ring1 = !!d5 && near(d5.dpx, Math.cos(a5) * 7) && near(d5.dpz, Math.sin(a5) * 7) && near(d5.dpy, 2 + Math.cos((10 + 10) * 0.25));
  const d9 = ER.setupAnimDelta('part9', 0, 0, 0, 0, false, 'blaze', { ageInTicks: 0, rest });
  o.ring2 = !!d9 && near(d9.dpy, 11 + Math.cos(9 * 1.5 * 0.5)) && near(d9.dpx, Math.cos(0.47123894 + 1) * 5);
  o.rest = !!d0 && d0.rx === 0 && d0.ry === 0 && d0.rz === 0;
  o.light = ER.fullBrightBlockLight({ type: 'blaze' }) === true && ER.fullBrightBlockLight({ type: 'cow' }) === false;
  o.shadow = ER.shadowRadiusOf({ type: 'blaze' }) === 0.5;
  o.kindFn = typeof ER.modelKindOf === 'function';
  o.mob = typeof MCL.Blaze.mobTick === 'function' && MCL.Blaze.EYE_HEIGHT > 1.5;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
const L = rd('07i_entitylist.js');
ok(/e\.type === 'blaze' && NS\.Blaze && NS\.Blaze\.ready\) NS\.Blaze\.mobTick\(e\)/.test(L), 'reach: EntityList tick calls Blaze.mobTick');
ok(/blaze: function \(e\) \{ if \(NS\.Blaze\) NS\.Blaze\.initBlaze\(e\)/.test(L), 'reach: EntityList init calls Blaze.initBlaze');
ok(/has\.part0 && has\.part11 && has\.head\) kind = 'blaze'/.test(rd('07j_entityrender.js')), 'reach: modelKindOf picks blaze');
const BR = [
  ['r0', 'ring === 0 ? -2 + Math.cos', 'ring === 0 ? -3 + Math.cos', ['ring0']],
  ['rad', '[9, 7, 5][ring]', '[9, 8, 5][ring]', ['ring1']],
  ['spin', '[-0.1, 0.03, -0.05][ring]', '[-0.1, 0.04, -0.05][ring]', ['ring1']],
  ['ring2y', '11 + Math.cos((bi * 1.5', '12 + Math.cos((bi * 1.5', ['ring2']],
  ['light', "e.type === 'blaze' || e.type === 'magma_cube'", "e.type === 'blazeX' || e.type === 'magma_cube'", ['light']],
  ['shadow', 'wandering_trader: 0.5, blaze: 0.5', 'wandering_trader: 0.5, blaze: 0.6', ['shadow']],
  ['rest', 'return { rx: 0, ry: 0, rz: 0, dpx: Math.cos(ba)', 'return { rx: 1, ry: 0, rz: 0, dpx: Math.cos(ba)', ['rest']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`blaze11635check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
