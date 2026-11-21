#!/usr/bin/env node
// lockstep-catmorning -- #8645 (G18b-L36): lockstep scenario catmorning, 20 salts x 700 ticks. Tamed cat beside a bed; the owner gets into bed at night
// (sky angle 0.70 + 0.0002/tick, owner sleepTimer counts 0..100 while asleep) and wakes at tick 450+salt*7, when the sky is in the 0.77..0.8 window.
// Per tick: cat inSleepingPose, headDown (lying-on-bed state), goal running (start condition). At wake: SleepWithOwnerGoal.stop -> nextFloat < 0.7,
// teleport(x+nextInt(11)-5, y+nextInt(5)-2, z+nextInt(11)-5), cat_morning_gift pick (6 x 10 + phantom_membrane 2), drop at (bx - sin(yaw), by, bz + cos(yaw)).
// Reference written from CatEntity.SleepWithOwnerGoal; the cat does not move in this lane (the pathing lane covers it), so velocity is 0 throughout.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js'], dom: false });
const Ai = M.Ai;
const BED = 100, FOOT = 101, blocks = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
blocks.set(key(5, 64, 0), FOOT); blocks.set(key(6, 64, 0), BED);
for (let x = -6; x <= 12; x++) for (let z = -8; z <= 8; z++) blocks.set(key(x, 50, z), 1);
M.World = { getBlock: (x, y, z) => blocks.get(key(x, y, z)) || 0 };
M.Tags = { ready: true, blockTag: () => 1, stateInCol: (c, s) => s === BED || s === FOOT };
M.Reg = { id: { lava: 998, water: 999 }, PROP: { part: 1, facing: 2 }, PVAL: { head: 'head', foot: 'foot', east: 'east' } };
M.States = { block: [], solid: [0, 1], waterIn: [], propValue: (s, p) => p === 1 ? (s === BED ? 'head' : 'foot') : 'east' };
M.Player = { dirStep: () => [1, 0] };
M.EntityList = { list: [] };
Ai.findPath = () => null; Ai.stepToward = () => {}; Ai.closeTo = () => true;
const stream = (salt) => { let s = (Math.imul(salt + 1, 2654435761) ^ 0x9e3779b9) >>> 0; for (let i = 0; i < 4; i++) s = (Math.imul(s ^ (s >>> 15), 2246822519) + 3266489917) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const VAN = [['rabbit_hide', 10], ['rabbit_foot', 10], ['chicken', 10], ['feather', 10], ['rotten_flesh', 10], ['string', 10], ['phantom_membrane', 2]];
const TICKS = 700, salts = Array.from({ length: 20 }, (_, i) => i);
const sleepAt = (s) => 20 + s * 3, wakeAt = (s) => 450 + s * 7, sky = (t) => 0.70 + t * 0.0002, yawOf = (s) => (s * 37) % 360;

function reference(salt) {
  const r = stream(salt + 900), ni = (n) => Math.floor(r() * n), tr = [];
  let timer = 0, run = false, ticksOn = 0, pose = false, head = false, gift = null;
  for (let t = 0; t < TICKS; t++) {
    const asleep = t >= sleepAt(salt) && t < wakeAt(salt);
    if (asleep) timer = Math.min(timer + 1, 100); else if (t >= wakeAt(salt)) { /* sleepTimer resets on wake */ }
    if (!run && asleep) { run = true; ticksOn = 0; }
    else if (run && !asleep) {
      run = false; pose = false;
      const wt = timer; timer = 0;
      if (wt >= 100 && sky(t) > 0.77 && sky(t) < 0.8 && r() < 0.7) {
        const x = 5 + ni(11) - 5, y = 64 + ni(5) - 2, z = 0 + ni(11) - 5;
        let q = r() * 62, item = null; for (const [n, w] of VAN) { if ((q -= w) < 0) { item = n; break; } }
        const a = yawOf(salt) * Math.PI / 180;
        gift = [t, x, 51, z, item, x - Math.sin(a), 51, z + Math.cos(a)];
      }
      ticksOn = 0; head = false;
    } else if (run) { ticksOn++; if (ticksOn > 16) { pose = true; head = false; } else head = true; }
    tr.push([run ? 1 : 0, pose ? 1 : 0, head ? 1 : 0].join());
  }
  return { tr, gift: gift && gift.join() };
}

function engine(salt) {
  const r = stream(salt + 900), tr = [], drops = [];
  const e = { type: 'cat', tamed: true, owner: 'player', sitting: false, x: 5.5, y: 64, z: 0.5, bodyYaw: yawOf(salt) };
  const o = { x: 6.5, y: 64, z: 0.5, sleeping: false, sleepTimer: 0 };
  let t = 0, gift = null;
  const g = new Ai.SleepWithOwnerGoal(e, () => [o], r, () => sky(t), (x, y, z, it) => drops.push([x, y, z, it]));
  let run = false;
  for (t = 0; t < TICKS; t++) {
    const asleep = t >= sleepAt(salt) && t < wakeAt(salt);
    o.sleeping = asleep; o.sleepTimer = asleep ? Math.min(o.sleepTimer + 1, 100) : o.sleepTimer;
    if (!run) { if (g.canUse()) { g.start(); run = true; } }
    else if (!g.canContinueToUse()) { g.stop(); run = false; o.sleepTimer = 0; if (drops.length) gift = [t, e.x, e.y, e.z, drops[0][3], drops[0][0], drops[0][1], drops[0][2]].join(); }
    else g.tick();
    tr.push([run ? 1 : 0, e.inSleepingPose ? 1 : 0, e.headDown ? 1 : 0].join());
  }
  return { tr, gift };
}

let bad = 0, breaks = 0;
const run = (report) => {
  let n = 0;
  for (const s of salts) {
    const a = reference(s), b = engine(s), i = a.tr.findIndex((v, k) => v !== b.tr[k]);
    const ga = a.gift && a.gift.split(','), gb = b.gift && b.gift.split(',');
    const gd = (!ga !== !gb) || (ga && (ga.slice(0, 5).join() !== gb.slice(0, 5).join() || ga.slice(5).some((v, k) => Math.abs(v - gb[5 + k]) > 1e-9)));
    if (i >= 0 || gd) { n++; if (report && n <= 3) console.log(`FAIL salt ${s} tick ${i}: ${a.tr[i]} vs ${b.tr[i]} gift ${a.gift} / ${b.gift}`); }
  }
  return n;
};
bad += run(true);
const gifts = salts.filter((s) => reference(s).gift).length;
if (gifts < 6 || gifts > 19) { bad++; console.log(`FAIL vacuous: ${gifts}/20 salts gift`); }
if (!reference(0).tr.some((x) => x === '1,1,0')) { bad++; console.log('FAIL vacuous: cat never lies asleep'); }
const mut = (name, fn) => {
  const save = [Ai.CAT_GIFT_CHANCE, Ai.CAT_GIFTS.map((x) => x.slice())];
  fn();
  const n = run(false);
  Ai.CAT_GIFT_CHANCE = save[0]; Ai.CAT_GIFTS.length = 0; save[1].forEach((x) => Ai.CAT_GIFTS.push(x));
  if (n) { breaks++; console.log('   ✓ break caught: ' + name); } else { bad++; console.log('NOT CAUGHT ' + name); }
};
mut('0.7 gift chance removed (always gifts)', () => { Ai.CAT_GIFT_CHANCE = 2; });
mut('gift chance 0.7 -> 0.5', () => { Ai.CAT_GIFT_CHANCE = 0.5; });
mut('phantom_membrane weight 2 -> 10', () => { Ai.CAT_GIFTS[6][1] = 10; });
console.log(`lockstep-catmorning: ${salts.length + 2 + breaks} assertions, ${bad} failures, ${breaks} breaks caught (${salts.length} salts x ${TICKS} ticks)`);
process.exit(bad ? 1 : 0);
