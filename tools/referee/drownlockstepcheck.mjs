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
const DROWN_TICKS = 390, CONV_TICKS = 1000;
// vanilla reference: one row per EL.tick (tick() first, baseTick after)
function reference(breathing, ticks, maxHp = 20) {
  let air = 300, hp = maxHp, inW = 0, countdown = null, submerged = false, convTick = -1, hitAt = -1;
  const rows = [];
  for (let t = 1; t <= ticks; t++) {
    if (convTick < 0) {
      if (countdown !== null) { countdown--; if (countdown < 0) convTick = t; }
      else if (submerged) { inW++; if (inW >= 600) countdown = 300; } else inW = -1;
    }
    submerged = true;   // baseTick: eyes in water
    if (!breathing) { air--; if (air === -20) { air = 0; hp -= 2; hitAt = t; } }
    rows.push({ t, air, hp, convTick });
    if (convTick >= 0) break;
  }
  return rows;
}
function build(salt, baby, effect, mob) {
  cells.clear(); EL.list.length = 0;
  const glass = S.stateOf('glass'), water = S.stateOf('water');
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) for (let y = 0; y <= 5; y++) if (x || z) w.set(x, y, z, glass);
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) w.set(x, -1, z, S.stateOf('stone'));
  for (let y = 0; y <= 2; y++) w.set(0, y, 0, water);
  w.set(0, 3, 0, glass);
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(mob || 'zombie', 0.5, 0, 0.5);
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  for (const sl of [IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) Eq.setEquipped(e, sl, null);
  Eq.setEquipped(e, IT.MAINHAND, { i: IT.of('iron_sword'), c: 1, d: 0 });
  if (baby) e.growAge = -24000;
  if (effect) ES.addStatusEffect(e, effect, 1000000, 0, false, true);
  return e;
}
function engine(salt, baby, effect, ticks, mob) {
  const e = build(salt, baby, effect, mob), rows = []; let cur = e, drowned = null;
  for (let t = 1; t <= ticks; t++) {
    EL.tick();
    drowned = EL.list.find((x) => x.type === 'drowned' && !x.removed) || null;
    if (drowned) { rows.push({ t, air: null, hp: null, convTick: t, drowned }); break; }
    rows.push({ t, air: cur.air === undefined ? 300 : cur.air, hp: cur.health, convTick: -1, inW: !!cur.inWater, eye: !!cur.eyeInWater });
    if (cur.dead || cur.removed || !(cur.health > 0)) break;
  }
  return rows;
}
const FL = { fields: ['air', 'health', 'fluid'] };
function lane(salt, baby, breathing, ticks, mob, maxHp) {
  const R = reference(breathing, ticks, maxHp), E = engine(salt, baby, breathing === true ? 'water_breathing' : null, ticks, mob);
  const rr = R.map((r) => serverRow(r.t, { Air: r.air, Health: r.hp }));
  const ee = E.map((r) => engineRow(r.t, r.drowned ? {} : { air: r.air, health: r.hp, inWater: r.inW, eyeInWater: r.eye, inLava: false }));
  for (const r of rr) r.fluid = [true, true, false];
  for (const r of ee) if (r.fluid) r.fluid = [r.fluid[0], r.fluid[1], false];
  let d = compareTraces(rr, ee, FL);
  const rc = R[R.length - 1].convTick, ec = E[E.length - 1].convTick;
  if (!d && rc !== ec) d = { tick: Math.min(rc < 0 ? 1e9 : rc, ec < 0 ? 1e9 : ec), field: 'convTick', a: rc, b: ec };
  const dr = E[E.length - 1].drowned;
  return { d, rc, ec, dr, E };
}
const report = (res) => res.map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
// zombie: LivingEntity.canBreatheInWater() is `getGroup() == UNDEAD` -> baseTick never drains its air (the real server's drown golden agrees: no damage)
const zres = salts.map((salt) => ({ salt, ...lane(salt, false, 'undead', 480) }));
ok(zres.every((r) => !r.d), 'zombie flat-air lane: ' + report(zres.filter((r) => r.d)));
// control: a pig (10 hp, armour 0) really drowns: air 300 -> -20 -> 0 + 2 damage, again every 20 ticks
const dres = salts.map((salt) => ({ salt, ...lane(salt, false, false, DROWN_TICKS, 'pig', 10) }));
ok(dres.every((r) => !r.d), 'pig drown lane: ' + report(dres.filter((r) => r.d)));
const hurt = reference(false, DROWN_TICKS, 10).filter((r, i, a) => i && a[i - 1].hp !== r.hp).map((r) => r.t);
ok(hurt[0] === 320 && hurt[1] === 340, 'reference: first DROWN hit at tick 320, then every 20: ' + hurt.slice(0, 3));
const cres = [];
for (const salt of salts) {
  const baby = salt % 2 === 1, r = { salt, ...lane(salt, baby, 'undead', CONV_TICKS) };
  if (!r.d) {
    const z = r.dr;
    if (!z) r.d = { tick: r.ec, field: 'drowned', a: 'entity', b: 'none' };
    else if (!z.equip || !Eq.getEquipped(z, IT.MAINHAND) || IT.nameOf(Eq.getEquipped(z, IT.MAINHAND).i) !== 'iron_sword') r.d = { tick: r.ec, field: 'equipment', a: 'iron_sword', b: 'lost' };
    else if (((z.growAge | 0) < 0) !== baby) r.d = { tick: r.ec, field: 'baby', a: baby, b: !baby };
    else if (!(z.health > 0) || z.health < 20) r.d = { tick: r.ec, field: 'health', a: 20, b: z.health };
  }
  cres.push(r);
}
ok(cres.every((r) => !r.d), 'convert lane: ' + report(cres.filter((r) => r.d)));
ok(cres.every((r) => r.rc === 903), 'reference conversion tick is 903 (inWaterTime -1 on tick 1 = the baseTick lag, 600 on tick 602, then 300 countdown + 1): ' + cres[0].rc);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const o = U.WATER_SUBMERGE_TICKS; U.WATER_SUBMERGE_TICKS = 601;
const b1 = lane(0, false, 'undead', CONV_TICKS);
brk(b1.d && b1.d.tick === 903 && b1.ec === 904, `conversion time 601 reported at the conversion tick (${b1.d && b1.d.tick}, engine ${b1.ec})`); U.WATER_SUBMERGE_TICKS = o;
const oa = EL.tickMobAir; EL.tickMobAir = function (e) { oa(e); if (e.air !== undefined && e.air < 300) e.air -= 1; };
brk(!!lane(0, false, false, DROWN_TICKS, 'pig', 10).d, 'a double air drain is reported'); EL.tickMobAir = oa;
const oh = M.Combat.hurt; M.Combat.hurt = (e, a, ...r) => oh(e, a + 1, ...r);
brk(!!lane(0, false, false, DROWN_TICKS, 'pig', 10).d, 'drowning damage 3 instead of 2 is reported'); M.Combat.hurt = oh;
console.log(`drownlockstepcheck: ${20 * 3 + 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
