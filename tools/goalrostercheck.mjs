#!/usr/bin/env node
// goalrostercheck.mjs — #213 (G18b-2), Ai.OWED D-383. Ai.ROSTER against the jar's registerGoals().
//
//   node tools/goalrostercheck.mjs [--verbose]
//
// The answer key is tools/golden/goals-1.18.2.tsv (tools/extract-goals.mjs, every mob's initGoals() read
// out of .decomp). For every entity that has BOTH a golden row set and an `Ai.ROSTER` entry, the roster is
// really built (`EL.spawn`, so `EL.aiCtx` is the live one) with every `Ai.*Goal` constructor wrapped to
// record its arguments, and each of these families is compared as (priority, family, parameters):
//
//   SwimGoal=FloatGoal · EscapeDangerGoal=PanicGoal(speed) · AnimalMateGoal=BreedGoal(speed) ·
//   TemptGoal(speed, item set) · FollowParentGoal(speed) · FleeEntityGoal=AvoidEntityGoal(range, slow, fast) ·
//   WanderAroundFarGoal=WaterAvoidingRandomStrollGoal(speed) · LookAtEntityGoal(Player)=LookAtPlayerGoal(range) ·
//   LookAroundGoal=RandomLookAroundGoal · RevengeGoal=HurtByTargetGoal (priority)
//
// A TemptGoal's ITEM SET is the jar's `Ingredient.ofItems(...)` list; the roster's is whatever its
// `isTempting` callback accepts over every item any golden ingredient names. A mob whose ingredient is a
// TAG (bee, axolotl) is compared on speed/priority only. Mismatches the engine has not fixed yet are listed
// in KNOWN (with the reason) so the check is green and the gap stays named; a KNOWN row that STOPS
// mismatching fails, so the list cannot rot.
import { readFileSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');
console.log('goalrostercheck — Ai.ROSTER vs the jar\'s registerGoals() (goals-1.18.2.tsv)');

// every 07* main-thread module, in build.mjs's own order (a roster entry may reach into any of them)
const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ dom: true, extra: ['14b_physics.js'].concat(MODS.filter((f) => f !== '07_world.js').length ? ['07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) : []) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const EL = M.EntityList, Ai = M.Ai, W = M.World, CH = M.CH;

// ── the committed golden is what .decomp says (only where .decomp exists: it is a placed data dir, not committed)
if (existsSync(join(ROOT, '.decomp', 'names.tsv'))) {
  const tmp = join(mkdtempSync(join(tmpdir(), 'goals-')), 'goals.tsv');
  execFileSync(process.execPath, [join(ROOT, 'tools/extract-goals.mjs'), '--out', tmp], { stdio: 'ignore' });
  if (readFileSync(tmp, 'utf8') !== readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8')) { console.log(' x tools/golden/goals-1.18.2.tsv is stale — run node tools/extract-goals.mjs'); process.exit(1); }
  console.log(' golden re-extracted from .decomp: identical');
} else console.log(' (no .decomp here: golden taken as committed)');

// ── golden ──────────────────────────────────────────────────────────────────────────────────
const golden = new Map();   // entity -> rows [{sel, pri, goal, args:[..]}]
for (const l of readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const f = l.split('\t');
  if (!golden.has(f[0])) golden.set(f[0], []);
  golden.get(f[0]).push({ sel: f[1], pri: +f[2], goal: f[3], args: f[4] ? f[4].split(' ; ') : [], fam: f[5] === 'WanderAroundGoal' ? 'WanderAroundFarGoal' : (f[5] || '') });   // Ai has ONE stroll class; far vs near is a water-avoidance detail
}
const num = (s) => parseFloat(String(s).replace(/F$/, ''));
const ingItems = (s) => { const m = /^Ingredient\.ofItems\((.*)\)$/.exec(s); return m ? m[1].split(', ').map((x) => x.replace(/^(item|block):/, '')) : null; };

// yarn goal -> the Ai constructor that stands for it
const FAMILY = { SwimGoal: 'FloatGoal', EscapeDangerGoal: 'PanicGoal', AnimalMateGoal: 'BreedGoal', TemptGoal: 'TemptGoal',
  FollowParentGoal: 'FollowParentGoal', FleeEntityGoal: 'AvoidEntityGoal', WanderAroundFarGoal: 'WaterAvoidingRandomStrollGoal',
  LookAtEntityGoal: 'LookAtPlayerGoal', LookAroundGoal: 'RandomLookAroundGoal', RevengeGoal: 'HurtByTargetGoal' };
// aliases and later variants of the same library goal (Ai.SwimGoal = FloatGoal's twin, Ai.RevengeGoal = the raid-group HurtByTargetGoal)
const ALSO = { SwimGoal: 'SwimGoal', RevengeGoal: 'RevengeGoal', SpitRevengeGoal: 'RevengeGoal', IronGolemWanderAroundGoal: 'WanderAroundFarGoal', WanderAroundFarGoal: 'WanderAroundFarGoal', WanderAroundGoal: 'WanderAroundFarGoal' };
const INV = {}; for (const k in FAMILY) INV[FAMILY[k]] = k;
for (const k in ALSO) INV[k] = ALSO[k];

// the item universe: every item any golden TemptGoal ingredient names
const UNIVERSE = new Set();
for (const rows of golden.values()) for (const r of rows) if (r.fam === 'TemptGoal') for (const i of ingItems(r.args[1]) || []) UNIVERSE.add(i);

// ── record every Ai.*Goal construction ──────────────────────────────────────────────────────
function record(holder, key, fam, speedFn) {
  const Orig = holder[key];
  holder[key] = function () {
    const a = Array.prototype.slice.call(arguments);
    const o = new (Function.prototype.bind.apply(Orig, [null].concat(a)))();
    o.__rec = { name: fam, args: speedFn ? [a[0], speedFn()] : a };   // speedFn: a goal that bakes its speed reads the module's own constant
    return o;
  };
}
for (const name of Object.keys(INV)) record(Ai, name, name);
// goal classes that live in a mob's own module but ARE a library goal (a[1] is the speed, as in Ai's)
record(M.Fly, 'EscapeDangerGoal', 'PanicGoal'); INV.PanicGoal = 'EscapeDangerGoal';
record(M.PolarBear, 'EscapeDangerGoal', 'PanicGoal', () => M.PolarBear.ESCAPE_SPEED);
record(M.Fox, 'FoxSwimGoal', 'FloatGoal');
record(M.Fox, 'MateGoal', 'BreedGoal'); record(M.Fox, 'LookAtEntityGoal', 'LookAtPlayerGoal'); record(M.Shulker, 'LookAtPlayerGoal', 'LookAtPlayerGoal'); record(Ai, 'WanderAroundPointOfInterestGoal', 'WaterAvoidingRandomStrollGoal');   // own-module / own-class goals that ARE a library goal (a[1] speed; look range is a[2])
record(M.Silverfish, 'WanderAndInfestGoal', 'WanderAroundGoal'); record(M.Turtle, 'MateGoal', 'BreedGoal'); record(M.Turtle, 'EscapeDangerGoal', 'PanicGoal'); record(M.Turtle, 'WanderOnLandGoal', 'WanderAroundGoal');   // #6409: own-module goals that take the jar speed as a[1]
record(M.Dolphin, 'SwimAroundGoal', 'WaterAvoidingRandomStrollGoal');
record(M.Panda, 'RevengeGoal', 'RevengeGoal'); record(M.Panda, 'LookAtEntityGoal', 'LookAtPlayerGoal'); record(M.PolarBear, 'RevengeGoal', 'RevengeGoal'); record(M.Bee, 'BeeRevengeGoal', 'RevengeGoal');

// ── what a roster entry says, as comparable rows ────────────────────────────────────────────
function rosterRows(type, e) {
  const rows = [];
  for (const en of e.ai.entries) {
    const r = en.goal.__rec || (en.goal.inner && en.goal.inner.__rec); if (!r) continue;
    const fam = INV[r.name], a = r.args;
    if (fam === 'LookAtEntityGoal' && en.goal.targetsNonPlayer) continue;   // mirrors goldenRows: the jar side keeps only LookAtEntityGoal(PlayerEntity.class)
    const row = { pri: en.priority, fam };
    if (['EscapeDangerGoal', 'AnimalMateGoal', 'FollowParentGoal', 'WanderAroundFarGoal'].includes(fam)) row.speed = a[1];
    else if (fam === 'TemptGoal') {
      row.speed = a[1];
      row.items = [...UNIVERSE].filter((it) => { try { return !!a[3](it); } catch (x) { return false; } }).sort();
    } else if (fam === 'FleeEntityGoal') { row.range = a[1]; row.slow = a[2]; row.fast = (a[5] && a[5].fastSpeed != null) ? a[5].fastSpeed : a[2]; }
    else if (fam === 'LookAtEntityGoal') row.range = a[2] == null ? Ai.LOOK_RANGE : a[2];
    if (fam === 'AnimalMateGoal' || fam === 'TemptGoal' || fam === 'LookAroundGoal') row.flags = en.flags;   // #3728
    rows.push(row);
  }
  return dedupeFlee(rows);
}
/** identical FleeEntityGoals (same priority/range/speeds) collapse: one Ai.AvoidEntityGoal serves several threat classes */
function dedupeFlee(rows) {
  const seen = new Set();
  return rows.filter((o) => {
    if (o.fam !== 'FleeEntityGoal') return true;
    const k = [o.pri, o.range, o.slow, o.fast].join('/'); if (seen.has(k)) return false; seen.add(k); return true;
  });
}
function goldenRows(rows) {
  const out = [];
  for (const r of rows) {
    if (!r.fam) continue;
    if (r.sel === 'targetSelector' && r.fam !== 'RevengeGoal') continue;
    if (r.sel === 'goalSelector' && r.fam === 'RevengeGoal') continue;
    if (r.fam === 'LookAtEntityGoal' && r.args[0] !== 'PlayerEntity.class') continue;
    const row = { pri: r.pri, fam: r.fam };
    if (['EscapeDangerGoal', 'AnimalMateGoal', 'FollowParentGoal', 'WanderAroundFarGoal'].includes(r.fam)) row.speed = num(r.args[0]);
    else if (r.fam === 'TemptGoal') { row.speed = num(r.args[0]); const it = ingItems(r.args[1]); if (it) row.items = it.slice().sort(); }
    else if (r.fam === 'FleeEntityGoal') {
      // (Class, [Predicate,] range, slow, fast) — the predicate forms carry an extra lambda arg
      const n = r.args.filter((x) => /^-?[\d.]+F?$/.test(x)).map(num);
      row.range = n[0]; row.slow = n[1]; row.fast = n[2] == null ? n[1] : n[2];
    } else if (r.fam === 'LookAtEntityGoal') row.range = num(r.args[1]);
    if (r.fam === 'AnimalMateGoal' || r.fam === 'TemptGoal' || r.fam === 'LookAroundGoal') row.flags = Ai.MOVE | Ai.LOOK;   // #3728: both setControls(MOVE, LOOK)
    out.push(row);
  }
  return dedupeFlee(out);   // creeper: FleeEntityGoal(ocelot) + FleeEntityGoal(cat) are one Ai.AvoidEntityGoal over both
}
const eq = (a, b) => (typeof a === 'number' && typeof b === 'number') ? Math.abs(a - b) < 1e-6 : JSON.stringify(a) === JSON.stringify(b);
const fmt = (r) => r.pri + ':' + r.fam + ['speed', 'range', 'slow', 'fast', 'items', 'flags'].filter((k) => r[k] !== undefined).map((k) => ' ' + k + '=' + (Array.isArray(r[k]) ? r[k].join('|') : r[k])).join('');
/** diffs between two row lists, order-insensitive within a (priority,family) key */
function compare(g, r) {
  const key = (x) => x.pri + ':' + x.fam;
  const rest = r.slice(), diffs = [];
  // rows with a tag ingredient carry no items on the golden side: ignore the roster's item list for them
  for (const x of g) {
    let hit = rest.findIndex((y) => key(y) === key(x) && Object.keys(x).every((k) => k === 'items' && x.items === undefined ? true : eq(x[k], y[k])));
    if (hit < 0) hit = rest.findIndex((y) => key(y) === key(x) && Object.keys(x).every((k) => eq(x[k], y[k])));
    if (hit >= 0) rest.splice(hit, 1); else diffs.push('golden ' + fmt(x) + '  <no equal roster row>');
  }
  for (const y of rest) diffs.push('roster ' + fmt(y) + '  <not in the jar>');
  return diffs;
}

// ── build every rostered entity, compare ────────────────────────────────────────────────────
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = M.States.stateOf('stone') | 0;
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) W.setBlock(x, 8, z, STONE);

// KNOWN: entity -> reason. Filled from the first run; every entry must still mismatch.
const KNOWN = JSON.parse(readFileSync(join(ROOT, 'tools/goalroster-known.json'), 'utf8'));
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const results = new Map(); let checked = 0, unrostered = [];
for (const [type, rows] of golden) {
  const g = goldenRows(rows);
  if (!g.length) continue;
  if (!Ai.ROSTER[type]) { unrostered.push(type); continue; }
  let e; try { e = EL.spawn(type, 0, 9, 0); } catch (x) { fails.push(type + ': EL.spawn threw ' + x.message); continue; }
  if (!e || !e.ai) { fails.push(type + ': spawned with no e.ai'); continue; }
  checked++;
  results.set(type, { g, r: rosterRows(type, e) });
}
for (const [type, { g, r }] of results) {
  const d = compare(g, r);
  if (VERBOSE || process.env.GRC_DUMP) console.log(type + ': ' + (d.length ? '\n   ' + d.join('\n   ') : 'exact'));
  if (KNOWN[type]) ok(d.length > 0, type + ' is listed KNOWN but now matches the jar — delete it from tools/goalroster-known.json');
  else ok(d.length === 0, type + ' differs from registerGoals():\n   ' + d.join('\n   '));
}
console.log(' ' + checked + ' rostered entities compared, ' + unrostered.length + ' golden entities have no roster entry (' + unrostered.join(',') + ')');
// #712: a mob with jar goal rows and no Ai.ROSTER function stands still (zombie_horse did). Only the water mobs are owed.
const UNROSTERED_OWED = new Set(['cod', 'pufferfish', 'salmon', 'tropical_fish']);
for (const t of unrostered) ok(UNROSTERED_OWED.has(t), t + ' has goal rows in goals-1.18.2.tsv but no Ai.ROSTER function (it would stand still)');
for (const t of UNROSTERED_OWED) ok(unrostered.includes(t), t + ' is listed owed-unrostered but is now rostered — remove it from UNROSTERED_OWED');
console.log(' ' + Object.keys(KNOWN).length + ' KNOWN mismatches held open');
// #1279: vanilla SwimGoal controls are JUMP only; a MOVE flag on it blocks the prio-2 attack/stroll goals in water.
{ const src = readFileSync(join(ROOT, 'src/07k_goals.js'), 'utf8');
  const bad = src.split('\n').filter(l => /Ai\.MOVE[^,]*,\s*new Ai\.FloatGoal\(/.test(l));
  ok(bad.length === 0, bad.length + ' roster FloatGoal registration(s) carry Ai.MOVE (vanilla SwimGoal is JUMP only)'); }
ok(checked >= 20, 'at least 20 rostered entities were compared (got ' + checked + ')');

// ── anti-vacuity: corrupt the golden in memory, the compare must notice each time ───────────
let breaks = 0, missed = 0;
function mut(label, f) {
  let hit = 0;
  for (const [type, { g, r }] of results) {
    if (KNOWN[type]) continue;
    const g2 = JSON.parse(JSON.stringify(g)); if (!f(g2)) continue;
    hit++;
    if (compare(g2, r).length) breaks++; else { missed++; fails.push('anti-vacuity: ' + label + ' went unnoticed on ' + type); }
  }
  ok(hit > 0, 'anti-vacuity: mutation "' + label + '" found at least one exact entity to corrupt');
  if (hit > 0) console.log(' ✓ ' + label + ': ' + hit + ' entities corrupted, all noticed');
}
mut('priority+1', (g) => { g[0].pri++; return true; });
mut('speed+0.1', (g) => { const x = g.find((y) => y.speed !== undefined); if (!x) return false; x.speed += 0.1; return true; });
mut('drop a row', (g) => { g.pop(); return true; });
mut('extra row', (g) => { g.push({ pri: 99, fam: 'SwimGoal' }); return true; });
mut('tempt item added', (g) => { const x = g.find((y) => y.items); if (!x) return false; x.items = x.items.concat('zzz'); return true; });
mut('tempt item dropped', (g) => { const x = g.find((y) => y.items && y.items.length); if (!x) return false; x.items = x.items.slice(1); return true; });
mut('flee range+1', (g) => { const x = g.find((y) => y.range !== undefined && y.fam === 'FleeEntityGoal'); if (!x) return false; x.range++; return true; });
mut('flee fast speed', (g) => { const x = g.find((y) => y.fast !== undefined); if (!x) return false; x.fast += 0.5; return true; });
mut('mate/tempt flags', (g) => { const x = g.find((y) => y.flags !== undefined); if (!x) return false; x.flags = 1; return true; });
mut('look range', (g) => { const x = g.find((y) => y.fam === 'LookAtEntityGoal'); if (!x) return false; x.range += 1; return true; });

// #6409: the silverfish / turtle goals step at the constructor speed they are handed (jar 1.0), x the movement attribute
{
  const stepped = [];
  const step0 = Ai.stepToward; Ai.stepToward = (e, t, sp) => { stepped.push(sp); };
  const probe = (mk, speed) => {
    stepped.length = 0;
    const e = { x: 0, y: 9, z: 0, inLove: 1, hasEgg: false, type: 'turtle' }, p = { x: 2, y: 9, z: 0, inLove: 1, type: 'turtle' };
    const g = mk(e, speed, { animals: () => [p], random: () => 0 });
    if (g.canUse()) { g.start(); g.tick(); }
    return stepped[0];
  };
  const jar = 1.0;
  ok(probe((e, s, c) => new M.Turtle.MateGoal(e, s, c), jar) === jar, 'turtle MateGoal steps at the jar speed 1.0');
  ok(probe((e, s, c) => new M.Turtle.MateGoal(e, s, c), 0.5) === 0.5, 'turtle MateGoal speed is the constructor argument');
  if (probe((e, s, c) => new M.Turtle.MateGoal(e, s, c), 0.5) !== jar) breaks++; else fails.push('anti-vacuity: speed 0.5 not observable');
  Ai.stepToward = step0;
  for (const t of ['silverfish', 'turtle']) {
    const e = EL.spawn(t, 0, 9, 0), want = t === 'turtle' ? 'BreedGoal' : 'WanderAroundGoal';
    ok(e.ai.entries.some((en) => (en.goal.__rec || (en.goal.inner && en.goal.inner.__rec) || {}).name === want && (en.goal.__rec || en.goal.inner.__rec).args[1] === 1.0), t + ' roster passes speed 1.0 to its own goal');
  }
}

// #1237: ZombieEntity.initCustomGoals' MoveThroughVillageGoal(1.0, true, 4) at priority 6 (zombie, husk, zombie_villager share it)
for (const t of ['zombie', 'husk', 'zombie_villager']) {
  const e = EL.spawn(t, 0.5, 70, 0.5);
  const gs = e && e.ai && e.ai.entries.filter((en) => en.goal instanceof Ai.MoveThroughVillageGoal && en.priority === 6);
  ok(gs && gs.length === 1, t + ' roster has a priority-6 MoveThroughVillageGoal');
  if (t === 'zombie') {   // anti-vacuity: break the roster in memory, the same assertion must notice
    const broken = e.ai.entries.filter((en) => !(en.goal instanceof Ai.MoveThroughVillageGoal));
    if (broken.filter((en) => en.goal instanceof Ai.MoveThroughVillageGoal && en.priority === 6).length === 0) breaks++;
    else fails.push('anti-vacuity: dropping the priority-6 goal went unnoticed');
  }
}

// #1611: PandaEscapeDangerGoal.isInDanger = shouldEscapePowderSnow() || isOnFire()
{
  const e = EL.spawn('panda', 0.5, 70, 0.5);
  const pg = e && e.ai && e.ai.entries.find((en) => en.priority === 2);   // first priority-2 row: the PanicGoal (goals arrive wrapped, so no instanceof)
  ok(!!pg, "panda roster has a priority-2 PanicGoal");
  if (pg) {
    const solid0 = M.Physics.solidAt; M.Physics.solidAt = () => true;   // the bare test world has no floor to flee over
    e.isOnFire = false; e.shouldEscapePowderSnow = () => false;
    const tries = (n) => { for (let i = 0; i < n; i++) if (pg.goal.canUse()) return true; return false; };
    const calm = tries(40);
    e.shouldEscapePowderSnow = () => true;
    ok(!calm && tries(40), 'panda flees when shouldEscapePowderSnow (and not otherwise)');
    e.shouldEscapePowderSnow = () => false;   // anti-vacuity: the old on-fire-only rule would have missed it
    if (!tries(40)) breaks++; else fails.push('anti-vacuity: powder-snow term not removable');
    M.Physics.solidAt = solid0;
  }
}

// #1870: CatEntity.TemptGoal.canStart requires !isTamed -- a tamed cat ignores a player holding cod
{
  const e = EL.spawn('cat', 0.5, 70, 0.5);
  const tg = e && e.ai && e.ai.entries.find((en) => en.priority === 3);
  ok(!!tg, 'cat roster has a priority-3 TemptGoal');
  if (tg) {
    const P0 = M.Player; M.Player = { x: 3.5, y: 70, z: 0.5, heldItem: 'cod' };
    const hold = (tamed) => { e.tamed = tamed; e.inLove = false; return tg.goal.canUse(); };
    const wild = hold(false), tamedUse = hold(true);
    ok(wild, 'untamed cat is tempted by cod (fixture sanity)');
    ok(!tamedUse, 'tamed cat is NOT tempted by cod');
    e.tamed = false;   // anti-vacuity: without the tamed gate the same call says yes
    if (hold(true) === false) breaks++; else fails.push('anti-vacuity: tamed gate not observable');
    M.Player = P0;
  }
}

// #3677: iron golem's priority-3 ActiveTargetGoal(Player,10,mustSee=true,shouldAngerAt): roll, sight, anger gate
{
  const e = EL.spawn('iron_golem', 0.5, 9, 0.5);
  const en = e && e.ai && e.ai.entries.find((x) => x.goal instanceof Ai.AngryPlayerTargetGoal);
  ok(!!en, 'iron_golem roster has an AngryPlayerTargetGoal');
  if (en) {
    const P0 = M.Player; M.Player = { x: 3.5, y: 9, z: 0.5, width: 0.6, height: 1.8, health: 20, eyeHeight: 1.62 };
    const cs = en.goal.inner.getCandidates;
    e.angerTime = 0; ok(cs().length === 0, 'golem not angry: no candidates');
    e.angerTime = 100; ok(cs().length === 1, 'golem angry: player is a candidate');
    // The roll is the entity's own seeded stream (Ai.rndOf), not Math.random: pinning Math.random flaked ~1 run in 10 (#9849).
    // So count over many tries: a 1/10 roll passes a few times and refuses most, an always-true or never-true gate is caught.
    let passes = 0; const N = 400;
    for (let i = 0; i < N; i++) { e.target = null; if (en.goal.canUse()) passes++; }
    ok(passes > 0 && passes < N * 0.35, 'AngryPlayerTargetGoal honours the 1/5 reciprocal roll (' + passes + '/' + N + ' pass)');
    if (passes > 0 && passes < N * 0.35) breaks++; else fails.push('anti-vacuity: roll gate not observable');
    e.target = null; M.Player = P0;
  }
}

// #4224: GoatBrain has no random-look task (only LookAroundTask + FollowMobTask(PLAYER)) -- no RandomLookAroundGoal on a goat
{
  const e = EL.spawn('goat', 0.5, 70, 0.5);
  const has = (x) => !!(x && x.ai && x.ai.entries.some((en) => en.goal.__rec && en.goal.__rec.name === 'RandomLookAroundGoal'));
  ok(!!(e && e.ai), 'goat is rostered');
  ok(!has(e), 'goat roster has no RandomLookAroundGoal');
  const c = EL.spawn('panda', 0.5, 70, 0.5);   // anti-vacuity: the probe does see one on a panda
  if (has(c)) breaks++; else fails.push('anti-vacuity: RandomLookAroundGoal probe finds nothing on a panda');
}

if (fails.length) { console.log('\nFAIL (' + fails.length + '):'); fails.slice(0, 40).forEach((f) => console.log(' x ' + f)); }
console.log('\ngoalrostercheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
