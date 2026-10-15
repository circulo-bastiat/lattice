#!/usr/bin/env node
// xporbcheck.mjs — G21: EXPERIENCE ORBS (src/07zz_xporb.js).
//
//   node tools/xporbcheck.mjs [--verbose]
//
// ⚠ WHAT THIS PROVES. `Xp.spawn` actually splits/merges into vanilla's own orb sizes
// (`ExperienceOrbEntity.roundToOrbSize`/`wasMergedIntoExistingOrb`), `Xp.xpToDrop` reproduces
// `MobEntity.getXpToDrop` (base table, baby-zombie 2.5x, armour/hand bonus) and `Xp.dropMobXp`'s
// three gates (playerHitTimer/shouldDropXp/doMobLoot) each actually refuse on their own, orb
// physics/follow/merge/despawn run over real ticks through the SAME `EL.tickOne` dispatch the
// engine uses, and `Xp.pickupTick` actually feeds `Sv.addXp`. Every gate/table below is proven
// in BOTH directions (rule 6): the case that should produce an orb, and the one that should not.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (VERBOSE) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('xporbcheck — G21, experience orbs (07zz_xporb.js)');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
          '07d_mining.js', '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '07m_breed.js',
          '07w_passive.js', '07zd_slime.js', '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js',
          '07p_trade.js', '07zz_xporb.js', '14g_menu.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
{
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
{
  const lootMeta = JSON.parse(readFileSync(join(ASSETS, 'loot.meta.json'), 'utf8'));
  M.Loot.init({ loot: readFileSync(join(ASSETS, 'loot.bin')).toString('base64'), lootBytes: lootMeta.jsonBytes });
}
// a floor at y=64, the entlistcheck/tamecheck idiom -- motion is arithmetic, not terrain
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.blockAt = () => 0; // air: Ph.move reads it for fluids, no World loaded
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
M.Equip.init();
M.Breed.init();
M.Passive.init();
M.Xp.init();

const EL = M.EntityList, Xp = M.Xp, Br = M.Breed;
ok(Xp.ready, 'Xp module reports ready');
if (!Xp.ready) { console.log('\nFAIL  Xp did not initialise'); process.exit(1); }

// ── §1. roundToOrbSize / Xp.spawn splits + spawn-time merge ─────────────────────────────
say('\n§1 — orb-size split and spawn-time merge');
{
  ok(Xp.roundToOrbSize(1) === 1 && Xp.roundToOrbSize(2) === 1, 'roundToOrbSize below 3 is 1');
  ok(Xp.roundToOrbSize(6) === 3 && Xp.roundToOrbSize(9) === 7, 'roundToOrbSize picks the largest size <= v (3..6 -> 3, 7..16 -> 7)');
  ok(Xp.roundToOrbSize(2477) === 2477 && Xp.roundToOrbSize(999999) === 2477, 'roundToOrbSize caps at 2477');

  const orbs = Xp.spawn(0, 70, 0, 100);
  const total = orbs.reduce((s, o) => s + o.value * o.pickingCount, 0);
  ok(total === 100, `Xp.spawn(100) orbs sum back to 100 (got ${total})`);
  ok(orbs.every((o) => o.type === 'experience_orb'), 'every spawned entity is an experience_orb');

  // 14 splits into 7+7 -- the SECOND chunk lands on the SAME spot as the first and must fold
  // into it (wasMergedIntoExistingOrb, simplified) rather than spawning a second entity.
  const before = EL.list.length;
  // isMergeable's `(getId() - seed) % 40 == 0`: a constant rand whose seed is the first orb's id mod 40 lets the second chunk fold
  const seedR = ((EL.nextId % 40) + 0.5) / 40, orbs2 = Xp.spawn(10, 70, 10, 14, () => seedR);
  ok(orbs2.length === 1 && EL.list.length === before + 1, '14 xp at one spot spawns ONE entity, not two (7+7 folds)');
  ok(orbs2[0].value === 7 && orbs2[0].pickingCount === 2, 'the folded orb is value=7, pickingCount=2');

  // anti-vacuity: two DIFFERENT-value chunks at the same spot must NOT fold into one another.
  const before2 = EL.list.length;
  const orbs3 = Xp.spawn(20, 70, 20, 24);          // 17 + 7, different values
  okAv(orbs3.length === 2 && EL.list.length === before2 + 2, 'anti-vacuity: 17+7 at one spot spawns TWO entities (different values never fold)');
}

// ── §2. Xp.xpToDrop: the base table, baby-zombie doubling, armour/hand bonus ───────────
say('\n§2 — xpToDrop: base table, baby zombie, armour/hand bonus');
{
  // ⚠ zombie/skeleton spawn with a chance of random vanilla equipment (07y_equip.js's own
  // spawn-time roll), which would make the armour/hand BONUS non-deterministic here -- that
  // bonus gets its own dedicated, controlled test below. e.equip = [] isolates the BASE number.
  const z = EL.spawn('zombie', 0, 70, 0); z.equip = [];
  ok(Xp.xpToDrop(z) === 5, `plain zombie xpToDrop is 5 (HostileEntity default), got ${Xp.xpToDrop(z)}`);
  // KW-34 (s136, referee reds, .infra finding 1): `AnimalEntity.getXpToDrop` is `1 +
  // random.nextInt(3)`, NOT 0 -- this assertion used to claim the opposite ("a cow ... drops 0
  // xp") and was itself the bug this table's old comment ("vanilla's own behaviour") got wrong.
  const cow = EL.spawn('cow', 0, 70, 0);
  ok(Xp.xpToDrop(cow, () => 0) === 1, `a cow (AnimalEntity default, r()=>0) drops exactly 1 xp, got ${Xp.xpToDrop(cow, () => 0)}`);
  ok(Xp.xpToDrop(cow, () => 0.99) === 3, `a cow (AnimalEntity default, r()=>0.99) drops exactly 3 xp, got ${Xp.xpToDrop(cow, () => 0.99)}`);
  ok(Xp.xpToDrop(null) === 0 && Xp.xpToDrop({}) === 0, 'a null/typeless entity drops 0 rather than throwing');
  const babyCow = EL.spawn('cow', 0, 70, 0); babyCow.growAge = -1000;
  okAv(Xp.xpToDrop(babyCow, () => 0) === 1, 'anti-vacuity note: xpToDrop itself does not gate on baby (that is dropMobXp\'s shouldDropXp job, §3) -- ' +
    'a baby cow still COMPUTES 1 here, got ' + Xp.xpToDrop(babyCow, () => 0));

  // the rest of the closed AnimalEntity/WaterCreatureEntity set this pass added (KW-34 finding 1):
  // spot-check a few different hierarchy branches, not just the referee's own tested cow/sheep/
  // pig/chicken/rabbit/wolf/fox/horse/goat/squid/cod, since the table covers more than those 11.
  for (const t of ['sheep', 'pig', 'rabbit', 'wolf', 'fox', 'goat', 'squid', 'cod',
                    'horse', 'donkey', 'mule', 'llama', 'trader_llama', 'skeleton_horse', 'zombie_horse',
                    'cat', 'parrot', 'axolotl', 'turtle', 'polar_bear', 'panda', 'ocelot', 'bee',
                    'mooshroom', 'glow_squid', 'dolphin', 'salmon', 'tropical_fish', 'pufferfish']) {
    const m = EL.spawn(t, 0, 70, 0);
    ok(!!m && Xp.xpToDrop(m, () => 0) === 1, `${t} (Xp.ANIMAL_XP, r()=>0) drops exactly 1 xp, got ${m ? Xp.xpToDrop(m, () => 0) : '(EL.spawn gave nothing)'}`);
  }
  // and the closed set stays CLOSED -- a golem/villager/bat (not AnimalEntity/WaterCreatureEntity)
  // must still drop 0, or "every unlisted type defaults to 1..3" would be the real rule instead.
  for (const t of ['villager', 'iron_golem', 'snow_golem', 'bat', 'wandering_trader']) {
    const m = EL.spawn(t, 0, 70, 0);
    okAv(!!m && Xp.xpToDrop(m, () => 0) === 0, `anti-vacuity: ${t} (not AnimalEntity/WaterCreatureEntity/Xp.BASE) still drops 0 xp`);
  }

  // KW-34 finding 3 — silverfish/endermite/phantom were simply missing from Xp.BASE.
  const silverfish = EL.spawn('silverfish', 0, 70, 0); silverfish.equip = [];
  ok(Xp.xpToDrop(silverfish) === 5, `silverfish drops 5 xp (HostileEntity default, no override), got ${Xp.xpToDrop(silverfish)}`);
  const endermite = EL.spawn('endermite', 0, 70, 0); endermite.equip = [];
  ok(Xp.xpToDrop(endermite) === 3, `endermite drops 3 xp (EndermiteEntity.java:37), got ${Xp.xpToDrop(endermite)}`);
  const phantom = EL.spawn('phantom', 0, 70, 0); phantom.equip = [];
  ok(Xp.xpToDrop(phantom) === 5, `phantom drops 5 xp (PhantomEntity.java:51), got ${Xp.xpToDrop(phantom)}`);

  var shulkerBreaks = 0;
  // #1346 -- ShulkerEntity constructor experiencePoints = 5 (extends GolemEntity, not HostileEntity).
  const shulkerXp = EL.spawn('shulker', 0, 70, 0); shulkerXp.equip = [];
  ok(Xp.xpToDrop(shulkerXp) === 5, `shulker drops 5 xp (ShulkerEntity ctor), got ${Xp.xpToDrop(shulkerXp)}`);
  {
    const sv = Xp.BASE.shulker; delete Xp.BASE.shulker;
    if (Xp.xpToDrop(shulkerXp) !== 5) shulkerBreaks++; else fails.push('anti-vacuity: removing Xp.BASE.shulker not caught');
    Xp.BASE.shulker = sv;
  }

  // #916 -- giant was missing from Xp.BASE. Every rostered HostileEntity subclass with no own
  // experiencePoints literal in .decomp must carry HostileEntity's 5.
  const giant = EL.spawn('giant', 0, 70, 0); giant.equip = [];
  ok(Xp.xpToDrop(giant) === 5, `giant drops 5 xp (HostileEntity.java:29), got ${Xp.xpToDrop(giant)}`);
  {
    const fs = await import('node:fs');
    const dir = '.decomp/net/minecraft/entity/mob/';
    for (const f of ['GiantEntity', 'SilverfishEntity', 'CreeperEntity', 'WitchEntity', 'EndermanEntity', 'SpiderEntity']) {
      const src = fs.readFileSync(dir + f + '.java', 'utf8');
      const own = /experiencePoints = (\d+)/.exec(src);
      const t = f.replace('Entity', '').toLowerCase();
      ok(Xp.BASE[t] === (own ? +own[1] : 5), `Xp.BASE.${t} matches .decomp (${own ? own[1] : 'HostileEntity 5'}), got ${Xp.BASE[t]}`);
    }
    const saved = Xp.BASE.giant; delete Xp.BASE.giant;
    okAv(Xp.xpToDrop(giant) === 0, 'anti-vacuity: without the giant key it drops 0 (the #916 bug)');
    Xp.BASE.giant = saved;
  }

  const babyZ = EL.spawn('zombie', 0, 70, 0); babyZ.equip = [];
  babyZ.growAge = -1000;   // Br.isBaby: growAge < 0
  ok(Xp.xpToDrop(babyZ) === Math.floor(5 * 2.5), `a baby zombie doubles (2.5x) to ${Math.floor(5 * 2.5)}, got ${Xp.xpToDrop(babyZ)}`);
  const babySkel = EL.spawn('skeleton', 0, 70, 0); babySkel.equip = [];
  babySkel.growAge = -1000;
  okAv(Xp.xpToDrop(babySkel) === 5, 'anti-vacuity: a baby SKELETON does NOT double (AbstractSkeletonEntity has no such override) -- got ' + Xp.xpToDrop(babySkel));

  // slime: xpToDrop reads e.experiencePoints directly, set by Sl.setSize, not the BASE table
  M.Slime.setSize(EL.spawn('slime', 0, 70, 0), 3, true);
  const bigSlime = EL.list[EL.list.length - 1];
  ok(Xp.xpToDrop(bigSlime) === 3, `a size-3 slime drops 3 xp (e.experiencePoints, not Xp.BASE), got ${Xp.xpToDrop(bigSlime)}`);

  // chicken jockey special case -- ChickenEntity.getXpToDrop is `hasJockey() ? 10 :
  // super.getXpToDrop()`, and KW-34 finding 1 is that the super call (AnimalEntity's 1+rand(3))
  // was never wired at all -- a plain chicken is the SAME closed table as cow/sheep/etc, not 0.
  const chick = EL.spawn('chicken', 0, 70, 0);
  ok(Xp.xpToDrop(chick, () => 0) === 1, `a plain chicken (AnimalEntity default, r()=>0) drops 1 xp, got ${Xp.xpToDrop(chick, () => 0)}`);
  M.Passive.setChickenJockey(chick, true);
  ok(Xp.xpToDrop(chick) === 10, `a chicken-jockey chicken drops 10 xp, got ${Xp.xpToDrop(chick)}`);

  // armour/hand bonus -- MobEntity.getXpToDrop's own 1+random(3) per worn slot at chance <= 1.0
  const IT = M.Items;
  const z2 = EL.spawn('zombie', 0, 70, 0); z2.equip = [];
  const stack = { i: IT.of('iron_helmet'), n: 1 };
  M.Equip.setEquipped(z2, IT.HEAD, stack);
  const withHelmet = Xp.xpToDrop(z2, () => 0);      // r()=0 -> bonus is exactly 1
  ok(withHelmet === 6, `zombie + one worn slot (chance <= 1.0) adds 1..3 (r()=>0 gives exactly 1): expected 6, got ${withHelmet}`);
  const z3 = EL.spawn('zombie', 0, 70, 0); z3.equip = [];
  M.Equip.setEquipped(z3, IT.HEAD, stack);
  M.Equip.setDropChance(z3, IT.HEAD, 2.0);          // vanilla's "never drops" sentinel
  okAv(Xp.xpToDrop(z3, () => 0) === 5, 'anti-vacuity: a slot at dropChance > 1.0 (the "never" sentinel) earns NO xp bonus');
}

// ── §3. Xp.dropMobXp: the three gates, each direction ──────────────────────────────────
say('\n§3 — dropMobXp gates: playerHitTimer / shouldDropXp / doMobLoot');
{
  let mkN = 0;
  const mk = () => { const e = EL.spawn('zombie', 500 + mkN, 70, 500); mkN += 5; e.height = 1.95; e.equip = []; return e; };

  const notHit = mk();
  ok(Xp.dropMobXp(notHit) === null, 'a zombie the player never hit drops no orb');
  const hit = mk(); hit.playerHitTimer = 100; hit.attackingPlayer = true;
  const before = EL.list.length;
  const dropped = Xp.dropMobXp(hit);
  ok(Array.isArray(dropped) && dropped.length > 0 && EL.list.length > before, 'a player-hit zombie DOES drop an orb');
  ok(dropped.every(o => o.y === hit.y), `#4578 orbs spawn at the mob's FEET (getPos), not mid-body: orb y ${dropped[0].y} vs mob y ${hit.y}`);
  const droppedTotal = dropped.reduce((s, o) => s + o.value * o.pickingCount, 0);
  ok(droppedTotal === 5, `the dropped orb(s) sum to the zombie's own 5 xp (roundToOrbSize splits 5 as 3+1+1), got ${droppedTotal}`);

  // KW-34 (s136, referee reds, .infra/infra-20260925T0030Z.md finding 2): `HostileEntity.
  // shouldDropXp` (.decomp mob/HostileEntity.java:110-112) returns TRUE UNCONDITIONALLY,
  // overriding `LivingEntity`'s own `!isBaby()` default -- a baby zombie DOES drop xp, scaled
  // 2.5x by `ZombieEntity.getXpToDrop` (5 -> floor(12.5) = 12). This assertion used to claim the
  // opposite ("a baby zombie drops no orb") and was itself the referee's D-30 catch: the OLD
  // behaviour (`if (baby) return null` with no HostileEntity carve-out) was the bug, not a rule.
  const babyHit = mk(); babyHit.playerHitTimer = 100; babyHit.attackingPlayer = true; babyHit.growAge = -1000;
  const babyDropped = Xp.dropMobXp(babyHit);
  const babyTotal = Array.isArray(babyDropped) ? babyDropped.reduce((s, o) => s + o.value * o.pickingCount, 0) : -1;
  ok(babyTotal === 12, `a player-hit BABY zombie drops 12 xp (5 x 2.5, HostileEntity.shouldDropXp overrides the baby gate), got ${babyTotal}`);

  // anti-vacuity's other half stays real: a baby ANIMAL (no HostileEntity override) still drops
  // nothing -- `AnimalEntity` never overrides `shouldDropXp`.
  const babyCow = EL.spawn('cow', 600, 70, 600); babyCow.height = 1.3; babyCow.equip = [];
  babyCow.playerHitTimer = 100; babyCow.attackingPlayer = true; babyCow.growAge = -1000;
  okAv(Xp.dropMobXp(babyCow) === null, 'anti-vacuity: a baby COW (AnimalEntity, no shouldDropXp override) still drops no orb even when player-hit');

  const gr = M.DATA.gameRules;
  M.DATA.gameRules = Object.assign({}, gr, { doMobLoot: { d: 'false' } });
  const noLoot = mk(); noLoot.playerHitTimer = 100; noLoot.attackingPlayer = true;
  okAv(Xp.dropMobXp(noLoot) === null, 'anti-vacuity: doMobLoot=false refuses the orb too, same gate dropLoot itself uses');
  M.DATA.gameRules = gr;
}

// ── §3b. playerHitTimer: armed by the real hurt path, decayed by the real tick ──────────
// `LivingEntity.damage` (.decomp:1087-1098) arms 100 ticks for a player attacker (a projectile's
// shooter included) or a TAMED wolf; `baseTick` (:416-420) decays it; `drop()` reads it (:1337/1352).
say('\n§3b — playerHitTimer (Cb.notePlayerHit / Cb.tickPlayerHit), both directions');
{
  const Cb = M.Combat;
  if (!M.Player) M.Player = { type: 'player', x: 0, y: 0, z: 0 };
  let n = 0;
  const mk = () => { const e = EL.spawn('zombie', 700 + n, 70, 700); n += 5; e.height = 1.95; e.equip = []; return e; };
  const tick = (e, k) => { for (let i = 0; i < k; i++) Cb.tickEntity(e); };

  const melee = mk();
  ok(Cb.hurt(melee, 1, undefined, true) && melee.playerHitTimer === 100 && melee.attackingPlayer === true,
    `a player's blow arms playerHitTimer=100 (got ${melee.playerHitTimer})`);
  tick(melee, 99);
  ok(Cb.recentlyHitByPlayer(melee) && Xp.dropMobXp(melee) !== null, 'after 99 ticks the hit still counts: the orb drops');
  const late = mk(); Cb.hurt(late, 1, undefined, true); tick(late, 100);
  ok(!Cb.recentlyHitByPlayer(late) && Xp.dropMobXp(late) === null, `after 100 ticks the window is shut: no orb (timer ${late.playerHitTimer})`);
  tick(late, 1);
  ok(late.attackingPlayer === false, 'one tick at 0 forgets attackingPlayer (the else branch)');
  // anti-vacuity: a decay that never runs must be caught by the 100-tick case above
  const realTick = Cb.tickPlayerHit;
  Cb.tickPlayerHit = function () {};
  const frozen = mk(); Cb.hurt(frozen, 1, undefined, true); tick(frozen, 100);
  okAv(Xp.dropMobXp(frozen) !== null, 'anti-vacuity: with no decay the 100-tick-old hit would still drop an orb — the check sees it');
  Cb.tickPlayerHit = realTick;

  const shot = mk();
  Cb.hurt(shot, 1, undefined, false, { attacker: M.Player });
  ok(shot.playerHitTimer === 100 && Cb.killedByPlayer(shot), "a projectile whose shooter is the player arms it (getAttacker() is the shooter)");
  const mobShot = mk();
  Cb.hurt(mobShot, 1, undefined, false, { attacker: { type: 'skeleton' } });
  ok(!(mobShot.playerHitTimer > 0), "a skeleton's arrow does not");
  const tw = mk();
  Cb.hurt(tw, 1, undefined, false, { attacker: { type: 'wolf', tamed: true, owner: 'player' } });
  ok(tw.playerHitTimer === 100 && Cb.killedByPlayer(tw), "a TAMED wolf's bite arms it and credits the owner");
  const ww = mk();
  Cb.hurt(ww, 1, undefined, false, { attacker: { type: 'wolf', tamed: false } });
  ok(!(ww.playerHitTimer > 0), 'a wild wolf does not');
  const env = mk(); Cb.hurt(env, 1, undefined, false);
  ok(!(env.playerHitTimer > 0) && Xp.dropMobXp(env) === null, 'plain environmental damage arms nothing, drops no orb');

  // the live call sites pass the attacker (a player's arrow/trident/snowball; the sweep is a player blow)
  const src = readFileSync(join(ROOT, 'src', '14j_combat.js'), 'utf8');
  const shooterSites = (src.match(/Cb\.hurt\(t, [^;]*\{ attacker: e\.shooter \|\| null[^}]*\}\)/g) || []).length;
  ok(shooterSites >= 3, `arrow, trident and snowball hits hand Cb.hurt their shooter (found ${shooterSites} of 3)`);
  ok(/Cb\.hurt\(o, f3, undefined, true, \{ attacker: P \}\)/.test(src), 'the sweep hits are player blows (Cb.hurt(o, f3, …, true, { attacker: P }))');
  ok(!/lastHurtByPlayer/.test(src), 'the old never-expiring lastHurtByPlayer flag is gone (rule 5)');

  // MobEntity.dropEquipment's ($$2 || $$6): a >1.0 chance piece drops on ANY death
  const Eq = M.Equip, IT = M.Items;
  const helm = { i: IT.of('iron_helmet'), n: 1 };
  const g = mk(); Eq.setEquipped(g, IT.HEAD, helm); Eq.setDropChance(g, IT.HEAD, 2.0);
  ok(Eq.dropEquipment(g, () => 0.5, false).length === 1, 'a chance>1.0 piece drops even off a non-player death');
  const q = mk(); Eq.setEquipped(q, IT.HEAD, { i: helm.i, n: 1 }); Eq.setDropChance(q, IT.HEAD, 0.085);
  okAv(Eq.dropEquipment(q, () => 0, false).length === 0, 'anti-vacuity: an ordinary 8.5% piece needs the player flag even when the roll would pass');
  ok(Eq.dropEquipment(q, () => 0, true).length === 1, '…and drops with it');
}

// ── §4. Cb.dropLoot's own dispatch actually calls Xp.dropMobXp ─────────────────────────
say('\n§4 — 14j_combat.js Cb.dropLoot wiring');
{
  const Cb = M.Combat;
  const e = EL.spawn('zombie', 600, 70, 600);
  e.height = 1.95; e.equip = []; e.playerHitTimer = 100; e.attackingPlayer = true; e.lootDropped = false;
  const near = (o) => o.type === 'experience_orb' && Math.abs(o.x - 600) < 1 && Math.abs(o.z - 600) < 1;
  const before = EL.list.filter(near).length;
  Cb.dropLoot(e);
  const after = EL.list.filter(near).length;
  ok(after > before, 'Cb.dropLoot (the real death path, 14j_combat.js) spawns an xp orb too, not just Xp.dropMobXp called directly');

  // KW-34 (s136, referee reds, .infra finding 4): a size>1 slime/magma_cube used to `return`
  // out of Cb.dropLoot before Xp.dropMobXp ever ran (the empty LOOT TABLE early-out also ate
  // the xp dispatch below it) -- `LivingEntity.drop` runs dropXp unconditionally regardless of
  // the loot table. Size-1 already passed before this fix; size>1 is the actual red line.
  const big = EL.spawn('slime', 620, 70, 620);
  M.Slime.setSize(big, 2, true);
  big.playerHitTimer = 100; big.attackingPlayer = true; big.lootDropped = false; big.equip = [];
  const nearBig = (o) => o.type === 'experience_orb' && Math.abs(o.x - 620) < 1 && Math.abs(o.z - 620) < 1;
  const beforeBig = EL.list.filter(nearBig).length;
  Cb.dropLoot(big);
  const afterBig = EL.list.filter(nearBig).length;
  ok(afterBig > beforeBig, 'a size-2 slime (Cb.dropLoot, the LOOT-TABLE-skip case) still spawns an xp orb (e.experiencePoints = size = 2)');

  const big4 = EL.spawn('magma_cube', 640, 70, 640);
  M.Slime.setSize(big4, 4, true);
  big4.playerHitTimer = 100; big4.attackingPlayer = true; big4.lootDropped = false; big4.equip = [];
  const nearBig4 = (o) => o.type === 'experience_orb' && Math.abs(o.x - 640) < 1 && Math.abs(o.z - 640) < 1;
  const beforeBig4 = EL.list.filter(nearBig4).length;
  Cb.dropLoot(big4);
  const afterBig4 = EL.list.filter(nearBig4).length;
  ok(afterBig4 > beforeBig4, 'a size-4 magma_cube (Cb.dropLoot, the LOOT-TABLE-skip case) still spawns an xp orb (e.experiencePoints = size = 4)');
}

// ── §5. Breed.spawnXp routed through Xp.spawn ──────────────────────────────────────────
say('\n§5 — breeding xp (Br.spawnXp -> Xp.spawn)');
{
  ok(Br.ready, 'Breed module did not initialise (E.BREED missing from entities.json?)');
  const parent = { x: 1, y: 70, z: 1, height: 1.4 };
  let sawValue = null;
  for (let i = 0; i < 50 && sawValue === null; i++) {
    const before = EL.list.length;
    const r = Br.spawnXp(parent, { random: Math.random });
    if (r && r.length) sawValue = r[0].value;
    else if (EL.list.length > before) sawValue = EL.list[EL.list.length - 1].value;
  }
  ok(sawValue !== null, 'Br.spawnXp produced an orb over 50 tries');
  ok(sawValue >= 1 && sawValue <= 7, `breeding xp is 1..7 (Br.C.xpBound), got ${sawValue}`);
}

// ── §6. villager trade -- the player-facing reward orb ─────────────────────────────────
say('\n§6 — villager trade xp orb (VillagerEntity.afterUsing)');
{
  const Trade = M.Trade;
  // a synthetic, minimal offer table (loop/vtype's own tsv is tradecheck's to parse; this unit
  // only needs ONE real sell-wheat row to drive Trade.attempt through the SAME mechanism)
  M.DATA = Object.assign({}, M.DATA, { villagerTrades: {
    farmer: { 1: [{ kind: 'sell_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 1, maxUses: 16, xp: 2, priceMult: 0.05 }] }
  } });
  M.Trade.OFFERS_PER_LEVEL = 99;
  const wheatId = M.Items.of('wheat'), emeraldId = M.Items.of('emerald');
  const farmerOffers = Trade.offersFor('farmer');
  const idx = farmerOffers.findIndex((o) => o.item === 'wheat' && o.kind === 'sell_item_for_emerald');
  ok(idx >= 0, 'no sell-wheat farmer offer found to trade against');
  if (idx >= 0) {
    const e = { type: 'villager', profession: 'farmer', x: 3, y: 70, z: 3, tradeUses: {}, villagerLevel: 1 };
    const P = { inventory: M.Inventory.create(), instabuild: false };
    M.Inventory.setItem(P.inventory, 0, { i: wheatId, n: 20 });
    const beforeOrbs = EL.list.filter((x) => x.type === 'experience_orb').length;
    const r = Trade.attempt(e, idx, P);
    ok(r.ok === true, 'the trade itself still succeeds with Xp wired in: ' + (r && r.reason));
    const afterOrbs = EL.list.filter((x) => x.type === 'experience_orb');
    ok(afterOrbs.length > beforeOrbs, 'a successful trade spawns a player-facing xp orb');
    const near = afterOrbs.filter((o) => Math.abs(o.x - 3) < 1 && Math.abs(o.z - 3) < 1);
    ok(near.length > 0, 'the trade orb spawns at the villager\'s own position');
    const v = near.reduce((s, o) => s + o.value * (o.pickingCount || 1), 0);
    ok(v >= 3 && v <= 11, `trade reward is 3..6 (or +5 on a level-up, so up to 11), got ${v}`);
  }
}

// ── §7. per-tick physics: follow, merge, despawn (through the REAL EL.tickOne dispatch) ─
say('\n§7 — orb tick: follow, merge, 6000-tick despawn');
{
  // follow: a player within FOLLOW_RANGE pulls the orb toward them over the 20-tick refresh
  const orb = EL.spawn('experience_orb', 0, 70, 0);
  orb.value = 7; orb.pickingCount = 1; orb.orbAge = 0;
  M.Player = { x: 4, y: 70, z: 0, dead: false, eyeHeight: 1.62 };
  for (let t = 0; t < 21; t++) EL.tickOne(orb);
  ok(orb.xpTarget === true, 'a player within 8 blocks is acquired as a target on the 20-tick refresh');
  ok(orb.vx > 0, `the orb's velocity was pulled toward the player on +x (got vx=${orb.vx})`);

  const orbFar = EL.spawn('experience_orb', 0, 70, 0);
  orbFar.value = 7; orbFar.pickingCount = 1; orbFar.orbAge = 0;
  M.Player = { x: 50, y: 70, z: 0, dead: false, eyeHeight: 1.62 };
  for (let t = 0; t < 21; t++) EL.tickOne(orbFar);
  okAv(orbFar.xpTarget === false, 'anti-vacuity: a player 50 blocks away is NOT acquired as a target');

  // merge: two same-value orbs a few centimetres apart fold into one on the 20-tick refresh
  const a = EL.spawn('experience_orb', 30, 70, 30); a.value = 17; a.pickingCount = 1; a.orbAge = 0;
  const b = EL.spawn('experience_orb', 30.2, 70, 30); b.id = a.id + 40; b.value = 17;   // ids 40 apart are mergeable b.pickingCount = 1; b.orbAge = 0;
  M.Player = { x: 1000, y: 70, z: 0, dead: false, eyeHeight: 1.62 };   // out of follow range, isolate the merge
  const nearAB = (o) => o.type === 'experience_orb' && o.value === 17 && Math.abs(o.x - 30) < 1 && Math.abs(o.z - 30) < 1;
  const beforeCount = EL.list.filter(nearAB).length;
  Xp.expensiveUpdate(a);
  const afterCount = EL.list.filter((o) => nearAB(o) && !o.removed).length;
  ok(beforeCount === 2 && afterCount === 1, `two adjacent same-value orbs merge into one on expensiveUpdate (before ${beforeCount}, after ${afterCount})`);
  ok(a.pickingCount === 2, `the surviving orb absorbed the other's pickingCount, got ${a.pickingCount}`);

  // despawn: age >= 6000 removes the entity
  const old = EL.spawn('experience_orb', 40, 70, 40); old.value = 1; old.pickingCount = 1; old.orbAge = Xp.DESPAWN_AGE - 1;
  ok(old.removed !== true, 'a fresh orb one tick short of despawn age is not yet removed');
  EL.tickOne(old);
  ok(old.removed === true, `an orb reaching ${Xp.DESPAWN_AGE} ticks despawns (LivingEntity DESPAWN_AGE), removed=${old.removed}`);
  const young = EL.spawn('experience_orb', 41, 70, 41); young.value = 1; young.pickingCount = 1; young.orbAge = 0;
  EL.tickOne(young);
  okAv(young.removed !== true, 'anti-vacuity: a 1-tick-old orb must NOT despawn (proves the check above tests the real threshold)');
}

// ── §8. pickup: Xp.pickupTick feeds Sv.addXp and respects the per-player delay ──────────
say('\n§7b — furnace xp is orbs (#408)');
{
  const P = { x: 1500.5, y: 70, z: 1500.5, xpTotal: 0 };
  const cnt = () => { let n = 0, v = 0; for (const e of EL.list) if (e.type === 'experience_orb' && !e.removed && Math.abs(e.x - P.x) < 2 && Math.abs(e.z - P.z) < 2) { n++; v += e.value * e.pickingCount; } return [n, v]; };
  const be = { recipesUsed: { a: { n: 10, xp: 0.7 } } };
  const r = M.Menu.furnaceAwardXp(be, P, () => 0);
  const [n, v] = cnt();
  ok(r === 7 && v === 7 && n >= 1, `taking furnace output spawns orbs worth 7 at the player (paid ${r}, orbs ${n} worth ${v})`);
  ok(P.xpTotal === 0, `and the bar is NOT credited directly (xpTotal ${P.xpTotal})`);
  okAv(!(cnt()[1] === 7 && P.xpTotal === 7), 'anti-vacuity: orbs and direct credit are exclusive');
}

say('\n§8 — pickup (Xp.pickupTick -> Sv.addXp)');
{
  const BASE = 900;
  const P = { x: BASE, y: 70, z: BASE, width: 0.6, height: 1.8, dead: false, PICKUP_INFLATE: [1.0, 0.5, 1.0] };
  M.Survival.init(P);
  M.Player = P;
  const orb = EL.spawn('experience_orb', BASE + 0.3, 70, BASE + 0.2);
  orb.value = 7; orb.pickingCount = 1; orb.orbAge = 0; orb.removed = false;
  const got = Xp.pickupTick();
  ok(got === 7, `standing on a 7-value orb picks up 7 xp, got ${got}`);
  ok(P.xpTotal === 7, `Sv.addXp actually ran -- P.xpTotal is 7, got ${P.xpTotal}`);
  ok(orb.removed === true, 'a pickingCount=1 orb is removed once fully picked up');
  ok(P.xpPickupDelay === Xp.PICKUP_DELAY_TICKS, 'the pickup armed the 2-tick per-player delay');

  // the delay actually gates a second orb touched the SAME tick
  const orbA = EL.spawn('experience_orb', BASE, 70, BASE); orbA.value = 3; orbA.pickingCount = 1; orbA.orbAge = 0;
  const orbB = EL.spawn('experience_orb', BASE, 70, BASE); orbB.value = 3; orbB.pickingCount = 1; orbB.orbAge = 0;
  P.xpPickupDelay = 0; P.xpTotal = 0;
  const first = Xp.pickupTick();
  ok(first === 3 && P.xpPickupDelay > 0, 'the first orb this tick is picked up and re-arms the delay');
  const second = Xp.pickupTick();
  okAv(second === 0 && (orbA.removed === false || orbB.removed === false), 'anti-vacuity: a SECOND orb the same tick is refused by the still-counting-down delay (vanilla\'s own quirk)');

  // pickup sound: one play per collected orb, volume 0.1, pitch in [0.5,1.2); none while delay > 0
  {
    const plays = [], op = M.Sound && M.Sound.play;
    M.Sound = M.Sound || {};
    M.Sound.play = (ev, o) => { plays.push([ev, o]); return true; };
    const PS = { x: BASE + 900, y: 70, z: BASE + 900, width: 0.6, height: 1.8, dead: false, PICKUP_INFLATE: [1.0, 0.5, 1.0] };
    M.Survival.init(PS); M.Player = PS;
    const so = EL.spawn('experience_orb', PS.x, 70, PS.z); so.value = 2; so.pickingCount = 1; so.orbAge = 0;
    Xp.pickupTick();
    const g = plays.length === 1 && plays[0][0] === 'entity.experience_orb.pickup' && plays[0][1].volume === 0.1 &&
      plays[0][1].pitch >= 0.5 && plays[0][1].pitch < 1.2 && plays[0][1].source === 'player';
    ok(g, 'one pickup sound per collected orb, volume 0.1, pitch in [0.5,1.2)');
    const so2 = EL.spawn('experience_orb', PS.x, 70, PS.z); so2.value = 2; so2.pickingCount = 1; so2.orbAge = 0;
    Xp.pickupTick();
    ok(plays.length === 1, 'no sound while the pickup delay is > 0');
    const src = Xp.pickupTick.toString();
    okAv(/experience_orb\.pickup/.test(src), 'anti-vacuity: removing the sound call fails this check');
    M.Sound.play = op;
  }

  // out of range: an orb far from the player is never picked up -- a FRESH isolated spot,
  // since the still-unpicked orbA/orbB above would otherwise be the nearest match instead
  const P2 = { x: BASE + 500, y: 70, z: BASE + 500, width: 0.6, height: 1.8, dead: false, PICKUP_INFLATE: [1.0, 0.5, 1.0] };
  M.Survival.init(P2);
  M.Player = P2;
  const far = EL.spawn('experience_orb', BASE + 520, 70, BASE + 520); far.value = 5; far.pickingCount = 1; far.orbAge = 0;
  const gotFar = Xp.pickupTick();
  okAv(gotFar === 0 && far.removed !== true, 'anti-vacuity: an orb 20 blocks away is not swept up by the pickup box');
}

// ── §N. player death drops orbs (Sv.die -> PlayerEntity.getXpToDrop + LivingEntity.dropXp) ──
say('\n§N -- player death xp');
let deathBreaks = shulkerBreaks;
{
  const rules = M.DATA.gameRules = { keepInventory: { t: 'b', d: 'false' } };
  const sum = () => EL.list.filter(o => o.type === 'experience_orb' && !o.removed).reduce((a, o) => a + o.value * (o.pickingCount || 1), 0);
  const clear = () => { for (const o of EL.list.slice()) if (o.type === 'experience_orb') o.removed = true; };
  const die = (level, mode) => {
    clear();
    const D = { x: 900, y: 70, z: 900, width: 0.6, height: 1.8, dead: false };
    M.Survival.init(D); D.xpLevel = level; D.mode = mode || 0;
    M.Survival.die(D, 'generic');
    return sum();
  };
  const cases = () => [[5, 0, 35], [20, 0, 100], [40, 0, 100]].map(([l, m, want]) => die(l, m) === want);
  const kOrig = rules.keepInventory.d;
  ok(cases().every(Boolean), 'level 5/20/40 deaths spawn orbs summing to 35/100/100');
  rules.keepInventory.d = 'true';
  ok(die(20, 0) === 0, 'keepInventory: death spawns no orbs');
  rules.keepInventory.d = kOrig;
  ok(die(20, 3) === 0, 'spectator: death spawns no orbs');
  // respawn: xp zeroed, unless keepInventory
  const R = { x: 0, y: 70, z: 0, width: 0.6, height: 1.8 };
  M.Survival.init(R); M.Survival.addXp(R, 500); M.Survival.respawn(R);
  ok(R.xpLevel === 0 && R.xpTotal === 0 && R.xpProgress === 0, 'respawn zeroes level/progress/total');
  rules.keepInventory.d = 'true';
  M.Survival.init(R); M.Survival.addXp(R, 500); const lv = R.xpLevel; M.Survival.respawn(R);
  ok(R.xpLevel === lv && R.xpTotal === 500, 'keepInventory respawn keeps xp');
  rules.keepInventory.d = kOrig;
  // anti-vacuity: break the data, each break must be caught
  const orig = M.Survival.xpToDrop;
  M.Survival.xpToDrop = (e) => (e.mode === 3 || M.Survival.keepInventory() ? 0 : e.xpLevel * 7);   // no cap
  if (!cases().every(Boolean)) deathBreaks++; else fails.push('anti-vacuity: dropping the 100 cap not caught');
  M.Survival.xpToDrop = (e) => Math.min(e.xpLevel * 7, 100);                                        // no spectator gate
  if (die(20, 3) !== 0) deathBreaks++; else fails.push('anti-vacuity: dropping the spectator gate not caught');
  rules.keepInventory.d = 'true';                                                                    // no keepInventory gate
  if (die(20, 0) !== 0) deathBreaks++; else fails.push('anti-vacuity: dropping the keepInventory gate not caught');
  rules.keepInventory.d = kOrig;
  M.Survival.xpToDrop = orig;
  clear();
}
console.log(deathBreaks + ' breaks caught');
pass += deathBreaks;

console.log('\n' + (fails.length ? 'FAIL' : 'PASS') + '  xporbcheck — ' + pass + ' assertions, ' +
  fails.length + ' failures' + (breaks ? ', ' + breaks + ' anti-vacuity checks' : ''));
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
