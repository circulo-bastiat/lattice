#!/usr/bin/env node
// shape11767check.mjs — #11767: src/02q_shape.js (net/minecraft/util/shape ports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const um = readFileSync(ROOT + 'src/02q_utilmath.js', 'utf8');
const src = readFileSync(ROOT + 'src/02q_shape.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', um + '\n' + code)(M); return M.Shape; }
const L = (S, a) => { const o = []; for (let i = 0; i < a.size(); i++) o.push(a.getDouble(i)); return o.join(); };
function pairs(p) { const o = []; p.forEachPair((a, b, m) => { o.push(a + ':' + b + ':' + m); return true; }); return o.join(' '); }
function scenario(S) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  chk(L(S, S.FractionalDoubleList(4)) === '0,0.25,0.5,0.75,1', 'fractional');
  chk(L(S, S.OffsetDoubleList(S.listOf([0, 1]), 2.5)) === '2.5,3.5', 'offset');
  const id = S.IdentityPairList(S.listOf([0, 1, 2]));
  chk(pairs(id) === '0:0:0 1:1:1' && id.size() === 3, 'identity');
  const fr = S.FractionalPairList(2, 3);
  chk(fr.size() === 7 && pairs(fr) === '0:0:0 0:0:1 0:1:2 1:1:3 1:2:4 1:2:5', 'fractional pair ' + pairs(fr));
  const dj = S.DisjointPairList(S.listOf([0, 1]), S.listOf([2, 3]), false);
  chk(L(S, dj) === '0,1,2,3' && pairs(dj) === '0:-1:0 1:-1:1 1:0:2', 'disjoint ' + pairs(dj));
  chk(pairs(S.DisjointPairList(S.listOf([0, 1]), S.listOf([2, 3]), true)) === '-1:0:0 -1:1:1 0:1:2', 'disjoint inverted');
  const sp = S.SimplePairList(S.listOf([0, 0.5, 1]), S.listOf([0, 1]), true, true);
  chk(L(S, sp.getPairs()) === '0,0.5,1' && pairs(sp) === '0:0:0 1:0:1', 'simple ' + pairs(sp));
  chk(L(S, S.SimplePairList(S.listOf([]), S.listOf([]), true, true).getPairs()) === '0' && S.SimplePairList(S.listOf([]), S.listOf([]), true, true).size() === 1, 'simple empty');
  const spo = S.SimplePairList(S.listOf([0, 1]), S.listOf([0.5, 2]), false, false);
  chk(L(S, spo.getPairs()) === '0.5,1', 'simple only-overlap ' + L(S, spo.getPairs()));
  // bitset
  const b = S.BitSetVoxelSet(2, 2, 2); b.set(0, 0, 0); b.set(1, 0, 0); b.set(1, 1, 1);
  chk(b.contains(1, 1, 1) && !b.contains(0, 1, 1) && !b.inBoundsAndContains(2, 0, 0) && !b.inBoundsAndContains(-1, 0, 0), 'bitset contains');
  chk(b.getMin(0) === 0 && b.getMax(0) === 2 && b.getMax(1) === 2 && b.getMin(2) === 0 && !b.isEmpty() && S.BitSetVoxelSet(1, 1, 1).isEmpty(), 'bitset bounds');
  const boxes = []; b.forEachBox((a, bb, c, d, e, g) => boxes.push([a, bb, c, d, e, g].join()), true);
  chk(boxes.join('|') === '0,0,0,2,1,1|1,1,1,2,2,2', 'boxes ' + boxes.join('|'));
  const sq = S.BitSetVoxelSet.create(2, 2, 1, 0, 0, 0, 2, 2, 1), sqb = []; sq.forEachBox((a, bb, c, d, e, g) => sqb.push([a, bb, c, d, e, g].join()), true);
  chk(sqb.join('|') === '0,0,0,2,2,1', 'box merge in x and y ' + sqb.join('|'));
  const bx = []; b.forEachBox((a, bb, c, d, e, g) => bx.push(1), false); chk(bx.length === 3, 'unmerged boxes');
  chk(b.getStartingAxisCoord(0, 0, 0) === 0 && b.getStartingAxisCoord(0, 1, 1) === 1 && b.getStartingAxisCoord(0, 1, 0) === 2 && b.getEndingAxisCoord(0, 0, 0) === 2 && b.getEndingAxisCoord(1, 1, 1) === 2 && b.getEndingAxisCoord(0, 5, 0) === 0 && b.getStartingAxisCoord(1, 0, 1) === 0 && b.getStartingAxisCoord(1, 1, 1) === 1, 'axis coords');
  let ne = 0; b.forEachEdge(() => ne++, true); chk(ne === 21, 'edges ' + ne);
  const Ls = S.BitSetVoxelSet(2, 2, 1); Ls.set(0, 0, 0); Ls.set(1, 0, 0); Ls.set(0, 1, 0); let le = 0; Ls.forEachEdge(() => le++, false); chk(le === 22, 'L edges ' + le);
  const full = S.BitSetVoxelSet.create(2, 2, 2, 0, 0, 0, 2, 2, 2); let fe = 0; full.forEachEdge(() => fe++, true); chk(fe === 12, 'cube has 12 edges ' + fe);
  const ds = []; full.forEachDirection((d, x, y, z) => ds.push(d.name + x + y + z)); chk(ds.length === 24, 'dirs ' + ds.length);
  const ds1 = []; S.BitSetVoxelSet.create(1, 1, 1, 0, 0, 0, 1, 1, 1).forEachDirection((d) => ds1.push(d.name)); chk(ds1.sort().join() === 'DOWN,EAST,NORTH,SOUTH,UP,WEST', 'dirs 1 cube ' + ds1.sort().join());
  const cp = S.BitSetVoxelSet(b); chk(cp.contains(1, 0, 0) && cp.getMax(2) === 2, 'copy');
  // combine OR of two 1x1x1 unit sets over identity lists
  const one = S.BitSetVoxelSet.create(1, 1, 1, 0, 0, 0, 1, 1, 1), none = S.BitSetVoxelSet(1, 1, 1);
  const lst = S.listOf([0, 1]), ip = S.IdentityPairList(lst);
  const or = S.BitSetVoxelSet.combine(one, none, ip, ip, ip, (a, c) => a || c), and = S.BitSetVoxelSet.combine(one, none, ip, ip, ip, (a, c) => a && c);
  chk(or.contains(0, 0, 0) && or.getMax(0) === 1 && !and.contains(0, 0, 0) && and.isEmpty(), 'combine');
  // cropped
  const cr = S.CroppedVoxelSet(b, 1, 0, 0, 2, 2, 2);
  chk(cr.getXSize() === 1 && cr.contains(0, 1, 1) && cr.contains(0, 0, 0) && cr.getMin(0) === 0 && cr.getMax(0) === 1, 'cropped');
  cr.set(0, 1, 0); chk(b.contains(1, 1, 0), 'cropped set writes parent');
  let th = false; try { S.BitSetVoxelSet(-1, -1, 1); } catch (e) { th = true; } chk(th, 'negative size');
  // shapes
  const sv = S.SimpleVoxelShape(S.BitSetVoxelSet(4, 2, 1));
  chk(L(S, sv.getPointPositions(0)) === '0,0.25,0.5,0.75,1' && sv.getCoordIndex(0, 0.3) === 1 && sv.getCoordIndex(0, 5) === 4 && sv.getCoordIndex(0, -5) === -1, 'simple shape');
  const av = S.ArrayVoxelShape(S.BitSetVoxelSet(1, 1, 1), [0, 1], [0, 2], [0, 3]);
  chk(L(S, av.getPointPositions(1)) === '0,2' && L(S, av.getPointPositions(2)) === '0,3', 'array shape');
  th = false; try { S.ArrayVoxelShape(S.BitSetVoxelSet(1, 1, 1), S.listOf([0, 1, 2]), S.listOf([0, 1]), S.listOf([0, 1])); } catch (e) { th = true; } chk(th, 'array shape mismatch');
  const base = S.ArrayVoxelShape(S.BitSetVoxelSet.create(2, 1, 1, 0, 0, 0, 2, 1, 1), [0, 0.5, 1], [0, 1], [0, 1]);
  const sl = S.SlicedVoxelShape(base, 0, 1);
  chk(sl.voxels.getXSize() === 1 && L(S, sl.getPointPositions(0)) === '0,1' && L(S, sl.getPointPositions(1)) === '0,1' && sl.voxels.contains(0, 0, 0), 'sliced');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const cuts = [
  (s) => s.replace("return i / n; }", "return i / (n + 1); }"),
  (s) => s.replace("old.getDouble(i) + off", "old.getDouble(i) - off"),
  (s) => s.replace("c(Math.trunc(i / gc), Math.trunc(i / first), i)", "c(Math.trunc(i / first), Math.trunc(i / gc), i)"),
  (s) => s.replace("return c(b, a, m); }) : it(c)", "return c(a, b, m); }) : it(c)"),
  (s) => s.replace("c(n - 1, i, n + i)", "c(n, i, n + i)"),
  (s) => s.replace("l0.getDouble(i0) < l1.getDouble(i1) + 1.0E-7", "l0.getDouble(i0) > l1.getDouble(i1) + 1.0E-7"),
  (s) => s.replace("size = Math.max(1, k)", "size = k"),
  (s) => s.replace("o.maxX = Math.max(o.maxX, a + 1)", "o.maxX = Math.max(o.maxX, a)"),
  (s) => s.replace("while (t.isColumnFull(run, z, x2 + 1, y))", "while (false)"),
  (s) => s.replace("while (t.isColumnsFull(x, x2 + 1, run, z, y2 + 1))", "while (false)"),
  (s) => s.replace("o.maxX = r[3] + 1;", "o.maxX = r[3];"),
  (s) => s.replace("return Math.min(Math.max(v, lo), hi) - lo;", "return Math.min(Math.max(v, lo), hi);"),
  (s) => s.replace("parent.set(x0 + a, y0 + b, z0 + c)", "parent.set(a, b, c)"),
  (s) => s.replace("Math.floor(Math.min(Math.max(v * n, -1.0), n))", "Math.floor(Math.max(v * n, -1.0))"),
  (s) => s.replace("a === axis ? POINTS", "a !== axis ? POINTS"),
  (s) => s.replace("choose(a, z, x, y); } },\n    BACKWARD", "choose(a, y, z, x); } },\n    BACKWARD"),
  (s) => s.replace("if (!(x >= 0 && y >= 0 && z >= 0)) throw", "if (false) throw"),
  (s) => s.replace("return i + 1;", "return i;"),
  (s) => s.replace("if (cnt === 1 || cnt === 3 ||", "if (cnt === 1 ||"),
  (s) => s.replace("if (!prev && cur) cons(dn", "if (!prev && cur) cons(up"),
];
let caught = 0;
cuts.forEach((cut, i) => {
  const mut = cut(src);
  if (mut === src) { console.log('FAIL cut ' + i + ' did not change the source'); process.exit(1); }
  let bad; try { bad = scenario(load(mut)).length > 0; } catch (e) { bad = true; }
  if (bad) caught++; else { console.log('FAIL cut ' + i + ' not caught'); process.exit(1); }
});
console.log("PASS shape11767check — " + caught + " breaks caught");
