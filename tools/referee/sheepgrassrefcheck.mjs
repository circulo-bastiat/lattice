#!/usr/bin/env node
// sheepgrassrefcheck.mjs — infra W (25 Sept 2026): SHEEP EAT GRASS vs the real 1.18.2 server (golden:
// runsheepgrass.mjs, sheep-grass.json; scenarios: sheepgrassscen.mjs). Drives the engine's OWN
// `Passive.EatGrassGoal` (src/07w_passive.js) directly on freshly `EL.spawn`'d sheep, one instance per sheep,
// exactly the shape `passivecheck.mjs` §10 already proves works (`canUse()` while idle, `start()`/`tick()`/
// `canContinueToUse()`/`stop()` while running) — never a second copy of the goal's own rule (D-331). Because
// `canUse`'s roll is a per-tick Bernoulli draw (p=1/1000 adult, 1/50 baby), the comparison is DISTRIBUTIONAL:
// at each of `sheepgrassscen.CHECKPOINTS`, the fraction of a large synthetic flock that has already eaten is
// compared against the real server's own observed rate via a pooled two-proportion z-test (P < 1e-5 fails —
// mobrefattrcheck.mjs/hurtrefcheck.mjs's own threshold for a per-trial rate; a two-SAMPLE test, not a one-sample
// binomial against the golden's own rate as if it were exact truth, because the golden side is itself only a
// 100-300-sheep sample with real sampling noise of its own). The grass_block->dirt
// conversion count and the "never eats on dirt"/"mobGriefing=false never converts the block" facts are exact
// (0 tolerance — the game does not roll a dice for those).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { PHASE1, PHASE2, SCENARIOS, CHECKPOINTS, CONVERTIBLE } from './sheepgrassscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'sheep-grass.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'sheep-grass.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('sheepgrassrefcheck: golden not generated -- run node tools/referee/runsheepgrass.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));

// same load shape passivecheck.mjs already proves works for Passive.EatGrassGoal (D-331: reuse it, not a
// trimmed-down guess of what it needs).
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
    '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
    '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07w_passive.js', '14l_use.js'],
});
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
let seed = 0x5eed6a55;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// the SAME lightweight Map-backed world breedrefcheck.mjs uses for `Breed.breed`/`Use.entityUse`: `Passive.
// EatGrassGoal` only ever calls `NS.World.getBlock/setBlock`, so a real generated chunk (passivecheck.mjs's own
// fixture) buys nothing here and would make thousands of per-sheep cells expensive for no reason.
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 15; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
M.EntityList.init(); M.Breed.init(); M.Passive.init();
M.EntityList.random = rng; Math.random = rng;
const EL = M.EntityList, S = M.States, Br = M.Breed, Ps = M.Passive;
const GRASS = S.stateOf('grass'), GRASS_BLOCK = S.stateOf('grass_block'), DIRT = S.stateOf('dirt');
if (!(GRASS > 0 && GRASS_BLOCK > 0 && DIRT > 0)) { console.log('sheepgrassrefcheck: grass/grass_block/dirt do not resolve to real states'); process.exit(1); }

const N_ENG = 4000; // one flock, all scenarios: 4000 x 700 ticks is milliseconds of JS, comfortably powers a P<1e-5 gate

function simulate(s, ticks, checkpoints, griefingFn) {
  cells.clear(); EL.list.length = 0;
  const pens = [];
  for (let i = 0; i < N_ENG; i++) {
    const x = i * 2;
    w.set(x, 0, 0, s.ground === 'dirt' ? DIRT : GRASS_BLOCK);
    if (s.ground === 'grass_plant') w.set(x, 1, 0, GRASS);
    const e = EL.spawn('sheep', x + 0.5, 1, 0.5);
    if (!e) return { err: 'EL.spawn(sheep) gives nothing' };
    e.sheared = true;
    Br.setAge(e, s.age);
    pens.push({ e, x, running: false, goal: new Ps.EatGrassGoal(e, { random: rng, mobGriefing: griefingFn }) });
  }
  const out = { checkpoints: {}, pens };
  let elapsed = 0;
  for (const ck of checkpoints) {
    for (let t = elapsed; t < ck; t++) {
      for (const p of pens) {
        Br.tickAge(p.e);
        if (!p.running) { if (p.goal.canUse()) { p.goal.start(); p.running = true; } }
        else { p.goal.tick(); if (!p.goal.canContinueToUse()) { p.goal.stop(); p.running = false; } }
      }
    }
    elapsed = ck;
    let eaten = 0, dirt = 0;
    for (const p of pens) {
      if (p.e.sheared === false) eaten++;
      if (CONVERTIBLE.has(s.id) && w.get(p.x, 0, 0) === DIRT) dirt++;
    }
    out.checkpoints[ck] = { eaten, n: N_ENG };
    if (CONVERTIBLE.has(s.id)) out.checkpoints[ck].dirt = dirt;
  }
  return out;
}
const griefOn = () => true, griefOff = () => false;
function runScenario(s) { return simulate(s, CHECKPOINTS[CHECKPOINTS.length - 1], CHECKPOINTS, s.id === 'adult_griefing_off' ? griefOff : griefOn); }

let pass = 0;
const reds = [];
// two-proportion pooled z-test (NOT a one-sample binomial against the golden's own observed rate as if it were
// exact truth): the golden side is a SMALL real-server sample (100-300 sheep) with real sampling noise of its
// own, and treating its own observed rate as ground truth against a big 4000-sheep engine sample makes ordinary
// binomial noise on the golden side look like a mismatch (checked empirically on a synthetic golden built from
// the EXACT decomp formula: 26 spurious reds at P<1e-5 before this fix). A pooled z-test folds BOTH samples'
// variance in, the correct comparison for "two empirical rates estimating the same true p".
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
function twoPropP(k1, n1, k2, n2) {
  if (!n1 || !n2) return 1;
  const p1 = k1 / n1, p2 = k2 / n2, pooled = (k1 + k2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return p1 === p2 ? 1 : 0;
  const z = (p1 - p2) / se;
  return erfc(Math.abs(z) / Math.SQRT2);
}
const P_FAIL = 1e-5;
const pct = (a, n) => (n ? (100 * a / n).toFixed(1) + '%' : 'n/a');

function compareRate(what, kGold, nGold, kEng, nEng, out) {
  if (!nGold) { out.push(`${what}: no golden trials`); return; }
  const pv = twoPropP(kGold, nGold, kEng, nEng);
  if (pv < P_FAIL) out.push(`${what}: server ${pct(kGold, nGold)} (${kGold}/${nGold}), engine ${pct(kEng, nEng)} (${kEng}/${nEng}) (two-prop z-test p=${pv.toExponential(1)})`);
  else pass++;
}
function compareExactZero(what, kGold, kEng, out) {
  if (kGold !== 0) out.push(`${what}: golden itself is not the exact-zero it's supposed to be (${kGold})`);
  else if (kEng !== 0) out.push(`${what}: server 0, engine ${kEng} (must be exactly zero, no dice involved)`);
  else pass++;
}

// Baby flock: only @100/@150 are comparable. The server pens are crowded 1-wide corridors where babies wander and
// re-eat on other cells (eaten plateaus ~72%, dirt 98%, Age delta 1.36 x 1200); the engine pen is one isolated
// sheep per cell (eats once, no wander). @50 is skipped too: the server clock starts before the pens are populated.
const BABY_CKS = new Set([100, 150]);
// server delta is 1200 x (eats per sheep, >= 1); the engine's lone sheep eats once, so exactly 1200
const babyGrowthBad = (engDelta, srvDelta) => Math.abs(engDelta - 1200) > 5 || srvDelta < 1200 - 5;

function compareScenario(s, eng) {
  const out = [];
  const g = golden.cases[s.id];
  if (!g) { out.push(`${s.id}: no golden case`); return out; }
  if (eng.err) { out.push(`${s.id}: ${eng.err}`); return out; }
  for (const ck of CHECKPOINTS) {
    if (s.id === 'baby_grass_block' && !BABY_CKS.has(ck)) continue;
    const gc = g.checkpoints[ck], ec = eng.checkpoints[ck];
    if (!gc || !ec) { out.push(`${s.id}@${ck}: missing checkpoint (golden ${!!gc}, engine ${!!ec})`); continue; }
    if (s.id === 'adult_no_grass' || s.id === 'baby_control') compareExactZero(`${s.id}@${ck} eaten`, gc.eaten, ec.eaten, out);
    else compareRate(`${s.id}@${ck} eaten`, gc.eaten, g.n, ec.eaten, N_ENG, out);
    if (CONVERTIBLE.has(s.id)) {
      if (s.id === 'adult_griefing_off') compareExactZero(`${s.id}@${ck} dirt (mobGriefing=false)`, gc.dirt, ec.dirt, out);
      else compareRate(`${s.id}@${ck} dirt`, gc.dirt, g.n, ec.dirt, N_ENG, out);
    }
  }
  return out;
}

console.log(`sheepgrassrefcheck — sheep grass-eating vs the real 1.18.2 server (${SCENARIOS.length} scenarios, ${golden.generatedAt})`);
const engineResults = {};
for (const s of SCENARIOS) {
  const eng = runScenario(s);
  engineResults[s.id] = eng;
  const bad = compareScenario(s, eng);
  reds.push(...bad);
  if (VERBOSE) {
    const g = golden.cases[s.id];
    const lastCk = CHECKPOINTS[CHECKPOINTS.length - 1];
    const gc = g && g.checkpoints[lastCk], ec = eng.checkpoints && eng.checkpoints[lastCk];
    console.log(`  ${s.id.padEnd(20)} @${lastCk} server eaten ${gc ? pct(gc.eaten, g.n) : 'n/a'}${gc && gc.dirt !== undefined ? ` dirt ${pct(gc.dirt, g.n)}` : ''}  |  engine ${ec ? pct(ec.eaten, N_ENG) : eng.err} ${ec && ec.dirt !== undefined ? `dirt ${pct(ec.dirt, N_ENG)}` : ''}`);
  }
}

// ── baby growUp boost (SheepEntity.onEatingGrass -> PassiveEntity.growUp(60,false) == +1200 ticks, capped at 0)
// fed-minus-control, the same trick breedscen.mjs's own FEED scenes use to cancel ordinary tick-driven Age drift.
{
  const babyS = PHASE1.find((x) => x.id === 'baby_grass_block'), ctrlS = PHASE1.find((x) => x.id === 'baby_control');
  const gb = golden.cases.babyGrowth;
  if (!gb || !gb.eaten.n || !gb.control.n) reds.push('babyGrowth: no golden case (or nobody ate / no control)');
  else {
    const ebIn = engineResults.baby_grass_block, ecIn = engineResults.baby_control;
    const eatenPens = ebIn.pens.filter((p) => p.e.sheared === false);
    const ctrlPens = ecIn.pens;
    if (!eatenPens.length) reds.push('babyGrowth: no engine sheep ate at all');
    else {
      const engEatenMean = eatenPens.reduce((a, p) => a + Br.getAge(p.e), 0) / eatenPens.length;
      const engCtrlMean = ctrlPens.reduce((a, p) => a + Br.getAge(p.e), 0) / ctrlPens.length;
      const engDelta = engEatenMean - engCtrlMean;
      const srvDelta = gb.eaten.ageSum / gb.eaten.n - gb.control.ageSum / gb.control.n;
      if (babyGrowthBad(engDelta, srvDelta)) reds.push(`babyGrowth: mean Age(eaten)-Age(control) is ${srvDelta} ticks on the server, ${engDelta} in the engine (want ~+1200, growUp(60)*20)`);
      else pass++;
      if (VERBOSE) console.log(`  babyGrowth            server delta ${srvDelta}  |  engine delta ${engDelta.toFixed(1)} (n=${eatenPens.length} ate)`);
    }
  }
}

// ── worldEvent 2001: both branches fire the break sound + particles with the OLD block state (#2774)
function eventCheck(ground) {
  const sounds = [], dust = [];
  M.Sound = { blockBreak: (st) => sounds.push(st) };
  M.Particle = { spawnBlockDust: (x, y, z, a, b, c, st) => dust.push(st) };
  cells.clear(); w.set(0, 0, 0, ground === 'grass_block' ? GRASS_BLOCK : DIRT);
  if (ground === 'grass') w.set(0, 1, 0, GRASS);
  const e = EL.spawn('sheep', 0.5, 1, 0.5);
  const g = new Ps.EatGrassGoal(e, { random: rng, mobGriefing: griefOn });
  g.start(); for (let i = 0; i < 60 && g.canContinueToUse(); i++) g.tick();
  delete M.Sound; delete M.Particle;
  return { sounds, dust };
}
for (const [g, old] of [['grass_block', GRASS_BLOCK], ['grass', GRASS]]) {
  const r = eventCheck(g === 'grass' ? 'grass' : g);
  if (r.sounds.length === 1 && r.sounds[0] === old && r.dust.length > 0 && r.dust.every((s) => s === old)) pass++;
  else reds.push(`worldEvent 2001 on ${g}: sounds=${r.sounds.length} dust=${r.dust.length} (want 1 sound + dust, old state)`);
}

// ── anti-vacuity (D-30/D-305): perturb something IN MEMORY the check depends on, assert it gets caught.
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{
  const s = SCENARIOS.find((x) => x.id === 'adult_grass_block');
  const save = Ps.EAT_GRASS_ADULT_ROLL;
  Ps.EAT_GRASS_ADULT_ROLL = 1e9; // canUse's roll effectively never hits
  let bad; try { bad = compareScenario(s, runScenario(s)); } finally { Ps.EAT_GRASS_ADULT_ROLL = save; }
  brk('EAT_GRASS_ADULT_ROLL moved to 1e9 (canUse never fires)', bad.length > 0);
}
{
  const s = SCENARIOS.find((x) => x.id === 'adult_grass_block');
  const save = Ps.EAT_GRASS_TRIGGER;
  Ps.EAT_GRASS_TRIGGER = -1; // tick()'s timer never equals the trigger -- no edit, no onEatingGrass, ever
  let bad; try { bad = compareScenario(s, runScenario(s)); } finally { Ps.EAT_GRASS_TRIGGER = save; }
  brk('EAT_GRASS_TRIGGER moved to -1 (the edit + onEatingGrass never fire)', bad.length > 0);
}
{
  const s = PHASE2.find((x) => x.id === 'adult_griefing_off');
  const eng = simulate(s, CHECKPOINTS[CHECKPOINTS.length - 1], CHECKPOINTS, griefOn); // wrong ctx: griefing forced ON
  const bad = compareScenario(s, eng);
  brk('adult_griefing_off run with mobGriefing forced true (the gate ignored)', bad.length > 0);
}
{
  const save = Br.ageUp;
  Br.ageUp = function () { /* no-op: the baby growth boost never applies */ };
  const babyS = PHASE1.find((x) => x.id === 'baby_grass_block'), ctrlS = PHASE1.find((x) => x.id === 'baby_control');
  let eb, ec; try { eb = runScenario(babyS); ec = runScenario(ctrlS); } finally { Br.ageUp = save; }
  const gb = golden.cases.babyGrowth;
  let fired = true;
  if (gb && gb.eaten.n) {
    const eatenPens = eb.pens.filter((p) => p.e.sheared === false);
    if (eatenPens.length) {
      const engDelta = eatenPens.reduce((a, p) => a + Br.getAge(p.e), 0) / eatenPens.length - ec.pens.reduce((a, p) => a + Br.getAge(p.e), 0) / ec.pens.length;
      const srvDelta = gb.eaten.ageSum / gb.eaten.n - gb.control.ageSum / gb.control.n;
      fired = babyGrowthBad(engDelta, srvDelta);
    }
  }
  brk('Breed.ageUp no-op\'d (the +1200 growUp boost never applies)', fired);
}
{
  const save = Ps.EAT_GRASS_TRIGGER;
  Ps.EAT_GRASS_TRIGGER = -1; // no edit, so no event: the event assertions must go red
  let r1, r2; try { r1 = eventCheck('grass_block'); r2 = eventCheck('grass'); } finally { Ps.EAT_GRASS_TRIGGER = save; }
  brk('EAT_GRASS_TRIGGER moved to -1 (no 2001 event in either branch)', r1.sounds.length === 0 && r2.sounds.length === 0);
}

for (const r of reds) console.log('  ✗ ' + r);
console.log(`sheepgrassrefcheck: ${pass}/${pass + reds.length} verdicts agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
