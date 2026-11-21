#!/usr/bin/env node
// #11525: StructurePiecesCollector (shiftInto) is reached from NetherFortress.generate via Structures.startsNear.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['07l_spawn.js'], dom: false, ...(patch ? { patch } : {}) });
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  M.Dim.cur = 'the_nether';
  let start = null;
  for (let cz = -160; cz <= 160 && !start; cz += 8) for (let cx = -160; cx <= 160 && !start; cx += 8)
    for (const s of M.Structures.startsNear(cx, cz)) if (s.def.name === 'fortress' && s.pieces.length > 3) { start = s; break; }
  M.Dim.cur = 'overworld';
  let lo = 1e9, hi = -1e9;
  if (start) for (const p of start.pieces) { lo = Math.min(lo, p.y0 !== undefined ? p.y0 : p.bb ? p.bb[1] : 0); hi = Math.max(hi, p.y1 !== undefined ? p.y1 : p.bb ? p.bb[4] : 0); }
  return { start, lo, hi };
}
const A = trial();
ok(A.start, 'fortress start exists');
{ const M = loadEngine({ extra: ['07l_spawn.js'], dom: false }); const ps = [{ bb: [0, 0, 0, 5, 9, 5] }, { bb: [3, 4, 3, 8, 12, 8] }]; const bb = M.NetherFortress.StructurePiecesCollector.shiftInto(ps, { nextInt: () => 0 }, 48, 70); ok(ps[0].bb[1] === 48 && ps[1].bb[4] === 60 && bb[1] === 48 && bb[4] === 60, 'shiftInto moves the lowest piece to Y 48 and returns the box'); }
ok(A.start && A.lo >= 48 && A.lo <= 70, 'lowest piece shifted into Y 48..70 (' + A.lo + '..' + A.hi + ')');
const a = "F.StructurePiecesCollector = {";
for (const b of ["F.StructurePiecesCollectorCut = {", "F.StructurePiecesCollector = { shiftInto: function () { return [0,0,0,0,0,0]; }, _x: {"]) {
  breaks++;
  const cutTxt = a.replace(/^/, '');
  let got; try { got = trial((f, t) => f === '04y_struct_nether_fortress.js' ? (t.includes(a) ? t.replace(a, b) : (() => { throw new Error('cut not found'); })()) : t); } catch (e) { if (/cut not found/.test(e.message)) { fails.push(e.message); continue; } got = { start: null, lo: 0 }; }
  ok(!(got.start && got.lo >= 48 && got.lo <= 70), 'anti-vacuity: cutting shiftInto (' + b + ') must break the Y shift');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
