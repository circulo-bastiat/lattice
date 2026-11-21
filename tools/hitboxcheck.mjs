#!/usr/bin/env node
// hitboxcheck.mjs -- #7886 G17-H1. F3+B line lists vs EntityRenderDispatcher.renderHitbox / WorldRenderer.drawBox.
//   node tools/hitboxcheck.mjs      (breaks its own module to prove it can fail: "<n> breaks caught")
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'src/07zzu_hitbox.js'), 'utf8');
function load(src) {
  const NS = {}; new Function('MCL', src)(NS); return NS.Hitbox;
}
const F = Math.fround;
const box = (x, y, z, w, h) => [x - w / 2, y, z - w / 2, x + w / 2, y + h, z + w / 2];
const key = (v) => v.p.join(',');
// the 12 edges of a box as an unordered set, from the corners (independent of the jar's vertex order)
function edges(b) {
  const s = new Set();
  const c = (i, j, k) => [b[i * 3], b[1 + j * 3], b[2 + k * 3]].map(F).join(',');
  for (let a = 0; a < 2; a++) for (let d = 0; d < 2; d++) {
    for (const [p, q] of [[c(0, a, d), c(1, a, d)], [c(a, 0, d), c(a, 1, d)], [c(a, d, 0), c(a, d, 1)]]) s.add([p, q].sort().join('|'));
  }
  return s;
}
function verify(H) {
  const f = []; let n = 0; const no = (c, m) => { n++; if (!c) f.push(m); };
  const look = (yaw, pitch) => { const a = F(pitch * Math.PI / 180), b = F(-yaw * Math.PI / 180); const cb = Math.cos(b), sb = Math.sin(b), ca = Math.cos(a), sa = Math.sin(a); return [sb * ca, -sa, cb * ca]; };
  const eq = (v, c) => v.c.join() === c.join();
  const chk = (name, e, nBoxes, living) => {
    const L = H.lines(e), eb = [e.box[0] - e.x, e.box[1] - e.y, e.box[2] - e.z, e.box[3] - e.x, e.box[4] - e.y, e.box[5] - e.z];
    no(L.length === 24 * nBoxes + 2, name + ': vertex count ' + L.length);
    const main = L.slice(0, 24), got = new Set();
    for (let i = 0; i < 24; i += 2) got.add([key(main[i]), key(main[i + 1])].sort().join('|'));
    const want = edges(eb.map(F));
    no(got.size === 12 && [...want].every(k => got.has(k)), name + ': main box edges');
    no(main.every(v => eq(v, [1, 1, 1, 1])), name + ': main box white');
    if (living) {
      const s = L.slice(L.length - 26, L.length - 2);
      no(s.every(v => eq(v, [1, 0, 0, 1])), name + ': eye slab red');
      no(s.every(v => v.p[1] === F(e.eye - F(0.01)) || v.p[1] === F(e.eye + F(0.01))), name + ': eye slab y = eye +- 0.01');
      no(s.every(v => v.p[0] === F(eb[0]) || v.p[0] === F(eb[3])), name + ': eye slab spans box x');
    } else no(!L.some(v => eq(v, [1, 0, 0, 1])), name + ': non-living has no eye slab');
    const a = L[L.length - 2], b = L[L.length - 1];
    no(eq(a, [0, 0, 255, 255]) && eq(b, [0, 0, 255, 255]), name + ': look line blue');
    no(a.p.join() === [0, F(e.eye), 0].join(), name + ': look start at eye');
    no(b.p.join() === [F(e.look[0] * 2), F(e.eye + e.look[1] * 2), F(e.look[2] * 2)].join(), name + ': look end 2 blocks');
    return L;
  };
  chk('zombie', { x: 3, y: 64, z: 5, box: box(3, 64, 5, 0.6, 1.95), eye: F(1.74), living: true, look: look(90, 0) }, 2, true);
  chk('baby cow', { x: 0, y: 70, z: 0, box: box(0, 70, 0, 0.45, 0.7), eye: F(0.65), living: true, look: look(0, 30) }, 2, true);
  chk('boat', { x: 1, y: 63, z: 1, box: box(1, 63, 1, 1.375, 0.5625), eye: F(0.5625 * 0.5 * 0 + 0.5625 * 0.5), living: false, look: look(0, 0) }, 1, false);
  const parts = [{ x: 4, y: 90, z: 0, box: box(4, 90, 0, 1, 1) }, { x: -4, y: 91, z: 2, box: box(-4, 91, 2, 3, 3) }];
  const d = { x: 0, y: 90, z: 0, box: box(0, 90, 0, 16, 8), eye: F(6.8), living: true, look: look(0, 0), parts };
  const L = chk('dragon', d, 4, true);
  const p0 = L.slice(24, 48), p1 = L.slice(48, 72);
  no(p0.every(v => eq(v, [0.25, 1, 0, 1])) && p1.every(v => eq(v, [0.25, 1, 0, 1])), 'dragon: part colour 0.25,1,0');
  no(p0.every(v => v.p[0] >= 3.5 && v.p[0] <= 4.5) && p1.every(v => v.p[0] >= -5.5 && v.p[0] <= -2.5), 'dragon: part offset from entity');
  return { f, n };
}
const base = verify(load(SRC));
let ok = base.f.length === 0;
if (!ok) console.log('FAIL: ' + base.f.join('; '));
const breaks = [
  ['drop eye line', s => s.replace('x.push', 'x.push').replace("out.push({ p: [0, F(e.eye), 0], c: [0, 0, 255, 255] });", '').replace(/out\.push\(\{ p: \[F\(L\[0\] \* 2\).*\n/, '')],
  ['drop eye slab', s => s.replace('if (e.living) {', 'if (false) {')],
  ['wrong box colour', s => s.replace('Hb.drawBox(out, b, 1, 1, 1, 1);', 'Hb.drawBox(out, b, 1, 1, 0, 1);')],
  ['drop dragon parts', s => s.replace('if (e.parts) for', 'if (false) for')],
  ['look 1 block', s => s.replace('L[0] * 2', 'L[0]')],
  ['scrambled vertex order', s => s.replace('[0,1,2],[3,1,2],[0,1,2],[0,4,2]', '[0,1,2],[3,1,2],[0,1,2],[3,4,2]')],
];
let caught = 0;
for (const [name, fn] of breaks) {
  const m = fn(SRC);
  if (m === SRC) { console.log('break did not apply: ' + name); ok = false; continue; }
  if (verify(load(m)).f.length) { caught++; console.log("  ✓ break caught: " + name); } else { console.log('NOT CAUGHT: ' + name); ok = false; }
}
console.log(`assertions passed ..... ${base.n}\n${caught} breaks caught (hitboxcheck ${ok && caught === breaks.length ? "OK" : "FAILED"})`);
process.exit(ok && caught === breaks.length ? 0 : 1);
