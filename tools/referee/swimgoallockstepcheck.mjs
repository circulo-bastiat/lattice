// lockstep-swimgoal -- #7917 (G18b-L21): SwimGoal (Ai.FloatGoal) + JumpControl + LivingEntity.travel fluid branches vs an independent per-tick reference, 20 salts.
// Reference = .decomp SwimGoal (canStart = touchingWater && fluidHeight > getSwimHeight() || inLava; tick: nextFloat() < 0.8 -> jumpControl.setActive),
// LivingEntity.travel water branch (vy*0.8, gravity/16 after, +0.04 on jump) and lava branch (vy*0.5 or 0.8 when fluidHeight <= swimHeight, gravity/4, +0.04 on jump).
// Mobs: cow, zombie, chicken, villager (no SwimGoal), skeleton + a baby of each; fluids: 3-deep water, shallow water, lava, bubble column.
// Compared per tick: goal start, jump request, vy, y. The reference reads the cell map itself (fluid height = level), not the engine's helpers.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '09c_weather.js', '14b_physics.js', '07k_goals.js'], dom: false, initReg: true });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
M.World = Object.assign(M.World || {}, w);
M.Physics.shapeAt = (x, y, z) => { const id = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
if (M.Behave && M.Behave.init) M.Behave.init(w);
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const { Ai, Physics: Ph, States: S, Reg } = M;
const st = (n) => S.stateOf(n);
const MOBS = { cow: [0.9, 1.4, 1.3], zombie: [0.6, 1.95, 1.74], chicken: [0.4, 0.7, 0.644], villager: [0.6, 1.95, 1.62], skeleton: [0.6, 1.99, 1.74] };
const FLUIDS = { deep: [4, 'water'], shallow: [1, 'water'], lava: [3, 'lava'], bubble: [4, 'bubble_column'] };
const TICKS = 60;
function lane(c) {
  cells.clear();
  const [depth, fl] = FLUIDS[c.fluid];
  cells.set(key(0, 0, 0), st('stone'));
  for (let y = 1; y <= depth; y++) cells.set(key(0, y, 0), st(fl));
  const [wd, ht, eye] = MOBS[c.mob], k = c.baby ? 0.5 : 1;
  const e = { type: c.mob, x: 0.5, y: depth + 0.5, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, zza: 0, width: wd * k, height: ht * k, eyeHeight: eye * k, onGround: false, baby: !!c.baby };
  const eng = [], ref = [], r1 = stream(c.salt), r2 = stream(c.salt);
  const g = c.mob === 'villager' ? null : new Ai.FloatGoal(e, r1);
  // reference state
  let ry = e.y, rvy = 0;
  const swimH = eye * k < 0.4 ? 0 : 0.4;
  const cellAt = (y) => { const s = cells.get(key(0, y, 0)) || 0; return s ? S.block[s] : 0; };
  const isW = (y) => { const b = cellAt(y); return b === Reg.id.water || b === Reg.id.bubble_column; };
  const isL = (y) => cellAt(y) === Reg.id.lava;
  for (let t = 0; t < TICKS; t++) {
    Ph.updateFluids(e);
    let started = false;
    if (g && g.canUse()) { started = true; g.tick(); }
    const jumped = !!e.jumping;
    Ph.travelMob(e);
    eng.push([started, jumped, e.vy, e.y]);
    // reference
    const fy = Math.floor(ry + 0.4), inW = isW(fy), inL = cellAt(fy) === Reg.id.lava;
    const fh = (isW(Math.floor(ry)) || isW(Math.floor(ry) + 1)) ? Math.max(0, depth + 8 / 9 - ry) : 0;
    const rst = !!(c.mob !== 'villager' && ((inW && fh > swimH) || inL));
    let rj = false;
    if (rst && r2() < 0.8) rj = true;
    if (inW) {
      if (rj) rvy += 0.04;
      ry += rvy; if (ry < 1) { ry = 1; rvy = 0; }
      rvy *= 0.8;
      if (Math.abs(rvy - 0.005) >= 0.003 && rvy <= 0 && Math.abs(rvy - 0.08 / 16) < 0.003) rvy = -0.003; else rvy -= 0.08 / 16;
    } else if (inL) {
      ry += rvy; if (ry < 1) { ry = 1; rvy = 0; }
      const lh = Math.max(0, depth + 8 / 9 - ry);
      rvy *= lh <= swimH ? 0.8 : 0.5;
      rvy -= 0.08 / 4;
      if (rj) rvy += 0.04;
    } else {
      ry += rvy; if (ry < 1) { ry = 1; rvy = 0; } rvy -= 0.08; rvy *= 0.98;
    }
    ref.push([rst, rj, rvy, ry]);
  }
  const same = (a, b) => a[0] === b[0] && a[1] === b[1] && Math.abs(a[2] - b[2]) < 1e-6 && Math.abs(a[3] - b[3]) < 2e-5;   // the collision resolver rests 1e-5 above a floor
  const i = eng.findIndex((v, k2) => !same(v, ref[k2]));
  return i < 0 ? null : 'tick ' + i + ': ' + eng[i].join('|') + ' vs ' + ref[i].join('|');
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) for (const mob of Object.keys(MOBS)) for (const baby of [false, true]) for (const fluid of Object.keys(FLUIDS)) {
    const b = lane({ salt: s * 7 + 1, mob, baby, fluid }); n++;
    if (b && !bad) bad = `salt ${s} ${baby ? 'baby ' : ''}${mob} ${fluid}: ${b}`;
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 20 * 5 * 2 * 4, 'lanes ' + base.n);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Ai.FLOAT_CHANCE; Ai.FLOAT_CHANCE = 0.5; brk(!!run().bad, 'jump probability 0.5'); Ai.FLOAT_CHANCE = o; }
{ const o = Ph.swimHeightOf; Ph.swimHeightOf = () => 0; brk(!!run().bad, 'swim height 0'); Ph.swimHeightOf = o; }
{ const o = Ph.SWIM_UP; Ph.SWIM_UP = 0.05; brk(!!run().bad, 'swim-up impulse 0.05'); Ph.SWIM_UP = o; }
{ const o = Ai.FloatGoal; Ai.FloatGoal = function (e, r) { const g = new o(e, r); g.canUse = () => false; return g; }; brk(!!run().bad, 'goal never starts'); Ai.FloatGoal = o; }
console.log(`lockstep-swimgoal: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
