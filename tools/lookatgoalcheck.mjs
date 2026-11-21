#!/usr/bin/env node
// lookatgoalcheck.mjs — #4282: Ai.LookAtPlayerGoal == LookAtEntityGoal: 0.02 roll, nearest by 3D eye distance, lookTime 40+nextInt(40).
import { loadEngine, initRegistry } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07zzf_piglin.js', '07zf_bat.js', '07zzg_hoglin.js', '07zzp_mobvoice.js'], dom: false });
if (initRegistry) initRegistry(M);
const Ai = M.Ai;
let fails = 0, breaks = 0;
const want = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };
const mk = (players, r, range) => {
  const seen = []; const e = { type: 'zombie', x: 0, y: 64, z: 0, look: { setLookAt(x) { seen.push(x); } } };
  return { e, seen, g: new Ai.LookAtPlayerGoal(e, () => players, range, () => r.v) };
};
const near = { x: 3, y: 64, z: 0 }, far = { x: 6, y: 64, z: 0 };
let r = { v: 0.5 };
let t = mk([near], r); want(!t.g.canUse(), 'roll >= 0.02 refuses');
r.v = 0.01; want(t.g.canUse(), 'roll < 0.02 accepts a player in range');
want(!mk([{ x: 1, y: 84, z: 1 }], r).g.canUse(), 'player 20 blocks overhead is out of 3D range');
want(mk([far, near], r).g.canUse(), 'finds a player'); t = mk([far, near], r); t.g.canUse(); t.g.start(); t.g.tick();
want(t.seen[0] === 3, 'picks the nearest player, not the first');
r.v = 0; t.g.start(); let n = 0; while (t.g.canContinueToUse() && n < 200) { t.g.tick(); n++; } want(n === 40, 'lookTime min 40, got ' + n);
r.v = 0.999; t.g.start(); n = 0; while (t.g.canContinueToUse() && n < 200) { t.g.tick(); n++; } want(n === 79, 'lookTime max 79, got ' + n);
// #4339: chance is the 4th LookAtEntityGoal ctor arg; Vindicator/Evoker/Illusioner/Pillager/Vex pass 1.0F (starts every evaluation)
r.v = 0.5; const ch = (c) => { const e = { type: 'zombie', x: 0, y: 64, z: 0, look: { setLookAt() {} } }; return new Ai.LookAtPlayerGoal(e, () => [near], 8, () => r.v, c).canUse(); };
want(ch(1.0), 'chance 1.0 starts on any roll'); want(!ch(), 'default chance stays 0.02');
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/07k_goals.js', import.meta.url), 'utf8');
for (const [k, m] of [['vindicator', 3], ['pillager', 15], ['evoker', 3], ['illusioner', 3], ['vex', 3]]) {
  const body = src.slice(src.indexOf('    ' + k + ': function (e, ctx)'));
  const mm = /new Ai\.LookAtPlayerGoal\(e, ctx\.players, ([\d.]+)(, undefined, ([\d.]+))?\)/.exec(body);
  want(mm && +mm[1] === m && +mm[3] === 1, k + ' registers LookAtEntityGoal(Player, ' + m + ', 1.0F)');
}
// anti-vacuity: the old behaviour (always-true) would fail the roll probe
breaks++; r.v = 0.5; if (mk([near], r).g.canUse()) { fails++; console.log('FAIL roll probe cannot fail'); } else console.log('✓ break caught: no roll, no start');
breaks++; r.v = 0.5; if (!ch(1.0) || ch()) { fails++; console.log('FAIL chance probe cannot fail'); } else console.log('✓ break caught: chance 1.0 vs default');
breaks++; if (mk([{ x: 1, y: 84, z: 1 }], { v: 0 }).g.canUse()) { fails++; console.log('FAIL y probe cannot fail'); } else console.log('✓ break caught: overhead player refused');
console.log(fails ? `lookatgoalcheck: ${fails} failed` : `lookatgoalcheck: 0 failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
