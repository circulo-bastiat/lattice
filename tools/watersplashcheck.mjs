#!/usr/bin/env node
// watersplashcheck.mjs — #5659: non-mob entities entering water splash (sound + particles); land entries do not.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07i_entitylist.js'], dom: false });
const EL = MCL.EntityList || MCL.Entities;
let fails = 0, pass = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } else pass++; };
const snd = [], par = [];
MCL.Sound = MCL.Sound || {}; MCL.Sound.play = (id, o) => { snd.push([id, o]); return true; };
MCL.Particle = MCL.Particle || {}; MCL.Particle.spawn = (n) => { par.push(n); };
MCL.Physics = MCL.Physics || {}; MCL.States = MCL.States || {}; MCL.States.waterIn = { 1: 1 };
let water = false;
const run = (hook) => {
  snd.length = par.length = 0;
  const e = { type: 'item', living: false, x: 0, y: 10, z: 0, vx: 0.1, vy: -1.2, vz: 0, width: 0.25 };
  MCL.Physics.blockAt = () => 0; hook(e);
  MCL.Physics.blockAt = () => (water ? 1 : 0);
  hook(e); hook(e);
};
let hook = (e) => EL.waterSplash(e);
water = true; run(hook);
const want = Math.min(1, Math.sqrt(0.2 * 0.01 + 1.44) * 0.2);
ok(snd.length === 1, 'one splash event, got ' + snd.length);
ok(snd[0] && Math.abs(snd[0][1].volume - want) < 1e-9, 'volume ' + (snd[0] && snd[0][1].volume) + ' vs ' + want);
ok(par.length >= 1, 'particles');
water = false; run(hook);
ok(snd.length === 0 && par.length === 0, 'land: none');
water = true; hook = () => false; run(hook);
const broke = snd.length !== 1;
ok(broke, 'disabled hook caught');
if (broke) console.log('   ✓ disabled hook loses the splash');
console.log('================ watersplashcheck ================\n assertions passed .. ' + pass + '\n failures ........... ' + fails + '\n breaks caught ...... ' + (broke ? 1 : 0));
process.exit(fails ? 1 : 0);
