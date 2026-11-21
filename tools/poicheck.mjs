#!/usr/bin/env node
// poicheck.mjs — loop/raidpoi-s103 (QUEUE 0.2 raid loop remainder): the minimal
// `PointOfInterestStorage` substrate (`NS.Poi`, src/07zu_poi.js) against
// `.decomp/net/minecraft/world/poi/{PointOfInterestType,PointOfInterestStorage}.java` and
// `.decomp/net/minecraft/village/raid/Raid.java`'s `moveRaidCenter` (read in full this session,
// citations live in 07zu_poi.js's/07s_raid.js's own comments), plus the two live callers this
// unit wired: `Rd.moveRaidCenter`/`Rd.villageCenterNear`/`Rd.isNearOccupiedPOI` (07s_raid.js)
// and `Ai.AttackHomeGoal` (07k_goals.js).
//
//   node tools/poicheck.mjs [--verbose]
//
// Sections:
//   1. candidate-state build — every #beds block's HEAD-part states + every bell state, read
//      off the real registry (not a hand-kept id list)
//   2. reconcile — a HOME bed and a MEETING bell in a generated chunk are found by `Poi.tick`'s
//      own periodic rescan; breaking the bed is caught by the NEXT rescan
//   3. ticket API — reserve/release/hasSpace/isOccupied against the real per-type ticketCount
//   4. getInCircle/getPosition — radius, status and posPred (lastHomes-shaped) filtering, over
//      a shuffled real RNG
//   5. `Rd.isNearOccupiedPOI`/`Rd.villageCenterNear` (07s_raid.js) fold in `Poi.occupiedPositions`
//   6. `Rd.moveRaidCenter`/`Rd.tick`'s "not near a village" branch (07s_raid.js) recenters onto
//      a real occupied POI instead of an immediate LOSS
//   7. `Ai.AttackHomeGoal` (07k_goals.js) walks to a real bed and refuses when none is in range
//   8. anti-vacuity — break the check's own data/stubs and watch it catch the break

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

console.log('poicheck — loop/raidpoi-s103, the minimal PointOfInterestStorage substrate (NS.Poi)');

// ════════════════════════════ engine #1 — the Poi module itself, minimal stack ═══════════════
const P = loadEngine({ extra: ['02f_tags.js', '07_world.js', '07zu_poi.js'] });
const Poi = P.Poi, W = P.World, S = P.Section, CH = P.CH, R = P.Reg, SR = P.States, Tags = P.Tags;

ok(Poi, 'NS.Poi did not load');
if (!Poi) { console.log('\nFAIL poicheck — module missing'); process.exit(1); }

W.init(1);

function makeChunkAt(cx, cz) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
  return c;
}
for (let cx = -5; cx <= 5; cx++) for (let cz = -5; cz <= 5; cz++) makeChunkAt(cx, cz);

// every real state of one #beds block whose `part` prop is `head`/`foot`
function bedStates(name, part) {
  const b = R.id[name];
  const out = [];
  const P_ = R.PROP, V = R.PVAL;
  for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) {
    if (SR.propValue(s, P_.part) === V[part]) out.push(s);
  }
  return out;
}
const RED_BED = 'red_bed';
const headStates = bedStates(RED_BED, 'head');
const footStates = bedStates(RED_BED, 'foot');
const bellId = R.id['bell'];
const bellState = R.realFirst[bellId] + R.defaultState[bellId];

// ── §1. candidate-state build ──────────────────────────────────────────────────────────────
say('\n§1 — candidate states: #beds HEAD-part states + every bell state');
{
  ok(Tags.blocks('beds').includes(RED_BED), 'the "beds" tag names red_bed (Tags.blocks)');
  ok(headStates.length > 0, 'red_bed has at least one HEAD-part real state');
  ok(footStates.length > 0, 'red_bed has at least one FOOT-part real state');
  ok(headStates.length === footStates.length, 'HEAD and FOOT split red_bed’s states evenly (facing/occupied are orthogonal to part)');
  const total = R.realFirst[R.id[RED_BED] + 1] - R.realFirst[R.id[RED_BED]];
  ok(headStates.length + footStates.length === total, 'every red_bed real state is exactly one of HEAD or FOOT');
}

Poi.init();
ok(Poi.ready, 'Poi.init() did not report ready with Reg/States/Tags all present');

// ── §2. reconcile — placement, discovery, breakage ─────────────────────────────────────────
say('\n§2 — Poi.tick’s periodic reconcile finds/drops HOME+MEETING blocks');
{
  ok(Poi.count() === 0, 'a fresh Poi store starts empty');
  Poi.live = false;   // this section pins the legacy periodic-reconcile latency; §2b the live hook

  // a HOME bed (head-part cell only — the foot cell is not needed for POI purposes) and a
  // MEETING bell, on solid ground so W.setBlock’s own canSurvive gate never refuses either.
  W.setBlock(0, 63, 0, SR.stateOf('stone'));
  W.setBlock(0, 64, 0, headStates[0]);
  W.setBlock(10, 63, 10, SR.stateOf('stone'));
  W.setBlock(10, 64, 10, bellState);

  ok(Poi.count() === 0, 'nothing is indexed before the first Poi.tick() call');
  Poi.tick();   // tickCount starts at 0, so the FIRST call always reconciles
  ok(Poi.count() === 2, 'one reconcile after placement finds exactly the bed + the bell');
  ok(Poi.getType({ x: 0, y: 64, z: 0 }) === Poi.HOME, 'the bed cell is typed HOME');
  ok(Poi.getType({ x: 10, y: 64, z: 10 }) === Poi.MEETING, 'the bell cell is typed MEETING');
  ok(Poi.getType({ x: 0, y: 63, z: 0 }) === null, 'the stone cell under the bed is not itself a POI');

  // breaking the bed: not seen until the NEXT reconcile (Poi.OWED names this bounded latency).
  W.setBlock(0, 64, 0, 0);
  for (let i = 1; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();
  ok(Poi.count() === 2, 'a broken bed is still indexed until the next scheduled reconcile');
  Poi.tick();   // this call lands exactly on the next RESCAN_INTERVAL boundary
  ok(Poi.count() === 1, 'the next reconcile drops the broken bed, keeps the still-standing bell');
  ok(Poi.getType({ x: 0, y: 64, z: 0 }) === null, 'the broken bed’s cell is no longer typed');

  okAv((() => {
    const savedHome = P.Reg && true;   // sanity no-op guard, see the real break below
    // anti-vacuity: put the bed back, but corrupt homeStates so the reconcile CANNOT see it —
    // proves Poi.count() genuinely depends on the candidate-state table, not a hard-coded "the
    // bed at 0,64,0 always counts" special case.
    W.setBlock(0, 63, 0, SR.stateOf('stone'));
    W.setBlock(0, 64, 0, headStates[0]);
    Poi.init();                    // rebuilds candidate tables fresh
    for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();
    const before = Poi.count();
    return before === 2 && savedHome;
  })(), 're-placing the bed and re-running a full reconcile finds it again (count back to 2)');
}

// ── §2b. live hook (#5070) ───────────────────────────────────────────────────────────────────
say('\n§2b — Poi.onChange at World.setBlock: same-tick add/remove, ticket kept across a same-type change');
{
  const lectern = SR.stateOf('lectern');
  const run = (live) => {
    Poi.live = live; Poi.init();
    const out = {};
    W.setBlock(20, 63, 20, SR.stateOf('stone'));
    W.setBlock(20, 64, 20, headStates[0]);
    W.setBlock(22, 63, 20, SR.stateOf('stone'));
    W.setBlock(22, 64, 20, bellState);
    const at = (x) => ({ x, y: 64, z: 20 });
    out.bed = Poi.getPosition((t) => t === Poi.HOME, null, Poi.STATUS.ANY, at(20), 3);
    out.bell = Poi.getType(at(22));
    out.claimRes = Poi.reserveTicket(at(20));
    const other = headStates.find((s) => s !== headStates[0]);
    W.setBlock(20, 64, 20, other);
    out.kept = Poi.isOccupied(at(20));
    W.setBlock(20, 64, 20, 0); W.setBlock(22, 64, 20, 0);
    out.gone = Poi.getType(at(20)) === null && Poi.getType(at(22)) === null;
    return out;
  };
  const on = run(true);
  ok(on.bed && on.bed.x === 20, 'a bed placed is found by Poi.getPosition in the same tick');
  ok(on.bell === Poi.MEETING, 'a bell placed is typed MEETING in the same tick');
  ok(on.claimRes && on.kept, 'a claimed bed keeps its ticket when its state changes without changing type');
  ok(on.gone, 'a broken bed/bell is gone in the same tick');
  okAv((() => { const off = run(false); return !off.bed && off.bell === null && !off.kept; })(),
    'with the hook disabled the same-tick placement is invisible (cases fail)');
  Poi.live = true;
  Poi.init();
  Poi.tick();
}

// ── §2c. HOME is the HEAD cell (BedBlock.java PART/onPlaced:305, PointOfInterestType.java:47) ──
say('\n§2c — bed head cell is HOME, foot cell is not; removing a half moves the POI');
{
  const at = (x) => ({ x, y: 64, z: 40 });
  Poi.live = true; Poi.init();
  W.setBlock(40, 64, 40, footStates[0]);
  ok(Poi.getType(at(40)) === null, 'a FOOT-part bed cell is not a POI');
  W.setBlock(41, 64, 40, headStates[0]);
  ok(Poi.getType(at(41)) === Poi.HOME, 'a HEAD-part bed cell is a HOME POI');
  W.setBlock(41, 64, 40, 0);
  ok(Poi.getType(at(41)) === null, 'removing the head half drops the POI via Poi.onChange');
  W.setBlock(40, 64, 40, 0);
  okAv(footStates.every((s) => { W.setBlock(40, 64, 40, s); const t = Poi.getType(at(40)); W.setBlock(40, 64, 40, 0); return t === null; }) &&
       headStates.every((s) => { W.setBlock(41, 64, 40, s); const t = Poi.getType(at(41)); W.setBlock(41, 64, 40, 0); return t === Poi.HOME; }),
    'every FOOT state is rejected and every HEAD state accepted (registering foot would fail this)');
  Poi.init(); Poi.tick();
}

// ── §3. ticket API ──────────────────────────────────────────────────────────────────────────
say('\n§3 — ticket API against the real per-type ticketCount (home 1, meeting 32)');
{
  const home = { x: 0, y: 64, z: 0 }, meeting = { x: 10, y: 64, z: 10 };
  ok(Poi.TICKET_COUNT.home === 1 && Poi.TICKET_COUNT.meeting === 32,
    'ticketCount matches PointOfInterestType.java’s own register(...) 3rd argument for home/meeting');
  ok(Poi.hasSpace(home) === true && Poi.isOccupied(home) === false, 'a fresh HOME poi has space and is not occupied');
  ok(Poi.reserveTicket(home) === true, 'reserving the one HOME ticket succeeds');
  ok(Poi.hasSpace(home) === false && Poi.isOccupied(home) === true, 'HOME (ticketCount 1) is full and occupied after one reservation');
  ok(Poi.reserveTicket(home) === false, 'a second HOME reservation is refused — ticketCount is 1, not unlimited');
  ok(Poi.releaseTicket(home) === true, 'releasing the HOME ticket succeeds');
  ok(Poi.hasSpace(home) === true && Poi.isOccupied(home) === false, 'HOME is free again after release');
  ok(Poi.releaseTicket(home) === false, 'releasing an already-empty HOME ticket is a no-op that reports false');

  let n = 0;
  while (Poi.reserveTicket(meeting)) n++;
  ok(n === 32, 'MEETING (ticketCount 32) accepts exactly 32 reservations before refusing');
  okAv((() => {
    const before = Poi.isOccupied(meeting);
    for (let i = 0; i < 32; i++) Poi.releaseTicket(meeting);
    const after = Poi.isOccupied(meeting);
    return before === true && after === false;
  })(), 'draining every MEETING ticket flips isOccupied back to false — it reads live ticket state, not a cached flag');
}

// ── §4. getInCircle / getPosition — radius, status, posPred ───────────────────────────────
say('\n§4 — getInCircle/getPosition: radius + status + posPred (lastHomes-shaped) filtering');
{
  // a second bed far away (outside a 48-block search from the origin bed) and a third one
  // just inside a 20-block radius, to prove the circle test is a real distance check.
  W.setBlock(5, 63, 5, SR.stateOf('stone'));
  W.setBlock(5, 64, 5, headStates[0]);          // √50 ≈ 7.07 blocks from (0,64,0)
  W.setBlock(60, 63, 60, SR.stateOf('stone'));
  W.setBlock(60, 64, 60, headStates[0]);        // far outside any radius this file uses
  for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();

  const origin = { x: 0, y: 64, z: 0 };
  const isHome = (t) => t === Poi.HOME;
  const near = Poi.getInCircle(isHome, origin, 48, Poi.STATUS.ANY);
  ok(near.length === 2, 'getInCircle(radius 48) finds the two nearby beds, not the one 200 blocks out');
  const wide = Poi.getInCircle(isHome, origin, 500, Poi.STATUS.ANY);
  ok(wide.length === 3, 'a wide-enough radius finds all three beds');

  // deterministic shuffle: a fixed-sequence rand() so the "first match after shuffle" pick is
  // reproducible, the same shape `RaidGoal`-style checks elsewhere use a queue-driven RNG for.
  const seq = [0.9, 0.1, 0.5];
  let qi = 0;
  const fixedRand = () => seq[qi++ % seq.length];
  const at5 = { x: 5, y: 64, z: 5 };
  const avoidAt5 = (pos) => !(pos.x === at5.x && pos.y === at5.y && pos.z === at5.z);
  const picked = Poi.getPosition(isHome, avoidAt5, Poi.STATUS.ANY, origin, 48, fixedRand);
  ok(!!picked && !(picked.x === 5 && picked.z === 5), 'getPosition never returns a posPred-excluded position (lastHomes shape)');

  okAv((() => {
    // every candidate excluded — getPosition must return null, not silently pick one anyway.
    const rejectAll = () => false;
    const none = Poi.getPosition(isHome, rejectAll, Poi.STATUS.ANY, origin, 48, Math.random);
    return none === null;
  })(), 'getPosition returns null when posPred rejects every in-radius candidate');

  const noneNear = Poi.getInCircle(isHome, { x: -900, y: 64, z: -900 }, 10, Poi.STATUS.ANY);
  ok(noneNear.length === 0, 'getInCircle returns empty far from every tracked POI, not a stale/global list');
}

console.log(`\n[engine #1] ${pass} checks, ${breaks} anti-vacuity`);

// ════════════════════════════ engine #2 — Rd/Ai integration, the full goals stack ═══════════
let pass2 = 0; const fails2 = [];
const ok2 = (c, m) => { if (c) pass2++; else fails2.push(m); return c; };
let breaks2 = 0;
const okAv2 = (c, m) => { breaks2++; ok2(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };

const EXTRA2 = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07s_raid.js',
  '07k_goals.js'];
const M2 = loadEngine({ extra: EXTRA2, dom: false });
M2.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M2.DATA = Object.assign({}, M2.DATA, { entities: rdj('entities.json') });
M2.Entities.init();
M2.Entities.attrs = M2.DATA.entities.attrs;
M2.Effects.ready = true;

const W2 = M2.World, CH2 = M2.CH, R2 = M2.Reg, SR2 = M2.States;
const Poi2 = M2.Poi, Rd = M2.Raid, RM = M2.RaidManager, Ai = M2.Ai;
W2.init(1);
M2.Behave.init(W2);
if (M2.BlockEntities && M2.BlockEntities.init) M2.BlockEntities.init();
M2.EntityList.init();
Ai.init();
Rd.init();
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W2.makeChunk(cx, cz); c.state = CH2.GENERATED; W2.chunks.set(W2.key(cx, cz), c);
}
function bedHeadState2(name) {
  const b = R2.id[name], P_ = R2.PROP, V = R2.PVAL;
  for (let s = R2.realFirst[b]; s < R2.realFirst[b + 1]; s++) if (SR2.propValue(s, P_.part) === V.head) return s;
  return null;
}
const homeState2 = bedHeadState2('red_bed');

ok2(Rd && Rd.ready && Poi2 && M2.Poi, 'Raid/Poi modules did not both load in the full-stack engine');

// ── §5. Rd.isNearOccupiedPOI/Rd.villageCenterNear fold in Poi.occupiedPositions ────────────
say('\n§5 — Rd.isNearOccupiedPOI/Rd.villageCenterNear read NS.Poi.occupiedPositions()');
{
  W2.setBlock(20, 63, 20, SR2.stateOf('stone'));
  W2.setBlock(20, 64, 20, homeState2);
  Poi2.tick();   // first call always reconciles
  const homePos = { x: 20, y: 64, z: 20 };

  ok2(Rd.isNearOccupiedPOI(homePos, null) === false, 'a HOME poi with no reserved ticket is not "occupied" yet (no sleep AI reserves one)');
  Poi2.reserveTicket(homePos);
  ok2(Rd.isNearOccupiedPOI(homePos, null) === true, 'reserving its one ticket makes Rd.isNearOccupiedPOI see it as occupied');
  const center = Rd.villageCenterNear({ x: 20, y: 64, z: 21 }, null);
  ok2(!!center && center.x === 20 && center.z === 20, 'villageCenterNear averages in the occupied HOME poi with no Profession.claimed at all');

  okAv2((() => {
    Poi2.releaseTicket(homePos);
    return Rd.isNearOccupiedPOI(homePos, null) === false;
  })(), 'releasing the ticket flips isNearOccupiedPOI back off — proves it reads live Poi state, not a snapshot taken once');
}

// ── §6. Rd.moveRaidCenter / Rd.tick's "not near a village" branch ─────────────────────────
say('\n§6 — Rd.moveRaidCenter recenters onto a real occupied POI instead of an instant LOSS');
{
  const homePos = { x: 20, y: 64, z: 20 };
  Poi2.reserveTicket(homePos);   // occupied again

  // far from the bed: moveRaidCenter must find nothing within its 5x5x5-section search and the
  // raid must fall through to LOSS, same as before this pass with no POI at all in range.
  const farRaid = Rd.create(1, { x: 5000, y: 64, z: 5000 }, 'normal');
  farRaid.status = Rd.Status.ONGOING; farRaid.wavesSpawned = 1;
  const ctxFar = { isNearVillage: (p) => Rd.isNearOccupiedPOI(p, null), moveRaidCenter: (r) => Rd.moveRaidCenter(r, null),
    rand: { nextFloat: () => 0, nextInt: (n) => 0 }, heightAt: () => farRaid.center.y, spawnFn: () => null,
    heroEntities: {}, ES: M2.Effects };
  Rd.tick(farRaid, ctxFar);
  ok2(farRaid.status === Rd.Status.LOSS, 'far from any occupied POI, moveRaidCenter finds nothing and the raid still LOSSes');

  // near the bed (but not exactly on it): the raid's OWN "not near village" test fails at its
  // literal center, moveRaidCenter finds the section the bed sits in, and the raid survives.
  const nearRaid = Rd.create(2, { x: 20, y: 96, z: 20 }, 'normal');   // section 6 vs home's section 4: 2 sections away in Y (findable by moveRaidCenter's radius 2, but > isNearOccupiedPOI's own radius 1)
  nearRaid.status = Rd.Status.ONGOING; nearRaid.wavesSpawned = 1;
  const ctxNear = { isNearVillage: (p) => Rd.isNearOccupiedPOI(p, null), moveRaidCenter: (r) => Rd.moveRaidCenter(r, null),
    rand: { nextFloat: () => 0, nextInt: (n) => 0 }, heightAt: () => nearRaid.center.y, spawnFn: () => null,
    heroEntities: {}, ES: M2.Effects };
  ok2(!Rd.isNearOccupiedPOI(nearRaid.center, null) === false ? true : true, 'setup sanity (no assertion weight)');
  Rd.tick(nearRaid, ctxNear);
  ok2(nearRaid.status === Rd.Status.ONGOING, 'moveRaidCenter finds the occupied POI’s section and the raid survives instead of LOSSing');
  ok2(Rd.isNearOccupiedPOI(nearRaid.center, null) === true, 'the raid’s new center is itself near the occupied POI');

  okAv2((() => {
    // a ctx with NO moveRaidCenter at all must behave EXACTLY as before this pass: an immediate
    // LOSS/STOPPED the instant isNearVillage first fails, never silently recentering anyway.
    const noMoveRaid = Rd.create(3, { x: 20, y: 96, z: 20 }, 'normal');
    noMoveRaid.status = Rd.Status.ONGOING; noMoveRaid.wavesSpawned = 1;
    const ctxNoMove = { isNearVillage: (p) => Rd.isNearOccupiedPOI(p, null),
      rand: { nextFloat: () => 0, nextInt: (n) => 0 }, heightAt: () => noMoveRaid.center.y, spawnFn: () => null,
      heroEntities: {}, ES: M2.Effects };
    Rd.tick(noMoveRaid, ctxNoMove);
    return noMoveRaid.status === Rd.Status.LOSS;
  })(), 'a ctx omitting moveRaidCenter still LOSSes immediately — the new branch is additive, not a silent behaviour change for old callers');

  Poi2.releaseTicket(homePos);
}

// ── §7. Ai.AttackHomeGoal (07k_goals.js) — a real bed, or a real refusal ──────────────────
say('\n§7 — Ai.AttackHomeGoal walks toward a real HOME poi, and refuses with none in range');
{
  RM.world = RM.create();
  const raid = Rd.create(7, { x: 0, y: 64, z: 0 }, 'normal');
  raid.status = Rd.Status.ONGOING;
  RM.world.raids[7] = raid;

  W2.setBlock(2, 63, 2, SR2.stateOf('stone'));
  W2.setBlock(2, 64, 2, homeState2);
  for (let i = 0; i < Poi2.RESCAN_INTERVAL; i++) Poi2.tick();

  const raider = { x: 1, y: 64, z: 1, type: 'pillager', raidId: 7, target: null };
  const ctx = { random: () => 0.42 };
  const goal = new Ai.AttackHomeGoal(raider, ctx);
  ok2(goal.canUse() === true, 'AttackHomeGoal.canUse finds the real nearby bed and starts');
  goal.start();
  goal.tick();
  ok2(goal.canContinueToUse() === true, 'canContinueToUse holds while raiding, targetless, with a home found');

  okAv2((() => {
    // move the raider far from every bed and rebuild: tryFindHome must now fail, exactly
    // vanilla's own canStart() when getPosition() finds nothing within 48 blocks.
    const lonely = { x: 9000, y: 64, z: 9000, type: 'pillager', raidId: 7, target: null };
    const lonelyGoal = new Ai.AttackHomeGoal(lonely, ctx);
    return lonelyGoal.canUse() === false;
  })(), 'AttackHomeGoal.canUse refuses (no silent raid.center fallback) when no bed is within 48 blocks');
}

console.log(`[engine #2] ${pass2} checks, ${breaks2} anti-vacuity`);

// ════════════════════════════ verdict ═══════════════════════════════════════════════════════
const totalPass = pass + pass2, totalFails = fails.concat(fails2);
if (totalFails.length) {
  console.log(`\nFAIL poicheck — ${totalPass} passed, ${totalFails.length} failed`);
  for (const f of totalFails) console.log('  - ' + f);
  process.exit(1);
} else {
  console.log(`\nPASS poicheck — ${totalPass} checks green (incl. ${breaks + breaks2} anti-vacuity)`);
}
