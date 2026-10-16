// lockstep-breed -- #6287 (G17-L39): lockstep scenario 'breed', 20 salts: two adult cows in a pen, wheat (Animal.lovePlayer) at tick 5, then the real BreedGoal.
// Reference = .decomp AnimalEntity.lovePlayer (inLove = 600) / tickMovement (inLove-- each tick) / breed (parents age 6000 + out of love, baby age -24000, orb nextInt(7)+1), AnimalMateGoal.tick (breed only after 60 goal ticks and squaredDistance < 9).
// Per tick: inLove must be 600-(t-5) until the birth tick; before the birth the cows' distance never grows beyond the start (approach); at the birth tick the baby, parents' cooldown and orb value (1..7) are checked, and the baby then ages +1 per tick.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
// lockstep-sleep -- #6333 (G17-L73): fox DelayedCalmDownGoal (.decomp FoxEntity 836-880) in a lit (sky visible) and an unlit room, 20 salts.
// Day 0-299, night 300-599, day again 600-899. Reference = an independent re-statement of canStart/shouldContinue/canNotCalmDown/stop (timer = nextInt(140), re-rolled on stop).
// Per tick the sleeping flag, the timer-driven fall-asleep tick and the wake tick are compared; pos must not change while asleep.
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const Fx = M.Fox;
const isDayAt = (t) => t < 300 || t >= 600;
function lane(salt, lit, fault) {
  const re = stream(salt + 100), rr = stream(salt + 100);   // engine and reference draw the same stream
  let t = 0;
  const e = { x: 0.5, y: 0, z: 0.5, height: 0.7, sleeping: false, sitting: false };
  const ctx = { random: re, isDay: () => fault ? !isDayAt(t) : isDayAt(t), canSeeSky: () => lit, favor: () => 0, worriers: () => [] };
  const g = new Fx.DelayedCalmDownGoal(e, ctx);
  let timer = Math.floor(rr() * 140), sleeping = false, running = false;
  const canNot = () => { if (timer > 0) { timer--; return false; } return isDayAt(t) && !lit; };
  let bad = null;
  for (t = 0; t < 900 && !bad; t++) {
    if (!running) { if (g.canUse()) { g.start(); running = true; } }
    else if (!g.canContinueToUse()) { g.stop(); running = false; }
    else if (g.tick) g.tick();
    if (!sleeping) { if (canNot() || false) { sleeping = true; } }
    else if (!canNot()) { sleeping = false; timer = Math.floor(rr() * 140); }
    if (e.sleeping !== sleeping) bad = `tick ${t} sleeping ${e.sleeping} vs ${sleeping} (${lit ? 'lit' : 'unlit'}, ${isDayAt(t) ? 'day' : 'night'})`;
    else if (e.x !== 0.5 || e.z !== 0.5) bad = `tick ${t} moved while sleeping`;
  }
  return bad;
}
for (let s = 0; s < 20; s++) { for (const lit of [false, true]) { const r = lane(s, lit); ok(!r, `sleep salt ${s} ${lit ? 'lit' : 'unlit'} ${r}`); } }

// cat lane -- CatEntity GoToBedAndSleepGoal (MoveToTargetPosGoal, interval 80 ticks of our selection) canUse: tamed, not sitting, not already sleeping, cooldown, bed with air above within range.
// Reference = independent statement of the cooldown (canUse decrements while >0, else re-arms to 80 and scans). A world with one bed block (and an air block above it) is stubbed in.
{
  const W = M.World, realGet = W.getBlock, Tg = M.Tags;
  const catLane = (salt, fault) => {
    const bedAt = salt % 3 === 0 ? null : [2 + salt % 4, 3, salt % 5 - 2];   // y=3: the jar scan visits dy -2,3,-3,4.. from lowestY -2 (never 0)
    const e = { x: 0.5, y: 1, z: 0.5, tamed: true, sitting: false, inSleepingPose: false, sitPose: false, type: 'cat' };
    const saved = [Tg.blockTag, Tg.stateInCol, Tg.ready];
    Tg.ready = true; Tg.blockTag = () => 1; Tg.stateInCol = (c, st) => st === 999;
    W.getBlock = (x, y, z) => (bedAt && x === bedAt[0] && y === bedAt[1] && z === bedAt[2]) ? 999 : 0;
    let bad = null;
    try {
      const g = new M.Ai.GoToBedAndSleepGoal(e, 0.8, 8);
      let cd = 0;
      for (let t = 0; t < 400 && !bad; t++) {
        e.sitting = (t >= 150 && t < 200);                      // ordered to sit for a while: never starts
        let want;
        if (e.sitting || e.inSleepingPose) want = false;
        else if (cd > 0) { cd--; want = false; } else { cd = 80; want = !!bedAt; }
        const got = fault && t === 100 ? !g.canUse() : g.canUse();
        if (got !== want) bad = 'tick ' + t + ' canUse ' + got + ' vs ' + want + ' (cat bed ' + (bedAt ? 'in range' : 'absent') + ')';
      }
    } finally { W.getBlock = realGet; Tg.blockTag = saved[0]; Tg.stateInCol = saved[1]; Tg.ready = saved[2]; }
    return bad;
  };
  for (let s = 0; s < 20; s++) { const r = catLane(s); ok(!r, 'cat salt ' + s + ' ' + r); }
  globalThis.__catLane = catLane;
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const r = lane(3, false, true); brk(!!r, `wake condition inverted reported: ${r}`); }
{ const r = lane(7, false, true); brk(!!r, `inverted day reported on another salt: ${r}`); }
{ const r = globalThis.__catLane(1, true); brk(!!r, `cat canUse flipped reported: ${r}`); }
{ const r = globalThis.__catLane(3, true); brk(!!r, `cat flipped, no-bed salt reported: ${r}`); }
console.log(`lockstep-sleep: ${60 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
