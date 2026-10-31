#!/usr/bin/env node
// stridercheck.mjs — s135: the strider exists (src/07zzj_strider.js): cold, saddle + ride, breeding, riders.
//
//   node tools/stridercheck.mjs [--verbose]
//
// Sections:
//   1. cold state -- StriderEntity.tick/isCold/setCold: warm on lava only, cold off it,
//      and a mounted rider inherits the VEHICLE's own cold flag
//   2. speed -- getSpeed/getSaddledSpeed's own cold multipliers off the real attribute default
//   3. saddle -- Saddleable: canBeSaddled/saddle/dropInventory (isAlive && !isBaby)
//   4. mounting -- Strider.mount + Use.entityUse's real dispatch (breeding food excepted,
//      reuses the SAME e.rider field pigridecheck already proves for Mnt.isRidden)
//   5. canBeControlledByRider -- warped fungus on a stick, either hand (grep pigridecheck: the
//      SAME split Passive.pigCanBeControlledByRider draws, ported off a different item)
//   6. EL.tickMob dispatch + Strider.travel -- uncontrolled leaves goal-set mobSpeed/zza alone;
//      controlled syncs yaw/pitch, pins full forward, drives the SHARED SaddledComponent boost
//      hump (Passive.pigBoost/pigTravelSpeed, reused directly, not re-derived)
//   7. Use.striderBoostOnAStick -- warped_fungus_on_a_stick's OWN durability shape (maxDamage
//      100, damagePerUse 1 -- NOT carrot on a stick's 25/7)
//   8. natural-spawn rider rolls -- Strider.rollRider: 1/30 zombie rider (saddles + mounts,
//      equips the stick), else 1/10 a baby strider rider; a baby strider itself never rolls
//   9. NBT save/restore -- Mb.fieldsFor('strider') carries 'saddled'; a saved+reloaded saddled
//      strider (and its mounted rider) comes back exactly as saddled/ridden
//  10. anti-vacuity is threaded through every section above
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
const near = (a, b, t, what) => ok(Math.abs(a - b) <= t, `${what}: ${a} vs ${b} (+-${t})`);

console.log('stridercheck -- s135 (KW-33), the strider: cold state, saddle+ride, natural rider rolls');

const EXTRA = ['07zq_snowgolem.js', '14j_combat.js', '02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js',
               '07r_mount.js', '07w_passive.js', '07s_raid.js', '07y_equip.js',
               '07zk_undead.js', '07zzj_strider.js', '07zw_mobnbt.js',
               '14l_use.js', '14_player.js', '07j_entityrender.js', '09c_weather.js'];
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
M.Equip.init();
if (M.Undead && M.Undead.init) M.Undead.init();
M.Raid.init ? M.Raid.init() : null;
M.Strider.init();
// This check exercises Strider.*/Use.strider* directly, not the (separately real) rostered
// goal selector (Ai.ROSTER.strider, 07k_goals.js) -- EL.tickMob still needs SOME e.ai.tick()
// to not crash (§6's own dispatch-routing assertion calls it), so this stubs an inert one
// rather than let the real goal selector's own player/animal reads run interleaved with this
// file's own direct P.inventory/e.rider pokes within the same tick.
M.Ai.ROSTER.strider = function () { return { tick: function () {} }; };
M.MobNbt.init ? M.MobNbt.init() : null;
M.Use.init(M.World);

const EL = M.EntityList, St = M.Strider, Use = M.Use, Mnt = M.Mount, IT = M.Items, Iv = M.Inventory,
      W = M.World, R = M.Reg, B = M.Blocks;
// This check pokes the SAME live M.Player singleton the real game's own goal selector reads
// (EL.aiCtx's own ctx.players()) while separately driving EL.tickMob on other striders in the
// same run -- a tick-dispatch call (§6) can walk a strider's rostered TemptGoal/LookAtPlayerGoal,
// which read that SAME P.inventory this check is mid-assertion on, through P.heldItem's own
// function-vs-value indirection (Br.itemNameOf calls it). Isolating aiCtx's players() to an
// empty list keeps EL.tickMob's own dispatch-routing assertions (the thing §6 actually tests)
// from cross-talking with this file's own direct P.inventory pokes.
{ const realCtx = EL.aiCtx; EL.aiCtx = function (e) { var c = realCtx(e); c.players = function () { return []; }; return c; }; }
const def = (n) => R.realFirst[R.id[n]] + R.defaultState[R.id[n]];
for (let cx = -1; cx <= 6; cx++) for (let cz = -1; cz <= 6; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
// a real generated stone floor under every coordinate this file spawns a mob at (0..90ish) --
// without it a spawned strider stands on AIR (an ungenerated/empty chunk section) and FALLS
// under gravity the instant a physics tick runs (Ph.travelMob, §6's own uncontrolled-travel
// call), which can clear e.rider/e.vehicle mid-fall and made this file's own later assertions
// flaky in a way that had nothing to do with Strider.* itself.
for (let x = -8; x <= 100; x++) for (let z = -8; z <= 100; z++) W.setBlock(x, 4, z, def('stone'));

function freshPlayer() {
  const P = M.Player;
  P.inventory = Iv.create();
  P.hotbar = new Int32Array(9);
  P.slot = 0;
  P.instabuild = false;
  P.vehicle = null;
  P.crouching = false;
  return P;
}
function mkClickPlayer(over) {
  return Object.assign({ x: 0, y: 0, z: 0, slot: 0, inventory: Iv.create(), instabuild: false }, over || {});
}

// ============ 1. cold state ================================================================
{
  say('\n§1 cold state -- StriderEntity.tick/isCold/setCold');
  const s = EL.spawn('strider', 10, 5, 10, { noRider: true });
  // no lava anywhere: cold
  St.updateCold(s);
  okAv(St.isCold(s) === true, 'a strider standing on stone, nowhere near lava, is COLD');
  // lava under its feet: warm
  W.setBlock(10, 4, 10, def('lava'));
  St.updateCold(s);
  ok(St.isCold(s) === false, 'lava directly below its feet makes it WARM (the "landing block" half of the OR)');
  W.setBlock(10, 4, 10, def('stone'));
  // lava AT the feet block itself
  W.setBlock(10, 5, 10, def('lava'));
  St.updateCold(s);
  ok(St.isCold(s) === false, 'lava AT the feet block also makes it WARM');
  W.setBlock(10, 5, 10, 0);
  // magma_block is NOT in STRIDER_WARM_BLOCKS (jar tag holds only lava)
  W.setBlock(10, 4, 10, def('magma_block'));
  St.updateCold(s);
  ok(St.isCold(s) === true, 'standing on magma_block is still COLD (tag is lava only)');
  W.setBlock(10, 4, 10, def('stone'));
  St.updateCold(s);
  ok(St.isCold(s) === true, 'and it goes cold again once off both');

  // #2012: landing cell is floor(y-0.2), not floor(y-1): on a slab (y=5.5) over lava the strider is COLD
  W.setBlock(10, 4, 10, def('lava')); W.setBlock(10, 5, 10, def('stone_slab'));
  s.y = 5.5; St.updateCold(s);
  ok(St.isCold(s) === true, 'on a slab (y=5.5) above lava the strider is COLD (landing cell = floor(y-0.2))');
  s.y = 5.2; St.updateCold(s);
  ok(St.isCold(s) === true, 'at y=5.2 floor(y-0.2)=5 is the slab: COLD');
  s.y = 5.1; St.updateCold(s);
  ok(St.isCold(s) === false, 'at y=5.1 floor(y-0.2)=4 reads the lava: WARM (proves the check can fail)');
  breaks++;
  W.setBlock(10, 4, 10, def('stone')); W.setBlock(10, 5, 10, 0); s.y = 5; St.updateCold(s);

  // a strider mounted on another strider inherits the VEHICLE's own cold flag
  const baby = EL.spawn('strider', 10, 5, 10, { noRider: true });
  baby.growAge = -24000;
  M.Raid.startRiding(baby, s);
  St.setCold(s, false);
  ok(St.isCold(baby) === false, 'a strider RIDING another strider reads the VEHICLE\'s cold flag, not its own');
  St.setCold(s, true);
  okAv(St.isCold(baby) === true, 'and flips warm/cold along with it');
  M.Raid.stopRiding(baby);
}

// ============ 2. speed ======================================================================
{
  say('\n§2 getSpeed/getSaddledSpeed -- cold multipliers');
  const s = EL.spawn('strider', 12, 5, 12, { noRider: true });
  const attr = M.Entities.attrsOf('strider').speed;
  ok(near(attr, 0.175, 1e-6, 'createStriderAttributes() movementSpeed default'));
  St.setCold(s, false);
  near(St.getSpeed(s, attr), attr * 1.0, 1e-9, 'warm, unsaddled: getSpeed() == attr * 1.0');
  near(St.getSaddledSpeed(s, attr), attr * 0.55, 1e-9, 'warm, saddled: getSaddledSpeed() == attr * 0.55');
  St.setCold(s, true);
  near(St.getSpeed(s, attr), attr * 0.66, 1e-9, 'cold, unsaddled: getSpeed() == attr * 0.66');
  okAv(near(St.getSaddledSpeed(s, attr), attr * 0.23, 1e-9, 'cold, saddled: getSaddledSpeed() == attr * 0.23'));
}

// ============ 3. saddle ======================================================================
{
  say('\n§3 Saddleable -- canBeSaddled/saddle/dropInventory');
  const s = EL.spawn('strider', 14, 5, 14, { noRider: true });
  ok(St.canBeSaddled(s) === true, 'a fresh adult strider can be saddled');
  ok(St.saddle(s) === true, 'and saddling it succeeds');
  okAv(St.saddle(s) === false, 'saddling an already-saddled strider refuses');
  const drops = St.dropInventory(s);
  ok(drops.length === 1 && drops[0].item === 'saddle' && drops[0].count === 1, 'dropInventory drops exactly one saddle');
  ok(s.saddled === false, 'and clears the flag');
  const baby = EL.spawn('strider', 14, 5, 14, { noRider: true });
  baby.growAge = -24000;
  okAv(St.canBeSaddled(baby) === false, 'a BABY strider cannot be saddled (isAlive() && !isBaby())');
}

// ============ 4. mounting =====================================================================
{
  say('\n§4 Strider.mount + Use.entityUse dispatch');
  const s = EL.spawn('strider', 16, 5, 16, { noRider: true });
  okAv(St.mount(s) === false, 'an UNSADDLED strider refuses to be mounted');
  St.saddle(s);
  ok(St.mount(s) === true, 'a saddled strider can be mounted');
  ok(s.rider === 'player' && Mnt.isRidden(s) === true, 'the SAME shared e.rider field Mnt.isRidden reads');
  okAv(St.mount(s) === false, 'an already-ridden strider refuses a second mount');
  Mnt.dismount(s);
  // #3955: submersion is the STRIDER's eye (y+1.445), not the player's (y+1.62)
  {
    const s3 = EL.spawn('strider', 16.5, 5.5, 16.5, { noRider: true }); St.saddle(s3);
    W.setBlock(16, 7, 16, def('lava'));
    ok(St.mount(s3) === true, 'lava only in the y+1.445..1.62 band (above the strider\'s eye) does NOT refuse a rider');
    Mnt.dismount(s3); W.setBlock(16, 7, 16, 0); W.setBlock(16, 6, 16, def('lava'));
    okAv(St.mount(s3) === false, 'lava at the strider\'s own eye cell refuses a rider');
    W.setBlock(16, 6, 16, 0);
  }

  // #4047: eye probe is eyeY-1/9 (y+1.334) and needs blockY+fluidHeight > probe
  {
    const s4 = EL.spawn('strider', 16.5, 5.5, 16.5, { noRider: true }); St.saddle(s4);
    W.setBlock(16, 6, 16, def('lava'));                       // source: top 6+8/9=6.889 > 6.834 -> submerged
    okAv(St.mount(s4) === false, 'lava source in the probe cell refuses');
    W.setBlock(16, 6, 16, 0); W.setBlock(16, 6, 16, M.Behave.setProp(def('lava'), 'level', '7'));  // 1/9 tall: 6.111 < 6.834
    ok(St.mount(s4) === true, 'low flowing lava (level 7) at eye height does NOT refuse');
    Mnt.dismount(s4);
    W.setBlock(16, 6, 16, M.Behave.setProp(def('lava'), 'level', '1'));       // 7/9: 6.778 < 6.834
    ok(St.mount(s4) === true, 'flowing lava level 1 (surface below probe) does NOT refuse');
    W.setBlock(16, 6, 16, 0);
  }

  // breeding food (warped_fungus) does NOT mount
  const s2 = EL.spawn('strider', 18, 5, 18, { noRider: true });
  St.saddle(s2);
  const fungusStack = Iv.stack('warped_fungus', 1);
  Use.entityUse(mkClickPlayer(), s2, fungusStack);
  okAv(s2.rider !== 'player', 'holding the strider\'s own breeding food (warped_fungus) does NOT mount it');
  const r2 = Use.entityUse(mkClickPlayer(), s2, null);
  ok(r2 === true && s2.rider === 'player', 'an EMPTY-hand click on a saddled strider mounts it');
  Mnt.dismount(s2);
  Use.entityUse(mkClickPlayer({ crouching: true }), s2, null);
  ok(s2.rider !== 'player', 'sneaking suppresses the mount');
}

// ============ 5. canBeControlledByRider =======================================================
{
  say('\n§5 Strider.canBeControlledByRider -- warped fungus on a stick, either hand');
  const P = freshPlayer();
  const s = EL.spawn('strider', 20, 5, 20, { noRider: true });
  St.saddle(s); St.mount(s);
  ok(St.canBeControlledByRider(s) === false, 'an empty-handed rider cannot control it');
  const wfStack = Iv.stack('warped_fungus_on_a_stick', 1);
  Iv.setItem(P.inventory, P.slot, wfStack);
  ok(St.canBeControlledByRider(s) === true, 'holding it in the MAIN hand allows control');
  Iv.setItem(P.inventory, P.slot, null);
  const wfStack40 = Iv.stack('warped_fungus_on_a_stick', 1);
  Iv.setItem(P.inventory, 40, wfStack40);
  ok(St.canBeControlledByRider(s) === true, 'holding it in the OFFHAND slot (40) also allows control');
  Iv.setItem(P.inventory, 40, null);
  okAv(St.canBeControlledByRider(s) === false, 'and refuses once emptied');
}

// ============ 6. EL.tickMob dispatch + Strider.travel =========================================
{
  say('\n§6 EL.tickMob dispatch + Strider.travel');
  const P = freshPlayer();
  const s = EL.spawn('strider', 22, 5, 22, { noRider: true });
  St.saddle(s); St.mount(s);

  s.mobSpeed = 0.111; s.zza = 0.222; s.yaw = 0; s.riderInput = { yaw: 2, pitch: 1 };
  St.travel(s, Math.random);
  const attr0 = M.Entities.attrsOf('strider').speed;
  St.setCold(s, false); St.travel(s, Math.random);
  const warmSp = s.mobSpeed;
  near(warmSp, attr0, 1e-9, 'uncontrolled warm: mobSpeed = getSpeed() = attr (#936)');
  ok(s.zza === 0.222, 'uncontrolled: zza left alone');
  s.mobSpeed = 0.111; St.setCold(s, true); St.travel(s, Math.random);
  okAv(Math.abs(s.mobSpeed / warmSp - 0.66) < 1e-6, 'uncontrolled cold/warm speed ratio is 0.66 through Strider.travel (#936)');
  St.setCold(s, false);
  ok(s.yaw === 0, 'and does not sync yaw either');

  const wfStack6 = Iv.stack('warped_fungus_on_a_stick', 1);
  Iv.setItem(P.inventory, P.slot, wfStack6);
  s.riderInput = { yaw: 1.2, pitch: 0.6 };
  St.setCold(s, false);
  St.travel(s, Math.random);
  ok(s.yaw === 1.2, 'controlled: yaw synced from the rider');
  near(s.pitch, 0.3, 1e-9, 'controlled: pitch halved');
  ok(s.zza === 1, 'controlled: zza pinned to 1 (always full forward)');
  ok(s.stepHeight === 1.0 && s.bodyYaw === 1.2 && s.headYaw === 1.2, '#4476 controlled: stepHeight 1.0 and bodyYaw=headYaw=rider yaw (ItemSteerable.travel)');
  near(s.airStrafingSpeed, s.mobSpeed * 0.1, 1e-9, '#4476 controlled: airStrafingSpeed = movementSpeed*0.1');
  okAv(s.stepHeight !== 0.6, '#4476 controlled stepHeight is not the default');
  const attr = M.Entities.attrsOf('strider').speed;
  near(s.mobSpeed, attr * 0.55, 1e-9, 'controlled, unboosted, warm: getSaddledSpeed() off the real attribute');
  Iv.setItem(P.inventory, P.slot, null);

  let calledHorseStyle = 0;
  const realTravelRidden = Mnt.travelRidden;
  Mnt.travelRidden = function () { calledHorseStyle++; };
  const s3 = EL.spawn('strider', 24, 5, 24, { noRider: true });
  St.saddle(s3); St.mount(s3);
  EL.tickMob(s3);
  okAv(calledHorseStyle === 0, 'EL.tickMob routes a saddled ridden STRIDER to Strider.travel, never Mount.travelRidden');
  Mnt.travelRidden = realTravelRidden;
}

// ============ 7. Use.striderBoostOnAStick ======================================================
{
  say('\n§7 Use.striderBoostOnAStick -- warped_fungus_on_a_stick durability (100 max, 1/use)');
  const P = freshPlayer();
  const s = EL.spawn('strider', 30, 5, 30, { noRider: true });
  St.saddle(s); St.mount(s);
  P.vehicle = s;
  const stack = Iv.stack('warped_fungus_on_a_stick', 1);
  const maxDur = IT.durability[stack.i | 0];
  ok(maxDur === 100, `warped_fungus_on_a_stick's own durability is 100, NOT carrot's 25 (got ${maxDur})`);

  okAv(Use.striderBoostOnAStick(P, stack) === false, 'refuses when the rider is not actually holding the boost stack');
  Iv.setItem(P.inventory, P.slot, stack);
  ok(Use.striderBoostOnAStick(P, stack) === true, 'boosts once the rider holds the warped fungus on a stick');
  ok(s.boosted === true, 'and the strider is now boosted (the SAME Passive.pigBoost state, reused)');
  ok(stack.d === 1, `the stack took exactly 1 damage (NOT carrot's own 7, got ${stack.d})`);
  okAv(Use.striderBoostOnAStick(P, stack) === false, 'a second boost attempt mid-boost refuses');

  const notStrider = EL.spawn('cow', 40, 5, 40);
  const P2 = mkClickPlayer({ vehicle: notStrider });
  const stack2 = Iv.stack('warped_fungus_on_a_stick', 1);
  Iv.setItem(P2.inventory, P2.slot, stack2);
  okAv(Use.striderBoostOnAStick(P2, stack2) === false, 'no vehicle-is-a-strider, no boost');
}

// ============ 8. natural-spawn rider rolls =====================================================
{
  say('\n§8 Strider.rollRider -- 1/30 zombie rider, else 1/10 baby strider rider');
  // roll1 == 0 -> zombie rider, saddled + equipped + mounted
  {
    const s = EL.spawn('strider', 50, 5, 50, { noRider: true });
    s.yaw = 77;
    let n = 0; const r = () => (n++ === 0 ? 0 : 0.9);   // first draw (roll1) hits 0/30
    const rider = St.rollRider(s, r);
    ok(rider && rider.yaw === 77 && rider.pitch === 0, 'initializeRider: the rider takes the strider yaw and pitch 0');
    ok(rider && rider.type === 'zombie', 'roll1==0 spawns a ZOMBIE rider');
    ok(s.saddled === true, 'and saddles the strider it rides');
    ok(rider.vehicle === s, 'the zombie is actually mounted on the strider');
    const eq = M.Equip.getEquipped(rider, IT.MAINHAND);
    ok(eq && IT.nameOf(eq.i | 0) === 'warped_fungus_on_a_stick', 'holding a warped fungus on a stick in its main hand');
  }
  // roll1 != 0, roll2 == 0 -> a baby strider rider
  {
    const s = EL.spawn('strider', 52, 5, 52, { noRider: true });
    let n = 0; const r = () => (n++ === 0 ? 0.5 : 0);   // roll1 misses, roll2 hits
    const rider = St.rollRider(s, r);
    ok(rider && rider.type === 'strider', 'roll1 miss, roll2==0 spawns a SECOND (baby) strider');
    ok((rider.growAge | 0) < 0, 'and it really is a BABY (growAge < 0)');
    ok(rider.vehicle === s, 'riding the adult strider');
    okAv(s.saddled !== true, 'this branch does NOT saddle the adult (only the zombie-rider branch does)');
  }
  // neither roll hits
  {
    const s = EL.spawn('strider', 54, 5, 54, { noRider: true });
    const rider = St.rollRider(s, () => 0.99);
    okAv(rider === null, 'both rolls missing spawns no rider at all');
  }
  // a BABY strider never rolls a rider of its own
  {
    const baby = EL.spawn('strider', 56, 5, 56, { noRider: true });
    baby.growAge = -24000;
    okAv(St.rollRider(baby, () => 0) === null, 'a baby strider (isBaby()) never rolls a rider -- initialize() returns early on it');
  }
  // the init-table entry itself: EL.spawn('strider', ...) with no opts rolls, WITH
  // opts.growAge (a reload) or opts.noRider does not
  {
    let calls = 0;
    const real = St.rollRider;
    St.rollRider = function () { calls++; return real.apply(St, arguments); };
    EL.spawn('strider', 60, 5, 60);
    ok(calls === 1, 'EL.spawn(\'strider\', ...) with no opts rolls exactly once via the init-table entry');
    EL.spawn('strider', 61, 5, 61, { mobNbtRestore: true });
    okAv(calls === 1, 'a RESTORE (opts.mobNbtRestore) does NOT re-roll a second passenger');
    EL.spawn('strider', 62, 5, 62, { noRider: true });
    okAv(calls === 1, 'opts.noRider also suppresses the roll (the recursion guard rollRider itself uses)');
    St.rollRider = real;
  }
}

// ============ 9. NBT save/restore ==============================================================
{
  say('\n§9 Mb.fieldsFor(\'strider\') + save/restore round trip');
  const Mb = M.MobNbt;
  ok(Mb.fieldsFor('strider').indexOf('saddled') >= 0, 'saddled is a persisted field for strider');
  const s = EL.spawn('strider', 70, 5, 70, { noRider: true });
  St.saddle(s); St.mount(s);
  // isolate: this NBT round trip is about STRIDER specifically, not the many other entities
  // every earlier section left in EL.list -- serialize/restore only this one strider.
  EL.list = [s];
  const rec = Mb.serializeAll();
  ok(rec.length === 1 && rec[0].type === 'strider', 'serializeAll captured exactly this one strider record');
  EL.list = [];
  const restored = Mb.restoreAll(rec);
  ok(restored === rec.length, `restoreAll restored all ${rec.length} record(s)`);
  const backS = EL.list.find((e) => e && e.type === 'strider');
  ok(backS && backS.saddled === true, 'the restored strider is still saddled');
  okAv(backS && backS.rider !== 'player', 'a saved e.rider === \'player\' is NOT itself restored (no live player to re-seat) -- a fresh spawn is never re-ridden by a phantom rider');
}

// ============ 10. cold render: shaking + strider_cold skin (#932) ===============================
{
  say('\n§10 ER.isShaking(strider) == isCold; renderer selects strider_cold');
  const ER = M.EntityRender;
  const s = EL.spawn('strider', 80, 5, 80, { noRider: true });
  St.setCold(s, true);
  ok(ER.isShaking(s) === true, 'a cold strider shakes (StriderEntityRenderer.isShaking = isCold)');
  s.age = 0;
  okAv(ER.bodyYawAt(s, 1) !== ER.yawAt(s, 1), 'bodyYawAt applies the shake yaw to a cold strider');
  St.setCold(s, false);
  okAv(ER.isShaking(s) === false, 'a warm strider does not shake');
  const src = readFileSync(join(MCLITE_ROOT, 'src', '07j_entityrender.js'), 'utf8');
  ok(/e\.type === 'strider'[^\n]*Strider\.isCold\(e\)\) texKey = 'strider_cold'/.test(src), 'renderer picks texKey strider_cold for a cold strider');
  const g = rdj('mob-geometry.json');
  okAv(Array.isArray(g.layers.strider_cold) && g.layers.strider_cold.length === g.layers.strider.length, 'strider_cold layer baked with the strider box list');
}

// ============ 11. walks on lava (#937) ==========================================================
{
  say('\n§11 StriderEntity.canWalkOnFluid(lava) -- updateFloating + FluidBlock slab collision');
  const Ph = M.Physics;
  const lavaAt = (x, y, z) => W.setBlock(x, y, z, def('lava'));
  for (let x = 46; x <= 54; x++) for (let z = 46; z <= 54; z++) { lavaAt(x, 4, z); lavaAt(x, 3, z); lavaAt(x, 2, z); W.setBlock(x, 1, z, def('stone')); }
  const run = () => {
    const s = EL.spawn('strider', 50.5, 5.2, 50.5, { noRider: true });
    for (let i = 0; i < 60; i++) { Ph.updateFluids(s); s.zza = 0; Ph.travelMob(s); }
    return s;
  };
  const s = run();
  // lava source at y=4: slab top 4.5
  near(s.y, 4.5, 0.02, 'a strider dropped on a lava source stands on its 0.5 slab (y 4.5)');
  ok(s.onGround === true, 'and is onGround');
  const realF = Ph.striderFloat, realM = Ph.moveOnLava;
  Ph.striderFloat = () => {}; Ph.moveOnLava = (e, a, b, c) => Ph.move(e, a, b, c);
  const sink = run();
  Ph.striderFloat = realF; Ph.moveOnLava = realM;
  okAv(sink.y < 4.2, 'anti-vacuity: with the lava walk disabled the same strider sinks (' + sink.y.toFixed(2) + ')');
  // submerged (lava above too): updateFloating nudges up 0.05 with v*0.5
  lavaAt(50, 5, 50);
  const d = EL.spawn('strider', 50.5, 4.6, 50.5, { noRider: true });
  d.vy = 0; Ph.updateFluids(d); Ph.striderFloat(d);
  near(d.vy, 0.05, 1e-9, 'submerged under lava: updateFloating gives v*0.5 + 0.05 up');
  W.setBlock(50, 5, 50, def('air'));
  // updateFloating tests the fluid TAG: flowing (level 3) lava under a strider standing above the slab is floor,
  // and a FALLING (level 8) lava cell above a source is lava above -> damp/+0.05, never onGround
  const lv = (n) => M.States.withLocal('lava', n);   // lava's only property is level 0..15
  const probe = (cellSt, aboveSt) => {
    W.setBlock(50, 4, 50, cellSt); W.setBlock(50, 5, 50, aboveSt);
    const f = EL.spawn('strider', 50.5, 4.7, 50.5, { noRider: true });
    f.vy = 0; f.onGround = false; f.inLava = true; Ph.striderFloat(f);
    return f;
  };
  ok(probe(lv(3), def('air')).onGround === true, 'strider over flowing (level 3) lava with air above: onGround');
  ok(probe(def('lava'), lv(8)).onGround === false, 'level-0 lava under FALLING lava: not onGround');
  ok(probe(def('lava'), lv(2)).onGround === false, 'level-0 lava under flowing lava: not onGround');
  okAv(probe(def('lava'), def('air')).onGround === true, 'anti-vacuity: source + air above still onGround');
  // collision slab (#3684): flowing/falling lava above a source removes the slab, so the strider falls through
  const slab = (aboveSt) => {
    W.setBlock(50, 4, 50, def('lava')); W.setBlock(50, 5, 50, aboveSt);
    const f = EL.spawn('strider', 50.5, 5.2, 50.5, { noRider: true });
    f.onGround = false; Ph.moveOnLava(f, 0, -1, 0);
    return f.y;
  };
  ok(slab(lv(8)) < 4.5, 'FALLING lava above a source: no slab, strider sinks past 4.5');
  ok(slab(lv(2)) < 4.5, 'flowing lava above a source: no slab');
  okAv(Math.abs(slab(def('air')) - 4.5) < 0.02, 'anti-vacuity: air above still gives the 4.5 slab');
  W.setBlock(50, 4, 50, def('lava')); W.setBlock(50, 5, 50, def('air'));
}

// ============ 12. dismount search (#1197) =======================================================
{
  say('\n§12 StriderEntity.updatePassengerForDismount -- skips lava cells, stands on the rim');
  const Ph = M.Physics;
  for (let x = 66; x <= 74; x++) for (let z = 66; z <= 74; z++) for (let y = 1; y <= 5; y++) W.setBlock(x, y, z, def('air'));
  for (let x = 66; x <= 74; x++) for (let z = 66; z <= 74; z++) W.setBlock(x, 3, z, def('stone'));
  const s = EL.spawn('strider', 70.5, 4, 70.5, { noRider: true });
  const p0 = St.findDismountPos(s, 0.6, 0, Ph);
  ok(Math.floor(p0.y) === 4 && p0.z > 70.5, 'dry rim: rider steps off on the yaw-0 side at floor level (' + JSON.stringify(p0) + ')');
  // lava in the yaw-0 landing column: the search must skip it
  W.setBlock(Math.floor(p0.x), 4, Math.floor(p0.z), def('lava'));
  const p1 = St.findDismountPos(s, 0.6, 0, Ph);
  ok(!(Math.floor(p1.x) === Math.floor(p0.x) && Math.floor(p1.z) === Math.floor(p0.z) && Math.floor(p1.y) === 4), 'a lava cell is never chosen as the dismount cell');
  const real = St.blockIdAt; St.blockIdAt = () => -1;
  const p2 = St.findDismountPos(s, 0.6, 0, Ph);
  St.blockIdAt = real;
  okAv(Math.floor(p2.x) === Math.floor(p0.x) && Math.floor(p2.z) === Math.floor(p0.z), 'anti-vacuity: with the lava test disabled the lava cell is chosen');
  W.setBlock(Math.floor(p0.x), 4, Math.floor(p0.z), def('air'));
  // spawn above lava rule
  const Sp = M.Spawn;
  for (let y = 4; y <= 6; y++) W.setBlock(80, y, 80, def('lava'));
  W.setBlock(80, 7, 80, def('air'));
  ok(Sp.RULES.strider(80, 4, 80) === true, 'strider spawn walks up through lava and reaches air');
  W.setBlock(80, 7, 80, def('stone'));
  ok(Sp.RULES.strider(80, 4, 80) === false, 'lava column capped by stone refuses');
  const lo = St.leashOffset();
  ok(lo.x === 0 && Math.abs(lo.y - 0.6 * 1.7 * 0.85) < 1e-5 && Math.abs(lo.z - 0.9 * 0.4) < 1e-5, 'getLeashOffset = (0, 0.6*eyeHeight, width*0.4) (' + JSON.stringify(lo) + ')');
  const realW = M.Entities.width; M.Entities.width = () => 2;
  okAv(Math.abs(St.leashOffset().z - 0.36) > 1e-3, 'anti-vacuity: a wrong width breaks the leash offset');
  // getDismountHeight: a carpet / bottom slab in the ring is stood ON (y = cell + top), cell-centred
  const cx = Math.floor(p0.x), cz = Math.floor(p0.z);
  W.setBlock(cx, 4, cz, def('white_carpet'));
  const pc = St.findDismountPos(s, 0.6, 0, Ph);
  ok(Math.abs(pc.y - 4.0625) < 1e-3 && pc.x === cx + 0.5 && pc.z === cz + 0.5 && pc.pose === 'standing', 'carpet: rider stands on its top (y 4.0625), cell centre, standing pose (' + JSON.stringify(pc) + ')');
  W.setBlock(cx, 4, cz, def('stone_slab'));
  const ps = St.findDismountPos(s, 0.6, 0, Ph);
  ok(Math.abs(ps.y - 4.5) < 1e-3 || !(ps.x === cx + 0.5 && ps.z === cz + 0.5), 'bottom slab: y 4.5 (' + JSON.stringify(ps) + ')');
  const realSA = Ph.shapeAt; Ph.shapeAt = (x, y, z) => realSA(x, y, z) ? Ph.FULL_CUBE : null;
  const pf = St.findDismountPos(s, 0.6, 0, Ph);
  Ph.shapeAt = realSA;
  okAv(!(Math.abs(pf.y - 4.0625) < 1e-3) , 'anti-vacuity: a full-cube view picks a different spot than the carpet height');
  W.setBlock(cx, 4, cz, def('air'));
  M.Entities.width = realW;
}

{ // #2797: hurtByWater() -> DROWN 1.0 per tick while wet
  const w = EL.spawn('strider', 40, 5, 40, { noRider: true });
  w.inWater = true; const h0 = w.health;
  St.tickEntity(w);
  ok(w.health === h0 - 1, 'strider in water loses 1.0 HP per tick (' + h0 + ' -> ' + w.health + ')');
  const d = EL.spawn('strider', 42, 5, 42, { noRider: true });
  d.inWater = false; const d0 = d.health; St.tickEntity(d);
  ok(d.health === d0, 'dry strider takes no damage');
  const real = M.SnowGolem.applyWaterDamage; M.SnowGolem.applyWaterDamage = () => {};
  const b = EL.spawn('strider', 44, 5, 44, { noRider: true }); b.inWater = true; const b0 = b.health; St.tickEntity(b);
  okAv(b.health === b0, 'anti-vacuity: without the water-damage branch the strider takes nothing');
  M.SnowGolem.applyWaterDamage = real;
}

{ // #3485: landing in lava is onLanding() only, no fall damage; dry land still hurts
  const l = EL.spawn('strider', 46, 5, 46, { noRider: true });
  l.inLava = true; M.Physics.landed(l, 20);
  ok(l.pendingFallDamage === 0, 'strider landing in lava takes no fall damage');
  const d = EL.spawn('strider', 48, 5, 48, { noRider: true });
  d.inLava = false; M.Physics.landed(d, 20);
  okAv(d.pendingFallDamage > 0, 'anti-vacuity: on dry land the same drop hurts (' + d.pendingFallDamage + ')');
}

{ // #4655: StriderEntity.initialize's fresh PassiveData(0.5F) has spawnedCount 0 -- a pack member is never a baby
  const count = idx => { let n = 0; for (let i = 0; i < 400; i++) { const x = EL.spawn('strider', 60, 5, 60, { spawnIdx: idx }); if (x && x.growAge < 0 && !x.passengers) n++; } return n; };
  ok(count(1) === 0, 'strider spawnIdx>0 is never a baby');
  const forced = EL.spawn('strider', 60, 5, 60, { spawnIdx: 1, noRider: true }); M.Breed.setBaby(forced, true);
  okAv(forced.growAge < 0, 'anti-vacuity: the counter sees a baby when one exists');
}

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${breaks} breaks caught, ${fails.length} failed`);
console.log(`${pass + fails.length} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
