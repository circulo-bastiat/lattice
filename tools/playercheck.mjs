#!/usr/bin/env node
// playercheck.mjs -- #2724: the player/player_slim entity renderer (third-person body).
//   node tools/playercheck.mjs
// BE.layers.player/player_slim cuboids vs tools/golden/models-1.18.2.tsv, and ER.visible/ER.build drawing the camera
// player only when P.thirdPerson is set. Anti-vacuity: each comparison re-run on corrupted data must fail (D-30).
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
console.log('playercheck -- #2724: player/player_slim renderer');

const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
  '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'], dom: false });
initRegistry(M);
{
  const mm = JSON.parse(readFileSync(MCLITE_ROOT + 'assets/models.meta.json', 'utf8'));
  M.BEModel.init({ models: readFileSync(MCLITE_ROOT + 'assets/models.bin').toString('base64'), modelsBytes: mm.rawBytes });
  const raw = readFileSync(MCLITE_ROOT + 'assets/mob-geometry.json');
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(raw, { level: 9 }).toString('base64'), mobGeometryBytes: raw.length,
    entities: JSON.parse(readFileSync(MCLITE_ROOT + 'assets/entities.json', 'utf8')) });
}
M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
const ER = M.EntityRender, BE = M.BEModel;
ok(ER.ready && BE.ready, 'engine up');

// golden rows: layer part tu tv x y z w h d px py pz rx ry rz mirror sheetW sheetH grow
const gold = {};
for (const l of readFileSync(MCLITE_ROOT + 'tools/golden/models-1.18.2.tsv', 'utf8').split('\n')) {
  const c = l.split('\t'); if (l[0] === '#' || (c[0] !== 'player' && c[0] !== 'player_slim')) continue;
  (gold[c[0]] ||= {})[c[1]] = { tu: +c[2], tv: +c[3], x: +c[4], y: +c[5], z: +c[6], w: +c[7], h: +c[8], d: +c[9], px: +c[10], py: +c[11], pz: +c[12] };
}
const KEYS = ['tu', 'tv', 'x', 'y', 'z', 'w', 'h', 'd', 'px', 'py', 'pz'];
function compare(layer, want) {
  let bad = 0; const have = {}; for (const p of (layer ? layer.parts : [])) have[p.n] = p;
  if (Object.keys(have).length !== Object.keys(want).length) bad++;
  for (const n in want) { const p = have[n]; if (!p) { bad++; continue; } for (const k of KEYS) if (Math.abs(p[k] - want[n][k]) > 1e-6) bad++; }
  return bad;
}
for (const n of ['player', 'player_slim']) {
  ok(Object.keys(gold[n] || {}).length === 14, n + ': 14 golden parts, got ' + Object.keys(gold[n] || {}).length);
  ok(compare(BE.layers[n], gold[n]) === 0, n + ' cuboids match tools/golden/models-1.18.2.tsv');
}

// ── the draw path ───────────────────────────────────────────────────────────────────────────
const P = M.Player = { ex: 0.5, ey: 70, ez: 0.5, yaw: 0, pitch: 0, walkDist: 3, walkDistO: 2.9, thirdPerson: 0 };
const mobs = (slim) => { P.slim = slim; return ER.visible(0.5, 71.6, 4.5, 1).filter((i) => i.shape === 'mob'); };
ok(mobs(false).length === 0, 'first person draws no player body');
P.thirdPerson = 1;
M.EntityList.list = [];
const a = mobs(false), b = mobs(true);
ok(a.length === 1 && a[0].mobLayer === 'player', 'third person draws mobLayer player');
ok(b.length === 1 && b[0].mobLayer === 'player_slim', 'P.slim draws mobLayer player_slim');
const built = ER.build(0, 71, 4, 0.5, 71.6, 4.5, 1);
ok(built && built.buf && built.buf.byteLength > 0 && built.drawn === 1, 'ER.build emits the player quads');

// ── anti-vacuity ────────────────────────────────────────────────────────────────────────────
let caught = 0;
const clone = (o) => JSON.parse(JSON.stringify(o));
const brk = (label, mut) => {
  const L = clone(BE.layers.player), w = clone(gold.player); mut(L, w);
  if (ok(compare(L, w) > 0, 'anti-vacuity: ' + label + ' not caught')) { caught++; console.log('   ✓ caught: ' + label); }
};
brk('head moved', (L) => { L.parts.find((p) => p.n === 'head').y = -7; });
brk('part missing', (L) => { L.parts.pop(); });
brk('golden arm width', (L, w) => { w.left_arm.w = 3; });
P.thirdPerson = 0;
if (ok(mobs(false).length === 0, 'anti-vacuity: thirdPerson=0 still drew')) { caught++; console.log('   ✓ caught: thirdPerson off removes the body'); }

console.log(`  ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(`    ${caught} breaks caught`);
if (fails.length) process.exit(1);
console.log(`playercheck: ${pass} checks passed`);
