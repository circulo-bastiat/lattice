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
// Entity.isInsideWall (.decomp Entity.java:1663): Box.of(eye, w*0.8, 1e-6, w*0.8) against every non-air cell with shouldSuffocate
// (material.blocksMovement && full cube; glass/leaves/ice are suffocates(never)) whose collision shape meets the box.
// Reference model, independent of Ph.isInWall: SUFF is the vanilla predicate by block name, FULL says whether the collision is a whole cube.
const SUFF = { stone: true, sand: true, glass: false, oak_leaves: false, stone_slab: false };
function refInWall(cellsByName, x, y, z, width, eyeH, fac) {
  const half = Math.fround(width * fac) / 2, ey = y + eyeH;
  for (let bx = Math.floor(x - half); bx <= Math.floor(x + half); bx++)
    for (let bz = Math.floor(z - half); bz <= Math.floor(z + half); bz++) {
      const n = cellsByName(bx, Math.floor(ey), bz);
      if (n && SUFF[n]) return true;
    }
  return false;
}
// LivingEntity: baseTick damage(IN_WALL, 1) when the gate is open (LivingEntity.damage: timeUntilRegen > 10 -> swallowed unless bigger, else lands: one hit every 10 ticks), then tickMovement decrements.
function reference(kind, head, drop, ticks, eyeH, width, side) {
  let hp = kind.hp, inv = 0; const rows = [];
  for (let t = 1; t <= ticks; t++) {
    const name = drop !== null && t > drop ? 'sand' : head;
    const wall = side ? refInWall((x, y, z) => (x === 1 && z === 0 && y === 1 ? 'stone' : null), 1 - width * 0.425, 0, 0.5, width, eyeH, 0.8)
      : refInWall((x, y, z) => (x === 0 && z === 0 && y === 1 ? name : null), 0.5, 0, 0.5, width, eyeH, 0.8);
    if (wall && inv <= 10) { hp -= 1; inv = 20; }
    if (inv > 0) inv--;
    rows.push({ t, hp, inv, wall });
    if (hp <= 0) break;
  }
  return rows;
}
const KINDS = { cow: { type: 'cow', hp: 10 }, zombie: { type: 'zombie', hp: 20 }, baby: { type: 'zombie', hp: 20, baby: true } };
function build(salt, kind, head, side) {
  cells.clear(); EL.list.length = 0;
  w.set(0, -1, 0, S.stateOf('stone'));
  if (head) w.set(0, 1, 0, S.stateOf(head));
  if (side) w.set(1, 1, 0, S.stateOf('stone'));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(kind.type, 0.5, 0, 0.5);
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  if (kind.baby) e.growAge = -24000;
  return e;
}
const FL = { fields: ['health', 'invulnerableTime'] };
function lane(salt, kn, head, drop, ticks, side) {
  const kind = KINDS[kn], e = build(salt, kind, drop === null ? head : null, side), E = [];
  const eyeH = e.eyeHeight !== undefined ? e.eyeHeight : e.height * 0.85;
  for (let t = 1; t <= ticks; t++) {
    if (drop !== null && t === drop + 1) w.set(0, 1, 0, S.stateOf('sand'));
    e.x = side ? 1 - e.width * 0.425 : 0.5; e.z = 0.5; e.y = 0; e.vy = 0; e.onGround = true;
    EL.tick();
    E.push({ t, hp: e.health, inv: e.invulnerableTime | 0 });
    if (e.dead || e.removed || !(e.health > 0)) break;
  }
  const R = reference(kind, drop === null ? head : null, drop, ticks, eyeH, e.width, side);
  const n = Math.min(R.length, E.length);
  const rr = R.slice(0, n).map((r) => serverRow(r.t, { Health: r.hp, invulnerableTime: r.inv }));
  const ee = E.slice(0, n).map((r) => engineRow(r.t, { health: r.hp, invulnerableTime: r.inv }));
  return { d: compareTraces(rr, ee, FL), R, E };
}
const report = (res) => res.map((r) => `salt ${r.salt} tick ${r.d.tick} ${r.d.field} ${r.d.a} vs ${r.d.b}`).slice(0, 3);
const laneAll = (kn, head, drop, ticks, side) => salts.map((salt) => ({ salt, ...lane(salt, kn, head, drop, ticks, side) }));
for (const kn of Object.keys(KINDS))
  for (const head of ['stone', 'glass', 'stone_slab', 'oak_leaves']) {
    const res = laneAll(kn, head, null, 70);
    ok(res.every((r) => !r.d), `${kn} head in ${head}: ` + report(res.filter((r) => r.d)));
    const lost = res[0].R[res[0].R.length - 1].hp, want = SUFF[head] ? KINDS[kn].hp - 7 : KINDS[kn].hp;
    ok(lost === want, `${kn}/${head}: reference health after 70 ticks ${lost}, want ${want} (1 per 10 ticks while suffocating)`);
  }
for (const kn of Object.keys(KINDS)) {
  const res = laneAll(kn, 'air', 5, 50);
  ok(res.every((r) => !r.d), `${kn} sand lands on head at tick 5: ` + report(res.filter((r) => r.d)));
  ok(res[0].R[3].hp === KINDS[kn].hp && res[0].R[5].hp === KINDS[kn].hp - 1, `${kn}: no damage before the sand, first hit the tick after it lands`);
}
for (const kn of Object.keys(KINDS)) {
  const res = laneAll(kn, null, null, 40, true);
  ok(res.every((r) => !r.d), `${kn} stone beside the eye box edge (0.8 reach stops short of it): ` + report(res.filter((r) => r.d)));
  ok(res[0].R[res[0].R.length - 1].hp === KINDS[kn].hp, `${kn}: edge reference takes no damage`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const oi = Ph.IN_WALL_SHRINK; Ph.IN_WALL_SHRINK = 0.9;
brk(['cow', 'zombie', 'baby'].some((k) => laneAll(k, null, null, 40, true).some((r) => r.d)), 'eye box width 0.9 instead of 0.8 is reported'); Ph.IN_WALL_SHRINK = oi;
const on = Ph.suffocatesNever; Ph.suffocatesNever = () => false;
brk(['cow', 'zombie', 'baby'].some((k) => laneAll(k, 'glass', null, 70).some((r) => r.d)), 'glass and leaves counted as suffocating are reported'); Ph.suffocatesNever = on;
const oh = M.Combat.hurt; M.Combat.hurt = (e, a, ...r) => oh(e, a + 1, ...r);
brk(laneAll('cow', 'stone', null, 70).some((r) => r.d), 'wall damage 2 instead of 1 is reported'); M.Combat.hurt = oh;
console.log(`suffocatelockstepcheck: ${12 * 2 + 3 * 2 + 3 * 2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
