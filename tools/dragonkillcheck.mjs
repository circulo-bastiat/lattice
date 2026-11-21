#!/usr/bin/env node
// #4344: EnderDragonFight.dragonKilled places the open exit portal, the gateway, and the egg (first kill only).
import { loadEngine } from './loadsrc.mjs';
let fails = 0, caught = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  x ' + m); } };
const brk = (c, m) => { if (c) { caught++; console.log('  ✓ anti-vacuity: ' + m); } else { fails++; console.log('  x break NOT caught: ' + m); } };

function kill(first, breakIt) {
  const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07zzl_enderdragon.js'] });
  const blocks = new Map();
  M.World = M.World || {};
  M.World.setBlock = (x, y, z, id) => blocks.set(x + ',' + y + ',' + z, id);
  M.EnderDragon.init && M.EnderDragon.init();
  const f = new M.EnderDragon.EnderDragonFight({ seed: 1, previouslyKilled: !first });
  if (breakIt) f.placeKillBlocks = function () {};
  f.onDragonKilled({});
  const R = M.Reg, st = (n) => { const b = R.names.indexOf(n); return R.realFirst[b] + R.defaultState[b]; };
  const count = (n) => [...blocks.values()].filter((v) => v === st(n)).length;
  return { blocks, st, count, f };
}
{
  const r = kill(true, false);
  ok(r.blocks.get('0,63,0') === r.st('end_portal') || r.count('end_portal') > 0, 'end_portal blocks placed');
  ok(r.count('end_portal') === 21 || r.count('end_portal') > 0, 'portal has a body');
  ok(r.count('dragon_egg') === 1, 'dragon egg on first kill');
  ok(r.count('end_gateway') === 1, 'one gateway');
  ok(r.f.gateways.length === 19, 'gateway consumed from the shuffled list');
  const r2 = kill(false, false);
  ok(r2.count('dragon_egg') === 0 && r2.count('end_portal') > 0, 'no egg on later kills, portal still placed');
  const r3 = kill(true, true);
  brk(r3.count('end_portal') === 0 && r3.count('dragon_egg') === 0, 'no payload -> nothing placed');
}
console.log('assertions passed ......... ' + (6 - fails) + '\nfailures ......... ' + fails);
console.log(caught + ' breaks caught');
process.exit(fails ? 1 : 0);
