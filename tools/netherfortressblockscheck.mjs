#!/usr/bin/env node
// netherfortressblockscheck.mjs — #259: the blocks NetherFortressGenerator.{Bridge,SmallCorridor,CorridorCrossing}.generate
// place, in every facing, clipped to the chunk. Local (a,b,c) frames are checked against an independent world-axis table.
import { loadEngine } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const M = loadEngine({ extra: ['07l_spawn.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
M.Dim.cur = 'the_nether';
const ST = M.Structures, A = ST.api, F = M.NetherFortress;
const BR = A.stateOf('nether_bricks'), STONE = A.stateOf('stone');
const FENCE = A.stateOf('nether_brick_fence');
const H = A.H, MINY = A.MINY;
const NAME = (s) => M.States.block[s] === M.Reg.id.nether_brick_fence ? 'fence' : s === BR ? 'brick' : s === 0 ? 'air' : s === STONE ? 'stone' : 'other';

// independent facing frames: local (a,c) -> world offset from the box corner
const frame = (p, a, c) => ({ N: [p.x0 + a, p.z1 - c], S: [p.x0 + a, p.z0 + c], W: [p.x1 - c, p.z0 + a], E: [p.x0 + c, p.z0 + a] })['NESW'[p.dir]];

function pieces() {
  const want = { Bridge: [], SmallCorridor: [], CorridorCrossing: [], BridgeSmallCrossing: [], BridgeStairs: [], BridgeCrossing: [], CorridorLeftTurn: [], CorridorRightTurn: [], BridgePlatform: [], BridgeEnd: [], CorridorStairs: [], CorridorBalcony: [] };
  for (let cz = -100; cz <= 100; cz += 8) for (let cx = -100; cx <= 100; cx += 8) {
    for (const t of ST.startsNear(cx, cz)) if (t.def.name === 'fortress') for (const p of t.pieces) {
      const w = want[p.kind]; if (w && !w.some((q) => q.dir === p.dir)) w.push(p);
    }
  }
  return want;
}
function paint(p, fill) {
  // write the piece into every chunk it touches; returns a getter for world cells
  const chunks = new Map();
  for (let cz = p.z0 >> 4; cz <= p.z1 >> 4; cz++) for (let cx = p.x0 >> 4; cx <= p.x1 >> 4; cx++) {
    const SB = new Uint16Array(256 * H).fill(STONE);
    fill(SB, cx, cz);
    F.writePiece(SB, cx, cz, p);
    chunks.set(cx + ',' + cz, SB);
  }
  return (x, y, z) => { const SB = chunks.get((x >> 4) + ',' + (z >> 4)); return SB ? A.get(SB, x >> 4, z >> 4, x, y, z) : STONE; };
}
function run(tag) {
  const want = pieces();
  for (const kind of Object.keys(want)) {
    ok(want[kind].length >= 2, tag + kind + ': fewer than two facings found');
    for (const p of want[kind]) {
      const at = paint(p, () => {});
      const cell = (a, b, c) => { const [x, z] = frame(p, a, c); return NAME(at(x, p.y0 + b, z)); };
      const t = tag + kind + ' dir' + p.dir + ' ';
      if (kind === 'Bridge') {
        ok(cell(2, 3, 9) === 'brick' && cell(2, 6, 9) === 'air' && cell(0, 5, 9) === 'brick', t + 'deck/rail');
        ok(cell(0, 1, 1) === 'fence' && cell(4, 4, 17) === 'fence' && cell(0, 3, 4) === 'fence', t + 'fence posts');
        ok(cell(0, 3, 8) === 'brick', t + 'mid');
        ok(cell(2, 2, 9) === 'stone', t + 'span underside untouched');
      } else if (kind === 'BridgeSmallCrossing') {
        ok(cell(3, 1, 3) === 'brick' && cell(3, 2, 3) === 'air' && cell(3, 7, 3) === 'air', t + 'floor/air');
        ok(cell(3, 6, 0) === 'brick' && cell(3, 5, 0) === 'fence' && cell(0, 5, 3) === 'fence' && cell(0, 6, 3) === 'brick', t + 'rails');
        ok(cell(0, 3, 0) === 'brick' && cell(0, 2, 3) === 'air', t + 'corner/open');
      } else if (kind === 'BridgeStairs') {
        ok(cell(3, 1, 3) === 'brick' && cell(3, 7, 3) === 'brick' && cell(3, 9, 3) === 'air', t + 'floor/roof');
        ok(cell(3, 4, 5) === 'brick' && cell(3, 5, 5) === 'air' && cell(0, 4, 3) === 'fence' && cell(6, 4, 3) === 'brick' && cell(6, 4, 2) === 'fence', t + 'steps/fences');
      } else if (kind === 'BridgeCrossing') {
        ok(cell(9, 3, 9) === 'brick' && cell(9, 6, 9) === 'air' && cell(7, 5, 3) === 'brick' && cell(9, 5, 3) === 'air', t + 'deck/rails');
        ok(cell(3, 4, 9) === 'brick' && cell(3, 6, 9) === 'air' && cell(9, 3, 16) === 'brick', t + 'arms');
      } else if (kind === 'BridgeEnd') {
        // independent java.util.Random(seed): each column's length, in generate()'s draw order
        let st = (BigInt(p.seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
        const next = (bits) => { st = (st * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(BigInt.asIntN(32, st >> BigInt(48 - bits))); };
        const nint = (n) => { if ((n & -n) === n) return Number((BigInt(n) * BigInt(next(31))) >> 31n); let b, v; do { b = next(31); v = b % n; } while (b - v + (n - 1) > 2147483647); return v; };
        const cols = []; // [a, b, len]
        for (let a = 0; a <= 4; a++) for (let b = 3; b <= 4; b++) cols.push([a, b, nint(8)]);
        cols.push([0, 5, nint(8)]); cols.push([4, 5, nint(8)]);
        for (let a = 0; a <= 4; a++) cols.push([a, 2, nint(5)]);
        for (let a = 0; a <= 4; a++) for (let b = 0; b <= 1; b++) cols.push([a, b, nint(3)]);
        let bad = 0;
        for (const [a, b, n] of cols) for (let c = 0; c <= 8; c++) {
          let want = c <= n; // a later column in the same (a,b) cell is impossible: (a,b) pairs are unique
          if (b <= 5 && (cell(a, b, c) === 'brick') !== want) bad++;
        }
        ok(bad === 0, t + 'column lengths (' + bad + ' cells differ)');
      } else if (kind === 'CorridorStairs') {
        ok(cell(2, 0, 0) === 'brick' && cell(2, 7, 0) === 'brick' && cell(2, 8, 0) === 'other' && cell(2, 9, 0) === 'air' && cell(2, 13, 0) === 'brick', t + 'first slice');
        ok(cell(2, 1, 6) === 'brick' && cell(2, 2, 6) === 'other' && cell(2, 3, 6) === 'air' && cell(2, 6, 9) === 'brick' && cell(2, 5, 9) === 'air', t + 'steps');
        ok(cell(0, 9, 0) === 'fence' && cell(4, 10, 0) === 'fence' && cell(0, 9, 1) === 'brick' && cell(0, 7, 2) === 'fence', t + 'fences every other slice');
        // block states rotate with the piece (StructurePiece.addBlock): fences run along the corridor, stairs face the local south
        const [fx, fz] = frame(p, 0, 0), [sx, sz] = frame(p, 2, 6);
        const fs = at(fx, p.y0 + 9, fz), ss = at(sx, p.y0 + 2, sz);
        const along = p.dir === 0 || p.dir === 2 ? ['north', 'south'] : ['east', 'west'];
        ok(fs === along.reduce((st, d) => A.withProp(st, d, 'true'), FENCE), t + 'fence rotated with the piece');
        ok(ss === A.withProp(A.stateOf('nether_brick_stairs'), 'facing', ['north', 'east', 'south', 'west'][p.dir === 0 ? 2 : p.dir === 1 ? 3 : p.dir === 2 ? 0 : 1]), t + 'stairs facing rotated');
      } else if (kind === 'CorridorBalcony') {
        ok(cell(4, 0, 4) === 'brick' && cell(4, 3, 2) === 'air' && cell(4, 6, 3) === 'brick' && cell(4, 6, 6) === 'stone', t + 'floor/roof');
        ok(cell(1, 3, 0) === 'fence' && cell(7, 4, 0) === 'fence' && cell(0, 3, 0) === 'brick' && cell(4, 3, 0) === 'air', t + 'front fences/door');
        ok(cell(4, 2, 6) === 'brick' && cell(1, 2, 4) === 'air' && cell(4, 3, 8) === 'fence' && cell(0, 3, 7) === 'fence' && cell(0, 3, 5) === 'brick', t + 'balcony');
      } else if (kind === 'BridgePlatform') {
        ok(cell(3, 0, 3) === 'brick' && cell(3, 3, 4) === 'brick' && cell(3, 4, 5) === 'brick' && cell(3, 5, 5) === 'air', t + 'steps');
        ok(cell(0, 5, 5) === 'brick' && cell(0, 6, 5) === 'fence' && cell(3, 6, 8) === 'fence' && cell(3, 7, 8) === 'fence' && cell(3, 8, 8) === 'stone' && cell(3, 3, 1) === 'air', t + 'rails/fences');
        ok(cell(3, 7, 3) === 'air' && cell(1, 3, 1) === 'brick', t + 'air/pillar');
      } else if (kind === 'CorridorLeftTurn' || kind === 'CorridorRightTurn') {
        const w = kind === 'CorridorLeftTurn' ? 4 : 0, o = 4 - w;
        ok(cell(2, 0, 2) === 'brick' && cell(2, 6, 2) === 'brick' && cell(2, 3, 2) === 'air', t + 'floor/roof/air');
        ok(cell(w, 3, 2) === 'brick' && cell(w, 3, 1) === 'fence' && cell(w, 4, 3) === 'fence' && cell(o, 3, 2) === 'air', t + 'wall side/open side');
        ok(cell(2, 3, 4) === 'brick' && cell(1, 3, 4) === 'fence' && cell(3, 4, 4) === 'fence' && cell(2, 3, 0) === 'air', t + 'end wall/open start');
        ok(cell(w, 2, 0) === 'brick' && cell(o, 2, 0) === (kind === 'CorridorLeftTurn' ? 'brick' : 'brick'), t + 'start corner');
      } else {
        ok(cell(2, 0, 2) === 'brick' && cell(2, 1, 2) === 'brick' && cell(2, 6, 2) === 'brick', t + 'floor/roof');
        ok(cell(2, 3, 2) === 'air' && cell(2, 5, 2) === 'air', t + 'interior air');
        if (kind === 'SmallCorridor') {
          ok(cell(0, 3, 2) === 'brick' && cell(0, 2, 2) === 'brick', t + 'wall between fences');
          ok(cell(0, 3, 1) === 'fence' && cell(4, 4, 3) === 'fence', t + 'fence cells');
        } else ok(cell(0, 2, 0) === 'brick' && cell(0, 2, 2) === 'air', t + 'corner pillar / open side');
      }
      // fillDownwards: an air column under the piece is filled with bricks, stone is not touched
      const at2 = paint(p, (SB, cx, cz) => { const [x, z] = kind === 'BridgeCrossing' ? frame(p, 9, 1) : frame(p, 2, 2); if ((x >> 4) === cx && (z >> 4) === cz) for (let y = p.y0 - 6; y < p.y0; y++) SB[((y - MINY) << 8) | ((z & 15) << 4) | (x & 15)] = 0; });
      const [x, z] = kind === 'BridgeCrossing' ? frame(p, 9, 1) : frame(p, 2, kind === 'Bridge' ? 1 : 2);
      if (kind !== 'Bridge' && kind !== 'BridgeEnd') ok(NAME(at2(x, p.y0 - 1, z)) === 'brick' && NAME(at2(x, p.y0 - 6, z)) === 'brick', t + 'fillDownwards');
      // chunk clipping: nothing outside the piece's box is touched
      let stray = 0;
      for (let y = p.y0 - 3; y <= p.y1 + 1; y++) for (let xx = p.x0 - 1; xx <= p.x1 + 1; xx++) for (let zz = p.z0 - 1; zz <= p.z1 + 1; zz++) {
        const inside = xx >= p.x0 && xx <= p.x1 && zz >= p.z0 && zz <= p.z1 && y >= p.y0 && y <= p.y1;
        if (!inside && y >= p.y0 - 1 && NAME(at(xx, y, zz)) !== 'stone' && !(y === p.y0 - 1 && xx >= p.x0 && xx <= p.x1 && zz >= p.z0 && zz <= p.z1)) stray++;
      }
      ok(stray === 0, t + 'wrote ' + stray + ' cells outside its box');
    }
  }
  ok(F.writePiece(new Uint16Array(256 * H), 0, 0, { kind: 'BridgeSpawner', dir: 0, x0: 0, y0: 60, z0: 0, x1: 4, y1: 70, z1: 7 }) === 0, tag + 'unported kind writes nothing');
}
run('');
let caught = 0;
function breakIt(name, mut, restore) {
  const before = fails.length; mut();
  try { run('[' + name + '] '); } catch (e) { fails.push('x'); }
  restore();
  if (fails.length > before) { caught++; fails.length = before; console.log('  ✓ break caught: ' + name); } else fails.push('break not caught: ' + name);
}
const lt = F.GEN.CorridorLeftTurn, bp = F.GEN.BridgePlatform, bs = F.GEN.BridgeStairs, sc = F.GEN.SmallCorridor, br = F.GEN.Bridge, cc = F.GEN.CorridorCrossing, be = F.GEN.BridgeEnd, cs = F.GEN.CorridorStairs, cb = F.GEN.CorridorBalcony;
breakIt('no fences', () => { F.GEN.SmallCorridor = (g) => { const f = g.S.fenceNS; g.S.fenceNS = 0; sc(g); g.S.fenceNS = f; }; }, () => { F.GEN.SmallCorridor = sc; });
breakIt('bridge deck dropped', () => { F.GEN.Bridge = () => {}; }, () => { F.GEN.Bridge = br; });
breakIt('crossing roof dropped', () => { F.GEN.CorridorCrossing = (g) => { const b = g.fill; g.fill = (a0, b0, c0, a1, b1, c1, s) => { if (b0 !== 6) b.call(g, a0, b0, c0, a1, b1, c1, s); }; cc(g); g.fill = b; }; }, () => { F.GEN.CorridorCrossing = cc; });
breakIt('wrong facing frame', () => { const w = F.GEN; F.GEN.SmallCorridor = (g) => { const o = g.wx; g.wx = (a, c) => o.call(g, c, a); sc(g); g.wx = o; }; }, () => { F.GEN.SmallCorridor = sc; });
breakIt('stairs fences dropped', () => { F.GEN.BridgeStairs = (g) => { const f = g.S.fenceNS; g.S.fenceNS = 0; bs(g); g.S.fenceNS = f; }; }, () => { F.GEN.BridgeStairs = bs; });
breakIt('left turn wall dropped', () => { F.GEN.CorridorLeftTurn = (g) => { const b = g.fill; g.fill = (a0, b0, c0, a1, b1, c1, s) => { if (a0 !== 4 || b0 !== 2) b.call(g, a0, b0, c0, a1, b1, c1, s); }; lt(g); g.fill = b; }; }, () => { F.GEN.CorridorLeftTurn = lt; });
breakIt('platform steps dropped', () => { F.GEN.BridgePlatform = (g) => { const b = g.fill; g.fill = (a0, b0, c0, a1, b1, c1, s) => { if (b0 !== 4) b.call(g, a0, b0, c0, a1, b1, c1, s); }; bp(g); g.fill = b; }; }, () => { F.GEN.BridgePlatform = bp; });
breakIt('end columns shortened', () => { F.GEN.BridgeEnd = (g) => { const b = g.fill; g.fill = (a0, b0, c0, a1, b1, c1, s) => b.call(g, a0, b0, c0, a1, b1, Math.max(0, c1 - 1), s); be(g); g.fill = b; }; }, () => { F.GEN.BridgeEnd = be; });
breakIt('corridor stairs steps dropped', () => { F.GEN.CorridorStairs = (g) => { const b = g.fill; g.fill = (a0, b0, c0, a1, b1, c1, s) => { if (s !== g.stairsS) b.call(g, a0, b0, c0, a1, b1, c1, s); }; cs(g); g.fill = b; }; }, () => { F.GEN.CorridorStairs = cs; });
breakIt('stairs not rotated', () => { F.GEN.CorridorStairs = (g) => { g.stairsS = A.withProp(A.stateOf('nether_brick_stairs'), 'facing', 'south'); cs(g); }; }, () => { F.GEN.CorridorStairs = cs; });
breakIt('balcony fences dropped', () => { F.GEN.CorridorBalcony = (g) => { const b = g.fill; g.fill = (a0, b0, c0, a1, b1, c1, s) => { if (s !== g.S.fenceEW) b.call(g, a0, b0, c0, a1, b1, c1, s); }; cb(g); g.fill = b; }; }, () => { F.GEN.CorridorBalcony = cb; });
console.log(`${caught} breaks caught`);
if (caught !== 11) fails.push('not every break caught');
for (const f of fails) console.log('   ✗ ' + f);
console.log('netherfortressblockscheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
