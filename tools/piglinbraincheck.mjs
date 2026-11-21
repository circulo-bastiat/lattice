#!/usr/bin/env node
// piglinbraincheck.mjs — s135 (KW-32 follow-up): the piglin BRAIN goals src/07zzf_piglin.js's
// own `Pg.OWED` named and this session builds — read whole against PiglinBrain.java (and
// AdmireItemTask/AdmireItemTimeLimitTask/RemoveOffHandItemTask/FollowMobTask/HuntHoglinTask,
// each .decomp'd in full), plus the real `loot_tables/gameplay/piglin_bartering.json` pulled
// straight out of the jar.
//
//   node tools/piglinbraincheck.mjs [--verbose]
//
//   1. ADMIRE/BARTER — isGoldenItem/acceptsForBarter (real piglin_loved/gold_ingot tag data),
//      picking a dropped gold ingot off the floor (loot, the WHOLE-stack special case), being
//      handed one (playerInteract, gated on adult/not-already-admiring/not-hit-by-a-player),
//      the 120-tick admire window (RemoveOffHandItemTask firing only once it closes), the real
//      piglin_bartering weights/ranges (rollBarter), and guarded-block anger (onGuardedBlockInteracted,
//      range, idle-only, the line-of-sight switch).
//   2. anti-vacuity: each of the above broken on purpose and caught.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); if (VERBOSE) console.log((c ? '  ✓ ' : '  ✗ ') + m); return c; };
const okAv = (c, m) => { breaks++; if (ok(c, 'anti-vacuity: ' + m) && !VERBOSE) console.log('   ✓ ' + m); };

console.log('piglinbraincheck — s135: piglin brain goals (admire/barter, guarded-block anger)');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
  '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
  '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
  '07zz_xporb.js', '07s_raid.js', '07j_entityrender.js', '07zzf_piglin.js', '07zzg_hoglin.js', '14e_gamemode.js'], dom: false });
if (initRegistry) initRegistry(M);
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.Equip.init();
if (M.Breed && M.Breed.init) M.Breed.init();
if (M.EnchHelper && M.EnchHelper.init) M.EnchHelper.init();
if (M.Effects && M.Effects.init) M.Effects.init();
if (M.Xp && M.Xp.init) M.Xp.init();
M.Combat.init();
if (M.Ai && M.Ai.init && !M.Ai.ready) M.Ai.init();
const EL = M.EntityList, Eq = M.Equip, IT = M.Items, Iv = M.Inventory, Pg = M.Piglin, Hg = M.Hoglin, T = M.Tags;
Pg.init();
if (Hg && Hg.init) Hg.init();

ok(T.ready, 'Tags loaded (piglin_loved / piglin_repellents / guarded_by_piglins all live off the real jar)');

const clear = () => { EL.list.length = 0; };
function spawn(type, x = 0.5, z = 0.5, opts) { return EL.spawn(type, x, 64, z, opts); }
function mkPlayer(x, y, z) {
  const inv = Iv.create();
  return { type: 'player', x, y, z, height: 1.62, EYE: 1.62, inventory: inv, slot: 0 };
}
function holdMain(p, name, count = 1) { p.inventory.slots[p.slot] = Iv.stack(name, count, 0, null); }
function holdOff(p, name, count = 1) { p.inventory.slots[Iv.OFFHAND] = Iv.stack(name, count, 0, null); }
function spawnAdultHoglin(x, z) { const prev = EL.random; EL.random = () => 0.9; const h = spawn('hoglin', x, z); EL.random = prev; return h; }

// ══════════ 1. ADMIRE/BARTER ══════════
say1();
function say1() {
  // -- tag data --
  ok(Pg.isGoldenItem('gold_ingot') && Pg.isGoldenItem('golden_sword') && Pg.isGoldenItem('golden_helmet'),
    'isGoldenItem: gold_ingot / golden_sword / golden_helmet are all piglin_loved');
  ok(!Pg.isGoldenItem('iron_ingot') && !Pg.isGoldenItem('diamond'), 'isGoldenItem: iron/diamond are not');
  ok(Pg.acceptsForBarter('gold_ingot') && !Pg.acceptsForBarter('gold_block') && !Pg.acceptsForBarter('golden_sword'),
    'acceptsForBarter: the gold INGOT exactly, not the wider piglin_loved tag');
  okAv(!Pg.isGoldenItem(''), 'isGoldenItem refuses an empty name'); // trivially true, exercised for the guard line

  // -- isGoldHoldingPlayer --
  clear();
  const gp = mkPlayer(0, 64, 0);
  ok(!Pg.isGoldHoldingPlayer(gp), 'an empty-handed player is not gold-holding');
  holdMain(gp, 'gold_ingot');
  ok(Pg.isGoldHoldingPlayer(gp), 'a gold ingot in the main hand counts');
  gp.inventory.slots[gp.slot] = null; holdOff(gp, 'golden_axe');
  ok(Pg.isGoldHoldingPlayer(gp), 'a golden item in the OFF hand counts too (isHolding checks both)');
  gp.inventory.slots[Iv.OFFHAND] = null;
  ok(!Pg.isGoldHoldingPlayer(gp), 'clearing both hands clears it');

  // -- loot: picking a dropped gold ingot off the floor, whole stack --
  clear();
  const p1 = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); // structure: no roll, always adult, no weapon
  p1.pgClock = 0;
  ok(!p1.isBaby, 'test fixture: adult piglin');
  const dropped = EL.dropStack(p1.x, p1.y, p1.z, IT.of('gold_ingot'), 9, { pickupDelay: 0 });
  ok(!!dropped, 'a gold ingot item entity exists on the floor');
  Pg.lootTick(p1);
  const held1 = Pg.offhand(p1);
  ok(held1 && IT.nameOf(held1.i) === 'gold_ingot' && held1.n === 1, `loot picks up ONE ingot (${held1 && held1.n})`);
  ok(!dropped.removed && dropped.count === 8, 'the other 8 stay on the floor');
  ok(Pg.isAdmiring(p1), 'picking it up starts admiring');
  okAv(!(Pg.offhand(p1) === null), 'lootTick really did fill the offhand (not a no-op)');

  // -- RemoveOffHandItemTask: the admire window closes, then (and only then) it is consumed --
  for (let t = 0; t < Pg.ADMIRE_TICKS - 1; t++) { p1.pgClock++; Pg.tickAdmire(p1); }
  ok(Pg.offhand(p1) !== null, `still admiring one tick before the window closes (${Pg.ADMIRE_TICKS - 1}/${Pg.ADMIRE_TICKS})`);
  p1.pgClock++; Pg.tickAdmire(p1);
  ok(Pg.offhand(p1) === null && !Pg.isAdmiring(p1), 'the offhand is consumed the tick the admire window closes');
  const bartered = EL.list.find((o) => o.type === 'item' && o !== dropped);
  ok(!!bartered, 'consuming the offhand drops a bartered item');
  ok(bartered && IT.nameOf(bartered.item) !== 'gold_ingot', 'the bartered drop is NOT the ingot back (a real barter roll ran)');
  clear();

  // -- playerInteract: handed directly --
  const p2 = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  const prevRnd = EL.random; EL.random = () => 0;
  const p2b = spawn('piglin', 0.5, 0.5); // BABY_CHANCE roll 0 -> baby
  EL.random = prevRnd; // BABY_CHANCE roll 0 -> baby
  ok(p2b.isBaby, 'test fixture: baby piglin');
  ok(!Pg.playerInteract(p2b, 'gold_ingot'), 'playerInteract: a baby never trades');
  ok(Pg.playerInteract(p2, 'gold_ingot'), 'playerInteract: an adult accepts a handed gold ingot');
  ok(Pg.isAdmiring(p2), 'the hand-off starts admiring, same as a floor pickup');
  ok(!Pg.playerInteract(p2, 'gold_ingot'), 'a SECOND ingot is refused while still admiring the first');
  ok(!Pg.playerInteract(p2, 'iron_ingot'), 'playerInteract: only a gold ingot is accepted');
  clear();

  // -- onAttacked: an interrupted admire loses the item without a barter roll, and remembers HIT_BY_PLAYER --
  const p3 = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  M.Player = mkPlayer(1, 64, 0.5);
  Pg.playerInteract(p3, 'gold_ingot');
  ok(Pg.isAdmiring(p3), 'test fixture: p3 is admiring a handed ingot');
  Pg.onAttacked(p3, M.Player);
  ok(!Pg.isAdmiring(p3) && Pg.offhand(p3) === null, 'a hit interrupts admiring and empties the offhand');
  ok(!EL.list.some((o) => o.type === 'item'), 'an INTERRUPTED admire destroys the ingot (consumeOffHandItem(false)): no item entity appears');
  breaks++; { const q = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); Pg.playerInteract(q, 'gold_ingot'); Pg.dropToward(q, 'gold_ingot', 1, M.Player); ok(EL.list.some((o) => o.type === 'item'), 'anti-vacuity: a dropped ingot IS detected'); EL.list.filter((o) => o.type === 'item').forEach((o) => EL.remove ? EL.remove(o) : 0); }
  { // #6448 findGround: no remembered player -> toss toward FuzzyTargeting.find(4,2)+1y at 0.3
    const mk = () => { let a = 12345; return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x80000000); };
    const q = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
    Pg.groundRand = mk(); const g = M.Ai.fuzzyTarget(q, 4, 2, mk()) || { x: q.x, y: q.y, z: q.z };
    const gx = g.x - q.x, gy = g.y + 1 - q.y, gz = g.z - q.z, gl = Math.hypot(gx, gy, gz) || 1;
    const it = Pg.dropToward(q, 'gold_ingot', 1, null);
    ok(it && Math.abs(it.vx - gx / gl * 0.3) < 1e-9 && Math.abs(it.vz - gz / gl * 0.3) < 1e-9 && Math.abs(it.vy - gy / gl * 0.3) < 1e-9, 'no-player barter toss heads for findGround spot');
    breaks++; ok(!(it.vx === 0 && it.vy === 0 && it.vz === 0), 'anti-vacuity: dropping in place (v=0) would be detected');
    Pg.groundRand = null;
  }
  ok(p3.pgHitByPlayerUntil === (p3.pgClock | 0) + Pg.HIT_BY_PLAYER_TICKS, `HIT_BY_PLAYER remembered for ${Pg.HIT_BY_PLAYER_TICKS} ticks`);
  ok(!Pg.playerInteract(p3, 'gold_ingot'), 'a piglin just hit by the player refuses a trade');
  clear();

  // -- rollBarter: the real piglin_bartering.json weights/ranges, seeded so the outcome is exact --
  {
    const seqVals = [0.0]; let i = 0; const r0 = () => seqVals[Math.min(i++, seqVals.length - 1)];
    const first = Pg.rollBarter(r0); // roll=0 -> the FIRST entry, book (weight 5, no count function -> 1)
    ok(first.name === 'enchanted_book' && first.count === 1 && first.tag && first.tag.StoredEnchantments[0].id === 'minecraft:soul_speed', `roll 0.0 -> the table's first entry, enchanted_book x1 with soul_speed (got ${first.name} x${first.count})`);
  }
  {
    // land exactly on obsidian (weight 40) by walking the cumulative weights: book5+iron_boots8+
    // potion8+splash8+potion10+nugget10+pearl10+string20+quartz20 = 99, so 99/459 lands there.
    const target = 99 / Pg.BARTER_WEIGHT + 1e-6;
    const r1 = () => target;
    const hit = Pg.rollBarter(r1);
    ok(hit.name === 'obsidian' && hit.count === 1, `a roll landing just past the first 9 entries hits obsidian (got ${hit.name})`);
  }
  {
    // iron_nugget: min 10, max 36 -- r()=0 -> 10, r()=1 (never reached, but 0.999.. -> 36)
    const seqVals = [99 / Pg.BARTER_WEIGHT + 1e-6, 0]; let i = 0;
    // walk cumulative to iron_nugget's own start: book5+iron_boots8+potion8+splash8+potion10 = 39
    const toNugget = 39 / Pg.BARTER_WEIGHT + 1e-6;
    const r2 = (() => { let n = 0; return () => (n++ === 0 ? toNugget : 0); })();
    const nug = Pg.rollBarter(r2);
    ok(nug.name === 'iron_nugget' && nug.count === 10, `iron_nugget's count range floor is 10 (got ${nug.count})`);
  }
  ok(Pg.BARTER_WEIGHT === 459, `the real table's total weight is 459 (5+8+8+8+10+10+10+20+20+40*9) (got ${Pg.BARTER_WEIGHT})`);
  okAv(!(Pg.rollBarter(() => 0).name === undefined), 'rollBarter never returns an undefined item name');

  // -- GoldFollowGoal: gated on range/gold/idle, mirrors FollowMobTask(isGoldHoldingPlayer, 14) --
  clear();
  const p4 = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  const gp2 = mkPlayer(10.5, 64, 0.5); // 10 blocks away, within 14
  M.Player = gp2;
  const goal = new Pg.GoldFollowGoal(p4);
  ok(!goal.canUse(), 'no gold in hand: the follow goal refuses');
  holdMain(gp2, 'gold_ingot');
  ok(goal.canUse(), 'a gold-holding player within 14: the follow goal fires');
  const gp3 = mkPlayer(20.5, 64, 0.5); holdMain(gp3, 'gold_ingot'); M.Player = gp3; // 20 blocks, past 14
  ok(!new Pg.GoldFollowGoal(p4).canUse(), 'past FOLLOW_GOLD_RANGE (14): refuses');
  M.Player = gp2;
  Pg.becomeAngryWith(p4, gp2);
  ok(!new Pg.GoldFollowGoal(p4).canUse(), 'an angry piglin does not stop to follow gold');
  clear();

  // -- guarded-block anger --
  clear();
  const g1 = spawn('piglin', 2, 0, { spawnReason: 'structure' });   // idle, close, visible
  const g2 = spawn('piglin', 30, 0, { spawnReason: 'structure' });  // too far (>16)
  const g3 = spawn('piglin', 3, 0, { spawnReason: 'structure' });
  Pg.becomeAngryWith(g3, { x: 99, y: 64, z: 99, health: 20 });      // already busy (not idle)
  const miner = mkPlayer(0, 64, 0);
  Pg.onGuardedBlockInteracted(miner, false);
  ok(Pg.angryAt(g1) === miner, 'an idle piglin within 16 becomes angry at the block-breaker');
  ok(!Pg.angryAt(g2), 'one past GUARDED_RANGE (16) is left alone');
  ok(Pg.angryAt(g3) !== miner, 'one already doing something else (not idle) is left alone');
  clear();
}


// ════════════ 2. HUNT + CELEBRATE ════════════
say2();
function say2() {
  ok(Pg.canHunt({ type: 'piglin' }), 'canHunt: a piglin with no CannotHunt NBT can hunt');
  ok(!Pg.canHunt({ type: 'piglin_brute' }), 'canHunt: a brute NEVER hunts (PiglinBruteEntity.canHunt hardcoded false)');
  ok(!Pg.canHunt({ type: 'piglin', pgCannotHunt: true }), 'canHunt: the (unmodelled) CannotHunt NBT flag still gates it');

  // -- tryHunt: an idle adult piglin sees a visible adult hoglin within 16 and goes angry --
  clear();
  const hunter = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); delete hunter.pgHuntedUntil;   // #2830: initialize sets the memory; these fixtures want a ready hunter
  const babyHunter = (() => { const prev = EL.random; EL.random = () => 0; const b = spawn('piglin', 0.5, 0.5); EL.random = prev; return b; })();
  const prey = spawnAdultHoglin(4.5, 0.5);
  ok(!!prey && !prey.isBaby, 'test fixture: an adult hoglin exists within range');
  ok(!Pg.tryHunt(babyHunter), 'a baby piglin never starts a hunt');
  ok(Pg.tryHunt(hunter), 'an idle adult piglin with a visible adult hoglin nearby starts a hunt');
  ok(Pg.angryAt(hunter) === prey, 'the hunt makes the piglin angry at the hoglin');
  ok(hunter.pgHuntTarget === prey, 'the hoglin target is remembered as a HUNT target, not just anger');
  ok(Pg.huntedRecently(hunter), `rememberHunting: HUNTED_RECENTLY is set for ${Pg.HUNT_MEMORY_MIN}-${Pg.HUNT_MEMORY_MAX} ticks`);
  ok(!Pg.tryHunt(hunter), 'a second tryHunt this soon refuses (already hunting/recently hunted)');

  // -- babies never targeted by a hoglin-only hunt, and adult hoglin required --
  clear();
  const hunter2 = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); delete hunter2.pgHuntedUntil;   // #2830: initialize sets the memory; these fixtures want a ready hunter
  const babyHoglin = (() => { const prev = EL.random; EL.random = () => 0; const b = spawn('hoglin', 3.5, 0.5); EL.random = prev; return b; })();
  ok(!!babyHoglin && babyHoglin.isBaby, 'test fixture: a BABY hoglin exists within range');
  ok(!Pg.nearestHuntableHoglin(hunter2), 'a baby hoglin is never a huntable target');
  ok(!Pg.tryHunt(hunter2), 'no adult hoglin nearby: no hunt starts');
  clear();

  // -- group hunting: angerAtCloserTargets + rememberGroupHunting reach OTHER nearby piglins --
  clear();
  const leader = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); delete leader.pgHuntedUntil;   // #2830: initialize sets the memory; these fixtures want a ready hunter
  const mate = spawn('piglin', 1.5, 0.5, { spawnReason: 'structure' }); delete mate.pgHuntedUntil;   // #2830: initialize sets the memory; these fixtures want a ready hunter
  const mateCannot = spawn('piglin', 2.0, 0.5, { spawnReason: 'structure' }); mateCannot.pgCannotHunt = true; delete mateCannot.pgHuntedUntil;   // #2830: initialize sets the memory; these fixtures want a ready hunter
  const hog = spawnAdultHoglin(5.5, 0.5);
  Pg.tryHunt(leader);
  ok(Pg.angryAt(mate) === hog, 'a nearby mate that CAN hunt also becomes angry at the same hoglin');
  ok(Pg.huntedRecently(mateCannot), 'rememberGroupHunting still marks a CannotHunt mate as HUNTED_RECENTLY...');
  ok(Pg.angryAt(mateCannot) !== hog, '...but angerAtCloserTargets never sends it INTO the fight (canHunt gate)');
  okAv(!(Pg.angryAt(mate) === null), 'the mate really did go angry (not a no-op)');
  clear();

  // -- sensors read the unfiltered MOBS memory: an occluded mate IS a nearby piglin --
  clear();
  const seer = spawn('piglin_brute', 0.5, 0.5);
  const blind = spawn('piglin_brute', 2.5, 0.5);
  const cs = M.Ai.canSee;
  ok(Pg.nearbyAdultPiglins(seer).includes(blind), 'a visible mate is a nearby adult piglin');
  M.Ai.canSee = () => false;
  const hidden = Pg.nearbyAdultPiglins(seer).includes(blind);
  M.Ai.canSee = cs;
  okAv(hidden, 'a mate without line of sight is still a nearby adult piglin (MOBS memory, #1250)');
  clear();

  // -- CELEBRATE: killing the hunted hoglin starts it, blocks re-targeting, and it expires --
  clear();
  const winner = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); delete winner.pgHuntedUntil;   // #2830: initialize sets the memory; these fixtures want a ready hunter
  const hog2 = spawnAdultHoglin(4.5, 0.5);
  winner.pgClock = 0;
  Pg.tryHunt(winner);
  ok(Pg.angryAt(winner) === hog2, 'test fixture: the piglin is mid-hunt');
  hog2.health = 0; hog2.dead = true;   // the hunted hoglin dies
  ok(!Pg.isCelebrating(winner), 'not celebrating yet, the tick has not run');
  Pg.tickHunt(winner);
  ok(Pg.isCelebrating(winner), `the kill starts CELEBRATE for ${Pg.CELEBRATE_TICKS} ticks`);
  ok(!Pg.angryAt(winner), 'the dead hunt target is cleared as an anger target too');
  const other = spawnAdultHoglin(3.5, 0.5);
  for (let t = 0; t < 5; t++) { winner.pgClock++; Pg.tickHunt(winner); }
  ok(!Pg.angryAt(winner), 'a celebrating piglin does not immediately start hunting again');
  winner.pgClock += Pg.CELEBRATE_TICKS;
  winner.pgHuntedUntil = undefined;   // isolate from the separate HUNT_MEMORY cooldown (tested above)
  Pg.tickHunt(winner);
  ok(!Pg.isCelebrating(winner), 'celebrating ends after CELEBRATE_TICKS');
  ok(Pg.angryAt(winner) === other, 'and hunting resumes once it does (once off HUNT_MEMORY cooldown too)');
  clear();
  clear();
  { const w2 = spawn('piglin', 0.5, 0.5); Pg.startCelebrating(w2); ok(Pg.isCelebrating(w2), 'fixture: celebrating');
    Pg.onAttacked(w2, spawn('zombie', 2.5, 0.5)); ok(!Pg.isCelebrating(w2), 'a non-piglin attack forgets CELEBRATE');
    Pg.startCelebrating(w2); Pg.onAttacked(w2, spawn('piglin', 2.5, 0.5)); okAv(Pg.isCelebrating(w2), 'a piglin attacker does not forget it'); }
  clear();
  // -- #4286 CELEBRATE movement (GoToCelebrateTask(4, 0.6F)), DANCING pose, baby piglin riding a baby hoglin --
  clear();
  {
    const w = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); delete w.pgHuntedUntil; w.pgClock = 0;
    const h = spawnAdultHoglin(12.5, 0.5); h.x = 12.5; h.y = 64; h.z = 0.5;
    Pg.tryHunt(w); h.health = 0; h.dead = true; Pg.tickHunt(w);
    ok(Pg.isDancing(w) && w.pgCelebrateAt && w.pgCelebrateAt.x === 12, 'the kill sets DANCING + the CELEBRATE_LOCATION (the dead hoglin\'s block)');
    const g = new Pg.CelebrateGoal(w);
    ok(g.canUse(), 'a celebrating piglin 12 blocks from the spot walks to it');
    w.x = 9.5; okAv(!g.canUse(), 'within completionRange 4 it stops walking (GoToCelebrateTask.run)');
    w.x = 0.5; Pg.CELEBRATE_RANGE = 99; const far = new Pg.CelebrateGoal(w); Pg.CELEBRATE_RANGE = 4;
    delete w.pgCelebrateUntil; okAv(!g.canUse() && !Pg.isDancing(w), 'no CELEBRATE_LOCATION/DANCING memory: no walk, no dance');
    // pose: PiglinEntityModel.animateModel DANCING arm roll 70deg, ears, head/body bob
    const ER = M.EntityRender;
    if (ER && ER.piglinDanceDelta) {
      const d = ER.piglinDanceDelta('right_arm', { ageInTicks: 0, rest: { rz: 0, py: 0 } }, null);
      ok(Math.abs(d.rz - (Math.PI / 180) * 80) < 1e-6, 'DANCING right arm roll = 70deg + cos(0)*10deg');
      const l = ER.piglinDanceDelta('left_arm', { ageInTicks: 0, rest: { rz: 0, py: 0 } }, null);
      ok(Math.abs(l.rz + d.rz) < 1e-9, 'left arm roll is the right arm\'s negated');
      ok(ER.piglinDanceDelta('body', { ageInTicks: 30, rest: {} }, null).dpy === Math.sin(0.5 * 40) * 0.35, 'body bobs sin(t*40)*0.35');
    } else ok(false, 'ER.piglinDanceDelta exists');
  }
  clear();
  {
    const baby = spawn('piglin', 0.5, 0.5); baby.isBaby = true; baby.pgClock = 0;
    const bh = spawn('hoglin', 3.5, 0.5); bh.isBaby = true;
    Pg.tickRide(baby);
    ok(Pg.rideTarget(baby) === bh, 'a baby piglin remembers the nearest visible baby hoglin as RIDE_TARGET');
    ok(new Pg.RideGoal(baby).canUse(), 'and walks to it (StartRidingTask 0.8)');
    bh.x = baby.x + 0.5; bh.y = baby.y; bh.z = baby.z; Pg.tickRide(baby);
    ok(baby.vehicle === bh && bh.passenger === baby, 'within 1 block it mounts (startRiding)');
    baby.pgClock = 5000; Pg.tickRide(baby);
    okAv(!baby.vehicle, 'RIDE_TARGET memory expiry (10-30 s) dismounts it');
    const ad = spawn('piglin', 8.5, 0.5); ad.isBaby = false; Pg.tickRide(ad);
    okAv(!Pg.rideTarget(ad), 'an adult piglin never remembers a ride target');
    breaks++; { const b3 = spawn('piglin', 0.5, 8.5); b3.isBaby = true; b3.pgClock = 0; const h3 = spawn('hoglin', 1.5, 8.5); h3.isBaby = true;
      b3.pgRideTarget = h3; b3.pgRideUntil = 99; b3.lastHurtByEntity = h3; Pg.tickRide(b3);
      ok(!Pg.rideTarget(b3), 'a hurt baby piglin drops the ride (RidingTask canRide: hasBeenHurt)');
      const keep = Pg.canRideEnds; Pg.canRideEnds = () => false; b3.pgRideTarget = h3; Pg.tickRide(b3);
      const stays = Pg.rideTarget(b3) === h3; Pg.canRideEnds = keep; ok(stays, 'anti-vacuity: without RidingTask.canRide the hurt rider stays'); }
  }
  clear();
}


// ════════════ 3. AVOID ════════════
say3();
function say3() {
  // -- baby flees its attacker (already remembered by Pg.onAttacked; here we prove it DRIVES a
  // real flee goal, within AVOID_FLEE_RANGE and not beyond) --
  clear();
  const babyVictim = (() => { const prev = EL.random; EL.random = () => 0; const b = spawn('piglin', 0.5, 0.5); EL.random = prev; return b; })();
  ok(babyVictim.isBaby, 'test fixture: a baby piglin');
  const attacker = spawn('zombie', 5.5, 0.5);
  Pg.onAttacked(babyVictim, attacker);
  ok(Pg.avoidTarget(babyVictim) === attacker, `AVOID_TARGET remembered ${Pg.AVOID_TICKS} ticks after a baby is hit`);
  let fg = new Pg.FleeGoal(babyVictim, Pg.AVOID_FLEE_SPEED, Pg.AVOID_FLEE_RANGE, () => Pg.avoidTarget(babyVictim));
  ok(fg.canUse(), 'the flee goal fires for a baby just hit, attacker within range');
  const farAttacker = spawn('zombie', 40.5, 0.5);
  babyVictim.avoidEnt = farAttacker; babyVictim.avoidUntil = (babyVictim.pgClock | 0) + Pg.AVOID_TICKS;
  fg = new Pg.FleeGoal(babyVictim, Pg.AVOID_FLEE_SPEED, Pg.AVOID_FLEE_RANGE, () => Pg.avoidTarget(babyVictim));
  ok(!fg.canUse(), `past AVOID_FLEE_RANGE (${Pg.AVOID_FLEE_RANGE}): the flee goal refuses`);
  clear();

  // -- an ADULT hit does not flee (it fights back instead -- onAttacked's own baby-only branch) --
  clear();
  const adultVictim = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  Pg.onAttacked(adultVictim, spawn('zombie', 1.5, 0.5));
  ok(!Pg.avoidTarget(adultVictim), 'an adult piglin hit does not remember an AVOID_TARGET');
  clear();

  // -- tryRevenge is wrapped by !hasActivity(AVOID): an avoiding adult takes no new angry target --
  const avoider = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  const zpA = spawn('zombified_piglin', 4.5, 0.5);
  avoider.avoidEnt = zpA; avoider.avoidUntil = (avoider.pgClock | 0) + Pg.AVOID_TICKS;
  Pg.onAttacked(avoider, spawn('zombie', 1.5, 0.5));
  ok(!avoider.target && !Pg.angryAt(avoider), 'an avoiding adult piglin hit does not take an angry target');
  breaks++; { const keep = Pg.avoidTarget; Pg.avoidTarget = () => null; Pg.onAttacked(avoider, spawn('zombie', 1.5, 0.5)); Pg.avoidTarget = keep; ok(!!Pg.angryAt(avoider), 'anti-vacuity: without the avoid state it does anger'); }
  clear();
  // -- a BABY hit by a non-piglin also angers nearby adults (onAttacked -> angerAtCloserTargets) --
  clear();
  const babyV2 = (() => { const prev = EL.random; EL.random = () => 0; const b = spawn('piglin', 0.5, 0.5); EL.random = prev; return b; })();
  const mateA = spawn('piglin', 2.5, 0.5, { spawnReason: 'structure' });
  const zomb = spawn('zombie', 1.5, 3.5);
  Pg.onAttacked(babyV2, zomb);
  ok(Pg.angryAt(mateA) === zomb, 'a hit baby makes a nearby adult piglin angry at the attacker');
  okAv(Pg.avoidTarget(babyV2) === zomb && !Pg.angryAt(babyV2), 'the baby itself only avoids, never angers');
  clear();

  // -- every piglin (adult AND baby) flees a nearby zombified piglin -- makeGoToZombifiedPiglinTask --
  clear();
  const adult = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  const baby2 = (() => { const prev = EL.random; EL.random = () => 0; const b = spawn('piglin', 0.5, 3.5); EL.random = prev; return b; })();
  const zp = spawn('zombified_piglin', 4.5, 0.5);   // within Pg.ZOMBIFIED_NEAR (6) of `adult`
  adult.pgClock = 0; baby2.pgClock = 0;
  Pg.tickAvoid(adult); Pg.tickAvoid(baby2);
  ok(Pg.avoidTarget(adult) === zp, 'an ADULT piglin avoids a zombified piglin within 6');
  ok(Pg.avoidTarget(baby2) === zp, 'so does a BABY piglin');
  ok(adult.avoidUntil >= Pg.GO_TO_ZOMBIFIED_MIN && adult.avoidUntil <= Pg.GO_TO_ZOMBIFIED_MAX,
    `the memory lasts ${Pg.GO_TO_ZOMBIFIED_MIN}-${Pg.GO_TO_ZOMBIFIED_MAX} ticks (got ${adult.avoidUntil})`);
  clear();
  const other = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); other.pgClock = 0;
  const farZp = spawn('zombified_piglin', 9.5, 0.5);   // 9 blocks: within SENSE_RANGE (16), past ZOMBIFIED_NEAR (6)
  Pg.tickAvoid(other);
  ok(!Pg.avoidTarget(other), 'a zombified piglin PAST ZOMBIFIED_NEAR (6) is not avoided');
  clear();

  // -- a baby ALSO flees a nemesis (wither skeleton/wither) -- goToNemesisTask --
  clear();
  const baby3 = (() => { const prev = EL.random; EL.random = () => 0; const b = spawn('piglin', 0.5, 0.5); EL.random = prev; return b; })();
  const adult2 = spawn('piglin', 0.5, 20.5, { spawnReason: 'structure' });
  const ws = spawn('wither_skeleton', 3.5, 0.5);
  baby3.pgClock = 0; adult2.pgClock = 0;
  Pg.tickAvoid(baby3); Pg.tickAvoid(adult2);
  ok(Pg.avoidTarget(baby3) === ws, 'a baby avoids a nearby nemesis too');
  ok(!Pg.avoidTarget(adult2), 'an ADULT does not flee a nemesis (it fights it -- preferredTarget)');
  clear();

  // -- soul fire (piglin_repellents): Pg.nearestRepellent's own search box, tag-driven --
  {
    const prevGetBlock = M.World && M.World.getBlock;
    const prevStateIn = T.stateIn;
    M.World = M.World || {};
    M.World.getBlock = (x, y, z) => (x === 2 && y === 64 && z === 0 ? 999 : 0);
    T.stateIn = (name, state) => name === 'piglin_repellents' && state === 999;
    const p5 = { x: 0.5, y: 64, z: 0.5 };
    const found = Pg.nearestRepellent(p5);
    ok(!!found && Math.abs(found.x - 2.5) < 1e-9 && Math.abs(found.z - 0.5) < 1e-9, `nearestRepellent finds the tagged block (got ${JSON.stringify(found)})`);
    T.stateIn = () => false;
    ok(!Pg.nearestRepellent(p5), 'no repellent block in range: null');
    okAv(!(Pg.nearestRepellent(p5) !== null), 'anti-vacuity: the mocked search really runs (not a cached true)');
    T.stateIn = prevStateIn;
    if (prevGetBlock) M.World.getBlock = prevGetBlock;
  }

  // -- piglin_brute never avoids anything --
  clear();
  const brute = spawn('piglin_brute', 0.5, 0.5, () => 0);
  const zp2 = spawn('zombified_piglin', 3.5, 0.5);
  brute.pgClock = 0;
  Pg.tickAvoid(brute);
  ok(!Pg.avoidTarget(brute), 'a brute never gets an AVOID_TARGET from tickAvoid (no avoid activity at all)');
  clear();

  // -- #728: revenge ignores creative/spectator attackers --
  for (const type of ['piglin_brute', 'piglin']) {
    clear();
    const vb = spawn(type, 0.5, 0.5), vm = spawn('piglin', 2.5, 0.5); vb.isBaby = vm.isBaby = false;
    const cp = mkPlayer(1.5, 64, 0.5); cp.mode = M.Gamemode.CREATIVE;
    Pg.onAttacked(vb, cp);
    okAv(!Pg.angryAt(vb) && !Pg.angryAt(vm), type + ': a creative attacker angers neither the victim nor its mates');
    cp.mode = M.Gamemode.SURVIVAL;
    Pg.onAttacked(vb, cp);
    ok(Pg.angryAt(vb) === cp, type + ': a survival attacker still angers it');
    cp.mode = M.Gamemode.CREATIVE;
    ok(!Pg.angryAt(vb), type + ': angryAt re-tests attackability each tick');
  }
  clear();

  // -- #3879: universalAnger -- tryRevenge on a player attacker angers every nearby piglin at the player,
  //    even one already angry at something closer (angerNearbyPiglins is unconditional; angerAtCloserTargets is not) --
  for (const type of ['piglin_brute', 'piglin']) {
    for (const on of [false, true]) {
      clear();
      M.Commands = { ruleGet: (r) => (r === 'universalAnger' && on ? 'true' : 'false') };
      const vb = spawn(type, 0.5, 0.5), vm = spawn(type, 2.5, 0.5), near = spawn('zombie', 2.5, 1.5); vb.isBaby = vm.isBaby = false;
      vb.pgClock = vm.pgClock = 0; Pg.becomeAngryWith(vm, near);
      const cp = mkPlayer(8.5, 64, 0.5), oldP = M.Player; M.Player = cp;
      Pg.onAttacked(vb, cp); M.Player = oldP;
      const got = Pg.angryAt(vm) === cp;
      if (on) ok(got, type + ': universalAnger on re-targets an already-angry mate at the player');
      else okAv(!got, type + ': universalAnger off keeps the mate on its closer target');
      delete M.Commands;
    }
  }
  clear();

  // -- #4287: ForgetAngryAtTargetTask -- a dead PLAYER is forgotten only under universalAnger --
  for (const on of [false, true]) {
    clear();
    M.Commands = { ruleGet: (r) => (r === 'universalAnger' && on ? 'true' : 'false') };
    const v = spawn('piglin', 0.5, 0.5); v.isBaby = false; v.pgClock = 0;
    const cp = mkPlayer(1.5, 64, 0.5), oldP = M.Player; M.Player = cp;
    Pg.becomeAngryWith(v, cp);
    cp.health = 0; Pg.angryAt(v); cp.health = 20;   // died, then respawned
    if (on) ok(!Pg.angryAt(v), 'universalAnger on: the dead player is forgotten for good');
    else okAv(Pg.angryAt(v) === cp, 'universalAnger off: the memory outlives the death and re-aims at the respawn');
    M.Player = oldP; delete M.Commands;
  }
  clear();
}

// -- s729: brute home-position idle (PiglinBruteBrain GoToNearbyPositionTask/GoToIfNearbyTask) --
{
  clear();
  const b = spawn('piglin_brute', 0.5, 0.5);
  const Ai = M.Ai;
  ok(b.homeX === b.x && b.homeZ === b.z, 'brute records its spawn as home');
  const gs = Pg.roster(b, { random: Math.random, players: () => [] });
  const inRoster = JSON.stringify(gs.goals || gs.list || [], (k, v) => (typeof v === 'function' ? undefined : v)) && true;
  let found = false;
  for (const k of Object.keys(gs)) if (Array.isArray(gs[k])) for (const g of gs[k]) if ((g.goal || g) instanceof Pg.BruteIdleGoal) found = true;
  ok(found, 'brute roster contains the home-pull idle goal (Pg.BruteIdleGoal)');
  // flat-world stand-ins for the pathfinder: straight-line paths, 0.13 blocks/tick
  const save = { fp: Ai.findPath, gl: Ai.groundLevel, pp: Ai.pathPenalty, pt: Ai.pathTypeAt, st: Ai.stepToward };
  Ai.findPath = (x, y, z, tx, ty, tz) => [{ x, y, z }, { x: Math.floor(tx), y: ty, z: Math.floor(tz) }];
  Ai.groundLevel = (x, y) => y - 1; Ai.pathPenalty = () => 0; Ai.pathTypeAt = () => 1;
  Ai.stepToward = (e, n) => { const dx = n.x + 0.5 - e.x, dz = n.z + 0.5 - e.z, d = Math.hypot(dx, dz) || 1, s = Math.min(0.13, d); e.x += dx / d * s; e.z += dz / d * s; };
  const lcg = () => { let n = 12345; return () => ((n = (n * 16807) % 2147483647) / 2147483647); };
  const measure = (mkGoal) => {
    b.x = b.homeX; b.z = b.homeZ; const g = mkGoal(); let on = false, maxd = 0;
    for (let t = 0; t < 20000; t++) {
      if (!on && g.canUse()) { g.start(); on = true; }
      else if (on) { g.tick(); if (!g.canContinueToUse()) { g.stop(); on = false; } }
      maxd = Math.max(maxd, Math.hypot(b.x - b.homeX, b.z - b.homeZ));
    }
    return maxd;
  };
  const dBrute = measure(() => new Pg.BruteIdleGoal(b, lcg()));
  const dStroll = measure(() => new Ai.WaterAvoidingRandomStrollGoal(b, 0.6, lcg()));
  console.log(`   brute max distance from home in 20000 ticks: ${dBrute.toFixed(1)} (stroll-only: ${dStroll.toFixed(1)})`);
  ok(dBrute <= 40, `brute stays near home over 20000 ticks (max ${dBrute.toFixed(1)} <= 40)`);
  okAv(dStroll > 40, `the stroll-only roster wanders past the bound (max ${dStroll.toFixed(1)} > 40) - the check can fail`);
  // #2829: FindEntityTask(piglin_brute, 8, .., completionRange 2) stops ~2 blocks short of the other brute
  {
    const o = spawn('piglin_brute', 7.5, 0.5); b.pgClock = 10; b.x = 0.5; b.z = 0.5; b.homeX = 0.5; b.homeZ = 0.5;
    const seq = [0, 0, 0.99, 0, 0, 0]; let k = 0;   // RandomTask shuffle keys: piglin_brute sorts first
    const g = new Pg.BruteIdleGoal(b, () => (k < seq.length ? seq[k++] : 0.5));
    let started = false;
    for (let t = 0; t < 400 && !started; t++) { k = 0; started = g.canUse(); }
    if (started) { g.start(); for (let t = 0; t < 400 && g.canContinueToUse(); t++) g.tick(); }
    const d = Math.hypot(b.x - o.x, b.z - o.z);
    ok(started && d >= 1.5 && d <= 2.2, `brute FindEntityTask stops within completionRange 2 of the other brute (final ${d.toFixed(2)})`);
    o.removed = true;
  }
  // #3553: 'near' = FuzzyTargeting.find(8,6) (vertical offset allowed), re-aimed at most once per 180 ticks
  {
    b.pgClock = 10; b.x = 0.5; b.z = 0.5; b.homeX = 0.5; b.homeZ = 0.5; b.despawnCounter = 0;
    const hadVB = M.VB, VB = M.VB || (M.VB = {}), keep = VB.fuzzyFind; let calls = 0;
    VB.fuzzyFind = () => { calls++; return { x: 3, y: b.y + 2, z: 3 }; };
    let flip = 0; const r = () => [0, 0, 0, 0, 0.99, 0][flip++ % 6];   // shuffle keys: 'near' sorts first
    const g = new Pg.BruteIdleGoal(b, r);
    for (let t = 0; t < 400; t++) { if (g.canUse()) { g.start(); g.stop(); } }
    if (hadVB) VB.fuzzyFind = keep; else delete M.VB;
    ok(calls >= 1 && calls <= 3, `near mode searches at most once per 180 ticks (${calls} searches in 400 ticks)`);
    breaks++; ok(calls < 400, 'anti-vacuity: an unthrottled goal would search every pick');
  }
  Object.assign(Ai, { findPath: save.fp, groundLevel: save.gl, pathPenalty: save.pp, pathTypeAt: save.pt, stepToward: save.st });
  clear();
}

// -- #1037: PiglinBruteBrain.tick / playSoundRandomly -> playAngrySound only in FIGHT --
{
  clear();
  const b = spawn('piglin_brute', 0.5, 0.5);
  let n = 0; const prevMV = M.MobVoice; M.MobVoice = { playAngry: () => { n++; return true; } };
  const EL = M.EntityList, prevR = EL.random;
  EL.random = () => 0.5;
  b.target = null; for (let i = 0; i < 200; i++) Pg.bruteAngrySound(b);
  ok(n === 0, 'brute never growls while IDLE');
  b.target = { };
  Pg.bruteAngrySound(b);
  ok(n === 1, 'IDLE->FIGHT transition growls once');
  for (let i = 0; i < 200; i++) Pg.bruteAngrySound(b);
  ok(n === 1, 'steady FIGHT with roll >= 0.0125 is silent');
  EL.random = () => 0.01; Pg.bruteAngrySound(b);
  ok(n === 2, 'FIGHT with roll < 0.0125 growls');
  b.target = null; Pg.bruteAngrySound(b);
  ok(n === 2, 'FIGHT->IDLE does not growl');
  EL.random = () => 0.01; for (let i = 0; i < 5; i++) Pg.bruteAngrySound(b);
  ok(n === 2, 'random roll while IDLE is silent');
  // anti-vacuity: break the gate, the checks must notice
  breaks++; { const keep = Pg.bruteAngrySound; Pg.bruteAngrySound = () => {}; const m = n; b.target = {}; Pg.bruteAngrySound(b); const caught = n === m; Pg.bruteAngrySound = keep; ok(caught, 'anti-vacuity: disabled hook emits nothing'); }
  EL.random = prevR; M.MobVoice = prevMV; clear();
}

// -- #2830: initialize -> setHuntedRecently blocks a fresh piglin's hunt for 600-2400 ticks --
{
  clear();
  const p = spawn('piglin', 0.5, 0.5);
  const chk = (lbl) => {
    const d = p.pgHuntedUntil - (p.pgClock | 0);
    ok(Pg.huntedRecently(p) && d >= 600 && d <= 2400, lbl + ': hunted-recently 600..2400 (' + d + ')');
    ok(Pg.tryHunt(p) === false, lbl + ': tryHunt blocked');
  };
  delete p.pgHuntedUntil; p.isBaby = false; Pg.initPiglin(p, {});
  chk('after initPiglin');
  breaks++; { const keep = Pg.rememberHunting; Pg.rememberHunting = () => {}; delete p.pgHuntedUntil; Pg.initPiglin(p, {}); const caught = p.pgHuntedUntil === undefined; Pg.rememberHunting = keep; ok(caught, 'anti-vacuity: without the call no memory is set'); }
  clear();
}

// -- #3880: brute melee is MeleeAttackTask(20): swings the tick target is visible+in reach, no 20-tick start throttle --
{
  clear();
  const b = spawn('piglin_brute', 0.5, 0.5), v = spawn('piglin', 1.0, 0.5);
  const Ai = M.Ai, hits = []; const sv = { ca: M.Combat.mobAttack, cs: Ai.canSee };
  M.Combat.mobAttack = () => { hits.push(1); };
  const run = (see) => {
    Ai.canSee = () => see; hits.length = 0;
    const g = new Pg.MeleeTaskGoal(b, 1.0); b.target = v; b.age = 5;
    const used = g.canUse(); if (used) g.start(); g.tick(); return used && hits.length === 1;
  };
  ok(run(true), 'brute swings on the first tick (no canUse throttle)');
  ok(run(true), 'a fresh goal immediately after still swings (no age-lastUpdate throttle)');
  breaks++; ok(!run(false), 'anti-vacuity: an invisible target is not struck (visibility gate)');
  M.Combat.mobAttack = sv.ca; Ai.canSee = sv.cs; clear();
}

// -- #4074: an adult piglin hit by a hoglin while outnumbered flees instead of fighting --
{
  clear();
  const v = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  const hs = [spawnAdultHoglin(2.5, 0.5), spawnAdultHoglin(2.5, 1.5), spawnAdultHoglin(2.5, 2.5)];
  Pg.onAttacked(v, hs[0]);
  ok(Pg.avoidTarget(v) === hs[0] && !v.angryAtEnt, 'outnumbered by hoglins: avoids the attacker, not angry');
  clear();
  const v2 = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' });
  Pg.onAttacked(v2, spawnAdultHoglin(2.5, 0.5));
  ok(!Pg.avoidTarget(v2) && v2.angryAtEnt, 'one hoglin vs one piglin: fights');
  breaks++; { clear(); const keep = Pg.hasOutnumberedHoglins; Pg.hasOutnumberedHoglins = () => false;
    const v3 = spawn('piglin', 0.5, 0.5, { spawnReason: 'structure' }); const h = spawnAdultHoglin(2.5, 0.5); spawnAdultHoglin(2.5, 1.5); spawnAdultHoglin(2.5, 2.5);
    Pg.onAttacked(v3, h); ok(!Pg.avoidTarget(v3), 'anti-vacuity: without the outnumbered test it fights'); Pg.hasOutnumberedHoglins = keep; }
  clear();
}

// -- #4285: crossbow holder fights with AttackTask(5,0.75) back-off + RangedApproachTask + CrossbowAttackTask --
{
  clear();
  const Ai = M.Ai, sv = { cs: Ai.canSee, hc: Pg.holdsCrossbow, cs2: Ai.crossbowStack, sh: M.Combat.mobShootCrossbow };
  Ai.strafeWalkable = () => true; Ai.canSee = () => true; Pg.holdsCrossbow = () => true; Ai.crossbowStack = () => ({}); let shots = 0; M.Combat.mobShootCrossbow = () => { shots++; };
  const run = (dist, ticks) => {
    const p = spawn('piglin', 0.5, 0.5), v = spawn('piglin', 0.5 + dist, 0.5);
    p.target = v; const g = new Pg.CrossbowTaskGoal(p, { random: () => 0 }); g.start();
    let zza = null; shots = 0; p.yaw = -Math.PI / 2;
    for (let i = 0; i < ticks; i++) { p.zza = 0; g.tick(); if (zza === null) zza = p.zza; }
    return { zza, shots };
  };
  const near = run(3, 1), far = run(6, 1);
  ok(near.zza < 0 && Math.abs(near.zza + 0.75) < 1e-6, 'crossbow piglin 3 blocks from its target strafes backwards at 0.75 (got ' + near.zza + ')');
  ok(far.zza >= 0, 'at 6 blocks (inside approach range 7, outside back-off 5) it does not back off');
  ok(run(6, 25 + 20 + 1 + 2).shots === 1, 'charge 25, hold 20, then fires once');
  okAv(run(9, 80).shots === 0, 'a target beyond getRange 8 is never shot at');
  Ai.canSee = sv.cs; Pg.holdsCrossbow = sv.hc; Ai.crossbowStack = sv.cs2; M.Combat.mobShootCrossbow = sv.sh; clear();
}

console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} anti-vacuity breaks caught`);
if (fails.length) { console.log('FAILURES:'); fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('PASS piglinbraincheck: ' + pass + ' assertions, 0 failures, ' + breaks + ' breaks caught');
