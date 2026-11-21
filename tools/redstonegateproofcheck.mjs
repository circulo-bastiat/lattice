#!/usr/bin/env node
// redstonegateproofcheck.mjs — #11570: AbstractRedstoneGateBlock.isRedstoneGate in 07zzv_hanging.js (solidish):
// a hanging entity (floor/ceiling facing) stays attached to a repeater/comparator but not to air or a non-gate.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07zzv_hanging.js', '07zw_mobnbt.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  const S = M.States, H = M.Hanging, cells = new Map();
  const W = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0 };
  const o = {};
  H.spaceEmpty = () => true;   // isolate the support test from collision lookups
  const stays = (st) => {
    cells.clear(); cells.set('5,63,5', st);
    const e = H.attach({}, 5, 64, 5, 4, 16, 16);   // facing 4: attached to the cell below
    e.hbox = { minX: 5.2, maxX: 5.8, minY: 64, maxY: 64.1, minZ: 5.2, maxZ: 5.8 };
    return H.canStayAttached(e, W, []);
  };
  o.repeater = stays(S.stateOf('repeater'));
  o.comparator = stays(S.stateOf('comparator'));
  o.airNo = stays(0) === false;
  o.torchNo = stays(S.stateOf('redstone_wire')) === false;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['repeater', /\(\^\|:\)\(repeater\|comparator\)\$/, '(^|:)(comparator)$'],
  ['comparator', /\(\^\|:\)\(repeater\|comparator\)\$/, '(^|:)(repeater)$'],
  ['torchNo', /\(\^\|:\)\(repeater\|comparator\)\$/, '(^|:)(repeater|comparator|redstone_wire)$'],
];
for (const [key, re, rep] of BR) {
  breaks++;
  const src = readFileSync(join(MCLITE_ROOT, 'src/07zzv_hanging.js'), 'utf8');
  if (!re.test(src)) { fails.push('no-op break: ' + key); continue; }
  let B; try { B = trial((f, s) => f === '07zzv_hanging.js' ? s.replace(re, rep) : s); } catch { B = {}; }
  ok(!B[key], "anti-vacuity: break " + key);
  if (!B[key]) console.log("  ✓ break caught: " + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `redstonegateproofcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
