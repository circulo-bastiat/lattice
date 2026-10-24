#!/usr/bin/env node
// playersoundcheck.mjs — #4814: PlayerEntity.getHurtSound/getDeathSound (:645-658) and the splash pair.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['14b_physics.js', '14d_survival.js'], initReg: false });
const Sv = M.Survival;
const played = [], pitches = [];
M.Sound = Object.assign(M.Sound || {}, { play: (ev, o) => { played.push(ev); pitches.push(o && o.pitch); } });
const P = { x: 0, y: 64, z: 0, health: 20, maxHealth: 20 };
M.Player = P;
const fails = []; let pass = 0;
const CASES = [['generic', 'entity.player.hurt'], ['onFire', 'entity.player.hurt_on_fire'], ['drown', 'entity.player.hurt_drown'],
  ['sweetBerryBush', 'entity.player.hurt_sweet_berry_bush'], ['freeze', 'entity.player.hurt_freeze']];
const run = () => {
  const got = [];
  for (const [t, want] of CASES) {
    Sv.init(P); P.dead = false; P.health = 20; P.mode = 0; played.length = 0;
    Sv.hurt(P, t, 1);
    got.push([t, played[0], want]);
  }
  Sv.init(P); P.dead = false; P.health = 20; played.length = 0;
  Sv.hurt(P, 'generic', 100);
  got.push(['kill', played[0], 'entity.player.death']);
  return got;
};
const bad = (g) => g.filter(([, a, b]) => a !== b);
for (const [t, a, b] of run()) { if (a === b) pass++; else fails.push(`${t}: played ${a}, vanilla ${b}`); }
// #4880: getSoundPitch = (r-r)*0.2+1 -> spans ~0.8..1.2, not a fixed 1
const spread = () => { pitches.length = 0; for (let i = 0; i < 300; i++) { Sv.init(P); P.dead = false; P.health = 20; Sv.hurt(P, 'generic', 1); }
  return pitches.length && Math.min(...pitches) < 0.9 && Math.max(...pitches) > 1.1 && Math.min(...pitches) >= 0.8 && Math.max(...pitches) <= 1.2; };
if (spread()) pass++; else fails.push('hurt pitch does not vary over 0.8..1.2');
// anti-vacuity
let breaks = 0;
const o = M.Sound.play;
{ const op = Math.random; Math.random = () => 0.5; if (!spread()) { breaks++; console.log('   ✓ break caught: fixed pitch'); } else fails.push('fixed pitch unnoticed'); Math.random = op; }
M.Sound.play = () => {}; if (bad(run()).length) { breaks++; console.log('   ✓ break caught: silenced'); } else fails.push('silenced sound unnoticed');
M.Sound.play = (ev) => played.push(ev.replace('hurt_drown', 'hurt')); if (bad(run()).length) { breaks++; console.log('   ✓ break caught: renamed'); } else fails.push('renamed drown unnoticed');
M.Sound.play = o;
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
