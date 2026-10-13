#!/usr/bin/env node
// piglincrossbowcheck.mjs — #6444: the piglin crossbow fight (PiglinBrain.addFightActivities: AttackTask(5, 0.75) back-off,
// RangedApproachTask, CrossbowAttackTask) over 200 ticks with a scripted target, against an independent per-tick model of
// CrossbowAttackTask.tickState (UNCHARGED -> CHARGING -> CHARGED -> READY_TO_ATTACK) and the 5-block back-off.
//   node tools/piglincrossbowcheck.mjs
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
const clear = () => { EL.list.length = 0; };
if (Hg && Hg.init) Hg.init();


Pg.init();
console.log('piglincrossbowcheck — #6444: piglin crossbow task state machine + 5-block back-off');
const Ai = M.Ai;
Ai.strafeWalkable = () => true; Ai.canSee = () => true; Pg.holdsCrossbow = () => true; Ai.crossbowStack = () => ({});
let shots = 0; M.Combat.mobShootCrossbow = () => { shots++; };
// target distance per tick: in approach window, inside back-off, out of range, back in
const dist = (t) => t < 60 ? 6 : t < 100 ? 3 : t < 130 ? 9 : t < 170 ? 7.5 : 4.9;
// reference model: CrossbowAttackTask.java tickState + AttackTask(5,.75)
function model() {
  let st = 0, charge = 0, cd = 0, n = 0; const rows = [];
  for (let t = 0; t < 200; t++) {
    const d = dist(t); let fired = 0;
    const back = d <= 5;
    if (d > 8) { st = 0; }
    else if (st === 0) { st = 1; charge = 0; }
    else if (st === 1) { if (++charge >= Ai.crossbowPullTicks({})) { st = 2; cd = 20; } }
    else if (st === 2) { if (--cd === 0) st = 3; }
    else { fired = 1; st = 0; }
    rows.push(back ? -0.75 : 0, st, fired);
  }
  return rows;
}
function run(Goal) {
  clear(); shots = 0;
  const p = EL.spawn('piglin', 0.5, 64, 0.5), v = EL.spawn('piglin', 6.5, 64, 0.5);
  p.target = v; p.yaw = -Math.PI / 2;
  const g = Goal(p); g.start(); const rows = [];
  for (let t = 0; t < 200; t++) {
    p.x = 0.5; p.z = 0.5; v.x = 0.5 + dist(t); v.z = 0.5; p.zza = 0;
    const before = shots; g.tick();
    const z = p.zza < 0 ? Math.round(p.zza * 1e6) / 1e6 : 0;
    const charging = p.crossbowCharging ? 1 : 0;
    rows.push(z, charging, shots - before);
  }
  return rows;
}
const exp = model();
// model state -> observable: charging flag is true only in state 1 (CHARGING)
const expObs = []; for (let i = 0; i < exp.length; i += 3) expObs.push(exp[i], exp[i + 1] === 1 ? 1 : 0, exp[i + 2]);
const real = (c) => new Pg.CrossbowTaskGoal(c, { random: () => 0 });
const first = run(real);
let bad = -1; for (let i = 0; i < expObs.length; i++) if (expObs[i] !== first[i]) { bad = i; break; }
ok(bad < 0, 'per-tick back-off/charge/shot trace matches CrossbowAttackTask over 200 ticks' + (bad < 0 ? '' : ' (first diff tick ' + Math.floor(bad / 3) + ': want ' + expObs.slice(bad - bad % 3, bad - bad % 3 + 3) + ' got ' + first.slice(bad - bad % 3, bad - bad % 3 + 3) + ')'));
ok(first.filter((_, i) => i % 3 === 2).reduce((a, b) => a + b, 0) >= 2, 'the script fires at least twice (not vacuous)');
// anti-vacuity: the pillager stand-in, and a wrong back-off, must both diverge
const differs = (rows) => rows.some((r, i) => r !== expObs[i]);
const stand = run((c) => new Ai.CrossbowAttackGoal(c, 1.0, 8, { random: () => 0 }));
breaks++; if (ok(differs(stand), 'anti-vacuity: the pillager CrossbowAttackGoal stand-in does not match the trace')) console.log("   ✓ break caught");
const kb = Pg.CROSSBOW_BACKOFF_RANGE; Pg.CROSSBOW_BACKOFF_RANGE = 3;
breaks++; if (ok(differs(run(real)), 'anti-vacuity: back-off range 3 instead of 5 is caught')) console.log("   ✓ break caught"); Pg.CROSSBOW_BACKOFF_RANGE = kb;
const ks = Pg.CROSSBOW_BACKOFF_SPEED; Pg.CROSSBOW_BACKOFF_SPEED = 1;
breaks++; if (ok(differs(run(real)), 'anti-vacuity: back-off speed 1 instead of 0.75 is caught')) console.log("   ✓ break caught"); Pg.CROSSBOW_BACKOFF_SPEED = ks;
clear();
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { fails.forEach((f) => console.log('  - ' + f)); process.exit(1); }
console.log('PASS piglincrossbowcheck: ' + pass + ' assertions, 0 failures, ' + breaks + ' breaks caught');
