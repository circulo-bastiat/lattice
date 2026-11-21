#!/usr/bin/env node
// spawner11633check.mjs — #11633: proves 07zs_spawner.js's three classes with SOURCE breaks:
// DungeonFeature (pickDungeonEntity, reached from 04n_feat_terrain), ParticleTypes (SMOKE/FLAME from clientTick),
// MobSpawnerBlockEntityRenderer (Spawner.display, reached from 07j ER.spawnerDisplays).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const MCL = loadEngine({ extra: ['07zs_spawner.js'], dom: false, patch: patch ? (f, s) => (f === '07zs_spawner.js' ? patch(s) : s) : undefined });
  const S = MCL.Spawner, o = {};
  // DungeonFeature: skeleton 1/4, zombie 2/4, spider 1/4
  const cnt = {}; for (let i = 0; i < 4; i++) { const t = S.pickDungeonEntity((b) => i % b); cnt[t] = (cnt[t] || 0) + 1; }
  o.dSkel = cnt.skeleton === 1; o.dZomb = cnt.zombie === 2; o.dSpid = cnt.spider === 1;
  o.dIdx = S.pickDungeonEntity((b) => (o.bound = b, 0)) === 'skeleton' && o.bound === 4;
  // ParticleTypes: smoke + flame at one shared point, zero velocity, only when a player is in range
  const spawned = []; MCL.Player = { x: 10.5, y: 10.5, z: 10.5 };
  MCL.Particle = { spawn: (...a) => spawned.push(a) };
  const e = { x: 10, y: 10, z: 10, delay: 20 }; let k = 0; const rnd = () => [0.25, 0.5, 0.75][k++ % 3];
  const r1 = S.clientTick(e, rnd);
  o.pIn = r1 === true && spawned.length === 2;
  o.pKinds = spawned.length === 2 && spawned[0][0] === 'smoke' && spawned[1][0] === 'flame';
  o.pPos = spawned.length === 2 && spawned[0][1] === 10.25 && spawned[0][2] === 10.5 && spawned[0][3] === 10.75 && spawned[1][1] === 10.25 && spawned[0][4] === 0 && spawned[0][5] === 0;
  o.spin = Math.abs(e.spin - Math.fround(1000 / 220)) < 1e-6;
  spawned.length = 0; MCL.Player = { x: 100, y: 10, z: 10 };
  const r2 = S.clientTick(e, rnd);
  o.pOut = r2 === false && spawned.length === 0;
  // MobSpawnerBlockEntityRenderer.render numbers
  const d = S.display({ spin: 10, spinO: 0 }, 0.5, { width: 0.6, height: 1.95 });
  o.rScale = Math.abs(d.scale - 0.53125 / 1.95) < 1e-9;
  o.rSmall = Math.abs(S.display({ spin: 0 }, 0, { width: 0.4, height: 0.5 }).scale - 0.53125) < 1e-9;
  o.rSpin = Math.abs(d.spinDeg - 50) < 1e-9 && d.tiltDeg === -30 && d.lift === 0.2;
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) if (k !== 'bound') ok(A0[k], 'scenario ' + k);
const rd = (f) => readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
ok(/NS\.Spawner\.pickDungeonEntity\(/.test(rd('04n_feat_terrain.js')), 'reach: dungeon feature calls pickDungeonEntity');
ok(/S\.display\(b, partial, dim\)/.test(rd('07j_entityrender.js')), 'reach: ER.spawnerDisplays calls Spawner.display');
ok(/Spawner\.clientTick|S\.clientTick|NS\.Spawner\.clientTick/.test(readAll()), 'reach: clientTick called');
function readAll() { return ['07zr_spawn.js', '14_main.js', '07zy_ticks.js'].map((f) => { try { return rd(f); } catch (e) { return ''; } }).join('\n') + (() => { try { return readFileSync(join(MCLITE_ROOT, 'src', '07zs_spawner.js'), 'utf8'); } catch (e) { return ''; } })(); }
const BR = [
  ['skelCount', "['skeleton', 'zombie', 'zombie', 'spider']", "['skeleton', 'skeleton', 'zombie', 'spider']", ['dZomb', 'dSkel']],
  ['spiderOut', "'zombie', 'spider']", "'zombie', 'zombie']", ['dSpid']],
  ['bound', 'nextInt(Spawner.DUNGEON_ENTITIES.length)', 'nextInt(3)', ['dIdx']],
  ['noSmoke', "Px.spawn('smoke'", "Px.noop('smoke'", ['pIn']],
  ['flameKind', "Px.spawn('flame'", "Px.spawn('smoke'", ['pKinds']],
  ['rangeGate', 'dx * dx + dy * dy + dz * dz > reqR * reqR', 'false', ['pOut']],
  ['posRoll', 'var x = e.x + r(), y = e.y + r(), z = e.z + r();', 'var x = e.x, y = e.y, z = e.z;', ['pPos']],
  ['spinRate', '1000 / (delay + 200)', '1000 / (delay + 100)', ['spin']],
  ['scaleDiv', 'f /= g;', 'f /= 1;', ['rScale']],
  ['scale', 'var f = 0.53125;', 'var f = 0.5;', ['rSmall', 'rScale']],
  ['tilt', 'tiltDeg: -30', 'tiltDeg: 30', ['rSpin']],
  ['spinX10', '* 10;\n    return { scale', '* 5;\n    return { scale', ['rSpin']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  try { X = trial((s) => { if (s.includes(a)) { hit = true; return s.split(a).join(b); } return s; }); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
console.log(`spawner11633check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
