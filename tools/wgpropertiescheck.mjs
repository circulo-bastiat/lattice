#!/usr/bin/env node
// wgpropertiescheck.mjs - #11702: proves Properties (02d_wgdata.js WG.stateOf: {Name, Properties} -> real state)
// through the real worldgen data, reachability from the nether features, and source breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ patch: patch ? (f, s) => (f === '02d_wgdata.js' ? patch(s) : s) : undefined });
  const WG = MCL.WG, S = MCL.States, o = {};
  const bas = WG.stateOf({ Name: 'minecraft:basalt', Properties: { axis: 'y' } });
  const gr = WG.stateOf({ Name: 'minecraft:grass_block', Properties: { snowy: 'false' } });
  o.propState = bas > 0 && gr > 0 && gr === S.stateOf('grass_block') && WG.stateOf({ Name: 'minecraft:grass_block', Properties: { snowy: 'maybe' } }) === 0;
  o.defaultAxis = bas === S.stateOf('basalt');
  o.noProps = WG.stateOf({ Name: 'minecraft:stone' }) === S.stateOf('stone') && S.stateOf('stone') > 0;
  o.badName = WG.stateOf({ Name: 'minecraft:no_such_block' }) === 0 && WG.stateOf(null) === 0 && WG.stateOf({}) === 0;
  o.badProp = WG.stateOf({ Name: 'minecraft:deepslate', Properties: { axis: 'q' } }) === 0;
  o.keySorted = WG.stateOf({ Name: 'minecraft:lava', Properties: { level: '0' } }) === S.stateOf('lava');
  o.local = WG.stateLocal('minecraft:grass_block|snowy=false') !== undefined;
  const nz = readFileSync(join(MCLITE_ROOT, 'src', '04z_feat_nether.js'), 'utf8');
  o.reach = /WG\.stateOf\(\{ Name: 'minecraft:' \+ name, Properties: props \}\)/.test(nz) && /WG\.stateOf\(n\)/.test(nz);
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const BR = [
  ['keyFmt', "ks[i] + '=' + node.Properties[ks[i]]", "ks[i] + ':' + node.Properties[ks[i]]", ['propState', 'defaultAxis', 'keySorted']],
  ['dropProps', "key += '|' + parts.join(',');", '', ['propState']],
  ['badNameAir', "typeof node.Name !== 'string') return 0;", "typeof node.Name !== 'string') return 1;", ['badName']],
  ['unknownKey', 'if (local === undefined) return 0;', 'if (local === undefined) return 1;', ['badProp']],
  ['withLocal', 'NS.States.withLocal(node.Name, local)', 'NS.States.withLocal(node.Name, 0)', ['propState']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`wgpropertiescheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
