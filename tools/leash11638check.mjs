#!/usr/bin/env node
// leash11638check.mjs — #11638: proves 07u_leash.js (MobEntityRenderer.renderLeash): 24-piece rope, sag law,
// 0.025 ribbon, 0.7/1.0 colour banding, anchors, and reach from 10_gfx.js. SOURCE breaks.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const near = (a, b) => Math.abs(a - b) < 1e-6;
function trial(patch) {
  const MCL = loadEngine({ extra: ['07u_leash.js'], dom: false,
    patch: patch ? (f, s) => (f === '07u_leash.js' ? patch(s) : s) : undefined });
  const Ls = MCL.Leash, o = {};
  o.seg = Ls.SEGMENTS === 24;
  o.sagUp = near(Ls.sagY(4, 0.5), 1) && near(Ls.sagY(4, 1), 4);
  o.sagDown = near(Ls.sagY(-4, 0.5), -3) && near(Ls.sagY(-4, 0), 0);
  const p = Ls.ropePoints(2, 4, 6);
  o.rope = p.length === 25 && near(p[12][0], 1) && near(p[12][2], 3) && near(p[12][1], 1) && near(p[24][1], 4);
  const knot = { kind: 'knot', knot: { x: 1, y: 2, z: 3, removed: false } };
  const a = Ls.holderAnchor(knot);
  o.knot = !!a && a[0] === 1 && near(a[1], 2.2) && a[2] === 3 && Ls.holderAnchor({ kind: 'knot', knot: { removed: true } }) === null;
  // buildVertices with stubbed dependencies
  MCL.Tame = { ready: true }; MCL.Ai = { bodyYawOf: () => 0 }; MCL.Combat = { eyeHeightOf: () => 1 };
  const mob = { type: 'cow', x: 0, y: 0, z: 0, width: 0, leashHolder: { kind: 'knot', knot: { x: 5, y: 0, z: 0 } } };
  MCL.EntityList = { ready: true, list: [mob, { type: 'cow', removed: true, leashHolder: mob.leashHolder }] };
  const v = Ls.buildVertices(0, 0, 0);
  o.count = v.length === 24 * 6 * 6;
  o.color = v.length > 36 && near(v[3], 0.5 * 0.7) && near(v[4], 0.4 * 0.7) && near(v[5], 0.3 * 0.7);
  o.band = v.length > 6 * 7 && near(v[6 * 6 + 3], 0.5);   // segment 1 undimmed (light factor 1 without World)
  o.ribbon = v.length > 12 && near(Math.abs(v[2] - v[8]), 0.05);
  MCL.EntityList.list = [{ type: 'cow', x: 0, y: 0, z: 0, width: 1 }];
  o.noHolder = Ls.buildVertices(0, 0, 0).length === 0;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.Leash && NS\.Leash\.render\) NS\.Leash\.render\(G, cam\)/.test(rd('10_gfx.js')), 'reach: 10_gfx calls Leash.render');
const BR = [
  ['seg', 'Ls.SEGMENTS = 24;', 'Ls.SEGMENTS = 20;', ['seg', 'rope', 'count']],
  ['sagup', 'dy * t * t : dy', 'dy * t : dy', ['sagUp']],
  ['sagdn', 'dy - dy * (1 - t) * (1 - t)', 'dy - dy * (1 - t)', ['sagDown']],
  ['knot', 'k.y + 0.2', 'k.y + 0.3', ['knot']],
  ['dim', 'Ls.COLOR_DIM = 0.7', 'Ls.COLOR_DIM = 0.8', ['color']],
  ['base', 'COLOR_BASE = [0.5, 0.4, 0.3]', 'COLOR_BASE = [0.5, 0.4, 0.4]', ['color']],
  ['band', "(s % 2 === 0) ? Ls.COLOR_DIM : 1.0", "(s % 2 === 1) ? Ls.COLOR_DIM : 1.0", ['color', 'band']],
  ['width', 'k = 0.025 / hl', 'k = 0.05 / hl', ['ribbon']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`leash11638check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
