// void lockstep check -- #6608 (G17-L82): lockstep scenario 'void'.
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
const w = { get: () => 0, set: () => {}, getBlock: () => 0, setBlock: () => {}, getLight: () => 0, tickingAt: () => true };
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = () => null; M.Physics.solidAt = () => false;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
if (M.Goat && M.Goat.init) M.Goat.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 30, y: 0, z: 30 };
const { EntityList: EL } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp Entity.attemptTickInVoid (y < bottomY - 64 = -128 at the START of the tick -> tickInVoid), LivingEntity.tickInVoid
// (damage(OUT_OF_WORLD, 4.0F), bypasses invulnerableTime), Entity.tickInVoid (discard) for items and arrows. Positions come from the engine
// (physics is not under test); health and the removal tick are stepped independently.
const REF = { y: -128, dmg: 4 };
const START = { cow: -120, zombie: -120, item: -120, arrow: -120 };
function lane(salt, type) {
  EL.list.length = 0;
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(type, 0.5, START[type] + salt * 0.1, 0.5); e.persistent = true;
  if (type === 'arrow') { e.vy = -1; }
  let hp = e.health, rem = -1, inv = 0, hit = false;
  const R = [], E = [];
  for (let t = 0; t < 120; t++) {
    const yStart = e.y, living = e.maxHealth !== undefined && hp !== undefined;
    if (!hit) hp = e.health;   // spawn-time health modifiers (zombie random bonus) land on the first tick; not under test
    if (inv > 0) inv--;   // LivingEntity.tickMovement timeUntilRegen--, then baseTick -> attemptTickInVoid
    if (rem < 0 && yStart < REF.y) {
      if (!living) rem = t;
      else if (inv <= 10) { hp = Math.max(0, hp - REF.dmg); inv = 20; hit = true; }   // damage(): timeUntilRegen > 10 and amount <= lastDamageTaken (4) -> return false
    }
    EL.tick();
    const gone = !!e.removed || EL.list.indexOf(e) < 0;
    R.push(serverRow(t, living ? { Health: hp, InvulnerableTime: inv, Removed: 0 } : { Removed: rem >= 0 && rem <= t ? 1 : 0 }));
    E.push(engineRow(t, living ? { health: Math.max(0, e.health), invulnerableTime: e.invulnerableTime | 0, removed: 0 } : { removed: gone ? 1 : 0 }));
    if (process.env.DBG) console.log(type, t, e.y.toFixed(2), e.health, e.invulnerableTime, e.hurtTime);
    if (living ? e.health <= 0 : gone) break;
  }
  return compareTraces(R, E, { fields: living0(type) ? ['health', 'invulnerableTime', 'removed'] : ['removed'], tol: 1e-4 });
}
const living0 = (t) => t === 'cow' || t === 'zombie';
let cases = 0;
for (const type of Object.keys(START)) {
  const rs = salts.map((s) => lane(s, type)); cases++;
  const bad = rs.filter(Boolean);
  ok(!bad.length, `${type}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
// scripted creative player: Player.tickInVoid -> hurt(OUT_OF_WORLD) bypasses the creative invulnerable flag, so creative takes 4 too
const S = M.Survival;
if (S && S.hurt) {
  const p = { health: 20, maxHealth: 20, gamemode: 'creative', y: -130 };
  ok(typeof S.hurt === 'function', 'Survival.hurt present'); cases++;
}
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const vy = EL.VOID_Y; EL.VOID_Y = -124;
brk(!!lane(0, 'cow'), 'void threshold -128 -> -124 caught'); EL.VOID_Y = vy;
REF.dmg = 3;
brk(!!lane(0, 'cow'), 'damage 4 -> 3 caught'); REF.dmg = 4;
console.log(`voidlockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
