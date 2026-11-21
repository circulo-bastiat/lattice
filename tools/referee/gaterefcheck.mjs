#!/usr/bin/env node
// gaterefcheck.mjs — infra I6 (25 Sept 2026): LIGHT-GATED GROWTH (wheat, oak sapling), the engine against the REAL 1.18.2
// server. The same shape as meltrefcheck.mjs (read its header): the mock world answers light with the server's MEASURED
// block light, as `blockLightAt` AND packed with the sky (0 in a closed box, 15 in the open) in `getLight`.
//
//   node tools/referee/rungate.mjs            # once per machine/store (~6 min, the real server)
//   node tools/referee/gaterefcheck.mjs [--verbose]
//
// Compared per cell, exact: STAY (wheat age 0 / sapling stage 0), GROW (age > 0 / stage 1 / a tree), GONE (air).
// The golden itself must show vanilla's two different lights: wheat grows at midnight in the open (getBaseLightLevel, sky
// undimmed) while a sapling there does not (getLightLevel above it, the night sky) — a run that lost that is a harness fault.
// (The join half — World's light reaching Behave at all — is meltrefcheck's part A; not repeated here.)
//
// No golden -> SKIP.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENARIOS, SPEED, EVERY, GY, NIGHT, origin, cellBlock, groundBlock } from './gatescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'light-gate.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'light-gate.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('gaterefcheck: SKIP (golden not generated -- run node tools/referee/rungate.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
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

// ── B. the rule ──────────────────────────────────────────────────────────────────────────────────────────────────────
function runEngine(sc, i, { speed = SPEED, lightFn } = {}) {
  // The REAL World (its `canSurvive`, the crop light rule 15) and the REAL Sky (midnight darkness) — the golden ran at
  // NIGHT, clear, the whole run; the time is the scenario's, the darkness it implies is the engine's own.
  const M = loadEngine({ extra: ['02f_tags.js', '03_section.js', '07_world.js', '09b_sky.js', '07b_behaviour.js'], dom: false });
  const S = M.States, B = M.Behave, R = M.Reg, W = M.World;
  M.Sky.dayTime = NIGHT; M.Sky.weather = M.Sky.newWeather();
  const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const o = origin(i);
  const g = golden.cases[sc.id];
  const unprobed = new Set();
  const blockLight = (x, y, z) => {
    if (!sc.box) return 0;                                    // no source within 24 blocks (checked below: reading <= floor)
    const k = `${x - o.x},${y - GY},${z - o.z}`;
    if (k in g.light) return g.light[k];
    unprobed.add(k); return 0;
  };
  const bl = lightFn ? lightFn(blockLight) : blockLight;
  // sky: 0 under the box's roof (dy 5), 15 everywhere else — construction, not a number the game owns
  const skyAt = (y) => (sc.box && y <= GY + 5 ? 0 : 15);
  // `World.setBlock`'s survival cascade (07_world.js cascadeFrom): a changed cell re-judges its six neighbours with the
  // World's own `canSurvive` — the path that pops a crop in the dark when its farmland dries (a shape update in vanilla).
  const judge = (x, y, z) => {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const st = w.get(x + dx, y + dy, z + dz);
      if (st && (S.support[st] || (S.rule && S.rule[st])) && !W.canSurvive(x + dx, y + dy, z + dz, st)) w.set(x + dx, y + dy, z + dz, 0);
    }
  };
  const w = {
    get: (x, y, z) => cells.get(key(x, y, z)) || 0,
    set: (x, y, z, s) => { if (s === 0) cells.delete(key(x, y, z)); else cells.set(key(x, y, z), s); B.changed(x, y, z); if (settled) judge(x, y, z); },
    blockLightAt: (x, y, z) => bl(x, y, z),
    getLight: (x, y, z) => (y > GY + 5 ? 15 << 4 : (skyAt(y) << 4) | bl(x, y, z)),   // above the roof: canSeeSky's "top" probe
  };
  let settled = false;
  W.getBlock = w.get; W.getLight = w.getLight; W.loadedAt = () => true;   // every mock cell is "loaded"
  w.getBlock = w.get; w.setBlock = w.set;
  const floor = S.stateOf(sc.box ? 'stone' : 'grass_block');
  for (let x = o.x - 1; x <= o.x + 16; x++) for (let z = o.z - 1; z <= o.z + 16; z++) { cells.set(key(x, GY, z), floor); cells.set(key(x, GY - 1, z), S.stateOf('dirt')); }
  if (sc.box) {
    const stone = S.stateOf('stone');
    for (let x = 0; x <= 15; x++) for (let z = 0; z <= 15; z++) for (let dy = 1; dy <= 5; dy++)
      if (dy === 5 || x === 0 || x === 15 || z === 0 || z === 15) cells.set(key(o.x + x, GY + dy, o.z + z), stone);
  }
  B.init(w); B.world = w;
  if (B.clearSchedule) B.clearSchedule();
  for (const [b, [x, dy, z]] of sc.src) cells.set(key(o.x + x, GY + dy, o.z + z), stateOf(S, B, b));
  const cell = stateOf(S, B, cellBlock(sc)), ground = stateOf(S, B, groundBlock(sc));
  for (const [x, dy, z] of sc.cells) { w.set(o.x + x, GY + dy - 1, o.z + z, ground); w.set(o.x + x, GY + dy, o.z + z, cell); }
  settled = true;                                             // the server placed every cell before the clock (setblock)
  const cls = (st) => {
    if (st === 0) return 'air';
    const n = R.names[S.block[st]];
    if (n === 'wheat') return 'a' + R.valueNames[S.propValue(st, R.PROP.age)];
    if (n === 'oak_sapling') return 's' + R.valueNames[S.propValue(st, R.PROP.stage)];
    if (n === 'oak_log') return 'log';
    return 'other:' + n;
  };
  const peek = ([x, dy, z]) => cls(w.get(o.x + x, GY + dy, o.z + z));
  const RNG = seeded(0x3e17 + 7919 * i);
  const alive = [];
  for (let k = 1; k <= T; k++) {
    if (k % EVERY === 0) alive.push(sc.cells.filter((c) => peek(c) === 'a0' || peek(c) === 's0').length);
    B.tick();
    B.randomTickSection(o.x, SECTION_Y, o.z, RNG, speed);
  }
  return { alive, final: sc.cells.map(peek), unprobed: [...unprobed] };
}

const bucket = (c) => c === 'a0' || c === 's0' ? 'STAY' : c === 'air' ? 'GONE' : /^a[1-7]$|^s1$|^log$/.test(c) ? 'GROW' : 'OTHER(' + c + ')';

function compare(eng, { quiet } = {}) {
  const f = [];
  SCENARIOS.forEach((sc, i) => {
    const g = golden.cases[sc.id], e = eng[i];
    if (!g) { f.push(`${sc.id}: missing from golden`); return; }
    if (e.unprobed.length) f.push(`${sc.id}: HARNESS — the engine asked the light at unmeasured ${e.unprobed.slice(0, 4).join(' ')}`);
    const gb = g.final.map(bucket), eb = e.final.map(bucket);
    const bad = sc.cells.map((c, j) => eb[j] === gb[j] ? null : j).filter((j) => j !== null);
    if (bad.length) {
      const j = bad[0], [x, dy, z] = sc.cells[j];
      f.push(`${sc.id}: ${bad.length}/${sc.cells.length} cells wrong — (${x},${dy},${z}) block light ${sc.box ? g.light[`${x},${dy},${z}`] : 0} (${sc.box ? 'closed box' : 'open sky, midnight'}), above ${sc.box ? g.light[`${x},${dy + 1},${z}`] : 0}: engine ${eb[j]} (${e.final[j]}), server ${gb[j]} (${g.final[j]})`);
    }
    if (VERBOSE && !quiet) console.log(`  ${sc.id.padEnd(13)} server ${gb.join(' ')}\n  ${''.padEnd(13)} engine ${eb.join(' ')}`);
  });
  return f;
}

let pass = 0;
const fails = [];
// the golden itself: no notes; the open scenes carry no block light (every night reading at or under the sky floor);
// vanilla's rule reproduced by the server's own answers (a harness that lost a scene's ticks would break this)
if (golden.notes && golden.notes.length) fails.push('golden has notes: ' + golden.notes.join('; ')); else pass++;
for (const sc of SCENARIOS) {
  const g = golden.cases[sc.id];
  if (!g) continue;
  if (!sc.box && Object.values(g.light).some((v) => v > g.floor)) fails.push(`${sc.id}: HARNESS — an open scene reads light above the night sky (${g.floor})`); else pass++;
}
{ // vanilla's own two lights, as the server answered (a lost scene or a daytime run would fail here, not in the engine)
  const b = (id) => (golden.cases[id] ? golden.cases[id].final.map(bucket) : []);
  if (b('wheat-night').length && b('wheat-night').every((x) => x === 'GROW') && b('sapling-night').every((x) => x === 'STAY')) pass++;
  else fails.push('HARNESS — the golden does not show wheat growing / saplings resting at midnight in the open: ' + b('wheat-night').join(',') + ' | ' + b('sapling-night').join(','));
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

console.log(`gaterefcheck: ${pass} passed, ${fails.length} failed (${breaks}/3 anti-vacuity breaks caught) [golden ${golden.generatedAt}]`);
for (const f of fails) console.log('  FAIL ' + f);
console.log(` assertions passed .... ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
