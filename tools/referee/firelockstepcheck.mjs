// firelockstepcheck.mjs -- #6266 (G17-L34): lockstep scenario 'fire': a cow in lava, on a fire block, and ignited in water; 20 salts.
// Reference = .decomp Entity.baseTick (:405-460: updateWaterState/checkWaterState extinguishes in water, fireTicks>0 -> damage(ON_FIRE,1) at %20 unless in lava, then -1;
// isInLava -> setOnFireFromLava = setOnFireFor(15) + damage(LAVA,4)), AbstractFireBlock.onEntityCollision (Entity.java:2101-style: fireTicks+1, ==0 -> setOnFireFor(8), damage 1;
// the fireTicks start at -getBurningDuration() = -1) and LivingEntity.damage (:1055-1072: timeUntilRegen>10 only passes amount-lastDamage; regen counted down in tickMovement AFTER baseTick,
// before the block collision of the move). Per tick fireTicks/health/fluid go through lockstep/trace.mjs compareTraces. 'Fire' NBT = remainingFireTicks (07zw_mobnbt COMMON).
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
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES, Undead: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const TICKS = 60;
// vanilla reference for a cow (10 hp): lane 'lava' | 'fire' | 'water' (ignited for 8 s when placed)
function reference(lane, ticks) {
  let fire = lane === 'water' ? 160 : -1, hp = 10, regen = 0, last = 0, onFireFlag = false;
  const dmg = (a) => {
    if (hp <= 0) return;
    if (regen > 10) { if (a <= last) return; hp -= a - last; last = a; } else { last = a; regen = 20; hp -= a; }
  };
  const rows = [];
  for (let t = 1; t <= ticks; t++) {
    if (lane === 'water') fire = 0;                                  // checkWaterState -> extinguish()
    else if (fire > 0) { if (fire % 20 === 0 && lane !== 'lava') dmg(1); fire--; }
    if (lane === 'lava') { fire = Math.max(fire, 300); dmg(4); }    // setOnFireFromLava
    if (regen > 0) regen--;
    if (lane === 'fire') { fire++; if (fire === 0) fire = Math.max(fire, 160); dmg(1); }
    rows.push({ t, fire, hp: Math.max(hp, 0), lava: lane === 'lava', water: lane === 'water' });
    if (hp <= 0) break;
  }
  return rows;
}
function build(salt, lane) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) { w.set(x, -1, z, stone); if (x || z) for (let y = 0; y <= 3; y++) w.set(x, y, z, S.stateOf('glass')); }
  if (lane === 'lava') for (let y = 0; y <= 2; y++) w.set(0, y, 0, S.stateOf('lava'));
  if (lane === 'water') for (let y = 0; y <= 2; y++) w.set(0, y, 0, S.stateOf('water'));
  if (lane === 'fire') w.set(0, 0, 0, S.stateOf('fire'));
  w.set(0, 4, 0, S.stateOf('glass'));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('cow', 0.5, 0, 0.5);
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  if (lane === 'water') M.Combat.igniteForSeconds(e, 8);
  return e;
}
function engine(salt, lane, ticks) {
  const e = build(salt, lane), rows = [];
  for (let t = 1; t <= ticks; t++) {
    EL.tick();
    rows.push({ t, fire: e.remainingFireTicks === undefined ? -1 : e.remainingFireTicks, hp: Math.max(e.health, 0), lava: !!e.inLava, water: !!e.inWater });
    if (e.dead || e.removed || !(e.health > 0)) break;
  }
  return rows;
}
const FL = { fields: ['fireTicks', 'health', 'fluid'] };
const asRow = (r) => ({ tick: r.t, fireTicks: r.fire, health: r.hp, fluid: [r.water, false, r.lava] });
function lane(salt, name, ticks = TICKS) {
  const R = reference(name, ticks), E = engine(salt, name, ticks);
  let d = compareTraces(R.map(asRow), E.map(asRow), FL);
  if (!d && R.length !== E.length) d = { tick: Math.min(R.length, E.length), field: 'length', a: R.length, b: E.length };
  return { d, R, E };
}
const report = (res) => res.map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
const all = {};
for (const name of ['lava', 'fire', 'water']) {
  all[name] = salts.map((salt) => ({ salt, ...lane(salt, name) }));
  ok(all[name].every((r) => !r.d), name + ' lane: ' + report(all[name].filter((r) => r.d)));
}
const lv = reference('lava', TICKS);
ok(lv.length === 21 && lv[0].hp === 6 && lv[10].hp === 2 && lv[0].fire === 300, 'reference lava: 4 damage at ticks 1 and 11, dead at 21, 15 s alight: ' + lv.length);
ok(reference('fire', 5)[0].fire === 160 && reference('water', 2)[1].fire === 0, 'reference fire block sets 8 s, water extinguishes');
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const oi = M.Combat.igniteForSeconds; M.Combat.igniteForSeconds = (e, s) => oi(e, s === 15 ? 10 : s);
const b1 = lane(0, 'lava');
brk(b1.d && b1.d.tick === 1 && b1.d.field === 'fireTicks', `lava burn 10 s reported at the contact tick (${b1.d && b1.d.tick} ${b1.d && b1.d.field})`); M.Combat.igniteForSeconds = oi;
const oh = M.Combat.hurt; M.Combat.hurt = (e, a, ...r) => oh(e, a === 4 ? 5 : a, ...r);
const b2 = lane(0, 'lava');
brk(b2.d && b2.d.field === 'health', 'lava damage 5 instead of 4 is reported'); M.Combat.hurt = oh;
M.Combat.hurt = (e, a, ...r) => oh(e, a === 1 ? 2 : a, ...r);
brk(!!lane(0, 'fire').d, 'fire block damage 2 instead of 1 is reported'); M.Combat.hurt = oh;
console.log(`firelockstepcheck: ${20 * 3 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
