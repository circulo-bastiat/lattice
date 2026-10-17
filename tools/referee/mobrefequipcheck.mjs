#!/usr/bin/env node
// mobrefequipcheck.mjs — infra I6 (24 Sept 2026): what a freshly spawned mob holds and wears, the ENGINE's
// spawn path (EntityList.spawn -> Equip.initMob / initDrowned / the type's own initialize) against the REAL
// 1.18.2 server's `/summon` (MobEntity.initialize, SpawnReason.COMMAND) — tools/referee/runequip.mjs ->
// golden/mob-equipment.json.
//
//   node tools/referee/runequip.mjs          # once per machine/store (~5 min, the real server)
//   node tools/referee/mobrefequipcheck.mjs [--verbose]
//
// LocalDifficulty: the golden records World.getLocalDifficulty's inputs (difficulty, timeOfDay, moon size,
// an upper bound on the chunk's inhabited time); this check recomputes vanilla's clamped local difficulty
// from them with LocalDifficulty.setLocalDifficulty/getClampedLocalDifficulty's own arithmetic
// (.decomp/net/minecraft/world/LocalDifficulty.java). §1 asserts the ENGINE's own value for that global
// difficulty equals it (Equip.clampedLocalDifficulty collapses the regional value, Eq.OWED); §2 then
// FEEDS vanilla's value to the engine so every other part of the roll (armour tiers, break chance, weapon,
// enchantments, left-handedness, babies) is compared on equal inputs rather than drowned by §1.
//
// Per mob, per feature (main:/off:/feet:/legs:/chest:/head:<item>, ench:<slot>:<id>, lefthanded, baby):
// the golden count against the engine's rate (N_E spawns) — exact two-sided binomial, P < 1e-5 fails;
// enchantment LEVELS as means (>= 20 samples each side, 5 sigma). A mob the engine cannot spawn fails once.
// Anti-vacuity (D-30/D-305): three in-memory breaks of the engine's samples, each must add a failure.
// No golden -> SKIP, exit 0. Golden: <referee dir>/golden, else ../mclite-store/golden (never committed, D-6).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-equipment.json'),
  join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-equipment.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('mobrefequipcheck: SKIP (golden not generated -- run node tools/referee/runequip.mjs)');
  process.exit(0);
}
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
let pass = 0, breaks = 0;
const fails = [];
const ok = (list, c, m) => { if (c) pass++; else list.push(m); return c; };

// ---- vanilla's clamped local difficulty for the golden's scenario (LocalDifficulty.java, float math) ----
const f32 = Math.fround;
function vanillaLocal(diffId, timeOfDay, inhabited, moon) {
  if (diffId === 0) return 0;
  const hard = diffId === 3;
  let f = f32(0.75);
  const g = f32(Math.min(Math.max(f32(f32(timeOfDay) + f32(-72000)) / f32(1440000), 0), 1) * f32(0.25));
  f = f32(f + g);
  let h = f32(0);
  h = f32(h + f32(Math.min(Math.max(f32(inhabited) / f32(3600000), 0), 1) * (hard ? 1 : f32(0.75))));
  h = f32(h + Math.min(Math.max(f32(moon * f32(0.25)), 0), g));
  if (diffId === 1) h = f32(h * f32(0.5));
  f = f32(f + h);
  return f32(diffId * f);
}
const clampLocal = (ld) => (ld < 2 ? 0 : ld > 4 ? 1 : f32((ld - 2) / 2));
const S = golden.scenario;
const clampLo = clampLocal(vanillaLocal(S.difficultyId, S.timeOfDay, 0, S.moonSize));
const clampHi = clampLocal(vanillaLocal(S.difficultyId, S.timeOfDay, S.inhabitedMax, S.moonSize));
const CLAMPED = (clampLo + clampHi) / 2;   // the spread is < 0.01 for any run shorter than a few hours

// ---- the engine, loaded the way mobdefaultscheck loads it (every 07*.js mob module) ----
const BASE_MODS = ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
  '07n_tame.js', '07q_effects.js', '07y_equip.js', '10_gfx.js', '15h_bemodel.js',
  '07j_entityrender.js', '14j_combat.js', '07zw_mobnbt.js', '07w_passive.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const MCL = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false });
initRegistry(MCL);
MCL.DATA = Object.assign({}, MCL.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
{
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  MCL.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
MCL.Entities.init(); MCL.EntityList.init(); MCL.Ai.init(); MCL.Breed.init(); MCL.Tame.init();
if (MCL.Passive && MCL.Passive.init) MCL.Passive.init();
if (MCL.Equip) MCL.Equip.ready = true;
MCL.Diff = { get: () => S.difficulty };
MCL.Player = { x: 0, y: 64, z: 0 };
const EL = MCL.EntityList, Eq = MCL.Equip, IT = MCL.Items;

// ---- §1. the engine's own clamped local difficulty for this global difficulty ----
// D-671: the engine's formula asked at THE SCENARIO's inputs (its own world clock is 0 in this harness —
// a fresh world, which the engine already gets right: 0.125 on hard). Asking it with no inputs compared a
// day-0 engine against a day-64 server.
const own = Eq.clampedLocalDifficulty({ time: S.timeOfDay, inhabited: 0, difficulty: S.difficulty });
ok(fails, own >= 0 && own <= 1, `Equip.clampedLocalDifficulty() at ${S.difficulty} is ${own} -- vanilla's getClampedLocalDifficulty is always in [0, 1]`);
ok(fails, Math.abs(own - CLAMPED) < 0.01, `Equip.clampedLocalDifficulty() at ${S.difficulty} is ${own}; vanilla at this scenario (day ${S.timeOfDay / 24000}, moon ${S.moonSize}, fresh chunk) is ${CLAMPED.toFixed(4)} (fresh world at time 0: ${clampLocal(vanillaLocal(S.difficultyId, 0, 0, 1)).toFixed(4)})`);
Eq.clampedLocalDifficulty = () => CLAMPED;    // §2 compares the rest of the roll on vanilla's input

// ---- §2. every mob ----
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N_E = 20000, Z = 5, P_FAIL = 1e-5, MIN_MEAN_N = 20;
const SLOT = [['main', IT.MAINHAND], ['off', IT.OFFHAND], ['feet', IT.FEET], ['legs', IT.LEGS], ['chest', IT.CHEST], ['head', IT.HEAD]];
function engineSamples(mob) {
  const rng = mulberry(20260924 ^ mob.length * 7919);
  const saveM = Math.random, saveE = EL.random;
  Math.random = rng; EL.random = rng;
  const out = [];
  try {
    for (let n = 0; n < N_E; n++) {
      const e = EL.spawn(mob, 0, 64, 0);
      if (!e) return null;
      const f = [];
      for (const [slot, idx] of SLOT) {
        const st = Eq.getEquipped(e, idx);
        if (!st) continue;
        f.push(`${slot}:${IT.nameOf(st.i)}`);
        for (const en of (st.t && st.t.Enchantments) || []) f.push(`ench:${slot}:${String(en.id).replace(/^minecraft:/, '')}:${en.lvl}`);
      }
      if (e.leftHanded) f.push('lefthanded');
      if ((MCL.Breed && MCL.Breed.isBaby) ? MCL.Breed.isBaby(e) : (e.growAge | 0) < 0) f.push('baby');
      out.push(f.sort());
      if (EL.clear) EL.clear();   // EL.remove only flags; the list is only compacted by tick, so 20000 spawns pile up (OOM)
    }
  } catch (err) { return { error: String(err && err.message || err).slice(0, 120) }; }
  finally { Math.random = saveM; EL.random = saveE; }
  return out;
}
const lgam = (() => { const c = [0]; return (n) => { while (c.length <= n) c.push(c[c.length - 1] + Math.log(c.length)); return c[n]; }; })();
function binomTwoSided(k, n, p) {
  const lp = Math.log(p), lq = Math.log(1 - p);
  const pmf = (i) => Math.exp(lgam(n) - lgam(i) - lgam(n - i) + i * lp + (n - i) * lq);
  let lo = 0, hi = 0;
  for (let i = 0; i <= k; i++) lo += pmf(i);
  for (let i = k; i <= n; i++) hi += pmf(i);
  return Math.min(1, 2 * Math.min(lo, hi));
}
function summarize(samples) {
  const rate = {}, lvl = {};
  for (const s of samples) {
    const seen = new Set();
    for (const f of s) {
      const m = /^ench:([^:]+):([^:]+):(\d+)$/.exec(f);
      const k = m ? `ench:${m[1]}:${m[2]}` : f;
      if (!seen.has(k)) { seen.add(k); rate[k] = (rate[k] || 0) + 1; }
      if (m) { const q = lvl[k] || (lvl[k] = { n: 0, sum: 0, sq: 0 }); q.n++; q.sum += +m[3]; q.sq += m[3] * m[3]; }
    }
  }
  return { n: samples.length, rate, lvl };
}
function compareMob(mob, eng, gold) {
  const f = [];
  const E = summarize(eng), G = summarize(gold);
  for (const k of new Set([...Object.keys(E.rate), ...Object.keys(G.rate)])) {
    const ke = E.rate[k] || 0, kg = G.rate[k] || 0;
    const p = Math.min(Math.max(ke / E.n, 0.5 / E.n), 1 - 0.5 / E.n);
    ok(f, binomTwoSided(kg, G.n, p) >= P_FAIL, `${mob}: ${k} on ${(100 * ke / E.n).toFixed(1)}% (engine) vs ${(100 * kg / G.n).toFixed(1)}% (vanilla, ${kg}/${G.n})`);
  }
  for (const k of Object.keys(G.lvl)) {
    const qe = E.lvl[k], qg = G.lvl[k];
    if (!qe || qe.n < MIN_MEAN_N || qg.n < MIN_MEAN_N) continue;
    const me = qe.sum / qe.n, mg = qg.sum / qg.n, ve = Math.max(0, qe.sq / qe.n - me * me);
    ok(f, Math.abs(me - mg) <= Z * Math.sqrt(ve / qg.n + ve / qe.n) + 1e-9, `${mob}: ${k} level mean ${me.toFixed(2)} (engine) vs ${mg.toFixed(2)} (vanilla)`);
  }
  return f;
}
console.log(`mobrefequipcheck — engine x${N_E} vs the real 1.18.2 server (${golden.per}/mob, ${golden.generatedAt}; ${GOLDEN})`);
console.log(`  scenario: ${S.difficulty}, day ${S.timeOfDay / 24000}, moon ${S.moonSize} -> vanilla clamped local difficulty ${clampLo.toFixed(4)}..${clampHi.toFixed(4)}; engine's own ${own}`);
const cache = {};
for (const mob of Object.keys(golden.mobs).sort()) {
  const eng = cache[mob] = engineSamples(mob);
  if (!eng || eng.error) { ok(fails, false, `${mob}: the engine cannot spawn it (EntityList.spawn ${eng ? 'threw: ' + eng.error : 'returned nothing'})`); continue; }
  const f = compareMob(mob, eng, golden.mobs[mob].samples);
  fails.push(...f);
  if (VERBOSE) console.log(`  ${f.length ? '✗' : '✓'} ${mob}${f.length ? ' — ' + f.length : ''}`);
}

// ---- §3. anti-vacuity ----
function breakCaught(label, mob, mutate) {
  if (!Array.isArray(cache[mob])) { fails.push(`anti-vacuity: ${mob} not spawnable, break "${label}" cannot run`); return; }
  const base = compareMob(mob, cache[mob], golden.mobs[mob].samples).length;
  const after = compareMob(mob, cache[mob].map((s) => mutate([...s])), golden.mobs[mob].samples).length;
  if (after > base) breaks++; else fails.push(`anti-vacuity: break "${label}" on ${mob} NOT caught (${base} -> ${after})`);
}
breakCaught('the fixed weapon swapped', 'vindicator', (s) => s.map((f) => (f === 'main:iron_axe' ? 'main:stone_axe' : f)));
breakCaught('armour never rolled', 'zombie', (s) => s.filter((f) => !/^(feet|legs|chest|head):/.test(f)));
breakCaught('every spawn enchanted', 'skeleton', (s) => (s.some((f) => f.startsWith('ench:main:')) ? s : s.concat('ench:main:power:1')));

const uniq = [...new Set(fails)];
console.log(`  ${Object.keys(golden.mobs).length} mobs · ${pass} comparisons pass · ${uniq.length} mismatch(es) · ${breaks}/3 breaks caught`);
for (const m of uniq.slice(0, VERBOSE ? 400 : 60)) console.log('FAIL  ' + m);
if (!VERBOSE && uniq.length > 60) console.log(`  … ${uniq.length - 60} more (--verbose)`);
for (let i = 0; i < breaks; i++) console.log('  ✓ anti-vacuity break caught');
// suite.mjs reads these two lines (`assertions passed ... N`, `failures ... N`)
console.log(`\n  assertions passed .. ${pass}\n  failures ........... ${uniq.length}\n  breaks caught ...... ${breaks}`);
process.exit(uniq.length ? 1 : 0);
