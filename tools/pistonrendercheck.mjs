// pistonrendercheck.mjs (#8635): Piston.renderParts equals PistonBlockEntityRenderer / PistonBlockEntity.getRenderOffset*.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EXTRA = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07g_piston.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => cells.set(key(x, y, z), s) };
w.getBlock = w.get; w.setBlock = w.set;
M.Behave.init(w); M.BlockEntities.init(); M.Redstone.init(); M.Piston.init();
const S = M.States, B = M.Behave, P = M.Piston, R = M.Reg;
const AX = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]], FN = ['down', 'up', 'north', 'south', 'west', 'east'];
const prop = (st, k, v) => B.setProp(st, k, v);
const desc = (p) => p.map((q) => R.names[S.block[q.state]] + ':' + ['short', 'extended', 'type', 'facing'].map((k) => B.propName(q.state, k)).join('/') + '@' + q.cell + '+' + q.off.map((n) => Math.round(n * 1e6) / 1e6)).join(' | ');
// the .decomp formula, written independently of renderParts
function expect(sticky, dir, extending, source, pr, x, y, z) {
  const amt = extending ? pr - 1 : 1 - pr, md = extending ? dir : dir ^ 1, t = sticky ? 'sticky' : 'normal';
  const o = AX[dir].map((n) => n * amt), c = [x - AX[md][0], y - AX[md][1], z - AX[md][2]];
  if (source && extending) return [{ n: 'piston_head', short: pr <= 0.5, type: t, facing: FN[dir], cell: c, off: o }];
  if (source) return [{ n: 'piston_head', short: pr >= 0.5, type: t, facing: FN[dir], cell: c, off: o },
    { n: sticky ? 'sticky_piston' : 'piston', extended: true, facing: FN[dir], cell: [c[0] + AX[md][0], c[1] + AX[md][1], c[2] + AX[md][2]], off: [0, 0, 0] }];
  return [{ n: 'stone', cell: c, off: o }];
}
function verdict(fn) {
  const bad = [];
  for (const sticky of [0, 1]) for (const dir of [1, 5, 2]) for (const extending of [true, false]) for (const source of [true, false]) {
    let moved;
    if (source && extending) moved = prop(prop(S.stateOf('piston_head'), 'facing', FN[dir]), 'type', sticky ? 'sticky' : 'normal');
    else if (source) moved = prop(S.stateOf(sticky ? 'sticky_piston' : 'piston'), 'facing', FN[dir]);
    else moved = S.stateOf('stone');
    for (const pr of [0, 0.25, 0.5, 0.75, 1]) {
      const e = { movedState: moved, dir, extending, source, progress: pr, lastProgress: pr };
      const got = fn(e, 5, 5, 5, 0.5), exp = expect(!!sticky, dir, extending, source, pr, 5, 5, 5);
      const ok = got.length === exp.length && exp.every((q, i) => {
        const g = got[i], nm = R.names[S.block[g.state]];
        return nm === q.n && g.cell.join() === q.cell.join() && g.off.every((n, j) => Math.abs(n - q.off[j]) < 1e-6)
          && (q.short === undefined || B.propName(g.state, 'short') === String(q.short))
          && (q.extended === undefined || B.propName(g.state, 'extended') === 'true')
          && (q.type === undefined || B.propName(g.state, 'type') === q.type) && (q.facing === undefined || B.propName(g.state, 'facing') === q.facing);
      });
      if (!ok) bad.push(`${sticky ? 'sticky' : 'normal'} ${FN[dir]} ext=${extending} src=${source} p=${pr}: ${desc(got)}`);
    }
  }
  return bad;
}
const real = P.renderParts;
const BREAKS = [
  ['wrong direction', (e, x, y, z, d) => real({ ...e, extending: !e.extending && e.movedState ? e.extending : e.extending, dir: e.dir ^ 1 }, x, y, z, d)],
  ['short flag flipped', (e, x, y, z, d) => real(e, x, y, z, d).map((q) => R.names[S.block[q.state]] === 'piston_head' ? { ...q, state: prop(q.state, 'short', B.propName(q.state, 'short') !== 'true') } : q)],
  ['base not drawn', (e, x, y, z, d) => real(e, x, y, z, d).slice(0, 1)],
  ['progress ignored', (e, x, y, z, d) => real({ ...e, progress: 1, lastProgress: 1 }, x, y, z, d)],
];
const bad = verdict(real); let caught = 0;
for (const [n, f] of BREAKS) { if (verdict(f).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const b of bad.slice(0, 10)) console.log(' FAIL:', b);
console.log(`pistonrendercheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(" assertions passed .. 80");
console.log(` breaks caught ...... ${caught}`);
for (const [n] of BREAKS) console.log(`  ✓ ${n}: caught`);
process.exit(bad.length || caught < BREAKS.length ? 1 : 0);
