#!/usr/bin/env node
// treewirecheck.mjs — #11469: 04k_feat_trees.js (SaplingGenerator / LargeTreeSaplingGenerator) is WIRED.
// The classmap's static pass misses it: the engine reaches it dynamically, Behave.tickSapling (random tick) ->
// Behave.growTree -> NS.Features.growSapling. This drives the real rule: a 2x2 spruce sapling at stage 1,
// ticked through Behave's own sapling rule, becomes a mega tree. Anti-vacuity: cutting the call, or the
// large-tree branch, leaves the saplings standing.
import { loadEngine } from './loadsrc.mjs';
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  const S = M.States, R = M.Reg, B = M.Behave;
  M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, DIRT = S.stateOf('dirt');
  const W = { getBlock: (x, y, z) => cells.has(key(x, y, z)) ? cells.get(key(x, y, z)) : (y < 64 ? DIRT : 0),
    setBlock(x, y, z, s) { cells.set(key(x, y, z), s); return true; }, blockLightAt: () => 15, lightLevel: () => 15 };
  M.World = W; B.init(W); B.world = W;
  const sap = B.setProp(S.stateOf('spruce_sapling'), 'stage', '1');
  for (const [x, z] of [[0, 0], [1, 0], [0, 1], [1, 1]]) W.setBlock(x, 64, z, sap);
  let n = 0, seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  const grew = B.growTree(0, 64, 0, sap, rnd);
  let logs = 0; for (const s of cells.values()) if (R.names[S.block[s]] === 'spruce_log') logs++;
  return { ready: !!(M.Features && M.Features.ready), grew, logs };
}
const A = trial();
ok(A.ready, 'Features is ready');
ok(A.grew === true, 'Behave.growTree grows a 2x2 spruce sapling');
ok(A.logs >= 16, 'a thick spruce trunk stands (' + A.logs + ' logs)');
const cuts = [
  ['growTree no longer calls growSapling', (f, t) => f === '07b_behaviour.js' ? t.replace('F.growSapling(B.world, x, y, z, st, r)', 'false') : t],
  ['growSapling dropped from Features', (f, t) => f === '04k_feat_trees.js' ? t.replace('F.growSapling = function', 'F._cut = function') : t],
  ['large-tree branch cut', (f, t) => f === '04k_feat_trees.js' ? t.replace('large = true; ox = x + dx;', 'ox = x + dx;') : t],
];
for (const [n, p] of cuts) {
  breaks++;
  { let hit = false; for (const f of ['07b_behaviour.js', '04k_feat_trees.js']) { const t = fs.readFileSync(path.join(root, 'src', f), 'utf8'); if (p(f, t) !== t) hit = true; } if (!hit) fails.push('no-op break (pattern not found): ' + n); }
  let got; try { got = trial(p); } catch (e) { got = { grew: false, logs: 0 }; }
  ok(!(got.grew === true && got.logs >= 16), 'anti-vacuity: ' + n + ' must break it');
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `treewirecheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
