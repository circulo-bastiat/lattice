#!/usr/bin/env node
// netherfortresscheck.mjs — #1146: the Nether fortress layout (src/04y_struct_nether_fortress.js).
//   node tools/netherfortresscheck.mjs
import { loadEngine } from './loadsrc.mjs';

let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { if (ok(c, 'anti-vacuity: ' + m)) { breaks++; console.log('  ✓ break caught: ' + m); } };
console.log('netherfortresscheck -- #1146, fortress pieces + bounding boxes');

const bounds = (F, seeds) => {
  const out = [];
  for (const sd of seeds) out.push(F.generate(new (F.__M.LegacyRandom)(sd), (sd * 7) % 50, (sd * 13) % 50));
  return out;
};
// sizes [x,y,z] from the SIZE_X/Y/Z constants in NetherFortressGenerator.java, independent of the module's table
const SZ = { Bridge: [5, 10, 19], BridgeCrossing: [19, 10, 19], BridgeEnd: [5, 10, 8], BridgePlatform: [7, 8, 9],
  BridgeSmallCrossing: [7, 9, 7], BridgeStairs: [7, 11, 7], CorridorBalcony: [9, 7, 9], CorridorCrossing: [5, 7, 5],
  CorridorExit: [13, 14, 13], CorridorLeftTurn: [5, 7, 5], CorridorNetherWartsRoom: [13, 14, 13],
  CorridorRightTurn: [5, 7, 5], CorridorStairs: [5, 14, 10], SmallCorridor: [5, 7, 5] };
function audit(M, label, expectBreak) {
  const F = M.NetherFortress; F.__M = M.Noise || M.N || M;
  const Rnd = (M.Noise && M.Noise.LegacyRandom) || M.LegacyRandom || (M.N && M.N.LegacyRandom);
  F.__M = { LegacyRandom: Rnd };
  const runs = bounds(F, Array.from({ length: 40 }, (_, i) => i + 1));
  let inter = 0, y = 0, ends = 0, caps = true, big = 0, sizes = true;
  for (const r of runs) {
    const ps = r.pieces;
    if (ps.length > 10) big++;
    for (let i = 0; i < ps.length; i++) {
      const b = ps[i].bb;
      if (b[1] < 48 - 3 || b[4] > 70 + 40) y++;
      if (ps[i].kind === 'BridgeEnd') ends++;
      if (ps[i].kind !== 'Start') {
        const o = [0, 0, 0, ...SZ[ps[i].kind]], w = ps[i].dir % 2 === 0 ? o[3] : o[5], d = ps[i].dir % 2 === 0 ? o[5] : o[3];
        if (b[3] - b[0] + 1 !== w || b[5] - b[2] + 1 !== d || b[4] - b[1] + 1 !== o[4]) sizes = false;
      }
      for (let j = i + 1; j < ps.length; j++) {
        const c = ps[j].bb;
        if (b[3] >= c[0] && b[0] <= c[3] && b[5] >= c[2] && b[2] <= c[5] && b[4] >= c[1] && b[1] <= c[4]) inter++;
      }
    }
    const cnt = {}; for (const p of ps) cnt[p.kind] = (cnt[p.kind] || 0) + 1;
    if ((cnt.BridgeCrossing || 0) > 4 || (cnt.BridgeStairs || 0) > 3 || (cnt.BridgePlatform || 0) > 2 || (cnt.CorridorExit || 0) > 1 ||
        (cnt.CorridorNetherWartsRoom || 0) > 2 || (cnt.CorridorBalcony || 0) > 2) caps = false;
    for (const p of ps) if (Math.abs(p.bb[0] - ps[0].bb[0]) > 112 + 20) caps = false;
  }
  return { inter, y, ends, caps, big, sizes, n: runs.length };
}

const M = loadEngine({ initReg: false });
const a = audit(M, 'real');
ok(a.big >= 30, `fortresses grow past the start (${a.big}/${a.n} have >10 pieces)`);
ok(a.inter === 0, `no two pieces intersect (${a.inter})`);
ok(a.sizes, 'every piece box has its create() size for its facing');
ok(a.caps, 'per-kind limits and the 112-block span hold');
ok(a.y === 0, 'fortress sits in the shiftInto(48,70) band');
ok(a.ends > 0, 'BridgeEnd plugs are produced');
// determinism
const Rnd = M.Noise ? M.Noise.LegacyRandom : M.LegacyRandom;
const j = (s) => JSON.stringify(M.NetherFortress.generate(new Rnd(s), 3, 4));
ok(j(5) === j(5) && j(5) !== j(6), 'same seed, same fortress; another seed differs');

// anti-vacuity: break the data, the audit must notice
const brk = (name, from, to, pred) => {
  const M2 = loadEngine({ initReg: false, patch: (f, s) => { if (f !== '04y_struct_nether_fortress.js') return s; if (!s.includes(from)) throw new Error('break did not match: ' + name); return s.replace(from, to); } });
  okAv(pred(audit(M2, name, true)), name);
};
brk('intersection test removed', 'if (!(bb[1] > 10) || intersecting(bb)) return null;', 'if (!(bb[1] > 10)) return null;', (r) => r.inter > 0);
brk('bridge crossing limit removed', "['BridgeCrossing', 10, 4]", "['BridgeCrossing', 10, 0]", (r) => !r.caps);
brk('wrong size', "BridgeEnd: [-1, -3, 0, 5, 10, 8]", "BridgeEnd: [-1, -3, 0, 5, 10, 9]", (r) => !r.sizes || r.inter > 0);
brk('pieces never queued for openings', 'all.push(p); open.push(p);', 'all.push(p);', (r) => r.big < 30);
brk('shiftInto dropped', 'var room = 70 - 48 + 1 - (maxY - minY + 1), ny = room > 1 ? 48 + rng.nextInt(room) : 48, dy = ny - minY;', 'var dy = 0;', (r) => r.y > 0);

for (const f of fails) console.log('  ✗ ' + f);
console.log(`netherfortresscheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
