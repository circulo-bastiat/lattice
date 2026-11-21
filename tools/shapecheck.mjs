#!/usr/bin/env node
// shapecheck.mjs — #4944. Every block state's OUTLINE / COLLISION / VISUAL / INTERACTION shape against vanilla's.
//
//   node tools/shapecheck.mjs [--table]     (--table prints every mismatch row)
//
// Vanilla: tools/golden/blockshapes-1.18.2.tsv (tools/extract-shapes.mjs runs the real 1.18.2 bytecode).
// Engine: `Reg.outlineShape` (else the collision shape, vanilla's default) is the shape `Ray.selectionBoxes` draws and the
// crosshair ray tests (see selectionBoxesCheck below); `Physics.shapesForState` is what the player and mobs collide with. Shapes are compared as SETS OF SPACE, not box lists (a vanilla shape may
// be split into different boxes), on the 1/1024 grid the registry stores.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ARGS = process.argv.slice(2);
const FILES = ['02f_tags.js', '02g_items.js', '14b_physics.js', '14c_raycast.js'];

/** canonical form of a box list: coordinate-compressed occupancy, so equal volumes compare equal whatever the split. */
function canon(boxes) {
  const bs = boxes.filter((b) => b[0] < b[3] && b[1] < b[4] && b[2] < b[5]);
  if (!bs.length) return '';
  const ax = [0, 1, 2].map((a) => [...new Set(bs.flatMap((b) => [b[a], b[a + 3]]))].sort((p, q) => p - q));
  const cells = [];
  for (let i = 0; i < ax[0].length - 1; i++) for (let j = 0; j < ax[1].length - 1; j++) for (let k = 0; k < ax[2].length - 1; k++) {
    const x = ax[0][i], y = ax[1][j], z = ax[2][k];
    if (bs.some((b) => b[0] <= x && b[3] > x && b[1] <= y && b[4] > y && b[2] <= z && b[5] > z)) cells.push([x, y, z, ax[0][i + 1], ax[1][j + 1], ax[2][k + 1]]);
  }
  // merge to a unique greedy form: sweep along x, then y, then z
  const merge = (list, a) => {
    const key = (c) => [0, 1, 2].filter((d) => d !== a).map((d) => c[d] + ',' + c[d + 3]).join('|');
    const m = new Map();
    for (const c of list) { const k = key(c); (m.get(k) || m.set(k, []).get(k)).push(c); }
    const out = [];
    for (const g of m.values()) {
      g.sort((p, q) => p[a] - q[a]);
      let cur = g[0].slice();
      for (let i = 1; i < g.length; i++) { if (g[i][a] === cur[a + 3]) cur[a + 3] = g[i][a + 3]; else { out.push(cur); cur = g[i].slice(); } }
      out.push(cur);
    }
    return out;
  };
  return merge(merge(merge(cells, 0), 1), 2).map((c) => c.join(',')).sort().join(';');
}
const q = (v) => Math.round(v * 1024);
const fromEngine = (list) => canon((list || []).map((b) => b.map(q)));

/** Vanilla table: [{key, shapes:[o,c,v,i] canonical}] */
function loadVanilla() {
  const dict = new Map(), rows = new Map();
  for (const l of readFileSync(MCLITE_ROOT + 'tools/golden/blockshapes-1.18.2.tsv', 'utf8').split('\n')) {
    const f = l.split('\t');
    if (f[0] === 'S') dict.set(f[1], canon(f[2] ? f[2].split(';').map((b) => b.split(',').map(Number)) : []));
    else if (/^\d/.test(f[0])) {
      const m = /^minecraft:(\w+)(?:\[(.*)\])?$/.exec(f[1]);
      rows.set(m[1] + '[' + (m[2] ? m[2].split(',').sort().join(',') : '') + ']', f.slice(2, 6).map((i) => dict.get(i)));
    }
  }
  return rows;
}

/** Runs the comparison on an engine built with `patch` (an anti-vacuity break); returns the mismatch rows. */
export function compare(patch, flip) {
  const NS = loadEngine({ extra: FILES, patch });
  const R = NS.Reg, S = NS.States, vanilla = loadVanilla();
  const props = Object.keys(R.PROP);
  const bad = [];
  const UNIT = [[0, 0, 0, 1, 1, 1]];
  let seen = 0, absent = 0;
  for (let b = 0; b < R.blockCount; b++) for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
    const kv = [];
    for (const p of props) { const v = S.propValue(s, R.PROP[p]); if (v >= 0) kv.push(p + '=' + R.valueNames[v]); }
    const want = vanilla.get(R.names[b] + '[' + kv.sort().join(',') + ']');
    if (!want) { absent++; continue; }
    seen++;
    if (flip && flip.block === R.names[b] && !flip.done) { flip.done = true; want[0] = want[0] ? '' : canon(UNIT.map((u) => u.map(q))); }
    const col = NS.Physics.shapesForState(s);
    const got = [R.outlineShape(s) || col, col, R.visualShape(s) || col, R.interactionShape(s) || col].map(fromEngine);
    // what the crosshair ray tests and the wireframe draws: the outline, cut to its cell; an empty outline is the whole cell
    const sel = NS.Ray.selectionBoxes(s);
    got.push(fromEngine(sel));
    const clip = (list) => list.map((x) => x.map((v, i) => (i < 3 ? Math.max(v, 0) : Math.min(v, 1024))));
    const wantSel = want[0] === '' ? canon(UNIT.map((u) => u.map(q))) : canon(clip(want[0].split(';').map((x) => x.split(',').map(Number))));
    want.push(wantSel);
    ['outline', 'collision', 'visual', 'interaction', 'selection'].forEach((n, i) => {
      if (got[i] !== want[i]) bad.push({ block: R.names[b], state: kv.join(','), shape: n, got: got[i], want: want[i] });
    });
  }
  return { bad, seen, absent };
}

const OWN = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;   // Windows-safe: 'file://' + argv[1] never matched there, so the lander ran an empty check
if (OWN) {
  const { bad, seen, absent } = compare();
  const by = new Map();
  for (const r of bad) { const k = r.block + ' ' + r.shape; by.set(k, (by.get(k) || 0) + 1); }
  if (ARGS.includes('--table')) for (const r of bad) console.log(`${r.block}\t${r.state}\t${r.shape}\tengine=${r.got}\tvanilla=${r.want}`);
  else for (const [k, n] of [...by].slice(0, 60)) console.log('  ' + k + ' x' + n);

  // The brief's own example, asserted by name so the failure reads as the bug it is.
  const NS = loadEngine({ extra: FILES }), R = NS.Reg, S = NS.States;
  const layer = (n) => { for (let s = R.realFirst[R.id.snow]; s < R.realFirst[R.id.snow + 1]; s++) if (R.valueNames[S.propValue(s, R.PROP.layers)] === String(n)) return s; };
  let fails = bad.length;
  for (const n of [1, 2, 4, 8]) {
    const s = layer(n), sel = NS.Ray.selectionBoxes(s), col = NS.Physics.shapesForState(s);
    const top = Math.max(...sel.map((b) => b[4])), ctop = col ? Math.max(...col.map((b) => b[4])) : 0;
    const ok = Math.abs(top - n / 8) < 1e-9 && Math.abs(ctop - (n - 1) / 8) < 1e-9;
    if (!ok) { fails++; console.log(`  x snow layers=${n}: outline ${top} (want ${n / 8}), collision ${ctop} (want ${(n - 1) / 8})`); }
  }
  console.log(`shapecheck: ${seen} states compared (${absent} engine-only), ${bad.length} mismatches`);

  // anti-vacuity (D-30): each break must make the comparison fail.
  const BREAKS = [
    ['the raycast outline falls back to the collision shape again (the snow-layer bug)', (f, src) => (f === '14c_raycast.js' ? src.replace('var t = NS.Reg.outlineShape(id), b = t && t[0];', 'var t = null, b = null;') : src)],
    ['the outline table is not decoded', (f, src) => (f === '02b_registry.js' ? src.replace('R.decodeShapes(data && data.shapes);', '') : src)],
    ['the interaction table is read as the outline', (f, src) => (f === '02b_registry.js' ? src.replace('R.interactionOf = expand(t.interaction)', 'R.interactionOf = expand(t.outline)') : src)],
    ['collision is read as a full cube', (f, src) => (f === '14b_physics.js' ? src.replace('var si = R.shapeOf[realState];', 'var si = R.shapeOf[realState]; if (si) return Ph.FULL_CUBE;') : src)],
  ];
  let breaks = 0;
  for (const [name, patch] of BREAKS) {
    const r = compare(patch);
    if (r.bad.length > 0) { breaks++; console.log(`   ✓ break caught: ${name} (${r.bad.length} shapes differ)`); }
    else { fails++; console.log(`  ✗ break NOT caught: ${name}`); }
  }
  const flip = { block: 'oak_stairs' }, rf = compare(null, flip);
  if (rf.bad.length > 0) { breaks++; console.log(`   ✓ break caught: golden flipped for oak_stairs (${rf.bad.length} shapes differ)`); }
  else { fails++; console.log('  ✗ break NOT caught: golden flipped'); }
  console.log(`shapecheck: ${seen * 5} assertions, ${fails} failures, ${breaks} breaks caught`);
  process.exit(fails ? 1 : 0);
}
