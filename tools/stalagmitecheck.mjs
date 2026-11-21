#!/usr/bin/env node
// stalagmitecheck.mjs — #5663: PointedDripstoneBlock.fallOn: up-TIP => causeFallDamage(dist + 2, 2, STALAGMITE).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07_world.js', '14b_physics.js'], dom: false });
const Ph = MCL.Physics, R = MCL.Reg, SR = MCL.States;
MCL.World.init(1);
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('stalagmitecheck — #5663 stalagmite fall damage');
const base = SR.stateOf('pointed_dripstone'), b = SR.block[base];
const find = (dir, th) => { for (let s = 0; s < SR.count; s++) if (SR.block[s] === b &&
  R.valueNames[SR.propValue(s, R.PROP.vertical_direction)] === dir && R.valueNames[SR.propValue(s, R.PROP.thickness)] === th &&
  R.valueNames[SR.propValue(s, R.PROP.waterlogged)] === 'false') return s; return -1; };
const probe = (st, d) => {
  Ph.blockAt = (x, y, z) => (Math.floor(y) === 99 ? st : 0);
  const e = { type: 'zombie', x: 0.5, y: 100, z: 0.5, effects: {} };
  Ph.landed(e, d, -1); return e;
};
const tip = find('up', 'tip');
ok(tip > 0, 'found up/tip state');
let e = probe(tip, 3);
ok(e.pendingFallDamage === 4 && e.pendingFallSource === 'stalagmite', `up tip 3 blocks = ceil((5-3)*2)=4, got ${e.pendingFallDamage} ${e.pendingFallSource}`);
for (const [d, t] of [['up', 'frustum'], ['up', 'middle'], ['up', 'base'], ['down', 'tip']]) {
  e = probe(find(d, t), 6);
  ok(e.pendingFallDamage === 3 && !e.pendingFallSource, `${d}/${t} 6 blocks plain 3, got ${e.pendingFallDamage}`);
}
const real = Ph.isStalagmiteTip; Ph.isStalagmiteTip = () => false;
e = probe(tip, 3); okAv(e.pendingFallDamage !== 4, 'hook removed: 3-block case no longer 4');
Ph.isStalagmiteTip = real;
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const x of fails) console.log('   ✗ ' + x);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
