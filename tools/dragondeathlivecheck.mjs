#!/usr/bin/env node
// dragondeathlivecheck.mjs — #10982: live dragon death through ED.tickEntity: XP (12000 first / 500 after),
// exit portal activation + dragon egg (first kill only), ticksSinceDeath animation counter.
import { loadEngine } from './loadsrc.mjs';
const NS = loadEngine({ extra: ['07zzl_enderdragon.js'] });
const ED = NS.EnderDragon;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
function kill(prev, mut) {
  const blocks = new Map(), xp = [], ticks = [];
  NS.World = { setBlock: (x, y, z, s) => blocks.set(x + ',' + y + ',' + z, s), getBlock: () => 0 };
  NS.Xp = { ready: true, spawn: (x, y, z, n) => xp.push(n) };
  NS.Breed = { mobLoot: () => true };
  NS.Sound = { play() {} }; NS.Particle = { spawn() {} };
  const e = { type: 'ender_dragon', x: 0, y: 70, z: 0, yaw: 0, health: 0 };
  ED.initEntity(e);
  e.dragon.fight.previouslyKilled = prev;
  e.dragon.health = 0;
  if (mut) mut(e);
  for (let i = 0; i < 210 && !e.removed; i++) { ED.tickEntity(e); ticks.push(e.ticksSinceDeath); }
  const R = NS.Reg, o = e.dragon.fight.exitPortalLocation;
  const nm = (x, y, z) => { const s = blocks.get(x + ',' + y + ',' + z); if (s === undefined) return null;
    for (let b = 0; b < R.names.length; b++) if (s >= R.realFirst[b] && s < R.realFirst[b] + 1e9 && R.defaultState[b] + R.realFirst[b] === s) return R.names[b]; return '?'; };
  return { e, xp, ticks, nm, o, n: blocks.size };
}
function assess(k, first) {
  const base = first ? 12000 : 500, sum = k.xp.reduce((a, b) => a + b, 0);
  const exp = 9 * Math.floor(base * 0.08) + Math.floor(base * 0.08) + Math.floor(base * 0.2);
  const res = [];
  if (!k.e.removed) res.push('not removed');
  if (k.ticks[0] !== 1 || k.ticks[199] !== 200) res.push('ticksSinceDeath ' + k.ticks[0] + '..' + k.ticks[199]);
  if (sum !== exp) res.push('xp ' + sum + ' != ' + exp);
  if (k.nm(k.o.x + 2, k.o.y, k.o.z) !== 'end_portal') res.push('portal not active: ' + k.nm(k.o.x + 2, k.o.y, k.o.z));
  if ((k.nm(k.o.x, k.o.y + 4, k.o.z) === 'dragon_egg') !== first) res.push('egg presence wrong');
  return res;
}
for (const first of [true, false]) { const r = assess(kill(!first), first); ok(!r.length, (first ? 'first' : 'repeat') + ': ' + r.join('; ')); }
if (fails.length) { console.log('FAIL', fails); process.exit(1); }
let caught = 0;
const bk = (name, f) => { if (f()) { caught++; console.log('  ✓ break caught: ' + name); } };
bk('mobLoot off', () => { const k = kill(false, () => { NS.Breed.mobLoot = () => false; }); return assess(k, true).length > 0; });
bk('placeKillBlocks disabled', () => { const keep = ED.EnderDragonFight.prototype.placeKillBlocks; ED.EnderDragonFight.prototype.placeKillBlocks = function () {};
  const bad = assess(kill(false), true).length > 0; ED.EnderDragonFight.prototype.placeKillBlocks = keep; return bad; });
bk('egg on repeat', () => assess(kill(true), true).length > 0);
bk('wrong xp base', () => assess(kill(true), true).length > 0 && assess(kill(false), false).length > 0);
console.log(`OK  ${pass} checks passed, 0 failures; ${caught} breaks caught`);
process.exit(caught >= 4 ? 0 : 1);
