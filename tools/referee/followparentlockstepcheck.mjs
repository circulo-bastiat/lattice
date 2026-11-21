// lockstep-followparent -- #7101 (G18b-L10): lockstep scenario 'followparent', 20 salts: baby cow/pig/sheep/chicken/horse with an adult 5, 9 and 30 blocks away.
// Reference = .decomp FollowParentGoal (canStart: baby, nearest same-class adult in the 8x4x8 box, sqDist < 9 refuses; shouldContinue 9 <= sqDist <= 256; start delay=0, tick --delay<=0 -> delay=10, startMovingTo at `speed`),
// cow/pig/sheep/chicken/horse initGoals speeds. Includes a nearer adult of a DIFFERENT species (must be ignored) and a nearer baby (must be ignored).
// Per tick: running flag, chosen parent, path recalcs (every 10 ticks), step speed.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js'], dom: false });
const Ai = M.Ai;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
M.World = { getBlock: () => 0 };
const MOBS = [['cow', 1.25], ['pig', 1.1], ['sheep', 1.1], ['chicken', 1.0], ['horse', 1.0]];
function lane(salt, type, speed) {
  const sep = [5, 9, 30][salt % 3], off = (salt % 7) * 0.13;
  let calls = [], steps = [];
  Ai.findPath = (x, y, z, tx, ty, tz) => { calls.push([tx, tz]); return [[x, y, z], [tx, ty, tz]]; };
  Ai.stepToward = (e, p, sp) => { steps.push(sp); e.x += Math.sign(p[0] - e.x) * 0.05; e.z += Math.sign(p[2] - e.z) * 0.05; };
  Ai.closeTo = () => false;
  const adult = { type, x: sep + off, y: 64, z: 0.5, isBaby: false, width: 0.9, height: 1.4 };
  const baby = { type, x: 0.5, y: 64, z: 0.5, isBaby: true, width: 0.45, height: 0.7 };
  const other = { type: type === 'cow' ? 'pig' : 'cow', x: 2.5, y: 64, z: 0.5, isBaby: false, width: 0.9, height: 1.4 };
  const kid2 = { type, x: 1.5, y: 64, z: 1.5, isBaby: true, width: 0.45, height: 0.7 };
  const all = [baby, adult, other, kid2];
  const g = new Ai.FollowParentGoal(baby, speed, () => all);
  const R = { run: false, delay: 0 };
  const sq = () => (adult.x - baby.x) ** 2 + (adult.y - baby.y) ** 2 + (adult.z - baby.z) ** 2;
  for (let t = 1; t <= 200; t++) {
    adult.x = sep + off + (t > 100 ? 0 : 0);
    const d = sq();
    const inBox = Math.abs(adult.x - baby.x) < 8 + 0.45 / 2 + 0.45 && Math.abs(adult.z - baby.z) < 8 + 0.9 / 2 + 0.225;
    const boxOk = (adult.x - 0.45) - (baby.x + 0.225) < 8;
    if (R.run && (d < 9 || d > 256)) R.run = false;
    if (!R.run && boxOk && d >= 9) { R.run = true; R.delay = 0; }
    if (g.running && !g.canContinueToUse()) { g.stop(); g.running = false; }
    if (!g.running && g.canUse()) { g.start(); g.running = true; }
    if (!!g.running !== R.run) return `tick ${t} running ${!!g.running} vs ${R.run} (sep ${sep})`;
    calls = []; steps = [];
    let wantCall = false;
    if (R.run && --R.delay <= 0) { R.delay = 10; wantCall = true; }
    if (g.running) g.tick();
    if (wantCall !== (calls.length === 1)) return `tick ${t} path recalc ${calls.length} vs ${wantCall}`;
    if (calls.length && (calls[0][0] !== adult.x)) return `tick ${t} followed the wrong mob`;
    for (const s of steps) if (s !== speed) return `tick ${t} speed ${s} vs ${speed}`;
  }
  return null;
}
const all = () => { let bad = null; for (let s = 0; s < 20 && !bad; s++) for (const [ty, sp] of MOBS) bad = bad || lane(s, ty, sp); return bad; };
for (let s = 0; s < 20; s++) for (const [ty, sp] of MOBS) { const r = lane(s, ty, sp); ok(!r, `followparent ${ty} salt ${s}: ${r}`); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const F = Ai.FollowParentGoal;
Ai.FollowParentGoal = function (e, sp, g) { return new F(e, sp * 1.1, g); }; brk(!!all(), 'speed x1.1'); Ai.FollowParentGoal = F;
Ai.FOLLOW_PARENT_CLOSE_SQ = 16; brk(!!all(), 'stop distance 3 -> 4'); Ai.FOLLOW_PARENT_CLOSE_SQ = 9;
Ai.FOLLOW_PARENT_DELAY = 20; brk(!!all(), 'recalc delay 10 -> 20'); Ai.FOLLOW_PARENT_DELAY = 10;
Ai.FOLLOW_PARENT_RANGE = 12; brk(!!all(), 'box range 8 -> 12'); Ai.FOLLOW_PARENT_RANGE = 8;
console.log(`lockstep-followparent: ${100 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
