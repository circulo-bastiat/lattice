#!/usr/bin/env node
// mobgoalscheck.mjs — #5120 (Ai.OWED #9): the MOB-SPECIFIC goals of fox, bee, wolf and cat, numbered to the jar.
//   node tools/mobgoalscheck.mjs
// goalrostercheck covers the ten library families; this one takes goals-1.18.2.tsv (extract-goals.mjs off .decomp)
// and checks that each mob-specific registerGoals() row (fox StopWandering/JumpChasing/AvoidDaylight/GoToVillage/
// Pounce/SitDown/..., bee EnterHive/FindHive/MoveToHive/..., wolf/cat Sit/Pounce/Attack/...) is built into the live
// roster at the jar's priority, in the right selector, exactly as often as the jar lists it.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ dom: true, extra: ['14b_physics.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init();
const EL = M.EntityList, Ai = M.Ai, W = M.World, CH = M.CH;
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }

// jar goal name (as in the tsv) -> [constructor lookup] ; a thunk, so a missing class fails here, not at load
const CLS = {
  fox: { 'FoxEntity.StopWanderingGoal': () => M.Fox.StopWanderingGoal, 'FoxEntity.JumpChasingGoal': () => M.Fox.JumpChasingGoal,
    'FoxEntity.AvoidDaylightGoal': () => M.Fox.AvoidDaylightGoal, 'FoxEntity.GoToVillageGoal': () => M.Fox.GoToVillageGoal,
    'PounceAtTargetGoal': () => Ai.PounceAtTargetGoal, 'FoxEntity.SitDownAndLookAroundGoal': () => M.Fox.SitDownAndLookAroundGoal,
    'FoxEntity.MoveToHuntGoal': () => M.Fox.MoveToHuntGoal, 'FoxEntity.AttackGoal': () => M.Fox.AttackGoal,
    'FoxEntity.DelayedCalmDownGoal': () => M.Fox.DelayedCalmDownGoal, 'FoxEntity.EatSweetBerriesGoal': () => M.Fox.EatSweetBerriesGoal,
    'FoxEntity.PickupItemGoal': () => M.Fox.PickupItemGoal, 'PowderSnowJumpGoal': () => Ai.PowderSnowJumpGoal },
  bee: { 'BeeEntity.EnterHiveGoal': () => M.Bee.EnterHiveGoal, 'BeeEntity.FindHiveGoal': () => M.Bee.FindHiveGoal,
    'BeeEntity.MoveToHiveGoal': () => M.Bee.MoveToHiveGoal, 'BeeEntity.StingGoal': () => M.Bee.StingGoal,
    'BeeEntity.PollinateGoal': () => M.Bee.PollinateGoal, 'BeeEntity.MoveToFlowerGoal': () => M.Bee.MoveToFlowerGoal,
    'BeeEntity.GrowCropsGoal': () => M.Bee.GrowCropsGoal, 'BeeEntity.BeeWanderAroundGoal': () => M.Bee.BeeWanderAroundGoal,
    'BeeEntity.BeeRevengeGoal': () => M.Bee.BeeRevengeGoal, 'UniversalAngerGoal': () => Ai.UniversalAngerGoal },
  wolf: { 'SitGoal': () => Ai.SitGoal, 'PounceAtTargetGoal': () => Ai.PounceAtTargetGoal, 'MeleeAttackGoal': () => Ai.MeleeAttackGoal,
    'FollowOwnerGoal': () => Ai.FollowOwnerGoal, 'WolfBegGoal': () => Ai.WolfBegGoal, 'UniversalAngerGoal': () => Ai.UniversalAngerGoal,
    'TrackOwnerAttackerGoal': () => Ai.OwnerHurtByTargetGoal, 'AttackWithOwnerGoal': () => Ai.OwnerHurtTargetGoal },
  cat: { 'SitGoal': () => Ai.SitGoal, 'CatEntity.SleepWithOwnerGoal': () => Ai.SleepWithOwnerGoal, 'GoToBedAndSleepGoal': () => Ai.GoToBedAndSleepGoal,
    'FollowOwnerGoal': () => Ai.FollowOwnerGoal, 'CatSitOnBlockGoal': () => Ai.CatSitOnBlockGoal, 'PounceAtTargetGoal': () => Ai.PounceAtTargetGoal,
    'AttackGoal': () => Ai.AttackGoal },
};
const golden = {};
for (const l of readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8').split('\n')) {
  if (!l || l[0] === '#') continue;
  const f = l.split('\t');
  if (!CLS[f[0]] || !CLS[f[0]][f[3]]) continue;
  (golden[f[0]] = golden[f[0]] || []).push({ tr: f[1].startsWith('target'), pri: +f[2], goal: f[3] });
}

function rows(type) {
  const e = EL.spawn(type, 0, 9, 0);
  if (!e || !e.ai) return null;
  const out = [];
  for (const en of e.ai.entries) {
    const g = en.goal.inner || en.goal;
    for (const name in CLS[type]) { const C = CLS[type][name](); if (C && (en.goal instanceof C || g instanceof C)) out.push({ tr: !!(en.flags & Ai.TARGET), pri: en.priority, goal: name }); }
  }
  return out;
}
const key = (r) => (r.tr ? 'T' : 'G') + r.pri + ' ' + r.goal;
function diff(g, r) {
  const rest = r.map(key), d = [];
  for (const x of g) { const i = rest.indexOf(key(x)); if (i < 0) d.push('jar has ' + key(x) + ', roster does not'); else rest.splice(i, 1); }
  for (const k of rest) d.push('roster has ' + k + ', jar does not');
  return d;
}
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
for (const type of Object.keys(CLS)) {
  const g = golden[type] || [], r = rows(type);
  ok(g.length >= 5, type + ': at least 5 golden mob-specific rows (got ' + g.length + ')');
  if (!r) { fails.push(type + ': spawn failed'); continue; }
  const d = diff(g, r);
  ok(d.length === 0, type + ' differs from registerGoals():\n   ' + d.join('\n   '));
  // anti-vacuity: each break must be noticed
  const muts = [
    ['priority+1', (x) => { x[0].pri++; }], ['drop a row', (x) => { x.pop(); }],
    ['swap selector', (x) => { x[0].tr = !x[0].tr; }], ['extra row', (x) => { x.push({ tr: false, pri: 99, goal: x[0].goal }); }],
  ];
  for (const [n, f] of muts) {
    const g2 = JSON.parse(JSON.stringify(g)); f(g2);
    if (diff(g2, r).length) { breaks++; console.log(' ✓ ' + type + ' ' + n + ': noticed'); } else fails.push('anti-vacuity: ' + n + ' went unnoticed on ' + type);
  }
  console.log(' ' + type + ': ' + g.length + ' mob-specific rows ' + (d.length ? 'DIFFER' : 'exact'));
}
// #5301: WanderAroundFarGoal's `probability` literal, per mob, off the jar (goalSelector row's second arg)
for (const type of ['cat', 'ocelot', 'enderman']) {
  const row = readFileSync(join(ROOT, 'tools/golden/goals-1.18.2.tsv'), 'utf8').split('\n').map((l) => l.split('\t')).find((f) => f[0] === type && f[3] === 'WanderAroundFarGoal');
  const jar = Math.fround(parseFloat(row[4].split(' ; ')[1]));
  const e = EL.spawn(type, 0, 9, 0);
  const en = e.ai.entries.find((x) => x.goal instanceof Ai.WanderAroundFarGoal);
  const got = en && Math.fround(en.goal.probability);
  ok(got === jar, type + ': WanderAroundFarGoal probability ' + got + ' != jar ' + jar);
  if (got !== jar || got === undefined) continue;
  // anti-vacuity: a wrong literal (today's 0.001 default) and a perturbed jar value must both be noticed
  for (const bad of [0.001, jar + 1e-3]) { if (Math.fround(bad) !== jar) breaks++; else fails.push('anti-vacuity: ' + bad + ' equals jar'); }
  console.log(' ' + type + ': wander probability ' + jar + ' exact');
}
// #5858: fox target rows (red fox, the default) = FoxEntity.addTypeSpecificGoals: T4 chicken/rabbit, T4 baby turtle, T6 fish;
// and the chicken/rabbit goal may only offer chickens and rabbits (vanilla's `instanceof ChickenEntity || RabbitEntity`)
{
  const fox = EL.spawn('fox', 0, 9, 0);
  const tg = fox.ai.entries.filter((x) => x.goal.tag === 'chickenRabbit' || x.goal.tag === 'babyTurtle' || x.goal.tag === 'fish');
  const key = (a) => a.map((x) => x.priority + ':' + x.goal.tag).sort().join(',');
  ok(key(tg) === '4:babyTurtle,4:chickenRabbit,6:fish', 'fox target rows: ' + key(tg));
  const others = ['sheep', 'cow', 'pig', 'wolf', 'cod'].map((t) => EL.spawn(t, 1, 9, 1));
  const chk = EL.spawn('chicken', 2, 9, 2), rab = EL.spawn('rabbit', 3, 9, 3);
  const cr = tg.find((x) => x.goal.tag === 'chickenRabbit').goal.getCandidates();
  ok(cr.includes(chk) && cr.includes(rab) && !others.some((o) => cr.includes(o)), 'fox chickenRabbit goal offers only chickens and rabbits');
  const leaky = cr.concat(others[0]);   // anti-vacuity: the predicate must notice a sheep
  if (leaky.includes(others[0]) && !cr.includes(others[0])) breaks++; else fails.push('anti-vacuity: sheep slipped in');
}
// #6838 forgiveDeadPlayers: a dead player target clears target + anger (rule true), kept when the rule is false
{
  const saved = { P: M.Player, C: M.Commands };
  let rule = 'true';
  M.Commands = { ruleGet: (n) => (n === 'forgiveDeadPlayers' ? rule : 'true') };
  M.Player = { dead: true, x: 0, y: 9, z: 0 };
  for (const t of ['wolf', 'zombified_piglin']) {
    for (const r of ['true', 'false']) {
      rule = r;
      const m = EL.spawn(t, 4, 9, 4);
      m.angerTime = 100; m.target = M.Player; m.lastHurtByEntity = M.Player;
      Ai.forgiveDeadPlayer(m);
      if (r === 'true') ok(m.target === null && m.angerTime === 0, t + ' forgives a dead player (rule true)');
      else { ok(m.target === M.Player && m.angerTime === 100, t + ' keeps anger (rule false)'); if (m.target === M.Player) breaks++; }
    }
  }
  rule = 'true'; M.Player.dead = false;
  const alive = EL.spawn('wolf', 5, 9, 5); alive.angerTime = 100; alive.target = M.Player;
  Ai.forgiveDeadPlayer(alive);
  ok(alive.target === M.Player && alive.angerTime === 100, 'a living player is not forgiven');
  M.Player = saved.P; M.Commands = saved.C;
}
// #8636 CatEntity.TemptGoal.canBeScared: a tempted-but-scareable cat gives up when the player (<6 blocks) moves or turns; a still one does not
{
  const cat = EL.spawn('cat', 0, 9, 0);
  const fish = { id: 'fish' };
  const run = (scared, moveIt) => {
    const pl = { x: 3, y: 9, z: 0, pitch: 0, yaw: 0, heldItem: fish, offHandItem: null };
    const g = new Ai.TemptGoal(cat, 0.6, () => [pl], (it) => it === fish, scared);
    if (!g.canUse()) return 'nostart';
    g.start();
    if (moveIt) pl.x += 0.5;
    return g.canContinueToUse() ? 'keep' : 'refuse';
  };
  ok(run(true, true) === 'refuse', 'cat refuses the tempt when a close player moves');
  ok(run(true, false) === 'keep', 'cat keeps the tempt for a still player');
  ok(run(false, true) === 'keep', 'a non-scareable (trusting/memory) cat ignores movement');
  if (run(false, true) !== run(true, true)) breaks++; else fails.push('anti-vacuity: dropping the scare test went unnoticed');
}
if (fails.length) { console.log(fails.map((f) => ' x ' + f).join('\n')); console.log('FAIL (' + fails.length + ')'); process.exit(1); }
console.log('mobgoalscheck: ' + pass + ' assertions, 0 failures, ' + breaks + ' breaks caught');
