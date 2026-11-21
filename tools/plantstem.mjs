#!/usr/bin/env node
// plantstem.mjs — #305 (G24b): AbstractPlantStemBlock growth for kelp, twisting vines, weeping vines and cave
// vines (src/07b_behaviour.js), against .decomp's AbstractPlantStemBlock / AbstractPlantBlock / KelpBlock /
// TwistingVinesBlock / WeepingVinesBlock / CaveVinesHeadBlock / CaveVinesBodyBlock / VineLogic / CaveVines.
//
//   1. growthChance and growth direction are READ from the .decomp constructors, and a roll just under / just
//      over each chance grows / does not grow the head into the right cell.
//   2. AGE 25 STOPS GROWTH: a head random-ticked with a roll that always passes builds a column of exactly
//      26 cells (age 0..25) under open water/air, and the age-25 head then refuses every tick.
//   3. The head/body swap (getStateForNeighborUpdate): after every growth the old head is the `_plant` body,
//      only the tip is the head; breaking the tip turns the body behind it into a head at a random age 0..24.
//   4. chooseStemState: kelp only into water, the vines only into air; cave vines' age() rolls BERRIES < 0.11.
//   5. Fertilizable: VineLogic.getGrowthLength on a pinned roll sequence, a body finding its head
//      (BlockLocating.findColumnEnd), min(age+1, 25), cave vines' berries, isFertilizable at a blocked end.
//   6. CaveVines.pickBerries through Use.blockUse: one glow_berries, BERRIES=false; no berries PASSes.
// Anti-vacuity ('<n> breaks caught'): the age cap removed, the neighbour update skipped (no swap), the growth
// chance doubled and the VineLogic factor changed must each be seen by the assertions above.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) console.log('   ✓ break caught: ' + m); else fails.push('anti-vacuity: ' + m); };

console.log('plantstem — #305 (G24b), AbstractPlantStemBlock: kelp, twisting/weeping vines, cave vines');
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '14l_use.js'], dom: false });
const R = M.Reg, S = M.States, B = M.Behave;

// ── the vanilla facts, parsed from .decomp (never typed in here) ───────────────────────────
const DEC = join(MCLITE_ROOT, '.decomp', 'net', 'minecraft', 'block');
const src = (f) => readFileSync(join(DEC, f + '.java'), 'utf8');
function ctor(cls) {
  const m = /super\(\$\$0, Direction\.(field_\d+), [A-Z_]+, (true|false), ([\d.]+)\)/.exec(src(cls));
  return { dir: m[1] === 'field_11036' ? 1 : m[1] === 'field_11033' ? -1 : 0, chance: +m[3] };
}
const FAM = [
  { head: 'kelp', body: 'kelp_plant', cls: 'KelpBlock', into: 'water' },
  { head: 'twisting_vines', body: 'twisting_vines_plant', cls: 'TwistingVinesBlock', into: 'air' },
  { head: 'weeping_vines', body: 'weeping_vines_plant', cls: 'WeepingVinesBlock', into: 'air' },
  { head: 'cave_vines', body: 'cave_vines_plant', cls: 'CaveVinesHeadBlock', into: 'air' },
];
for (const f of FAM) Object.assign(f, ctor(f.cls));
const MAX_AGE = +/MAX_AGE = (\d+);/.exec(src('AbstractPlantStemBlock'))[1];
const BERRY = +/GROW_CHANCE = ([\d.]+)F;/.exec(src('CaveVinesHeadBlock'))[1];
const VINE_F = +/field_31198 = ([\d.]+);/.exec(src('VineLogic'))[1];
ok(FAM.every((f) => f.dir !== 0 && f.chance > 0) && MAX_AGE === 25 && BERRY > 0 && VINE_F > 0 && VINE_F < 1,
  `parsed from .decomp: ${FAM.map((f) => f.head + ' ' + (f.dir > 0 ? 'up' : 'down') + ' ' + f.chance).join(', ')}; MAX_AGE ${MAX_AGE}, berries ${BERRY}, VineLogic ${VINE_F}`);

// ── the world: setBlock calls Behave.changed with the replaced state, as World.setBlock does ──
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
let notify = true;
const world = {
  getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0,
  setBlock(x, y, z, s) { const old = world.getBlock(x, y, z); if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); if (notify) B.changed(x, y, z, old); return true; },
  blockLightAt: () => 15,
};
B.init(world);
M.Use.init(world);
ok(B.ready && M.Use.ready, 'Behave and Use are ready');
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
const nameOf = (s) => s ? R.names[S.block[s]] : 'air';
const ageOf = (s) => +B.propName(s, 'age');
const WATER = def('water'), STONE = def('stone');
const fixed = (v) => () => v;
const seq = (a) => { let i = 0; return () => a[i++ % a.length]; };

// one column along y from the anchor at y=0; the plant starts at y=dir; open medium for 40 cells
function setupColumn(f, age) {
  cells.clear(); notify = false;
  world.setBlock(0, 0, 0, STONE);
  if (f.into === 'water') for (let i = 1; i <= 40; i++) world.setBlock(0, f.dir * i, 0, WATER);
  world.setBlock(0, f.dir, 0, B.setProp(def(f.head), 'age', age));
  notify = true;
}
function headY(f) { let y = f.dir; while (S.block[world.getBlock(0, y + f.dir, 0)] === R.id[f.head] || S.block[world.getBlock(0, y + f.dir, 0)] === R.id[f.body]) y += f.dir; return y; }
function columnOf(f) { const out = []; for (let y = f.dir; ; y += f.dir) { const n = nameOf(world.getBlock(0, y, 0)); if (n !== f.head && n !== f.body) return out; out.push(n); } }
// tick the tip until it refuses 5 ticks in a row (or 100 ticks): the "always passes" growth roll
function growOut(f) { let refused = 0; for (let t = 0; t < 100 && refused < 5; t++) { if (B.randomTick(0, headY(f), 0, fixed(0))) refused = 0; else refused++; } return columnOf(f); }

// ── 1. growthChance and direction ────────────────────────────────────────────────────────
function chanceSeen(f) {
  setupColumn(f, 0);
  const lo = B.randomTick(0, f.dir, 0, fixed(f.chance - 1e-9));
  const grewRight = nameOf(world.getBlock(0, 2 * f.dir, 0)) === f.head;
  setupColumn(f, 0);
  const hi = B.randomTick(0, f.dir, 0, fixed(f.chance));
  return lo && grewRight && !hi;
}
for (const f of FAM) ok(chanceSeen(f), `${f.head}: nextDouble() < ${f.chance} grows ${f.dir > 0 ? 'up' : 'down'}, = ${f.chance} does not`);
ok(B.hasRandomTick(def('kelp')) && !B.hasRandomTick(def('kelp_plant')), 'the head random-ticks, the body does not');

// ── 2 + 3. age 25 stops growth; the head/body swap ─────────────────────────────────────────
function capAndSwap(f) {
  setupColumn(f, 0);
  const col = growOut(f);
  const tip = world.getBlock(0, headY(f), 0);
  return { col, len: col.length, tipAge: ageOf(tip), heads: col.filter((n) => n === f.head).length, lastIsHead: col[col.length - 1] === f.head };
}
const capRuns = FAM.map(capAndSwap);
FAM.forEach((f, i) => {
  const r = capRuns[i];
  ok(r.len === MAX_AGE + 1 && r.tipAge === MAX_AGE, `${f.head}: from age 0 the column stops at ${MAX_AGE + 1} cells with the tip at age ${MAX_AGE} (got ${r.len}, tip age ${r.tipAge})`);
  ok(r.heads === 1 && r.lastIsHead, `${f.head}: every cell behind the tip is ${f.body}, only the tip is ${f.head} (heads ${r.heads})`);
});
{ // an age-24 head grows exactly once
  const f = FAM[2]; setupColumn(f, 24);
  ok(growOut(f).length === 2, 'weeping_vines at age 24 grows one cell, then its age-25 tip stops');
}
{ // breaking the tip: the body behind it becomes a head at getRandomGrowthState's random age
  const f = FAM[0]; setupColumn(f, 20); growOut(f);
  const tipY = headY(f);
  B.rng = fixed(0.5);
  world.setBlock(0, tipY, 0, WATER);
  B.rng = undefined;
  const nb = world.getBlock(0, tipY - f.dir, 0);
  ok(nameOf(nb) === f.head && ageOf(nb) === 12, `kelp: the tip replaced by water turns the body behind into kelp at nextInt(25) = 12 (got ${nameOf(nb)} age ${ageOf(nb)})`);
  // placement: a head placed with its column beyond it becomes the body; alone, it takes a random age
  B.rng = fixed(0.99);
  const placedAlone = B.place(def('kelp'), 5, 5, 5);
  B.rng = undefined;
  ok(nameOf(placedAlone) === 'kelp' && ageOf(placedAlone) === 24, `a lone placed kelp takes getRandomGrowthState (age ${ageOf(placedAlone)})`);
  ok(nameOf(B.place(def('kelp'), 0, f.dir, 0)) === 'kelp_plant', 'kelp placed under its own column is placed as kelp_plant');
}

// ── 4. chooseStemState, cave vines berries ─────────────────────────────────────────────────
{
  const k = FAM[0]; cells.clear(); world.setBlock(0, 0, 0, STONE); world.setBlock(0, 1, 0, def('kelp'));
  ok(!B.randomTick(0, 1, 0, fixed(0)), 'kelp does not grow into air');
  const v = FAM[1]; setupColumn(v, 0); world.setBlock(0, 2, 0, WATER);
  ok(!B.randomTick(0, 1, 0, fixed(0)), 'twisting_vines does not grow into water');
  const c = FAM[3];
  setupColumn(c, 3); B.randomTick(0, -1, 0, seq([0, BERRY - 1e-6]));
  const withB = world.getBlock(0, -2, 0);
  setupColumn(c, 3); B.randomTick(0, -1, 0, seq([0, BERRY]));
  const noB = world.getBlock(0, -2, 0);
  ok(B.propName(withB, 'berries') === 'true' && ageOf(withB) === 4 && B.propName(noB, 'berries') === 'false',
    `cave_vines: age() is cycle(AGE) with BERRIES = nextFloat() < ${BERRY}`);
  // the body keeps its berries across the swap (copyState)
  setupColumn(c, 3); world.setBlock(0, -1, 0, B.setProp(world.getBlock(0, -1, 0), 'berries', true));
  B.randomTick(0, -1, 0, seq([0, 0.9]));
  const bodyB = world.getBlock(0, -1, 0);
  ok(nameOf(bodyB) === 'cave_vines_plant' && B.propName(bodyB, 'berries') === 'true', 'cave_vines: the head that became cave_vines_plant kept BERRIES=true');
}

// ── 5. Fertilizable (the bone-meal unit's grow) ─────────────────────────────────────────────
function vineLen(rolls, factor) { let p = 1, n = 0, i = 0; while (rolls[i++] < p) { n++; p *= factor; } return n; }
const ROLLS = [0.5, 0.8, 0.6, 0.9, 0.1];
const expectLen = vineLen(ROLLS, VINE_F); // re-derived from VineLogic.getGrowthLength
function boneMealWeeping() {
  const f = FAM[2]; setupColumn(f, 22);
  B.randomTick(0, -1, 0, fixed(0));          // two cells: body at -1, head (age 23) at -2
  const fert = B.plantStemFertilizable(0, -1, 0);
  B.plantStemGrow(0, -1, 0, seq(ROLLS));      // bone meal on the BODY finds the head
  const col = columnOf(f), tip = world.getBlock(0, headY(f), 0);
  return { fert, grown: col.length - 2, tipAge: ageOf(tip), heads: col.filter((n) => n === f.head).length };
}
{
  const r = boneMealWeeping();
  ok(r.fert && r.grown === expectLen && expectLen >= 2, `weeping_vines bone meal: VineLogic length ${expectLen} on the pinned rolls (grew ${r.grown})`);
  ok(r.tipAge === Math.min(23 + expectLen, MAX_AGE) && r.heads === 1, `weeping_vines bone meal: ages min(age+1, ${MAX_AGE}) with one head (tip ${r.tipAge})`);
  const k = FAM[0]; setupColumn(k, 3); B.plantStemGrow(0, 1, 0, seq(ROLLS));
  ok(columnOf(k).length === 2, 'kelp bone meal: getGrowthLength is 1');
  setupColumn(k, 3); world.setBlock(0, 2, 0, STONE);
  ok(!B.plantStemFertilizable(0, 1, 0), 'kelp under stone is not fertilizable (chooseStemState at the head)');
  const c = FAM[3]; setupColumn(c, 3);
  ok(B.plantStemFertilizable(0, -1, 0) && B.plantStemGrow(0, -1, 0) && B.propName(world.getBlock(0, -1, 0), 'berries') === 'true' && !B.plantStemFertilizable(0, -1, 0),
    'cave_vines bone meal: BERRIES=true, then not fertilizable');
}

// ── 6. CaveVines.pickBerries through Use.blockUse ──────────────────────────────────────────
{
  const drops = [];
  M.EntityList = { popResource: (x, y, z, item, n) => drops.push([item, n]) };
  M.Items = M.Items || {};
  if (!M.Items.of) M.Items.of = (n) => n;
  const c = FAM[3]; setupColumn(c, 3);
  const berried = B.setProp(world.getBlock(0, -1, 0), 'berries', true);
  world.setBlock(0, -1, 0, berried);
  const P = { instabuild: false };
  const used = M.Use.blockUse(P, 0, -1, 0, berried, null);
  const after = world.getBlock(0, -1, 0);
  const passed = M.Use.blockUse(P, 0, -1, 0, after, null);
  ok(used && drops.length === 1 && drops[0][1] === 1 && JSON.stringify(drops[0][0]).includes('glow_berries') && B.propName(after, 'berries') === 'false',
    'cave_vines use: one glow_berries dropped, BERRIES=false');
  ok(!passed && drops.length === 1, 'cave_vines use without berries PASSes and drops nothing');
}

// ── anti-vacuity ──────────────────────────────────────────────────────────────────────────
{
  const real = B.STEM_MAX_AGE;
  B.STEM_MAX_AGE = 99;                             // the age cap removed
  const r = capAndSwap(FAM[0]);
  B.STEM_MAX_AGE = real;
  okAv(r.len !== MAX_AGE + 1, `age cap removed: the kelp column grows past ${MAX_AGE + 1} (${r.len} cells)`);
}
{
  const realChanged = B.changed;
  B.changed = () => 0;                             // no neighbour update: the head/body swap never runs
  const r = capAndSwap(FAM[2]);
  B.changed = realChanged;
  okAv(!(r.heads === 1 && r.lastIsHead), `neighbour update skipped: the swap assertion sees ${r.heads} weeping_vines heads`);
}
{
  const r2 = FAM.map((f) => chanceSeen({ ...f, chance: f.chance * 2 }));
  okAv(r2.some((v) => !v), 'growth chance doubled in the expectation is refused by the engine');
}
okAv(vineLen(ROLLS, 0.5) !== boneMealWeeping().grown, 'VineLogic factor 0.5 in the expectation disagrees with the engine');

if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
console.log(`plantstem: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
