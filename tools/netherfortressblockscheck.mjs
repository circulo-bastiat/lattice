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
  const want = { Bridge: [], SmallCorridor: [], CorridorCrossing: [], BridgeSmallCrossing: [], BridgeStairs: [], BridgeCrossing: [] };
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
      if (kind !== 'Bridge') ok(NAME(at2(x, p.y0 - 1, z)) === 'brick' && NAME(at2(x, p.y0 - 6, z)) === 'brick', t + 'fillDownwards');
      // chunk clipping: nothing outside the piece's box is touched
      let stray = 0;
      for (let y = p.y0 - 3; y <= p.y1 + 1; y++) for (let xx = p.x0 - 1; xx <= p.x1 + 1; xx++) for (let zz = p.z0 - 1; zz <= p.z1 + 1; zz++) {
        const inside = xx >= p.x0 && xx <= p.x1 && zz >= p.z0 && zz <= p.z1 && y >= p.y0 && y <= p.y1;
        if (!inside && y >= p.y0 - 1 && NAME(at(xx, y, zz)) !== 'stone' && !(y === p.y0 - 1 && xx >= p.x0 && xx <= p.x1 && zz >= p.z0 && zz <= p.z1)) stray++;
      }
      ok(stray === 0, t + 'wrote ' + stray + ' cells outside its box');
    }
  }
  ok(F.writePiece(new Uint16Array(256 * H), 0, 0, { kind: 'BridgeEnd', dir: 0, x0: 0, y0: 60, z0: 0, x1: 4, y1: 70, z1: 7 }) === 0, tag + 'unported kind writes nothing');
}
run('');
let caught = 0;
function breakIt(name, mut, restore) {
  const before = fails.length; mut();
  try { run('[' + name + '] '); } catch (e) { fails.push('x'); }
  restore();
  if (fails.length > before) { caught++; fails.length = before; console.log('  ✓ break caught: ' + name); } else fails.push('break not caught: ' + name);
}
const bs = F.GEN.BridgeStairs, sc = F.GEN.SmallCorridor, br = F.GEN.Bridge, cc = F.GEN.CorridorCrossing;
breakIt('no fences', () => { F.GEN.SmallCorridor = (g) => { const f = g.S.fenceNS; g.S.fenceNS = 0; sc(g); g.S.fenceNS = f; }; }, () => { F.GEN.SmallCorridor = sc; });
breakIt('bridge deck dropped', () => { F.GEN.Bridge = () => {}; }, () => { F.GEN.Bridge = br; });
breakIt('crossing roof dropped', () => { F.GEN.CorridorCrossing = (g) => { const b = g.fill; g.fill = (a0, b0, c0, a1, b1, c1, s) => { if (b0 !== 6) b.call(g, a0, b0, c0, a1, b1, c1, s); }; cc(g); g.fill = b; }; }, () => { F.GEN.CorridorCrossing = cc; });
breakIt('wrong facing frame', () => { const w = F.GEN; F.GEN.SmallCorridor = (g) => { const o = g.wx; g.wx = (a, c) => o.call(g, c, a); sc(g); g.wx = o; }; }, () => { F.GEN.SmallCorridor = sc; });
breakIt('stairs fences dropped', () => { F.GEN.BridgeStairs = (g) => { const f = g.S.fenceNS; g.S.fenceNS = 0; bs(g); g.S.fenceNS = f; }; }, () => { F.GEN.BridgeStairs = bs; });
console.log(`${caught} breaks caught`);
if (caught !== 5) fails.push('not every break caught');
for (const f of fails) console.log('   ✗ ' + f);
console.log('netherfortressblockscheck: ' + pass + ' assertions, ' + caught + ' breaks caught' + (fails.length ? ', ' + fails.length + ' FAILED' : ''));
process.exit(fails.length ? 1 : 0);
