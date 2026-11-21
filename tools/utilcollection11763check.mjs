#!/usr/bin/env node
// utilcollection11763check.mjs — #11763: src/02q_utilcollection.js (net/minecraft/util/collection ports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/02q_utilcollection.js', 'utf8');
const built = readFileSync(ROOT + 'dist/mclite.html', 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.UtilCollection; }
const throws = (f) => { try { f(); } catch (e) { return true; } return false; };
function scenario(C) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const d = C.DefaultedList.ofSize(3, 'x'); d.set(1, 'y'); d.clear();
  chk(d.size() === 3 && d.get(1) === 'x', 'dl clear resets');
  chk(throws(() => d.set(0, null)), 'dl null');
  const d2 = C.DefaultedList.of(); d2.add('a'); d2.add('b'); d2.clear(); chk(d2.size() === 0, 'dl of clear');
  const e = C.EmptyPaletteStorage(10); const out = new Int32Array(10).fill(5); e.method_39892(out);
  chk(e.get(9) === 0 && throws(() => e.get(10)) && throws(() => e.set(0, 1)) && e.getElementBits() === 0 && out.every((v) => v === 0) && e.copy() === e, 'empty storage');
  const il = C.IdList(), A = {}, B = {}; il.set(A, 3); il.add(B);
  chk(il.getRawId(A) === 3 && il.getRawId(B) === 4 && il.get(0) === null && il.get(99) === null && il.get(-1) === null && il.get(4) === B && il.size() === 2 && [...il.iterator()].length === 2 && il.getRawId({}) === -1 && !il.containsKey(1), 'idlist');
  const bm = C.Int2ObjectBiMap.create(8), o1 = {}, o2 = {}, o3 = {}; bm.put(o1, 0); bm.put(o2, 2); const id = bm.add(o3);
  chk(id === 1 && bm.getRawId(o3) === 1 && bm.get(2) === o2 && bm.size() === 3 && bm.add({}) === 3 && bm.contains(o1) && !bm.contains({}), 'bimap');
  const bc = bm.copy(); bm.clear(); chk(bm.size() === 0 && bc.size() === 4 && bc.get(0) === o1 && bm.get(0) === null, 'bimap copy/clear');
  for (const bits of [1, 4, 5, 7, 13, 21, 32]) {
    const n = 1000, P = C.PackedIntegerArray(bits, n), max = bits === 32 ? 4294967295 : (1 << bits) - 1, ref = [];
    for (let i = 0; i < n; i++) { const v = (i * 2654435761 >>> 0) % (max + 1); ref.push(v); P.set(i, v); }
    let ok = true; for (let i = 0; i < n; i++) if (P.get(i) !== ref[i]) ok = false;
    const per = Math.floor(64 / bits); ok = ok && P.getData().length === Math.ceil(n / per);
    const all = []; P.forEach((v) => all.push(v)); ok = ok && all.length === n && all.every((v, i) => v === ref[i]);
    const arr = new Int32Array(n); P.method_39892(arr); ok = ok && arr.every((v, i) => v === (ref[i] | 0));
    const P2 = P.copy(); P2.set(0, ref[0] === 0 ? 1 : 0); ok = ok && P.get(0) === ref[0];
    chk(ok, 'packed ' + bits);
  }
  const P4 = C.PackedIntegerArray(4, 20); chk(P4.swap(3, 9) === 0 && P4.swap(3, 2) === 9 && P4.get(3) === 2 && P4.getData()[0] === (2n << 12n), 'packed swap/layout');
  chk(throws(() => P4.set(0, 16)) && throws(() => P4.get(20)) && throws(() => C.PackedIntegerArray(33, 1)), 'packed range');
  chk(throws(() => C.PackedIntegerArray(4, 20, new BigUint64Array(3))), 'packed length');
  const P5 = C.PackedIntegerArray(4, 20, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16 + 1, 0, 0, 0, 0]); chk(P5.get(2) === 3 && P5.get(15) === 1, 'packed from ints');
  const H = C.LinkedBlockPosHashSet(), pos = (x, y, z) => (BigInt.asUintN(26, BigInt(x)) << 38n) | (BigInt.asUintN(26, BigInt(z)) << 12n) | BigInt.asUintN(12, BigInt(y));
  const p1 = BigInt.asIntN(64, pos(5, 70, -9)), p2 = BigInt.asIntN(64, pos(6, 70, -9)), p3 = BigInt.asIntN(64, pos(100, 3, 100));
  chk(H.add(p1) === false && H.add(p1) === true && H.add(p2) === false && H.add(p3) === false && !H.isEmpty() && throws(() => H.size()), 'lbphs add');
  chk(H.rem(p2) === true && H.rem(p2) === false && H.rem(0n) === false, 'lbphs rem');
  const first = H.removeFirstLong(); chk(first === p1, 'lbphs first ' + first);
  chk(H.removeFirstLong() === p3 && H.isEmpty() && throws(() => H.removeFirstLong()), 'lbphs drain');
  const H0 = C.LinkedBlockPosHashSet(); chk(H0.add(0n) === false && H0.add(0n) === true && H0.add(1n) === false && H0.rem(0n) && H0.removeFirstLong() === 1n && H0.isEmpty(), 'lbphs zero key');
  const HL = C.LinkedBlockPosHashSet(); HL.add(1n << 14n); HL.add(1n << 13n); chk(HL.removeFirstLong() === (1n << 14n) && HL.removeFirstLong() === (1n << 13n), 'lbphs layout');
  const S = C.SortedArraySet(); [5, 1, 3, 3, 9].forEach((v) => S.add(v));
  chk(S.toArray().join() === '1,3,5,9' && S.add(3) === false && S.first() === 1 && S.last() === 9 && S.contains(5) && !S.contains(4) && S.remove(5) && !S.remove(5) && S.size() === 3, 'sas');
  const it = S.iterator(); it.next(); it.next(); it.remove(); chk(S.toArray().join() === '1,9' && throws(() => it.remove()), 'sas iterator');
  const S3 = C.SortedArraySet(); [1, 2, 3, 4].forEach((v) => S3.add(v)); const i3 = S3.iterator(), seen = []; while (i3.hasNext()) { const v = i3.next(); seen.push(v); if (v % 2 === 1) i3.remove(); }
  chk(seen.join() === '1,2,3,4' && S3.toArray().join() === '2,4', 'sas iterator remove-while-iterating ' + seen);
  const S2 = C.SortedArraySet((a, b) => a.k - b.k), k1 = { k: 1, n: 'a' }; S2.add(k1);
  chk(S2.addAndGet({ k: 1, n: 'b' }) === k1 && S2.getIfContains({ k: 1 }) === k1 && S2.getIfContains({ k: 2 }) === null, 'sas cmp');
  class Ent {} class Mob extends Ent {} class Pig extends Mob {} class Cow extends Mob {}
  const L = C.TypeFilterableList(Ent), pig = new Pig(), cow = new Cow(), ent = new Ent();
  L.add(pig); chk(L.getAllOfType(Mob).length === 1, 'tfl lazy'); L.add(cow); L.add(ent);
  chk(L.getAllOfType(Mob).length === 2 && L.getAllOfType(Pig).length === 1 && L.size() === 3 && L.contains(pig) && !L.contains(new Pig()), 'tfl views');
  chk(L.remove(pig) && L.getAllOfType(Mob).length === 1 && L.getAllOfType(Pig).length === 0 && L.size() === 2 && !L.remove(pig), 'tfl remove');
  chk(throws(() => L.getAllOfType(Array)) && L.copy().length === 2, 'tfl type guard');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
if (!built.includes('NS.UtilCollection = {}') && !built.includes('NS.UtilCollection={}')) { console.log('FAIL: UtilCollection not in dist/mclite.html'); process.exit(1); }
const cuts = [
  (s) => s.replace("if (init == null) d.length = 0; else", "if (false) d.length = 0; else"),
  (s) => s.replace("function (i, v) { notNull(v); if (i < 0 || i >= d.length) throw new RangeError('Index ' + i); var o", "function (i, v) { if (i < 0 || i >= d.length) throw new RangeError('Index ' + i); var o"),
  (s) => s.replace("copy: function () { return this; }", "copy: function () { return C.EmptyPaletteStorage(size); }"),
  (s) => s.replace("out.fill(0, 0, size)", "out.fill(0, 0, 0)"),
  (s) => s.replace("if (nextId <= id) nextId = id + 1; },", "},"),
  (s) => s.replace("return id >= 0 && id < list.length ? list[id] : null; },", "return list[id]; },"),
  (s) => s.replace("copy: function () { return biMap(new Map(values), idToValues.slice(), nextId, size); }", "copy: function () { return biMap(values, idToValues, nextId, size); }"),
  (s) => s.replace("per = Math.trunc(64 / bits)", "per = Math.trunc(63 / bits)"),
  (s) => s.replace("B(IP[p + 1] >>> 0)", "B((IP[p + 1] + 1) >>> 0)"),
  (s) => s.replace("data[s] = (w & ~(mask << sh)) | ((B(v) & mask) << sh)", "data[s] = (w | ((B(v) & mask) << sh))"),
  (s) => s.replace("between(1, 32, bits)", "between(1, 64, bits)"),
  (s) => s.replace("if (init.length !== len) throw", "if (false) throw"),
  (s) => s.replace("if (++n >= size) return;", "if (++n > size) return;"),
  (s) => s.replace("var START = 25, HSEP = 25", "var START = 26, HSEP = 25"),
  (s) => s.replace("return (z << 4) | (x << 2) | y;", "return (z << 4) | (y << 2) | x;"),
  (s) => s.replace("m.set(k, v | bit); return (v & bit) !== 0n;", "m.set(k, v | bit); return false;"),
  (s) => s.replace("if (v === 0n) m.delete(k); else m.set(k, v); return true;", "m.set(k, v); return true;"),
  (s) => s.replace("while (tz < 64 && ((v >> BigInt(tz)) & 1n) === 0n) tz++;", ""),
  (s) => s.replace("size: function () { throw new Error('UnsupportedOperationException'); }", "size: function () { return m.size; }"),
  (s) => s.replace("if (i >= 0) return false; el.splice(-i - 1, 0, x); return true;", "el.splice(-i - 1 < 0 ? 0 : -i - 1, 0, x); return true;"),
  (s) => s.replace("if (i >= 0) return el[i]; el.splice(-i - 1, 0, x); return x;", "el.splice(-i - 1, 0, x); return x;"),
  (s) => s.replace("el.splice(last, 1); next--; last = -1;", "el.splice(last, 1); last = -1;"),
  (s) => s.replace("if (c < 0) lo = mid + 1; else if (c > 0) hi = mid - 1;", "if (c > 0) lo = mid + 1; else if (c < 0) hi = mid - 1;"),
  (s) => s.replace("if (x instanceof c) { l.push(x); r = true; }", "if (x instanceof c && c === elementType) { l.push(x); r = true; }"),
  (s) => s.replace("if (i >= 0) { l.splice(i, 1); r = true; } } }); return r; },", "if (i >= 0) { r = true; } } }); return r; },"),
  (s) => s.replace("c.prototype instanceof elementType)) throw", "c.prototype instanceof elementType) && false) throw"),
  (s) => s.replace("l = all.filter(function (x) { return x instanceof c; })", "l = all.slice()"),
];
let caught = 0;
for (const c of cuts) { const s2 = c(src); if (s2 === src) { console.log('cut did not apply', c.toString()); process.exit(1); } let r; try { r = scenario(load(s2)).length; } catch (e) { r = 1; } if (r) caught++; else console.log('uncaught cut', c.toString()); }
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length); process.exit(1); }
console.log('PASS utilcollection11763check — ' + caught + ' breaks caught');
