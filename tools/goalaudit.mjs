#!/usr/bin/env node
// goalaudit.mjs — GATE M (#1535), class GOALS. Every roster mob's registerGoals() (goals-1.18.2.tsv, read out of
// .decomp by extract-goals.mjs, nothing typed in) against the goal list the engine really builds for it.
//
//   node tools/goalaudit.mjs [--print] [--file] [--write]   (--write regenerates the ledger: only to LOWER it)
//
// goalrostercheck compares the PARAMETERS of nine goal families. This one is the TABLE for ALL of them: every golden
// row of every entity type of the roster (assets/entities.json `types`, 113) is looked up in the engine's goal list
// for that mob (`EL.spawn` -> e.ai.entries, with the target-selector flag read off the entry) by
//   (selector, priority, goal class)
// where an engine goal's class is found by reverse lookup (which `Ai.X` / `<Module>.X` property holds its constructor),
// never typed in; the only typed table is ALIAS, the jar-name -> engine-name renames. Each row is one of
//   ok         the engine has that class at that selector and priority
//   priority   the engine has the class on that mob/selector but at another priority (or count)
//   missing    the mob has no such goal at all (the class may exist for other mobs: a mob missing a goal)
//   noclass    no class of that name exists in the engine anywhere (a goal nobody built)
//   unrostered the mob has jar goals and no Ai.ROSTER function (it would stand still)
//   extra      the engine builds a goal the jar's list does not have (only for classes the golden knows)
// Mapped, ok rows are the audit; the rest are the LEDGER tools/goalaudit-known.json (one `mob|status|goal` key each).
// RATCHET: a key not in the ledger fails (a regression, or a new roster type); a ledger key that no longer occurs
// fails until deleted (it may only shrink). Break proof (D-30): each mutation corrupts one input in memory and must
// produce a new key. --file files every NEW key's mob as a bug (labels bug,mobs), one issue per mob+class, de-duplicated.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRINT = process.argv.includes('--print'), FILE = process.argv.includes('--file');
console.log('goalaudit — GATE M goals: every roster mob\'s registerGoals() vs the engine\'s goal list (ratchet)');
if (!existsSync(join(ROOT, 'assets', 'entities.json'))) { console.log('goalaudit: SKIP — assets missing, run the build stages'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ dom: true, extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
const roster = Object.keys(JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')).types);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const EL = M.EntityList, Ai = M.Ai, W = M.World, CH = M.CH;

// ── golden ──────────────────────────────────────────────────────────────────────────────────
const golden = new Map();
for (const l of readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const f = l.split('\t');
  if (!golden.has(f[0])) golden.set(f[0], []);
  golden.get(f[0]).push({ sel: f[1] === 'targetSelector' ? 'T' : 'G', pri: +f[2], goal: f[3], args: f[4] || '' });
}
// jar goal -> engine goal names it may be called (the only typed table; everything else is read)
const ALIAS = { PandaRevengeGoal: ['RevengeGoal'], PounceAtTargetGoal: ['PounceAtTargetGoal', 'LeapAtTargetGoal'], SwimGoal: ['FloatGoal', 'SwimGoal'], EscapeDangerGoal: ['PanicGoal', 'EscapeDangerGoal'], AnimalMateGoal: ['BreedGoal'], TrackOwnerAttackerGoal: ['OwnerHurtByTargetGoal'], AttackWithOwnerGoal: ['OwnerHurtTargetGoal'], PandaEscapeDangerGoal: ['PanicGoal'], FoxSwimGoal: ['FloatGoal', 'SwimGoal'], PandaMateGoal: ['MateGoal'], MateGoal: ['BreedGoal'],
  FleeEntityGoal: ['AvoidEntityGoal'], CatFleeGoal: ['AvoidEntityGoal'], FleeGoal: ['AvoidEntityGoal'], OcelotTemptGoal: ['TemptGoal'], PandaFleeGoal: ['AvoidEntityGoal'], DefendFriendGoal: ['NearestAttackableTargetGoal'], 'FoxEntity.EscapeWhenNotAggressiveGoal': ['PanicGoal'], EscapeWhenNotAggressiveGoal: ['PanicGoal'], WanderAroundFarGoal: ['WaterAvoidingRandomStrollGoal', 'WanderAroundFarGoal', 'WanderAroundGoal', 'IronGolemWanderAroundGoal'],
  WanderAroundGoal: ['WaterAvoidingRandomStrollGoal', 'WanderAroundFarGoal', 'WanderAroundGoal'], LookAtEntityGoal: ['LookAtPlayerGoal', 'LookAtMobGoal', 'LookAtEntityGoal'],
  LookAroundGoal: ['RandomLookAroundGoal', 'LookAroundGoal'], RevengeGoal: ['HurtByTargetGoal', 'RevengeGoal', 'SpitRevengeGoal'],
  LookAtTargetOrWololoTarget: ['LookAtTargetGoal'],
  BeeRevengeGoal: ['HurtByTargetGoal'], PolarBearEscapeDangerGoal: ['EscapeDangerGoal'], PolarBearRevengeGoal: ['RevengeGoal'], AttackGoal: ['SpiderAttackGoal', 'MeleeAttackGoal', 'VindicatorAttackGoal'], TargetGoal: ['SpiderTargetGoal', 'VindicatorTargetGoal'], WanderAroundOnSurfaceGoal: ['GoToWaterGoal'],
  TridentAttackGoal: ['RangedBowAttackGoal'], DrownedAttackGoal: ['ZombieAttackGoal', 'MeleeAttackGoal'],
  TargetAboveWaterGoal: ['SwimUpGoal'],
  StopAndLookAtEntityGoal: ['LookAtPlayerGoal'],   // LookAtEntityGoal(Player,3,1) with MOVE|LOOK controls (wandering_trader)
  LookAtTargetGoal: ['VexLookAtTargetGoal'],
  LeaveWaterGoal: ['GoToBeachGoal'],
  HoldInHandsGoal: ['DrinkInvisibilityGoal', 'DrinkMilkGoal'],   // wandering_trader: HoldInHandsGoal.call()ed by two thin subclasses
  AvoidLlamaGoal: ['AvoidEntityGoal'],
  LongDoorInteractGoal: ['VindicatorLongDoorInteractGoal'],
  BreakDoorGoal: ['BreakDoorGoal', 'VindicatorBreakDoorGoal'],
  TurtleEscapeDangerGoal: ['EscapeDangerGoal'],
  $$0: ['GoToWalkTargetGoal'],   // guardian/elder: the jar adds a local `GoToWalkTargetGoal $$0` (GuardianEntity.initGoals)
  AttackWithOwnerGoal: ['OwnerHurtTargetGoal'],   // wolf T2 (bfq)
  TridentAttackGoal: ['ProjectileAttackGoal'],   // drowned (#2821)
  TrackOwnerAttackerGoal: ['OwnerHurtByTargetGoal'],   // wolf T1 (bfp)
  WolfEscapeDangerGoal: ['PanicGoal'],   // wolf: src uses Ai.PanicGoal with a powder-snow/fire-only inDanger
  StingTargetGoal: ['NearestAttackableTargetGoal', 'AngryPlayerTargetGoal'], ActiveTargetGoal: ['NearestAttackableTargetGoal', 'AngryPlayerTargetGoal', 'ActiveTargetGoal', 'PlayerTargetGoal', 'TargetGoal'], UntamedActiveTargetGoal: ['NearestAttackableTargetGoal', 'ActiveTargetGoal'],
  MeleeAttackGoal: ['MeleeAttackGoal'], ZombieAttackGoal: ['ZombieAttackGoal', 'MeleeAttackGoal'], UniversalAngerGoal: ['UniversalAngerGoal', 'ResetAngerGoal'] };
const last = (n) => n.split('.').pop(), qual = (n) => n.includes('.') ? n.split('.')[0].replace(/Entity$/, '') : '';
const norm = (s) => s.replace(/[^A-Za-z]/g, '').toLowerCase();

// ── engine: constructor -> every "Ns.Key" it is bound to (reverse lookup over the module namespaces) ──
const ctorNames = new Map(), classNames = new Set();
for (const ns of Object.keys(M)) {
  const o = M[ns]; if (!o || (typeof o !== 'object' && typeof o !== 'function')) continue;
  let keys; try { keys = Object.keys(o); } catch (x) { continue; }
  for (const k of keys) {
    if (!/Goal$|^Goal/.test(k) && !/Goal/.test(k)) continue;
    let v; try { v = o[k]; } catch (x) { continue; }
    if (typeof v !== 'function') continue;
    v = v.__orig || v;   // #6255 wrapped Ai.*Goal ctors: instances carry the original
    if (!ctorNames.has(v)) ctorNames.set(v, []);
    ctorNames.get(v).push(ns + '.' + k); classNames.add(k);
  }
}
function names(goal) {
  const g = goal.inner || goal, out = new Set();
  for (const c of [g.constructor, goal.constructor]) for (const n of ctorNames.get(c) || []) out.add(n);
  if (g.auditName) out.add(g.auditName);
  return [...out];
}
/** does the engine goal named `en` (list of Ns.Key) stand for jar goal `y`? */
function stands(en, y) {
  const cand = (ALIAS[last(y)] || []).concat(last(y));
  return en.some((n) => { const k = last(n), ns = n.split('.')[0];
    if (!cand.includes(k)) return false;
    const q = qual(y); return !q || ns === 'Ai' || ns === 'Spell' || (ns === 'WT' && q === 'WanderingTrader') || (ns === 'Undead' && (q === 'Zombie' || q === 'Drowned' || k === 'GoToWaterGoal' || k === 'GoToBeachGoal')) || (ns === 'Fly' && q === 'Parrot') || (ns === 'Llama' && q === 'TraderLlama') || norm(ns) === norm(q) || norm(ns).startsWith(norm(q)) || norm(q).startsWith(norm(ns)); });
}
const jarKnown = (y) => { const cand = (ALIAS[last(y)] || []).concat(last(y)); return cand.some((c) => classNames.has(c)); };

// ── build every rostered entity ──────────────────────────────────────────────────────────────
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const STONE = M.States.stateOf('stone') | 0;
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 8, z, STONE);
const built = new Map();   // type -> [{sel, pri, names}] | null (no roster) | 'threw'
for (const t of roster) {
  const fish = !Ai.ROSTER[t] && M.Fish.isFishType(t);   // fish carry e.fishGoals (Fish.buildGoals), not Ai.ROSTER
  if (!Ai.ROSTER[t] && !fish) { built.set(t, null); continue; }
  let e; try { e = EL.spawn(t, 0, 9, 0); if (fish && e) e.ai = M.Fish.buildGoals(e); } catch (x) { built.set(t, 'threw'); continue; }
  if (!e || !e.ai) { built.set(t, 'threw'); continue; }
  built.set(t, e.ai.entries.map((en) => ({ sel: ((en.flags & Ai.TARGET) || (en.goal && en.goal instanceof Ai.UniversalAngerGoal)) ? 'T' : 'G', pri: en.priority, names: names(en.goal) })));
}

const SKEL_DYNAMIC = /^(skeleton|stray|wither_skeleton)$/;
/** the whole audit as ledger keys + the count of ok rows */
function audit(roster, golden, built) {
  const keys = new Set(); let okRows = 0, rows = 0;
  for (const t of roster) {
    const g = golden.get(t) || [], b = built.get(t);
    if (!g.length) continue;
    if (b === null) { keys.add(t + '|unrostered|*'); rows += g.length; continue; }
    if (b === 'threw') { keys.add(t + '|threw|*'); rows += g.length; continue; }
    const pool = b.slice(), unmatched = [];
    for (const r of g) {   // exact (selector, priority, class) first
      rows++;
      const i = pool.findIndex((x) => x.sel === r.sel && x.pri === r.pri && stands(x.names, r.goal));
      if (i >= 0) { pool.splice(i, 1); okRows++; } else unmatched.push(r);
    }
    for (const r of unmatched) {
      const i = pool.findIndex((x) => x.sel === r.sel && stands(x.names, r.goal));
      if (i >= 0) { keys.add(`${t}|priority|${r.sel}${r.pri}:${r.goal}`); pool.splice(i, 1); }
      else keys.add(`${t}|${jarKnown(r.goal) ? 'missing' : 'noclass'}|${r.sel}${r.pri}:${r.goal}`);
    }
    for (const x of pool) {   // engine rows the jar does not have, for a class the golden names at all
      const jar = [...golden.values()].flat().some((r) => stands(x.names, r.goal));
      if (SKEL_DYNAMIC.test(t) && /^Ai\.BowAttackGoal$/.test(x.names[0])) continue;   // the jar adds bow/melee in updateAttackType(), not initGoals()
      // jar adds BreakDoorGoal at runtime (ZombieEntity.setCanBreakDoors) for mobs whose MoveThroughVillageGoal takes this::canBreakDoors
      if (x.names.some((n) => last(n) === 'BreakDoorGoal') && g.some((r) => /canBreakDoors/.test(r.args))) continue;
      if (jar && x.names.length) keys.add(`${t}|extra|${x.sel}${x.pri}:${x.names[0]}`);
    }
  }
  return { keys, okRows, rows };
}
const R = audit(roster, golden, built);
const mobs = roster.filter((t) => (golden.get(t) || []).length);
console.log(`roster ${roster.length} types, ${mobs.length} with jar goals: ${R.rows} golden rows, ${R.okRows} ok, ${R.keys.size} ledger keys`);
const by = {}; for (const k of R.keys) by[k.split('|')[1]] = (by[k.split('|')[1]] || 0) + 1;
console.log('  ' + Object.entries(by).map(([k, v]) => k + ' ' + v).join(', '));
if (PRINT) for (const k of [...R.keys].sort()) console.log('  ' + k);

// ── ratchet ──────────────────────────────────────────────────────────────────────────────────
let pass = 0, caught = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 80) fails.push(m); return c; };
const KP = join(ROOT, 'tools/goalaudit-known.json');
const known = existsSync(KP) ? JSON.parse(readFileSync(KP, 'utf8')) : { keys: [] };
function ratchet(keys, K) {
  const out = [], ks = new Set(K.keys);
  for (const k of keys) if (!ks.has(k)) out.push('NEW ' + k);
  for (const k of ks) if (!keys.has(k)) out.push('GONE ' + k + ' — fixed: delete it from tools/goalaudit-known.json');
  return out;
}
if (process.argv.includes('--write')) { writeFileSync(KP, JSON.stringify({ _: 'goalaudit ledger (#1535): mob|status|goal keys that differ from registerGoals(); may only shrink', keys: [...R.keys].sort(), filed: known.filed || [] }, null, 1) + '\n'); console.log('wrote ' + KP); process.exit(0); }
const rep = ratchet(R.keys, known);
for (const f of rep) ok(false, f);
ok(mobs.length >= 60, 'at least 60 roster types carry jar goals (got ' + mobs.length + ')');
ok(R.okRows >= 300, 'at least 300 golden rows matched (got ' + R.okRows + ')');
for (const t of ['zombie', 'cow', 'creeper', 'wolf', 'sheep']) ok(![...R.keys].some((k) => k.startsWith(t + '|')) || known.keys.some((k) => k.startsWith(t + '|')), t + ' regressed');

// ── break proof: corrupt one input, the ratchet must report a NEW key ────────────────────────
const clone = (x) => JSON.parse(JSON.stringify(x));
const BREAKS = [
  ['a goal dropped from the engine list', () => { const b = new Map(built); b.set('zombie', built.get('zombie').filter((x) => !(x.sel === 'G' && x.pri === 2))); return ratchet(audit(roster, golden, b).keys, known); }],
  ['an engine priority moved', () => { const b = new Map(built); b.set('cow', built.get('cow').map((x, i) => i ? x : { ...x, pri: x.pri + 5 })); return ratchet(audit(roster, golden, b).keys, known); }],
  ['a jar row added', () => { const g = new Map(golden); g.set('cow', golden.get('cow').concat({ sel: 'G', pri: 3, goal: 'MeleeAttackGoal' })); return ratchet(audit(roster, g, built).keys, known); }],
  ['a jar goal nobody built', () => { const g = new Map(golden); g.set('cow', golden.get('cow').concat({ sel: 'G', pri: 3, goal: 'NoSuchEntity.ZzzGoal' })); return ratchet(audit(roster, g, built).keys, known); }],
  ['a roster mob loses its ROSTER function', () => { const b = new Map(built); b.set('sheep', null); return ratchet(audit(roster, golden, b).keys, known); }],
  ['an engine-only goal appears', () => { const b = new Map(built); b.set('cow', built.get('cow').concat({ sel: 'G', pri: 99, names: ['Ai.FloatGoal'] })); return ratchet(audit(roster, golden, b).keys, known); }],
  ['a new roster type', () => ratchet(audit(roster.concat('warden'), new Map(golden).set('warden', [{ sel: 'G', pri: 1, goal: 'SwimGoal' }]), new Map(built).set('warden', null)).keys, known)],
  ['a stale ledger entry', () => ratchet(R.keys, { keys: known.keys.concat('cow|missing|G9:Zzz') })],
];
for (const [label, f] of BREAKS) { const r = f(); if (ok(r.length > 0, 'break not caught: ' + label)) { caught++; console.log(' ✓ ' + label + ': ' + r[0]); } }

// #3018 start-roll rate: vanilla nextInt(toGoalTicks(7)=4) once per 2-tick pass = 1/(2*ceilDiv(n,2)) = 1/8 per tick
{
  const N = 80000, want = 1 / (2 * Math.ceil(7 / 2));
  const rate = (mk, makeGoal) => { let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 32 === 0 ? 0 : (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const e = { flyMove: { isMoving: () => false }, target: { x: 10, y: 0, z: 0 }, x: 0, y: 0, z: 0 };
    const g = makeGoal(e, { random: rnd }); let h = 0; for (let i = 0; i < N; i++) if (g.canUse()) h++; return h / N; };
  const check = (r) => Math.abs(r - want) < 0.006;
  for (const n of ['ChargeTargetGoal', 'VexLookAtTargetGoal']) {
    const r = rate(0, (e, c) => new Ai[n](e, c));
    ok(check(r), `${n} start rate ${r.toFixed(4)} != 1/8`);
    // break: the old 1/7 roll must be rejected by the same tolerance
    if (ok(!check(1 / 7), 'break not caught: 1/7 rate')) caught++;
  }
}

if (FILE) {   // file ledger + NEW findings, one bug per mob+goal class, <=30 a run, mob-family order; `filed` in the ledger stops re-filing
  const filed = new Set(known.filed || []), todo = new Map();
  for (const k of [...known.keys, ...rep.filter((f) => f.startsWith('NEW ')).map((f) => f.slice(4))].sort()) {
    const [t, st, g] = k.split('|'), id = t + '|' + (g.split(':')[1] || g);
    if (!filed.has(id) && !todo.has(id)) todo.set(id, `${t}: ${st} ${g}`);
  }
  let n = 0;
  for (const [id, line] of todo) {
    if (n++ >= 30) break;
    const r = spawnSync('node', ['tools/go.mjs', 'bug', '--title', `goalaudit: ${line}`, '--labels', 'bug,mobs', '--dedupe', 'goalaudit:' + id,
      '--body', `tools/goalaudit.mjs: ${line} differs from the jar's registerGoals() (tools/golden/goals-1.18.2.tsv).`], { cwd: ROOT, stdio: 'inherit' });
    if (r.status === 0) filed.add(id); else console.log('FILE FAILED ' + id);
  }
  writeFileSync(KP, JSON.stringify({ ...known, filed: [...filed].sort() }, null, 1) + '\n');
  console.log(`filed ${Math.min(todo.size, 30)} of ${todo.size} outstanding`);
}
if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.slice(0, 40).forEach((f) => console.log(' x ' + f)); }
console.log(`\ngoalaudit: ${pass} assertions, ${fails.length} failures, ${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
