#!/usr/bin/env node
// witherAcquirecheck.mjs — #4362: the wither's centre-head target goal (ActiveTargetGoal(LivingEntity, 0, false, false, ...))
// respects line of sight (TargetPredicate.respectsVisibility) and the expand(follow, 4, follow) search box.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log(' ✓ break caught: ' + m); };
console.log('witheracquirecheck -- #4362: wither target goal needs line of sight and the +-4 vertical box');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '09b_sky.js',
  '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14j_combat.js',
  '07q_effects.js', '07t_fly.js', '07za_explosion.js', '07zw_mobnbt.js', '07zzh_blaze.js',
  '07zzi_ghast.js', '07zzm_wither.js', '07j_entityrender.js', '10_gfx.js', '15h_bemodel.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = MCL.World, B = MCL.Behave, CH = MCL.CH, S = MCL.States;
const EL = MCL.EntityList, Ai = MCL.Ai, Ent = MCL.Entities, Cb = MCL.Combat, Ex = MCL.Explosion, Wi = MCL.Wither;
B.init(W); Ent.init(); EL.init(); Ai.init(); Cb.init(); Ex.init();
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
EL.init();
const stone = S.stateOf('stone') | 0;
const w = EL.spawn('wither', 0.5, 80, 0.5);
const ctx = { random: Math.random, players: () => [] };
const gs = Wi.roster(w, ctx);
const goal = gs.entries.find((g) => g.priority === 2 && g.goal && g.goal.canUse).goal;
function trial(vx, vy, vz, wall) {
  const v = EL.spawn('villager', vx, vy, vz);
  const cells = [];
  if (wall) for (let dy = -1; dy <= 3; dy++) for (let dz = -1; dz <= 1; dz++) { cells.push([6, 80 + dy, dz]); }
  for (const c of cells) W.setBlock(c[0], c[1], c[2], stone);
  w.target = null; const got = goal.canUse() && w.target === v;
  for (const c of cells) W.setBlock(c[0], c[1], c[2], 0);
  v.removed = true; EL.list.splice(EL.list.indexOf(v), 1);
  return got;
}
const clear = trial(12.5, 80, 0.5, false);
ok(clear, 'control: villager 12 blocks away in the open is acquired');
ok(!trial(12.5, 80, 0.5, true), 'villager behind a stone wall is NOT acquired');
ok(!trial(8.5, 90, 0.5, false), 'villager 10 blocks above is outside the +-4 box');
ok(trial(8.5, 83, 0.5, false), 'villager 3 blocks above is acquired');
// anti-vacuity: the pre-fix goal (no opts) breaks both rules
const old = new Ai.NearestAttackableTargetGoal(w, function () { return Wi.candidates(w, ctx); }, { sight: false });
const keep = goal.canUse; goal.canUse = old.canUse.bind(old);
okAv(trial(12.5, 80, 0.5, true), 'goal without opts acquires through the wall');
okAv(trial(8.5, 90, 0.5, false), 'goal without opts acquires 10 blocks above');
goal.canUse = keep;
if (fails.length) { console.log(fails.map((f) => ' ✗ ' + f).join('\n')); process.exit(1); }
console.log(`\nwitheracquirecheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
