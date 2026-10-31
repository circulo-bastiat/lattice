#!/usr/bin/env node
// throwcheck.mjs — loop/throwables-s116: QUEUE 0.2 G18c "left: ender pearl" / Use.OWED's own
// "throwables (snowball, egg, ender pearl, splash potion) — G22/G23" line (both struck,
// 14l_use.js). Proves `Throw.use` (07zzd_throw.js) is a real `SnowballItem`/`EggItem`/
// `EnderPearlItem`/`SplashPotionItem`/`LingeringPotionItem.use` (.decomp, all five read in
// full) — aim, spawn, item cooldown, stack decrement — the egg's own chicken-hatch and the
// ender pearl's own owner-teleport/endermite-spawn (`EggEntity`/`EnderPearlEntity.onCollision`,
// both `.decomp`, both read in full), and the LINGERING potion's new AreaEffectCloud substrate
// (`Po.applyLingeringPotion`/`Po.tickCloud`, 07z_potion.js — `PotionEntity.applyLingeringPotion`
// / `AreaEffectCloudEntity.tick`, both `.decomp`, both read in full).
//
//   node tools/throwcheck.mjs [--verbose]
//
// Sections:
//   1. Th.use — illegal items refused (PASS), no entity, no stack spent
//   2. Th.use — snowball/egg/ender_pearl: a real EL-spawned entity, exact pinned velocity,
//      correct spawn height, the stack decremented by 1 (creative untouched)
//   3. Th.use — the ender pearl's own 20-tick ItemCooldownManager row, both directions
//   4. Th.use — splash/lingering potion: the real `potion` entity, `e.lingering` set correctly,
//      the held stack's own Potion tag read through (Po.tipFromTag)
//   5. Th.tickEgg — EggEntity.onCollision: zero damage/knockback on a live hit, the 1-in-8
//      chicken (baby) hatch and the 1-in-256 four-chick roll, both pinned
//   6. Th.tickPearl — EnderPearlEntity.onCollision: owner teleport, flat 5 fall damage, the
//      5% endermite roll gated on doMobSpawning
//   7. Po.applyLingeringPotion/Po.tickCloud — the real AreaEffectCloudEntity substrate: waits,
//      decays, reapplies on a 5-tick/20-tick cadence, expires
//   8. ER.SHAPE — the live item-sprite render hook for all four projectile shapes
//   9. sound — struck s117: Th.use's own event/category/volume/pitch on all five throws, plus
//      the splash/lingering potion's own break sound (PotionEntity.onCollision, both branches)
//   10. Th.use — struck s117: the potion's own -20F ThrowablePotionItem pitch offset, driven
//      off a non-level P.pitch so it is provably not a no-op
//   11. particle bursts — struck s117: the egg's 8 item_crack and the pearl's 32 portal
//      particles (Px.spawnEggBurst/Px.spawnPearlBurst)
//   12. anti-vacuity — mutate the egg/pearl odds, the cloud's own wait/duration, a thrown
//      item's sound event, the potion's pitch offset, and a burst's own particle count

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('throwcheck — loop/throwables-s116: snowball/egg/ender pearl/splash+lingering potion');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js', '14d_survival.js',
               '07q_effects.js', '07m_breed.js', '07z_potion.js', '14j_combat.js', '14l_use.js',
               '07zzd_throw.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js',
               // struck s117 -- sound (S.entitySound) and the egg/pearl particle bursts
               // (Px.spawnEggBurst/Px.spawnPearlBurst) both need their own module loaded to
               // exercise anything beyond the `if (NS.Sound && ...)`/`if (NS.Particle && ...)`
               // no-op guards `Th.use`/`Th.tickEgg`/`Th.tickPearl` already fall back to.
               '02j_sounds.js', '07zx_particle.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = { getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
            setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
            blockLightAt: () => 15 };
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Breed.init();
MCL.Use.init(W);
MCL.Commands = { rules: {}, ruleGet(name) { return (name in this.rules) ? this.rules[name] : 'true'; } };

const Iv = MCL.Inventory, IT = MCL.Items, Use = MCL.Use, EL = MCL.EntityList, Cb = MCL.Combat,
      Th = MCL.Throw, Po = MCL.Potion, ES = MCL.Effects, Br = MCL.Breed, ER = MCL.EntityRender;

ok(Th && Th.ready, 'Throw module reports ready');
ok(!!EL.canSpawn('snowball') && !!EL.canSpawn('egg') && !!EL.canSpawn('ender_pearl') &&
   !!EL.canSpawn('potion') && !!EL.canSpawn('area_effect_cloud'),
   'all five projectile/cloud types are simulatable (EL.motionFor)');

const REAL_RANDOM = Math.random;
Math.random = () => 0.5; MCL.wrand = () => 0.5;   // NS.wrand: world.random (#6441)
function gaussOffset() { return Cb.gauss(Math.random) * Cb.ARROW_GAUSS_SCALE * Th.DIVERGENCE; }

function player(opts) {
  const inv = Iv.create();
  return Object.assign({
    inventory: inv, slot: 0, instabuild: false,
    ex: 0, ey: 64, ez: 0, EYE: 1.62, vx: 0, vy: 0, vz: 0, onGround: true,
    yaw: 0, pitch: 0, hasTarget: false, targetEntity: null, crouching: false,
    heldItem() { return Iv.getItem(this.inventory, this.slot); },
    lookVec() { return [0, 0, -1]; },
    syncHotbar() {},
  }, opts || {});
}
const stk = (name, n, tag) => Iv.stack(name, n === undefined ? 1 : n, 0, tag);

// ═══════════ 1. Th.use — illegal items ══════════════════════════════════════════════════════
console.log('\n1. Th.use — anything but the five is PASS: no entity, nothing spent');
{
  const P = player();
  Iv.setItem(P.inventory, 0, stk('dirt', 5));
  const before = EL.list.length;
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === false, 'dirt is not a throwable — refused');
  ok(EL.list.length === before, 'no entity spawned');
  ok(Iv.getItem(P.inventory, 0).n === 5, 'the stack was not touched');
  ok(Th.use(P, null) === false, 'a null stack is refused outright');
}

// ═══════════ 2. Th.use — snowball/egg/ender_pearl: real entity, exact velocity, decrement ════
console.log('\n2. Th.use — snowball/egg/ender_pearl: a real live entity at the right velocity/height');
for (const name of ['snowball', 'egg', 'ender_pearl']) {
  const P = player();
  Iv.setItem(P.inventory, 0, stk(name, 3));
  const before = EL.list.length;
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true, `${name}: throw succeeds`);
  ok(EL.list.length === before + 1, `${name}: exactly one new entity`);
  const e = EL.list[EL.list.length - 1];
  ok(e.type === name, `${name}: the spawned entity IS that type`);
  ok(e.shooter === P, `${name}: the player is recorded as shooter`);
  const speed = 1.5, g = gaussOffset();
  const wantVx = g * speed, wantVy = g * speed, wantVz = (-1 + g) * speed;
  ok(Math.abs(e.vx - wantVx) < 1e-9 && Math.abs(e.vy - wantVy) < 1e-9 && Math.abs(e.vz - wantVz) < 1e-9,
     `${name}: velocity matches setVelocity(user, pitch, yaw, 0, 1.5F, 1.0F) exactly, pinned Math.random`);
  ok(Math.abs(e.y - (64 + Math.fround(1.62) - Cb.ARROW_SPAWN_BELOW_EYE)) < 1e-12, `${name}: spawn height is eyeY - 0.1F`);
  ok(Iv.getItem(P.inventory, 0).n === 2, `${name}: the held stack decremented by exactly 1`);

  // creative: the entity still flies, the stack is untouched
  const CP = player({ instabuild: true });
  Iv.setItem(CP.inventory, 0, stk(name, 1));
  Th.use(CP, Iv.getItem(CP.inventory, 0));
  ok(Iv.getItem(CP.inventory, 0).n === 1, `${name}: creative does not spend the stack`);
}
// the very last one leaves the slot EMPTY (null), not a lingering 0-count stack
{
  const P = player();
  Iv.setItem(P.inventory, 0, stk('snowball', 1));
  Th.use(P, Iv.getItem(P.inventory, 0));
  ok(Iv.getItem(P.inventory, 0) === null, 'the last snowball leaves the slot null, same rule bowcheck already proves for arrows');
}

// ═══════════ 3. Th.use — the ender pearl's own 20-tick cooldown ═════════════════════════════
console.log('\n3. Th.use — EnderPearlItem.use: `.getItemCooldownManager().set(this, 20)`');
{
  const P = player();
  Iv.setItem(P.inventory, 0, stk('ender_pearl', 5));
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true, 'first pearl throws');
  ok(P.pearlCooldown === 20, 'the cooldown is set to exactly 20');
  const before = EL.list.length;
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === false, 'a SECOND pearl mid-cooldown is refused');
  ok(EL.list.length === before, 'and nothing new was spawned by the refused throw');
  ok(Iv.getItem(P.inventory, 0).n === 4, 'the refused throw did not spend a second pearl');
  for (let i = 0; i < 19; i++) Th.tickCooldown(P);
  ok(P.pearlCooldown === 1 && Th.use(P, Iv.getItem(P.inventory, 0)) === false, 'still refused with 1 tick left');
  Th.tickCooldown(P);
  ok(P.pearlCooldown === 0, 'cooldown reaches exactly 0 after 20 ticks');
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true, 'a pearl thrown again once the cooldown has fully elapsed');
}
// snowball/egg carry NO cooldown at all — only the pearl does
{
  const P = player();
  Iv.setItem(P.inventory, 0, stk('snowball', 5));
  Th.use(P, Iv.getItem(P.inventory, 0));
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true, 'a second snowball throws immediately, no cooldown');
}

// ═══════════ 4. Th.use — splash/lingering potion ════════════════════════════════════════════
console.log('\n4. Th.use — SplashPotionItem/LingeringPotionItem: real `potion` entity, e.lingering, tag read');
for (const [item, wantLingering] of [['splash_potion', false], ['lingering_potion', true]]) {
  const P = player();
  Iv.setItem(P.inventory, 0, stk(item, 2, { Potion: 'minecraft:poison' }));
  ok(Th.use(P, Iv.getItem(P.inventory, 0)) === true, `${item}: throws`);
  const e = EL.list[EL.list.length - 1];
  ok(e.type === 'potion', `${item}: spawns the real \`potion\` entity, the SAME one the witch uses`);
  ok(e.lingering === wantLingering, `${item}: e.lingering is ${wantLingering}`);
  ok(e.potionId === 'poison', `${item}: the held stack's own Potion tag reached e.potionId through Po.tipFromTag`);
  const speed = 0.5, g = gaussOffset();
  // struck s117: `player()`'s own pitch is 0 (level), but `ThrowablePotionItem.use`'s own
  // `-20.0F` pitchOffset (`Th.ITEMS`'s own header has the derivation) still tilts the Y
  // component alone off `sin(P.pitch - pitchOffset_rad)` = `sin(0 - (-20*PI/180))` =
  // `sin(20deg)`, NOT the level `f[1]==0` a pre-s117 build would have used -- X/Z are
  // untouched (`f[0]`/`f[2]` off the mock `lookVec()`'s own `[0,0,-1]`).
  const wantVyDir = Math.sin(0 - (-20 * Math.PI / 180));
  const wantVx = g * speed, wantVy = (wantVyDir + g) * speed, wantVz = (-1 + g) * speed;
  ok(Math.abs(e.vx - wantVx) < 1e-9 && Math.abs(e.vy - wantVy) < 1e-9 && Math.abs(e.vz - wantVz) < 1e-9,
     `${item}: thrown at the SplashPotion/LingeringPotion 0.5F speed with the -20F pitch offset folded into Y alone, pinned Math.random`);
  ok(Iv.getItem(P.inventory, 0).n === 1, `${item}: the stack decremented by 1`);
}
// a plain, tag-less "Splash Water Bottle" carries no potionId — the water-splash branch is
// still `Po.OWED` (07z_potion.js's own header), and both apply* functions already no-op on it
{
  const P = player();
  Iv.setItem(P.inventory, 0, stk('splash_potion', 1));
  Th.use(P, Iv.getItem(P.inventory, 0));
  const e = EL.list[EL.list.length - 1];
  ok(e.potionId === null, 'a tag-less splash potion carries no potionId (named water-splash gap)');
}

// ═══════════ 5. Th.tickEgg — EggEntity.onCollision ═══════════════════════════════════════════
console.log('\n5. Th.tickEgg — zero damage/knockback on a hit, 1-in-8 chicken, 1-in-256 four chicks');
function mob(x, z) { const e = EL.spawn('turtle', x, 64, z || 0); e.maxHealth = e.health = 20; return e; }
{
  const P = player();
  const t = mob(1, 0);
  const e = EL.spawn('egg', 0, 64, 0, { shooter: P, vx: 0, vy: 0, vz: 0 });
  e.x = t.x; e.y = t.y; e.z = t.z; e.onGround = false;
  const healthBefore = t.health;
  Th.tickEgg(e);
  ok(t.health === healthBefore, `the struck entity takes 0 damage (EggEntity.onEntityHit's own 0.0F)`);
  ok(t.hurtTime > 0, 'but a real hurt-flash/knockback DID fire (Cb.hurtZero)');
  ok(e.removed === true, 'the egg discards itself on any collision');
}
{
  // pinned so 8*32 = 256 is the exact denominator this check can drive both branches of
  const P = player();
  const REAL = MCL.EntityList.random;
  let calls;
  MCL.EntityList.random = () => (calls.length ? calls.shift() : 0.99);
  calls = [0, 0];                                    // nextInt(8)==0, nextInt(32)==0 -> 4 chicks
  let e = EL.spawn('egg', 5, 64, 5, { shooter: P });
  e.onGround = true;
  const beforeN = EL.list.filter((x) => x.type === 'chicken').length;
  Th.tickEgg(e);
  let chicks = EL.list.filter((x) => x.type === 'chicken');
  ok(chicks.length === beforeN + 4, `pinned nextInt(8)==0 AND nextInt(32)==0: exactly 4 chickens hatched, got ${chicks.length - beforeN}`);
  ok(chicks.slice(-4).every((c) => Br.isBaby(c)), 'every hatched chick is a baby (setBreedingAge(-24000))');

  calls = [0, 1];                                    // nextInt(8)==0, nextInt(32)!=0 -> 1 chick
  e = EL.spawn('egg', 6, 64, 6, { shooter: P }); e.onGround = true;
  const before1 = EL.list.filter((x) => x.type === 'chicken').length;
  Th.tickEgg(e);
  ok(EL.list.filter((x) => x.type === 'chicken').length === before1 + 1, 'pinned nextInt(8)==0, nextInt(32)!=0: exactly 1 chicken');

  calls = [1];                                        // nextInt(8)!=0 -> no hatch at all
  e = EL.spawn('egg', 7, 64, 7, { shooter: P }); e.onGround = true;
  const before0 = EL.list.filter((x) => x.type === 'chicken').length;
  Th.tickEgg(e);
  ok(EL.list.filter((x) => x.type === 'chicken').length === before0, 'pinned nextInt(8)!=0: no chicken at all');
  MCL.EntityList.random = REAL;
}

// ═══════════ 6. Th.tickPearl — EnderPearlEntity.onCollision ═════════════════════════════════
console.log('\n6. Th.tickPearl — owner teleport, flat 5 fall damage, 5% endermite roll under doMobSpawning');
{
  const P = player({ x: 0, y: 64, z: 0, health: 20, maxHealth: 20, dead: false, invulnerable: 0, lastHurt: 0, armor: 0, armorToughness: 0, fallDistance: 12 });
  MCL.Player = P;
  const e = EL.spawn('ender_pearl', 30, 70, 30, { shooter: P });
  e.pearlHit = true;
  MCL.Commands.rules.doMobSpawning = 'false';         // pin: no endermite this call, isolate the teleport
  const before = EL.list.filter((x) => x.type === 'endermite').length;
  Th.tickPearl(e);
  ok(P.x === 30 && P.y === 70 && P.z === 30, `the owner is teleported to the pearl's own landing point`);
  ok(P.px === 30 && P.py === 70 && P.pz === 30 && P.ex === 30 && P.ey === 70 && P.ez === 30, 'prev/eye position kept in lock-step, no interpolation snap');
  ok(P.fallDistance === 0, 'Entity.onLanding() resets fallDistance to 0');
  ok(P.health === 15, 'flat 5 fall damage landed (Sv.hurt(P, "fall", 5))');
  ok(e.removed === true, 'the pearl discards itself');
  ok(EL.list.filter((x) => x.type === 'endermite').length === before, 'doMobSpawning=false: no endermite, pinned');
}
{
  const P = player({ x: 0, y: 64, z: 0, health: 20, maxHealth: 20, dead: false, invulnerable: 0, lastHurt: 0, armor: 0, armorToughness: 0, fallDistance: 0 });
  MCL.Player = P;
  MCL.Commands.rules.doMobSpawning = 'true';
  const REAL = MCL.EntityList.random;
  MCL.EntityList.random = () => 0.01;                 // < 0.05F, pinned to always roll the mite
  const e = EL.spawn('ender_pearl', 5, 64, 5, { shooter: P });
  e.pearlHit = true;
  const before = EL.list.filter((x) => x.type === 'endermite').length;
  Th.tickPearl(e);
  ok(EL.list.filter((x) => x.type === 'endermite').length === before + 1, 'doMobSpawning=true, roll<0.05: exactly one endermite spawned');
  MCL.EntityList.random = REAL;
}
{
  // a mob-owned pearl (never happens today — only Use.rightClick spawns one — but the guard
  // itself is real: `instanceof ServerPlayerEntity` in the source) does not teleport anything.
  const owner = mob(50, 50);
  const e = EL.spawn('ender_pearl', 51, 64, 51, { shooter: owner });
  e.pearlHit = true;
  const before = { x: owner.x, y: owner.y, z: owner.z };
  Th.tickPearl(e);
  ok(owner.x === before.x && owner.y === before.y && owner.z === before.z, `a non-player shooter (this engine never produces one) is left untouched, matching the source's own player-only branch`);
}

// ═══════════ 7. Po.applyLingeringPotion / Po.tickCloud — the real AreaEffectCloud ════════════
console.log('\n7. Po.applyLingeringPotion/Po.tickCloud — wait, radius decay, 5-tick reapply, expiry');
{
  const shooter = { id: 777, type: 'x' };
  const fake = { x: 500, y: 64, z: 500, potionId: 'poison', custom: null, shooter };
  const cloud = Po.applyLingeringPotion(fake);
  ok(!!cloud && cloud.type === 'area_effect_cloud', 'a real area_effect_cloud entity was spawned');
  ok(cloud.radius === 3 && cloud.waitTime === 10 && cloud.duration === 600, `radius 3.0F/waitTime 10/duration 600 (applyLingeringPotion's own overrides)`);
  ok(Math.abs(cloud.radiusGrowth - (-3 / 600)) < 1e-12, 'radiusGrowth == -radius/duration exactly');
  const t = mob(501, 500); t.health = t.maxHealth = 20;

  cloud.age = 9;
  Po.tickCloud(cloud);
  ok(!ES.hasStatusEffect(t, 'poison'), 'still WAITING at age 9 (< waitTime 10): no effect, no radius decay yet');
  ok(cloud.radius === 3, 'radius has not decayed while waiting');

  cloud.age = 10;
  Po.tickCloud(cloud);
  ok(cloud.radius < 3, 'radius decays the instant waiting ends (age === waitTime)');

  cloud.age = 15;
  Po.tickCloud(cloud);
  ok(!!ES.hasStatusEffect(t, 'poison'), 'a living entity inside the radius at a %5===0 tick is affected');
  const dur1 = ES.getStatusEffect(t, 'poison').duration;
  ok(dur1 === Math.floor((900 / 4) + 0.5), `duration is the base 900 QUARTERED (StatusEffectInstance's own /4), got ${dur1}`);

  cloud.age = 16;
  Po.tickCloud(cloud);
  ok(ES.getStatusEffect(t, 'poison').duration === dur1, 'age 16 is not a %5 tick: no re-roll, duration untouched');

  cloud.age = 20;
  Po.tickCloud(cloud);
  ok(ES.getStatusEffect(t, 'poison') && true, 'still within the reapplicationDelay window at age 20 (10+10): affectedEntities still holds it');

  cloud.age = 610;                                    // waitTime(10) + duration(600)
  Po.tickCloud(cloud);
  ok(cloud.removed === true, 'the cloud discards itself once age >= waitTime + duration');
}
// instant-effect potion (healing) applies a flat-0.5-factor amount, not distance-scaled
{
  const cloud2 = Po.applyLingeringPotion({ x: 520, y: 64, z: 520, potionId: 'healing', custom: null, shooter: null });
  cloud2.age = cloud2.waitTime;
  const t = mob(520, 520); t.health = 10; t.maxHealth = 20;
  Po.tickCloud(cloud2);
  ok(t.health === 12, `healing's own instant-effect amount is floor(0.5*4+0.5)=2 flat, got +${t.health - 10}`);
}

// ═══════════ 8. ER.SHAPE — the live item-sprite render hook ═════════════════════════════════
console.log('\n8. ER.SHAPE — snowball/egg/ender_pearl/potion draw as real item sprites');
{
  ok(ER.SHAPE.snowball === 'item' && ER.SHAPE.egg === 'item' && ER.SHAPE.ender_pearl === 'item' && ER.SHAPE.potion === 'item',
     'all four are mapped to the item-sprite shape path');
  const id = IT.names.indexOf('snowball');
  ok(id >= 0, 'the item registry actually has a snowball id to draw');
  const sprites = ER.spritesFor({ item: id, count: 1 });
  ok(!!sprites && sprites.parts && sprites.parts.length > 0, 'ER.spritesFor resolves a real baked tile for a thrown snowball, not just a map entry');
}

// ═══════════ 9. sound — event/category/volume/pitch, all five throws ═══════════════════════
console.log('\n9. sound — Th.use plays the real jar event/category/volume/pitch on all five throws');
{
  const S = MCL.Sound;
  ok(!!S && !!S.entitySound, 'NS.Sound.entitySound exists (02j_sounds.js loaded)');
  // WANT: { event, category } per item, off `.decomp`'s own `World.playSound` calls
  // (`Th.ITEMS`'s own header has the field_* -> event/category citations).
  const WANT = {
    snowball:          { ev: 'entity.snowball.throw',         cat: 'neutral' },
    egg:                { ev: 'entity.egg.throw',              cat: 'player' },
    ender_pearl:        { ev: 'entity.ender_pearl.throw',      cat: 'neutral' },
    splash_potion:      { ev: 'entity.splash_potion.throw',    cat: 'player' },
    lingering_potion:   { ev: 'entity.lingering_potion.throw', cat: 'neutral' }
  };
  for (const name of Object.keys(WANT)) {
    const P = player();
    Iv.setItem(P.inventory, 0, stk(name, 1, name.indexOf('potion') >= 0 ? { Potion: 'minecraft:poison' } : undefined));
    let captured = null;
    const real = S.entitySound;
    S.entitySound = function (ev, x, y, z, volume, pitch, source, listener) {
      captured = { ev, x, y, z, volume, pitch, source, listener };
      return real.apply(this, arguments);
    };
    Th.use(P, Iv.getItem(P.inventory, 0));
    S.entitySound = real;
    ok(!!captured, `${name}: Th.use plays a sound at all`);
    if (captured) {
      ok(captured.ev === WANT[name].ev, `${name}: event is ${WANT[name].ev}, got ${captured.ev}`);
      ok(captured.source === WANT[name].cat, `${name}: SoundCategory is ${WANT[name].cat}, got ${captured.source}`);
      ok(captured.volume === Th.THROW_VOLUME && Math.abs(captured.volume - 0.5) < 1e-9,
         `${name}: volume is the jar's own 0.5F literal`);
      // pinned Math.random = 0.5 (this file's own global pin, above): 0.4F/(0.5*0.4F+0.8F) = 0.4
      ok(Math.abs(captured.pitch - 0.4) < 1e-9, `${name}: pitch matches 0.4F/(rand*0.4F+0.8F), pinned rand=0.5 -> 0.4`);
      ok(captured.x === P.x && captured.y === P.y && captured.z === P.z, `${name}: played at the PLAYER's own position, not the projectile's`);
      ok(captured.listener === P, `${name}: the thrower is its own listener (null-serverplayer in the jar reaches everyone, incl. self)`);
    }
  }
  // the splash/lingering potion's own break sound (PotionEntity.onCollision, both branches)
  const Po = MCL.Potion;
  for (const [lingering, label] of [[false, 'splash'], [true, 'lingering']]) {
    const P = player();
    const e = EL.spawn('potion', 10, 64, 10, { shooter: P, potionId: 'poison', lingering, vx: 0, vy: 0, vz: 0 });
    e.onGround = true;
    let captured = null;
    const real = S.entitySound;
    S.entitySound = function (ev) { captured = ev; return real.apply(this, arguments); };
    Po.tick(e);
    S.entitySound = real;
    ok(captured === 'entity.splash_potion.break', `${label} potion: break sound is entity.splash_potion.break on collision, got ${captured}`);
  }
}

// ═══════════ 10. Th.use — the potion's own -20F pitch offset, non-level pitch ═══════════════
console.log('\n10. Th.use — the -20F ThrowablePotionItem pitch offset tilts Y alone, off a non-level pitch');
{
  // A snowball and a splash potion thrown from the SAME non-zero pitch (looking up 30deg
  // engine-side == vanilla pitch -30F, "positive DOWN" -- 14_player.js:493) must NOT share the
  // same vy DIRECTION once the potion's own -20F offset is folded in, even though both start
  // from `P.lookVec()`'s identical f[1] (the mock `lookVec()` always returns [0,0,-1] --
  // this section drives `Th.use`'s own `P.pitch` path directly, not the mock's `f`).
  const pitch = 30 * Math.PI / 180;   // engine convention, +pitch == up
  const g = gaussOffset();
  const Psnow = player({ pitch });
  Iv.setItem(Psnow.inventory, 0, stk('snowball', 1));
  Th.use(Psnow, Iv.getItem(Psnow.inventory, 0));
  const esnow = EL.list[EL.list.length - 1];
  const wantSnowVy = (Math.sin(pitch) + g) * 1.5;
  ok(Math.abs(esnow.vy - wantSnowVy) < 1e-9, `snowball at pitch=+30deg: vy uses plain sin(P.pitch), no offset, got ${esnow.vy} want ${wantSnowVy}`);

  const Ppot = player({ pitch });
  Iv.setItem(Ppot.inventory, 0, stk('splash_potion', 1, { Potion: 'minecraft:poison' }));
  Th.use(Ppot, Iv.getItem(Ppot.inventory, 0));
  const epot = EL.list[EL.list.length - 1];
  const wantPotVyDir = Math.sin(pitch - (-20 * Math.PI / 180));   // pitch + 20deg, folded through the D-343 sign flip
  const wantPotVy = (wantPotVyDir + g) * 0.5;
  ok(Math.abs(epot.vy - wantPotVy) < 1e-9, `splash_potion at pitch=+30deg: vy folds in the -20F offset (effective +50deg), got ${epot.vy} want ${wantPotVy}`);
  ok(Math.abs(wantSnowVy / 1.5 - wantPotVy / 0.5) > 0.01, 'the two vy DIRECTIONS genuinely differ (the offset is not a no-op at this pitch)');
}

// ═══════════ 11. particle bursts — egg's 8 item_crack, pearl's 32 portal ═══════════════════
console.log('\n11. particle bursts — Th.tickEgg/Th.tickPearl feed Px.spawnEggBurst/Px.spawnPearlBurst');
{
  const Px = MCL.Particle;
  ok(!!Px && !!Px.spawnEggBurst && !!Px.spawnPearlBurst, 'Px.spawnEggBurst/spawnPearlBurst exist (07zx_particle.js loaded)');
  Px.init();
  const P = player();
  const e = EL.spawn('egg', 20, 64, 20, { shooter: P, vx: 0, vy: 0, vz: 0 });
  e.onGround = true;
  Th.tickEgg(e);
  ok(Px.list.length === Px.EGG_BURST_COUNT && Px.list.length === 8, `egg collision spawns exactly ${Px.EGG_BURST_COUNT} particles, got ${Px.list.length}`);
  ok(Px.list.every((p) => p.type === 'item_crack'), 'every one of them is the item_crack type');

  Px.init();
  const e2 = EL.spawn('ender_pearl', 21, 64, 21, { shooter: null, vx: 0, vy: 0, vz: 0 });
  e2.pearlHit = true;
  Th.tickPearl(e2);
  ok(Px.list.length === Px.PEARL_BURST_COUNT && Px.list.length === 32, `pearl collision spawns exactly ${Px.PEARL_BURST_COUNT} particles, got ${Px.list.length}`);
  ok(Px.list.every((p) => p.type === 'portal'), 'every one of them is the portal type');
  Px.init();
}

// ═══════════ 12. anti-vacuity ════════════════════════════════════════════════════════════════
console.log(`\n12. anti-vacuity — mutate the egg odds, the pearl roll, the cloud's own timing, sound and particles`);

{
  const REAL = MCL.EntityList.random;
  MCL.EntityList.random = () => 1;                    // nextInt(8) never 0 under the real code
  const savedTickEgg = Th.tickEgg;
  // simulate "the 1-in-8 gate got dropped" by monkey-patching a version that always hatches
  Th.tickEgg = function (e) { if (!e.removed) { EL.spawn('chicken', e.x, e.y, e.z, {}); e.removed = true; } };
  const before = EL.list.filter((x) => x.type === 'chicken').length;
  const e = EL.spawn('egg', 40, 64, 40, {});
  Th.tickEgg(e);
  okAv(EL.list.filter((x) => x.type === 'chicken').length === before + 1, `a mutated always-hatch tickEgg DOES hatch even with a pinned "never" roll — proves §5's own pinned-denial assertion is load-bearing`);
  Th.tickEgg = savedTickEgg;
  MCL.EntityList.random = REAL;
}
{
  const cloud = Po.applyLingeringPotion({ x: 540, y: 64, z: 540, potionId: 'poison', custom: null, shooter: null });
  const savedWait = cloud.waitTime;
  cloud.waitTime = 0;                                 // mutate: no wait at all
  const t = mob(542, 540);
  cloud.age = 0;
  Po.tickCloud(cloud);
  okAv(ES.hasStatusEffect(t, 'poison') === true, `a mutated waitTime=0 cloud affects on tick 0 — proves §7's own "still waiting at age<waitTime" assertion is load-bearing`);
  cloud.waitTime = savedWait;
}
{
  const P = player();
  Iv.setItem(P.inventory, 0, stk('ender_pearl', 1));
  const savedPearlCd = Th.PEARL_COOLDOWN;
  Th.PEARL_COOLDOWN = 0;                              // mutate: no cooldown at all
  Th.use(P, Iv.getItem(P.inventory, 0));
  Iv.setItem(P.inventory, 0, stk('ender_pearl', 1));
  okAv(Th.use(P, Iv.getItem(P.inventory, 0)) === true, `a mutated 0-tick pearl cooldown throws back-to-back — proves §3's own refusal assertion is load-bearing`);
  Th.PEARL_COOLDOWN = savedPearlCd;
}
{
  // struck s117: §9's own event-name assertion is load-bearing -- break `Th.ITEMS.snowball`'s
  // own event string and prove the WRONG event is what gets captured (not silently the right
  // one from some other code path).
  const S = MCL.Sound;
  const savedEv = Th.ITEMS.snowball.sound;
  Th.ITEMS.snowball.sound = 'entity.egg.throw';       // mutate: snowball "plays" the egg's event
  const P = player();
  Iv.setItem(P.inventory, 0, stk('snowball', 1));
  let captured = null;
  const real = S.entitySound;
  S.entitySound = function (ev) { captured = ev; return real.apply(this, arguments); };
  Th.use(P, Iv.getItem(P.inventory, 0));
  S.entitySound = real;
  okAv(captured === 'entity.egg.throw' && captured !== savedEv, `a mutated snowball.sound plays the WRONG event and §9's own equality assertion would have caught it — proves it is load-bearing`);
  Th.ITEMS.snowball.sound = savedEv;
}
{
  // struck s117: §10's own -20F pitch-offset assertion is load-bearing -- zero out
  // `splash_potion`'s own `pitchOffset` and prove the throw goes back to the LEVEL vy a
  // pre-s117 build would have produced (no offset at all, not merely "a different number").
  const savedOffset = Th.ITEMS.splash_potion.pitchOffset;
  Th.ITEMS.splash_potion.pitchOffset = 0;             // mutate: drop the -20F offset entirely
  const pitch = 30 * Math.PI / 180;
  const P = player({ pitch });
  Iv.setItem(P.inventory, 0, stk('splash_potion', 1, { Potion: 'minecraft:poison' }));
  Th.use(P, Iv.getItem(P.inventory, 0));
  const eMut = EL.list[EL.list.length - 1];
  const g = gaussOffset();
  const wantLevelVy = (Math.sin(pitch) + g) * 0.5;      // no offset -> plain sin(P.pitch), same shape as snowball's own
  okAv(Math.abs(eMut.vy - wantLevelVy) < 1e-9, `a mutated pitchOffset=0 throws the potion LEVEL (no -20F tilt) — proves §10's own non-equal-direction assertion is load-bearing`);
  Th.ITEMS.splash_potion.pitchOffset = savedOffset;
}
{
  // struck s117: §11's own particle-COUNT assertion is load-bearing -- break the egg burst's
  // own count constant and prove the WRONG number of particles lands in Px.list.
  const Px = MCL.Particle;
  const savedCount = Px.EGG_BURST_COUNT;
  Px.EGG_BURST_COUNT = 3;                             // mutate: 3 instead of the jar's own 8
  Px.init();
  const P = player();
  const e = EL.spawn('egg', 22, 64, 22, { shooter: P, vx: 0, vy: 0, vz: 0 });
  e.onGround = true;
  Th.tickEgg(e);
  okAv(Px.list.length === 3 && Px.list.length !== 8, `a mutated EGG_BURST_COUNT=3 spawns exactly 3, not 8 — proves §11's own "===8" assertion is load-bearing`);
  Px.EGG_BURST_COUNT = savedCount;
  Px.init();
}

Math.random = REAL_RANDOM;
console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity)`);
if (fails.length) {
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
