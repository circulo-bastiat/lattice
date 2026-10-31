#!/usr/bin/env node
// pistondrawcheck.mjs — #323: the moving_piston block entity is drawn between its cells at the lerped offset.
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '07f_redstone.js', '07g_piston.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js', '10_gfx.js'],
  dom: false
});
initRegistry(M);
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => cells.set(key(x, y, z), s) };
w.getBlock = w.get; w.setBlock = w.set;
M.Behave.init(w); M.BlockEntities.init(); M.Redstone.init(); M.Piston.init();
const ER = M.EntityRender; ER.ready = true;
const stone = M.States.stateOf('stone');
const AX = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const be = M.BlockEntities.create(5, 70, 5, 'piston');
Object.assign(be, { movedState: stone, dir: 5, extending: true, source: false, lastProgress: 0, progress: 0.5 });
// the .decomp formula: offset = dir * (extending ? p - 1 : 1 - p), p = lerp(last, progress, partial); cell = pos - dir
const draw = (partial, real) => {
  const f = real || ((x, y, z, p) => ER.beWorldVisible(5.5, 70.5, 5.5, p));
  return f(5.5, 70.5, 5.5, partial).filter((it) => it.shape === 'mushroom' && it.state === stone);
};
function verdict(fn) {
  const bad = [];
  for (const dir of [1, 5, 2]) for (const extending of [true, false]) for (const partial of [0, 0.5, 1]) {
    Object.assign(be, { dir, extending, lastProgress: 0, progress: 0.5 });
    const pr = 0.5 * partial, a = extending ? pr - 1 : 1 - pr, md = extending ? dir : dir ^ 1;
    const ex = [5 + AX[dir][0] * a + 0.5, 70 + AX[dir][1] * a, 5 + AX[dir][2] * a + 0.5];
    const got = fn(partial);
    if (got.length !== 1 || got[0].x !== undefined && [got[0].x - ex[0], got[0].y - ex[1], got[0].z - ex[2]].some((n) => Math.abs(n) > 1e-6))
      bad.push(`dir=${dir} ext=${extending} partial=${partial}: ${got.length ? [got[0].x, got[0].y, got[0].z] : 'nothing'} want ${ex}`);
  }
  return bad;
}
const realFn = (partial) => draw(partial);
const bad = verdict(realFn);
ok(bad.length === 0, 'offset table: ' + bad.slice(0, 3).join(' | '));
// mid-tick strictly between the two cells
Object.assign(be, { dir: 5, extending: true, lastProgress: 0, progress: 0.5 });
const mid = draw(0.5)[0];
ok(mid && mid.x > 4.5 && mid.x < 5.5, 'mid-tick is between cells: x=' + (mid && mid.x));
const BREAKS = [
  ['snap to end cell', (p) => draw(p).map((it) => ({ ...it, x: 5.5, y: 70, z: 5.5 }))],
  ['snap to start cell', (p) => draw(p).map((it) => ({ ...it, x: 4.5, y: 70, z: 5.5 }))],
  ['progress not lerped', () => draw(1)],
  ['nothing drawn', () => []],
];
let caught = 0;
for (const [n, f] of BREAKS) { if (verdict(f).length) { caught++; console.log("   ✓ break caught: " + n); } else console.log(' NOT CAUGHT:', n); }
for (const f of fails) console.log(' FAIL:', f);
console.log(`pistondrawcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .. ${pass}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(fails.length || caught !== BREAKS.length ? 1 : 0);
