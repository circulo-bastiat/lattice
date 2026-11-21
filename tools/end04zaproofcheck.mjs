#!/usr/bin/env node
// end04zaproofcheck.mjs — #11577: proves the four 04za_end.js classes through the real chunk path G.genColumn(the_end):
// DensityFunctionTypes (EndIslands: central island + void ring), EndGatewayFeature (gateway at 96,75,0),
// ChorusPlantFeature + ChorusPlantBlock (connection props, grown in end_highlands chunks). Each cut by a source patch.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine(patch ? { patch } : {});
  M.Gen.init(12345, {});
  const col = (cx, cz) => { M.Dim.cur = 'the_end'; try { return M.Gen.genColumn(cx, cz); } finally { M.Dim.cur = 'overworld'; } };
  const at = (c, wx, wy, wz) => { const s = c.sec[(wy + 64) >> 4], i = (((wy + 64) & 15) << 8) | ((wz & 15) << 4) | (wx & 15);
    if (s.u >= 0) return s.u; const bits = s.b, per = 32 / bits; return s.p[(s.d[Math.floor(i / per)] >>> ((i % per) * bits)) & ((1 << bits) - 1)]; };
  M.EndTerrain.init(12345n); const B = M.EndTerrain.state().B, o = {};
  const c0 = col(0, 0);
  let top = -1; for (let y = 0; y < 128; y++) if (at(c0, 8, y, 8) === B.end_stone) top = y;
  o.island = top >= 55 && top <= 70;
  let ring = 0; const cr = col(6, 6); for (let y = 0; y < 128; y++) for (let k = 0; k < 256; k++) if (at(cr, k & 15, y, k >> 4) === B.end_stone) ring++;
  o.voidRing = ring === 0;
  const cg = col(6, 0);
  o.gateway = at(cg, 96, 75, 0) === B.end_gateway && at(cg, 96, 77, 0) === B.bedrock && at(cg, 96, 73, 0) === B.bedrock;
  let plants = 0, flowers = 0, conn = false;
  for (let cx = -60; cx < -56 && !conn; cx++) for (let cz = -53; cz < -33 && !conn; cz++) {
    const c = col(cx, cz);
    for (let y = 40; y < 100; y++) for (let k = 0; k < 256; k++) {
      const s = at(c, k & 15, y, k >> 4);
      if (s === B.chorus_flower || (s && M.States.name(s) === 'chorus_flower')) flowers++;
      else if (s && M.States.name(s) === 'chorus_plant') { plants++; if (s !== B.chorus_plant) conn = true; }
    }
  }
  o.chorus = plants >= 2 && flowers >= 1;
  o.chorusConn = conn;
  return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k + ' ' + JSON.stringify(A));
const BR = [
  ['island', 'islands = function (x, z) {\n    return (', 'islands = function (x, z) {\n    return 5 + ('],
  ['voidRing', '- 8.0) / 128.0', '+ 80.0) / 128.0'],
  ['gateway', 'if (cx && cy && cz) w.set(x, y, z, B.end_gateway);', 'if (cx && cy && cz) w.set(x, y, z, 0);'],
  ['chorus', 'if (w.get(x, y, z) !== 0 || w.get(x, y - 1, z) !== S.B.end_stone) return false;', 'return false;'],
  ['chorusConn', "return prop(s, 'west', is(w.get(x - 1, y, z), 1, 1, 0));", "return B.chorus_plant;"],
];
let breaks = 0;
for (const [key, a, b] of BR) {
  breaks++;
  let hit = false, B;
  try { B = trial((f, s) => { if (f === '04za_end.js' && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch { B = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  ok(!B[key], 'anti-vacuity: break ' + key);
  if (!B[key]) console.log('  ✓ break caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `end04zaproofcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
