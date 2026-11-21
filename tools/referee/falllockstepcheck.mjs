// fall lockstep check -- #6296 (G17-L48): lockstep scenario 'fall'.
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
const { EntityList: EL, States: S } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp Entity.fall (fallDistance -= dy airborne; landing: handleFallDamage, then fallDistance = 0),
// LivingEntity.computeFallDamage ceil((fd - 3) * mult), HayBlock.onLandedUpon mult 0.2, water resets fallDistance. Positions come from the engine
// (physics is not under test); fallDistance, damage, health, hurtTime, onGround tick are stepped independently per tick.
const SAFE = { v: 3 };
const LANDS = { stone: 'stone', hay: 'hay_block', water: 'water' };
const MOBS = ['cow', 'zombie'], HEIGHTS = [4, 10, 30], TICKS = 70;
function lane(salt, mob, h, land) {
  cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { w.set(x, -1, z, S.stateOf('stone')); if (land === 'hay') w.set(x, 0, z, S.stateOf('hay_block')); if (land === 'water') { w.set(x, 0, z, S.stateOf('water')); w.set(x, 1, z, S.stateOf('water')); } }
  const top = land === 'stone' ? 0 : 1 + (land === 'water' ? 1 : 0);
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(mob, 0.5, top + h, 0.5); e.persistent = true;
  M.Player = { x: 30, y: 0, z: 30 };
  const mult = land === 'hay' ? 0.2 : land === 'water' ? 0 : 1;
  const st = { fd: 0, hp: e.health, hurt: 0, og: false, y: e.y, landed: -1 };
  const R = [], E = [];
  for (let t = 0; t < TICKS; t++) {
    const wasWet = land === 'water' && st.y < 2 - 1 / 9;   // box overlaps the water column at the start of the tick (Entity.baseTick updateWaterState -> onLanding)
    EL.tick();
    if (st.hurt > 0) st.hurt--;
    const dy = e.y - st.y; st.y = e.y;
    const og = !!e.onGround;
    if (wasWet) st.fd = 0;
    if (!og) { if (dy < 0) st.fd -= dy; }
    else if (st.fd > 0 && !(land === 'water')) {
      const dmg = mult === 0 ? 0 : Math.ceil((st.fd - SAFE.v) * mult);
      if (dmg > 0) { st.hp -= dmg; st.hurt = 10; }
      st.fd = 0;
    } else st.fd = 0;
    if (og && st.landed < 0) st.landed = t;
    R.push(serverRow(t, { Health: Math.max(0, st.hp), HurtTime: st.hurt, OnGround: st.landed >= 0 ? 1 : 0, FallDistance: Math.fround(st.fd) }));
    E.push(engineRow(t, { health: Math.max(0, e.health), hurtTime: e.hurtTime | 0, onGround: og, fallDistance: Math.fround(e.fallDistance || 0) }));
    if (e.health <= 0) break;
  }
  return { e, st, d: compareTraces(R, E, { fields: land === 'water' ? ['health', 'hurtTime'] : ['health', 'hurtTime', 'onGround', 'fallDistance'], tol: 1e-4 }) };
}
let cases = 0, dmgSeen = 0;
for (const mob of MOBS) for (const h of HEIGHTS) for (const land of Object.keys(LANDS)) {
  const rs = salts.map((s) => lane(s, mob, h, land)); cases++;
  const bad = rs.filter((x) => x.d);
  ok(!bad.length, `${mob} h${h} ${land}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
  if (rs[0].st.hp < rs[0].e.maxHealth) dmgSeen++;
}
ok(dmgSeen >= 6, 'damage actually exercised: ' + dmgSeen);
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
SAFE.v = 4;
const bd = lane(0, 'cow', 10, 'stone');
brk(bd.d && bd.d.field !== undefined, 'safe fall distance 3 -> 4 caught at tick ' + (bd.d && bd.d.tick));
SAFE.v = 3;
const hm = M.Physics.FALL_MULT.hay_block; M.Physics.FALL_MULT.hay_block = 1;
brk(!!lane(0, 'cow', 10, 'hay').d, 'hay multiplier 0.2 -> 1 caught'); M.Physics.FALL_MULT.hay_block = hm;
console.log(`falllockstepcheck: ${cases + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
