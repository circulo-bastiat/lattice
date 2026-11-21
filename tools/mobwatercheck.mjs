#!/usr/bin/env node
// mobwatercheck.mjs — #960: mob water-entry splash, swim and small_fall/big_fall sounds (entity.hostile.* for HostileEntity, entity.generic.* else).
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07zl_panda.js', '07zzp_mobvoice.js'], dom: false });
const MV = MCL.MobVoice;
let fails = 0, breaks = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const played = [];
MCL.Sound = MCL.Sound || {};
MCL.Sound.play = (id, o) => { played.push([id, o]); return true; };
MCL.Sound.blockVP = () => [1, 1];
MCL.Sound.blockFall = () => { played.push(['block.fall', {}]); return true; };
MCL.Physics = MCL.Physics || {}; MCL.Physics.blockAt = () => 1;
MCL.DATA = Object.assign({}, MCL.DATA, { mobSounds: { zombie: ['', '', '', '', '', '80', '1.0', 'hostile'], cow: ['', '', '', '', '', '120', '0.4', 'neutral'], drowned: ['', '', '', '', '', '80', '1.0', 'hostile'] } });
const ids = () => played.map((p) => p[0]).join();

function scenario() {
  let r = true;
  // zombie: first tick dry, enters water slowly -> hostile splash; staying in water -> nothing more
  played.length = 0;
  const z = { type: 'zombie', x: 0, y: 0, z: 0, vx: 0, vy: -0.05, vz: 0, health: 10, inWater: false, onGround: true };
  MV.tickWater(z); z.inWater = true; MV.tickWater(z); MV.tickWater(z);
  r = r && ids() === 'entity.hostile.splash' && played[0][1].volume > 0 && played[0][1].volume < 0.25;
  // fast entry -> generic splash
  played.length = 0;
  const f = { type: 'zombie', x: 0, y: 0, z: 0, vx: 0, vy: -2, vz: 0, health: 10, inWater: false };
  MV.tickWater(f); f.inWater = true; MV.tickWater(f);
  r = r && ids() === 'entity.generic.splash';
  // a cow (not hostile) splashes generic; a mob whose first tick is already wet is silent
  played.length = 0;
  const c = { type: 'cow', x: 0, y: 0, z: 0, vy: -0.05, health: 10, inWater: false };
  MV.tickWater(c); c.inWater = true; MV.tickWater(c);
  const w0 = { type: 'zombie', x: 0, y: 0, z: 0, health: 10, inWater: true }; MV.tickWater(w0);
  r = r && ids() === 'entity.generic.splash';
  // swimming: steps count in water and play swim at min(1,|v|*.35)
  played.length = 0;
  const s = { type: 'zombie', x: 0, y: 0, z: 0, vx: 0.2, vy: 0, vz: 0, health: 10, inWater: true, onGround: false };
  for (let i = 0; i < 40; i++) { s.x += 0.5; MV.tickStep(s); }
  const dr = { type: 'drowned', x: 0, y: 0, z: 0, vx: 0.2, health: 10, inWater: true, onGround: false };
  const n = played.filter((p) => p[0] === 'entity.hostile.swim').length;
  played.length = 0;
  for (let i = 0; i < 40; i++) { dr.x += 0.5; MV.tickStep(dr); }
  r = r && n > 3 && played.filter((p) => p[0] === 'entity.drowned.swim').length > 3;
  // falls: damage <= 4 small, > 4 big, then the block fall sound; 0 silent
  played.length = 0; MV.onFall({ type: 'zombie', x: 0, y: 5, z: 0 }, 4);
  const a = ids(); played.length = 0; MV.onFall({ type: 'zombie', x: 0, y: 5, z: 0 }, 5);
  const b = ids(); played.length = 0; MV.onFall({ type: 'cow', x: 0, y: 5, z: 0 }, 9);
  const g = ids(); played.length = 0; MV.onFall({ type: 'zombie', x: 0, y: 5, z: 0 }, 0);
  return r && a === 'entity.hostile.small_fall,block.fall' && b === 'entity.hostile.big_fall,block.fall' &&
    g === 'entity.generic.big_fall,block.fall' && played.length === 0;
}
ok(scenario(), 'hostile splash/swim/small_fall/big_fall, generic for others, drowned swim, silent on first tick');

const wsnd = MV.waterSound; MV.waterSound = (e, k) => wsnd({ type: 'cow' }, k);
if (!scenario()) breaks++; else console.log('break1 missed'); MV.waterSound = wsnd;
const tw = MV.tickWater; MV.tickWater = () => false; if (!scenario()) breaks++; else console.log('break2 missed'); MV.tickWater = tw;
const of = MV.onFall; MV.onFall = (e, d) => of(e, d > 4 ? 4 : d); if (!scenario()) breaks++; else console.log('break3 missed'); MV.onFall = of;
const H = MV.HOSTILE; MV.HOSTILE = {}; if (!scenario()) breaks++; else console.log('break4 missed'); MV.HOSTILE = H;
ok(breaks === 4, breaks + ' breaks caught');
console.log(`\n${pass} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
