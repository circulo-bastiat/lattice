#!/usr/bin/env node
// pigridecheck.mjs — loop/pigride-s98: pig MOUNTING + carrot-on-a-stick STEERING, whole.
//
//   node tools/pigridecheck.mjs [--verbose]
//
// Sections:
//   1. Passive.pigMount — the state change (reuses the shared e.rider field, PigEntity.interactMob)
//   2. Use.entityUse — the real dispatch: saddled+unridden mounts on ANY click except breeding food
//   3. Passive.pigCanBeControlledByRider — carrot on a stick, main hand or offhand (slot 40)
//   4. EL.tickMob's own dispatch — pig routes to Passive.pigTravel, not Mount.travelRidden
//   5. Passive.pigTravel — uncontrolled leaves goal-driven mobSpeed/zza untouched; controlled
//      pins full forward and drives PigEntity.getSaddledSpeed()'s own boost hump
//   6. Use.pigBoostOnAStick — the real carrot-on-a-stick right-click: durability spend, the
//      fishing_rod conversion at 0 durability, refuses mid-boost / off-pig / uncontrolled
//   7. 14_player.js's tickMountedJump — a saddled PIG must NOT get the horse jump-charge UI
//   8. anti-vacuity is threaded through every section above (§1, §2, §4, §6, §7)

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
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };
const near = (a, b, t, what) => ok(Math.abs(a - b) <= t, `${what}: ${a} vs ${b} (+-${t})`);

console.log('pigridecheck — loop/pigride-s98, pig mounting + carrot-on-a-stick steering');

const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
               '07r_mount.js', '07w_passive.js', '14l_use.js', '14_player.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.EntityList.init();
M.World.init(1);
M.Behave.init(M.World);
M.Ai.init();
M.Breed.init();
M.Mount.init();
M.Passive.init();
M.Use.init(M.World);

const EL = M.EntityList, Ps = M.Passive, Use = M.Use, Mnt = M.Mount, IT = M.Items, Iv = M.Inventory;

function freshPlayer() {
  const P = M.Player;
  P.inventory = Iv.create();
  P.hotbar = new Int32Array(9);   // P.syncHotbar's own backing store (14_player.js), not built by P.init() here
  P.slot = 0;
  P.instabuild = false;
  P.vehicle = null;
  P.crouching = false;
  return P;
}
function mkClickPlayer(over) {
  return Object.assign({ x: 0, y: 0, z: 0, slot: 0, inventory: Iv.create(), instabuild: false }, over || {});
}

// ══════════════ 1. Passive.pigMount — the state change ══════════════════════════════════════
{
  say('\n§1 Passive.pigMount');
  const pig = EL.spawn('pig', 10, 5, 10);
  ok(!pig.rider, 'a fresh pig starts with no rider');
  okAv(Ps.pigMount(pig) === false, 'an UNSADDLED pig refuses to be mounted (PigEntity.interactMob: isSaddled() gates the mount branch)');
  Ps.pigSaddle(pig);
  ok(Ps.pigMount(pig) === true, 'a saddled pig can be mounted');
  ok(pig.rider === 'player', 'and Mnt.isRidden reads the SAME shared field');
  ok(Mnt.isRidden(pig) === true, 'Mnt.isRidden(pig) === true — the shared e.rider field, no Mnt.MOUNTABLE edit needed');
  okAv(Ps.pigMount(pig) === false, 'an already-ridden pig refuses a second mount');
  Mnt.dismount(pig);
  ok(Mnt.isRidden(pig) === false, 'Mnt.dismount (07r_mount.js, generic) actually clears a pig\'s rider too');
  ok(Ps.pigMount(pig) === true, 'and it can be re-mounted after dismounting');
}

// ═══════════════ 2. Use.entityUse — the real dispatch ═════════════════════════════════════════
{
  say('\n§2 Use.entityUse — mount-on-click, breeding food excepted');
  const pig = EL.spawn('pig', 12, 5, 12);
  Ps.pigSaddle(pig);
  // breeding food (carrot) does NOT mount — it falls through to the ordinary breed dispatch
  const carrotStack = Iv.stack('carrot', 1);
  Use.entityUse(mkClickPlayer(), pig, carrotStack);
  ok(pig.rider !== 'player', 'holding the pig\'s own breeding food (carrot) does NOT mount it (PigEntity.interactMob\'s own isBreedingItem() exemption)');
  // an empty hand DOES mount a saddled, unridden, non-sneaking pig
  const r2 = Use.entityUse(mkClickPlayer(), pig, null);
  ok(r2 === true, 'an EMPTY-hand click on a saddled pig mounts it (returns true)');
  ok(pig.rider === 'player', 'and the pig is actually ridden');
  // sneaking suppresses the mount (shouldCancelInteraction())
  Mnt.dismount(pig);
  Use.entityUse(mkClickPlayer({ crouching: true }), pig, null);
  ok(pig.rider !== 'player', 'sneaking suppresses the mount (PlayerEntity.shouldCancelInteraction())');
  // an unsaddled pig is never mounted by this branch, whatever is in hand
  const pig2 = EL.spawn('pig', 14, 5, 14);
  Use.entityUse(mkClickPlayer(), pig2, null);
  okAv(pig2.rider !== 'player', 'an UNSADDLED pig is never mounted by an empty-hand click');
}

// ═══════════════ 3. Passive.pigCanBeControlledByRider ═════════════════════════════════════════
{
  say('\n§3 Passive.pigCanBeControlledByRider — carrot on a stick, either hand');
  const P = freshPlayer();
  const pig = EL.spawn('pig', 16, 5, 16);
  Ps.pigSaddle(pig);
  Ps.pigMount(pig);
  ok(Ps.pigCanBeControlledByRider(pig) === false, 'a ridden pig with an EMPTY hand cannot be controlled (canBeControlledByRider requires the item)');
  Iv.setItem(P.inventory, P.slot, Iv.stack('carrot_on_a_stick', 1));
  ok(Ps.pigCanBeControlledByRider(pig) === true, 'holding a carrot on a stick in the MAIN hand allows control');
  Iv.setItem(P.inventory, P.slot, null);
  ok(Ps.pigCanBeControlledByRider(pig) === false, 'and it stops being controllable once the main hand is emptied');
  Iv.setItem(P.inventory, 40, Iv.stack('carrot_on_a_stick', 1));
  ok(Ps.pigCanBeControlledByRider(pig) === true, 'holding it in the OFFHAND slot (40) also allows control (PigEntity.canBeControlledByRider checks either hand)');
  Iv.setItem(P.inventory, 40, null);
  okAv(Ps.pigCanBeControlledByRider(pig) === false, 'holding a plain carrot (not on a stick) does NOT allow control');
  Iv.setItem(P.inventory, P.slot, Iv.stack('carrot', 1));
  okAv(Ps.pigCanBeControlledByRider(pig) === false, 'confirmed: a plain carrot in the main hand still refuses control');
  Iv.setItem(P.inventory, P.slot, null);
}

// ═══════════════ 4/5. EL.tickMob's own dispatch + Passive.pigTravel ═══════════════════════════
{
  say('\n§4/5 EL.tickMob dispatch + Passive.pigTravel');
  const P = freshPlayer();
  const pig = EL.spawn('pig', 20, 5, 20);
  Ps.pigSaddle(pig);
  Ps.pigMount(pig);

  // uncontrolled: goal-driven mobSpeed/zza stand untouched (the `else` branch of ItemSteerable.travel)
  pig.mobSpeed = 0.1234; pig.zza = 0.5678; pig.yaw = 0; pig.riderInput = { yaw: 3, pitch: 1 };
  Ps.pigTravel(pig, Math.random);
  ok(pig.mobSpeed === 0.1234 && pig.zza === 0.5678, 'uncontrolled (no carrot in hand): Passive.pigTravel leaves the goal-set mobSpeed/zza untouched');
  ok(pig.yaw === 0, 'and does not sync yaw from the rider either — control is required for both');

  // controlled: yaw/pitch sync, full forward, real speed
  Iv.setItem(P.inventory, P.slot, Iv.stack('carrot_on_a_stick', 1));
  pig.riderInput = { yaw: 1.5, pitch: 0.8, forwardSpeed: -1, sidewaysSpeed: -1 };
  Ps.pigTravel(pig, Math.random);
  ok(pig.yaw === 1.5, 'controlled: yaw is synced from the rider');
  near(pig.pitch, 0.4, 1e-9, 'controlled: pitch is HALVED from the rider\'s own (ItemSteerable.travel: setPitch(pitch*0.5F))');
  ok(pig.zza === 1, 'controlled: zza is pinned to 1 (setMovementInput(0,0,1) — always full forward, unlike a horse\'s own rider-steered forward/strafe)');
  const attrs = M.Entities.attrsOf('pig');
  near(pig.mobSpeed, attrs.speed * Ps.PIG_SADDLED_SPEED_MUL, 1e-9, 'controlled, unboosted: mobSpeed is PigEntity.getSaddledSpeed() off the real 0.25 attribute default');
  ok(pig.stepHeight === 1.0 && pig.bodyYaw === 1.5 && pig.headYaw === 1.5, '#4111 controlled: stepHeight 1.0 and bodyYaw=headYaw=rider yaw (ItemSteerable.travel)');
  near(pig.airStrafingSpeed, pig.mobSpeed * 0.1, 1e-9, '#4111 controlled: airStrafingSpeed = movementSpeed*0.1');
  okAv(pig.stepHeight !== 0.6, '#4111 anti-vacuity: controlled stepHeight is not the Ph.STEP fallback');
  { const fp = EL.spawn('pig', 24, 5, 24); EL.tickMob(fp, 0.05); ok(fp.stepHeight === 0.5, '#4111 free pig: stepHeight 0.5 (not 0.6 fallback)'); }
  Iv.setItem(P.inventory, P.slot, null);

  // the tick dispatch itself: a saddled ridden pig must NOT reach Mount.travelRidden
  let calledHorseStyle = 0;
  const realTravelRidden = Mnt.travelRidden;
  Mnt.travelRidden = function () { calledHorseStyle++; };
  const pig3 = EL.spawn('pig', 22, 5, 22);
  Ps.pigSaddle(pig3); Ps.pigMount(pig3);
  EL.tickMob(pig3);
  okAv(calledHorseStyle === 0, 'EL.tickMob routes a saddled ridden PIG to Passive.pigTravel, never to Mount.travelRidden');
  Mnt.travelRidden = realTravelRidden;

  // and a saddled ridden HORSE is unaffected by the new pig-first branch
  let calledPigTravel = 0;
  const realPigTravel = Ps.pigTravel;
  Ps.pigTravel = function () { calledPigTravel++; };
  const horse = EL.spawn('horse', 24, 5, 24);
  horse.tamed = true; Mnt.saddle(horse); horse.rider = 'player'; horse.onGround = true;
  EL.tickMob(horse);
  okAv(calledPigTravel === 0, 'a saddled ridden HORSE still never reaches Passive.pigTravel — the pig-first branch is type-gated');
  Ps.pigTravel = realPigTravel;
}

// ═══════════════ 6. Use.pigBoostOnAStick ══════════════════════════════════════════════════════
{
  say('\n§6 Use.pigBoostOnAStick — durability spend + fishing_rod conversion');
  const P = freshPlayer();
  const pig = EL.spawn('pig', 30, 5, 30);
  Ps.pigSaddle(pig); Ps.pigMount(pig);
  P.vehicle = pig;
  const stack2 = Iv.stack('carrot_on_a_stick', 1);
  const maxDur = IT.durability[stack2.i | 0];
  ok(maxDur === 25, `carrot_on_a_stick's own durability is 25 (OnAStickItem's own maxDamage(25), got ${maxDur})`);

  // an EMPTY-handed rider refuses (canBeControlledByRider needs the item actually held)
  okAv(Use.pigBoostOnAStick(P, stack2) === false, 'refuses when the rider is not actually holding the boost stack (main hand empty here)');

  Iv.setItem(P.inventory, P.slot, stack2);
  ok(Use.pigBoostOnAStick(P, stack2) === true, 'boosts once the rider is holding the carrot on a stick');
  ok(pig.boosted === true, 'and the pig entity is now boosted (Passive.pigBoost\'s own state)');
  ok(stack2.d === 7, `the stack took exactly 7 damage (OnAStickItem's own damagePerUse, got ${stack2.d})`);
  okAv(Use.pigBoostOnAStick(P, stack2) === false, 'a second boost attempt mid-boost refuses (SaddledComponent.boost\'s own re-entry guard)');

  // off-pig / off-vehicle refusals -- a plain object, NOT freshPlayer()/M.Player: that helper
  // resets the ONE shared M.Player singleton's own inventory, which would silently wipe out
  // the `P`/`stack2` state this section is still mid-drain on below.
  const notPig = EL.spawn('cow', 40, 5, 40);
  const P2 = mkClickPlayer({ vehicle: notPig });
  const stack3 = Iv.stack('carrot_on_a_stick', 1);
  Iv.setItem(P2.inventory, P2.slot, stack3);
  okAv(Use.pigBoostOnAStick(P2, stack3) === false, 'no vehicle-is-a-pig, no boost, whatever is in hand');

  // drain it to the fishing_rod conversion. `Use.swapHeld` (14l_use.js, reused as-is) replaces
  // the INVENTORY SLOT's own stack object, the same convention `Use.damage`'s own item-removal
  // branch already uses — a caller must re-read the live slot, not a stack reference held from
  // before the swap (P.heldItem() is exactly that live read in the real game).
  for (let i = 0; i < 4 && Iv.getItem(P.inventory, P.slot).d < maxDur
       && IT.nameOf(Iv.getItem(P.inventory, P.slot).i | 0) === 'carrot_on_a_stick'; i++) {
    pig.boosted = false;
    Use.pigBoostOnAStick(P, Iv.getItem(P.inventory, P.slot));
  }
  const afterDrain = Iv.getItem(P.inventory, P.slot);
  ok(IT.nameOf(afterDrain.i | 0) === 'fishing_rod', `at/past ${maxDur} durability the stack becomes a fishing_rod (OnAStickItem.use's own ItemStack.damage overflow, got ${IT.nameOf(afterDrain.i | 0)})`);
  ok((afterDrain.d | 0) === 0, 'and the fresh fishing_rod stack carries no leftover damage');

  // creative never spends durability
  const P3 = freshPlayer();
  P3.instabuild = true;
  const pig4 = EL.spawn('pig', 42, 5, 42);
  Ps.pigSaddle(pig4); Ps.pigMount(pig4);
  P3.vehicle = pig4;
  const stack4 = Iv.stack('carrot_on_a_stick', 1);
  Iv.setItem(P3.inventory, P3.slot, stack4);
  ok(Use.pigBoostOnAStick(P3, stack4) === true, 'creative still boosts the pig');
  okAv(stack4.d === 0, 'but creative spends no durability at all (P.instabuild)');
}

// ═══════════════ 7. tickMountedJump must not fire for a saddled pig ══════════════════════════
{
  say('\n§7 14_player.js tickMountedJump — pig excluded from the horse jump-charge UI');
  const P = freshPlayer();
  const pig = EL.spawn('pig', 50, 5, 50);
  Ps.pigSaddle(pig); Ps.pigMount(pig);
  P.mountVehicle(pig);
  P.mountJumpStrength = 0; P.mountJumpTicks = 0;
  const cmd = { fwd: 0, strafe: 0, jump: true, sneak: false, sprint: false };
  P.tickMounted(cmd);
  P.tickMounted(cmd);
  P.tickMounted(cmd);
  okAv(P.mountJumpStrength === 0, 'holding jump while riding a saddled PIG never charges a jump bar (Mnt.isMountable gate in tickMountedJump)');
  P.vehicle = null;

  // and a real horse is unaffected by that same gate
  const horse = EL.spawn('horse', 52, 5, 52);
  horse.tamed = true; Mnt.saddle(horse); horse.onGround = true; horse.jumpStrength = 0; horse.angry = false;
  P.mountVehicle(horse);
  P.mountJumpStrength = 0; P.mountJumpTicks = 0;
  for (let i = 0; i < 3; i++) P.tickMounted(cmd);
  ok(P.mountJumpStrength > 0, 'the same jump-hold still charges a horse\'s jump bar exactly as before this session\'s pig gate');
  P.vehicle = null;
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
