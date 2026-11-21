#!/usr/bin/env node
// llama11637check.mjs — #11637: proves 07ze_llama.js's LlamaEntityRenderer half (Ll.skinKey: TEXTURES[variant]), reachability from 07j_entityrender's texKey chain, SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07ze_llama.js'], dom: false, patch: patch ? (f, s) => (f === '07ze_llama.js' ? patch(s) : s) : undefined });
  const L = MCL.Llama, o = {};
  o.v0 = L.skinKey({ type: 'llama', variant: 0 }) === 'llama#0';
  o.v1 = L.skinKey({ type: 'llama', variant: 1 }) === 'llama#1';
  o.v3 = L.skinKey({ type: 'llama', variant: 3 }) === 'llama#3';
  o.trader = L.skinKey({ type: 'trader_llama', variant: 2 }) === 'trader_llama#2';
  o.undef = L.skinKey({ type: 'llama' }) === 'llama#0';
  o.range = L.skinKey({ type: 'llama', variant: 4 }) === 'llama#0';
  o.mask = L.skinKey({ type: 'llama', variant: 0x102 }) === 'llama#2';
  o.other = L.skinKey({ type: 'horse', variant: 1 }) === null && L.skinKey(null) === null;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/if \(!texKey && NS\.Llama && NS\.Llama\.skinKey\) texKey = NS\.Llama\.skinKey\(e\)/.test(rd('07j_entityrender.js')), 'reach: 07j texKey chain calls Llama.skinKey');
const BR = [
  ['type', "e.type !== 'llama' && e.type !== 'trader_llama'", "e.type !== 'llama'", ['trader']],
  ['default', ': 0;\n    if (v < 0', ': 1;\n    if (v < 0', ['undef']],
  ['range', 'v > 3) v = 0', 'v > 4) v = 0', ['range']],
  ['mask', 'e.variant & 0xFF', 'e.variant', ['mask']],
  ['key', "e.type + '#' + v", "e.type + '_' + v", ['v0']],
  ['null', 'return null;\n    var v', 'return "x";\n    var v', ['other']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`llama11637check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
