#!/usr/bin/env node
// enderdragonvoicecheck.mjs -- #1805: the dragon's growl (2.5, pitch .8-1.1, first after 100 ticks, then 200-399, not while
// sitting/hovering), wing flap (5.0, on cos(wing*2pi) crossing -0.3) and hurt/death (5.0) play through MobVoice.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zzp_mobvoice.js', '07zzl_enderdragon.js'], dom: false });
const ED = M.EnderDragon, played = [];
M.Sound = M.Sound || {};
M.Sound.play = (id, o) => { played.push([id, o]); return true; };
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const brk = (c, m) => { breaks++; ok(c, 'break caught: ' + m); };
const n = (id) => played.filter((p) => p[0] === id);

function run(ticks, phase) {
  played.length = 0;
  const e = { type: 'ender_dragon', x: 0, y: 70, z: 0, yaw: 0, health: 200 };
  ED.initEntity(e);
  const pm = e.dragon.phaseManager, pt = phase && ED.PHASE_TYPES.byName[phase];
  for (let i = 0; i < ticks; i++) { if (pt) pm.setPhase(pt); ED.tickEntity(e); }
  return e;
}
run(99); ok(n('entity.ender_dragon.growl').length === 0, 'no growl before tick 100');
run(101); const g = n('entity.ender_dragon.growl');
ok(g.length === 1 && g[0][1].volume === 2.5 && g[0][1].pitch >= 0.8 && g[0][1].pitch <= 1.1, 'first growl at tick 101: vol 2.5, pitch 0.8..1.1');
run(1200, 'HoldingPattern'); ok(n('entity.ender_dragon.growl').length >= 3, 'growls repeat');
run(1200, 'HoldingPattern'); const f = n('entity.ender_dragon.flap');
ok(f.length > 5 && f.every((p) => p[1].volume === 5.0), 'wing flaps play at volume 5.0');
run(600, 'Hover'); ok(n('entity.ender_dragon.growl').length === 0, 'no growl while hovering');
ok(n('entity.ender_dragon.flap').length > 0, 'hover still flaps (wing += 0.1)');

const e = run(1); played.length = 0;
e.dragon.parentDamage({}, 10); ok(n('entity.ender_dragon.hurt').length === 1 && n('entity.ender_dragon.hurt')[0][1].volume === 5.0, 'hurt sound vol 5.0');
e.dragon.parentDamage({}, 1000); ok(n('entity.generic.death').length === 1, 'killing blow plays death sound');

// breaks: each assertion must fail when its feature is removed
const P = ED.EnderDragonEntity.prototype, sounds = P.tickSounds, say = P.say;
P.tickSounds = function () {}; run(1200);
brk(n('entity.ender_dragon.growl').length === 0 && n('entity.ender_dragon.flap').length === 0, 'no tickSounds -> silent growl/flap');
P.tickSounds = sounds; P.say = function () {};
const e2 = run(1); played.length = 0; e2.dragon.parentDamage({}, 10);
brk(n('entity.ender_dragon.hurt').length === 0, 'no say -> silent hurt');
P.say = say;
const tp = P.tickMovement; P.tickMovement = function () { this.wingPosition = 0; };
run(300); brk(n('entity.ender_dragon.flap').length === 0, 'frozen wing clock -> no flap');
P.tickMovement = tp;

console.log(`enderdragonvoicecheck: ${pass} passed, ${fails} failed, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
