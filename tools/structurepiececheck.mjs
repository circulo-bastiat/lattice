#!/usr/bin/env node
// #11708: net/minecraft/structure/StructurePiece (the Ctx in 04y_struct_nether_fortress.js: applyX/Z transform,
// the clip of fill to the piece box) is reached from G.writeDimStructures -> F.writePiece. A real BridgePlatform piece in
// 4 facings: its blaze spawner (local 3,5,5, asymmetric) must land where StructurePiece.applyX/ZTransform puts it.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const DIRS = { N: 0, E: 1, S: 2, W: 3 };
function trial(patch) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const A = M.Structures.api, SP = M.States.stateOf('spawner'), r = {};
  for (const d of 'NESW') {
    const SB = new Uint16Array(16 * 16 * 400);
    const p = { kind: 'BridgePlatform', dir: DIRS[d], x0: 4, x1: 10, y0: 60, y1: 68, z0: 4, z1: 10 };
    let n; try { n = M.NetherFortress.writePiece(SB, 0, 0, p); } catch (e) { n = -1; }
    let found = null;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 55; y < 75; y++) if (A.get(SB, 0, 0, x, y, z) === SP) found = [x, y - p.y0, z];
    r[d] = { n, found };
  }
  return r;
}
const want = { N: [7, 5, 5], S: [7, 5, 9], E: [9, 5, 7], W: [5, 5, 7] };   // x0+3,z1-5 | x0+3,z0+5 | x0+5,z0+3 | x1-5,z0+3 (x0=z0=4, x1=z1=10)
const good = (R) => 'NESW'.split('').every((d) => R[d].found && R[d].found.join() === want[d].join());
const R = trial();
for (const d of 'NESW') ok(R[d].n > 50, d + ': platform writes cells (' + R[d].n + ')');
for (const d of 'NESW') ok(R[d].found && R[d].found.join() === want[d].join(), d + ': spawner at ' + (R[d].found || 'none') + ', want ' + want[d]);
const mutants = [
  ['wx E/W swap', 'p.dir === W ? p.x1 - c : p.dir === E ? p.x0 + c : p.x0 + a', 'p.dir === E ? p.x1 - c : p.dir === W ? p.x0 + c : p.x0 + a'],
  ['wz N/S swap', 'p.dir === N ? p.z1 - c : p.dir === S ? p.z0 + c : p.z0 + a', 'p.dir === S ? p.z1 - c : p.dir === N ? p.z0 + c : p.z0 + a'],
  ['fill clip to piece box', 'b <= b1 && b <= top;', 'b <= b1 && b <= top - 4;'],
];
for (const [name, a, b] of mutants) {
  breaks++;
  let hit = true, got = null;
  try { got = trial((f, t) => f === '04y_struct_nether_fortress.js' ? (t.includes(a) ? t.replace(a, b) : (hit = false, t)) : t); } catch (e) { got = null; }
  if (!hit) { fails.push('mutant target not found: ' + name); continue; }
  ok(!got || !good(got), 'anti-vacuity: ' + name + ' must break the transform');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
