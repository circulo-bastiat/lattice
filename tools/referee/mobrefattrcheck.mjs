#!/usr/bin/env node
// mobrefattrcheck.mjs — infra I6 (24 Sept 2026): a freshly spawned mob's live attributes, the ENGINE's spawn path
// (EntityList.spawn -> the type's init, Undead.initZombieAttributes for the zombie family) against the REAL 1.18.2
// server's `/summon` (MobEntity.initialize + ZombieEntity.applyAttributeModifiers) — tools/referee/runattrs.mjs ->
// golden/mob-attributes.json.
//
//   node tools/referee/runattrs.mjs            # once per machine/store (~4 min, the real server)
//   node tools/referee/mobrefattrcheck.mjs [--verbose]
//
// Per mob: follow_range, knockback_resistance, max_health, Health (and for the zombie family
// zombie.spawn_reinforcements) as DISTRIBUTIONS — two-sample Kolmogorov-Smirnov, P < 1e-5 fails — and
// CanBreakDoors as a rate (exact two-sided binomial, P < 1e-5). The engine is fed vanilla's clamped local
// difficulty for the golden's scenario (the same arithmetic as mobrefequipcheck; that check owns the
// "engine's own value" assertion, this one does not repeat it). A mob the engine cannot spawn fails once.
// Anti-vacuity (D-30/D-305): three in-memory breaks of the engine's samples, each must add a failure.
// No golden -> SKIP, exit 0. Golden: <referee dir>/golden, else ../mclite-store/golden (never committed, D-6).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-attributes.json'),
  join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-attributes.json')].find((f) => existsSync(f));
if (!GOLDEN) {
  console.log('mobrefattrcheck: SKIP (golden not generated -- run node tools/referee/runattrs.mjs)');
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
const CLAMPED = (clampLocal(vanillaLocal(S.difficultyId, S.timeOfDay, 0, S.moonSize)) +
  clampLocal(vanillaLocal(S.difficultyId, S.timeOfDay, S.inhabitedMax, S.moonSize))) / 2;

// ---- the engine, loaded the way mobrefequipcheck loads it ----
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
if (MCL.Equip) { MCL.Equip.ready = true; MCL.Equip.clampedLocalDifficulty = () => CLAMPED; }
MCL.Diff = { get: () => S.difficulty };
MCL.Player = { x: 0, y: 64, z: 0 };
const EL = MCL.EntityList, Ai = MCL.Ai, Und = MCL.Undead;

const FIELDS = ['follow_range', 'knockback_resistance', 'max_health', 'Health', 'zombie.spawn_reinforcements'];
const DOORS = 5;
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const N_E = 20000, P_FAIL = 1e-5;
function engineSamples(mob, zombie) {
  const rng = mulberry(20260924 ^ mob.length * 104729);
  const saveM = Math.random, saveE = EL.random;
  Math.random = rng; EL.random = rng;
  const out = [];
  try {
    for (let n = 0; n < N_E; n++) {
      const e = EL.spawn(mob, 0, 64, 0);
      if (!e) return null;
      out.push([Ai.followRangeOf(e), e.knockbackResistance || 0, e.maxHealth, e.health,
        zombie ? (Und && Und.spawnReinforcementsOf ? Und.spawnReinforcementsOf(e) : 0) : null,
        zombie ? (e.canBreakDoors ? 1 : 0) : null,
        // WHAT THE ENGINE MOVES IT BY (s137): `Ai.movementSpeedOf(e)` -- the value every AI walk multiplies. Reading
        // `e.movementSpeedAttr` here instead hid that the AI never reads it (a horse walked at entities.json's 0.7).
        (MCL.Ai && MCL.Ai.movementSpeedOf) ? MCL.Ai.movementSpeedOf(e)
          : (e.movementSpeedAttr !== undefined ? e.movementSpeedAttr : ((MCL.Entities.attrsOf(mob) || {}).speed ?? null)),
        e.jumpStrengthAttr !== undefined ? e.jumpStrengthAttr : (MCL.Mount && MCL.Mount.JUMP_STRENGTH_ATTR !== undefined ? MCL.Mount.JUMP_STRENGTH_ATTR : null)]);
      EL.clear();   // EL.remove only flags e.removed; the list is swept by tick, so 20000 spawns would pile up
    }
  } catch (err) { return { error: String(err && err.message || err).slice(0, 120) }; }
  finally { Math.random = saveM; EL.random = saveE; }
  return out;
}
// Two-sample KS: D and the asymptotic Kolmogorov tail Q(sqrt(n m/(n+m)) D).
const R5 = (v) => Math.round(v * 1e5) / 1e5;   // /attribute get 1000000 truncates 0.175F (0.17499999701..) to 0.174999
function ks(a, b) {
  a = a.map(R5); b = b.map(R5);
  a = a.slice().sort((x, y) => x - y); b = b.slice().sort((x, y) => x - y);
  let i = 0, j = 0, d = 0;
  while (i < a.length && j < b.length) {
    const v = Math.min(a[i], b[j]);
    while (i < a.length && a[i] <= v) i++;
    while (j < b.length && b[j] <= v) j++;
    d = Math.max(d, Math.abs(i / a.length - j / b.length));
  }
  const ne = a.length * b.length / (a.length + b.length);
  const lam = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let q = 0;
  for (let k = 1; k <= 100; k++) q += 2 * (k % 2 ? 1 : -1) * Math.exp(-2 * k * k * lam * lam);
  return { d, p: Math.min(1, Math.max(0, lam < 0.2 ? 1 : q)) };
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
const q = (xs, f) => { const s = xs.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
const desc = (xs) => `median ${q(xs, 0.5).toFixed(3)}, 1%..99% ${q(xs, 0.01).toFixed(3)}..${q(xs, 0.99).toFixed(3)}`;
function compareMob(mob, eng, gold, zombie) {
  const f = [];
  for (let k = 0; k < FIELDS.length; k++) {
    if (!zombie && k === 4) continue;
    const E = eng.map((s) => s[k]), G = gold.map((s) => s[k]);
    const r = ks(E, G);
    ok(f, r.p >= P_FAIL, `${mob}: ${FIELDS[k]} engine ${desc(E)} vs vanilla ${desc(G)} (KS D=${r.d.toFixed(3)}, p=${r.p.toExponential(1)})`);
  }
  for (const [k, name] of [[6, 'movement_speed'], [7, 'horse.jump_strength']]) {
    if (gold[0][k] === undefined || gold[0][k] === null) continue;       // rolled/read for the horse family only
    const G = gold.map((s) => s[k]), E = eng.map((s) => s[k]);
    if (E.some((v) => v === null || v === undefined)) { ok(f, false, `${mob}: ${name} — the engine keeps no per-entity value (vanilla ${desc(G)})`); continue; }
    const r = ks(E, G);
    ok(f, r.p >= P_FAIL, `${mob}: ${name} engine ${desc(E)} vs vanilla ${desc(G)} (KS D=${r.d.toFixed(3)}, p=${r.p.toExponential(1)})`);
  }
  if (zombie) {
    const ke = eng.filter((s) => s[DOORS] === 1).length, kg = gold.filter((s) => s[DOORS] === 1).length;
    const p = Math.min(Math.max(ke / eng.length, 0.5 / eng.length), 1 - 0.5 / eng.length);
    ok(f, binomTwoSided(kg, gold.length, p) >= P_FAIL, `${mob}: CanBreakDoors on ${(100 * ke / eng.length).toFixed(1)}% (engine) vs ${(100 * kg / gold.length).toFixed(1)}% (vanilla, ${kg}/${gold.length})`);
  }
  return f;
}

console.log(`mobrefattrcheck — engine x${N_E} vs the real 1.18.2 server (${golden.per}/mob, ${golden.generatedAt}; ${GOLDEN})`);
console.log(`  scenario: ${S.difficulty}, day ${S.timeOfDay / 24000}, moon ${S.moonSize} -> vanilla clamped local difficulty ${CLAMPED.toFixed(4)} (fed to the engine)`);
const cache = {};
const isZombie = (mob) => golden.mobs[mob].samples.length > 0 && golden.mobs[mob].samples[0][4] !== null;
for (const mob of Object.keys(golden.mobs).sort()) {
  const z = isZombie(mob);
  const eng = cache[mob] = engineSamples(mob, z);
  if (!eng || eng.error) { ok(fails, false, `${mob}: the engine cannot spawn it (EntityList.spawn ${eng ? 'threw: ' + eng.error : 'returned nothing'})`); continue; }
  const f = compareMob(mob, eng, golden.mobs[mob].samples, z);
  fails.push(...f);
  if (VERBOSE) console.log(`  ${f.length ? '✗' : '✓'} ${mob}${f.length ? ' — ' + f.length : ''}`);
}

// ---- anti-vacuity: each break mutates the engine's samples and must add a failure ----
function breakCaught(label, mob, mutate) {
  if (!Array.isArray(cache[mob])) { fails.push(`anti-vacuity: ${mob} not spawnable, break "${label}" cannot run`); return; }
  const z = isZombie(mob);
  const base = compareMob(mob, cache[mob], golden.mobs[mob].samples, z).length;
  const after = compareMob(mob, cache[mob].map((s) => mutate(s.slice())), golden.mobs[mob].samples, z).length;
  if (after > base) breaks++; else fails.push(`anti-vacuity: break "${label}" on ${mob} NOT caught (${base} -> ${after})`);
}
breakCaught('knockback bonus doubled', 'husk', (s) => { s[1] *= 2; return s; });
breakCaught('no zombie ever breaks doors', 'zombie', (s) => { s[DOORS] = 0; return s; });
breakCaught('max health +2 on every cow', 'cow', (s) => { s[2] += 2; return s; });

const uniq = [...new Set(fails)];
console.log(`  ${Object.keys(golden.mobs).length} mobs · ${pass} comparisons pass · ${uniq.length} mismatch(es) · ${breaks}/3 breaks caught`);
for (const m of uniq.slice(0, VERBOSE ? 400 : 60)) console.log('FAIL  ' + m);
for (let i = 0; i < breaks; i++) console.log('  ✓ anti-vacuity break caught');
// suite.mjs reads these two lines (`assertions passed ... N`, `failures ... N`)
console.log(`\n  assertions passed .. ${pass}\n  failures ........... ${uniq.length}\n  breaks caught ...... ${breaks}`);
process.exit(uniq.length ? 1 : 0);
