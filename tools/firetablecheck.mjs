#!/usr/bin/env node
// firetablecheck.mjs — FIRE-2 (#1894): FireBlock's flammability tables and scheduledTick, against the decompiled source.
//   1. TABLE: every FireBlock.registerDefaultFlammables() (burnChance, spreadChance) pair, read from .decomp FireBlock.java
//      (+ the Blocks.java field -> name map), equals the engine's S.ignite / S.burn; nothing else is flammable. Prints the hash.
//   2. REPLAY: an independent transcription of FireBlock.scheduledTick (FireBlock.java:144-216) + trySpreadingFire (:230-246)
//      runs the same seeded RNG over a fixed wooden house; the engine's B.tick must give the identical block snapshot at fixed ticks.
//   3. RULES: infiniburn (netherrack / magma forever), doFireTick false, rain extinguish, stone floor burn-out.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const DEC = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'block');
if (!existsSync(join(DEC, 'FireBlock.java'))) { console.log('firetablecheck: .decomp missing (FireBlock.java)'); process.exit(1); }
const fireSrc = readFileSync(join(DEC, 'FireBlock.java'), 'utf8');
const blocksSrc = readFileSync(join(DEC, 'Blocks.java'), 'utf8');
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js'], dom: false });
const S = M.States, B = M.Behave, R = M.Reg;

let asserts = 0; const fails = [];
const ok = (c, m) => { asserts++; if (!c) fails.push(m); };

// ── 1. table
function sourceTable() {
  const nameOf = {};
  for (const m of blocksSrc.matchAll(/Block (field_\d+) = register\(\s*"([a-z_0-9]+)"/g)) nameOf[m[1]] = m[2];
  const t = {};
  for (const m of fireSrc.matchAll(/registerFlammableBlock\(Blocks\.(field_\d+), (\d+), (\d+)\)/g)) t[nameOf[m[1]] || m[1]] = [+m[2], +m[3]];
  return t;
}
function engineTable() {
  const t = {};
  for (let b = 0; b < R.names.length; b++) if (S.ignite[b] > 0 || S.burn[b] > 0) t[R.names[b]] = [S.ignite[b], S.burn[b]];
  return t;
}
const hashOf = (t) => createHash('sha256').update(Object.keys(t).sort().map((k) => k + ':' + t[k]).join(';')).digest('hex').slice(0, 16);
function tableVerdict(src, eng) {
  let bad = 0;
  for (const k of new Set([...Object.keys(src), ...Object.keys(eng)])) {
    const a = src[k], b = eng[k];
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1]) bad++;
  }
  return bad;
}
const srcT = sourceTable(), engT = engineTable();
ok(Object.keys(srcT).length >= 130, 'source table parsed ' + Object.keys(srcT).length);
ok(Object.keys(srcT).every((k) => !k.startsWith('field_')), 'every field resolved to a block name');
ok(tableVerdict(srcT, engT) === 0, 'engine table == source table');
for (const [k, v] of [['oak_planks', [5, 20]], ['oak_log', [5, 5]], ['white_wool', [30, 60]], ['tnt', [15, 100]], ['hay_block', [60, 20]], ['bookshelf', [30, 20]], ['vine', [15, 100]], ['coal_block', [5, 5]], ['oak_leaves', [30, 60]], ['white_carpet', [60, 20]]])
  ok(srcT[k] && srcT[k][0] === v[0] && srcT[k][1] === v[1], `source ${k} = ${v}`);
console.log('fire table hash ' + hashOf(srcT) + ' (' + Object.keys(srcT).length + ' blocks) engine ' + hashOf(engT));
ok(hashOf(srcT) === hashOf(engT), 'table hash equal');

// ── mock world + seeded RNG
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const GY = 64, key = (x, y, z) => x + ',' + y + ',' + z;
const stone = S.stateOf('stone'), fireS = S.stateOf('fire');
const nm = (st) => (st === 0 ? 'air' : R.names[S.block[st]]);
const DIRS = [[1, 0, 0], [-1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];

function house() {                               // 5x5x4 oak-planks box, door gap, oak-log corners, wool roof
  const c = [];
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) for (let y = 1; y <= 4; y++) {
    const edge = x === 0 || x === 4 || z === 0 || z === 4;
    let b = null;
    if (y === 4) b = 'white_wool';
    else if (edge) b = (x % 4 === 0 && z % 4 === 0) ? 'oak_log' : (x === 2 && z === 0 && y < 3) ? null : 'oak_planks';
    if (b) c.push([x, y, z, b]);
  }
  return c;
}

function setup(rngSeed, opts = {}) {
  const cells = new Map();
  const w = {
    get: (x, y, z) => cells.get(key(x, y, z)) || 0,
    set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); B.changed(x, y, z); },
    blockLightAt: () => 0, getLight: () => 15 << 4,
  };
  w.getBlock = w.get; w.setBlock = w.set;
  for (let x = -6; x <= 12; x++) for (let z = -6; z <= 12; z++) cells.set(key(x, GY, z), opts.floor ? S.stateOf(opts.floor) : stone);
  B.init(w); B.world = w; if (B.clearSchedule) B.clearSchedule();
  const rng = seeded(rngSeed); B.rng = rng;
  B.isRaining = () => !!opts.rain;
  B.hasRain = (x, y, z) => { if (!opts.rain) return false; for (let yy = y; yy < GY + 12; yy++) { const s = w.get(x, yy, z); if (s !== 0 && nm(s) !== 'fire') return false; } return true; };
  B.highHumidity = () => false; B.difficultyId = () => 2;
  return { cells, w, rng };
}

// ── 2. independent reference of FireBlock.scheduledTick on a plain Map
function reference(cells, rng, startFire, ticks, snapAt, tntLog) {
  const flam = (st) => st !== 0 && srcT[nm(st)] && srcT[nm(st)][0] > 0;
  const burnCh = (st) => (st === 0 ? 0 : (srcT[nm(st)] || [0, 0])[0]);
  const spreadCh = (st) => (st === 0 ? 0 : (srcT[nm(st)] || [0, 0])[1]);
  const get = (x, y, z) => cells.get(key(x, y, z)) || 0;
  const isFire = (st) => st !== 0 && nm(st) === 'fire';
  const sturdyBelow = (x, y, z) => { const b = get(x, y - 1, z); return b !== 0 && nm(b) !== 'fire' && B.faceSturdy(b, 1); };
  const around = (x, y, z) => DIRS.some((d) => flam(get(x + d[0], y + d[1], z + d[2])));
  const canPlace = (x, y, z) => sturdyBelow(x, y, z) || around(x, y, z);
  let time = 0, seq = 0; const q = [];
  const sched = (x, y, z) => q.push({ t: time + 30 + ((rng() * 10) | 0), s: seq++, x, y, z });
  const setAir = (x, y, z) => { cells.delete(key(x, y, z)); neighbours(x, y, z); };
  function neighbours(x, y, z) {
    for (const d of DIRS) { const a = x + d[0], b = y + d[1], c = z + d[2]; if (isFire(get(a, b, c)) && !canPlace(a, b, c)) setAir(a, b, c); }
  }
  function putFire(x, y, z, age) {               // setBlockState(.., 3) of a fire: onBlockAdded, then neighbour updates
    cells.set(key(x, y, z), fireS); ages.set(key(x, y, z), age || 0);
    if (!canPlace(x, y, z)) { setAir(x, y, z); return; }
    sched(x, y, z); neighbours(x, y, z);
  }
  function trySpread(x, y, z, bound, age) {
    const st = get(x, y, z);
    if (((rng() * bound) | 0) < spreadCh(st)) {
      if (((rng() * (age + 10)) | 0) < 5) putFire(x, y, z, Math.min(age + (((rng() * 5) | 0) / 4 | 0), 15)); else setAir(x, y, z);
      if (nm(st) === 'tnt') tntLog.push(time);
    }
  }
  putFire(startFire[0], startFire[1], startFire[2]);
  const snaps = {};
  for (time = 1; time <= ticks; time++) {
    for (;;) {
      q.sort((a, b) => a.t - b.t || a.s - b.s);
      if (!q.length || q[0].t > time) break;
      const e = q.shift();
      if (!isFire(get(e.x, e.y, e.z))) continue;
      const { x, y, z } = e;
      q.push({ t: time + 30 + ((rng() * 10) | 0), s: seq++, x, y, z });
      if (!canPlace(x, y, z)) setAir(x, y, z);
      tickBody(x, y, z);
    }
    if (snapAt.includes(time)) snaps[time] = snapshot(cells);
  }
  return snaps;
  function tickBody(x, y, z) {
    const a = fireAge(x, y, z);
    const nextAge = Math.min(15, a + (((rng() * 3) | 0) / 2 | 0));
    setAge(x, y, z, nextAge);
    if (!around(x, y, z)) {
      if (!sturdyBelow(x, y, z) || a > 3) setAir(x, y, z);
      return;
    }
    if (a === 15 && ((rng() * 4) | 0) === 0 && !flam(get(x, y - 1, z))) { setAir(x, y, z); return; }
    trySpread(x + 1, y, z, 300, a); trySpread(x - 1, y, z, 300, a);
    trySpread(x, y - 1, z, 250, a); trySpread(x, y + 1, z, 250, a);
    trySpread(x, y, z - 1, 300, a); trySpread(x, y, z + 1, 300, a);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) for (let oy = -1; oy <= 4; oy++) {
      if (!ox && !oy && !oz) continue;
      const bound = 100 + (oy > 1 ? (oy - 1) * 100 : 0);
      const cx = x + ox, cy = y + oy, cz = z + oz;
      let ch = 0;
      if (get(cx, cy, cz) === 0) for (const d of DIRS) ch = Math.max(ch, burnCh(get(cx + d[0], cy + d[1], cz + d[2])));
      if (ch <= 0) continue;
      const odds = ((ch + 40 + 2 * 7) / (a + 30)) | 0;
      if (odds > 0 && ((rng() * bound) | 0) <= odds) putFire(cx, cy, cz, Math.min(15, a + (((rng() * 5) | 0) / 4 | 0)));
    }
  }
}
// ages are tracked beside the cells (the reference keeps the fire block, age in a side map)
const ages = new Map();
function fireAge(x, y, z) { return ages.get(key(x, y, z)) || 0; }
function setAge(x, y, z, a) { ages.set(key(x, y, z), a); }
function snapshot(cells) {
  const out = [];
  for (const [k, v] of cells) { if (+k.split(',')[1] > GY) out.push(k + '=' + nm(v)); }
  return out.sort().join('|');
}

const SNAPS = [40, 120, 300, 700, 1500];
function buildHouse(cells) { for (const [x, y, z, b] of house()) cells.set(key(x, GY + y, z), S.stateOf(b)); }
function runPair(seed) {
  ages.clear();
  // reference
  const A = setup(seed); buildHouse(A.cells);
  const tntA = [];
  // placing the first fire draws the schedule delay in both runs
  const refSnaps = reference(A.cells, A.rng, [-1 + 0, GY + 1, 2], 1500, SNAPS, tntA);
  // engine
  ages.clear();
  const E = setup(seed); buildHouse(E.cells);
  const tntE = []; B.onTntPrimed = () => tntE.push(1);
  E.w.set(-1, GY + 1, 2, fireS);
  const engSnaps = {};
  for (let t = 1; t <= 1500; t++) { B.tick(); if (SNAPS.includes(t)) engSnaps[t] = snapshot(E.cells); }
  return { refSnaps, engSnaps };
}

const SEEDS = [11, 222, 3333];
const results = SEEDS.map(runPair);
results.forEach((r, i) => {
  for (const t of SNAPS) ok(r.refSnaps[t] === r.engSnaps[t], `seed ${SEEDS[i]} tick ${t}: house snapshot equal` + (r.refSnaps[t] === r.engSnaps[t] ? '' : ` (ref ${r.refSnaps[t].split('|').length} cells, engine ${r.engSnaps[t].split('|').length})`));
});
const cnt = (s) => s.split('|').filter((x) => x && !x.endsWith('=fire')).length;
console.log('house cells (non-fire) at ticks ' + SNAPS.join('/') + ': ' + SNAPS.map((t) => cnt(results[0].engSnaps[t])).join('/'));
ok(cnt(results[0].engSnaps[1500]) < cnt(results[0].engSnaps[40]), 'the house actually burns down');

// ── 3. rules
function lone(floor, opts = {}) {
  const E = setup(77, { floor, rain: opts.rain });
  if (opts.noTick) B.world.rules = null;
  E.w.set(2, GY + 1, 2, fireS);
  let alive = true;
  for (let t = 0; t < 1200 && alive; t++) { B.tick(); alive = nm(E.w.get(2, GY + 1, 2)) === 'fire'; }
  return alive;
}
ok(lone('netherrack') === true, 'fire on netherrack burns forever (infiniburn)');
ok(lone('magma_block') === true, 'fire on magma_block burns forever (infiniburn)');
ok(lone('stone') === false, 'fire on stone with nothing to burn dies');
ok(lone('netherrack', { rain: true }) === true, 'rain does not put out infiniburn fire');
ok(lone('stone', { rain: true }) === false, 'fire on stone in rain dies');
{ // doFireTick false freezes fire
  const E = setup(5); const C = M.Commands || (M.Commands = {}); const old = C.ruleGet; C.ruleGet = (r) => (r === 'doFireTick' ? 'false' : 'true');
  E.w.set(2, GY + 1, 2, fireS);
  for (let t = 0; t < 400; t++) B.tick();
  ok(nm(E.w.get(2, GY + 1, 2)) === 'fire', 'doFireTick=false: fire never ages out'); C.ruleGet = old;
}
{ // fire with nothing to burn on air: canSurvive false
  const E = setup(5); E.w.set(2, GY + 3, 2, fireS);
  ok(nm(E.w.get(2, GY + 3, 2)) === 'air', 'fire placed in mid-air with no flammable neighbour is removed at once');
}
ok(tableVerdict({ a: [5, 20] }, { a: [5, 21] }) === 1 && tableVerdict({ a: [5, 20] }, {}) === 1, 'table comparator can fail');

// ── anti-vacuity: break our own data and the verdicts must go red
let breaks = 0;
{ const t = { ...engT }; t.oak_planks = [5, 21]; if (tableVerdict(srcT, t) > 0) { breaks++; console.log('  ✓ break caught'); } }
{ const t = { ...engT }; delete t.tnt; if (tableVerdict(srcT, t) > 0) { breaks++; console.log('  ✓ break caught'); } }
{ const t = { ...engT, stone: [5, 5] }; if (tableVerdict(srcT, t) > 0) { breaks++; console.log('  ✓ break caught'); } }
{ const t = { ...engT }; t.hay_block = [61, 20]; if (hashOf(t) !== hashOf(srcT)) { breaks++; console.log('  ✓ break caught'); } }
{ const sn = results[0].engSnaps[700]; const bad = sn.replace(/oak_planks/, 'air'); if (bad !== results[0].refSnaps[700]) { breaks++; console.log('  ✓ break caught'); } }
{ const r2 = runPairSeed(12); if (r2.engSnaps[700] !== results[0].refSnaps[700]) { breaks++; console.log('  ✓ break caught'); } }
function runPairSeed(seed) { return runPair(seed); }
ok(breaks === 6, 'all 6 deliberate breaks detected (' + breaks + ')');

console.log(`firetablecheck: ${asserts} assertions, ${fails.length} failures (${breaks}/6 anti-vacuity breaks caught)`);
console.log(' assertions passed .... ' + (asserts - fails.length));
console.log(' failures ........... ' + fails.length);
console.log(' breaks caught ...... ' + breaks);
for (const f of fails) console.log('  FAIL ' + f);
process.exit(fails.length ? 1 : 0);
