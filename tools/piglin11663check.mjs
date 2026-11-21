#!/usr/bin/env node
// piglin11663check.mjs — #11663: proves 07zzf_piglin.js is REACHED from EntityList's mob dispatch
// (07i_entitylist.js -> Piglin.tickEntity / Ai.ROSTER) and that cutting each rule breaks a scenario. Vanilla class
// names it covers: PiglinSpecificSensor (nearestRepellent 8/4, nemesis, nearbyAdultPiglins, hasOutnumberedHoglins),
// AdmireItemTask + AdmireItemTimeLimitTask (120-tick admire, barter on close), HuntHoglinTask + MemoryTransferTask
// (hunt, group memory, baby -> RIDE_TARGET), DefeatTargetTask + HuntFinishTask + GoToCelebrateTask (300-tick celebrate),
// ForgetAngryAtTargetTask, UpdateAttackTargetTask (TargetGoal), AttackTask + MeleeAttackTask + CrossbowAttackTask
// (roster goals), RidingTask + StartRidingTask, WalkToNearestVisibleWantedItemTask, PiglinBruteBrain + PiglinBruteEntity
// (brute roster/angry sound) and SoundEvent (activitySound ids).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT, initRegistry } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

function trial(patch) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js',
    '14f_inventory.js', '07h_entities.js', '07y_equip.js', '07ox_enchhelper.js', '07i_entitylist.js', '07l_spawn.js',
    '07m_breed.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js', '07q_effects.js', '07k_goals.js',
    '07zz_xporb.js', '07s_raid.js', '07zzf_piglin.js', '07zzg_hoglin.js', '07j_entityrender.js', '14e_gamemode.js'], dom: false,
    patch: patch ? (f, s) => (f === '07zzf_piglin.js' ? patch(s) : s) : undefined });
  if (initRegistry) initRegistry(M);
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.EntityList.init(); M.Equip.init();
  for (const k of ['Breed', 'EnchHelper', 'Effects', 'Xp']) if (M[k] && M[k].init) M[k].init();
  M.Combat.init();
  if (M.Ai && M.Ai.init && !M.Ai.ready) M.Ai.init();
  const EL = M.EntityList, Pg = M.Piglin, Hg = M.Hoglin, Iv = M.Inventory;
  Pg.init(); if (Hg && Hg.init) Hg.init();
  M.Sound = M.Sound || {}; M.Sound.mobSound = (e, id) => { o.sounds.push(id); };
  const o = { sounds: [] };
  const REP = 777, cells = {};
  M.World = { getBlock: (x, y, z) => cells[x + ',' + y + ',' + z] || 0, get: () => null, dimType: () => ({ piglinSafe: true }) };
  M.Tags.stateIn = (tag, st) => (tag === 'piglin_repellents' || tag === 'hoglin_repellents') && st === REP;
  const clear = () => { EL.list.length = 0; for (const k in cells) delete cells[k]; };
  const mk = (type, x, z, r = 0.9, opts) => { const p = EL.random; EL.random = () => r; try { return EL.spawn(type, x, 64, z, opts); } finally { EL.random = p; } };
  const fresh = (...es) => es.forEach((e) => { delete e.pgHuntedUntil; });   // spawn remembers HUNTED_RECENTLY (initPiglin)
  const tick = (e, n = 1) => { for (let i = 0; i < n; i++) Pg.tickEntity(e); };

  // PiglinSpecificSensor
  clear(); const s = mk('piglin', 0.5, 0.5);
  cells['8,64,0'] = REP; const r1 = Pg.nearestRepellent(s); o.repIn = !!r1;
  clear(); const s2 = mk('piglin', 0.5, 0.5); cells['9,64,0'] = REP; o.repFarH = !Pg.nearestRepellent(s2);
  clear(); const s3 = mk('piglin', 0.5, 0.5); cells['0,69,0'] = REP; o.repFarV = !Pg.nearestRepellent(s3);
  clear(); const n1 = mk('piglin', 0.5, 0.5); mk('wither_skeleton', 4.5, 0.5); o.nemesis = !!Pg.nemesis(n1);
  clear(); const n2 = mk('piglin', 0.5, 0.5); mk('cow', 4.5, 0.5); o.noNemesis = !Pg.nemesis(n2);
  clear(); const n3 = mk('piglin', 0.5, 0.5); const b1 = mk('piglin', 2.5, 0.5); const bb = mk('piglin', 3.5, 0.5); bb.isBaby = true;
  o.mates = Pg.nearbyAdultPiglins(n3).length === 1 && Pg.nearbyAdultPiglins(n3)[0] === b1;
  clear(); const n4 = mk('piglin', 0.5, 0.5); mk('hoglin', 3.5, 0.5); mk('hoglin', 4.5, 0.5);
  o.outnum = Pg.hasOutnumberedHoglins(n4) === true;
  mk('piglin', 5.5, 0.5); o.notOutnum = Pg.hasOutnumberedHoglins(n4) === false;

  // HuntHoglinTask + MemoryTransferTask (group memory), via the real per-tick entry point
  clear(); const h1 = mk('piglin', 0.5, 0.5), h2 = mk('piglin', 2.5, 0.5); const hog = mk('hoglin', 6.5, 0.5); fresh(h1, h2);
  tick(h1);
  o.huntAngry = Pg.angryAt(h1) === hog && Pg.huntedRecently(h1);
  o.huntGroup = h2.pgHuntedUntil !== undefined && Pg.angryAt(h2) === hog;
  clear(); const hb1 = mk('piglin', 0.5, 0.5); const bh = mk('hoglin', 6.5, 0.5); bh.isBaby = true; fresh(hb1); tick(hb1);
  o.huntNotBaby = !Pg.angryAt(hb1);
  clear(); const hb2 = mk('piglin', 0.5, 0.5); mk('hoglin', 6.5, 0.5); hb2.isBaby = true; fresh(hb2); tick(hb2);
  o.babyNoHunt = !Pg.angryAt(hb2);
  clear(); const hb3 = mk('piglin', 0.5, 0.5); mk('hoglin', 6.5, 0.5); hb3.pgCannotHunt = true; fresh(hb3); tick(hb3);
  o.cannotHunt = !Pg.angryAt(hb3);
  // HuntFinishTask / DefeatTargetTask / GoToCelebrateTask: the hunted hoglin dies -> 300-tick celebrate
  clear(); const c1 = mk('piglin', 0.5, 0.5); const ch = mk('hoglin', 6.5, 0.5); fresh(c1); tick(c1);
  ch.dead = true; ch.health = 0; tick(c1);
  o.celebrate = Pg.isCelebrating(c1) && c1.pgCelebrateUntil === c1.pgClock + 300 - 0 && o.sounds.includes('entity.piglin.celebrate');
  tick(c1, 300); o.celebrateEnds = !Pg.isCelebrating(c1);
  // ForgetAngryAtTargetTask
  clear(); const f1 = mk('piglin', 0.5, 0.5); const cow = mk('cow', 3.5, 0.5);
  Pg.becomeAngryWith(f1, cow); o.angryKeep = Pg.angryAt(f1) === cow;
  cow.dead = true; cow.health = 0; o.forgetDead = Pg.angryAt(f1) === null;
  const cow2 = mk('cow', 3.5, 0.5); f1.pgClock = 0; Pg.becomeAngryWith(f1, cow2); f1.pgClock += Pg.ANGER_TICKS + 1; o.forgetExpiry = Pg.angryAt(f1) === null;

  // AdmireItemTask / AdmireItemTimeLimitTask: gold in offhand is admired 120 ticks, then bartered
  clear(); const a1 = mk('piglin', 0.5, 0.5);
  Pg.setAdmiring(a1); Pg.swapOffhand(a1, Iv.stack('gold_ingot', 1, 0, null));
  tick(a1, 20); o.admiring = Pg.isAdmiring(a1) && !!Pg.offhand(a1);
  tick(a1, 130); o.barterAfter = !Pg.isAdmiring(a1) && !Pg.offhand(a1);
  clear(); const a2 = mk('piglin', 0.5, 0.5); Pg.swapOffhand(a2, Iv.stack('gold_ingot', 1, 0, null)); Pg.setAdmiring(a2);
  tick(a2, 60); o.notEarly = !!Pg.offhand(a2);
  o.admireNums = Pg.ADMIRE_TICKS === 120 && Pg.ADMIRE_TIMEOUT === 200 && Pg.ADMIRE_COOLDOWN === 200;

  // WalkToNearestVisibleWantedItemTask: nearest wanted item within 9, gold in offhand blocks it
  clear(); const w1 = mk('piglin', 0.5, 0.5); EL.dropStack(5.5, 64, 0.5, M.Items.of('gold_ingot'), 1, { pickupDelay: 0 });
  o.wantItem = !!Pg.nearestWantedItem(w1, 9);
  o.wantRange = !Pg.nearestWantedItem(w1, 3);
  Pg.swapOffhand(w1, Iv.stack('gold_ingot', 1, 0, null)); o.goalBlockedByGold = new Pg.WalkToItemGoal(w1).canUse() === false;
  Pg.offhandClear(w1); o.goalOpen = new Pg.WalkToItemGoal(w1).canUse() === true;

  // UpdateAttackTargetTask (TargetGoal) + AttackTask/MeleeAttackTask/CrossbowAttackTask (roster)
  clear(); const t1 = mk('piglin', 0.5, 0.5); mk('wither_skeleton', 5.5, 0.5);
  const tg = new Pg.TargetGoal(t1); o.targetsNemesis = tg.canUse() && t1.target && t1.target.type === 'wither_skeleton';
  clear(); const t2 = mk('piglin', 0.5, 0.5); t2.isBaby = true; mk('wither_skeleton', 5.5, 0.5); o.babyNoTarget = !new Pg.TargetGoal(t2).canUse();
  clear(); const rp = mk('piglin', 0.5, 0.5), rb = mk('piglin_brute', 2.5, 0.5);
  o.rosterPiglin = M.Ai.ROSTER.piglin === Pg.roster && M.Ai.ROSTER.piglin_brute === Pg.roster;
  const gsP = Pg.roster(rp, { random: EL.random, players: () => [] }), gsB = Pg.roster(rb, { random: EL.random, players: () => [] });
  const goalsP = JSON.stringify(gsP, (k, v) => (typeof v === 'function' ? undefined : v));
  o.rosterHasGoals = !!gsP && !!gsB;
  o.holdsCrossbow = typeof Pg.holdsCrossbow === 'function' && Pg.holdsCrossbow(rp) === false;
  o.meleeLive = (() => { const g = new Pg.MeleeTaskGoal(rp, 1); rp.target = null; const a = g.canUse(); rp.target = rb; return a === false && g.canUse() === true; })();
  o.crossbowGoal = typeof Pg.CrossbowTaskGoal === 'function';

  // RidingTask / StartRidingTask / MemoryTransferTask(isBaby -> RIDE_TARGET)
  clear(); const rd = mk('piglin', 0.5, 0.5); rd.isBaby = true; const bhg = mk('hoglin', 1.0, 0.5); bhg.isBaby = true;
  tick(rd); o.rideTarget = Pg.rideTarget(rd) === bhg;
  tick(rd); o.rideStart = rd.vehicle === bhg;
  bhg.dead = true; bhg.health = 0; tick(rd); o.rideEnds = !rd.vehicle && !Pg.rideTarget(rd);
  clear(); const rd2 = mk('piglin', 0.5, 0.5); rd2.isBaby = true; const ahg = mk('hoglin', 1.0, 0.5); tick(rd2); o.adultNoRide = !Pg.rideTarget(rd2) && rd2.pgRideUntil === undefined;

  // PiglinBruteBrain / PiglinBruteEntity
  clear(); const br = mk('piglin_brute', 0.5, 0.5);
  o.bruteNoHunt = Pg.canHunt(br) === false;
  const voice = []; M.MobVoice = { playAngry: (e) => voice.push(e) }; br.target = mk('wither_skeleton', 3.5, 0.5);
  tick(br); o.bruteAngry = voice.length === 1;
  clear(); const br2 = mk('piglin_brute', 0.5, 0.5); mk('wither_skeleton', 5.5, 0.5);
  o.bruteIdle = typeof Pg.bruteIdlePick === 'function';

  // SoundEvent ids (PiglinBrain.getSound)
  clear(); const so = mk('piglin', 0.5, 0.5);
  o.sndAmbient = Pg.activitySound(so) === 'entity.piglin.ambient';
  Pg.setAdmiring(so); o.sndAdmire = Pg.activitySound(so) === 'entity.piglin.admiring_item'; Pg.forgetAdmiring(so);
  Pg.becomeAngryWith(so, mk('cow', 3.5, 0.5)); o.sndAngry = Pg.activitySound(so) === 'entity.piglin.angry';
  return o;
}
const A0 = trial(null);
for (const k of Object.keys(A0)) if (k !== 'sounds') ok(A0[k], 'scenario ' + k);
const el = readFileSync(join(MCLITE_ROOT, 'src', '07i_entitylist.js'), 'utf8');
ok(/NS\.Piglin\.tickEntity\(e\)/.test(el), 'reach: EntityList mob dispatch -> Piglin.tickEntity');
const pg = readFileSync(join(MCLITE_ROOT, 'src', '07zzf_piglin.js'), 'utf8');
ok(/Pg\.tickHunt\(e\)/.test(pg) && /Pg\.tickAdmire\(e\)/.test(pg) && /Pg\.tickRide\(e\)/.test(pg) && /Pg\.lootTick\(e\)/.test(pg), 'reach: tickEntity -> hunt/admire/ride/loot');
ok(/ROSTER\.piglin = Pg\.roster/.test(pg), 'reach: Ai.ROSTER -> Pg.roster');
const BR = [
  ['reph', 'Pg.REPEL_H', 'Pg.REPEL_H + 1', ['repFarH']],
  ['nemesis', 'return nearest(e, function (o) { return !!Pg.NEMESIS[o.type]; }', 'return nearest(e, function (o) { return false; }', ['nemesis']],
  ['adultmates', '!Pg.TYPES[o.type] || !alive(o) || Pg.isBaby(o)', '!Pg.TYPES[o.type] || !alive(o)', ['mates']],
  ['outnumber', 'n > Pg.nearbyAdultPiglins(e).length + 1', 'n > Pg.nearbyAdultPiglins(e).length', ['notOutnum']],
  ['huntcan', 'if (!Pg.canHunt(e) || Pg.isBaby(e) || Pg.huntedRecently(e)) return false;', 'if (Pg.huntedRecently(e)) return false;', ['babyNoHunt']],
  ['huntgroup', 'for (var i = 0; i < mates.length; i++) Pg.rememberHunting(mates[i]);', '', ['huntGroup']],
  ['huntadult', "o.type === 'hoglin' && Hg.isAdult(o)", "o.type === 'hoglin'", ['huntNotBaby']],
  ['celebticks', 'Pg.CELEBRATE_TICKS = 300', 'Pg.CELEBRATE_TICKS = 30', ['celebrate']],
  ['celebstart', 'Pg.startCelebrating(e, dead);', '', ['celebrate']],
  ['forgetdead', ['if (!alive(e.angryAtEnt)) {', 'if (false) {', 'return !(Ai && Ai.canTargetLiving) || Ai.canTargetLiving(t);', 'return true;'], null, ['forgetDead']],
  ['forgetexp', 'e.pgClock > e.angryAtUntil', 'false', ['forgetExpiry']],
  ['admire', 'Pg.ADMIRE_TICKS = 120', 'Pg.ADMIRE_TICKS = 12', ['admiring']],
  ['barterclose', 'if (Pg.offhand(e) && !Pg.isAdmiring(e)) Pg.consumeOffHand(e, true);', '', ['barterAfter']],
  ['nogold', 'Pg.canGatherItem(e, I.nameOf(o.item), o.count | 0)) { bd = d;', 'false) { bd = d;', ['wantItem']],
  ['targetadult', "if (e.type === 'piglin' && !Pg.isAdult(e)) return false;", '', ['babyNoTarget']],
  ['ridemem', "o.type === 'hoglin' && o.isBaby; }, Pg.SENSE_RANGE", "o.type === 'hoglin'; }, Pg.SENSE_RANGE", ['adultNoRide']],
  ['ridestart', 'Rd.startRiding(e, top);', '', ['rideStart']],
  ['rideend', '(!(alive(o) && dist(e, o) <= 8) || Pg.canRideEnds(e, o))', 'false', ['rideEnds']],
  ['brutehunt', "return e.type === 'piglin' && !e.pgCannotHunt;", 'return !e.pgCannotHunt;', ['bruteNoHunt']],
  ['bruteangry', 'if (fight && NS.MobVoice) NS.MobVoice.playAngry(e);', '', ['bruteAngry']],
  ['sndangry', "return 'entity.piglin.angry';", "return 'entity.piglin.ambient';", ['sndAngry']],
  ['sndadmire', "return 'entity.piglin.admiring_item';", "return 'entity.piglin.ambient';", ['sndAdmire']],
  ['rosterreg', 'Ai.ROSTER.piglin = Pg.roster;', '', ['rosterPiglin']],
];
for (const [key, a, b, expect] of BR) {
  breaks++; let hit = false, X;
  const prs = Array.isArray(a) ? [[a[0], a[1]], [a[2], a[3]]] : [[a, b]];
  const pf = (s) => { for (const [x, y] of prs) if (s.includes(x)) { hit = true; s = s.split(x).join(y); } return s; };
  try { X = trial(pf); } catch (e) { X = {}; }
  if (!hit) { fails.push('no-op break: ' + key); continue; }
  const caught = expect.some((q) => !X[q]);
  ok(caught, 'anti-vacuity: break ' + key);
  if (caught) console.log('  ✓ break caught: ' + key);
}
for (const f of fails) console.log('FAIL', f);
console.log(`piglin11663check: ${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
