#!/usr/bin/env node
// pandacheck.mjs — loop/panda-axolotl-s101 (QUEUE 0.2 G18c, missing overworld mob): the PANDA,
// whole. Drives the REAL modules (07zl_panda.js, Ai.ROSTER.panda/EL.DEFAULTS.panda/
// Spawn.RULES.panda/Breed.CHILD.panda) against `.decomp/net/minecraft/entity/passive/
// PandaEntity.java` (1134 lines, read in full).
//
//   node tools/pandacheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own row
//   2. genes — Pd.randomGene's own 16-way switch, Pd.productGene's recessive/dominant fold
//   3. EL.spawn('panda', ...) — EL.DEFAULTS.panda rolls both genes, Ai.ROSTER.panda attaches e.ai
//   4. Spawn.RULES.panda — shares Spawn.RULES.cow (no canSpawn override in the jar)
//   5. Pd.initGenes / Breed.CHILD.panda — parent inheritance + the two independent 1/32 mutations
//   6. Pd.SneezeGoal / Pd.tickSneeze — baby-only, weak-vs-normal odds, the jump + slime_ball drop
//   7. Pd.LieOnBackGoal — lazy-gene gated idle toggle
//   8. Pd.RevengeGoal / Pd.AttackGoal — aggressive-panda retaliation, the shouldAttack cutoff
//   9. anti-vacuity — break the check's own data/stubs and watch it catch the break

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('pandacheck — loop/panda-axolotl-s101 (QUEUE 0.2 G18c), the panda, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Pd = MCL.Panda, Breed = MCL.Breed, W = MCL.World, S = MCL.States;
const Cb = MCL.Combat;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();
if (Cb && Cb.init) Cb.init();

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(Pd && Pd.ready, 'NS.Panda did not load/ready');

// ── 1. attributes/dimensions/breeding food ──────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for panda');
{
  const at = Ent.attrsOf('panda');
  ok(!!at, 'Ent.attrsOf(panda) missing entirely');
  ok(at && at.hp === 20, `panda max health 20 — got ${at && at.hp}`);
  ok(at && Math.abs(at.speed - 0.15) < 1e-6, `panda movement speed 0.15 — got ${at && at.speed}`);
  ok(at && at.dmg === 6, `panda attack damage 6 — got ${at && at.dmg}`);
  const dim = Ent.dimensions('panda');
  ok(dim && Math.abs(dim.width - 1.3) < 1e-9 && Math.abs(dim.height - 1.25) < 1e-9,
    `panda dims [1.3,1.25] — got ${dim && [dim.width, dim.height]}`);
  const food = Ent.breedFood('panda');
  ok(food && food.k === 'items' && food.i.indexOf('bamboo') >= 0,
    `panda breeds on bamboo — got ${JSON.stringify(food)}`);
}

// ── 2. genes ─────────────────────────────────────────────────────────────────────────────────
say('2. Pd.randomGene / Pd.productGene');
{
  ok(Pd.randomGene(() => 0.0) === Pd.Gene.LAZY, 'roll 0/16 must be lazy');
  ok(Pd.randomGene(() => 1.0001 / 16) === Pd.Gene.WORRIED, 'roll 1/16 must be worried');
  ok(Pd.randomGene(() => 2.0001 / 16) === Pd.Gene.PLAYFUL, 'roll 2/16 must be playful');
  ok(Pd.randomGene(() => 4.0001 / 16) === Pd.Gene.AGGRESSIVE, 'roll 4/16 must be aggressive');
  ok(Pd.randomGene(() => 3.0001 / 16) === Pd.Gene.WEAK, 'roll 3/16 falls into the [3,9) weak band');
  ok(Pd.randomGene(() => 8.9999 / 16) === Pd.Gene.WEAK, 'roll [3,9) must be weak');
  ok(Pd.randomGene(() => 10.9999 / 16) === Pd.Gene.BROWN, 'roll [9,11) must be brown');
  ok(Pd.randomGene(() => 15.9999 / 16) === Pd.Gene.NORMAL, 'roll [11,16) must be normal');

  // recessive fold: brown/weak only express when BOTH slots match; every other gene is dominant
  ok(Pd.productGene(Pd.Gene.BROWN, Pd.Gene.BROWN) === Pd.Gene.BROWN, 'brown+brown must express brown');
  ok(Pd.productGene(Pd.Gene.BROWN, Pd.Gene.NORMAL) === Pd.Gene.NORMAL, 'brown+normal must fold to normal (recessive)');
  ok(Pd.productGene(Pd.Gene.WEAK, Pd.Gene.LAZY) === Pd.Gene.NORMAL, 'weak+lazy must fold to normal (recessive, mismatched)');
  ok(Pd.productGene(Pd.Gene.LAZY, Pd.Gene.NORMAL) === Pd.Gene.LAZY, 'lazy (dominant) must express regardless of hidden');
  ok(Pd.productGene(Pd.Gene.AGGRESSIVE, Pd.Gene.WEAK) === Pd.Gene.AGGRESSIVE, 'aggressive (dominant) must express regardless of hidden');

  const e = { mainGene: Pd.Gene.LAZY, hiddenGene: Pd.Gene.NORMAL };
  ok(Pd.isLazy(e) === true, 'Pd.isLazy reader must agree with productGene');
  ok(Pd.isWorried(e) === false, 'Pd.isWorried reader must agree with productGene');
}

// ── 3. EL.spawn(panda) ──────────────────────────────────────────────────────────────────────
say('3. EL.spawn(panda) — EL.DEFAULTS.panda + Ai.ROSTER.panda');
let e0;
{
  ok(EL.canSpawn('panda'), 'EL.canSpawn(panda) is false — the closed motion set refuses it');
  const m = EL.motionFor('panda');
  ok(m && Math.abs(m[0] - 0.08) < 1e-9 && Math.abs(m[1] - 0.98) < 1e-9, `motionFor(panda) = ${m}, expected [0.08,0.98]`);
  e0 = EL.spawn('panda', 0, 64, 0, {});
  ok(e0.mainGene !== undefined && e0.hiddenGene !== undefined, 'EL.DEFAULTS.panda did not roll e.mainGene/e.hiddenGene');
  ok(!!e0.ai, 'EL.spawn did not attach e.ai for a rostered panda');
  ok(e0.maxHealth === (Pd.isWeak(e0) ? 10 : 20), `maxHealth ${e0.maxHealth}, expected 20 off the attribute table (10 for a weak panda, #926)`);

  const forced = EL.spawn('panda', 0, 64, 0, { mainGene: Pd.Gene.AGGRESSIVE, hiddenGene: Pd.Gene.AGGRESSIVE });
  ok(forced.mainGene === Pd.Gene.AGGRESSIVE, 'opts.mainGene (egg/command) did not stick');

  okAv((() => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(EL.spawn('panda', 0, 64, 0, {}).mainGene);
    return seen.size > 1;
  })(), 'across 200 natural spawns, e.mainGene never varied — the gene roll is not live');
}

// ── 4. Spawn.RULES.panda ────────────────────────────────────────────────────────────────────
say('4. Spawn.RULES.panda — shares Spawn.RULES.cow (no canSpawn override in the jar)');
{
  ok(typeof Spawn.RULES.panda === 'function' && Spawn.canPlace('panda'), 'Spawn.RULES.panda is not wired');
  ok(Spawn.RULES.panda === Spawn.RULES.cow, 'Spawn.RULES.panda must be the SAME function object as Spawn.RULES.cow');
  const grass = S.stateOf('grass_block') | 0, stone = S.stateOf('stone') | 0;
  W.setBlock(0, 63, 0, grass);
  W.setBlock(0, 63, 1, stone);
  const saveBright = W.rawBrightness;
  W.rawBrightness = () => 9;
  ok(Spawn.RULES.panda(0, 64, 0) === true, 'grass below (animals_spawnable_on) + bright enough must pass');
  okAv((() => { W.rawBrightness = () => 8; return Spawn.RULES.panda(0, 64, 0) === false; })(),
    'dropping brightness to 8 must refuse — the light check is really consulted');
  W.rawBrightness = saveBright;
}

// ── 5. Pd.initGenes / Breed.CHILD.panda ─────────────────────────────────────────────────────
say('5. Pd.initGenes — parent inheritance + the two independent 1/32 mutation rolls');
{
  const a = { mainGene: Pd.Gene.LAZY, hiddenGene: Pd.Gene.NORMAL };
  const b = { mainGene: Pd.Gene.WORRIED, hiddenGene: Pd.Gene.PLAYFUL };
  const child = {};
  // rnd() sequence: 0.9 (first coin -> b half), 0.9 (a's own randomGeneOf coin -> hiddenGene of a),
  // 0.9 (b's own randomGeneOf coin -> hiddenGene of b), then two mutation rolls both refused (>=1/32)
  const seq = [0.9, 0.9, 0.9, 0.5, 0.5];
  let i = 0;
  Pd.initGenes(child, a, b, () => seq[i++]);
  ok(child.mainGene === Pd.Gene.PLAYFUL, `mainGene should come from b’s hiddenGene (playful) — got ${Pd.geneName(child.mainGene)}`);
  ok(child.hiddenGene === Pd.Gene.NORMAL, `hiddenGene should come from a’s hiddenGene (normal) — got ${Pd.geneName(child.hiddenGene)}`);

  okAv((() => {
    const c2 = {};
    // force BOTH mutation rolls to fire (< 1/32) — every other roll picks a's mainGene / b's mainGene
    const seq2 = [0.9, 0.0, 0.0, 0.0, 0.0];
    let j = 0;
    Pd.initGenes(c2, a, b, () => seq2[j++]);
    return c2.mainGene === Pd.Gene.LAZY && c2.hiddenGene === Pd.Gene.LAZY;   // 0.0 always rolls LAZY (n===0)
  })(), 'forcing both 1/32 mutation rolls must overwrite BOTH slots with a fresh random gene');

  const EL2 = EL;
  const pa = EL2.spawn('panda', 0, 64, 0, { mainGene: Pd.Gene.AGGRESSIVE, hiddenGene: Pd.Gene.AGGRESSIVE });
  const pb = EL2.spawn('panda', 1, 64, 0, { mainGene: Pd.Gene.AGGRESSIVE, hiddenGene: Pd.Gene.AGGRESSIVE });
  Breed.setInLove(pa, null); Breed.setInLove(pb, null);
  const kid = Breed.breed(pa, pb, { random: () => 0.99 });
  ok(!!kid && kid.type === 'panda', 'Br.breed(panda, panda) must produce a panda child');
  ok(kid && kid.mainGene === Pd.Gene.AGGRESSIVE, 'the live-spawned child of two aggressive parents must inherit aggressive (no mutation at 0.99)');
}

// ── 6. Pd.SneezeGoal / Pd.tickSneeze ────────────────────────────────────────────────────────
say('6. Pd.SneezeGoal — baby-only, weak-vs-normal odds; Pd.tickSneeze — the consequence');
{
  const adult = { isBaby: false, mainGene: Pd.Gene.NORMAL, hiddenGene: Pd.Gene.NORMAL };
  const g1 = new Pd.SneezeGoal(adult, { random: () => 0 });
  ok(g1.canUse() === false, 'an ADULT panda must never start SneezeGoal, whatever the roll');

  const weakBaby = { isBaby: true, mainGene: Pd.Gene.WEAK, hiddenGene: Pd.Gene.WEAK };
  const g2 = new Pd.SneezeGoal(weakBaby, { random: () => 1 / 500 - 1e-9 });
  ok(g2.canUse() === true, 'a WEAK baby must start on a roll just under 1/500');
  const normalBaby = { isBaby: true, mainGene: Pd.Gene.NORMAL, hiddenGene: Pd.Gene.NORMAL };
  const g3 = new Pd.SneezeGoal(normalBaby, { random: () => 1 / 500 });
  ok(g3.canUse() === false, 'a NORMAL (non-weak) baby must NOT start on a roll of exactly 1/500 (needs 1/6000)');

  const sneezer = { type: 'panda', x: 0, y: 64, z: 0, height: 0.625, sneezing: true, sneezeProgress: 0 };
  for (let t = 0; t < 20; t++) ok(Pd.tickSneeze(sneezer) === false, `tick ${t} must not resolve yet`);
  let jumped = null, dropped = null, spawned = null;
  const other = { x: 1, y: 64, z: 0, isBaby: false, onGround: true, inWater: false, lyingOnBack: false, sitting: false, playing: false };
  const resolved = Pd.tickSneeze(sneezer, {
    random: () => 0, pandas: () => [other],
    jump: (o) => { jumped = o; }, particle: (src, n, x, y, z) => { spawned = { n, x, y, z }; }, dropItem: () => { dropped = true; }
  });
  ok(resolved === true, 'the 21st tick must resolve the sneeze');
  ok(spawned && spawned.n === 'sneeze' && Math.abs(spawned.y - (64 + 0.625 * 0.85 - 0.1)) < 1e-9, 'the sneeze must emit a sneeze particle at getEyeY()-0.1 (height*0.85)');
  ok(jumped === other, 'a nearby idle grounded dry non-baby panda must jump when another panda sneezes');
  ok(dropped === true, 'random()===0 (< 1/700) must drop a slime_ball');
  ok(sneezer.sneezing === false, 'sneezing flag must clear after resolving');

  { // #929: weak roll falls through to 1/6000; AABB not sphere; thunder
    let n = 0;
    const seq = [0.5, 1 / 6000 - 1e-9];
    ok(new Pd.SneezeGoal(weakBaby, { random: () => seq[n++] }).canUse() === true, 'weak baby failing 1/500 still gets the 1/6000 roll');
    const mk = () => ({ type: 'panda', x: 0, y: 64, z: 0, sneezing: true, sneezeProgress: 20 });
    const corner = { x: 9, y: 73, z: 9, isBaby: false, onGround: true, inWater: false };
    let hit = null;
    Pd.tickSneeze(mk(), { random: () => 0.9, pandas: () => [corner], jump: (o) => { hit = o; } });
    ok(hit === corner, 'panda at (9,9,9) (inside the expand(10) box, outside a 10-sphere) must jump');
    hit = null;
    Pd.tickSneeze(mk(), { random: () => 0.9, pandas: () => [{ ...corner, x: 12 }], jump: (o) => { hit = o; } });
    ok(hit === null, 'panda beyond the box must not jump');
    Pd.thundering = () => true;
    const worried = { mainGene: Pd.Gene.WORRIED, hiddenGene: Pd.Gene.WORRIED, inWater: false };
    Pd.tickWorried(worried);
    ok(worried.sitting === true && Pd.isIdle(worried) === false, 'worried panda sits in thunder and is not idle');
    Pd.thundering = () => false;
    Pd.tickWorried(worried);
    ok(worried.sitting === false, 'worried panda stands once thunder ends');
    Pd.thundering = null;
  }
  okAv((() => {
    const s2 = { type: 'panda', x: 0, y: 64, z: 0, sneezing: true, sneezeProgress: 0 };
    for (let t = 0; t <= Pd.SNEEZE_DURATION; t++) Pd.tickSneeze(s2);
    let dropped2 = false;
    Pd.tickSneeze(s2, { random: () => 0.999, dropItem: () => { dropped2 = true; } });
    return dropped2 === false;
  })(), 'a random() of 0.999 (>= 1/700) must NOT drop a slime_ball');
  okAv((() => {
    const run = (allowed) => {
      const s3 = { type: 'panda', x: 0, y: 64, z: 0, sneezing: true, sneezeProgress: Pd.SNEEZE_DURATION + 1 };
      let d = false;
      Pd.tickSneeze(s3, { random: () => 0, dropsAllowed: allowed, dropItem: () => { d = true; } });
      return d;
    };
    return run(true) === true && run(false) === false;
  })(), '#3900: doMobLoot false (dropsAllowed false) must NOT drop a slime_ball even at roll 0');
}

// ── 7. Pd.LieOnBackGoal ─────────────────────────────────────────────────────────────────────
say('7. Pd.LieOnBackGoal — lazy-gene gated');
{
  const lazy = { age: 500, mainGene: Pd.Gene.LAZY, hiddenGene: Pd.Gene.NORMAL, lyingOnBack: false, sitting: false, playing: false };
  const gl = new Pd.LieOnBackGoal(lazy, { random: () => 0 });
  ok(gl.canUse() === true, 'a lazy, idle, aged panda must be able to start lying on back at roll 0');

  const notLazy = { age: 500, mainGene: Pd.Gene.NORMAL, hiddenGene: Pd.Gene.NORMAL, lyingOnBack: false, sitting: false, playing: false };
  const gn = new Pd.LieOnBackGoal(notLazy, { random: () => 0 });
  ok(gn.canUse() === false, 'a NON-lazy panda must never start LieOnBackGoal');
}

// ── 8. Pd.RevengeGoal / Pd.AttackGoal ───────────────────────────────────────────────────────
say('8. Pd.RevengeGoal / Pd.AttackGoal — aggressive-panda retaliation');
{
  const attacker = { x: 5, y: 64, z: 0, removed: false, health: 20, maxHealth: 20 };
  // a NON-aggressive panda: one swing back, then the chase drops
  const normal = { type: 'panda', x: 0, y: 64, z: 0, mainGene: Pd.Gene.NORMAL, hiddenGene: Pd.Gene.NORMAL,
                    lastHurtByEntity: attacker, hurtSeq: 1, hurtAge: 0, age: 0, target: null, lyingOnBack: false, sitting: false, playing: false };
  const mk = (g, x) => ({ type: 'panda', x, y: 64, z: 0, mainGene: g, hiddenGene: g, target: null, age: 0 });
  const nAgg = mk(Pd.Gene.AGGRESSIVE, 3), nNorm = mk(Pd.Gene.NORMAL, 4), nFar = mk(Pd.Gene.AGGRESSIVE, 60);
  const rv = new Pd.RevengeGoal(normal, { animals: () => [normal, nAgg, nNorm, nFar] });
  ok(rv.canUse() === true, 'a freshly-hurt panda with no current target must accept the revenge goal');
  rv.start();
  ok(normal.target === attacker, 'RevengeGoal.start must set e.target to the attacker');

  ok(nAgg.target === attacker, 'group revenge: an aggressive neighbour must target the attacker');
  okAv(nNorm.target === null, 'group revenge: a non-aggressive neighbour must NOT join');
  okAv(nFar.target === null, 'group revenge: an aggressive panda beyond follow range must not be alerted');
  ok(rv.canUse() === false, 'RevengeGoal is edge-triggered: same hit must not re-fire');
  const stale = { type: 'panda', lastHurtByEntity: attacker, hurtSeq: 1, hurtAge: 0, age: 101, target: null };
  okAv(new Pd.RevengeGoal(stale).canUse() === false, 'a hit older than 100 ticks must not start revenge');
  ok(new Pd.RevengeGoal({ ...stale, age: 100 }).canUse() === true, 'a hit exactly 100 ticks old is still inside the window');

  const ag = new Pd.AttackGoal(normal, { random: () => 0 });
  normal.x = 4.9; normal.y = 64; normal.z = 0;   // within Pd.ATTACK_RANGE of attacker at x=5
  attacker.health = 20;
  ok(ag.canUse() === true, 'AttackGoal must accept an idle panda with a live target');
  ag.tick();
  ok(attacker.health < 20, 'AttackGoal.tick must land a hit within range');
  ok(normal.shouldAttack === true, 'a NON-aggressive panda that lands a hit must set shouldAttack (tryAttack’s own branch)');
  ok(rv.canContinueToUse() === false, 'shouldAttack now set — RevengeGoal.canContinueToUse must drop the chase (PandaRevengeGoal’s own backwards shouldContinue)');
  ok(normal.target === null, 'canContinueToUse must have cleared e.target as a side effect');

  // an AGGRESSIVE panda: tryAttack never sets shouldAttack, so the chase continues normally
  const attacker2 = { x: 5, y: 64, z: 0, removed: false, health: 20, maxHealth: 20 };
  const aggro = { type: 'panda', x: 4.9, y: 64, z: 0, mainGene: Pd.Gene.AGGRESSIVE, hiddenGene: Pd.Gene.AGGRESSIVE,
                  lastHurtByEntity: attacker2, target: attacker2, lyingOnBack: false, sitting: false, playing: false };
  const ag2 = new Pd.AttackGoal(aggro, { random: () => 0 });
  ag2.tick();
  ok(aggro.shouldAttack === undefined || aggro.shouldAttack === false, 'an AGGRESSIVE panda’s tryAttack must never set shouldAttack');
  const rv2 = new Pd.RevengeGoal(aggro);
  ok(rv2.canContinueToUse() === true, 'an AGGRESSIVE panda with neither flag set must keep chasing its live target');

  Pd.tickRevengeFlags(normal);
  ok(normal.shouldAttack === false && normal.shouldGetRevenge === false, 'Pd.tickRevengeFlags must reset both flags once target is null');
}

{
  // #923: the roster's escape goal is PandaEscapeDangerGoal (isInDanger = fire only; shouldContinue false while sitting)
  const pg = (p) => p.ai.entries.map((x) => x.goal).find((g) => g instanceof Ai.PanicGoal);
  const atk = { x: 5, y: 64, z: 0, removed: false };
  const p1 = EL.spawn('panda', 0.5, 64, 0.5, {});
  const g1 = pg(p1);
  ok(!!g1, 'panda roster must contain a PanicGoal');
  p1.justHurt = true; p1.lastHurtByEntity = atk; p1.isOnFire = false;
  okAv(g1.canUse() === false, 'a panda hit by a player must NOT panic (isInDanger = powder snow || fire only)');
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, 63, z, S.stateOf('stone') | 0);
  p1.isOnFire = true;
  okAv([...Array(30)].some(() => g1.canUse()), 'a burning panda must panic');   // the flee-target search is random: any of 30 tries
  p1.sitting = true;
  okAv(g1.canContinueToUse() === false, 'a sitting panda\'s escape goal must not continue');
}

// ── 9. melee cadence: MeleeAttackGoal's 20-tick cooldown (issue #921) ───────────────────────
say('9. Pd.AttackGoal — one bite per 20 ticks, bite sound');
{
  const count = (cooldown) => {
    const tgt = { x: 1, y: 64, z: 0, removed: false, health: 1e9, maxHealth: 1e9 };
    const p = { type: 'panda', x: 0, y: 64, z: 0, mainGene: Pd.Gene.AGGRESSIVE, hiddenGene: Pd.Gene.AGGRESSIVE,
                target: tgt, lyingOnBack: false, sitting: false, playing: false };
    const g = new Pd.AttackGoal(p, {});
    let n = 0, snd = 0;
    const oa = MCL.Combat.mobAttack, op = MCL.Sound && MCL.Sound.play;
    MCL.Combat.mobAttack = () => { n++; return null; };
    if (!MCL.Sound) MCL.Sound = {};
    MCL.Sound.play = (id) => { if (id === 'entity.panda.bite') snd++; };
    g.start();
    for (let i = 0; i < 100; i++) g.tick();
    MCL.Combat.mobAttack = oa; MCL.Sound.play = op;
    return { n, snd };
  };
  const r = count();
  ok(r.n === 5, 'AttackGoal must bite exactly 5 times in 100 ticks, got ' + r.n);
  ok(r.snd === 5, 'each bite must play entity.panda.bite, got ' + r.snd);
  const saved = MCL.Ai.MOB_ATTACK_INTERVAL; MCL.Ai.MOB_ATTACK_INTERVAL = 1;
  okAv(count().n !== 5, 'breaking the cooldown must change the bite count');
  MCL.Ai.MOB_ATTACK_INTERVAL = saved;
}

// ── 10. PandaMoveControl — non-idle panda commands no movement (#922) ──────────────────────
say('10. Pd.isIdle gates movement, not just canUse');
{
  const drive = (flag, on) => {
    for (const o of EL.list) if (!o.removed) o.removed = true;   // no neighbour shoves the subject
    const p = EL.spawn('panda', 0.5, 64, 0.5, { mainGene: Pd.Gene.NORMAL, hiddenGene: Pd.Gene.NORMAL });   // a worried gene clears `sitting` itself (tickWorried)
    p.age = 100; p.onGround = true; p.vx = p.vz = 0;
    if (p.ai) p.ai.entries = [];   // only the stand-in goal below runs
    if (flag) p[flag] = true;
    const x0 = p.x, z0 = p.z;
    // stands in for a running follow/flee/breed goal: forward input written in the goal slot
    p.slimeMove = { tick() { p.zza = 1; p.mobSpeed = 0.2; } };
    for (let t = 0; t < 40; t++) { if (flag) { p[flag] = true; p.playingTicks = 8; } EL.tickMob(p); }   // the flag is held (tickAnim lets `playing` lapse after 32 ticks); tick 9 of the play script is a plain replay, no hop
    p.removed = true;
    return Math.hypot(p.x - x0, p.z - z0);
  };
  for (const f of ['lyingOnBack', 'sitting', 'playing']) {
    { const dd = drive(f); ok(dd < 1e-6, f + ' panda must not move over 40 ticks (moved ' + dd + ')'); }
  }
  okAv(drive(null) > 0.1, 'an idle panda given the same forward input must move (else the zero-displacement rows are vacuous)');
}


// ── 7. PandaMateGoal — bamboo gate + ask countdown ──────────────────────────────────────────
{
  say('7. Pd.MateGoal');
  const R = MCL.Reg;
  const mk = (x) => ({ type: 'panda', x, y: 64, z: 0.5, age: 0, inLove: true, removed: false });
  const a = mk(0.5), b = mk(2.5);
  const player = { x: 3, y: 64, z: 3, eyeHeight: 1.6 };
  const looks = []; a.look = { setLookAt(x, y, z) { looks.push([x, y, z]); } };
  a.pdLookGoal = new Pd.LookAtEntityGoal(a, () => [player], 6.0, { random: () => 0 });
  const goal = new Pd.MateGoal(a, 1.0, () => [a, b], null, () => [player]);
  ok(goal.canUse() === false, 'love pair with no bamboo nearby must NOT start mating');
  ok(a.askForBambooTicks === 32, 'no bamboo: the panda must start asking (32 ticks)');
  ok(a.pdLookGoal.getTarget() === player, 'the ask must aim the look goal (setTarget) at the nearest player');
  Pd.tickAskForBamboo(a);
  ok(looks.length === 0, '#3660: with no attack target tickAskForBamboo makes no lookAt (only the look goal turns to the asked player)');
  a.target = { x: 1, y: 64, z: 1, eyeHeight: 1 }; a.askForBambooTicks = 5; Pd.tickAskForBamboo(a); a.target = null; a.askForBambooTicks = 31;
  ok(looks.length === 1, '#3532: tickAskForBamboo looks at the attack target (lookAtEntity 90,90)');
  a.pdLookGoal.start(); a.pdLookGoal.tick();
  ok(looks.length === 2, 'the look goal turns the head toward the asked player');
  okAv((() => {
    const s = mk(0.5); s.aiDisabled = true; s.pdLookGoal = new Pd.LookAtEntityGoal(s, () => [player], 6.0, { random: () => 0 });
    new Pd.MateGoal(s, 1.0, () => [s, b], null, () => [player]).canUse();
    return s.askForBambooTicks === 32 && s.pdLookGoal.getTarget() === null;
  })(), 'a panda that cannot move voluntarily still asks but never aims the look goal');
  okAv((() => {
    const s = mk(0.5); s.sitting = true; s.pdLookGoal = new Pd.LookAtEntityGoal(s, () => [player], 6.0, { random: () => 0 });
    s.pdLookGoal.setTarget(player);
    return s.pdLookGoal.canUse() === false;
  })(), 'a sitting panda (not idle) does not start the look goal');
  ok(goal.canUse() === false, 'while asking, canUse stays false');
  a.askForBambooTicks = 0; a.age = 100;
  ok(goal.canUse() === false && a.askForBambooTicks === 0, 'the ask repeats only every 600 ticks');
  a.age = 600;
  goal.canUse();
  ok(a.askForBambooTicks === 32, 'ask restarts after 600 ticks');
  a.askForBambooTicks = 29; Pd.tickAskForBamboo(a);
  ok(a.askForBambooTicks === 28, 'tickAskForBamboo must count down');
  const far = mk(0.5); far.age = 0;
  W.setBlock(4, 63, 1, R.real(R.id.dirt, R.defaultState[R.id.dirt]));
  W.setBlock(4, 64, 1, R.real(R.id.bamboo, R.defaultState[R.id.bamboo]));
  ok(Pd.isBambooClose(far) === true, 'bamboo within range must be seen by isBambooClose');
  const g2 = new Pd.MateGoal(far, 1.0, () => [far, b], null, () => []);
  ok(g2.canUse() === true, 'love pair with bamboo in range must start mating');
  const g3 = new Pd.MateGoal(mk(0.5), 1.0, () => [far, b], null, () => []);
  okAv(g3.canUse() === true, 'a fresh love pair with bamboo in range mates (gate opens)');
  W.setBlock(4, 64, 1, 0);
  ok(Pd.isBambooClose(far) === false, 'removing the bamboo must clear isBambooClose');
  okAv(new Pd.MateGoal(mk(0.5), 1.0, () => [a, b], null, () => []).canUse() === false, 'no-bamboo gate holds');
}


// ── 10. #925: pickup, eat timer, play script, interactMob matrix ─────────────────────────────
say('10. PickUpFoodGoal / updateEating / PlayGoal / Pd.interact');
{
  const mk = (o) => Object.assign({ type: 'panda', x: 0, y: 64, z: 0, age: 0, mainGene: Pd.Gene.NORMAL,
    hiddenGene: Pd.Gene.NORMAL, growAge: 0, onGround: true, yaw: 0 }, o || {});
  const bamboo = () => ({ type: 'item', x: 3, y: 64, z: 0, item: MCL.Items.of('bamboo'), count: 3, pickupDelay: 0 });
  // loot: empty hand + bamboo equips whole stack with dropChance 2.0; full hand refuses; stick refuses
  const p1 = mk(); const it = bamboo();
  ok(Pd.loot(p1, it) === true && Pd.heldName(p1) === 'bamboo', 'loot must equip bamboo into the mainhand');
  ok(Pd.mainhand(p1).n === 3, 'loot equips the whole stack');
  ok(MCL.Equip.dropChance(p1, MCL.Items.MAINHAND) === 2.0, 'handDropChance 2.0');
  ok(Pd.loot(p1, bamboo()) === false, 'a full hand refuses a second pickup');
  const stick = Object.assign(bamboo(), { item: MCL.Items.of('stick') });
  ok(Pd.loot(mk(), stick) === false, 'non-food is not picked up');
  // eating: 1/80 start only while sitting with a held item; >100 ticks + 1/20 consumes
  const p2 = mk({ sitting: true }); Pd.setMainhand(p2, MCL.Equip.stackOf('bamboo'));
  Pd.updateEating(p2, { random: () => 1 / 80 + 0.001 });
  ok(p2.eating === true, 'sitting + held + roll 1/80 starts eating');
  const p2b = mk({ sitting: false }); Pd.setMainhand(p2b, MCL.Equip.stackOf('bamboo'));
  Pd.updateEating(p2b, { random: () => 1 / 80 + 0.001 });
  ok(!p2b.eating, 'standing panda never starts eating');
  let parts = 0;
  ok(p2.eatingTicks === 2, 'setEating(true) starts EATING_TICKS at 1 (#1607) - got ' + p2.eatingTicks);
  let first = -1;
  for (let i = 0; i < 101; i++) { const b = parts; Pd.updateEating(p2, { random: () => 0.9, particle: () => parts++ }); if (first < 0 && parts > b) first = i; }
  ok(first === 3, 'first eat beat at eatingTicks 5, 3 ticks after the start tick (#1607) - got ' + first);
  ok(p2.eating && Pd.mainhand(p2) && p2.eatingTicks === 103, 'no consume without the 1/20 roll');
  ok(parts === 20, 'item particles every 5 ticks (ticks 5..100) - got ' + parts);
  p2.eatingTicks = 101;
  // #1610: the entity-list callback must spawn 6 particles per beat in front of the body at eyeY+1
  { const src = readFileSync(new URL('../src/07i_entitylist.js', import.meta.url), 'utf8');
    ok(/pi < 6; pi\+\+[\s\S]{0,900}eyeY \+ 1\.0 \+ oy/.test(src), '#1610 panda eating beat spawns 6 item particles at eyeY+1 in front of the body');
    ok(/src\.x \+ ox \* -bc \+ oz \* bs[\s\S]{0,40}src\.z \+ oz \* -bc - ox \* bs/.test(src) && /bc = Math\.cos\(by\)/.test(src), '#3811 panda eating spawn offset rotates by bodyYaw, not head yaw'); }
  Pd.updateEating(p2, { random: () => 1 / 20 + 0.001 });
  ok(!Pd.mainhand(p2) && p2.sitting === false && !p2.eating, 'eating >100 ticks + roll consumes the item and stands');
  // play script
  const p3 = mk({ playing: true, isBaby: true }); const vel = [];
  for (let t = 1; t <= 33; t++) { Pd.tickPlayTicks(p3); Pd.updatePlaying(p3); vel.push([p3.vx, p3.vy, p3.vz]); }
  ok(Math.abs(p3.playingJump.z + 0.1) < 1e-9 && Math.abs(vel[0][1] - 0.27) < 1e-9, 'tick 1: baby jump 0.1 forward, vy 0.27');
  ok(vel[6][0] === 0 && vel[6][2] === 0 && vel[6][1] === 0.27, 'tick 7: stop dead + hop');
  ok(vel[14][0] === 0 && vel[22][0] === 0, 'ticks 15/23 hop too');
  ok(vel[3][2] === p3.playingJump.z, 'other ticks replay playingJump');
  ok(p3.playing === false && p3.playingTicks === 33, 'playing ends after tick 32');
  const adult = mk({ playing: true }); Pd.tickPlayTicks(adult); Pd.updatePlaying(adult);
  ok(Math.abs(adult.playingJump.z + 0.2) < 1e-9, 'adult jump is 0.2');
  W.setBlock(0, 63, -1, 0);   // an edge one block ahead (yaw 0 faces -z): PlayGoal.canUse is true there; earlier sections floor the area
  const pg = new Pd.PlayGoal(mk({ isBaby: true }), { random: () => 0 });
  ok(pg.canUse() === true, 'baby on the ground may play (rolls pass)');
  ok(new Pd.PlayGoal(mk({ isBaby: true, eating: true }), { random: () => 0 }).canUse() === false, 'eating panda does not play');
  ok(new Pd.PlayGoal(mk(), { random: () => 0 }).canUse() === false, 'plain adult does not play');
  ok(Pd.isIdle(mk({ eating: true })) === false, 'isIdle false while eating');
  // interactMob matrix
  let used = 0; const opt = { consume: () => used++ };
  const pl = mk({ lyingOnBack: true });
  ok(Pd.interact(pl, 'bamboo', opt) === true && pl.lyingOnBack === false && used === 0, 'lyingOnBack: wake, nothing consumed');
  const pa = mk({ growAge: 6000 });
  ok(Pd.interact(pa, 'bamboo', opt) === true && pa.eating === true && !pa.inLove, 'adult on breed cooldown takes the hold branch, not love');
  const pb = mk({ growAge: 6000 }); used = 0;
  Pd.interact(pb, 'bamboo', opt);
  ok(pb.eating === true && pb.sitting === true && Pd.heldName(pb) === 'bamboo' && Pd.mainhand(pb).n === 1 && used === 1,
    'adult not in love: sits, eats, holds 1 bamboo, consumes 1');
  ok(Pd.interact(pb, 'bamboo', opt) === false, 'already sitting: PASS');
  ok(Pd.interact(mk(), 'wheat', opt) === false, 'other items PASS');
  const pt = mk({ mainGene: Pd.Gene.WORRIED, hiddenGene: Pd.Gene.WORRIED });
  MCL.Sky = { isThundering: () => true };
  ok(Pd.interact(pt, 'bamboo', opt) === false, 'scared by thunder: PASS');
  ok(Pd.isIdle(pt) === false, 'isIdle false in thunder for a worried panda');
  { // #4625: PASS must not fall through to the generic Breed.interact (bamboo eaten, love mode)
    const Iv = MCL.Inventory, inv = Iv.create(), st = { i: MCL.Items.of('bamboo'), n: 3 };
    Iv.setItem(inv, 0, st);
    const adult = mk({ mainGene: Pd.Gene.WORRIED, hiddenGene: Pd.Gene.WORRIED, growAge: 0 });
    MCL.Use.entityUse({ x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false }, adult, st);
    okAv(st.n === 3 && !adult.inLove, 'thunderstorm + bamboo on worried panda must not consume bamboo / not enter love');
  }
  MCL.Sky = { isThundering: () => false };
  const pf = mk({ target: {} , growAge: 6000 }); Pd.interact(pf, 'bamboo', opt);
  ok(pf.shouldGetRevenge === true, 'bamboo with a target sets shouldGetRevenge');
  // goal: stop() drops held food and sets a cooldown; start() sits when holding
  const p4 = mk({ sitting: true }); Pd.setMainhand(p4, MCL.Equip.stackOf('bamboo'));
  const g = new Pd.PickUpFoodGoal(p4, { random: () => 0.5 });
  g.stop();
  ok(!Pd.mainhand(p4) && p4.sitting === false, 'goal stop drops the item and stands');
  ok(g.canUse() === false, 'cooldown (startAge) blocks canUse after a drop');
  ok(Pd.mainhand(Object.assign(mk(), {})) === null, 'fresh panda holds nothing');
  // #3719: start() paths once (startMovingTo), tick() walks that path rather than a straight line at the item
  okAv((() => {
    const q = mk({ x: 0, y: 64, z: 0 }), item = { x: 4, y: 64, z: 0, removed: false };
    const sF = Pd.foodNear, sP = Ai.findPath, sS = Ai.stepToward, sC = Ai.closeTo;
    let calls = 0, aimed = null;
    Pd.foodNear = () => [item]; Ai.findPath = () => { calls++; return [{ x: 0, y: 64, z: 0 }, { x: 0.5, y: 64, z: 3 }, { x: 4, y: 64, z: 0 }]; };
    Ai.stepToward = (e, n) => { aimed = n; }; Ai.closeTo = () => false;
    const gg = new Pd.PickUpFoodGoal(q, { random: () => 0.5 }); gg.start(); gg.tick(); gg.tick();
    Pd.foodNear = sF; Ai.findPath = sP; Ai.stepToward = sS; Ai.closeTo = sC;
    return calls === 1 && aimed && aimed.z === 3;
  })(), 'PickUpFoodGoal walks one findPath waypoint, not straight at the item (breaks if tick re-aims at item)');

  okAv((() => { const q = mk(); return Pd.loot(q, stick) === false && !Pd.mainhand(q); })(), 'stick loot refused (breaks if IS_FOOD widened)');
  okAv((() => { const q = mk({ playing: true }); for (let t = 0; t < 7; t++) { Pd.tickPlayTicks(q); Pd.updatePlaying(q); } return q.vx === 0 && q.vy === 0.27; })(), 'tick-7 hop (breaks if script changes)');
  okAv((() => { const q = mk({ sitting: true }); Pd.setMainhand(q, MCL.Equip.stackOf('bamboo')); Pd.updateEating(q, { random: () => 0.5 }); return !q.eating; })(), 'no eating start on a bad roll');
  okAv((() => { const q = mk({ growAge: 6000 }); used = 0; Pd.interact(q, 'bamboo', opt); return used === 1 && q.eating === true; })(), 'interact eat branch');
}

// ── 10. resetAttributes (#926) ──────────────────────────────────────────────────────────────
say('10. Pd.resetAttributes — weak max health 10, lazy speed 0.07, on spawn and createChild');
{
  const G = Pd.Gene;
  const weak = EL.spawn('panda', 0, 64, 0, { mainGene: G.WEAK, hiddenGene: G.WEAK });
  ok(weak.maxHealth === 10, `weak panda maxHealth ${weak.maxHealth}, expected 10`);
  const lazy = EL.spawn('panda', 0, 64, 0, { mainGene: G.LAZY, hiddenGene: G.LAZY });
  ok(lazy.speedAttr === 0.07 && Ai.movementSpeedOf(lazy) === 0.07, `lazy panda speed ${Ai.movementSpeedOf(lazy)}, expected 0.07`);
  ok(lazy.maxHealth === 20, 'lazy panda keeps 20 max health');
  const norm = EL.spawn('panda', 0, 64, 0, { mainGene: G.NORMAL, hiddenGene: G.NORMAL });
  ok(norm.maxHealth === 20 && norm.speedAttr === undefined, 'normal panda keeps table health/speed');
  const wp = { mainGene: G.WEAK, hiddenGene: G.WEAK };
  const kid = { type: 'panda', maxHealth: 20 };
  Pd.createChild(kid, wp, wp, () => 0.9);
  ok(Pd.isWeak(kid) && kid.maxHealth === 10, `weak child maxHealth ${kid.maxHealth}, expected 10`);
  const lp = { mainGene: G.LAZY, hiddenGene: G.LAZY };
  const kid2 = { type: 'panda', maxHealth: 20 };
  Pd.createChild(kid2, lp, lp, () => 0.9);
  ok(kid2.speedAttr === 0.07, `lazy child speedAttr ${kid2.speedAttr}, expected 0.07`);

  const save = Pd.resetAttributes;
  Pd.resetAttributes = () => {};
  const w2 = EL.spawn('panda', 0, 64, 0, { mainGene: G.WEAK, hiddenGene: G.WEAK });
  okAv(w2.maxHealth !== 10, 'a no-op resetAttributes leaves a weak panda at 20 (check sees it)');
  Pd.resetAttributes = save;
  okAv(Pd.isWeak(weak) && !Pd.isWeak(norm), 'weak/normal genes differ, so the 10-vs-20 assertion is not vacuous');
}

// PandaFleeGoal(HostileEntity.class): the threat list holds HostileEntity subclasses only (#2027)
{
  const Orig = Ai.AvoidEntityGoal, caps = [];
  Ai.AvoidEntityGoal = function (e, r, sp, threats, av, o) { caps.push({ r, threats }); return new Orig(e, r, sp, threats, av, o); };
  Ai.AvoidEntityGoal.prototype = Orig.prototype;
  const pe = EL.spawn('panda', 0, 64, 0, {});
  const spawned = {};
  for (const n of ['zombie', 'slime', 'magma_cube', 'ghast', 'phantom', 'shulker', 'hoglin', 'ender_dragon']) {
    try { spawned[n] = EL.spawn(n, 1, 64, 1, {}); } catch (err) { /* not in this roster */ }
  }
  Ai.ROSTER.panda(pe, { random: Math.random, animals: () => [], players: () => [] });
  Ai.AvoidEntityGoal = Orig;
  const hostile = caps.find((c) => c.r === 4);
  const got = new Set(hostile ? hostile.threats().map((o) => o.type) : []);
  ok(got.has('zombie'), 'panda flee list holds a zombie (a HostileEntity)');
  for (const n of ['slime', 'magma_cube', 'ghast', 'phantom', 'shulker', 'hoglin', 'ender_dragon'])
    if (spawned[n]) ok(!got.has(n), `panda flee list must not hold ${n} (Monster but not HostileEntity)`);
  okAv(Object.keys(spawned).length > 3 && got.size > 0, 'flee-list check saw spawned mobs, so the exclusions are not vacuous');
}

// #2799: pack members (spawnIdx>0) roll the PassiveData(0.2F) baby chance; the first never does
{
  const R = EL.random; let baby = 0;
  try {
    EL.random = () => 0.1; baby = EL.spawn('panda', 0, 64, 0, { spawnIdx: 1 }).isBaby ? 1 : 0;
    ok(baby === 1, 'pack panda (spawnIdx 1, roll 0.1) must be a baby');
    EL.random = () => 0.5;
    ok(!EL.spawn('panda', 0, 64, 0, { spawnIdx: 1 }).isBaby, 'pack panda with roll 0.5 stays adult');
    EL.random = () => 0.1;
    ok(!EL.spawn('panda', 0, 64, 0, { spawnIdx: 0 }).isBaby, 'first panda (spawnIdx 0) never rolls baby');
  } finally { EL.random = R; }
  okAv(baby === 1, 'baby assertion is not vacuous (a forced low roll yields a baby)');
}

// #3073: PandaEntity.damage() clears sitting on every hit
{
  const q = EL.spawn('panda', 0, 64, 0, {}); q.sitting = true; q.invulnerableTime = 0;
  Cb.hurt(q, 1, 0, null, { source: 'generic' });
  ok(q.sitting === false, 'a hit must clear a sitting panda');
  const z = EL.spawn('cow', 0, 64, 0, {}); z.sitting = true; z.invulnerableTime = 0;
  Cb.hurt(z, 1, 0, null, { source: 'generic' });
  okAv(z.sitting === true && Cb.hurt(q, 1, 99, null, { source: 'generic' }) !== undefined, 'the hook is panda-only: a hit cow keeps the flag, so the panda assertion can fail');
}

// #3532: AttackGoal keeps going while non-idle; foodNear is a box-expand; ask-for-bamboo looks at target
{
  const P = MCL.Panda;
  const q = EL.spawn('panda', 0, 64, 0, {}); const z = EL.spawn('zombie', 1, 64, 0, {});
  q.target = z; const g = new MCL.Panda.AttackGoal(q, {});
  q.sitting = true;
  ok(!P.isIdle(q) && g.canContinueToUse(), 'attack goal continues while panda is non-idle');
  okAv(!g.canUse(), 'canUse (start) still needs idle, so the continue assertion can fail');
  z.health = 0;
  okAv(!g.canContinueToUse(), 'dead target ends the attack');
  const f = { type: 'item', x: 0, y: 64, z: 0, width: 0.25, height: 0.25, item: MCL.Items.of('bamboo'), count: 3, pickupDelay: 0, removed: false };
  EL.list.push(f);
  if (P.isFoodEntity(f)) {
    f.x = q.x + 6 + (q.width + f.width) / 2 - 0.01; f.y = q.y; f.z = q.z;
    ok(P.foodNear(q, 6).includes(f), 'food just inside the expanded box is found');
    f.x += 0.02; okAv(!P.foodNear(q, 6).includes(f), 'food just outside is not');
    f.x = q.x; f.y = q.y + q.height + 6 - 0.01; ok(P.foodNear(q, 6).includes(f), 'box reaches 6 above the panda top');
    f.y = q.y - 6 - f.height + 0.01; ok(P.foodNear(q, 6).includes(f), 'box reaches 6 below incl. item height');
    f.y = q.y - 6 - f.height - 0.01; okAv(!P.foodNear(q, 6).includes(f), 'below the box is not found');
    f.pickupDelay = 10; okAv(!P.isFoodEntity(f), 'item still in pickup delay is not food (#4184)');
    EL.list.pop();
  } else okAv(false, 'bamboo item must be panda food');
}

// #3659: RevengeGoal.canTrack refuses a creative attacker
{
  const q = EL.spawn('panda', 0, 64, 0, {}); const pl = { type: 'player', health: 20, x: 1, y: 64, z: 0 };
  const g = new MCL.Panda.RevengeGoal(q, {});
  q.hurtSeq = 1; q.hurtAge = q.age || 0; q.lastHurtByEntity = pl;
  const was = pl.invulnerableGamemode; pl.invulnerableGamemode = true;
  ok(!g.canUse(), 'creative attacker is not a revenge target');
  pl.invulnerableGamemode = false;
  okAv(g.canUse(), 'survival attacker is, so the creative assertion can fail');
  pl.invulnerableGamemode = was;
}

// #3901: dropHeld spawns the item at the panda's feet (Entity.dropStack(stack, 0.0F))
{
  const q = EL.spawn('panda', 0, 64, 0, {}); Pd.setMainhand(q, MCL.Equip.stackOf('bamboo'));
  const before = new Set(EL.list);
  Pd.dropHeld(q);
  const it = EL.list.find((o) => !before.has(o) && o.type === 'item');
  ok(it && it.y === q.y, 'dropped held food spawns at panda feet y');
  okAv(!it || it.y !== q.y + 0.5, 'a +0.5 drop would be caught');
}

// #4511: tick() order - worried sit/stand is set BEFORE the progress floats advance (vanilla sitProg 0.15 after one tick)
{
  const q = EL.spawn('panda', 0.5, 64, 0.5, { mainGene: Pd.Gene.WORRIED, hiddenGene: Pd.Gene.WORRIED });
  q.sitting = false; q.sitProg = 0; Pd.thundering = () => true;
  EL.tickMob(q);
  Pd.thundering = null;
  ok(Math.abs(q.sitProg - 0.15) < 1e-9 && q.lastSitProg === 0, 'worried panda in thunder: sitProg 0.15 after one tick, got ' + q.sitProg);
  const w = { sitting: true, sitProg: 0 }; Pd.tickAnim(w);
  okAv(w.sitProg === 0.15 && !(w.sitting = false) && (Pd.tickAnim(w), w.sitProg < 0.15), 'a stale-flag order would be caught');
}

// #4626: damage clamps health to the lowered max health (LivingEntity.setHealth)
{
  const q = EL.spawn('panda', 0, 64, 0, { mainGene: Pd.Gene.WEAK, hiddenGene: Pd.Gene.WEAK });
  Cb.hurt(q, 6, 1000, true, {});
  ok(q.maxHealth === 10 && q.health <= q.maxHealth, 'weak panda health <= 10 after a 6 hit, got ' + q.health);
  okAv(q.health !== 14, 'an unclamped subtraction (14) would be caught');
}

console.log('================ pandacheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log(`pandacheck: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
