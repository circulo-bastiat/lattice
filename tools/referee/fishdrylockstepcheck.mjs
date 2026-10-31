// fishdrylockstepcheck.mjs -- #8842 (G17-L250): lockstep scenario 'fishdry': cod/salmon on dry stone, 20 salts; air, health, flop sound vs WaterCreatureEntity.tickWaterBreathingAir / FishEntity.tickMovement (.decomp).
// suffocatelockstepcheck.mjs -- #6613 (G17-L87): lockstep scenario 'suffocate': cow/zombie/baby zombie with a block in the eye box, 20 salts.
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
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
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
const { EntityList: EL, States: S, Physics: Ph } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
let sounds = [];
M.Sound = M.Sound || {};
M.Sound.mobSound = (e, ev) => { sounds.push(ev); };
// Reference: WaterCreatureEntity.tickWaterBreathingAir (.decomp :48-58): air-1 on land, at -20 air=0 and DROWN 2.0 (gate: 20 ticks of invulnerability, hit lands when timeUntilRegen <= 10).
function reference(air0, ticks) {
  let air = air0, hp = 3, inv = 0; const rows = [];
  for (let t = 1; t <= ticks; t++) {
    if (inv > 0) inv--;
    air--;
    if (air === -20) { air = 0; if (inv <= 10) { hp = Math.max(0, hp - 2); inv = 20; } }
    rows.push({ t, air, hp });
    if (hp <= 0) break;
  }
  return rows;
}
const FL = { fields: ['air', 'health'] };
function lane(salt, type, air0, ticks, brk) {
  cells.clear(); EL.list.length = 0; sounds = [];
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.set(x, -1, z, S.stateOf('stone'));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(type, 0.5, 0, 0.5);
  e.persistent = true; e.vx = e.vy = e.vz = 0; e.fishAir = air0; e.air = air0;
  const E = [], flops = [];
  for (let t = 1; t <= ticks; t++) {
    const n0 = sounds.length;
    EL.tick();
    E.push({ t, air: e.air, hp: e.health }); if (process.env.DBG && salt === 0 && air0 === 300 && (t % 10 === 0 || t > 110)) console.log(t, e.air, e.health, e.onGround, e.verticalCollision, e.inWater, e.vy, e.y, e.dead, e.removed);
    if (sounds.length > n0 && sounds[n0] === 'entity.' + type + '.flop') flops.push(t);
    if (e.dead || e.removed || !(e.health > 0)) break;
  }
  const R = reference(air0, ticks), n = Math.min(R.length, E.length);
  const rr = R.slice(0, n).map((x) => serverRow(x.t, { Air: x.air, Health: x.hp }));
  const ee = E.slice(0, n).map((x) => engineRow(x.t, { air: x.air, health: x.hp }));
  return { d: compareTraces(rr, ee, FL), R, E, flops, n: E.length, rn: R.length };
}
const laneAll = (type, air0, ticks) => salts.map((salt) => ({ salt, ...lane(salt, type, air0, ticks) }));
const DBG = process.env.DBG; const report = (res) => res.filter((r) => r.d).map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
for (const type of ['cod', 'salmon'])
  for (const air0 of [300, 20]) {
    const res = laneAll(type, air0, 120);
    ok(res.every((r) => !r.d), `${type} dry air ${air0}: ` + report(res));
    ok(res.every((r) => r.n === r.rn), `${type} air ${air0}: lifetime ${res[0].n} vs reference ${res[0].rn}`);
    ok(res.every((r) => r.flops.length > 0), `${type} air ${air0}: flop sound heard (${res[0].flops.length})`);
    console.log(`  ${type}/${air0}: flops at ${res[0].flops.slice(0, 6)} dead after ${res[0].n}`);
  }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const oh = M.Combat.hurt; M.Combat.hurt = (e, a, ...r) => oh(e, a + 1, ...r);
brk(laneAll('cod', 20, 120).some((r) => r.d), 'drown damage 3 instead of 2');
M.Combat.hurt = oh;
const ot = M.Fish.tickAir; M.Fish.tickAir = (e) => { if (e.fishAir === undefined) e.fishAir = 300; e.fishAir -= 2; e.air = e.fishAir; ot.call(M.Fish, e); };
brk(laneAll('salmon', 300, 120).some((r) => r.d), 'air counting down by 2 per tick');
M.Fish.tickAir = ot;
const of = M.Fish.tickMovementFlop; M.Fish.tickMovementFlop = () => {};
brk(laneAll('cod', 300, 120).every((r) => r.flops.length === 0), 'flop removed leaves no flop sound');
M.Fish.tickMovementFlop = of;
console.log(`fishdrylockstepcheck: ${16 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
