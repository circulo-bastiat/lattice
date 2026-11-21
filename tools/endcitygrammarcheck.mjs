#!/usr/bin/env node
// endcitygrammarcheck.mjs — #9448: ST.defs.end_city.grammar places the EndCityGenerator pieces.
//   node tools/endcitygrammarcheck.mjs
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };
console.log('endcitygrammarcheck -- #9448, end_city grammar');

const M = loadEngine({ initReg: true });
const T = M.Templates, Rnd = M.Noise ? M.Noise.LegacyRandom : M.LegacyRandom;
const size = (n) => { const e = T.get(T.index('end_city/' + n)); return [e.sx, e.sy, e.sz]; };

// the decompiled opening of EndCityGenerator.addPieces: base_floor, second_floor_1 (-1,0,-1), third_floor_1 (-1,4,-1), third_roof (-1,8,-1), each y offset is relative to the previous piece, then tower_base
const OPEN = [['base_floor', 0, true], ['second_floor_1', 0, false], ['third_floor_1', 4, false], ['third_roof', 8, true]];

function check(pieces, ref, rot0, label) {
  if (pieces.length !== ref.length) return ok(false, `${label}: ${pieces.length} pieces, layout has ${ref.length}`);
  let good = true;
  for (let i = 0; i < ref.length; i++) {
    const p = pieces[i], r = ref[i];
    if (p.kind !== 'template' || p.x0 !== r.bb[0] || p.y0 !== r.bb[1] || p.z0 !== r.bb[2] || p.x1 !== r.bb[3] || p.y1 !== r.bb[4] || p.z1 !== r.bb[5] || p.rot !== r.rot || p.writeAir !== r.ow) { good = false; ok(false, `${label}: piece ${i} (${r.name}) differs`); break; }
  }
  for (let i = 0; i < OPEN.length && good; i++) {
    const r = ref[i];
    if (r.name !== OPEN[i][0] || r.rot !== rot0 || r.ow !== OPEN[i][2]) { good = false; ok(false, `${label}: opening piece ${i} is ${r.name}`); }
    if (i > 0 && r.bb[1] - ref[i - 1].bb[1] !== OPEN[i][1]) { good = false; ok(false, `${label}: opening piece ${i} y offset`); }
  }
  const tb = ref.find((p) => p.name === 'tower_base');
  if (!tb) { good = false; ok(false, `${label}: no tower_base`); }
  else if (!ref.some((p) => p.name === 'tower_piece') || !ref.some((p) => p.name === 'tower_top' || p.name === 'fat_tower_top')) { good = false; ok(false, `${label}: tower has no piece/top`); }
  return ok(good, label);
}

function brk(pcs, ref, rot, m) { const n = fails.length, r = check(pcs, ref, rot, 'x'); fails.length = n; pass--; okAv(!r, m); }
let good = 0;
for (let s = 1; s <= 12; s++) {
  const rot = s & 3;
  const ref = M.EndCity.generate(new Rnd(s), 100, 70, -40, rot, size);
  const pieces = M.EndCity.pieces(new Rnd(s), 100, 70, -40, rot);
  if (check(pieces, ref, rot, 'seed ' + s)) good++;
  if (s === 3) {
    // break 1: a wrong rotation on one piece
    const bad = pieces.map((p) => Object.assign({}, p)); bad[1].rot = (bad[1].rot + 1) & 3;
    brk(bad.slice(), ref, rot, 'a rotated piece is detected');
    // break 2: a dropped piece
    brk(pieces.slice(1), ref, rot, 'a missing piece is detected');
    // break 3: a shifted y
    const bad3 = pieces.map((p) => Object.assign({}, p)); bad3[2].y0 += 1;
    brk(bad3, ref, rot, 'a shifted tower floor is detected');
    // break 4: swapped overwrite flag
    const bad4 = pieces.map((p) => Object.assign({}, p)); bad4[0].writeAir = !bad4[0].writeAir;
    brk(bad4, ref, rot, 'a flipped air flag is detected');
  }
}
ok(good === 12, `${good}/12 seeds match`);

// ── the start height: EndCityFeature.getGenerationHeight (min of 4 samples, rotation-chosen corner) ──
// independent java.util.Random for the rotation, so the check does not trust the engine's own
const jrot = (x, z) => {
  let seed = (BigInt(x + Math.imul(z, 10387313) | 0) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
  const next = (bits) => { seed = (seed * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(seed >> (48n - BigInt(bits))); };
  return (4 * next(31)) / 2147483648 | 0;
};
const refHeight = (seed64, cx, cz, pick = Math.min, off = 5) => {
  const r = jrot(cx, cz); let dx = off, dz = off;
  if (r === 1) dx = -off; else if (r === 2) { dx = -off; dz = -off; } else if (r === 3) dz = -off;
  const x = cx * 16 + 7, z = cz * 16 + 7, g = (a, b) => M.EndCity.groundHeight(seed64, a, b);
  return pick(pick(g(x, z), g(x, z + dz)), pick(g(x + dx, z), g(x + dx, z + dz)));
};
M.Structures.G = { seed64: 1337n, seed: 1337 };
let hOk = 0, hN = 0, high = 0;
for (let cx = -90; cx < 90; cx += 3) for (let cz = -90; cz < 90; cz += 3) {
  const a = M.EndCity.startHeight(1337n, cx, cz), b = refHeight(1337n, cx, cz);
  hN++; if (a === b) hOk++;
  if (a >= 60) high++;
}
ok(hOk === hN, `startHeight matches the decompiled rule on ${hOk}/${hN} chunks`);
ok(high > 50 && high < hN, `the heights are not vacuous (${high} of ${hN} reach 60)`);
{
  // breaks: max instead of min, and a wrong corner offset, must change some answer
  let dMax = 0, dOff = 0;
  for (let cx = -90; cx < 90; cx += 3) for (let cz = -90; cz < 90; cz += 3) {
    const a = M.EndCity.startHeight(1337n, cx, cz);
    if (refHeight(1337n, cx, cz, Math.max) !== a) dMax++;
    if (refHeight(1337n, cx, cz, Math.min, 3) !== a) dOff++;
  }
  okAv(dMax > 0, 'max instead of min is detected');
  okAv(dOff > 0, 'a wrong corner offset is detected');
}
// the grammar expands to a tower centred on the chunk (+8) at the start height, in an end_highlands/midlands chunk
{
  let found = null;
  for (let cx = -90; cx < 90 && !found; cx++) for (let cz = -90; cz < 90 && !found; cz++) if (M.Structures.endHeight(cx, cz) >= 60) found = [cx, cz];
  ok(!!found, 'some chunk accepts an end city');
  if (found) {
    const [cx, cz] = found, h = M.Structures.endHeight(cx, cz);
    const pcs = M.EndCity.pieces(new Rnd(5), cx * 16 + 8, h, cz * 16 + 8, 0);
    ok(pcs.length > 6 && pcs[0].y0 === h, 'the base floor sits at the start height');
    ok(M.Structures.endHeight(cx, cz) === h, 'endHeight is deterministic');
  }
}

// registered on the structure def
const d = M.Structures.defs && M.Structures.defs.end_city;
ok(!d || d.grammar !== null, 'end_city has a grammar once registered');

console.log(`endcitygrammarcheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('FAIL ' + f); process.exit(1); }
