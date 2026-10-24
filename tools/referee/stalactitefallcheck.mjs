// stalactitefall lockstep check -- #7083 (G17-L220): lockstep scenario 'stalactitefall'.
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
let fails = 0, breaks = 0, cases = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp Entity.fall (fallDistance -= dy airborne; landing: handleFallDamage, then fallDistance = 0),
// LivingEntity.computeFallDamage ceil((fd - 3) * mult), HayBlock.onLandedUpon mult 0.2, water resets fallDistance. Positions come from the engine
// (physics is not under test); fallDistance, damage, health, hurtTime, onGround tick are stepped independently per tick.

const D = M.Dripstone, P = M.Physics;
const drip = (th, dn) => S.withLocal('pointed_dripstone', th * 4 + (dn ? 2 : 0) + 1);   // thickness index, down?, not waterlogged
const CAP = { v: 40 }, EXTRA = { v: 2 }, TICKS = 60;
// Reference = .decomp PointedDripstoneBlock.spawnFallingBlock (hurt amount max(1 + y - cy, 6), max 40, tip only),
// FallingBlockEntity.tick (vy -= 0.04, move, drag 0.98; on ground hurtEntities: ceil(fd - 1) * amount capped), and
// PointedDripstoneBlock.fallOn (causeFallDamage(fd + 2.0, 2.0)) for the mob case.
function floor() { for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stateOf('stone')); }
function laneA(salt) {
  cells.clear(); EL.list.length = 0; floor();
  const r = stream(salt); EL.random = r; Math.random = r; M.Player = { x: 30, y: 0, z: 30 };
  const cow = EL.spawn('cow', 0.5, 0, 0.5); cow.persistent = true; cow.maxHealth = cow.health = 100;
  w.set(0, 18, 0, S.stateOf('stone'));
  w.set(0, 17, 0, drip(3, true)); w.set(0, 16, 0, drip(2, true)); w.set(0, 15, 0, drip(1, true));   // base, middle, tip
  D.scheduledTick(0, 17, 0);
  const fb = EL.list.filter((e) => e.type === 'falling_block'), tip = fb.find((e) => e.hurtEntities);
  let y = 15, vy = 0, hp = cow.health, hurt = 0, fd = 0, done = false, ground = false;
  const R = [], E = [];
  for (let t = 0; t < TICKS; t++) {
    EL.tick();
    if (hurt > 0) hurt--;
    if (!done) {
      vy -= 0.04; const ny = Math.max(y + vy, 0); const hit = ny === 0 && y + vy <= 0; fd -= (ny - y) < 0 ? ny - y : 0; y = ny;
      if (hit) { done = true; const n = Math.ceil(fd - 1); const amt = Math.min(Math.floor(n * Math.max(1 + 17 - 15, 6)), CAP.v); hp -= amt; hurt = 10; }
      else vy *= 0.98;
    }
    R.push(serverRow(t, { Health: Math.max(0, hp), HurtTime: hurt, PosY: done ? 0 : y, MotionY: done ? 0 : vy }));
    E.push(engineRow(t, { health: Math.max(0, cow.health), hurtTime: cow.hurtTime | 0, y: tip && !tip.removed ? tip.y : 0, vy: tip && !tip.removed ? tip.vy : 0 }));
    if (cow.health <= 0) break;
  }
  return { cow, hp, d: compareTraces(R, E, { fields: ['health', 'hurtTime', 'y', 'vy'], tol: 1e-9 }) };
}
function laneB(salt, onTip) {
  cells.clear(); EL.list.length = 0; floor();
  const r = stream(salt); EL.random = r; Math.random = r; M.Player = { x: 30, y: 0, z: 30 };
  if (onTip) w.set(0, 0, 0, drip(1, false) );
  const top = onTip ? 1 : 0;
  const z = EL.spawn('zombie', 0.5, top + 6, 0.5); z.persistent = true;
  let hp = z.health, hurt = 0, fd = 0, y = z.y, og = false;
  const R = [], E = [];
  for (let t = 0; t < TICKS; t++) {
    EL.tick();
    if (hurt > 0) hurt--;
    const dy = z.y - y; y = z.y; const g = !!z.onGround;
    if (!g) { if (dy < 0) fd -= dy; }
    else if (fd > 0) {
      const dmg = onTip ? Math.ceil((fd + EXTRA.v - 3) * 2) : Math.ceil(fd - 3);
      if (dmg > 0) { hp -= dmg; hurt = 10; }
      fd = 0;
    } else fd = 0;
    R.push(serverRow(t, { Health: Math.max(0, hp), HurtTime: hurt, FallDistance: Math.fround(fd) }));
    E.push(engineRow(t, { health: Math.max(0, z.health), hurtTime: z.hurtTime | 0, fallDistance: Math.fround(z.fallDistance || 0) }));
    if (z.health <= 0) break;
  }
  return { z, hp, d: compareTraces(R, E, { fields: ['health', 'hurtTime', 'fallDistance'], tol: 1e-4 }) };
}
for (const [nm, f] of [['stalactite on cow', laneA], ['zombie on stone', (s) => laneB(s, false)], ['zombie on tip', (s) => laneB(s, true)]]) {
  const rs = salts.map(f), bad = rs.filter((x) => x.d);
  ok(!bad.length, `${nm}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
  cases += 2; const x = rs[0]; ok((x.cow || x.z).maxHealth > x.hp, nm + ': damage exercised (hp ' + x.hp + ')');
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
EXTRA.v = 1; brk(!!laneB(0, true).d, 'fallOn extra distance 2.0 -> 1.0 caught'); EXTRA.v = 2;
CAP.v = 20; brk(!!laneA(0).d, 'stalactite damage cap 40 -> 20 caught'); CAP.v = 40;
console.log(`stalactitefallcheck: ${cases} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
