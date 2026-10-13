// lockstep-ride -- #6290 (G17-L42): lockstep scenario 'ride': a saddled horse jumped with a charge, a saddled pig steered with a carrot on a stick; 20 salts.
// Reference = .decomp HorseBaseEntity.travel (vy = jump_strength attr * charge, charge 0.4+0.4*c/90, kick -0.4*sin(yaw)*charge; move, then gravity 0.08 and drag 0.98), ItemSteerable.travel (speed + speed*1.15*sin(t/T*PI)).
// (unused) Entity.baseTick (:405-460: updateWaterState/checkWaterState extinguishes in water, fireTicks>0 -> damage(ON_FIRE,1) at %20 unless in lava, then -1;
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
M.Mount.init();
const { EntityList: EL, Mount: Mn, Passive: Ps } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) w.set(x, -1, z, stone);
}
const JUMP_TICKS = 10;
// horse: charge set before tick 1, then JUMP_TICKS ticks airborne
function horse(salt) {
  floor();
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('horse', 0.5, 0, 0.5);
  e.persistent = true; e.vx = e.vy = e.vz = 0; e.saddled = true; e.tamed = true; Mn.mount(e);
  e.jumpStrengthAttr = 0.4 + r() * 0.6;
  const yaw = r() * 6.28, charge = Math.floor(r() * 91);
  e.riderInput = { forwardSpeed: 1, sidewaysSpeed: 0, yaw, pitch: 0 };
  EL.tick(); EL.tick();   // settle on the floor (onGround) before the charge
  e.vx = e.vy = e.vz = 0; Mn.setJumpStrength(e, charge);
  const js = charge >= 90 ? 1 : Math.fround(Math.fround(0.4) + Math.fround(Math.fround(Math.fround(0.4) * charge) / 90)), R = [], E = [];   // HorseBaseEntity.setJumpStrength, from the decomp numbers (jumpStrength is a float field)
  let y = 0, vy = e.jumpStrengthAttr * js;
  for (let t = 1; t <= JUMP_TICKS; t++) {
    EL.tick();
    y += vy; vy = (vy - 0.08) * 0.98;
    if (y <= 0) break;   // landed: ground contact is not part of this lane
    E.push({ tick: t, pos: [e.x, e.y, e.z], vel: [e.vx, e.vy, e.vz], yaw: e.yaw });
    R.push({ tick: t, pos: [e.x, y, e.z], vel: [e.vx, vy, e.vz], yaw });
  }
  return { R, E, e, js };
}
function require_cmp(R, E) { return compareTraces(R, E, { fields: ['pos', 'vel', 'yaw'] }); }
const hres = salts.map((s) => ({ salt: s, ...horse(s) }));
for (const r of hres) { const d = require_cmp(r.R, r.E); ok(!d, 'horse salt ' + r.salt + (d ? ` tick ${d.tick} ${d.field} ${d.a} vs ${d.b}` : '')); ok(r.e.rider === 'player', 'rider seated'); }
// pig: mobSpeed per tick of a boost, rider seated, carrot in hand
function pig(salt) {
  floor();
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn('pig', 0.5, 0, 0.5);
  e.persistent = true; e.saddled = true; Ps.pigMount(e);
  M.Player.heldItemName = () => 'carrot_on_a_stick';
  e.riderInput = { yaw: r() * 6.28, pitch: 0 };
  Ps.pigBoost(e, r);
  const T = e.currentBoostTime, base = (M.Entities.attrsOf('pig').speed || 0.25) * 0.225, out = [];
  for (let t = 0; t < 30; t++) {
    const bt = e.boostedTime;
    EL.tick();
    out.push({ got: e.mobSpeed, want: base + base * 1.15 * Math.sin((bt + 1) / T * Math.PI), yaw: e.yaw, wy: e.riderInput.yaw });
  }
  return out;
}
const pigDiff = (rows) => rows.findIndex((o) => Math.abs(o.got - o.want) > 1e-9 || Math.abs(o.yaw - o.wy) > 1e-9);
for (const s of salts) { const rows = pig(s); ok(pigDiff(rows) < 0, 'pig salt ' + s + ' tick ' + pigDiff(rows)); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const sj = Mn.setJumpStrength;
Mn.setJumpStrength = (e, c) => { sj(e, c); e.jumpStrength *= 1.1; };
{ const r = horse(3); const d = require_cmp(r.R, r.E); brk(d && d.tick === 1, `horse jump power scaled 1.1 reported at the jump tick (${d && d.tick} ${d && d.field})`); }
Mn.setJumpStrength = sj;
const pt = Ps.pigTravelSpeed; Ps.pigTravelSpeed = (a, e) => pt(a, e) * 1.05;
brk(pigDiff(pig(3)) >= 0, 'pig boost speed 5% off is reported');
Ps.pigTravelSpeed = pt;
console.log(`lockstep-ride: ${20 * 4 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
