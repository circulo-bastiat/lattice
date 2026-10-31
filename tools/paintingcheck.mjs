#!/usr/bin/env node
// paintingcheck.mjs — #317 acceptance: PaintingEntity motive choice (src/07zzv_hanging.js).
// A 2x2 gap only ever gets a motive that fits; the chosen motive is always of max fitting area;
// a painting breaks when its wall does. Anti-vacuity: allow any motive / skip canStayAttached.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07zzv_hanging.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const W = M.World, CH = M.CH, S = M.States, H = M.Hanging, EL = M.EntityList;
M.Behave.init(W); M.Entities.init(); EL.init(); W.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

// Wall at z=3 (stone x 0..5,y 80..85), air at z=4. Gap: only a 2x2 window of the wall exists.
function wall(w, h) {
  for (let x = -2; x <= 8; x++) for (let y = 78; y <= 88; y++) { W.setBlock(x, y, 3, 0); W.setBlock(x, y, 4, 0); }
  for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) W.setBlock(x, 80 + y, 3, stone);
}
// An LCG gives many distinct "seeds" for rnd(n).
const seeded = (s) => () => 0, rng = (s) => { let a = s >>> 0; return (n) => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return (a >>> 8) % n; }; };
const area = (m) => m[1] * m[2];
const fitting = (w, h) => H.MOTIVES.filter((m) => m[1] <= w * 16 && m[2] <= h * 16);
function placeFails(w, h, ax, ay) {
  const bad = [], maxA = Math.max(...fitting(w, h).map(area));
  wall(w, h);
  for (let s = 1; s <= 200; s++) {
    const p = H.placePainting(W, ax, ay, 4, 0, [], rng(s));
    if (p.widthPixels > w * 16 || p.heightPixels > h * 16) bad.push(`seed ${s}: ${p.motive} does not fit ${w}x${h}`);
    else if (p.widthPixels * p.heightPixels !== maxA) bad.push(`seed ${s}: ${p.motive} area ${p.widthPixels * p.heightPixels} != max ${maxA}`);
  }
  return bad;
}
const tests = () => [...placeFails(2, 2, 0, 80), ...placeFails(1, 1, 0, 80), ...placeFails(4, 2, 1, 80), ...placeFails(2, 1, 0, 80)];
{ const r = tests(); ok(r.length === 0, 'motive choice: ' + r.slice(0, 3).join('; ')); }
{ // 2x2 gap hits every 2x2 motive over many seeds (random pick among the largest)
  wall(2, 2); const seen = new Set();
  for (let s = 1; s <= 400; s++) seen.add(H.placePainting(W, 0, 80, 4, 0, [], rng(s)).motive);
  const want = H.MOTIVES.filter((m) => m[1] === 32 && m[2] === 32).map((m) => m[0]);
  ok(want.length === 6 && want.every((n) => seen.has(n)) && seen.size === 6, 'all six 2x2 motives reachable: ' + [...seen]);
}
// a painting breaks when its wall does
const breakTest = () => {
  wall(2, 2);
  const p = H.placePainting(W, 0, 80, 4, 0, [], rng(7)); let broke = 0; p.onBreak = () => { broke++; };
  for (let i = 0; i < 101; i++) H.tick(p, W, []);
  const survived = !p.removed;
  W.setBlock(0, 80, 3, 0);
  for (let i = 0; i < 101 && !p.removed; i++) H.tick(p, W, []);
  return survived && p.removed && broke === 1;
};
ok(breakTest(), 'painting survives with its wall and breaks (once) when the wall does');

// anti-vacuity
{ const o = H.canStayAttached; H.canStayAttached = () => true;
  breaks++; ok(tests().length > 0, 'allow-any-motive went undetected');
  breaks++; ok(!breakTest(), 'skipped canStayAttached went undetected'); H.canStayAttached = o; }
{ const i = H.MOTIVES.findIndex((m) => m[0] === 'match'), o = H.MOTIVES[i]; H.MOTIVES[i] = ['match', 16, 16];
  wall(2, 2); const seen = new Set();
  for (let s = 1; s <= 400; s++) seen.add(H.placePainting(W, 0, 80, 4, 0, [], rng(s)).motive);
  breaks++; ok(seen.size !== 6 || seen.has('match'), 'shrunken motive undetected'); H.MOTIVES[i] = o; }

for (const f of fails) console.log('FAIL ' + f);
console.log(`paintingcheck: ${pass} passed, ${fails.length} failed, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
