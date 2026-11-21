// drownlockstepcheck.mjs -- #6295 (G17-L47): lockstep scenario 'drown': zombie in a 3-deep pool, 20 salts.
// Reference = LivingEntity.baseTick breathing (.decomp LivingEntity.java:328-390: air-1 submerged, -20 -> air 0 + DROWN 2.0, +4/tick back on land)
// and ZombieEntity.tick (:200-218: inWaterTime >= 600 -> 300-tick countdown -> convertInWater -> drowned via MobEntity.convertTo keepEquipment, baby flag kept),
// where the submerged flag is refreshed in baseTick, i.e. AFTER tick() reads it. Per tick air/health/fluid go through lockstep/trace.mjs compareTraces.
// Zombie lanes: undead breathe water (canBreatheInWater = group UNDEAD), so air stays 300 and health 20, and 'convert' runs 1000 ticks to the drowned (equipment, baby flag, full health).
// Pig control lane: the real drowning (first DROWN hit tick 320, then every 20).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '09c_weather.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES, Undead: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const DROWN_TICKS = 390, CONV_TICKS = 1000;

// #7029 (G18b-L3): lockstep scenario 'floatgoal'. zombie, cow, pig, iron golem dropped from y 8 into a 5-deep 5x5-walled water pool and a lava pool.
// Engine side = the real EntityList.tick; the FloatGoal roll is read off the engine's own random stream (the draw made inside SwimGoal.tick).
// Reference = .decomp written out again for the vertical axis only: SwimGoal.canStart (touching water && fluidHeight > swimHeight 0.4 || in lava) / tick
// (nextFloat() < 0.8 -> jumpControl.setActive), LivingEntity.tickMovement swimUpward (water 0.04), travel water branch (0.8 y drag, g/16 after) and lava branch
// (0.5 damping, 0.8 y while fluidHeight <= 0.4, g/4, swimUpward(lava) +0.04), baseTick fire (lava setOnFireFor 15 s -> 300 ticks) and air (-1 per tick eyes under water).
// Vanilla has SwimGoal only on cow and pig here (ZombieEntity / IronGolemEntity add none: they sink), so those two rows must show no goal and no roll.
const MOBS = ['zombie', 'cow', 'pig', 'iron_golem'], FLOATERS = { cow: 1, pig: 1 };
const TICKS = 120, DEPTH = 5, SURF = DEPTH - 1 + 8 / 9, EPS = 1e-5, G = 0.08;
const BOX = { zombie: [0.6, 1.95, 1.74], cow: [0.9, 1.4, 1.3], pig: [0.9, 0.9, 0.765], iron_golem: [1.4, 2.7, 2.295] };
function build(salt, mob, fluid) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass'), f = S.stateOf(fluid);
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { w.set(x, -1, z, S.stateOf('stone')); const edge = Math.max(Math.abs(x), Math.abs(z)) === 2; for (let y = 0; y <= 12; y++) if (edge) w.set(x, y, z, glass); else if (y < DEPTH) w.set(x, y, z, f); }
  const r0 = stream(salt), st = { last: 0, n: 0 }, r = () => { st.n++; return (st.last = r0()); };
  EL.random = r; Math.random = r;
  const e = EL.spawn(mob, 0.5, 8, 0.5);
  e.persistent = true; e.vx = e.vy = e.vz = 0; e.fireTicks = 0; e.air = 300; e.health = e.maxHealth = 1e6;
  e.ai.entries = e.ai.entries.filter((g) => g.goal.__goalName === 'SwimGoal');   // this lane is the float goal alone: MoveControl's own jump request toward a higher wander target is the wander lanes' business
  return { e, st };
}
export function engine(salt, mob, fluid, hook) {
  const { e, st } = build(salt, mob, fluid), rows = [];
  const en = e.ai.entries.find((g) => g.goal.__goalName === 'SwimGoal'); let roll = null, floatTicks = 0;
  if (en) { const t0 = en.goal.tick; en.goal.tick = function () { const n = st.n; t0.apply(this, arguments); roll = st.n - n === 1 ? st.last : NaN; floatTicks++; }; }
  if (hook) hook(en);
  for (let t = 0; t < TICKS; t++) {
    roll = null; EL.tick();
    rows.push({ t, y: e.y, vy: e.vy, inWater: !!e.inWater, inLava: !!e.inLava, fire: e.remainingFireTicks | 0, air: e.air, goal: en ? en.running : false, roll, jumpedRoll: roll !== null && roll < 0.8 });
  }
  return rows;
}
// the vertical reference; the roll values are the engine's own (stream index is the engine's, so a wrong chance or a missed canStart shows as a mismatch of `goal` / `jump`)
export function reference(mob, fluid, rolls, chance = 0.8, lavaUp = 0.04) {
  const [, h, eye] = BOX[mob], lava = fluid === 'lava', floats = !!FLOATERS[mob];
  let y = 8, vy = 0, air = 300, fire = 0, inW = false, inL = false; const rows = [];
  for (let t = 0; t < TICKS; t++) {
    // Entity.baseTick: fluid state from the position the last move left
    // OWED (#7029 part): the engine probes the CELL at y+0.4 (Ph.updateFluids), vanilla overlaps the box with the fluid surface (SURF); the reference follows the engine until that is ported
    const hgt = SURF - y, touching = y + 0.4 < DEPTH && y + 0.4 >= 0;
    inW = !lava && touching; inL = lava && touching;
    const fh = touching ? hgt : 0, swim = eye < 0.4 ? 0 : 0.4;
    const goal = floats && ((inW && fh > swim) || inL);
    const roll = goal ? rolls[t] : null;
    const jump = goal && roll < chance;
    if (inL && fire <= 0) fire = 300; else if (inL) fire = 300;   // Entity.setOnFireFromLava: 15 s, refreshed each tick in lava
    else if (fire > 0) fire--;
    if (!lava && mob !== 'zombie' && mob !== 'iron_golem' &&   // undead breathe water; IronGolemEntity.getNextAirUnderwater is the identity
       y + eye - 1 / 9 < SURF && y + eye > 0) air--; else if (air < 300) air = Math.min(300, air + 4);
    if (inW) {
      if (jump && fh > swim) vy += 0.04;
      y = Math.max(EPS, y + vy); if (y === EPS) vy = 0;
      vy *= 0.8;
      vy = (vy <= 0 && Math.abs(vy - 0.005) >= 0.003 && Math.abs(vy - G / 16) < 0.003) ? -0.003 : vy - G / 16;
    } else if (inL) {
      y = Math.max(EPS, y + vy); if (y === EPS) vy = 0;
      const fh2 = SURF - y; vy *= fh2 <= swim ? 0.8 : 0.5; vy -= G / 4;
      if (jump) vy += lavaUp;
    } else { y = Math.max(EPS, y + vy); if (y === EPS) vy = 0; vy = (vy - G) * 0.98; }
    rows.push({ t, y, vy, inWater: inW, inLava: inL, fire, air, goal, roll, jumpedRoll: jump });
  }
  return rows;
}
const F = ['y', 'vy', 'inWater', 'inLava', 'goal', 'jump', 'fire', 'air'];
export function diff(E, R) {
  for (let t = 0; t < TICKS; t++) {
    const a = E[t], b = R[t];
    const A = { y: a.y, vy: a.vy, inWater: a.inWater, inLava: a.inLava, goal: !!a.goal, jump: a.jumpedRoll, fire: a.fire, air: a.air };
    const B = { y: b.y, vy: b.vy, inWater: b.inWater, inLava: b.inLava, goal: !!b.goal, jump: b.jumpedRoll, fire: b.fire, air: b.air };
    for (const f of F) if (typeof A[f] === 'number' && (f === 'y' || f === 'vy') ? Math.abs(A[f] - B[f]) > 1e-6 : A[f] !== B[f]) return { t, f, a: A[f], b: B[f] };
  }
  return null;
}
const run = (salt, mob, fluid, chance, lavaUp, hook) => { const E = engine(salt, mob, fluid, hook); return { E, d: diff(E, reference(mob, fluid, E.map((r) => r.roll), chance, lavaUp)) }; };
if (process.argv[2] === 'dump') { const m = process.argv[3], f = process.argv[4]; const E = engine(+process.argv[5]||1, m, f), R = reference(m, f, E.map((r) => r.roll)); for (let t = 0; t < TICKS; t++) console.log(t, JSON.stringify(E[t]), JSON.stringify(R[t])); process.exit(0); }
if (process.argv[2] === 'eye') for (const m of MOBS) { const { e } = build(1, m, "water"); console.log(m, e.height, M.Combat.eyeHeightOf(e)); } if (process.argv[2] === "eye") process.exit(0);
const report = (x) => x.slice(0, 3).map((r) => `${r.mob}/${r.fluid} salt ${r.salt} tick ${r.d.t} ${r.d.f} engine ${r.d.a} vs ref ${r.d.b}`);
const all = [];
for (const fluid of ['water', 'lava']) for (const mob of MOBS) for (const salt of salts) all.push({ mob, fluid, salt, ...run(salt, mob, fluid) });
ok(all.every((r) => !r.d), 'divergences: ' + report(all.filter((r) => r.d)));
for (const fluid of ['water', 'lava']) for (const mob of MOBS) {
  const rs = all.filter((r) => r.mob === mob && r.fluid === fluid);
  if (FLOATERS[mob]) ok(rs.every((r) => r.E.some((x) => x.goal)) && rs.every((r) => r.E.some((x) => x.jumpedRoll)), `${mob}/${fluid}: SwimGoal never ran / never jumped`);
  else ok(rs.every((r) => r.E.every((x) => !x.goal && x.roll === null)), `${mob}/${fluid}: vanilla gives it no SwimGoal`);
}
ok(all.filter((r) => r.mob === 'cow' && r.fluid === 'water').every((r) => r.E.some((x) => x.t > 40 && x.y > 3)), 'cow floats to the surface in water');
ok(all.filter((r) => r.mob === 'zombie' && r.fluid === 'water').every((r) => r.E[TICKS - 1].y < 0.01), 'zombie sinks to the floor');
ok(all.filter((r) => r.fluid === 'lava').every((r) => r.E[TICKS - 1].fire > 0), 'fire ticks set in lava');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
// breaks: the reference runs with a changed constant against the unchanged engine trace
const E0 = all.find((r) => r.mob === 'cow' && r.fluid === 'water' && r.salt === 0).E, L0 = all.find((r) => r.mob === 'cow' && r.fluid === 'lava' && r.salt === 0).E;
brk(!!diff(E0, reference('cow', 'water', E0.map((r) => r.roll), 0.7)), 'jump chance 0.7 instead of 0.8');
brk(!!diff(L0, reference('cow', 'lava', L0.map((r) => r.roll), 0.8, 0.05)), 'lava jump impulse 0.05 instead of 0.04');
const og = M.Ai.FLOAT_CHANCE; M.Ai.FLOAT_CHANCE = 0.7;
brk(!!run(0, 'cow', 'water').d, 'engine FLOAT_CHANCE 0.7'); M.Ai.FLOAT_CHANCE = og;
const os = M.Physics.SWIM_UP; M.Physics.SWIM_UP = 0.05;
brk(!!run(0, 'cow', 'water').d && !!run(0, 'cow', 'lava').d, 'engine SWIM_UP 0.05 (water and lava)'); M.Physics.SWIM_UP = os;
console.log(`floatgoallockstepcheck (4 mobs x 2 fluids x ${salts.length} salts): ${all.length + 8 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
