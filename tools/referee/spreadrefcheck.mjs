#!/usr/bin/env node
// spreadrefcheck.mjs — infra I6 (25 Sept 2026): GRASS SPREAD, GRASS UNDER A COVER, PUMPKIN STEMS (growth light, fruit),
// the engine against the REAL 1.18.2 server. The same shape as gaterefcheck.mjs (read its header): the mock world answers
// light with the server's MEASURED block light inside the closed boxes, packed with the sky nibble (0 in a box, 15 in the
// open — World.getLight's raw storage, which has no time of day) in `getLight`, and as `blockLightAt`.
//
//   node tools/referee/runspread.mjs          # once per machine/store (~9 min, the real server)
//   node tools/referee/spreadrefcheck.mjs [--verbose]
//
// Compared per cell, exact, by spreadscen.mjs's buckets: stem STAY/GROW, fruit STAY/FRUIT, grass-target STAY/GROW,
// covered grass STAY/GONE. The golden must itself show vanilla's two lights (a stem grows at midnight in the open, grass
// there does not spread; grass spreads at noon) — a run that lost that is a harness fault, not an engine one.
//
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, SPEED, GY, origin, placements, bucket } from './spreadscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'spread.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'spread.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('spreadrefcheck: SKIP (golden not generated -- run node tools/referee/runspread.mjs)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const T = golden.T;
const SECTION_Y = -64;

function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const stateOf = (S, B, spec) => {
  const m = /^minecraft:([a-z_]+)(?:\[(.*)\])?$/.exec(spec);
  let st = S.stateOf(m[1]); for (const kv of (m[2] ? m[2].split(',') : [])) { const [k, v] = kv.split('='); st = B.setProp(st, k, v); }
  return st;
};

function runEngine(sc, i, { speed = SPEED, lightFn, seed = 0, noSided = false, noFruit = false } = {}) {
  // the REAL Sky at the scenario's phase time (the golden's own `phases[..].time`): the darkness it implies is the engine's
  const M = loadEngine({ extra: ['02f_tags.js', '09b_sky.js', '07b_behaviour.js'], dom: false });
  const S = M.States, B = M.Behave, R = M.Reg;
  if (noSided) M.DATA.sidedLight = {};                                   // break: no block is hasSidedTransparency
  if (noFruit) for (const n of Object.keys(R.id)) if (/^attached_/.test(n)) delete R.id[n];   // break: no attached stem to become
  M.Sky.dayTime = golden.phases[sc.phase].time; M.Sky.weather = M.Sky.newWeather();
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const o = origin(i);
  const g = golden.cases[sc.id];
  const unprobed = new Set();
  // Inside a closed box the block light is PROPAGATED from the scene's own emitters (vanilla's BFS: a step costs
  // max(1, opacity) of the cell entered, S.atten), re-run whenever a block changes — a gourd that lands between the
  // glowstone and a stem darkens it (the server's middle fruit stem stayed at 9 -> 7 behind its neighbour's pumpkin).
  // At tick 0 it must equal the server's MEASURED light at every probe (asserted below: `lightDrift`).
  let dyn = null;
  const inside = (x, y, z) => x > o.x && x < o.x + 15 && z > o.z && z < o.z + 15 && y > GY && y < GY + 5;
  const propagate = () => {
    dyn = new Map(); const q = [];
    for (let x = o.x + 1; x < o.x + 15; x++) for (let y = GY + 1; y < GY + 5; y++) for (let z = o.z + 1; z < o.z + 15; z++) {
      const e = S.emit[w.get(x, y, z)]; if (e > 0) { dyn.set(key(x, y, z), e); q.push([x, y, z, e]); }
    }
    while (q.length) {
      const [x, y, z, l] = q.shift();
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = x + dx, ny = y + dy, nz = z + dz; if (!inside(nx, ny, nz)) continue;
        const a = S.atten[w.get(nx, ny, nz)]; if (a >= 15) continue;
        const nl = l - Math.max(1, a); if (nl <= 0 || (dyn.get(key(nx, ny, nz)) || 0) >= nl) continue;
        dyn.set(key(nx, ny, nz), nl); q.push([nx, ny, nz, nl]);
      }
    }
  };
  const blockLight = (x, y, z) => {
    if (!sc.box) return 0;                                    // no source within 24 blocks (checked: the open floor reads the sky only)
    if (inside(x, y, z)) { if (!dyn) propagate(); return dyn.get(key(x, y, z)) || 0; }
    const k = `${x - o.x},${y - GY},${z - o.z}`;
    if (k in g.light) return g.light[k];
    unprobed.add(k); return 0;
  };
  const bl = lightFn ? lightFn(blockLight) : blockLight;
  const w = {
    get: (x, y, z) => cells.get(key(x, y, z)) || 0,
    set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); dyn = null; B.changed(x, y, z); },
    blockLightAt: (x, y, z) => bl(x, y, z),
    getLight: (x, y, z) => ((sc.box ? 0 : 15) << 4) | bl(x, y, z),
  };
  w.getBlock = w.get; w.setBlock = w.set;
  const stone = S.stateOf('stone'), grass = S.stateOf('grass_block'), dirt = S.stateOf('dirt');
  for (let x = o.x - 4; x <= o.x + 19; x++) for (let z = o.z - 4; z <= o.z + 19; z++) { cells.set(key(x, GY, z), grass); cells.set(key(x, GY - 1, z), dirt); }
  for (let x = 0; x <= 15; x++) for (let z = 0; z <= 15; z++) {
    cells.set(key(o.x + x, GY, o.z + z), stone);
    if (sc.box) for (let dy = 1; dy <= 5; dy++) if (dy === 5 || x === 0 || x === 15 || z === 0 || z === 15) cells.set(key(o.x + x, GY + dy, o.z + z), stone);
  }
  B.init(w); B.world = w;
  if (B.clearSchedule) B.clearSchedule();
  for (const [b, [x, dy, z]] of placements(sc)) cells.set(key(o.x + x, GY + dy, o.z + z), stateOf(S, B, b));
  const cls = (st) => {
    if (st === 0) return ['air', {}];
    const n = R.names[S.block[st]];
    const a = S.propValue(st, R.PROP.age);
    return [n, a >= 0 && /stem/.test(n) ? { age: +R.valueNames[a] } : {}];
  };
  const peek = ([x, dy, z]) => cls(w.get(o.x + x, GY + dy, o.z + z));
  const lightDrift = [];
  if (sc.box) for (const k of Object.keys(g.light)) {
    const [x, dy, z] = k.split(',').map(Number);
    if (inside(o.x + x, GY + dy, o.z + z) && blockLight(o.x + x, GY + dy, o.z + z) !== g.light[k]) lightDrift.push(`${k} ${blockLight(o.x + x, GY + dy, o.z + z)}/${g.light[k]}`);
  }
  // a cell whose OWN light crosses the growth gate (9) during the run was in a race with a neighbour's gourd
  const lit0 = sc.box ? sc.cells.map(([x, dy, z]) => blockLight(o.x + x, GY + dy, o.z + z) >= 9) : null;
  const RNG = seeded(0x5b2e + 7919 * i + 104729 * seed);
  for (let k = 1; k <= T; k++) {
    B.tick();
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, speed);
  }
  const raced = sc.cells.map(([x, dy, z], j) => !!lit0 && lit0[j] !== (blockLight(o.x + x, GY + dy, o.z + z) >= 9));
  return { final: sc.cells.map(peek), unprobed: [...unprobed], lightDrift, raced };
}

const bk = (sc, f) => f.map(([n, p]) => bucket(sc, n, p));
const RACE_SEEDS = 16, raceCache = new Map(), raceNotes = new Set();
const raceRuns = (sc, i, k) => { const id = sc.id + '#' + k; if (!raceCache.has(id)) raceCache.set(id, runEngine(sc, i, { seed: k })); return raceCache.get(id); };

function compare(eng, { quiet } = {}) {
  const f = [];
  SCENARIOS.forEach((sc, i) => {
    const g = golden.cases[sc.id], e = eng[i];
    if (!g) { f.push(`${sc.id}: missing from golden`); return; }
    if (e.lightDrift && e.lightDrift.length) f.push(`${sc.id}: HARNESS — propagated light != the server's measured at ${e.lightDrift.length} probes (${e.lightDrift.slice(0, 4).join(' ')})`);
    if (e.unprobed.length) f.push(`${sc.id}: HARNESS — the engine asked the light at unmeasured ${e.unprobed.slice(0, 4).join(' ')}`);
    const gb = bk(sc, g.final), eb = bk(sc, e.final);
    // A RACED cell (its light crossed 9 in this run, or in the server's reachable outcomes) is decided by which gourd
    // lands first — one server run is one draw. It passes when the server's bucket is reached in any of RACE_SEEDS
    // engine seeds (and the base seed's run itself must have seen the race); every other cell is exact.
    const bad = sc.cells.map((c, j) => {
      if (eb[j] === gb[j]) return null;
      if (!sc.box || sc.kind !== 'fruit') return j;
      for (let k = 1; k <= RACE_SEEDS; k++) {
        const r = raceRuns(sc, i, k);
        if (r.raced[j] && bucket(sc, ...r.final[j]) === gb[j]) { raceNotes.add(`${sc.id} (${sc.cells[j].join(',')}): raced cell, server's ${gb[j]} reached at engine seed ${k}`); return null; }
      }
      return j;
    }).filter((j) => j !== null);
    if (bad.length) {
      const j = bad[0], [x, dy, z] = sc.cells[j];
      const lit = sc.box ? `block light ${g.light[`${x},${dy},${z}`]}, above ${g.light[`${x},${dy + 1},${z}`]} (closed box)` : `open sky, ${golden.phases[sc.phase].time === 6000 ? 'noon' : 'midnight'}${sc.cover ? ', under ' + sc.cover : ''}`;
      f.push(`${sc.id}: ${bad.length}/${sc.cells.length} cells wrong — (${x},${dy},${z}) ${lit}: engine ${eb[j]} (${e.final[j][0]}), server ${gb[j]} (${g.final[j][0]})`);
    }
    if (VERBOSE && !quiet) console.log(`  ${sc.id.padEnd(12)} server ${gb.join(' ')}\n  ${''.padEnd(12)} engine ${eb.join(' ')}`);
  });
  return f;
}

let pass = 0;
const fails = [];
if (golden.notes && golden.notes.length) fails.push('golden has notes: ' + golden.notes.join('; ')); else pass++;
for (const P of ['A', 'B']) { if (golden.phases[P] && golden.phases[P].ticks >= T) pass++; else fails.push(`HARNESS — phase ${P} ran ${golden.phases[P] && golden.phases[P].ticks}/${T} ticks`); }
// the clock: midnight's open sky reads < 9, noon's reads 15 (the location predicate's light IS getLightLevel, dimmed)
if (golden.phases.A.floor < 9 && golden.phases.B.floor === 15) pass++; else fails.push(`HARNESS — sky floors A ${golden.phases.A.floor} (want < 9), B ${golden.phases.B.floor} (want 15)`);
{ // vanilla's own two lights, as the server answered
  const b = (id) => (golden.cases[id] ? bk(SCENARIOS.find((s) => s.id === id), golden.cases[id].final) : []);
  const all = (id, v) => b(id).length && b(id).every((x) => x === v);
  if (all('stem-night', 'GROW') && all('grass-night', 'STAY') && all('grass-noon', 'GROW') && all('cover-glass', 'STAY')) pass++;
  else fails.push('HARNESS — the golden lost vanilla\'s own lights: stem-night ' + b('stem-night') + ' | grass-night ' + b('grass-night') + ' | grass-noon ' + b('grass-noon') + ' | cover-glass ' + b('cover-glass'));
}

const eng = SCENARIOS.map((sc, i) => runEngine(sc, i));
const main = compare(eng);
if (main.length) fails.push(...main); else pass++;

// anti-vacuity (D-30/D-305): each break must add a failure the unbroken run does not have
let breaks = 0;
const base = new Set(main);
const breakCaught = (name, opts, pick) => {
  const runs = SCENARIOS.map((sc, i) => (pick && !pick(sc)) ? eng[i] : runEngine(sc, i, opts));
  if (compare(runs, { quiet: true }).some((m) => !base.has(m))) { breaks++; pass++; } else fails.push(`anti-vacuity: "${name}" was NOT caught`);
};
breakCaught('every block light +4', { lightFn: (f) => (x, y, z) => Math.min(15, f(x, y, z) + 4) }, (sc) => sc.box);
breakCaught('every block light -4', { lightFn: (f) => (x, y, z) => Math.max(0, f(x, y, z) - 4) }, (sc) => sc.box);
breakCaught('no random ticks at all', { speed: 0 });
breakCaught('stems never fruit (StemBlock age-7 branch gone)', { noFruit: true }, (sc) => sc.kind === 'fruit');
breakCaught('no sided transparency (getRealisticOpacity = plain opacity)', { noSided: true }, (sc) => sc.kind === 'cover');

for (const n of raceNotes) console.log('  note ' + n);
console.log(`spreadrefcheck: ${pass} passed, ${fails.length} failed (${breaks}/5 anti-vacuity breaks caught) [golden ${golden.generatedAt}]`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
