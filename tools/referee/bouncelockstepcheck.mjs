// bounce lockstep check -- #6712 (G17-L116): lockstep scenario 'bounce'.
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
const K = { bed: 0.66 };
const LANDS = { slime: 'slime_block', bed: 'white_bed', hay: 'hay_block', honey: 'honey_block', stone: 'stone' };
const MULT = { slime: 0, bed: 1, hay: 0.2, honey: 0.2, stone: 1 };
const MOBS = ['cow', 'zombie'], HEIGHTS = [3, 8, 20], TICKS = 80;
// Reference = .decomp SlimeBlock.onEntityLand/bounce (vy -> -vy), BedBlock.bounceEntity (-vy * 0.66), fallOn multipliers
// (slime 0, hay/honey 0.2, bed halves the distance), computeFallDamage ceil((fd-3)*mult). vy is stepped independently
// from the pre-landing velocity (end of previous tick); the tick's gravity step follows: (v - 0.08) * 0.98.
function lane(salt, mob, h, land, sneak) {
  cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) { w.set(x, -1, z, S.stateOf('stone')); if (land !== 'stone') w.set(x, 0, z, S.stateOf(LANDS[land])); }
  const top = land === 'stone' ? 0 : 1;
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(mob, 0.5, top + h + salt * 0.05, 0.5); e.persistent = true; if (sneak) e.edgeGuard = true;
  M.Player = { x: 30, y: 0, z: 30 };
  const st = { fd: 0, hp: e.health, hurt: 0, y: e.y, pv: 0, landed: false };
  const bounces = (land === 'slime' || land === 'bed') && !sneak, fac = land === 'slime' ? 1 : K.bed;
  const R = [], E = [];
  for (let t = 0; t < TICKS; t++) {
    EL.tick();
    if (st.hurt > 0) st.hurt--;
    const dy = e.y - st.y; st.y = e.y;
    const hit = !st.landed && st.pv < -0.3 && (e.onGround || e.vy > 0);
    let vy = 0;
    if (hit) {
      st.landed = true;
      let fd = st.fd; if (land === 'bed') fd *= 0.5;
      const dmg = Math.ceil((fd - 3) * MULT[land]);
      if (dmg > 0) { st.hp -= dmg; st.hurt = 10; }
      st.fd = 0;
      vy = bounces ? (-st.pv * fac - 0.08) * 0.98 : e.vy;
    } else { if (dy < 0 && !st.landed) st.fd -= dy; if (!st.landed) st.pv = e.vy; vy = e.vy; }
    R.push(serverRow(t, { Health: Math.max(0, st.hp), HurtTime: st.hurt, Motion: [e.vx || 0, vy, e.vz || 0] }));
    E.push(engineRow(t, { health: Math.max(0, e.health), hurtTime: e.hurtTime | 0, vx: e.vx || 0, vy: e.vy, vz: e.vz || 0 }));
    if (st.landed) break;
  }
  return { e, st, d: compareTraces(R, E, { fields: ['health', 'hurtTime', 'vel'], tol: 1e-4 }) };
}
let cases = 0, dmgSeen = 0;
for (const sneak of [false, true]) for (const mob of MOBS) for (const h of HEIGHTS) for (const land of Object.keys(LANDS)) {
  if (sneak && land !== 'slime' && land !== 'bed') continue;
  const rs = salts.map((s) => lane(s, mob, h, land, sneak)); cases++;
  const bad = rs.filter((x) => x.d);
  ok(!bad.length, `${mob} h${h} ${land}${sneak ? ' sneak' : ''}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
  if (rs[0].st.hp < rs[0].e.maxHealth) dmgSeen++;
}
ok(dmgSeen >= 6, 'damage actually exercised: ' + dmgSeen);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
K.bed = 0.67;
brk(!!lane(0, 'cow', 8, 'bed', false).d, 'bed factor 0.66 -> 0.67 caught');
K.bed = 0.66;
const hm = MULT.hay; MULT.hay = 1;
brk(!!lane(0, 'cow', 8, 'hay', false).d, 'hay multiplier 0.2 -> 1 caught'); MULT.hay = hm;
const sm = M.Physics.FALL_MULT.slime_block; M.Physics.FALL_MULT.slime_block = 1;
brk(!!lane(0, 'cow', 20, 'slime', false).d, 'engine slime fall multiplier 0 -> 1 caught'); M.Physics.FALL_MULT.slime_block = sm;
console.log(`bouncelockstepcheck: ${cases + 1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
