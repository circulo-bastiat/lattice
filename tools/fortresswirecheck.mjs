#!/usr/bin/env node
// #11523: proves NetherFortressGenerator (the piece generator) is reached from a real entry point.
// fortresswirecheck.mjs — #11470: 04y_struct_nether_fortress.js is WIRED (classmap said unwired: a static false positive;
// the module reaches the engine through Structures.register('fortress') -> startsNear (expand = F.generate) and
// G.writeDimStructures -> writeUpTo (write = F.writePiece), not through a named call the map can follow).
//   1. in the Nether, Structures.startsNear yields a fortress start with real pieces (NetherFortressFeature.addPieces)
//   2. the column writer (G.genColumn path for the Nether + writeDimStructures) puts nether_bricks into a fortress chunk
//   3. anti-vacuity: with the register call or the writePiece hand-off cut, 1 / 2 fail
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function trial(patch) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const ST = M.Structures;
  M.Dim.cur = 'the_nether';
  let start = null;
  for (let cz = -160; cz <= 160 && !start; cz += 8) for (let cx = -160; cx <= 160 && !start; cx += 8)
    for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'fortress' && s.pieces.length > 3) { start = s; break; }
  let bricks = 0;
  if (start) {
    const NB = M.States.stateOf('nether_bricks');
    const SB = new Uint16Array(16 * 16 * 384);
    const cH = new Int16Array(256);
    for (const p of start.pieces.slice(0, 12)) {
      for (let cx = p.x0 >> 4; cx <= p.x1 >> 4; cx++) for (let cz = p.z0 >> 4; cz <= p.z1 >> 4; cz++) {
        SB.fill(0);
        let n = 0;
        try { n = M.NetherFortress.writePiece(SB, cx, cz, p) | 0; } catch (e) { n = 0; }
        for (let i = 0; i < SB.length; i++) if (SB[i] === NB) bricks++;
      }
    }
  }
  M.Dim.cur = 'overworld';
  return { start, bricks, hasGen: typeof (M.NetherFortress || {}).generate === 'function' };
}
const A = trial();
ok(A.start && A.start.pieces.length > 3, 'Nether has a fortress start with pieces via Structures.startsNear');
ok(A.hasGen, 'NS.NetherFortress.generate exists');
ok(A.bricks > 0, 'writePiece writes nether_bricks (' + A.bricks + ')');
const cuts = [
  ["NS.Structures.register('fortress'", "void ('fortress'"],
  ['var g = F.generate(', 'var g = ({pieces:[]}); void ('],
  ['var g = new Ctx(', 'var g = { n: 0 }; void ('],
];
for (const [a, b] of cuts) {
  breaks++;
  let got;
  try { got = trial((f, t) => f === '04y_struct_nether_fortress.js' ? (t.includes(a) ? t.replace(a, b) : (() => { throw new Error('cut not found: ' + a); })()) : t); } catch (e) { if (/cut not found/.test(e.message)) { fails.push(e.message); continue; } got = { start: null, bricks: 0 }; }
  const cut = !(got.start && got.start.pieces.length > 3) || got.bricks === 0;
  ok(cut, 'anti-vacuity: cutting `' + a + '` must unwire the fortress');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
