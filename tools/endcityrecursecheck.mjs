#!/usr/bin/env node
// endcityrecursecheck.mjs — #9449: EndCityGenerator's recursive part selection (bridges, fat tower, depth, RNG draws).
//   node tools/endcityrecursecheck.mjs
// An independent interpreter of the decompiled EndCityGenerator (BlockBox + rotation enum, not the engine's rotXZ/bb
// arithmetic) is run beside EndCity.generate for many seeds; piece lists AND the number of RNG draws must agree.
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };
console.log('endcityrecursecheck -- #9449, end_city recursion');

// BlockRotation enum order as declared: field_11467 NONE, field_11463 CW90, field_11464 CW180, field_11465 CCW90
const NONE = 'N', CW90 = 'C', CW180 = 'H', CCW90 = 'W';
const ORD = [NONE, CW90, CW180, CCW90];
const rotPlus = (a, b) => ORD[(ORD.indexOf(a) + ORD.indexOf(b)) & 3];
const turn = (r, x, z) => r === CW90 ? [-z, x] : r === CW180 ? [-x, -z] : r === CCW90 ? [z, -x] : [x, z];

function reference(rng, x, y, z, rotIdx, size, opts = {}) {
  let ship = false;
  const mk = (name, pos, rot, ow) => ({ name, pos: pos.slice(), rot, ow, chain: 0 });
  const box = (p) => {
    const s = size(name2(p)), c = turn(p.rot, s[0] - 1, s[2] - 1);
    return [Math.min(0, c[0]) + p.pos[0], p.pos[1], Math.min(0, c[1]) + p.pos[2], Math.max(0, c[0]) + p.pos[0], p.pos[1] + s[1] - 1, Math.max(0, c[1]) + p.pos[2]];
  };
  const name2 = (p) => p.name;
  const piece = (par, off, name, rot, ow) => {
    const p = mk(name, par.pos, rot, ow), o = turn(par.rot, off[0], off[2]);
    p.pos = [p.pos[0] + o[0], p.pos[1] + off[1], p.pos[2] + o[1]];
    return p;
  };
  const hit = (a, b) => a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];
  const push = (l, p) => (l.push(p), p);
  const SMALL = [[NONE, [1, -1, 0]], [CW90, [6, -1, 1]], [CCW90, [0, -1, 5]], [CW180, [5, -1, 6]]];
  const FAT = [[NONE, [4, -1, 0]], [CW90, [12, -1, 4]], [CCW90, [0, -1, 8]], [CW180, [8, -1, 12]]];
  const draws = opts.draws || { n: 0 };
  const ni = (b) => { draws.n++; return b === undefined ? rng.nextInt() : rng.nextInt(b); };
  const nb = () => { draws.n++; return rng.next(1) !== 0; };
  const maxDepth = opts.maxDepth === undefined ? 8 : opts.maxDepth;
  const parts = {
    building(d, par, l, pos) {
      if (d > maxDepth) return false;
      const r = par.rot; let p = push(l, piece(par, pos, 'base_floor', r, true)); const k = ni(3);
      if (k === 0) push(l, piece(p, [-1, 4, -1], 'base_roof', r, true));
      else if (k === 1) {
        p = push(l, piece(p, [-1, 0, -1], 'second_floor_2', r, false)); p = push(l, piece(p, [-1, 8, -1], 'second_roof', r, false));
        createPart(parts.small, d + 1, p, null, l);
      } else {
        p = push(l, piece(p, [-1, 0, -1], 'second_floor_2', r, false)); p = push(l, piece(p, [-1, 4, -1], 'third_floor_2', r, false));
        p = push(l, piece(p, [-1, 8, -1], 'third_roof', r, true)); createPart(parts.small, d + 1, p, null, l);
      }
      return true;
    },
    small(d, par, l) {
      const r = par.rot; const a = ni(2), b = ni(2);
      let p = push(l, piece(par, [3 + a, -3, 3 + b], 'tower_base', r, true));
      p = push(l, piece(p, [0, 7, 0], 'tower_piece', r, true));
      let br = ni(3) === 0 ? p : null; const n = 1 + ni(3);
      for (let i = 0; i < n; i++) { p = push(l, piece(p, [0, 4, 0], 'tower_piece', r, true)); if (i < n - 1 && nb()) br = p; }
      if (br) {
        for (const [ar, ap] of SMALL) if (nb()) { const e = push(l, piece(br, ap, 'bridge_end', rotPlus(r, ar), true)); createPart(parts.bridge, d + 1, e, null, l); }
        push(l, piece(p, [-1, 4, -1], 'tower_top', r, true));
      } else {
        if (d !== 7) return createPart(parts.fat, d + 1, p, null, l);
        push(l, piece(p, [-1, 4, -1], 'tower_top', r, true));
      }
      return true;
    },
    bridge(d, par, l) {
      const r = par.rot, n = ni(4) + 1;
      let p = push(l, piece(par, [0, 0, -4], 'bridge_piece', r, true)); p.chain = -1; let dy = 0;
      for (let i = 0; i < n; i++) {
        if (nb()) { p = push(l, piece(p, [0, dy, -4], 'bridge_piece', r, true)); dy = 0; }
        else { p = push(l, nb() ? piece(p, [0, dy, -4], 'bridge_steep_stairs', r, true) : piece(p, [0, dy, -8], 'bridge_gentle_stairs', r, true)); dy = 4; }
      }
      if (!ship && ni(10 - d) === 0) {
        const sx = -8 + ni(8), sz = -70 + ni(10); push(l, piece(p, [sx, dy, sz], 'ship', r, true)); ship = true;
      } else if (!createPart(parts.building, d + 1, p, [-3, dy + 1, -11], l)) return false;
      p = push(l, piece(p, [4, dy, 0], 'bridge_end', rotPlus(r, CW180), true)); p.chain = -1;
      return true;
    },
    fat(d, par, l) {
      const r = par.rot; let p = push(l, piece(par, [-3, 4, -3], 'fat_tower_base', r, true));
      p = push(l, piece(p, [0, 4, 0], 'fat_tower_middle', r, true));
      for (let i = 0; i < 2 && ni(3) !== 0; i++) {
        p = push(l, piece(p, [0, 8, 0], 'fat_tower_middle', r, true));
        for (const [ar, ap] of FAT) if (nb()) { const e = push(l, piece(p, ap, 'bridge_end', rotPlus(r, ar), true)); createPart(parts.bridge, d + 1, e, null, l); }
      }
      push(l, piece(p, [-2, 8, -2], 'fat_tower_top', r, true));
      return true;
    },
  };
  function createPart(part, d, par, pos, all) {
    if (d > maxDepth) return false;
    const mine = [];
    if (!part(d, par, mine, pos)) return false;
    const id = ni(); let bad = false;
    for (const p of mine) {
      p.chain = id; const b = box(p);
      const f = all.find((q) => hit(box(q), b));
      if (f && f.chain !== par.chain) { bad = true; break; }
    }
    if (bad) return false;
    all.push(...mine); return true;
  }
  const out = []; const R = ORD[rotIdx];
  let p = push(out, mk('base_floor', [x, y, z], R, true));
  p = push(out, piece(p, [-1, 0, -1], 'second_floor_1', R, false));
  p = push(out, piece(p, [-1, 4, -1], 'third_floor_1', R, false));
  p = push(out, piece(p, [-1, 8, -1], 'third_roof', R, true));
  createPart(parts.small, 1, p, null, out);
  return out.map((q) => ({ name: q.name, ow: q.ow, rot: ORD.indexOf(q.rot), bb: box(q), chain: q.chain }));
}

function audit(M) {
  const T = M.Templates, Rnd = M.Noise ? M.Noise.LegacyRandom : M.LegacyRandom;
  const size = (n) => { const e = T.get(T.index('end_city/' + n)); return [e.sx, e.sy, e.sz]; };
  let mism = 0, N = 0; const names = new Set(); let maxLen = 0, ships = 0, fat = 0, bridges = 0, deep = 0;
  for (let s = 1; s <= 150; s++) {
    const rot = s & 3, a = M.EndCity.generate(new Rnd(s), 7, 64, -9, rot, size);
    const rb = new Rnd(s), dA = { n: 0 };
    // count draws by wrapping the reference's rng; the engine's rng is advanced by the same amount iff the next draw agrees
    const b = reference(rb, 7, 64, -9, rot, size, { draws: dA });
    N++;
    const same = a.length === b.length && a.every((p, i) => p.name === b[i].name && p.ow === b[i].ow && p.rot === b[i].rot && p.bb.join() === b[i].bb.join());
    // RNG state after generation: engine's rng is not exposed, so run it again with the shared stream
    const rc = new Rnd(s); M.EndCity.generate(rc, 7, 64, -9, rot, size);
    const tail = rc.nextInt() === rb.nextInt();
    if (!same || !tail) mism++;
    for (const p of a) names.add(p.name);
    maxLen = Math.max(maxLen, a.length);
    ships += a.some((p) => p.name === 'ship'); fat += a.some((p) => p.name === 'fat_tower_top'); bridges += a.some((p) => p.name === 'bridge_end' && p.chain !== undefined);
  }
  return { mism, N, names, maxLen, ships, fat, bridges, size, Rnd, T };
}

const M = loadEngine({ initReg: true });
const a = audit(M);
ok(a.mism === 0, `${a.mism}/${a.N} seeds differ from the decompiled algorithm (pieces + RNG position)`);
ok(a.fat > 10, `fat towers appear (${a.fat}/${a.N})`);
ok(a.ships > 3, `ships appear (${a.ships}/${a.N})`);
ok(a.names.has('bridge_steep_stairs') && a.names.has('bridge_gentle_stairs') && a.names.has('fat_tower_middle') && a.names.has('second_roof') && a.names.has('base_roof'), 'bridge stairs, fat middle, second_roof and base_roof are all produced');
ok(a.maxLen > 40, `some city is large (${a.maxLen} pieces)`);

// the reference itself reacts to a broken rule (so agreement above is not vacuous), and the ENGINE breaks are caught
const cmpWith = (opts) => {
  let diff = 0;
  for (let s = 1; s <= 150; s++) {
    const rot = s & 3, e = M.EndCity.generate(new a.Rnd(s), 7, 64, -9, rot, a.size), r = reference(new a.Rnd(s), 7, 64, -9, rot, a.size, opts);
    if (e.length !== r.length || e.some((p, i) => p.name !== r[i].name || p.bb.join() !== r[i].bb.join())) diff++;
  }
  return diff;
};
okAv(cmpWith({ maxDepth: 7 }) > 0, 'reference depth limit 7 instead of 8 differs');
okAv(cmpWith({ maxDepth: 9 }) > 0, 'reference depth limit 9 differs');

const brk = (name, from, to) => {
  const M2 = loadEngine({ initReg: true, patch: (f, s) => { if (f !== '04z_struct_end_city.js') return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } });
  okAv(audit(M2).mism > 0, name);
};
brk('fat tower middle loop drops the RNG gate', "i < 2 && rng.nextInt(3) !== 0", "i < 2 && rng.nextInt(2) !== 0");
brk('fat tower attachment offset changed', "[1, [12, -1, 4]]", "[1, [12, -1, 5]]");
brk('small tower attachment rotation swapped', "[3, [0, -1, 5]], [2, [5, -1, 6]]", "[2, [0, -1, 5]], [3, [5, -1, 6]]");
brk('bridge ship odds use depth+1', "rng.nextInt(10 - depth)", "rng.nextInt(10 - depth - 1)");
brk('bridge length draw changed', "n = rng.nextInt(4) + 1", "n = rng.nextInt(3) + 1");
brk('gentle stairs offset changed', "[0, dy, -8], 'bridge_gentle_stairs'", "[0, dy, -4], 'bridge_gentle_stairs'");
brk('fat tower only below depth 7 test removed', "if (depth !== 7) return", "if (false) return");
brk('bridge_end closing rotation changed', "rotate(r, 2), true));\n      p.chain = -1", "rotate(r, 1), true));\n      p.chain = -1");

for (const f of fails) console.log('  ✗ ' + f);
console.log(`endcityrecursecheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
