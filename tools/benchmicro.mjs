// tools/benchmicro.mjs — deterministic CPU microbenchmark for the perf budget (#7770): chunk generation.
//   node tools/benchmicro.mjs [--json out.json] [--reps 5] [--spread 10]
// Fixed seed, fixed 7x7 chunk area, inline on one thread (node, no browser). Reports the MIN over reps of
// ms per chunk (min, not mean: scheduler noise only ever adds time). Output has the bench.mjs shape
// ({runs:[{label, <bench>:n}]}) so `benchbudget.mjs record` takes it unchanged. --spread N runs the whole
// measurement N times and prints the run-to-run spread (the rule: over 10% means rewrite or drop).
import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
import { spread } from './benchbudget.mjs';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const REPS = Number(flag('--reps', 5)), SEED = 1337, R = 3;

const M = loadEngine({ extra: ['07_world.js', '08_lighting.js'] });
function once() {
  let best = Infinity;
  for (let rep = 0; rep < REPS; rep++) {
    M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
    const t0 = performance.now();
    for (let cz = -R; cz <= R; cz++) for (let cx = -R; cx <= R; cx++) M.Gen.genColumn(cx, cz);
    best = Math.min(best, (performance.now() - t0) / ((2 * R + 1) ** 2));
  }
  return +best.toFixed(3);
}
// remesh: the centre 3x3 columns of a generated 5x5 area, every non-empty section, through the real snapshot path
function remeshSetup() {
  M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
  M.World.init(SEED); M.Light.init(); M.Light.setAdapter(M.Light.worldAdapter());
  M.Mesher.setOptions({ ao: true, cross: true, fastLeaves: false, realModels: true, smooth: true });
  for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
    const col = M.Gen.genColumn(cx, cz), c = M.World.getOrCreate(cx, cz);
    for (let i = 0; i < col.sec.length; i++) c.sec[i] = col.sec[i];
    c.state = M.CH.GENERATED;
  }
}
function remeshOnce() {
  let best = Infinity, n = 0;
  for (let rep = 0; rep < REPS; rep++) {
    n = 0; const t0 = performance.now();
    for (let cz = -1; cz <= 1; cz++) for (let cx = -1; cx <= 1; cx++) for (let sy = 0; sy < M.CFG.SECTIONS_Y; sy++) {
      if (M.World.get(cx, cz).sec[sy].u === 0) continue;
      const snap = M.World.snapshotFor(cx, cz, sy); M.Mesher.mesh(snap, null, cx * 16, sy * 16 + M.CFG.WORLD_MIN_Y, cz * 16); M.World.releaseSnap(snap); n++;
    }
    best = Math.min(best, (performance.now() - t0) / n);
  }
  return +best.toFixed(3);
}
// entity tick: 60 mobs (5 types) on a generated 5x5 area, EntityList.tick x60 from a fresh spawn each rep, ms per tick
const E = loadEngine({ extra: ['16_settings.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '08_lighting.js'], dom: false });
initRegistry(E);
E.DATA = Object.assign({}, E.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
E.Entities.init(); E.Gen.init(SEED, Object.assign(E.Gen.defaults(), { climate: 'vanilla' })); E.World.init(SEED); E.EntityList.init();
for (let cz = -2; cz <= 2; cz++) for (let cx = -2; cx <= 2; cx++) {
  const col = E.Gen.genColumn(cx, cz), c = E.World.getOrCreate(cx, cz);
  for (let i = 0; i < col.sec.length; i++) c.sec[i] = col.sec[i];
  c.state = E.CH.GENERATED;
}
E.World.camCx = 0; E.World.camCz = 0;
function entityOnce() {
  const EL = E.EntityList, types = ['zombie', 'cow', 'skeleton', 'pig', 'creeper'], T = 60;
  let best = Infinity;
  for (let rep = 0; rep < REPS; rep++) {
    EL.clear();
    for (let i = 0; i < 60; i++) EL.spawn(types[i % 5], (i % 10) * 3 - 12 + 0.5, 120, Math.floor(i / 10) * 3 - 9 + 0.5);
    const t0 = performance.now();
    for (let k = 0; k < T; k++) EL.tick();
    best = Math.min(best, (performance.now() - t0) / T);
  }
  return +best.toFixed(3);
}
remeshSetup();
const once2 = remeshOnce;
for (let i = 0; i < 4; i++) { once(); once2(); entityOnce(); }   // warm the JIT: first passes run 30% slow
const N = Number(flag('--spread', 0));
if (N) {
  let bad = false;
  for (const [name, fn] of [['genMsPerChunk', once], ['remeshMsPerSection', once2], ['entityTickMs60', entityOnce]]) {
    const v = Array.from({ length: N }, fn), sp = spread(v);
    console.log(name + ' x' + N + ': ' + v.join(' ') + '  spread ' + (sp * 100).toFixed(1) + '%' + (sp > 0.10 ? '  UNSTABLE (>10%)' : ''));
    if (sp > 0.10) bad = true;
  }
  process.exit(bad ? 4 : 0);
}
const out = { runs: [{ label: 'micro', genMsPerChunk: once(), remeshMsPerSection: (M.Gen.init(SEED, Object.assign(M.Gen.defaults(), { climate: 'vanilla' })), once2()), entityTickMs60: entityOnce() }] };
console.log('genMsPerChunk ' + out.runs[0].genMsPerChunk + '  remeshMsPerSection ' + out.runs[0].remeshMsPerSection + '  entityTickMs60 ' + out.runs[0].entityTickMs60);
if (flag('--json', null)) writeFileSync(flag('--json'), JSON.stringify(out));
