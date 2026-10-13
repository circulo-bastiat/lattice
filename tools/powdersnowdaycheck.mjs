#!/usr/bin/env node
// powdersnowdaycheck.mjs -- #1243: MobEntity.isAffectedByDaylight (:1365) excludes inPowderSnow || wasInPowderSnow.
// Skeleton/stray canFreeze() is false (stray is freeze-immune), so isShaking=isFrozen is never true for them.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { if (c) { breaks++; console.log(' ✓ ' + m); } else fails.push('break NOT caught: ' + m); };
console.log('powdersnowdaycheck — wasInPowderSnow gates daylight burning');
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '14j_combat.js'] });
const Cb = M.Combat || M.Cb;
ok(typeof Cb.tickPowderSnow === 'function' && typeof Cb.isAffectedByDaylight === 'function', 'Cb exports present');
const psId = M.Reg.id.powder_snow;
let psState = 1; while (M.States.block[psState] !== psId) psState++;
let snow = true;
M.World.getBlock = (x, y, z) => (snow && y === 20 ? psState : 0);
M.World.getLight = () => 15 << 4; M.World.canSeeSky = () => true;
M.Sky = Object.assign(M.Sky || {}, { isDay: () => true, darknessNow: () => 0 });
const e = { x: 0.5, y: 20, z: 0.5, type: 'skeleton', width: 0.6, height: 1.99 };
const roll = () => 0;
ok(Cb.isAffectedByDaylight(e, roll) === false && e.inPowderSnow === true, 'in snow: not affected, inPowderSnow set');
snow = false;
const burns = Cb.isAffectedByDaylight(e, roll);
ok(burns === false && e.inPowderSnow === false && e.wasInPowderSnow === true, 'tick after leaving: still not affected (wasInPowderSnow)');
ok(Cb.isAffectedByDaylight(e, roll) === true, 'two ticks out: affected again');
// break: with the previous-tick flag ignored the exit tick would burn
const e2 = { x: 0.5, y: 20, z: 0.5, type: 'skeleton', width: 0.6, height: 1.99 };
snow = true; Cb.isAffectedByDaylight(e2, roll); snow = false;
Cb.tickPowderSnow(e2); e2.wasInPowderSnow = false;
caught(Cb.isAffectedByDaylight(e2, roll) === true, 'break: clearing wasInPowderSnow makes the exit tick burn');
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
