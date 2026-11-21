#!/usr/bin/env node
// frostedicecheck -- #5721: FrostedIceBlock exact. A seeded run over a frosted_ice patch is compared tick-for-tick with an
// independent model written from .decomp/net/minecraft/block/FrostedIceBlock.java + IceBlock.melt (age gate, canMelt(4)
// neighbour count, 20..40 reschedule, neighbour ageing, canMelt(2) neighborUpdate melt, water result).
import { loadEngine } from './loadsrc.mjs';

const LIGHT = 15;
const mulberry = (a) => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const CELLS = [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1], [0, 2], [1, 2], [2, 2], [6, 6], [7, 6]];
const DIR = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
const key = (x, z) => x + ',' + z;
const nextInt = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// the reference: cell -> age (absent = melted/not frosted); the scheduler is the vanilla de-duplicating queue.
function reference(seed, ticks, light) {
  const r = mulberry(seed), age = new Map(), log = [], q = []; let t = 0, sq = 0; const pend = new Map();
  const sched = (x, z, d) => { const at = t + d, k = key(x, z); if (pend.has(k) && pend.get(k) <= at) return; pend.set(k, at); q.push({ x, z, at, sq: sq++ }); };
  const frosted = (x, z) => age.has(key(x, z));
  const count = (x, z, lim) => { let n = 0; for (const [dx, dy, dz] of DIR) if (dy === 0 && frosted(x + dx, z + dz) && ++n >= lim) return false; return true; };
  const melt = (x, z) => { age.delete(key(x, z)); log.push(t + ' melt ' + key(x, z)); };   // the water that replaces it is not frosted_ice, so FrostedIceBlock.neighborUpdate of its neighbours does nothing
  const inc = (x, z) => { const a = age.get(key(x, z)); if (a < 3) { age.set(key(x, z), a + 1); log.push(t + ' age ' + key(x, z) + ' ' + (a + 1)); return false; } melt(x, z); return true; };
  const tick = (x, z) => {
    if (!frosted(x, z)) return;
    const a = age.get(key(x, z));
    if ((Math.floor(r() * 3) === 0 || count(x, z, 4)) && light > 11 - a - 3 && inc(x, z)) {
      for (const [dx, dy, dz] of DIR) if (dy === 0 && frosted(x + dx, z + dz) && !inc(x + dx, z + dz)) sched(x + dx, z + dz, nextInt(r, 20, 40));
    } else sched(x, z, nextInt(r, 20, 40));
  };
  for (const [x, z] of CELLS) age.set(key(x, z), 0);
  for (const [x, z] of CELLS) sched(x, z, nextInt(r, 60, 120));
  for (t = 1; t <= ticks; t++) {
    const due = q.filter((e) => e.at <= t).sort((a, b) => a.at - b.at || a.sq - b.sq);
    for (const e of due) q.splice(q.indexOf(e), 1);
    for (const e of due) pend.delete(key(e.x, e.z));
    for (const e of due) tick(e.x, e.z);
    if (t % 17 === 0) tick(...CELLS[t % CELLS.length]);   // a random tick runs the same body
  }
  return log;
}

function engine(seed, ticks, light, patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js'], patch });
  const S = M.States, B = M.Behave, R = M.Reg, mem = new Map(), log = [];
  const ice0 = S.stateOf('frosted_ice'), stone = S.stateOf('stone');
  const ageOf = (st) => (S.block[st] === R.id.frosted_ice ? st - ice0 : -1);
  let t = 0;
  B.init({
    getBlock: (x, y, z) => mem.get(x + ',' + y + ',' + z) || 0,
    blockLightAt: () => light,
    setBlock: (x, y, z, s) => {
      const k = x + ',' + y + ',' + z, old = mem.get(k) || 0; if (old === s) return false; mem.set(k, s);
      if (S.block[s] === R.id.frosted_ice) log.push(t + ' age ' + key(x, z) + ' ' + ageOf(s));
      else if (S.block[s] === R.id.water && S.block[old] === R.id.frosted_ice) log.push(t + ' melt ' + key(x, z));
      B.changed(x, y, z, old); return true;
    },
  });
  B.clearSchedule(); B.rng = mulberry(seed);
  for (const [x, z] of CELLS) mem.set(x + ',9,' + z, stone);
  for (const [x, z] of CELLS) mem.set(x + ',10,' + z, ice0);
  const r = B.rng; for (const [x, z] of CELLS) B.schedule(x, 10, z, nextInt(r, 60, 120));
  for (t = 1; t <= ticks; t++) {
    B.gameTime = t - 1; B.tick();
    if (t % 17 === 0) { const [x, z] = CELLS[t % CELLS.length]; B.randomTick(x, 10, z, B.rng); }
  }
  return log.filter((l) => !/ age .* 0$/.test(l));
}

// FrostedIceBlock.neighborUpdate (canMelt(.,2)): placing frosted_ice beside a lone frosted cell melts that cell; beside one that
// already has another frosted neighbour (count 2 after placing) it stays.
function placement(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07b_behaviour.js'], patch });
  const S = M.States, B = M.Behave, R = M.Reg, mem = new Map(), ice = S.stateOf('frosted_ice');
  B.init({ getBlock: (x, y, z) => mem.get(x + ',' + y + ',' + z) || 0, blockLightAt: () => 0,
    setBlock: (x, y, z, s) => { const k = x + ',' + y + ',' + z, o = mem.get(k) || 0; if (o === s) return false; mem.set(k, s); B.changed(x, y, z, o); return true; } });
  const at = (x) => S.block[mem.get(x + ',10,0') || 0];
  mem.set('0,10,0', ice); B.w.set(1, 10, 0, ice);             // 0 is lone: placing 1 beside it melts it
  const bad = [];
  if (at(0) !== R.id.water) bad.push('lone frosted cell next to a newly placed frosted_ice must melt');
  mem.set('5,10,0', ice); mem.set('7,10,0', ice); B.w.set(6, 10, 0, ice);   // 5 and 7 each get exactly 1 frosted neighbour -> melt
  mem.set('10,10,0', ice); mem.set('10,10,1', ice); B.w.set(11, 10, 0, ice);  // 10 has 2 frosted neighbours -> stays
  if (at(10) !== R.id.frosted_ice) bad.push('a frosted cell with 2 frosted neighbours must not melt');
  return bad;
}

const SEEDS = [1, 7, 42, 1234], TICKS = 500;
function verdict(patch, light = LIGHT) {
  const bad = [];
  for (const s of SEEDS) {
    const want = reference(s, TICKS, light).join('\n'), got = engine(s, TICKS, light, patch).join('\n');
    if (want !== got) { bad.push('seed ' + s + ': engine log differs from the model (first diff near: ' + (got.split('\n').find((l, i) => l !== want.split('\n')[i]) || 'length') + ')'); }
    if (!want.includes('melt')) bad.push('seed ' + s + ': reference never melted - vacuous');
  }
  return bad.concat(placement(patch));
}
const rep = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('break did not match: ' + a); return s.replace(a, b); };
const BREAKS = [
  ['age gate: always 1-in-3 only', rep('07b_behaviour.js', 'Math.floor(rnd() * 3) === 0 || frostedCount(x, y, z, 4)', 'Math.floor(rnd() * 3) === 0')],
  ['neighbour count 4 -> 3', rep('07b_behaviour.js', 'frostedCount(x, y, z, 4)', 'frostedCount(x, y, z, 3)')],
  ['melt leaves air not water', rep('07b_behaviour.js', 'function frostedMelt(x, y, z) { w.set(x, y, z, fluidState(B.WATER, 8, false)); }', 'function frostedMelt(x, y, z) { w.set(x, y, z, 0); }')],
  ['reschedule 20..40 -> 20..30', rep('07b_behaviour.js', 'nextInt(rnd, 20, 40)', 'nextInt(rnd, 20, 30)')],
  ['neighborUpdate melt dropped', rep('07b_behaviour.js', 'frostedCount(nx, ny, nz, 2)) { frostedMelt', 'false) { frostedMelt')],
];
const real = verdict(undefined); let caught = 0;
for (const [n, p] of BREAKS) { let b; try { b = verdict(p); } catch (e) { console.log(' BREAK ERROR:', n, e.message); continue; } if (b.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`frostedicecheck -- #5721, FrostedIceBlock: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
