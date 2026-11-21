// tools/portalframecheck.mjs - #261: src/07zzo_portal.js (AreaHelper port) against an independent geometric oracle:
// a frame of interior w x h (2..21 x 3..21) on either axis is found from any interior cell; corners are not required;
// a gap, a blocker inside, an oversize frame and a pre-lit portal behave as AreaHelper.isValid / getNewPortal say.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/07zzo_portal.js', import.meta.url), 'utf8');
const load = (src) => { const NS = {}; new Function('MCL', src.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);'))(NS); return NS.PortalFrame; };
function world(axis, w, h, o = {}) {                       // interior at x/z 0..w-1, y 10..10+h-1 along `axis`
  const m = new Map(), key = (x, y, z) => x + ',' + y + ',' + z, cell = (i, y) => axis === 'x' ? [i, y, 0] : [0, y, i];
  const put = (i, y, k) => m.set(key(...cell(i, y)), k);
  for (let i = 0; i < w; i++) { put(i, 9, 'obsidian'); put(i, 10 + h, 'obsidian'); }
  for (let y = 10; y < 10 + h; y++) { put(-1, y, 'obsidian'); put(w, y, 'obsidian'); }
  if (o.mut) o.mut(put);
  return { bottomY: -64, m, kind: (x, y, z) => m.get(key(x, y, z)) || 'air', set(x, y, z, k) { m.set(key(x, y, z), k); } };
}
const interior = (axis, i, y) => axis === 'x' ? { x: i, y, z: 0 } : { x: 0, y, z: i };
function run(F) {
  const bad = []; let n = 0;
  const expect = (ok, msg) => { n++; if (!ok) bad.push(msg); };
  for (const axis of ['x', 'z']) for (let w = 1; w <= 23; w++) for (let h = 2; h <= 23; h++) {
    const valid = w >= 2 && w <= 21 && h >= 3 && h <= 21, W = world(axis, w, h);
    for (const [i, y] of [[0, 10], [w - 1, 10 + h - 1], [Math.floor(w / 2), 10 + Math.floor(h / 2)]]) {
      const a = F.getNewPortal(W, interior(axis, i, y), axis);
      expect((a !== null) === valid, `${axis} ${w}x${h} from ${i},${y}: valid=${valid} got ${a && a.width + 'x' + a.height}`);
      if (a && valid) expect(a.width === w && a.height === h && a.axis === axis, `size ${w}x${h} got ${a.width}x${a.height}/${a.axis}`);
    }
    if (valid) {                                           // other axis asked first still finds it; createPortal fills w*h
      const a = F.getNewPortal(W, interior(axis, 0, 10), axis === 'x' ? 'z' : 'x');
      expect(a && a.axis === axis, `${axis} ${w}x${h} found via the other-axis retry`);
      if (a) { a.createPortal(); const c = [...W.m.values()].filter((k) => k === 'portal').length; expect(c === w * h, `createPortal count ${c} != ${w * h}`);
        const b = new F.Area(W, interior(axis, 0, 10), axis); expect(b.wasAlreadyValid() && F.getNewPortal(W, interior(axis, 0, 10), axis) === null, 'lit frame: wasAlreadyValid, not a new portal'); }
    }
  }
  const mid = (axis) => interior(axis, 1, 11);
  for (const axis of ['x', 'z']) {
    const cell = (i, y) => axis === 'x' ? [i, y, 0] : [0, y, i], K = (i, y) => cell(i, y).join(',');
    expect(F.getNewPortal(world(axis, 3, 4, { mut: (p) => p(1, 9, 'air') }), mid(axis), axis) === null, axis + ' gap in the floor');
    expect(F.getNewPortal(world(axis, 3, 4, { mut: (p) => p(3, 12, 'air') }), mid(axis), axis) === null, axis + ' gap in the side');
    expect(F.getNewPortal(world(axis, 3, 4, { mut: (p) => p(1, 14, 'air') }), mid(axis), axis) === null, axis + ' gap in the top');
    expect(F.getNewPortal(world(axis, 3, 4, { mut: (p) => p(1, 12, 'other') }), mid(axis), axis) === null, axis + ' blocker inside');
    expect(F.getNewPortal(world(axis, 3, 4, { mut: (p) => p(1, 12, 'fire') }), mid(axis), axis) !== null, axis + ' fire inside is fine');
    expect(F.getNewPortal(world(axis, 3, 4, { mut: (p) => p(1, 12, 'portal') }), mid(axis), axis) === null, axis + ' part-lit is not new');
    expect(F.getNewPortal(world(axis, 3, 4, { mut: (p) => { p(-1, 9, 'other'); p(3, 14, 'other'); } }), mid(axis), axis) !== null, axis + ' corners are optional');
  }
  { const Wp = world('x', 3, 4, { mut: (p) => { p(0, 10, 'portal'); p(1, 10, 'portal'); p(2, 10, 'portal'); } }); expect(!new F.Area(Wp, { x: 1, y: 11, z: 0 }, 'x').wasAlreadyValid(), 'bottom row lit is not wasAlreadyValid'); }
  const L = world('x', 2, 3); expect(F.shouldLightPortalAt(L, { x: 0, y: 10, z: 0 }, { dx: 0, dz: 1 }, () => 0) === true, 'shouldLight from a z face (axis x)');
  expect(F.shouldLightPortalAt(L, { x: 0, y: 10, z: 0 }, { dx: 1, dz: 0 }, () => 0) === true, 'shouldLight from an x face retries the other axis');
  expect(F.shouldLightPortalAt(world('x', 2, 3), { x: 50, y: 30, z: 5 }, { dx: 0, dz: 1 }) === false, 'no obsidian neighbour');
  return { bad, n };
}
const base = run(load(SRC));
if (base.bad.length) { console.log('portalframecheck FAIL:\n' + base.bad.slice(0, 10).join('\n')); process.exit(1); }
const breaks = [['this.foundPortalBlocks === this.width * this.height', 'this.foundPortalBlocks >= this.width'], ['lim = Math.max(W.bottomY, y - 21)', 'lim = y'], ['h < 3 || h > 21', 'h < 4 || h > 21'], ['n >= 2 &&', 'n >= 3 &&'],
  ["return k === 'air' || k === 'fire' || k === 'portal'", "return k === 'air' || k === 'portal'"], ['foundPortalBlocks === 0', 'foundPortalBlocks >= 0'],
  ["!== 'obsidian') return 0;\n    return h", "!== 'obsidian') return h;\n    return h"], ['c.x + this.dx * this.width, c.y + i', 'c.x + this.dx * (this.width - 1), c.y + i'],
  ["axis === 'x' ? 'z' : 'x');\n    return pred", "axis);\n    return pred"], ["k === 'portal') this.foundPortalBlocks++", "k === 'air') this.foundPortalBlocks++"]];
let caught = 0;
for (const [a, b] of breaks) {
  if (!SRC.includes(a)) { console.log('portalframecheck FAIL: break target missing: ' + a); process.exit(1); }
  const r = run(load(SRC.replace(a, b)));
  if (r.bad.length) caught++; else console.log('NOT caught: ' + a);
}
if (caught !== breaks.length) { console.log('portalframecheck FAIL: ' + caught + '/' + breaks.length + ' breaks caught'); process.exit(1); }
console.log(`${caught} breaks caught; ${base.n} assertions (every frame 2x3..21x21 + oversize, both axes)`);
