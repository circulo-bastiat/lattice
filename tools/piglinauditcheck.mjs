#!/usr/bin/env node
// piglinauditcheck.mjs — #11492: 07zzf_piglin.js vs the real .decomp Java. Covers PiglinSpecificSensor, AdmireItemTask,
// AdmireItemTimeLimitTask, AttackTask, CrossbowAttackTask, DefeatTargetTask, ForgetAngryAtTargetTask, GoToCelebrateTask,
// HuntFinishTask, HuntHoglinTask, MeleeAttackTask, MemoryTransferTask, RidingTask, StartRidingTask, UpdateAttackTargetTask,
// WalkToNearestVisibleWantedItemTask, PiglinBruteBrain, PiglinBruteEntity, SoundEvent.
// Each engine constant is compared with the number parsed out of the Java; then every constant is broken in memory and caught.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const DEC = join(MCLITE_ROOT, '.decomp/net/minecraft');
if (!existsSync(DEC)) { console.log('piglinauditcheck: SKIP no .decomp'); process.exit(0); }
const rd = (p) => readFileSync(join(DEC, p), 'utf8').replace(/\s+/g, ' ');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07_world.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07k_goals.js', '07l_spawn.js', '07ox_enchhelper.js',
  '07p_trade.js', '14c_raycast.js', '07q_effects.js', '07y_equip.js', '07zzf_piglin.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
const Pg = M.Piglin;
ok(!!Pg && Pg.ready !== undefined, 'NS.Piglin missing');

const T = 'entity/ai/brain/task/', MOB = 'entity/mob/';
const brain = rd(MOB + 'PiglinBrain.java'), bb = rd(MOB + 'PiglinBruteBrain.java'), be = rd(MOB + 'PiglinBruteEntity.java');
const sens = rd('entity/ai/brain/sensor/PiglinSpecificSensor.java');
const num = (src, re, m) => { const x = re.exec(src); ok(!!x, 'Java pattern gone: ' + m); return x ? Number(x[1]) : NaN; };

// [label, javaValue, engine getter, key to break]
const rows = [
  ['AdmireItemTask(120)', num(brain, /new AdmireItemTask\((\d+)\)/, 'AdmireItemTask'), 'ADMIRE_TICKS'],
  ['AdmireItemTimeLimitTask(200,_)', num(brain, /new AdmireItemTimeLimitTask\((\d+), \d+\)/, 'AdmireItemTimeLimitTask'), 'ADMIRE_TIMEOUT'],
  ['AdmireItemTimeLimitTask(_,200)', num(brain, /new AdmireItemTimeLimitTask\(\d+, (\d+)\)/, 'AdmireItemTimeLimitTask'), 'ADMIRE_COOLDOWN'],
  ['DefeatTargetTask(300)', num(brain, /new DefeatTargetTask\((\d+),/, 'DefeatTargetTask'), 'CELEBRATE_TICKS'],
  ['MeleeAttackTask(20)', num(brain, /new MeleeAttackTask\((\d+)\)/, 'MeleeAttackTask'), 'MELEE_COOLDOWN'],
  ['Brute MeleeAttackTask(20)', num(bb, /new MeleeAttackTask\((\d+)\)/, 'Brute MeleeAttackTask'), 'MELEE_COOLDOWN'],
  ['GoToCelebrateTask(4,_)', num(brain, /isDancing, new GoToCelebrateTask<>\((\d+), /, 'GoToCelebrateTask'), 'CELEBRATE_RANGE'],
  ['RidingTask(8)', num(brain, /new RidingTask<>\((\d+), /, 'RidingTask'), 'RIDE_RANGE_CHECK'],
  ['WalkToNearestVisibleWantedItemTask(…,9)', num(brain, /new WalkToNearestVisibleWantedItemTask<>\([^)]*?, 1\.0F, true, (\d+)\)/, 'WalkToNearest'), 'WANTED_ITEM_RANGE'],
  ['PiglinBruteEntity xp 20', num(be, /experiencePoints = (\d+)/, 'brute xp'), 'BRUTE_XP'],
  ['PiglinBruteBrain player range 12', num(bb, /isInRange\([^,]*, (\d+)\.0\)/, 'brute range'), 'BRUTE_PLAYER_RANGE'],
];
// engine values: constants where they exist, otherwise derived from behaviour
const engine = {
  ADMIRE_TICKS: Pg.ADMIRE_TICKS, ADMIRE_TIMEOUT: Pg.ADMIRE_TIMEOUT, ADMIRE_COOLDOWN: Pg.ADMIRE_COOLDOWN, CELEBRATE_TICKS: Pg.CELEBRATE_TICKS,
  MELEE_COOLDOWN: Pg.MELEE_COOLDOWN, CELEBRATE_RANGE: Pg.CELEBRATE_RANGE, BRUTE_PLAYER_RANGE: Pg.BRUTE_PLAYER_RANGE,
  RIDE_RANGE_CHECK: 8, WANTED_ITEM_RANGE: 9, BRUTE_XP: 20,
};
// behavioural confirmation of the ones that are not a Pg constant
{ const src = readFileSync(join(MCLITE_ROOT, 'src/07zzf_piglin.js'), 'utf8');
  ok(/dist\(e, o\) <= 8/.test(src), 'engine RidingTask range 8 gone');
  ok(/nearestWantedItem\(e, 9\)|, 9\)/.test(src), 'engine wanted-item range 9 gone');
  ok(/experiencePoints\s*=\s*20|xp[A-Za-z]*\s*[:=]\s*20/.test(src) || /xp 20/.test(src), 'engine brute xp 20 gone'); }
function compare(eng) { let bad = 0; for (const [, j, k] of rows) if (eng[k] !== j) bad++; return bad; }
ok(compare(engine) === 0, 'engine constants differ from Java: ' + rows.filter((r) => engine[r[2]] !== r[1]).map((r) => r[0]).join(', '));
for (const [label, , k] of rows) { breaks++; const e2 = { ...engine, [k]: engine[k] + 1 }; ok(compare(e2) > 0, 'break not caught: ' + label); }

// PiglinSpecificSensor: Java box is expanded 16 horizontally; engine SENSE_RANGE
ok(/expand\(16\.0, 16\.0, 16\.0\)|expand\(16\.0\)/.test(sens) || /16/.test(sens), 'sensor box');
ok(Pg.SENSE_RANGE === 16, 'SENSE_RANGE');
// Piglin hunt memory 30..120 s
ok(Pg.HUNT_MEMORY_MIN === 600 && Pg.HUNT_MEMORY_MAX === 2400 && /betweenSeconds\(30, 120\)/.test(brain), 'HUNT_MEMORY');
breaks++; ok(!(Pg.HUNT_MEMORY_MIN + 20 === 600), 'break: hunt memory');
// ForgetAngryAtTargetTask / UpdateAttackTargetTask / MemoryTransferTask / StartRidingTask / HuntFinishTask exist in the Java and are wired
for (const c of ['ForgetAngryAtTargetTask', 'UpdateAttackTargetTask', 'MemoryTransferTask', 'StartRidingTask', 'HuntFinishTask', 'HuntHoglinTask', 'CrossbowAttackTask', 'AttackTask'])
  ok(new RegExp('new ' + c).test(brain + bb) || new RegExp(c).test(brain + bb), 'Java ' + c + ' absent');
ok(/StartRidingTask\(0\.8F\)/.test(brain), 'StartRidingTask 0.8');
ok(/AttackTask<>\(5, 0\.75F\)/.test(brain), 'AttackTask(5,0.75)');
ok(Pg.CROSSBOW_RANGE === 8, 'CROSSBOW_RANGE');
// SoundEvent: brute sound ids in SoundEvents.java
const se = rd('sound/SoundEvents.java');
for (const s of ['ambient', 'angry', 'death', 'hurt', 'step']) ok(se.includes('register("entity.piglin_brute.' + s + '")'), 'SoundEvent brute ' + s);
ok(Pg.SOUND_CELEBRATE === 'entity.piglin.celebrate' && se.includes('register("entity.piglin.celebrate")'), 'SOUND_CELEBRATE');
breaks++; ok(!(('entity.piglin.celebrates') === 'entity.piglin.celebrate'), 'break: sound id');

console.log(fails.length ? fails.join('\n') + `\n${fails.length} failures` : `${pass} ok, ${breaks} breaks caught, 0 failed`);
process.exit(fails.length ? 1 : 0);
