// monumentcheck.mjs — #4494: a real ocean monument places 3 persistent elder_guardians (core + 2 wings),
// each handed to exactly one chunk and inside the building's box. Prints '<n> breaks caught'.
import { loadEngine } from './loadsrc.mjs';
const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const ST = M.Structures;
let start = null;
for (let cz = -200; cz <= 200 && !start; cz += 4) for (let cx = -200; cx <= 200 && !start; cx += 4)
  for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'monument' && s.pieces) { start = s; break; }
ok(start, 'no real monument start found');

function count(brk) {
  const p = start.pieces[0], log = [];
  if (brk) p.ents = [];
  for (let cx = (p.x0 >> 4); cx <= (p.x1 >> 4); cx++) for (let cz = (p.z0 >> 4); cz <= (p.z1 >> 4); cz++) {
    M.Gen.entityLog = [];
    M.StructSurface.write(new Uint16Array(M.CFG.CHUNK_H * 256), cx, cz, p);
    log.push(...M.Gen.entityLog);
  }
  return log;
}
let caught = 0;
if (start) {
  const saved = start.pieces[0].ents, log = count(false);
  const el = log.filter((d) => d[0] === 'elder_guardian');
  ok(el.length === 3, `monument placed ${el.length} elder_guardians (expect 3)`);
  ok(el.every((d) => d[1] >= start.x0 && d[1] <= start.x1 && d[3] >= start.z0 && d[3] <= start.z1), 'elder outside the monument box');
  ok(new Set(el.map((d) => d[1] + ',' + d[3])).size === 3, 'elders share a position');
  start.pieces[0].ents = saved; if (count(true).length === 0) { caught++; console.log("  ✓ break caught"); }
  start.pieces[0].ents = saved.map((e) => saved[0]);
  if (new Set(count(false).map((d) => d[1] + ',' + d[3])).size < 3) { caught++; console.log("  ✓ break caught"); }   // stacked elders trip the distinct-position assertion
  start.pieces[0].ents = saved;

}
console.log(`monumentcheck: ${pass} assertions, ${fails.length} failed` + (fails.length ? "\n" + fails.join("\n") : "") + `\n ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
