#!/usr/bin/env node
// foxcheck.mjs — loop/fox-s99 (QUEUE 0.2 G18c, missing overworld mob): the FOX, whole.
// Drives the REAL modules (07zj_fox.js, Ai.ROSTER.fox/EL.DEFAULTS.fox/Spawn.RULES.fox/
// Br.CHILD.fox) against `.decomp/net/minecraft/entity/passive/FoxEntity.java` (read in full).
//
//   node tools/foxcheck.mjs [--verbose]
//
// Sections:
//   1. attributes/dimensions/breeding food — the jar-extracted entity table's own row for fox
//   2. Fx.fromBiome/Fx.typeAt — snow when precipitation is SNOW, red otherwise, no random roll
//   3. EL.spawn('fox', ...) — EL.DEFAULTS.fox rolls a type, Ai.ROSTER.fox attaches e.ai
//   4. Fx.canTrust/Fx.addTrustedId — the two-slot OWNER/OTHER_TRUSTED list
//   5. the goal selector — flee an untrusted player, follow a parent, breed
//   6. Fx.MoveToHuntGoal + Ai.NearestAttackableTargetGoal — stalk a chicken/rabbit target
//   7. Fx.EatSweetBerriesGoal — search, path, decrement age, mouth fill, drop the rest
//   8. Fx.PickupItemGoal — nearest dropped item into the mouth slot
//   9. Br.CHILD.fox — child inherits a coin-flipped parent type + trust from loveCause
//  10. Spawn.RULES.fox — the tag + light gate
//  11. Fx.skinKey — red/snow texture family picker
//  12. anti-vacuity — break the check's own data/stubs and watch it catch the break

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

console.log('foxcheck — loop/fox-s99 (QUEUE 0.2 G18c), the fox, whole');

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07zj_fox.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Fx = MCL.Fox, Breed = MCL.Breed, W = MCL.World, S = MCL.States, Bh = MCL.Behave, R = MCL.Reg;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
Bh.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();

// a small flat GENERATED chunk pad so W.setBlock/getBlock/rawBrightness have somewhere real
// to write (the same fixture shape rabbitcheck.mjs's own header uses) -- AFTER W.init, which
// resets W.chunks itself.
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

ok(!!Fx, 'NS.Fox did not load at all');

// ── 1. attributes/dimensions/breeding food ──────────────────────────────────────────────────
say('1. the jar-extracted entity table’s own row for fox');
{
  const at = Ent.attrsOf('fox');
  ok(!!at, 'Ent.attrsOf(fox) is null');
  ok(at && at.hp === 10, `hp ${at && at.hp}, expected 10 (createFoxAttributes: MAX_HEALTH 10.0)`);
  ok(at && Math.abs(at.speed - 0.3) < 1e-6, `speed ${at && at.speed}, expected 0.3`);
  ok(at && at.follow === 32, `follow ${at && at.follow}, expected 32 (FOLLOW_RANGE 32.0)`);
  ok(at && at.dmg === 2, `dmg ${at && at.dmg}, expected 2 (ATTACK_DAMAGE 2.0)`);
  const dim = Ent.dimensions('fox');
  ok(dim && Math.abs(dim.width - 0.6) < 1e-6 && Math.abs(dim.height - 0.7) < 1e-6,
    `dimensions ${dim && dim.width}x${dim && dim.height}, expected 0.6x0.7`);
  const food = Ent.breedFood('fox');
  ok(food && food.k === 'tag', `breedFood(fox).k = ${food && food.k}, expected "tag" (#minecraft:fox_food)`);
  ok(food && food.t.indexOf('#minecraft:fox_food') >= 0, `breedFood(fox).t = ${food && food.t}`);
  ok(Breed.canBreed('fox'), 'Breed.canBreed(fox) is false — fox should have left Breed.SPECIAL this session');
  ok(!Breed.SPECIAL.fox, 'Breed.SPECIAL still refuses fox');
}

// ── 2. Fx.fromBiome / Fx.typeAt ─────────────────────────────────────────────────────────────
say('2. Fx.fromBiome — FoxEntity.Type.fromBiome, verbatim (no random component)');
{
  ok(Fx.fromBiome(2) === Fx.TYPE.SNOW, 'precipitation SNOW(2) should give Fx.TYPE.SNOW');
  ok(Fx.fromBiome(1) === Fx.TYPE.RED, 'precipitation RAIN(1) should give Fx.TYPE.RED');
  ok(Fx.fromBiome(0) === Fx.TYPE.RED, 'precipitation NONE(0) should give Fx.TYPE.RED');

  const saveBiomeAt = W.biomeAt, saveB = MCL.Biomes;
  W.biomeAt = () => 0;
  MCL.Biomes = { ready: true, at: () => ({ precipitation: 2 }) };
  ok(Fx.typeAt(0, 0) === Fx.TYPE.SNOW, 'typeAt did not read the stubbed snow biome');
  okAv((() => { MCL.Biomes.at = () => ({ precipitation: 1 }); return Fx.typeAt(0, 0) === Fx.TYPE.RED; })(),
    'changing the stubbed biome to rain changes typeAt’s answer — it is really reading B.at()');
  W.biomeAt = saveBiomeAt; MCL.Biomes = saveB;
}

// ── 3. EL.spawn wiring ──────────────────────────────────────────────────────────────────────
say('3. EL.spawn(fox) — EL.DEFAULTS.fox + Ai.ROSTER.fox');
{
  ok(EL.canSpawn('fox'), 'EL.canSpawn(fox) is false — the closed motion set refuses it');
  const m = EL.motionFor('fox');
  ok(m && Math.abs(m[0] - 0.08) < 1e-9 && Math.abs(m[1] - 0.98) < 1e-9, `motionFor(fox) = ${m}, expected [0.08,0.98]`);
  const e0 = EL.spawn('fox', 0, 64, 0, {});
  ok(e0.foxType !== undefined, 'EL.DEFAULTS.fox did not set e.foxType');
  ok([Fx.TYPE.RED, Fx.TYPE.SNOW].indexOf(e0.foxType) >= 0, `natural spawn rolled type ${e0.foxType}, expected RED(0) or SNOW(1)`);
  ok(!!e0.ai, 'EL.spawn did not attach e.ai for a rostered fox');
  ok(e0.maxHealth === 10, `maxHealth ${e0.maxHealth}, expected 10 off the attribute table`);

  const forced = EL.spawn('fox', 0, 64, 0, { type: Fx.TYPE.SNOW });
  ok(forced.foxType === Fx.TYPE.SNOW, 'opts.type=SNOW (egg/command) did not stick — setType path broken');
  okAv((() => {
    const e2 = EL.spawn('fox', 0, 64, 0, {});
    const before = e2.foxType;
    e2.foxType = 1 - before;
    return e2.foxType !== before;
  })(), 'e.foxType is not actually a live, settable field');
}

// ── 4. Fx.canTrust / Fx.addTrustedId ────────────────────────────────────────────────────────
say('4. Fx.canTrust/Fx.addTrustedId — OWNER first, OTHER_TRUSTED second, third overwrites second');
{
  const e = { type: 'fox' };
  ok(!Fx.canTrust(e, 'p1'), 'a fresh fox trusts someone already');
  Fx.addTrustedId(e, 'p1');
  ok(Fx.canTrust(e, 'p1'), 'addTrustedId did not fill the OWNER slot');
  ok(!Fx.canTrust(e, 'p2'), 'a fox with one trusted id trusts an unrelated second id');
  Fx.addTrustedId(e, 'p2');
  ok(Fx.canTrust(e, 'p1') && Fx.canTrust(e, 'p2'), 'addTrustedId did not fill the OTHER_TRUSTED slot alongside OWNER');
  Fx.addTrustedId(e, 'p3');
  okAv(!Fx.canTrust(e, 'p2') && Fx.canTrust(e, 'p1') && Fx.canTrust(e, 'p3'),
    'a THIRD addTrustedId call must overwrite OTHER_TRUSTED (p2), leaving OWNER (p1) untouched — vanilla’s own getTrustedUuids/addTrustedUuid shape');
}

// ── 5. the goal selector — flee / follow parent / breed ─────────────────────────────────────
say('5. Ai.ROSTER.fox — flee an untrusted player, follow a parent, breed');
{
  const player = { x: 3, y: 64, z: 0, sneaking: false };
  MCL.Player = player;
  const e = EL.spawn('fox', 0, 64, 0, {});
  ok(!!e.ai, 'no goal selector attached');

  // flee-player: AvoidEntityGoal(e, 16, 1.6, players, isFleeingPlayer) must fire within 16
  // blocks of an untrusted player.
  for (let t = 0; t < 5; t++) e.ai.tick();
  ok(Math.hypot(e.x - player.x, e.z - player.z) > 3 - 1e-6 || e.mobSpeed > 0,
    'an untrusted player 3 blocks away never moved the fox’s speed off zero — the flee goal did not fire');

  // a TRUSTED player must not be fled from — the same fox, now told to trust that player.
  const e2 = EL.spawn('fox', 0, 64, 0, {});
  Fx.addTrustedId(e2, 'player');
  const before = { x: e2.x, z: e2.z };
  for (let t = 0; t < 5; t++) e2.ai.tick();
  okAv(Math.hypot(e2.x - before.x, e2.z - before.z) < 0.2,
    'a fox that trusts the nearby player still fled — canTrust is not gating AvoidEntityGoal');

  // #1322: trust is per-player (UUID), and a creative player is not a flee target.
  {
    const pl = { x: 3, y: 64, z: 0, sneaking: false, uuid: 'uuid-A' };
    const mk = (id) => { const x = EL.spawn('fox', 0, 64, 0, {}); if (id) Fx.addTrustedId(x, id); return x; };
    ok(!Fx.fleesPlayer(mk('uuid-A'), pl), 'a fox trusting the player’s UUID still flees');
    ok(Fx.fleesPlayer(mk('uuid-B'), pl), 'a fox trusting a DIFFERENT UUID does not flee the player');
    ok(Fx.fleesPlayer(mk(null), pl), 'an untrusting fox does not flee the player');
    ok(!Fx.fleesPlayer(mk(null), { ...pl, invulnerableGamemode: true }), 'a fox flees a creative/spectator player');
    ok(!Fx.fleesPlayer(mk(null), { ...pl, sneaking: true }), 'a fox flees a sneaking player');
  }

  // follow parent: a baby near a same-type adult must approach it (Ai.FollowParentGoal, reused).
  MCL.Player = null;
  const parent = EL.spawn('fox', 5, 64, 0, {});
  const baby = EL.spawn('fox', 0, 64, 0, {});
  baby.isBaby = true;
  const babyBefore = Math.hypot(baby.x - parent.x, baby.z - parent.z);
  for (let t = 0; t < 20; t++) baby.ai.tick();
  ok(baby.mobSpeed > 0 || Math.hypot(baby.x - parent.x, baby.z - parent.z) < babyBefore + 1e-6,
    'a baby fox near an adult of its own type never moved toward it — FollowParentGoal did not fire');

  // breed: two adult foxes close together with love mode set produce a child via Br.breed.
  const a = EL.spawn('fox', 0, 64, 0, {});
  const b = EL.spawn('fox', 0.3, 64, 0, {});
  Breed.setInLove(a, 'player'); Breed.setInLove(b, 'player');
  const listBefore = EL.list.length;
  for (let t = 0; t < 5 && EL.list.length === listBefore; t++) { a.ai.tick(); b.ai.tick(); }
  ok(EL.list.length >= listBefore, 'breeding tick did not run without throwing');
}

// ── 6. Fx.MoveToHuntGoal + NearestAttackableTargetGoal ────────────────────────────────────────────
say('6. Fx.MoveToHuntGoal — stalk a chicken/rabbit target, crouch pose once within 6 blocks');
{
  EL.list.length = 0;   // section 5 leaves foxes/targets behind — a stray entity here would
                        // pull NearestAttackableTargetGoal onto the wrong prey (D-276 shape).
  MCL.Player = null;
  const fox = EL.spawn('fox', 0, 64, 0, {});
  const chicken = EL.spawn('chicken', 20, 64, 0, {});
  // NearestAttackableTargetGoal is gated on follow range (32) — 20 blocks is inside it.
  for (let t = 0; t < 300 && fox.target !== chicken; t++) fox.ai.tick();   // reciprocalChance 10 (#1285): ~1 in 10 per tick
  ok(fox.target === chicken, `NearestAttackableTargetGoal did not acquire the chicken as fox.target (got ${fox.target && fox.target.type})`);

  const far = new Fx.MoveToHuntGoal(fox, {});
  ok(far.canUse() === true, 'MoveToHuntGoal.canUse() refused a live chicken target 20 blocks away (> 6)');
  fox.x = chicken.x - 2; fox.z = chicken.z;   // now within the 6-block stop radius
  ok(far.canUse() === false, 'MoveToHuntGoal.canUse() accepted a target already within the 6-block stop radius');
  far.tick();
  ok(fox.crouching === true && fox.rollingHead === true, 'MoveToHuntGoal did not set the crouch/rolling-head stalk pose once close');

  okAv((() => { fox.target = null; return new Fx.MoveToHuntGoal(fox, {}).canUse() === false; })(),
    'MoveToHuntGoal.canUse() accepted a null target');
  okAv((() => { fox.target = EL.spawn('cow', 0, 64, 0, {}); const g = new Fx.MoveToHuntGoal(fox, {}); return g.canUse() === false; })(),
    'MoveToHuntGoal.canUse() accepted a cow — only chicken/rabbit are valid prey');
}

// ── 7. Fx.EatSweetBerriesGoal ────────────────────────────────────────────────────────────────
say('7. Fx.EatSweetBerriesGoal — MoveToTargetPosGoal search, decrement age, fill mouth, drop rest');
{
  EL.list.length = 0;   // section 6 leaves a fox/chicken/cow behind — a stray entity here
                        // would out-target/out-flee this section's own EatSweetBerriesGoal
                        // (Ai.NearestAttackableTargetGoal's priority-1 TARGET beats priority-8).
  const bushId = R.id.sweet_berry_bush;
  ok(bushId !== undefined, 'R.id.sweet_berry_bush missing — cannot test at all');
  MCL.Player = null;
  const saveBright7 = W.rawBrightness;
  W.rawBrightness = () => 15;

  function ageState(age) { return Bh.setProp(S.stateOf('sweet_berry_bush') | 0, 'age', age); }
  const stone = S.stateOf('stone') | 0, dirt = S.stateOf('dirt') | 0;
  for (let x = -2; x <= 5; x++) for (let z = -2; z <= 2; z++) W.setBlock(x, 63, z, stone);
  // the bush's own ground rule (07_world.js's `groundOk` case 1, BUSH) needs dirt/farmland
  // below it, not the stone floor every OTHER cell here uses for the fox to walk on —
  // W.setBlock silently refuses (canSurvive) a bush placed straight onto stone.
  W.setBlock(3, 63, 0, dirt);
  W.setBlock(3, 64, 0, ageState(3));   // a fully mature bush, three blocks east

  const e = EL.spawn('fox', 0, 64.5, 0, {});
  MCL.Equip.setEquipped(e, MCL.Items.MAINHAND, null);
  const rawBefore = S.propValue(W.getBlock(3, 64, 0), R.PROP.age);
  let ticks = 0;
  while (S.propValue(W.getBlock(3, 64, 0), R.PROP.age) === rawBefore && ticks < 400) {
    EL.tickMob(e);
    ticks++;
  }
  ok(ticks < 400, `EatSweetBerriesGoal never ate the bush in ${ticks} real ticks (fox ended at ${e.x.toFixed(2)},${e.z.toFixed(2)})`);
  const rawAfter = S.propValue(W.getBlock(3, 64, 0), R.PROP.age);
  ok(+R.valueNames[rawAfter] === 1, `bush age after eating = ${R.valueNames[rawAfter]}, expected 1 (the jar’s own off-by-one, not 0)`);
  const IT = MCL.Items, Eq = MCL.Equip;
  const mouth = Eq.getEquipped(e, IT.MAINHAND);
  ok(!!mouth, 'the mouth slot was not filled after eating a berry bush');

  // an unripe bush (age<2) must never be accepted as a target.
  W.setBlock(3, 64, 0, ageState(1));
  const unripe = new Fx.EatSweetBerriesGoal({ x: 0, y: 64, z: 0, type: 'fox' }, { mobGriefing: () => true });
  okAv(unripe.canUse() === false, 'an unripe bush (age 1 < 2) was accepted as a target — isRipeBush check is broken');

  // mobGriefing=false refuses to eat at all (D-399's own gate, the same generic door rabbit's
  // own carrot goal already uses).
  W.setBlock(3, 64, 0, ageState(3));
  const goalNoGrief = new Fx.EatSweetBerriesGoal({ x: 3.4, y: 64, z: 0.4, type: 'fox' }, { mobGriefing: () => false });
  okAv(goalNoGrief.canUse() === false, 'mobGriefing=false must refuse EatSweetBerriesGoal.canUse() entirely');
  // eatBerry re-checks mobGriefing at pick time and plays pick_berries (.decomp 922-953).
  {
    const played = []; const oldPlay = MCL.Sound && MCL.Sound.play;
    MCL.Sound = MCL.Sound || {}; MCL.Sound.play = (n) => { played.push(n); };
    let grief = true;
    const fe = EL.spawn('fox', 3.5, 64, 0.5, {});
    const mk = () => new Fx.EatSweetBerriesGoal(fe, { mobGriefing: () => grief });
    let g = mk();
    Eq.setEquipped(fe, IT.MAINHAND, null);
    ok(g.canUse() === true, 'section 7b: goal did not target the ripe bush');
    g.start(); grief = false;
    for (let i = 0; i < 200; i++) g.tick();
    okAv(+R.valueNames[S.propValue(W.getBlock(3, 64, 0), R.PROP.age)] === 3 && !played.includes('block.sweet_berry_bush.pick_berries'),
      'mobGriefing flipped off after canUse must refuse the pick');
    grief = true; g = mk(); g.canUse(); g.start();
    for (let i = 0; i < 200; i++) g.tick();
    okAv(played.includes('block.sweet_berry_bush.pick_berries'), 'eatBerry must emit block.sweet_berry_bush.pick_berries');
    MCL.Sound.play = oldPlay;
  }
  W.rawBrightness = saveBright7;
}

// ── 8. Fx.PickupItemGoal ─────────────────────────────────────────────────────────────────────
say('8. Fx.PickupItemGoal — nearest dropped item, within 8 blocks, into the mouth slot');
{
  EL.list.length = 0;
  MCL.Player = null;
  const IT = MCL.Items, Eq = MCL.Equip;
  const fox = EL.spawn('fox', 0, 64, 0, {});
  Eq.setEquipped(fox, IT.MAINHAND, null);   // initEquipment may have rolled a spawn item
  const dropped = EL.dropStack(2, 64, 0, 'apple', 1);
  ok(!!dropped, 'EL.dropStack could not spawn a test item — cannot test at all');
  dropped.pickupDelay = 0;   // a fresh drop has a delay; vanilla cannotPickup() skips it (#4543)
  const goal = new Fx.PickupItemGoal(fox, { random: () => 0 });
  ok(goal.canUse() === true, 'PickupItemGoal.canUse() refused a nearby dropped item with an empty mouth');
  goal.start();
  fox.x = dropped.x; fox.z = dropped.z; fox.y = dropped.y;
  goal.tick();
  const mouth = Eq.getEquipped(fox, IT.MAINHAND);
  ok(!!mouth, 'PickupItemGoal.tick() did not fill the mouth slot once adjacent to the item');
  ok(dropped.removed === true, 'PickupItemGoal.tick() did not remove the picked-up item entity');

  okAv((() => { Eq.setEquipped(fox, IT.MAINHAND, { i: 0, n: 1 }); return new Fx.PickupItemGoal(fox, { random: () => 0 }).canUse() === false; })(),
    'PickupItemGoal.canUse() accepted a fox whose mouth is already full');
  Eq.setEquipped(fox, IT.MAINHAND, null);
  fox.x = 0; fox.y = 64; fox.z = 0; dropped.removed = false; dropped.x = 2; dropped.z = 0;
  fox.sleeping = true;
  okAv(new Fx.PickupItemGoal(fox, { random: () => 0 }).canUse() === false, 'a sleeping fox must not start PickupItemGoal (wantsToPickupItem)');
  fox.sleeping = false;
  okAv(new Fx.PickupItemGoal(fox, { random: () => 0.5 }).canUse() === false, 'the 1-in-5 roll must gate PickupItemGoal.canUse');
  fox.aiDisabled = true;
  okAv(Fx.loot(fox, dropped) === false, 'a NoAI fox must not loot (canMoveVoluntarily)');
  fox.aiDisabled = false;
  const C = MCL.Commands, rg = C && C.ruleGet;
  if (C) { C.ruleGet = (n) => n === 'mobGriefing' ? 'false' : 'true'; }
  okAv(!C || Fx.loot(fox, dropped) === false, 'mobGriefing=false must stop fox loot');
  if (C) C.ruleGet = rg;
}

// ── 8b. Fx.loot — FoxEntity.loot split / spit / swap ─────────────────────────────────────────
say('8b. Fx.loot — stack of 5 -> 1 held, 4 dropped; old item spat; food swap while eating');
{
  EL.list.length = 0;
  const IT = MCL.Items, Eq = MCL.Equip;
  const fox = EL.spawn('fox', 0, 64, 0, {});
  Eq.setEquipped(fox, IT.MAINHAND, null);
  const it = EL.dropStack(0, 64, 0, 'apple', 5);
  ok(Fx.loot(fox, it) === true, 'Fx.loot refused an item with an empty mouth');
  const held = Eq.getEquipped(fox, IT.MAINHAND);
  ok(held && held.n === 1, 'Fx.loot must hold exactly 1 of the stack');
  const rest = EL.list.filter(o => o.type === 'item' && !o.removed);
  ok(rest.length === 1 && rest[0].count === 4, 'Fx.loot must drop the other 4 (got ' + rest.map(o => o.count) + ')');
  ok(it.removed === true && fox.eatingTime === 0, 'Fx.loot must discard the entity and reset eatingTime');
  // non-food held, eating started, food on the floor -> swap + spit
  Eq.setEquipped(fox, IT.MAINHAND, Eq.stackOf('feather'));
  fox.eatingTime = 5;
  const b = EL.dropStack(0, 64, 0, 'bread', 1);
  ok(Fx.loot(fox, b) === true && IT.nameOf(Eq.getEquipped(fox, IT.MAINHAND).i) === 'bread', 'food must swap in for a non-food mouth item while eating');
  const spat = EL.list.find(o => o.type === 'item' && !o.removed && o.item === 'feather');
  ok(!!spat && spat.pickupDelay === 40, 'the old item must be spat with pickupDelay 40');
  okAv(Fx.loot(fox, EL.dropStack(0, 64, 0, 'stick', 1)) === false, 'a full mouth must refuse a non-food item');
  // FoxEntity.drop: mouth item drops on ANY death (not killedByPlayer, rnd forced high)
  Eq.init();
  const dr = Eq.dropEquipment(fox, () => 0.99, false, 0);
  ok(dr.length === 1 && dr[0].item === 'bread', 'fox mouth item must always drop on death (got ' + JSON.stringify(dr) + ')');
  Eq.setDropChance(fox, IT.MAINHAND, Eq.DEFAULT_DROP_CHANCE);
  Eq.setEquipped(fox, IT.MAINHAND, Eq.stackOf('bread'));
  okAv(Eq.dropEquipment(fox, () => 0.99, false, 0).length === 0, 'with the generic 8.5% chance the mouth item is lost (check can fail)');
}

// ── 9. Br.CHILD.fox ──────────────────────────────────────────────────────────────────────────
say('9. Br.CHILD.fox — FoxEntity.method_18260, coin flip onto one parent’s type + trust');
{
  EL.list.length = 0;
  const seqRnd = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
  const a = { x: 0, y: 64, z: 0, type: 'fox', foxType: Fx.TYPE.RED };
  const b = { x: 0, y: 64, z: 0, type: 'fox', foxType: Fx.TYPE.SNOW };
  const child = { x: 0, y: 64, z: 0, type: 'fox' };

  Breed.CHILD.fox(child, a, b, seqRnd([0.2]));
  ok(child.foxType === a.foxType, `coin 0.2 (<0.5) should copy a's type (${a.foxType}), got ${child.foxType}`);
  Breed.CHILD.fox(child, a, b, seqRnd([0.8]));
  ok(child.foxType === b.foxType, `coin 0.8 (>=0.5) should copy b's type (${b.foxType}), got ${child.foxType}`);

  okAv((() => {
    const before = Breed.CHILD.fox;
    Breed.CHILD.fox = undefined;
    const stillWorks = typeof Breed.CHILD.fox === 'function';
    Breed.CHILD.fox = before;
    return !stillWorks;
  })(), 'clearing Breed.CHILD.fox was not detected — the anti-vacuity probe itself is broken');

  // the live Br.breed path: a fed parent's love-cause trusts the child.
  MCL.Player = null;
  const fa = EL.spawn('fox', 0, 64, 0, {});
  const fb = EL.spawn('fox', 0.3, 64, 0, {});
  Breed.setInLove(fa, 'player'); Breed.setInLove(fb, 'player');
  const born = Breed.breed(fa, fb, { random: seqRnd([0.5]) });
  ok(!!born, 'Br.breed(fox, fox) returned no child');
  ok(born && Fx.canTrust(born, 'player'), 'the child of two fed foxes does not trust the feeding player');
}

// ── 10. Spawn.RULES.fox ──────────────────────────────────────────────────────────────────────
say('10. Spawn.RULES.fox — #foxes_spawnable_on + isLightLevelValidForNaturalSpawn');
{
  ok(typeof Spawn.RULES.fox === 'function' && Spawn.canPlace('fox'), 'Spawn.RULES.fox is not wired');
  const grass = S.stateOf('grass_block') | 0, stone = S.stateOf('stone') | 0;
  W.setBlock(0, 63, 0, grass);
  W.setBlock(0, 63, 1, stone);
  const saveBright = W.rawBrightness;
  W.rawBrightness = () => 9;
  ok(Spawn.RULES.fox(0, 64, 0) === true, 'grass below + bright enough must pass');
  ok(Spawn.RULES.fox(0, 64, 1) === false, 'stone below (not in foxes_spawnable_on) must refuse');
  okAv((() => { W.rawBrightness = () => 8; return Spawn.RULES.fox(0, 64, 0) === false; })(),
    'dropping brightness to 8 (the >8 boundary) must refuse — the light check is really consulted');
  W.rawBrightness = saveBright;
}

// ── 11. Fx.skinKey ───────────────────────────────────────────────────────────────────────────
say('11. Fx.skinKey — red/snow texture family picker');
{
  ok(Fx.skinKey({ type: 'fox', foxType: Fx.TYPE.RED }) === 'fox', 'RED should map to "fox"');
  ok(Fx.skinKey({ type: 'fox', foxType: Fx.TYPE.SNOW }) === 'snow_fox', 'SNOW should map to "snow_fox"');
  ok(Fx.skinKey({ type: 'cow', foxType: Fx.TYPE.RED }) === null, 'skinKey must refuse a non-fox entity');
  okAv((() => { const save = Fx.SKIN[1]; Fx.SKIN[1] = 'broken'; const bad = Fx.skinKey({ type: 'fox', foxType: Fx.TYPE.SNOW }) === 'broken'; Fx.SKIN[1] = save; return bad; })(),
    'corrupting Fx.SKIN[1] did not change skinKey’s answer — the table is not really consulted');
}

// ── 12. initEquipment + tickMovement eating ─────────────────────────────────────────────────
say('12. FoxEntity.initEquipment 20% mouth item, tickMovement 600-tick eating');
{
  const IT = MCL.Items, Eq = MCL.Equip;
  const tally = {}; let held = 0; const N = 1000;
  const run = () => {
    for (const k of Object.keys(tally)) delete tally[k]; held = 0;
    for (let i = 0; i < N; i++) {
      const f = { type: 'fox' };
      Fx.initEquipment(f);
      const st = Eq.getEquipped(f, IT.MAINHAND);
      if (st) { held++; const n = IT.nameOf(st.i); tally[n] = (tally[n] | 0) + 1; }
    }
  };
  run();
  ok(held > 150 && held < 250, `~20% of ${N} foxes should hold an item, got ${held}`);
  const pct = (n) => (tally[n] | 0) / held;
  ok(Math.abs(pct('emerald') - 0.05) < 0.05, 'emerald ~5% of held: ' + pct('emerald'));
  ok(Math.abs(pct('egg') - 0.15) < 0.09, 'egg ~15% of held: ' + pct('egg'));
  ok(Math.abs(pct('wheat') - 0.2) < 0.09, 'wheat ~20% of held: ' + pct('wheat'));
  ok(Math.abs(pct('feather') - 0.2) < 0.09, 'feather ~20% of held: ' + pct('feather'));
  ok((tally.rabbit_foot | 0) > 0 && (tally.rabbit_hide | 0) > 0, 'both rabbit_foot and rabbit_hide must occur');
  ok(Fx.initEquipment({}, () => 0.5) === null, 'a roll of 0.5 (>= 0.2) must give nothing');
  const seq = (...v) => () => v.shift();
  ok(IT.nameOf(Fx.initEquipment({}, seq(0.1, 0.99)).i) === 'feather', 'second roll >= 0.8 is a feather');
  ok(IT.nameOf(Fx.initEquipment({}, seq(0.1, 0.01)).i) === 'emerald', 'second roll < 0.05 is an emerald');
  // eating: 600 ticks, only food, only while idle on the ground
  const mk = (item, over) => {
    const f = Object.assign({ type: 'fox', onGround: true, x: 0, y: 64, z: 0 }, over || {});
    Eq.setEquipped(f, IT.MAINHAND, Object.assign(Eq.stackOf(item), { n: 2 }));
    return f;
  };
  const f1 = mk('sweet_berries');
  for (let i = 0; i < 600; i++) Fx.mobTick(f1, () => 0.99);
  ok(Eq.getEquipped(f1, IT.MAINHAND).n === 2, 'not eaten at 600 ticks (needs >600)');
  Fx.mobTick(f1, () => 0.99);
  ok(Eq.getEquipped(f1, IT.MAINHAND).n === 1 && f1.eatingTime === 0, 'one berry eaten on tick 601, timer reset');
  const f2 = mk('emerald');
  for (let i = 0; i < 700; i++) Fx.mobTick(f2, () => 0.99);
  ok(Eq.getEquipped(f2, IT.MAINHAND).n === 2, 'non-food (emerald) is never eaten');
  okAv((() => { const f = mk('sweet_berries', { target: {} }); for (let i = 0; i < 700; i++) Fx.mobTick(f, () => 0.99); return Eq.getEquipped(f, IT.MAINHAND).n === 2; })(),
    'a fox with a target must not eat');
  okAv((() => { const f = mk('sweet_berries', { sleeping: true }); for (let i = 0; i < 700; i++) Fx.mobTick(f, () => 0.99); return Eq.getEquipped(f, IT.MAINHAND).n === 2; })(),
    'a sleeping fox must not eat');
  okAv((() => { const f = mk('sweet_berries', { crouching: true, rollingHead: true }); Fx.mobTick(f, () => 0.99); return !f.crouching && !f.rollingHead; })(),
    'no target: mobTick clears crouching/rollingHead (tickMovement :203-209)');
  okAv((() => { const f = mk('sweet_berries', { crouching: true, rollingHead: true, target: { dead: true } }); Fx.mobTick(f, () => 0.99); return !f.crouching && !f.rollingHead; })(),
    'dead target: mobTick clears crouching/rollingHead');
  okAv((() => { const f = mk('sweet_berries', { crouching: true, rollingHead: true, target: {} }); Fx.mobTick(f, () => 0.99); return f.crouching && f.rollingHead; })(),
    'live target: crouch flags kept');
  okAv((() => { const f = mk('sweet_berries', { aiDisabled: true }); for (let i = 0; i < 700; i++) Fx.mobTick(f, () => 0.99); return Eq.getEquipped(f, IT.MAINHAND).n === 2; })(),
    'a NoAI fox must not eat its mouth item (canMoveVoluntarily gate)');
  okAv((() => { const f = mk('sweet_berries', { onGround: false }); for (let i = 0; i < 700; i++) Fx.mobTick(f, () => 0.99); return Eq.getEquipped(f, IT.MAINHAND).n === 2; })(),
    'an airborne fox must not eat');
  // sound + status-45 particles in the 560..600 window
  const played = []; const savedSound = MCL.Sound, savedPx = MCL.Particles; let crack = 0;
  MCL.Sound = { play: (ev) => { played.push(ev); return true; } };
  MCL.Particles = { spawn: (t) => { if (t === 'item_crack') crack++; return {}; } };
  const f3 = mk('sweet_berries'); f3.eatingTime = 560;
  Fx.mobTick(f3, () => 0.05);
  MCL.Sound = savedSound; MCL.Particles = savedPx;
  ok(played[0] === 'entity.fox.eat' && crack === 8, `eat sound + 8 crack particles, got ${played} / ${crack}`);
  // LivingEntity.eatFood on the finishing tick: sound, effects, remainder
  { const sp = MCL.Sound, se = MCL.Effects, added = []; const ev = [];
    MCL.Sound = { play: (n) => { ev.push(n); return true; } };
    MCL.Effects = { NAMES: { 1: "speed" }, addStatusEffect: (e, n) => { added.push(n); } };
    const ff = mk('pufferfish'); ff.eatingTime = 600; Fx.mobTick(ff, () => 0.5);
    ok(ev.includes('entity.fox.eat'), 'finish step plays entity.fox.eat');
    ok(added.join() === 'poison,hunger,nausea', 'pufferfish effects applied, got ' + added);
    const fs = mk('mushroom_stew'); Eq.getEquipped(fs, IT.MAINHAND).n = 1; fs.eatingTime = 600; Fx.mobTick(fs, () => 0.5);
    ok(IT.nameOf(Eq.getEquipped(fs, IT.MAINHAND).i) === 'bowl', 'mushroom_stew leaves a bowl');
    { const st = mk('suspicious_stew'); const m = Eq.getEquipped(st, IT.MAINHAND); m.t = { Effects: [{ EffectId: 1, EffectDuration: 100 }] }; added.length = 0;
      st.eatingTime = 600; Fx.mobTick(st, () => 0.5);
      ok(added.length === 1 && added[0] === MCL.Effects.NAMES[1], 'suspicious_stew applies its tag effects, got ' + added); }
    { const se2 = MCL.Enderman, calls = []; MCL.Enderman = { chorusTeleport: () => { calls.push(1); return true; } };
      const cf = mk('chorus_fruit'); cf.eatingTime = 600; Fx.mobTick(cf, () => 0.5);
      MCL.Enderman = se2; ok(calls.length === 1, 'chorus_fruit calls the shared ChorusFruit loop once, got ' + calls.length); }
    added.length = 0; const fr = mk('rotten_flesh'); fr.eatingTime = 600; Fx.mobTick(fr, () => 0.9);
    okAv(added.length === 0, 'effect chance (0.8) rolled at 0.9 applies nothing');
    MCL.Sound = sp; MCL.Effects = se; }
  // FoxEntity.tick: wake on target/water, stand on water/sleep, walking 20% block-break effect
  const wk = (o) => { const f = Object.assign({ type: 'fox', x: 0, y: 64, z: 0, sleeping: true, sitting: true }, o); Fx.mobTick(f, () => 0.99); return f; };
  ok(wk({ target: {} }).sleeping === false, 'a target wakes a sleeping fox');
  ok(wk({ inWater: true, sleeping: false }).sitting === false, 'water stands a sitting fox up');
  ok(wk({ sleeping: true }).sitting === false, 'sleeping clears sitting');
  okAv(wk({ sitting: true, sleeping: false }).sitting === true && wk({}).sleeping === true, 'no target/water/thunder: sleeping fox stays asleep');
  { let fx = 0; const sp = MCL.Sound; MCL.Sound = { blockBreak: () => { fx++; } };
    const w = Object.assign({ type: 'fox', x: 0, y: 64, z: 0, walking: true }); Fx.mobTick(w, () => 0.1); MCL.Sound = sp;
    okAv(fx === 1, 'walking fox at roll<0.2 plays the block-break event'); }
  okAv((() => { let fx = 0; const sp = MCL.Sound; MCL.Sound = { blockBreak: () => { fx++; } }; Fx.mobTick({ type: 'fox', x: 0, y: 64, z: 0 }, () => 0.1); MCL.Sound = sp; return fx === 0; })(), 'a non-walking fox plays no block-break event');
  okAv((() => { const bad = Fx.EAT_DONE; Fx.EAT_DONE = 10; const f = mk('sweet_berries'); for (let i = 0; i < 11; i++) Fx.mobTick(f, () => 0.99); Fx.EAT_DONE = bad; return Eq.getEquipped(f, IT.MAINHAND).n === 1; })(),
    'shortening EAT_DONE to 10 did not change when the fox eats — the constant is not really consulted');
  okAv((() => { let n = 0; for (let i = 0; i < 200; i++) { EL.spawnCounter = i * 104729; const e = EL.spawn('fox', 0, 64, 0, {}); if (Eq.getEquipped(e, IT.MAINHAND)) n++; } return n > 0 && n < 200; })(),
    'EL.spawn(fox) over 200 e.random streams must give some foxes a mouth item and not all (initEquipment wired into DEFAULTS.fox)');
  // FoxData: pack shares the first fox's type; spawnIdx>=2 is a baby
  { const pd = {}; const pack = [0, 1, 2, 3].map((i) => EL.spawn('fox', 0, 64, 0, { spawnIdx: i, packData: pd, type: undefined }));
    pack[0].foxType = pack[0].foxType; // first rolled by biome
    ok(pack.every((f) => f.foxType === pack[0].foxType), 'pack foxes share the first fox type');
    ok(pack.map((f) => (f.growAge || 0) < 0).join() === 'false,false,true,true', 'spawnIdx>=2 foxes are babies, 0/1 adults');
    okAv(pack[2].growAge === -24000, 'baby growAge is -24000');
    const pd2 = { foxType: Fx.TYPE.SNOW }; okAv(EL.spawn('fox', 0, 64, 0, { spawnIdx: 1, packData: pd2 }).foxType === Fx.TYPE.SNOW, 'packData.foxType is copied'); }
}

console.log(`\n${pass} checks passed, ${fails.length} failed (${breaks} anti-vacuity probes included)`);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) {
  console.log('FAILURES:');
  for (const f of fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('foxcheck: ALL GREEN');
