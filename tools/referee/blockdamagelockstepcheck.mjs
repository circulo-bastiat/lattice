// blockdamage lockstep check -- #6716 (G17-L120): lockstep scenario 'blockdamage'.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { serverRow, engineRow, compareTraces } from './lockstep/trace.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
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
M.Reg.buildPhysics(rdj('block-physics.json'));
M.Use.init(w);
const { EntityList: EL, States: S, Physics: Ph } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp CactusBlock.onEntityCollision (CACTUS 1), MagmaBlock.onSteppedOn (HOT_FLOOR 1; not fire-immune, not Frost Walker),
// CampfireBlock.onEntityCollision (IN_FIRE fireDamage 1 / soul 2; lit, not fire-immune, not Frost Walker), SweetBerryBushBlock.onEntityCollision
// (age>0, |dx|>=0.003F or |dz|>=0.003F -> SWEET_BERRY_BUSH 1), WitherRoseBlock.onEntityCollision (Wither 40 ticks unless invulnerable to WITHER).
// LivingEntity.damage: a hit inside the grace window (timeUntilRegen > 10) is dropped; a landed hit of 1 sets the window to 20, and it falls 1 per tick.
const TICKS = 60, ARMOR = { zombie: 2, husk: 2 };
const FIRE_IMMUNE = { blaze: 1, husk: 0, zombie: 0, cow: 0 };
function lane(salt, block, type, o) {
  o = o || {}; cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stateOf('stone'));
  const r = stream(salt); EL.random = r; Math.random = r;
  let st = S.stateOf(block); for (const k in (o.state || {})) st = M.Behave.setProp(st, k, o.state[k]);
  const tall = block === 'cactus' || block === 'sweet_berry_bush' || block === 'wither_rose';
  if (block === 'magma_block') w.set(0, -1, 0, st); else w.set(0, 0, 0, st);
  M.Player = { x: 30, y: 0, z: 30 };
  const e = EL.spawn(type, 0.5, tall ? 0 : (block === 'magma_block' ? 0 : 0), 0.5); e.persistent = true;
  if (o.frost) e.frostWalker = 1;
  for (const sl of [M.Items.FEET, M.Items.LEGS, M.Items.CHEST, M.Items.HEAD, M.Items.MAINHAND, M.Items.OFFHAND]) if (sl !== undefined) M.Equip.setEquipped(e, sl, null);
  e.health = e.maxHealth = 40; e.onGround = true;
  const R2 = [], E = []; let hp = 40, grace = 0, wither = 0, lastX = e.x, lastZ = e.z, lastTrace = [];
  const immune = block === 'magma_block' || block === 'campfire' || block === 'soul_campfire' ? (FIRE_IMMUNE[type] || o.frost) : false;
  for (let t = 0; t < TICKS; t++) {
    if (o.move) e.vx = o.move; lastX = e.x; lastZ = e.z;   // the push is velocity: the hurt reads the displacement of THIS move
    EL.tick();
    if (grace > 0) grace--;
    const mdx = Math.abs(e.x - lastX), mdz = Math.abs(e.z - lastZ); 
    let amt = 0;
    if (block === 'cactus') amt = 1;
    else if (block === 'magma_block') amt = immune ? 0 : 1;
    else if (block === 'campfire') amt = immune || (o.state && o.state.lit === 'false') ? 0 : 1;
    else if (block === 'soul_campfire') amt = immune ? 0 : 2;
    else if (block === 'sweet_berry_bush') amt = (mdx >= Math.fround(0.003) || mdz >= Math.fround(0.003)) ? 1 : 0;
    if (amt && !/campfire/.test(block) && ARMOR[type]) amt = amt - Math.fround(Math.max(ARMOR[type] / 5, ARMOR[type] - amt / 2) / 25) * amt;   // armor 2 (Zombie/Husk base), not for IN_FIRE
    if (amt && grace <= 10) { hp -= amt; grace = 20; }
    R2.push(serverRow(t, { Pos: [0.5, 0, 0.5], Motion: [0, 0, 0], Health: hp }));
    E.push(engineRow(t, { x: 0.5, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, health: e.health }));
  }
  return { e, d: compareTraces(R2, E, { fields: ['health'], tol: { health: 1e-6 } }) };
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
let cases = 0;
const CASES = [['cactus', 'cow'], ['cactus', 'zombie'], ['magma_block', 'cow'], ['magma_block', 'zombie'], ['magma_block', 'husk'], ['magma_block', 'blaze'],
  ['campfire', 'cow'], ['campfire', 'husk'], ['campfire', 'blaze'], ['soul_campfire', 'zombie'], ['soul_campfire', 'blaze']];
for (const [b, t] of CASES) {
  const rs = salts.map((s) => lane(s, b, t, { state: b.endsWith('campfire') ? { lit: 'true' } : undefined })); cases++;
  const bad = rs.filter((x) => x.d);
  ok(!bad.length, `${b}/${t}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
}
for (const b of ['magma_block', 'campfire']) { const rs = salts.map((s) => lane(s, b, 'cow', { frost: true, state: b === 'campfire' ? { lit: 'true' } : undefined })); cases++;
  const bad = rs.filter((x) => x.d); ok(!bad.length, `${b}/cow frost walker: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`); }
{ const rs = salts.map((s) => lane(s, 'campfire', 'cow', { state: { lit: 'false' } })); cases++; const bad = rs.filter((x) => x.d); ok(!bad.length, `unlit campfire: ${bad.length}/20 diverge`); }
for (const mv of [0, 0.002, 0.004]) { const rs = salts.map((s) => lane(s, 'sweet_berry_bush', 'zombie', { move: mv, state: { age: '3' } })); cases++;
  const bad = rs.filter((x) => x.d); ok(!bad.length, `sweet_berry_bush move ${mv}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`); }
// wither rose: Wither 40 ticks (WitherRoseBlock), not on Peaceful, not for wither mobs
function rose(type) {
  cells.clear(); EL.list.length = 0; for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stateOf('stone'));
  w.set(0, 0, 0, S.stateOf('wither_rose')); const e = EL.spawn(type, 0.5, 0, 0.5); e.persistent = true; EL.tick();
  const f = M.Effects.getStatusEffect(e, 'wither'); return f;
}
//ROSE
for (const sd of salts) { Math.random = stream(sd); const c = rose('cow'); ok(c && c.amplifier === 0 && c.duration >= 39 && c.duration <= 40, 'wither rose: cow gets Wither I for 40 ticks ' + JSON.stringify(c)); ok(!rose('wither_skeleton'), 'wither rose: wither_skeleton immune'); } cases += 2;
{ // anti-vacuity: the sweet-berry threshold (0.003) and the campfire damage must be seen by the lanes
  const bad = (opts, b, t) => salts.some((s) => lane(s, b, t, opts).d);
  const keep = M.Use.entityCollide, ec = keep;
  const thr = (th) => { M.Use.entityCollide = function (e) { const px = e.px, pz = e.pz; if (px !== undefined) { const f = Math.abs(e.x - px) >= 0.003 || Math.abs(e.z - pz) >= 0.003, g = Math.abs(e.x - px) >= th || Math.abs(e.z - pz) >= th; if (f && !g) { e.px = e.x; e.pz = e.z; } else if (!f && g) { e.px = e.x - 0.003; } } return ec.call(M.Use, e); }; };
  thr(0.0045); brk(bad({ move: 0.004, state: { age: '3' } }, 'sweet_berry_bush', 'zombie'), 'sweet-berry threshold 0.003 -> 0.0045 caught');
  thr(0.001); brk(bad({ move: 0.002, state: { age: '3' } }, 'sweet_berry_bush', 'zombie'), 'sweet-berry threshold 0.003 -> 0.001 caught'); M.Use.entityCollide = keep;
  const th = EL.tickHazards; EL.tickHazards = function (e) { const f = e.frostWalker; e.frostWalker = 0; try { return th.call(EL, e); } finally { e.frostWalker = f; } };
  brk(bad({ frost: true }, 'magma_block', 'cow'), 'Frost Walker exemption removed (magma) caught'); EL.tickHazards = th;
  const hurt = M.Combat.hurt; M.Combat.hurt = function (e, a, x, y, src) { return hurt.call(M.Combat, e, src && src.source === 'cactus' ? 2 : a, x, y, src); };
  brk(bad({}, 'cactus', 'cow'), 'cactus 1 -> 2 caught'); M.Combat.hurt = hurt;
}
console.log(`blockdamagelockstepcheck: ${cases} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
