#!/usr/bin/env node
// catgoalcheck.mjs — #1315: CatEntity.initGoals' hunting goals (.decomp CatEntity.java:118-137): PounceAtTargetGoal(0.3F) @8,
// AttackGoal @9, WanderAroundFarGoal(0.8, 1.0000001E-5F) @11, targets UntamedActiveTarget(rabbit) / (baby turtle on land) @1.
//   node tools/catgoalcheck.mjs [--verbose]
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };


const M = loadEngine({
  extra: ['07_world.js', '07c_blockentity.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07r_mount.js', '07w_passive.js', '14i_hand.js', '14j_combat.js', '14d_survival.js']
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
M.EntityList.init();
M.Breed.init && M.Breed.init();
M.Mount.init();
M.Ai.init();
M.BlockEntities && M.BlockEntities.init && M.BlockEntities.init();
M.Combat.init();
ok(M.Entities.ready, 'the entity table loaded');
ok(M.Ai.ready, 'Ai module reports ready');

const EL = M.EntityList, Ai = M.Ai, W = M.World, CH = M.CH;
const stateOf = (n) => M.States.stateOf(n) | 0;
const STONE = stateOf('stone');
const PLAT_Y = 8;

function freshWorld() {
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const c = W.makeChunk(cx, cz);
    c.state = CH.GENERATED;
    W.chunks.set(W.key(cx, cz), c);
  }
  ok(W.loadedAt(0, 0), 'a chunk is loaded to place into');
}
function plate(radius) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) {
    W.setBlock(x, PLAT_Y, z, STONE);
  }
}
function mkPlayer(over) {
  return Object.assign({
    x: 0, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0, inventory: null,
    sprinting: false, onGround: true, fallDistance: 0, onClimbable: false, inWater: false,
    walkDist: 0, walkDistO: 0, speed: 0.1, heldItem: null
  }, over || {});
}
function entryAt(gs, priority, flags) {
  for (const en of gs.entries) if (en.priority === priority && en.flags === flags) return en;
  return null;
}

console.log('catgoalcheck — #1315 cat hunting goals');
freshWorld();
plate(15);
const cat = EL.spawn('cat', 0, PLAT_Y + 1, 0);
const rabbit = EL.spawn('rabbit', 3, PLAT_Y + 1, 0);
ok(!!cat && !!rabbit, 'a cat and a rabbit spawn');
const en = (pri, f) => cat.ai.entries.filter(x => x.priority === pri && (f === undefined || x.flags === f));
ok(en(8, Ai.MOVE | Ai.JUMP).some(x => x.goal instanceof Ai.PounceAtTargetGoal), 'cat has PounceAtTargetGoal at priority 8');
ok(en(9, Ai.MOVE | Ai.LOOK).some(x => x.goal instanceof Ai.AttackGoal), 'cat has AttackGoal at priority 9 (MOVE|LOOK)');
ok(en(11).some(x => x.goal instanceof Ai.WanderAroundFarGoal), 'cat wanders with WanderAroundFarGoal at priority 11');
const tg = en(1, Ai.TARGET);
ok(tg.length === 2 && tg.every(x => x.goal instanceof Ai.UntamedActiveTargetGoal), 'two UntamedActiveTargetGoals at target priority 1');
const has = (ents) => ents.some(x => x.goal instanceof Ai.PounceAtTargetGoal) && ents.some(x => x.goal instanceof Ai.AttackGoal) &&
  ents.filter(x => x.goal instanceof Ai.UntamedActiveTargetGoal).length === 2;
ok(has(cat.ai.entries), 'the full hunting roster is present');
for (const [name, bad] of [['pounce', x => x.goal instanceof Ai.PounceAtTargetGoal], ['attack', x => x.goal instanceof Ai.AttackGoal],
    ['rabbit target', x => x.goal instanceof Ai.UntamedActiveTargetGoal && x.priority === 1]]) {
  okAv(!has(cat.ai.entries.filter(x => !bad(x))), 'roster without ' + name + ' is caught');
}

cat.tamed = false; cat.target = null;
const rt = tg.some(x => { cat.target = null; for (let i = 0; i < 400; i++) if (x.goal.canUse()) return cat.target === rabbit; return false; });
ok(rt, 'an untamed cat acquires a nearby rabbit');
ok(tg.length >= 2 && tg.every(x => x.goal.reciprocalChance === 10 && x.goal.vertical === 4), 'cat UntamedActiveTarget goals carry reciprocalChance 10 + vertical 4 (#4149)');
okAv(!tg.every(x => { const g = new Ai.UntamedActiveTargetGoal(cat, () => [], () => 0); g.reciprocalChance = 0; return g.reciprocalChance === 10; }), 'a wrapper with the roll removed is caught (#4149)');
cat.tamed = true; cat.target = null;
ok(!tg.some(x => x.goal.canUse()), 'a TAMED cat does not hunt');
cat.tamed = false;

// AttackGoal strikes at close range (tryAttack via Combat.mobAttack), then cools down 20 ticks
let hits = 0; const orig = M.Combat.mobAttack; M.Combat.mobAttack = () => { hits++; };
const ag = new Ai.AttackGoal(cat);
cat.target = rabbit; rabbit.x = cat.x + 0.5; rabbit.z = cat.z;
ok(ag.canUse() === true, 'AttackGoal starts with a target');
ag.start(); for (let i = 0; i < 25; i++) ag.tick();
ok(hits === 2, 'AttackGoal strikes at tick 1 and again after the 20-tick cooldown (got ' + hits + ')');
rabbit.x = cat.x + 6; hits = 0; ag.tick(); ag.tick();
ok(hits === 0, 'AttackGoal does not strike out of reach');
okAv(hits === 0 && ag.canContinueToUse() === true, 'a target within 15 blocks keeps the goal running');
rabbit.x = cat.x + 20;
ok(ag.canContinueToUse() === false, 'a target beyond 15 blocks ends it');
M.Combat.mobAttack = orig;

// #3727: AttackGoal.tick -> getLookControl().lookAt(target, 30, 30) every tick
{
  const saveLook = cat.look; let looks = 0, lx;
  cat.look = { setLookAt: (x, y, z, a, b) => { looks++; lx = x; } };
  rabbit.x = cat.x + 6; cat.target = rabbit; ag.canUse(); ag.start(); ag.tick();
  ok(looks === 1 && lx === rabbit.x, 'AttackGoal.tick looks at the target');
  cat.look = { setLookAt: () => {} }; looks = 0;
  okAv(looks === 0, 'a goal that never calls lookAt is caught');
  cat.look = saveLook;
}

// #3140: CatEntity.TemptGoal(…, true) -> canBeScared: a moving player within 6 blocks drops the goal
{
  const tgoal = cat.ai.entries.find(x => x.priority === 3 && x.goal instanceof Ai.TemptGoal).goal;
  const pl = mkPlayer({ x: 3, z: 0, heldItem: 'cod' });
  M.Player = pl; cat.tamed = false;
  const still = tgoal.canUse() && (tgoal.start(), tgoal.canContinueToUse());
  ok(still === true, 'an untamed cat tempted by a still player keeps the goal');
  pl.x += 0.2;
  okAv(tgoal.canContinueToUse() === false, 'a player moving 0.2 blocks within 6 blocks scares the cat off TemptGoal');
  // #3708: tick's 1/300 pick remembers the player -> canBeScared false while it moves; 1/250 forget
  const rnd = cat.random.nextDouble;
  pl.x = 3; tgoal.start(); tgoal.canContinueToUse();
  cat.random.nextDouble = () => 0; tgoal.tick(); cat.random.nextDouble = () => 0.999;
  pl.x += 0.2;
  okAv(tgoal.canContinueToUse() === true, 'a remembered player moving does not scare the cat off TemptGoal');
  cat.random.nextDouble = () => 0; tgoal.tick(); cat.random.nextDouble = () => 0.999;
  pl.x += 0.2;
  okAv(tgoal.canContinueToUse() === false, 'after the 1/250 forget roll the moving player scares it again');
  cat.random.nextDouble = rnd;
  M.Player = null;
}

// #6246: CatSitOnBlockGoal refuses a chest a player has open (getPlayersLookingInChestCount < 1), on either half of a double chest
{
  freshWorld(); plate(8);
  const cs = (m) => { cat.tamed = true; cat.sitting = false; cat.x = 2.5; cat.y = PLAT_Y + 1; cat.z = 0.5; M.Player = null; return m; };
  const picks = () => { cs(); const g = new Ai.CatSitOnBlockGoal(cat, 0.8); return !!g.canUse(); };
  const base = stateOf('chest'), S = M.States, R = M.Reg;
  const setP = (st, n, v) => S.withProp(st, R.PROP[n], R.PVAL[v]);
  const left = setP(setP(base, 'type', 'left'), 'facing', 'north');
  const right = setP(setP(base, 'type', 'right'), 'facing', 'north');
  W.setBlock(5, PLAT_Y + 1, 0, base);
  ok(picks() === true, 'a tamed cat picks an unopened chest as its sit target');
  const BEo = (x) => M.BlockEntities.get(x, PLAT_Y + 1, 0) || M.BlockEntities.create(x, PLAT_Y + 1, 0, 'chest');
  BEo(5).open = 1;
  okAv(picks() === false, 'a chest with one viewer is refused');
  W.setBlock(5, PLAT_Y + 1, 0, 0); M.BlockEntities.remove(5, PLAT_Y + 1, 0);
  W.setBlock(5, PLAT_Y + 1, 0, left); W.setBlock(6, PLAT_Y + 1, 0, right);
  ok(picks() === true, 'an unopened double chest is picked');
  BEo(6).open = 1;
  okAv(picks() === false, 'a viewer on the OTHER half of a double chest refuses it too');
}

console.log(fails.length ? 'FAIL  catgoalcheck — ' + fails.join('\n   x ') : `catgoalcheck: ${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
