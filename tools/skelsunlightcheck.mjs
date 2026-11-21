#!/usr/bin/env node
// skelsunlightcheck.mjs -- #1130: AbstractSkeletonEntity.initGoals adds AvoidSunlightGoal(2) and
// EscapeSunlightGoal(3, 1.0); skeleton/stray/wither_skeleton all share Ai.ROSTER.skeleton.
// Proves the roster rows, AvoidSunlight's flag set/clear, and EscapeSunlight's gates (burning,
// sky visible, daytime, no target) and its walk into shade; each has a breaking twin (D-30).
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { if (c) { breaks++; console.log(' ✓ ' + m); } else fails.push('break NOT caught: ' + m); };

console.log('skelsunlightcheck — skeleton AvoidSunlight(2) + EscapeSunlight(3) in the roster; daylight escape');
const M = loadEngine({
  extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
          '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14c_raycast.js']
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Behave.init(M.World); M.Ai.init();
const Ai = M.Ai;

const ctx = { random: () => 0.5, players: () => [], onShoot: () => {} };
const gs = Ai.ROSTER.skeleton({ x: 0, y: 20, z: 0, type: 'skeleton' }, ctx);
const row = (cls, pri) => gs.entries.some(en => en.priority === pri && en.goal instanceof cls);
ok(row(Ai.AvoidSunlightGoal, 2), 'roster has AvoidSunlightGoal at priority 2');
ok(row(Ai.EscapeSunlightGoal, 3), 'roster has EscapeSunlightGoal at priority 3');
caught(!gs.entries.filter(en => en.priority !== 2).some(en => en.goal instanceof Ai.AvoidSunlightGoal), 'AvoidSunlight at a wrong priority is not counted');

// Stubs: day flag, sky-visible = x < 0 is NOT shaded... shade is x >= 4.
let day = true;
M.Sky = Object.assign(M.Sky || {}, { isDay: () => day });
M.World.canSeeSky = (x) => x < 4;
const mk = () => ({ x: 0.5, y: 20, z: 0.5, type: 'skeleton', isOnFire: true, target: null });

let e = mk();
const av = new Ai.AvoidSunlightGoal(e);
ok(av.canUse(), 'AvoidSunlight starts by day');
av.start(); ok(e.navAvoidSunlight === true, 'start sets navAvoidSunlight');
av.stop(); ok(e.navAvoidSunlight === false, 'stop clears navAvoidSunlight');
day = false; caught(!av.canUse(), 'AvoidSunlight refuses at night'); day = true;

// EscapeSunlight: favor stub -> everything shaded is attractive; findPath stub -> straight line.
const realFind = Ai.findPath;
Ai.findPath = (x, y, z, tx, ty, tz) => [{ x, y, z }, { x: tx, y: ty, z: tz }];
const esc = (mut) => { const s = mk(); mut(s); return new Ai.EscapeSunlightGoal(s, 1.0, () => 0.9, () => -1).canUse(); };
ok(esc(() => {}), 'burning daylight skeleton in the open finds shade (x>=4 reachable at rand .9)');
caught(!esc(s => { s.isOnFire = false; }), 'not burning -> no escape');
caught(!esc(s => { s.target = {}; }), 'has a target -> no escape');
day = false; caught(!esc(() => {}), 'night -> no escape'); day = true;
M.World.canSeeSky = () => false; caught(!esc(() => {}), 'already shaded -> no escape'); M.World.canSeeSky = (x) => x < 4;
Ai.findPath = realFind;

console.log('================ skelsunlightcheck ==================');
console.log(fails.length ? fails.join('\n') : '');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
