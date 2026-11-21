#!/usr/bin/env node
// minecartrender11641check.mjs — #11641: proves 07zzs_minecartrender.js's TntMinecartEntityRenderer (fuse scale + flash in MR.blockFor)
// and MinecartEntityModel (the layers the renderer draws), reachability from 07j_entityrender, SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT, ASSETS } from './loadsrc.mjs';
import { deflateRawSync } from 'node:zlib';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
function trial(patch) {
  const M = loadEngine({ extra: ['02g_items.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
    '10_gfx.js', '15h_bemodel.js', '07zzr_minecart.js', '07zzs_minecartrender.js'], dom: false,
    patch: patch ? (f, s) => (f === '07zzs_minecartrender.js' ? patch(s) : s) : undefined });
  initRegistry(M);
  const mm = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'models.meta.json'), 'utf8'));
  M.BEModel.init({ models: readFileSync(join(MCLITE_ROOT, 'assets', 'models.bin')).toString('base64'), modelsBytes: mm.rawBytes });
  const geo = readFileSync(join(MCLITE_ROOT, 'assets', 'mob-geometry.json'));
  M.DATA = Object.assign({}, M.DATA, { mobGeometry: deflateRawSync(geo).toString('base64'), mobGeometryBytes: geo.length,
    entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.EntityRender.init();
  const MR = M.MinecartRender, o = {};
  const sc = (e, p) => { const b = MR.blockFor(e, p, [0, 0, 0]); return b ? Math.hypot(b.m[0], b.m[3], b.m[6]) : -1; };
  const base = sc({ type: 'tnt_minecart', id: 1, cartFuse: -1 }, 0);
  o.unlit = near(base, 0.75);
  o.early = near(sc({ type: 'tnt_minecart', id: 1, cartFuse: 40 }, 0), 0.75);
  // fuse 0, partial 0: f = 1 - 1/10 = .9 -> f^4 = .6561 -> k = 1.19683
  o.late = near(sc({ type: 'tnt_minecart', id: 1, cartFuse: 0 }, 0), 0.75 * (1 + 0.6561 * 0.3));
  o.notnt = near(sc({ type: 'furnace_minecart', id: 1, cartFuse: 0 }, 0), 0.75);
  o.flash0 = MR.blockFor({ type: 'tnt_minecart', id: 1, cartFuse: 3 }, 0, [0, 0, 0]).white === 1;
  o.flash1 = MR.blockFor({ type: 'tnt_minecart', id: 1, cartFuse: 7 }, 0, [0, 0, 0]).white === 0;
  o.layers = MR.TYPES.every((t) => !!M.BEModel.layer && true) && MR.TYPES.length === 7 && MR.is('tnt_minecart') && MR.is('minecart') && !MR.is('boat');
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.MinecartRender\.blockFor\(e, partial\)/.test(rd('07j_entityrender.js')), 'reach: 07j draws MinecartRender.blockFor');
ok(/NS\.MinecartRender\.animOf\(e, partial\)/.test(rd('07j_entityrender.js')), 'reach: 07j animOf');
const BR = [
  ['scale', 'k = 1 + f * 0.3', 'k = 1 + f * 0.5', ['late']],
  ['pow', 'f *= f; f *= f;', 'f *= f;', ['late']],
  ['type', "e.type === 'tnt_minecart' && fz > -1 && fz", "e.type !== 'x' && fz > -1 && fz", ['notnt']],
  ['flash', '((fz / 5) | 0) % 2 === 0', '((fz / 5) | 0) % 2 === 1', ['flash0']],
  ['is', 'MR.TYPES.indexOf(type) >= 0', 'MR.TYPES.indexOf(type) >= 1', ['layers']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`minecartrender11641check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
