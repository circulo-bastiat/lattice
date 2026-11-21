#!/usr/bin/env node
// tameownertargetcheck.mjs — #3502: TameableEntity.canTarget(owner)=false -> Ai.canTargetLiving refuses a tamed mob's owner.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js'] });
const can = M.Ai.canTargetLiving;
const P = { type: 'player', health: 20 }; M.Player = P;
const fails = []; let breaks = 0;
const ok = (c, m) => { if (!c) fails.push(m); };
const wolf = o => ({ type: 'wolf', tamed: true, owner: o });
ok(can(P, wolf('player')) === false, 'tamed wolf must not target its owner');
ok(can(P, { type: 'wolf', tamed: false }) === true, 'wild wolf may target the player');
ok(can(P, { type: 'cat', tamed: true, owner: 'player' }) === false, 'tamed cat/parrot too');
const other = { type: 'player', health: 20 };
ok(can(other, wolf(other)) === false, 'entity-valued owner');
ok(can({ type: 'zombie', health: 5 }, wolf('player')) === true, 'non-owner target allowed');
// anti-vacuity: with the owner test removed, the first assertion must fail
breaks++;
{ const f = can; M.Ai.canTargetLiving = (t, s) => f(t, s && { ...s, tamed: false });
  if (M.Ai.canTargetLiving(P, wolf('player')) === false) fails.push('anti-vacuity: owner exclusion removal not caught'); M.Ai.canTargetLiving = f; }
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`PASS 5 assertions, ${breaks} breaks caught`);
