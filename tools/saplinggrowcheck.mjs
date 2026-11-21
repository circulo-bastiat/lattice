// saplinggrowcheck.mjs -- #7736: SaplingGenerator trees (.decomp block/sapling/*) placed from a sapling
import { loadEngine } from './loadsrc.mjs';
console.log('saplinggrowcheck - SaplingGenerator tree growth (#7736)');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const M = loadEngine({ extra: ['02f_tags.js'] });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
const F = M.Features, SR = M.States, R = M.Reg;
const st = (n) => SR.stateOf(n);
const DIRT = st('dirt');
function mkWorld() {
  const m = new Map();
  return { m, getBlock: (x, y, z) => (m.has(x + ',' + y + ',' + z) ? m.get(x + ',' + y + ',' + z) : (y < 64 ? DIRT : 0)),
           setBlock: (x, y, z, s) => { m.set(x + ',' + y + ',' + z, s); return true; } };
}
const nameAt = (W, x, y, z) => R.names[SR.block[W.getBlock(x, y, z)]];
function census(W) { const c = {}; for (const [k, s] of W.m) { const n = R.names[SR.block[s]]; c[n] = (c[n] || 0) + 1; } return c; }
const mkRng = (a) => new M.Carvers.Rng(a, a * 31 + 7, 99);
function trial(grow, kind, seed, big) {
  const W = mkWorld(), s = st(kind + '_sapling');
  W.setBlock(0, 64, 0, s);
  if (big) { W.setBlock(1, 64, 0, s); W.setBlock(0, 64, 1, s); W.setBlock(1, 64, 1, s); }
  let name = null;
  const r = grow(W, 0, 64, 0, s, mkRng(seed), (n) => { name = n; });
  return { W, r, name, c: census(W) };
}
function suite(grow, o) {
  const logOf = { oak: 'oak_log', birch: 'birch_log', spruce: 'spruce_log', jungle: 'jungle_log', acacia: 'acacia_log', dark_oak: 'dark_oak_log' };
  for (const kind of ['oak', 'birch', 'spruce', 'jungle', 'acacia']) for (const seed of [1, 2, 3, 4, 5, 6]) {
    const t = trial(grow, kind, seed, false);
    o(t.r === true, kind + ' seed ' + seed + ' grows');
    o((t.c[logOf[kind]] | 0) >= 4, kind + ' seed ' + seed + ' has logs: ' + (t.c[logOf[kind]] | 0));
    const lv = kind + '_leaves';
    o((t.c[lv] | 0) >= 10, kind + ' seed ' + seed + ' has leaves');
    o(nameAt(t.W, 0, 64, 0) === logOf[kind], kind + ' trunk stands on the sapling cell');
  }
  for (const [kind, names] of [['spruce', ['mega_spruce', 'mega_pine']], ['jungle', ['mega_jungle_tree']], ['dark_oak', ['dark_oak']]]) {
    const seen = new Set();
    for (let seed = 1; seed <= 8; seed++) {
      const t = trial(grow, kind, seed, true);
      o(t.r === true, '2x2 ' + kind + ' grows'); seen.add(t.name);
      o((t.c[logOf[kind]] | 0) >= 16, '2x2 ' + kind + ' makes a thick trunk');
    }
    o([...seen].every((n) => names.includes(n)) && (names.length === 1 || seen.size === 2), '2x2 ' + kind + ' features ' + [...seen]);
  }
  const lone = trial(grow, 'dark_oak', 1, false);
  o(lone.r === false && lone.W.getBlock(0, 64, 0) === st('dark_oak_sapling'), 'a lone dark oak sapling does not grow and stays');
  let fancy = 0; for (let s2 = 1; s2 <= 60; s2++) if (trial(grow, 'oak', s2, false).name === 'fancy_oak') fancy++;
  o(fancy >= 2 && fancy <= 14, 'fancy oak about 1 in 10: ' + fancy + '/60');
  const bw = mkWorld(); bw.setBlock(1, 64, 1, st('dandelion')); bw.setBlock(0, 64, 0, st('birch_sapling'));
  let bn = null; grow(bw, 0, 64, 0, st('birch_sapling'), mkRng(3), (n) => { bn = n; });
  o(bn === 'birch_bees_005', 'flowers within 2 give the bees variant: ' + bn);
}
ok(F.ready && typeof F.growSapling === 'function', 'Features.growSapling exists');
if (F.growSapling) suite((...a) => F.growSapling(...a), ok);
// the same feature run straight (vanilla order: pick draw first, then the tree on the same rng) gives the same tree
if (F.growSapling) {
  const t = trial((...a) => F.growSapling(...a), 'birch', 9, false);
  const SB = new Uint16Array(256 * M.CFG.CHUNK_H), MINY = M.CFG.WORLD_MIN_Y;
  for (let y = MINY + 1; y < 64; y++) for (let i = 0; i < 256; i++) SB[((y - MINY) << 8) | i] = DIRT;
  F.compile('birch').run(SB, 0, 0, 8, 64, 8, mkRng(9));
  let logs = 0; for (let i = 0; i < SB.length; i++) if (R.names[SR.block[SB[i]]] === 'birch_log') logs++;
  ok(logs === (t.c.birch_log | 0), 'placed birch matches the feature run on the same rng: ' + logs + ' vs ' + t.c.birch_log);
}
let caught = 0;
for (const bad of [() => false, (W, x, y, z, s, r, h) => { h('oak'); return true; }]) {
  const f = []; suite(bad, (c, m) => { if (!c) f.push(m); }); if (f.length) caught++;
}
ok(caught === 2, 'both broken variants caught');
console.log('   ✓ ' + caught + ' breaks caught');
if (fails.length) { console.log(pass + ' assertions, ' + fails.length + ' failures'); fails.slice(0, 20).forEach((f) => console.log('  x ' + f)); console.log('FAIL saplinggrowcheck'); process.exit(1); }
console.log('PASS saplinggrowcheck: ' + pass + ' assertions, 0 failures, ' + caught + ' breaks caught');
