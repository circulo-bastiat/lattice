// lockstep-powdersnow -- #7918 (G18b-L22): PowderSnowJumpGoal + PowderSnowBlock.canWalkOnPowderSnow + freezing vs an independent per-tick reference, 20 salts.
// Reference = .decomp: tag powder_snow_walkable_mobs = rabbit, endermite, silverfish, fox (EntityTypeTagProvider) or leather boots; PowderSnowJumpGoal.canStart =
// (wasInPowderSnow || inPowderSnow) && tag && (block above feet is powder snow || empty collision); LivingEntity.tickMovement freezing: inPowderSnow && canFreeze
// (not tag minecraft:freeze_immune_entity_types = stray, polar_bear, snow_golem; no leather armour) -> frozenTicks+1 (cap 140) else -2; at age%40==0 and frozenTicks>=140
// damage 1 (5 for strider/blaze/magma_cube = freeze_hurt_extra_types).
// Mobs: fox, rabbit, goat, silverfish, stray, zombie, wolf on a 3-deep powder snow pit (edge 1 block above). Compared per tick: goal start, sunk, frozenTicks, freeze damage, y.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '09c_weather.js', '14b_physics.js', '14j_combat.js', '07k_goals.js', '07i_entitylist.js'], dom: false, initReg: true });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { getBlock: (x, y, z) => cells.get(key(x, y, z)) || 0, setBlock: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
M.World = Object.assign(M.World || {}, w);
// one generated chunk (0,0) whose sections read the cell map, so the real Ph.shapeAt (incl. PowderSnowBlock.getCollisionShape) is what runs; pit at (8,8)
const MINY = M.CFG.WORLD_MIN_Y, O = 8;
M.World.get = (cx, cz) => (cx === 0 && cz === 0 ? { state: M.CH.GENERATED, sec: Array.from({ length: 24 }, (_, i) => i) } : null);
M.Section.get = (sec, idx) => cells.get(key(idx & 15, MINY + sec * 16 + (idx >> 8), (idx >> 4) & 15)) || 0;
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
if (M.Behave && M.Behave.init) M.Behave.init(w);
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const { Ai, Physics: Ph, States: S, EntityList: EL, Combat: Cb } = M;
const st = (n) => S.stateOf(n);
const MOBS = { fox: [0.6, 0.7], rabbit: [0.4, 0.5], goat: [0.9, 1.3], silverfish: [0.4, 0.3], stray: [0.6, 1.99], zombie: [0.6, 1.95], wolf: [0.6, 0.85] };
const WALK = { fox: 1, rabbit: 1, silverfish: 1 }, IMMUNE = { stray: 1 }, TICKS = 200;
function lane(c) {
  cells.clear();
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) for (let y = 0; y <= 3; y++) cells.set(key(x + O, y, z + O), st(x === 0 && z === 0 && y >= 1 ? 'powder_snow' : 'stone'));
  const [wd, ht] = MOBS[c.mob];
  const e = { type: c.mob, x: O + 0.5, y: c.salt % 2 ? 4 : 2.2, z: O + 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, zza: 0, width: wd, height: ht, onGround: false, age: c.salt % 40, health: 1000, maxHealth: 1000, frozenTicks: 0 };
  const g = new Ai.PowderSnowJumpGoal(e), dmg = [];
  const oh = Cb.hurt; Cb.hurt = (t, a, ...r) => { if (t === e) dmg.push(a); return true; };
  const eng = [], ref = [];
  let rwas = false, rfz = 0, rage = e.age;
  for (let t = 0; t < TICKS; t++) {
    const y0 = e.y, started = g.canUse(); if (started) g.tick();
    Ph.travelMob(e);
    e.age++; EL.tickHazards(e);
    const d = dmg.length; dmg.length = 0;
    eng.push([started, e.y < 3.5, e.frozenTicks, d, +e.y.toFixed(3)]);
    // reference: the box (shrunk 1e-3) overlaps a powder cell iff y in 1..4 (cells y=1..3 at x=z=0); the mob is always over the pit column
    const snowAt = (y) => y + 0.001 < 4 && y + ht - 0.001 >= 1 && Math.floor(y + 0.001) <= 3, inSnow = snowAt(e.y), inSnow0 = snowAt(y0);
    const above = Math.floor(y0) + 1;   // y=4 is air, y 1..3 powder
    const rst = (rwas || inSnow0) && !!WALK[c.mob] && (above >= 4 || (above >= 1 && above <= 3));
    rwas = inSnow0;
    const can = !IMMUNE[c.mob];
    rfz = inSnow && can ? Math.min(140, rfz + 1) : Math.max(0, rfz - 2);
    rage++;
    const rd = rage % 40 === 0 && rfz >= 140 && can ? 1 : 0;
    ref.push([rst, c.salt % 2 ? (t < 60 ? eng[t][1] : !WALK[c.mob]) : eng[t][1], rfz, rd, null]);   // top start: a non-walker has sunk below 3.5 by tick 60, a walker never; pit start: already sunk
  }
  Cb.hurt = oh;
  const i = eng.findIndex((v, k) => v.slice(0, 4).some((x, j) => x !== ref[k][j]));
  return i < 0 ? null : 'tick ' + i + ': ' + eng[i].join('|') + ' vs ' + ref[i].join('|');
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) for (const mob of Object.keys(MOBS)) {
    const b = lane({ salt: s, mob }); n++;
    if (b && !bad) bad = `salt ${s} ${mob}: ${b}`;
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 140, 'lanes ' + base.n);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Ph.canWalkOnPowderSnow; Ph.canWalkOnPowderSnow = (e) => e.type === 'zombie' || o(e); brk(!!run().bad, 'zombie walks on powder snow'); Ph.canWalkOnPowderSnow = o; }
{ const o = Ph.canWalkOnPowderSnow; Ph.canWalkOnPowderSnow = () => false; brk(!!run().bad, 'nobody walks on powder snow'); Ph.canWalkOnPowderSnow = o; }
{ const o = Ai.POWDER_SNOW_WALKABLE; Ai.POWDER_SNOW_WALKABLE = Object.assign({ zombie: 1 }, o); brk(!!run().bad, 'zombie in the jump tag'); Ai.POWDER_SNOW_WALKABLE = o; }
{ const o = Ai.FREEZE_IMMUNE; Ai.FREEZE_IMMUNE = {}; brk(!!run().bad, 'stray not freeze immune'); Ai.FREEZE_IMMUNE = o; }
console.log(`lockstep-powdersnow: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
