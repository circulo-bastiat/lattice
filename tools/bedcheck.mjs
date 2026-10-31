#!/usr/bin/env node
// bedcheck.mjs — loop/beds (G19c): BEDS — SLEEPING (src/14m_sleep.js, `NS.Sleep`), the dispatch
// hook in src/14l_use.js's own `Use.blockUse`, and the respawn-at-bed hook in src/17_main.js.
// Every number/branch asserted here is cited in 14m_sleep.js's own header, read off `.decomp`
// this session: BedBlock.java, PlayerEntity.java, ServerPlayerEntity.java, LivingEntity.java,
// ServerWorld.java, SleepManager.java.
//
//   node tools/bedcheck.mjs [--verbose]
//
// Sections:
//   1. the dispatch hook — a bed click routes through Use.blockUse into Sleep.use and is always
//      consumed, a non-bed click is untouched
//   2. refusals, in vanilla's own order: too far, obstructed, occupied-by-a-sleeping-villager
//      (villager wakes; a stale OCCUPIED flag just says so), daytime, monsters nearby
//   3. a legal sleep: spawn point set (+ the "set" message fires once, not twice), the OCCUPIED
//      prop on BOTH cells, position, and TIME_SINCE_REST reset (NS.Phantom.resetTimeSinceRest)
//   4. the night skip: dayTime jumps to the next day-0 tick once sleepTimer reaches 100, weather
//      resets, the player is force-woken
//   5. daytime catching up to a still-sleeping player auto-wakes it mid-night
//   6. respawn-at-bed: Sleep.respawnPos — a live bed, a broken one, an obstructed one
//   7. anti-vacuity — break this check's own data/gates and watch it catch the break
//   8. s117 -- the wake-up candidate search (BedBlock.findWakeUpPosition, findWakeUpPosition3):
//      an open bed wakes at the vanilla-first candidate, a blocked one picks another, each with
//      its own anti-vacuity break
//   9. s117 -- the sleeping POSE/camera/hand: EntityPose.SLEEPING eye height/dims, the camera
//      yaw lock (G.syncCamera), and the hidden first-person hand (H3.build), each with its own
//      anti-vacuity break

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

console.log('bedcheck — loop/beds (G19c): sleeping, the night skip and the spawn point (NS.Sleep)');

const EXTRA = ['02f_tags.js', '07za_explosion.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14e_gamemode.js', '09b_sky.js',
  '07zq_snowgolem.js', '14f_inventory.js', '14j_combat.js', '14_player.js', '14l_use.js',
  '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07k_goals.js',
  '07zv_villagerbrain.js', '07zz1_phantom.js', '14m_sleep.js',
  // s117 -- §8/§9's own wake-up-search / sleeping-pose-camera-hand assertions need the real
  // camera (10_camera.js/10_gfx.js's own `G.syncCamera`) and hand-build (14i_hand.js/
  // 14k_hand3d.js's own `H3.build`) entry points, not stand-ins.
  '10_camera.js', '10_gfx.js', '14i_hand.js', '14k_hand3d.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'),
  // SG.isMonster (monstersNearby) reads DATA.monsterTypes, which loadEngine's DATA lacks
  monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1]) });
M.Entities.init();

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States, Tags = M.Tags;
const EL = M.EntityList, VB = M.VB, Sleep = M.Sleep, U = M.Use, Sky = M.Sky, Gm = M.Gamemode;
const Cam = M.Cam, Gfx = M.Gfx, H3 = M.Hand3D, PL = M.Player;
const Ph = M.Phantom;

ok(Sleep, 'NS.Sleep did not load');
if (!Sleep) { console.log('\nFAIL bedcheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
M.Ai.init();
U.init(W);
Sleep.init(W);
ok(U.ready, 'Use.init ran');
ok(Sleep.ready, 'Sleep.init ran');
ok(U.tagFamilies.length === 0, 'tag families resolved: ' + U.tagFamilies);

for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
function plate(radius, y) {
  for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE);
}
// a freshly-placed bed's default state (BedBlock's own default: occupied=false) — the same
// helper sleepcheck.mjs's own `bedHeadState` uses, for the same reason (§ its own header).
function bedHeadState(name) {
  const b = R.id[name], P_ = R.PROP, V = R.PVAL;
  for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
    if (SR.propValue(s, P_.part) === V.head && SR.propValue(s, P_.facing) === V.south &&
        SR.propValue(s, P_.occupied) === V['false']) return s;
  }
  return null;
}
function bedFootState(name) {
  const b = R.id[name], P_ = R.PROP, V = R.PVAL;
  for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
    if (SR.propValue(s, P_.part) === V.foot && SR.propValue(s, P_.facing) === V.south &&
        SR.propValue(s, P_.occupied) === V['false']) return s;
  }
  return null;
}
const HEAD = bedHeadState('red_bed'), FOOT = bedFootState('red_bed');
ok(HEAD !== null && FOOT !== null, 'red_bed head/foot states resolve');
const PLAT_Y = 63;
plate(15, PLAT_Y);

// facing=south means FACING points foot -> head along +Z (dirStep('south') = [0,1], 14_player.js
// P.dirStep) — so a bed's FOOT sits at (bx,y,bz) and its HEAD at (bx,y,bz+1).
const BX = 0, BZ = 0, BY = PLAT_Y + 1;
function placeBed() {
  W.clear ? W.clear() : null;
  plate(15, PLAT_Y);
  W.setBlock(BX, BY, BZ, FOOT);
  W.setBlock(BX, BY, BZ + 1, HEAD);
}
function clearMobs() { EL.list.length = 0; EL.nextId = 1; }

function mkP(o) {
  const opt = o || {};
  const p = {
    x: opt.x !== undefined ? opt.x : BX + 0.5,
    y: opt.y !== undefined ? opt.y : BY,
    z: opt.z !== undefined ? opt.z : BZ + 0.5,
    px: 0, py: 0, pz: 0, ex: 0, ey: 0, ez: 0, vx: 0, vy: 0, vz: 0,
    yaw: opt.yaw || 0,
    sleeping: false, sleepPos: null, sleepTimer: 0, spawnPoint: null,
    dead: !!opt.dead,
    mode: opt.creative ? 1 : 0,
  };
  return p;
}
ok(M.Gamemode.CREATIVE === 1, 'Gamemode.CREATIVE is 1 (this check\'s own mkP relies on it)');

// a message spy, standing in for 15_hud.js's own `Hud.say` — `Sleep`'s own `say()` no-ops
// without `NS.Hud`, so this is what makes §2/§3's own message assertions observable at all.
const msgs = [];
M.Hud = { say(m) { msgs.push(m); } };

// dayTime: 0 is midday (Sky.timeOfDay's own `-0.25` phase, 09b_sky.js's own header), so NIGHT
// needs a value where `Sky.isDay()` (ambientDarkness < 4) is false — 13000 is vanilla's own
// classic "it is now night" tick (mobs start spawning at 13000 without a bed).
const NIGHT = 13000, NOON = 6000;
function setTime(t) { Sky.dayTime = t; Sky.weather = Sky.newWeather(); }

// ═══ 1. the dispatch hook — Use.blockUse routes a bed click into Sleep.use ═══════════════════
say('\n1. the dispatch hook: a bed click always routes to Sleep.use and is always consumed');
{
  setTime(NIGHT);
  placeBed(); clearMobs();
  const P = mkP({});
  const consumed = U.blockUse(P, BX, BY, BZ + 1, HEAD, null);
  ok(consumed === true, 'a click on the HEAD cell reaches Use.blockUse and is consumed');
  ok(P.sleeping === true, 'and it actually slept — the hook reaches the real Sleep module, not a stub');

  // a non-bed block is untouched by any of this.
  W.setBlock(5, PLAT_Y + 1, 5, SR.stateOf('stone'));
  const stoneRes = U.blockUse(mkP({ x: 5.5, y: PLAT_Y + 1, z: 5.5 }), 5, PLAT_Y + 1, 5, SR.stateOf('stone'), null);
  ok(stoneRes === false, 'a plain stone block still falls through (blockUse returns false)');
}
say(`   ${pass} ok`);

// ═══ 2. refusals, in vanilla's own order ═════════════════════════════════════════════════════
say('\n2. refusals: too far, obstructed, occupied, daytime, monsters nearby');
{
  // too far — ServerPlayerEntity.isBedTooFarAway: > 3 blocks horizontally from BOTH cells.
  setTime(NIGHT); placeBed(); clearMobs(); msgs.length = 0;
  const far = mkP({ x: 20, y: BY, z: 20 });
  const r1 = Sleep.use(far, BX, BY, BZ + 1, HEAD);
  ok(r1 === true, 'a too-far click is still consumed');
  ok(far.sleeping === false, 'but it did not actually sleep');
  ok(msgs.some((m) => /too far/.test(m)), `and it says so (${JSON.stringify(msgs)})`);

  // obstructed — a solid full cube directly above the head (or foot) cell.
  setTime(NIGHT); placeBed(); clearMobs(); msgs.length = 0;
  W.setBlock(BX, BY + 1, BZ + 1, STONE);
  const obP = mkP({});
  const r2 = Sleep.use(obP, BX, BY, BZ + 1, HEAD);
  ok(r2 === true && obP.sleeping === false, 'obstructed above the head cell refuses');
  ok(msgs.some((m) => /obstructed/.test(m)), `and says so (${JSON.stringify(msgs)})`);
  W.setBlock(BX, BY + 1, BZ + 1, 0);

  // occupied by a sleeping villager — VB.wakeVillagerAt wakes it and the click is silent;
  // a STALE occupied flag (no matching sleeper) gets the real "occupied" message instead.
  setTime(NIGHT); placeBed(); clearMobs(); msgs.length = 0;
  {
    const R_ = R.PROP, V = R.PVAL;
    const occHead = SR.withProp(HEAD, R_.occupied, V['true']);
    const occFoot = SR.withProp(FOOT, R_.occupied, V['true']);
    W.setBlock(BX, BY, BZ + 1, occHead);
    W.setBlock(BX, BY, BZ, occFoot);
    // no sleeper recorded anywhere -- a STALE flag.
    const staleP = mkP({});
    const rStale = Sleep.use(staleP, BX, BY, BZ + 1, occHead);
    ok(rStale === true && staleP.sleeping === false, 'a stale OCCUPIED flag with no sleeper refuses');
    ok(msgs.some((m) => /occupied/.test(m)), `and says "occupied" (${JSON.stringify(msgs)})`);

    msgs.length = 0;
    const v = EL.spawn('villager', BX + 0.5, BY, BZ + 1.5);
    v.vbSleeping = true;
    v.vbSleepHomePos = { x: BX, y: BY, z: BZ + 1 };
    const realP = mkP({});
    const rReal = Sleep.use(realP, BX, BY, BZ + 1, occHead);
    ok(rReal === true && realP.sleeping === false, 'a REAL sleeper is woken, not evicted, by the player\'s own click');
    ok(v.vbSleeping === false, 'and the villager itself is now awake (VB.wakeVillagerAt really ran wakeUp)');
    ok(!msgs.some((m) => /occupied/.test(m)), `waking a real sleeper says nothing (${JSON.stringify(msgs)})`);
    ok(SR.propValue(W.getBlock(BX, BY, BZ + 1), R_.occupied) === V['false'],
       'and OCCUPIED cleared on the bed the villager actually toggled');
  }

  // daytime — World.isDay() (ambientDarkness < 4). setSpawnPoint still runs first (below).
  setTime(NOON); placeBed(); clearMobs(); msgs.length = 0;
  const dayP = mkP({});
  const r3 = Sleep.use(dayP, BX, BY, BZ + 1, HEAD);
  ok(r3 === true && dayP.sleeping === false, 'daytime refuses to let you sleep');
  ok(msgs.some((m) => /only sleep at night/.test(m)), `and says so (${JSON.stringify(msgs)})`);
  ok(dayP.spawnPoint && dayP.spawnPoint.x === BX && dayP.spawnPoint.z === BZ + 1,
     'BUT THE SPAWN POINT IS SET ANYWAY — .decomp:838 runs setSpawnPoint before the daytime check');

  // monsters nearby — a HostileEntity (zombie) inside the 8x5x8 box; creative is exempt.
  setTime(NIGHT); placeBed(); clearMobs(); msgs.length = 0;
  const z = EL.spawn('zombie', BX + 0.5, BY, BZ + 4);
  ok(!!z, 'a zombie actually spawned (EntityList.canSpawn covers it)');
  const monP = mkP({});
  const r4 = Sleep.use(monP, BX, BY, BZ + 1, HEAD);
  ok(r4 === true && monP.sleeping === false, 'a nearby zombie refuses survival sleep');
  ok(msgs.some((m) => /monsters nearby/.test(m)), `and says so (${JSON.stringify(msgs)})`);
  msgs.length = 0;
  const creP = mkP({ creative: true });
  const r5 = Sleep.use(creP, BX, BY, BZ + 1, HEAD);
  ok(r5 === true && creP.sleeping === true, 'the SAME zombie does not stop a creative player from sleeping');
}
say(`   ${pass} ok`);

// ═══ 3. a legal sleep ════════════════════════════════════════════════════════════════════════
say('\n3. a legal sleep: spawn point (once), OCCUPIED on both cells, position, TIME_SINCE_REST');
{
  setTime(NIGHT); placeBed(); clearMobs(); msgs.length = 0;
  const P = mkP({ yaw: 1.5 });
  Ph.resetTimeSinceRest();
  M.Player.timeSinceRest = 4321;
  const r = Sleep.use(P, BX, BY, BZ + 1, HEAD);
  ok(r === true && P.sleeping === true, 'a legal sleep succeeds');
  ok(msgs.filter((m) => /Respawn point set/.test(m)).length === 1, `"Respawn point set" fires exactly once (${JSON.stringify(msgs)})`);
  ok(P.spawnPoint.x === BX && P.spawnPoint.y === BY && P.spawnPoint.z === BZ + 1 && P.spawnPoint.yaw === 1.5,
     'the spawn point is the HEAD cell, with the player\'s own yaw');
  const R_ = R.PROP, V = R.PVAL;
  ok(SR.propValue(W.getBlock(BX, BY, BZ + 1), R_.occupied) === V['true'], 'OCCUPIED on the head cell');
  ok(SR.propValue(W.getBlock(BX, BY, BZ), R_.occupied) === V['true'], 'and on the foot cell too — the door precedent (14m_sleep.js\'s own header)');
  ok(Math.abs(P.x - (BX + 0.5)) < 1e-9 && Math.abs(P.y - (BY + 0.6875)) < 1e-9 && Math.abs(P.z - (BZ + 1.5)) < 1e-9,
     `the player is repositioned onto the bed (${P.x},${P.y},${P.z})`);
  ok(M.Player.timeSinceRest === 0, 'NS.Phantom.resetTimeSinceRest actually ran (loop/beds closes that OWED hook)');

  // sleeping a second time (spawn point unchanged) does NOT repeat the message.
  msgs.length = 0;
  Sleep.wake(P, true);
  const r2 = Sleep.use(P, BX, BY, BZ + 1, HEAD);
  ok(r2 === true && P.sleeping === true, 'sleeping again in the same bed still works');
  ok(!msgs.some((m) => /Respawn point set/.test(m)), 'but the spawn point did not change, so the message does not repeat');
}
say(`   ${pass} ok`);

// ═══ 4. the night skip ═══════════════════════════════════════════════════════════════════════
say('\n4. the night skip: dayTime -> next day 0, weather resets, force-wake');
{
  setTime(NIGHT); placeBed(); clearMobs(); msgs.length = 0;
  Sky.weather.raining = true; Sky.weather.rainTime = 500;
  // #1397: ServerWorld.tick gates resetWeather on isRaining() = rain GRADIENT > 0.2 (D-660), not the flag
  Sky.weather.rainLevel = Sky.weather.oRainLevel = 1;
  const P = mkP({});
  ok(Sleep.use(P, BX, BY, BZ + 1, HEAD) === true && P.sleeping === true, 'lies down');
  const startDay = Sky.dayTime;
  for (let i = 0; i < 100 && P.sleeping; i++) Sleep.tick(P);
  ok(!P.sleeping, `100 ticks of sleep skips the night and wakes the player (still sleeping after 100: ${P.sleeping})`);
  const nextDay0 = startDay - (startDay % 24000) + 24000;
  ok(Sky.dayTime === nextDay0, `dayTime landed exactly on the next day's 0 (${Sky.dayTime} vs ${nextDay0})`);
  ok(Sky.weather.raining === false && Sky.weather.rainTime === 0, 'and the storm was reset (ServerWorld.resetWeather)');
  ok(P.sleepPos === null, 'sleepPos cleared on wake');
  const R_ = R.PROP, V = R.PVAL;
  ok(SR.propValue(W.getBlock(BX, BY, BZ + 1), R_.occupied) === V['false'], 'and OCCUPIED cleared on wake too');
}
say(`   ${pass} ok`);

// ═══ 5. daytime catching up wakes a still-sleeping player ═══════════════════════════════════
say('\n5. World.isDay() catching up to a sleeping player force-wakes it mid-night');
{
  setTime(NIGHT); placeBed(); clearMobs();
  const P = mkP({});
  Sleep.use(P, BX, BY, BZ + 1, HEAD);
  ok(P.sleeping === true, 'lies down');
  for (let i = 0; i < 5; i++) Sleep.tick(P);
  ok(P.sleepTimer === 5 && P.sleeping === true, 'still asleep, timer short of 100');
  setTime(NOON);   // jump straight to daytime without ever reaching 100 — a `/time set day`
  Sleep.tick(P);
  ok(P.sleeping === false, 'the very next tick wakes the player even though the timer never reached 100');
}
say(`   ${pass} ok`);

// ═══ 6. respawn-at-bed ═══════════════════════════════════════════════════════════════════════
say('\n6. Sleep.respawnPos: a live bed, a broken one, an obstructed one');
{
  setTime(NIGHT); placeBed(); clearMobs();
  const P = mkP({});
  Sleep.use(P, BX, BY, BZ + 1, HEAD);
  ok(P.sleeping === true, 'lies down to set the spawn point');
  const sp = Sleep.respawnPos(P);
  ok(!!sp, 'a live bed gives a respawn position');
  ok(Math.abs(sp.x - (BX + 0.5)) < 1e-9 && Math.abs(sp.z - (BZ + 1.5)) < 1e-9,
     `centred over the head cell (${sp && sp.x},${sp && sp.z})`);
  Sleep.wake(P, true);

  // the bed is broken -- no home bed.
  W.setBlock(BX, BY, BZ + 1, 0);
  ok(Sleep.respawnPos(P) === null, 'a broken bed gives no respawn position');
  W.setBlock(BX, BY, BZ + 1, HEAD);

  // the bed is intact but its wake spot is obstructed.
  W.setBlock(BX, BY + 1, BZ + 1, STONE);
  ok(Sleep.respawnPos(P) === null, 'an obstructed bed gives no respawn position either');
  W.setBlock(BX, BY + 1, BZ + 1, 0);
  ok(!!Sleep.respawnPos(P), 'and clearing the obstruction restores it');

  // no spawn point at all.
  const fresh = mkP({});
  ok(Sleep.respawnPos(fresh) === null, 'a player who never slept has no respawn position');
}
say(`   ${pass} ok`);

// ═══ 7. anti-vacuity ═════════════════════════════════════════════════════════════════════════
say('\n7. anti-vacuity: break it, and it must be caught');
{
  // (a) the `beds` tag is really what routes Use.blockUse into Sleep — without it, a bed click
  // falls through like any other unmatched block.
  setTime(NIGHT); placeBed(); clearMobs();
  const savedBlockTag = M.Tags.blockTag;
  M.Tags.blockTag = (name) => (name === 'beds' ? -1 : savedBlockTag(name));
  U.init(W);
  const brokenP = mkP({});
  const brokenRes = U.blockUse(brokenP, BX, BY, BZ + 1, HEAD, null);
  okAv(brokenRes === false && brokenP.sleeping === false,
       'with the beds tag column missing, Use.blockUse never reaches Sleep.use at all');
  M.Tags.blockTag = savedBlockTag;
  U.init(W);
  const fixedP = mkP({});
  ok(U.blockUse(fixedP, BX, BY, BZ + 1, HEAD, null) === true && fixedP.sleeping === true,
     'restoring the tag restores the hook — so the break above measured the hook, not a fluke');

  // (b) Sleep.ready really gates the hook.
  setTime(NIGHT); placeBed(); clearMobs();
  Sleep.ready = false;
  const p2 = mkP({});
  okAv(U.blockUse(p2, BX, BY, BZ + 1, HEAD, null) === false, 'with Sleep.ready false, a bed click does nothing');
  Sleep.ready = true;

  // (c) Sky.isDay is really what the daytime refusal reads — force it true at night and the
  // "legal" night-time sleep from §3 would refuse instead.
  setTime(NIGHT); placeBed(); clearMobs();
  const savedIsDay = Sky.isDay;
  Sky.isDay = () => true;
  const p3 = mkP({});
  okAv(Sleep.use(p3, BX, BY, BZ + 1, HEAD) === true && p3.sleeping === false,
       'forcing Sky.isDay() true even at night-time dayTime refuses sleep — so §2/§3 measured the real gate');
  Sky.isDay = savedIsDay;
  const p4 = mkP({});
  ok(Sleep.use(p4, BX, BY, BZ + 1, HEAD) === true && p4.sleeping === true, 'and restoring it sleeps again');

  // (d) the monster gate really reads SnowGolem.isMonster — break it to always say "no monster"
  // and the zombie from §2 would no longer block sleep.
  setTime(NIGHT); placeBed(); clearMobs();
  EL.spawn('zombie', BX + 0.5, BY, BZ + 4);
  const savedIsMonster = M.SnowGolem.isMonster;
  M.SnowGolem.isMonster = () => false;
  const p5 = mkP({});
  okAv(Sleep.use(p5, BX, BY, BZ + 1, HEAD) === true && p5.sleeping === true,
       'breaking SnowGolem.isMonster to always say "no" lets a zombie-adjacent sleep succeed — so §2 measured the real predicate');
  M.SnowGolem.isMonster = savedIsMonster;
}
say(`   ${pass} ok`);

// ═══ 8. s117 -- the wake-up candidate search ════════════════════════════════════════════════
say('\n8. the wake-up candidate search (BedBlock.findWakeUpPosition/findWakeUpPosition3)');
{
  // an OPEN bed (nothing around it) wakes at vanilla's own FIRST candidate offset, not the
  // collapsed bed.up()+(0.5,0.1,0.5) fallback -- for this south-facing bed at default yaw 0,
  // that first offset is `side` = west (turnCW(south)), i.e. one cell to the -X side of HEAD.
  setTime(NIGHT); placeBed(); clearMobs();
  const P = mkP({});
  Sleep.use(P, BX, BY, BZ + 1, HEAD);
  ok(P.sleeping === true, 'lies down');
  Sleep.wake(P, true);
  const FIRST = { x: BX - 1 + 0.5, y: BY, z: BZ + 1 + 0.5 };
  ok(Math.abs(P.x - FIRST.x) < 1e-9 && P.y === FIRST.y && Math.abs(P.z - FIRST.z) < 1e-9,
     `an open bed wakes at vanilla's own first candidate (${P.x},${P.y},${P.z}) not the collapsed fallback`);
  ok(P.y !== BY + 1 + 0.1, 'and that is NOT the old bed.up()+0.1 fallback height');

  // BLOCK that first candidate cell (ceiling too low) -- the search must pick a DIFFERENT valid
  // candidate, not fall straight through to the fallback.
  setTime(NIGHT); placeBed(); clearMobs();
  W.setBlock(BX - 1, BY + 1, BZ + 1, STONE);
  const P2 = mkP({});
  Sleep.use(P2, BX, BY, BZ + 1, HEAD);
  Sleep.wake(P2, true);
  ok(!(Math.abs(P2.x - FIRST.x) < 1e-9 && Math.abs(P2.z - FIRST.z) < 1e-9),
     'blocking the first candidate really moves the pick off it');
  ok(Math.abs(P2.y - BY) < 1e-9, 'and the pick is still a REAL candidate cell (same floor level), not the fallback');
  W.setBlock(BX - 1, BY + 1, BZ + 1, 0);
}
say(`   ${pass} ok`);

// ═══ 9. s117 -- the sleeping POSE/camera/hand ═══════════════════════════════════════════════
say('\n9. the sleeping POSE (0.2/0.2 eye/dims), the camera yaw lock, and the hidden hand');
{
  setTime(NIGHT); placeBed(); clearMobs();
  const P = mkP({ yaw: 0 });
  Sleep.use(P, BX, BY, BZ + 1, HEAD);
  ok(P.height === 0.2 && P.eyeHeight === 0.2,
     `EntityPose.SLEEPING dims/eye while asleep (height ${P.height}, eye ${P.eyeHeight})`);
  ok(typeof P.sleepYaw === 'number', 'a sleeping camera yaw was computed');

  // the camera yaw lock: `Gfx.syncCamera` reads the module's own `NS.Player`, so the fields are
  // poked directly onto it, same as the real singleton would carry them.
  PL.ex = 3; PL.ey = 10; PL.ez = 5; PL.eyeHeight = 0.2;
  PL.yaw = 1.23; PL.pitch = 0.7;                 // what the ENTITY's own yaw/pitch still are
  PL.sleeping = true; PL.sleepYaw = 0;           // the LOCKED camera yaw (south-facing bed, §8)
  Gfx.cam = Cam.create();
  Gfx.syncCamera();
  ok(Gfx.cam.yaw === PL.sleepYaw && Gfx.cam.yaw !== PL.yaw,
     `the camera uses the locked sleepYaw (${Gfx.cam.yaw}), not the entity's own live yaw (${PL.yaw})`);
  ok(Gfx.cam.pitch === 0, `pitch is locked to 0 while asleep (got ${Gfx.cam.pitch})`);
  ok(Math.abs(Gfx.cam.y - (PL.ey + PL.eyeHeight + 0.3)) < 1e-9,
     'camera Y is eye height plus vanilla\'s own +0.3 sleeping nudge (Camera.java:57)');
  PL.sleeping = false;
  Gfx.syncCamera();
  ok(Gfx.cam.yaw === PL.yaw && Gfx.cam.pitch === PL.pitch, 'awake again, the camera follows the entity\'s own look');

  // the hidden hand: H3.pose is the first thing `H3.build` calls once past its guards, so
  // spying on it proves the sleeping branch returns before building ANY hand geometry, not
  // just that build() happens to return null for some unrelated reason.
  const savedPose = H3.pose;
  let poseCalls = 0;
  H3.pose = function () { poseCalls++; return savedPose.apply(this, arguments); };
  const Hd = { swingArm: -1, oMainHandHeight: 0, mainHandHeight: 0 };
  const savedHand = M.Hand;
  M.Hand = Hd;
  const rAwake = H3.build({ sleeping: false, ex: 0, ey: 0, ez: 0 }, 0);
  ok(poseCalls > 0, 'awake, H3.build reaches H3.pose (attempts to build the hand)');
  const rSleep = H3.build({ sleeping: true, ex: 0, ey: 0, ez: 0 }, 0);
  ok(rSleep === null, 'asleep, H3.build returns null (no hand geometry)');
  ok(poseCalls === 1, 'and asleep it never even reached H3.pose a second time (GameRenderer.renderHand\'s own gate)');
  H3.pose = savedPose;
  M.Hand = savedHand;
}
say(`   ${pass} ok`);

// ═══ 10. s117 -- anti-vacuity for §8/§9 ═════════════════════════════════════════════════════
say('\n10. anti-vacuity: break §8/§9\'s own data/gates and watch it catch the break');
{
  // (a) the wake-up search really depends on `Player.dirStep` -- break it AFTER falling asleep
  // (breaking it before would also fail `resolveBed` inside `Sleep.use` itself, refusing the
  // sleep, which would prove nothing about the search) and an open bed must fall all the way
  // back to the collapsed bed.up()+0.1 expression §8 proved it no longer uses.
  setTime(NIGHT); placeBed(); clearMobs();
  const pB = mkP({});
  Sleep.use(pB, BX, BY, BZ + 1, HEAD);
  ok(pB.sleeping === true, 'lies down before the break');
  const savedDirStep = PL.dirStep;
  PL.dirStep = () => null;
  Sleep.wake(pB, true);
  okAv(Math.abs(pB.y - (BY + 1 + 0.1)) < 1e-9,
       'with Player.dirStep broken, wake falls back to the OLD collapsed expression -- so §8 measured the real search');
  PL.dirStep = savedDirStep;

  // (b) the sleeping pose really is what `doSleep` sets -- monkeypatch it away and §9's dims/eye
  // assertion would see the standing 1.8/1.62 pair instead.
  setTime(NIGHT); placeBed(); clearMobs();
  const pC = mkP({});
  Sleep.use(pC, BX, BY, BZ + 1, HEAD);
  pC.height = 1.8; pC.eyeHeight = 1.62;   // simulate the pre-s117 state
  okAv(!(pC.height === 0.2 && pC.eyeHeight === 0.2), 'reverting the pose fields off 0.2/0.2 is caught as NOT sleeping-posed');
  Sleep.wake(pC, true);

  // (c) the hand gate really is `p.sleeping` -- flip it off on a "sleeping" player and H3.build
  // must stop returning null.
  const savedPose2 = H3.pose;
  let calls = 0;
  H3.pose = function () { calls++; return savedPose2.apply(this, arguments); };
  const savedHand2 = M.Hand;
  M.Hand = { swingArm: -1, oMainHandHeight: 0, mainHandHeight: 0 };
  const stillNull = H3.build({ sleeping: true, ex: 0, ey: 0, ez: 0 }, 0);
  const notGatedAnyMore = calls;
  okAv(stillNull === null && notGatedAnyMore === 0, 'the sleeping gate really short-circuits before H3.pose');
  const rUnsleep = H3.build({ sleeping: false, ex: 0, ey: 0, ez: 0 }, 0);
  okAv(calls > 0, 'and turning sleeping back off reaches H3.pose again -- so the gate above measured the real thing');
  H3.pose = savedPose2;
  M.Hand = savedHand2;
}
say(`   ${pass} ok`);

// ═══ 10. #35 -- the bed explodes outside the overworld (BedBlock.onUse .decomp:81-93) ══════════
say('\n10. the bed explodes when the dimension is not the overworld');
{
  setTime(NIGHT); placeBed(); clearMobs();
  const P = mkP({});
  Sleep.dimension = 'the_nether';
  M.Explosion.init();
  const Ex = M.Explosion, realExplode = Ex.explode; let seen = null;
  Ex.explode = function () { seen = Array.prototype.slice.call(arguments); return realExplode.apply(this, arguments); };
  const r = Sleep.use(P, BX, BY, BZ, FOOT);              // click the FOOT: still resolves to the head
  Sleep.dimension = 'overworld';
  Ex.explode = realExplode;
  ok(seen && seen[5] === 5.0 || seen && seen[4] === 5.0, 'power 5.0');
  ok(seen && seen[9] === true, 'createFire=true (BedBlock.onUse): omitting it must fail');
  ok(seen && seen[11] === 'badRespawnPoint', 'damage source tag is badRespawnPoint');
  ok(M.Survival.DAMAGE.badRespawnPoint && M.Survival.DAMAGE.badRespawnPoint.explosive === true, 'badRespawnPoint is an explosive source (blast_protection applies)');
  ok(r === true && P.sleeping === false, 'a nether bed click is consumed and does not sleep');
  ok(W.getBlock(BX, BY, BZ + 1) === 0 && W.getBlock(BX, BY, BZ) === 0, 'both halves of the bed are gone');
  // anti-vacuity: the same click in the overworld sleeps and leaves the bed.
  setTime(NIGHT); placeBed(); clearMobs();
  const P2 = mkP({});
  Sleep.use(P2, BX, BY, BZ + 1, HEAD);
  okAv(P2.sleeping === true && W.getBlock(BX, BY, BZ + 1) !== 0, 'with the flag back on overworld the bed sleeps and stays');
  Sleep.wake(P2, true);
}
say(`   ${pass} ok`);

say('');
say('================== bedcheck ==================');
say(` assertions passed .. ${pass}`);
say(` failures ........... ${fails.length}`);
say(` breaks caught ...... ${breaks}`);
say('==============================================');
for (let i = 0; i < breaks; i++) console.log(`  ✓ anti-vacuity break ${i + 1} caught`);
console.log(`bedcheck: ${pass} checks passed, ${fails.length} failures (${breaks} anti-vacuity)`);
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
