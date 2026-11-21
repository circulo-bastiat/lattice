#!/usr/bin/env node
// utilmath11764check.mjs — #11764: src/02q_utilmath.js (net/minecraft/util/math ports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/02q_utilmath.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.UtilMath; }
function scenario(U) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const AT = U.AxisTransformation, DT = U.DirectionTransformation, D = U.Direction;
  chk(AT.field_23365.prepend(AT.field_23365) === AT.field_23366 && AT.field_23363.prepend(AT.field_23363) === AT.field_23362, 'axis prepend');
  chk(DT.values.length === 48 && DT.values.every((t) => t.prepend(t.inverse()) === DT.identity && t.inverse().prepend(t) === DT.identity), 'dt inverses');
  const mm = (a, b) => { const o = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]; return o.join(); };
  chk(DT.values.every((a) => DT.values.every((b) => mm(a.matrix, b.matrix) === a.prepend(b).matrix.join())), 'dt matrix product');
  chk(DT.rot_90_y_pos.map(D.NORTH) === D.WEST && DT.invert_x.map(D.EAST) === D.WEST && DT.invert_x.map(D.UP) === D.UP && DT.swap_xy.map(D.EAST) === D.UP, 'dt map ' + DT.rot_90_y_pos.map(D.NORTH).name);
  chk(DT.invert_y.getMatrix()[4] === -1 && DT.identity.getMatrix().join() === '1,0,0,0,1,0,0,0,1' && DT.swap_xy.asString() === 'swap_xy', 'dt matrix');
  const bp = U.BlockPointerImpl({ getBlockState: (p) => 's' + p.x, getBlockEntity: () => 'be' }, { x: 3, y: 4, z: 5 });
  chk(bp.getX() === 3.5 && bp.getY() === 4.5 && bp.getZ() === 5.5 && bp.getBlockState() === 's3' && bp.getBlockEntity() === 'be' && U.PositionImpl(1, 2, 3).getZ() === 3, 'pointer');
  const A = U.ColorHelper.Argb, c = A.getArgb(255, 128, 64, 32);
  chk(A.getAlpha(c) === 255 && A.getRed(c) === 128 && A.getGreen(c) === 64 && A.getBlue(c) === 32 && c < 0, 'argb');
  chk(A.mixColor(A.getArgb(200, 255, 128, 10), A.getArgb(100, 128, 128, 255)) === A.getArgb(78, 128, 64, 10), 'mix');
  const cp = U.ColumnPos(-1, 17);
  chk(U.ColumnPos(-40, 17).toChunkPos().x === -3 && cp.toChunkPos().x === -1 && cp.toChunkPos().z === 1, 'chunkpos');
  chk(U.ColumnPos.pack(-1, 17) === (17n << 32n | 0xFFFFFFFFn) && U.ColumnPos.pack(2, -1) === -4294967294n, 'pack ' + U.ColumnPos.pack(2, -1));
  chk(cp.toString() === '[-1, 17]' && cp.equals(U.ColumnPos({ x: -1, z: 17 })) && U.ColumnPos(0, 0).hashCode() === ((1013904223) ^ (Math.imul(1664525, -559038737) + 1013904223 | 0)), 'colpos');
  const E = U.EightWayDirection;
  chk(E.values.length === 8 && E.NORTH_EAST.getDirections().size === 2 && E.NORTH_EAST.getDirections().has(D.EAST) && E.WEST.getDirections().has(D.WEST), 'eight');
  const ea = U.EulerAngle(370, NaN, -Infinity), ea2 = U.EulerAngle([10, 200, 0]);
  chk(ea.getPitch() === 10 && ea.getYaw() === 0 && ea.getRoll() === 0 && ea2.getWrappedYaw() === -160 && ea2.equals(U.EulerAngle(ea2.toNbt())), 'euler');
  const q = U.Quantiles.create([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  chk([...q.keys()].join() === '99,90,75,50' && q.get(50) === 5.5 && Math.abs(q.get(90) - 9.1) < 1e-9 && q.get(99) > 9.9 && U.Quantiles.create([]).size === 0, 'quantiles ' + [...q.values()]);
  const v = U.Vec2f(3, 4);
  chk(v.length() === 5 && v.lengthSquared() === 25 && v.normalize().x === Math.fround(0.6) && U.Vec2f(0, 0.00001).normalize() === U.Vec2f.ZERO && v.dot(U.Vec2f(1, 2)) === 11 && v.negate().x === -3 && v.add(1).y === 5 && v.add(U.Vec2f(1, 1)).x === 4 && v.distanceSquared(U.Vec2f(0, 0)) === 25 && v.multiply(2).y === 8, 'vec2f');
  const VS = U.VerticalSurfaceType;
  chk(VS.byName('floor') === VS.FLOOR && VS.CEILING.getOffset() === 1 && VS.FLOOR.getOffset() === -1 && VS.FLOOR.getDirection() === D.DOWN && VS.CEILING.asString() === 'ceiling', 'surface');
  let th = false; try { VS.byName('x'); } catch (e) { th = true; } chk(th, 'surface throws');
  const w = U.WordPackedArray(5, 30);
  for (let i = 0; i < 30; i++) w.set(i, (i * 7) % 32);
  let ok = true; for (let i = 0; i < 30; i++) if (w.get(i) !== (i * 7) % 32) ok = false;
  chk(ok && w.getAlignedArray().length === 3 && w.getUnitSize() === 5, 'wpa roundtrip');
  w.set(12, 0); chk(w.get(11) === (11 * 7) % 32 && w.get(13) === (13 * 7) % 32 && w.get(12) === 0, 'wpa neighbours');
  th = false; try { w.set(0, 32); } catch (e) { th = true; } chk(th, 'wpa range');
  th = false; try { U.WordPackedArray(33, 1); } catch (e) { th = true; } chk(th, 'wpa unit');
  th = false; try { U.WordPackedArray(5, 30, [0n]); } catch (e) { th = true; } chk(th, 'wpa length');
  const B = U.Box, b = B(1, 2, 3, 0, 0, 0);
  chk(b.minX === 0 && b.maxX === 1 && b.maxY === 2 && b.getXLength() === 1 && B({ x: 1, y: 2, z: 3 }).maxZ === 4 && B({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }).maxX === 2, 'box ctor');
  const u = B(0, 0, 0, 2, 2, 2);
  chk(u.shrink(1, -1, 0).minY === 1 && u.shrink(1, -1, 0).maxX === 1 && u.stretch(1, -1, 0).minY === -1 && u.stretch(1, -1, 0).maxX === 3, 'shrink/stretch');
  chk(u.expand(1).minX === -1 && u.contract(0.5).maxX === 1.5 && u.intersection(B(1, 1, 1, 3, 3, 3)).minX === 1 && u.union(B(1, 1, 1, 3, 3, 3)).maxX === 3 && u.offset(1, 2, 3).minZ === 3, 'box ops');
  chk(u.intersects(B(1, 1, 1, 3, 3, 3)) && !u.intersects(B(2, 0, 0, 3, 3, 3)) && u.contains(0, 0, 0) && !u.contains(2, 0, 0) && u.intersects({ x: 1, y: 1, z: 1 }, { x: 5, y: 5, z: 5 }), 'intersects/contains');
  chk(u.getCenter().x === 1 && u.getAverageSideLength() === 2 && !u.isValid() && B.of({ x: 0, y: 0, z: 0 }, 2, 2, 2).minX === -1 && u.toString() === 'AABB[0, 0, 0] -> [2, 2, 2]', 'box misc');
  const hit = u.raycast({ x: -1, y: 1, z: 1 }, { x: 3, y: 1, z: 1 });
  chk(hit && hit.x === 0 && u.raycast({ x: -1, y: 5, z: 1 }, { x: 3, y: 5, z: 1 }) === null, 'raycast');
  const rh = B.raycastBoxes([B(0, 0, 0, 1, 1, 1)], { x: 0.5, y: 5, z: 0.5 }, { x: 0.5, y: -5, z: 0.5 }, { x: 0, y: 0, z: 0 });
  chk(rh && rh.side === D.UP && rh.pos.y === 1, 'raycastBoxes');
  chk(u.withMinX(5).minX === 2 && u.withMaxY(-5).minY === -5 && u.equals(B(0, 0, 0, 2, 2, 2)) && !u.equals(b), 'with/equals');
  const M4 = U.Matrix4f, AF = U.AffineTransformation, AFS = U.AffineTransformations, QQ = U.Quaternion;
  const q90 = QQ.fromDegrees({ x: 0, y: 1, z: 0 }, 90), rm = M4.fromQuaternion(q90);
  chk(Math.abs(rm[2] - 1) < 1e-6 && Math.abs(rm[8] + 1) < 1e-6 && rm[15] === 1, 'quat matrix ' + rm);
  const rz = M4.fromQuaternion(QQ.fromDegrees({ x: 0, y: 0, z: 1 }, 90));
  chk(Math.abs(rz[0]) < 1e-6 && Math.abs(rz[4] - 1) < 1e-6 && Math.abs(rz[1] + 1) < 1e-6, 'z rotation ' + rz);
  const tr = AF({ x: 1, y: 2, z: 3 }, q90, { x: 2, y: 2, z: 2 }, null);
  chk(tr.getMatrix()[3] === 1 && tr.getMatrix()[7] === 2 && Math.abs(tr.getMatrix()[2] - 2) < 1e-6 && tr.getScale().x === 2 && tr.getTranslation().z === 3, 'affine ctor');
  const iv = AFS.DIRECTION_ROTATIONS.EAST.multiply(AFS.INVERTED_DIRECTION_ROTATIONS.EAST).getMatrix();
  chk(iv.every((v, i) => Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-6), 'rotation * inverse = identity');
  chk(AF.identity().invert() === AF.identity() && AF(M4.scale(0, 1, 1)).invert() === null, 'identity/singular invert');
  const uv = AFS.setupUvLock(AFS.DIRECTION_ROTATIONS.EAST).getMatrix();
  chk(Math.abs(uv[3]) < 1e-6 && Math.abs(uv[11] - 1) < 1e-6 && Math.abs(uv[2] - 1) < 1e-6, 'uvlock ' + uv);
  chk(AF(M4.translate(1, 2, 3)).getTranslation().y === 2 && AF(M4.identity()).equals(AF.identity()), 'matrix affine');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const cuts = [
  (s) => s.replace("['rot_90_y_pos', 5, 0, 0, 1]", "['rot_90_y_pos', 5, 1, 0, 1]"),
  (s) => s.replace("a.flips[k] !== b.flips[a.axisTransformation.map(k)]", "a.flips[k] !== b.flips[k]"),
  (s) => s.replace("flips[ax] ? -x.sign : x.sign", "x.sign"),
  (s) => s.replace("a.mappings[b.mappings[k]]", "b.mappings[a.mappings[k]]"),
  (s) => s.replace("return pos.x + 0.5; }", "return pos.x; }"),
  (s) => s.replace("c >> 16 & 255", "c >> 8 & 255"),
  (s) => s.replace("Math.trunc(G.getAlpha(p) * G.getAlpha(q) / 255)", "G.getAlpha(p)"),
  (s) => s.replace("{ x: c.x >> 4, z: c.z >> 4 }", "{ x: c.x >> 5, z: c.z >> 4 }"),
  (s) => s.replace("BigInt.asUintN(32, BigInt(z)) << 32n", "BigInt.asUintN(32, BigInt(z)) << 31n"),
  (s) => s.replace("c.z ^ -559038737", "c.z"),
  (s) => s.replace("['NORTH_EAST', 'NORTH', 'EAST']", "['NORTH_EAST', 'NORTH']"),
  (s) => s.replace("fr(v % 360) : 0", "fr(v) : 0"),
  (s) => s.replace("if (f >= 180) f -= 360;", ""),
  (s) => s.replace("[99, 90, 75, 50]", "[50, 75, 90, 99]"),
  (s) => s.replace("(s[q + 1] - s[q]) * rem / 100", "(s[q + 1] - s[q]) * rem / 50"),
  (s) => s.replace("l < fr(1.0E-4) ? V2.ZERO", "l < fr(1.0E-9) ? V2.ZERO"),
  (s) => s.replace("offset: -1 }", "offset: 1 }"),
  (s) => s.replace("V >> BigInt(hi)", "V >> BigInt(hi + 1)"),
  (s) => s.replace("rng(v, Number(max));", ""),
  (s) => s.replace("if (!(unit >= 1 && unit <= 32))", "if (false)"),
  (s) => s.replace("arr[a] >> BigInt(o) | arr[b] << BigInt(64 - o)", "arr[a] >> BigInt(o)"),
  (s) => s.replace("if (d < 0) m[i] -= d; else if (d > 0) m[i + 3] -= d;", "if (d < 0) m[i] += d; else if (d > 0) m[i + 3] -= d;"),
  (s) => s.replace("b.minX < e && b.maxX > a", "b.minX <= e && b.maxX >= a"),
  (s) => s.replace("x < b.maxX && y >= b.minY", "x <= b.maxX && y >= b.minY"),
  (s) => s.replace("0 < k && k < t[0]", "0 < k && k > t[0]"),
  (s) => s.replace("Math.max(b.minX, o.minX), Math.max(b.minY", "Math.min(b.minX, o.minX), Math.max(b.minY"),
  (s) => s.replace("m[0] = fr(fr(1 - b) - c)", "m[0] = fr(fr(1 - b) + c)"),
  (s) => s.replace("m[4] = fr(2 * fr(xy + zw))", "m[4] = fr(2 * fr(xy - zw))"),
  (s) => s.replace("if (a) { m[3] = fr(a.x);", "if (false) { m[3] = fr(a.x);"),
  (s) => s.replace("if (self === AFF.identity()) return self;", ""),
  (s) => s.replace("M4.translate(0.5, 0.5, 0.5), t.getMatrix()); return AFF(M4.multiply(m, M4.translate(-0.5, -0.5, -0.5))", "M4.translate(0.5, 0.5, 0.5), t.getMatrix()); return AFF(M4.multiply(m, M4.translate(0.5, 0.5, 0.5))"),
  (s) => s.replace("AFF(null, Q.fromDegrees(AX.Y, 90), null, null); DR.WEST", "AFF(null, Q.fromDegrees(AX.Y, -90), null, null); DR.WEST"),
];
let caught = 0;
for (const c of cuts) { const s2 = c(src); if (s2 === src) { console.log('cut did not apply', c.toString()); process.exit(1); } let r; try { r = scenario(load(s2)).length; } catch (e) { r = 1; } if (r) caught++; else console.log('uncaught cut', c.toString()); }
if (caught !== cuts.length) { console.log('FAIL: only ' + caught + '/' + cuts.length); process.exit(1); }
console.log('PASS utilmath11764check — ' + caught + ' breaks caught');
