#!/usr/bin/env node
// goals11582check.mjs — #11582: 07k_goals.js classes the audit map had no check row for.
//  PathNodeMaker (Ai.mobNodeType over a real World: cactus/fence/open), BlockBreakingInfo (BreakDoorGoal publishes crack stages
//  0..9 on e.doorCrack and -1 on stop), AmbientEntity (bat: empty goal selector; Tm.canLeash refuses it). Each source break must fail its row.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
    '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js', '07n_tame.js'], ...(patch ? { patch } : {}) });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
  const Ai = M.Ai, W = M.World, CH = M.CH, T = Ai.NodeType, o = {};
  const st = (n) => M.States.stateOf(n) | 0;
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 8, z, st('stone'));
  W.setBlock(2, 8, 0, st('sand')); W.setBlock(2, 9, 0, st('cactus'));
  W.setBlock(4, 9, 0, st('oak_fence'));
  const z = { type: 'zombie', width: 0.6, height: 1.95, x: 0.5, y: 9, z: 0.5 };
  o.open = Ai.mobNodeType(z, 0, 9, 0) === T.OPEN || Ai.mobNodeType(z, 0, 9, 0) === T.WALKABLE;
  o.cactus = Ai.mobNodeType(z, 2, 8, 0) === T.BLOCKED && Ai.mobNodeType(z, 2, 9, 0) === T.DAMAGE_CACTUS;
  o.fence = Ai.mobNodeType(z, 4, 8, 0) === T.FENCE;
  // BlockBreakingInfo stages
  const e = { type: 'zombie', x: 0.5, y: 64, z: 0.5, target: { x: 3, y: 64, z: 0.5 }, navPath: [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }], navIdx: 0 };
  M.Commands = M.Commands || { ruleGet: () => 'true' };
  const stages = []; let door = { closed: true, iron: false, wood: true };
  const g = new Ai.BreakDoorGoal(e, { doorAt: (x, y, zz) => (door && x === 1 && y === 65 && zz === 0 ? door : null), breakDoor: () => { door = null; } });
  try {
    if (g.canUse()) { g.start(); for (let i = 0; i < 240 && g.canContinueToUse(); i++) { g.tick(); if (stages[stages.length - 1] !== e.doorCrack) stages.push(e.doorCrack); } }
  } catch (err) { /* leave stages empty */ }
  o.stages = stages.join(',') === '0,1,2,3,4,5,6,7,8,9,10'; o.sd = stages.join(',');
  g.stop(); o.stageReset = e.doorCrack === -1;
  // AmbientEntity (bat)
  const sel = Ai.ROSTER.bat(e, {});
  o.batEmpty = sel.entries.length === 0;
  o.batLeash = M.Tame.canLeash({ type: 'bat' }) === false && M.Tame.canLeash({ type: 'cow' }) === true;
  return o;
}
const LBL = ['open', 'cactus', 'fence', 'stages', 'stageReset', 'batEmpty', 'batLeash'];
const base = trial();
for (const k of LBL) ok(base[k] === true, 'baseline row ' + k + ' ' + base.sd);
const BR = [
  ['fence', '07k_goals.js', /if \(seen\.indexOf\(T\.FENCE\) >= 0\) return T\.FENCE;/, ''],
  ['cactus', '07k_goals.js', /if \(pen < 0\) return tt;/, 'if (false) return tt;'],
  ['stageReset', '07k_goals.js', /this\.stop = function \(\) \{ progress = 0; door = null; e\.doorCrack = -1; \};/, 'this.stop = function () { progress = 0; door = null; };'],
  ['stages', '07k_goals.js', /if \(stage !== prevStage\) \{ e\.doorCrack = prevStage = stage; \}/, ''],
  ['batEmpty', '07k_goals.js', /Ai\.ROSTER\.bat = function \(\) \{ return new Ai\.GoalSelector\(\); \};/, 'Ai.ROSTER.bat = function () { var s = new Ai.GoalSelector(); s.add(1, new Ai.FloatGoal({}, Math.random)); return s; };'],
  ['batLeash', '07n_tame.js', /bat: true, villager: true/, 'villager: true'],
];
for (const [key, file, re, rep] of BR) {
  const src = readFileSync(join(MCLITE_ROOT, 'src', file), 'utf8');
  if (!re.test(src)) { fails.push('pattern not found: ' + key); continue; }
  breaks++; let hit = false, B;
  try { B = trial((f, s) => { const n = f === file ? s.replace(re, rep) : s; if (n !== s) hit = true; return n; }); } catch (err) { B = {}; }
  ok(hit, 'break matched: ' + key); ok(!B[key], 'break must be caught: ' + key);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
