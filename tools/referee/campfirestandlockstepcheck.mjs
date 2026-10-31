// campfirestand lockstep check -- #8794 (G17-L244): lockstep scenario 'campfirestand'.
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
// Reference = .decomp CampfireBlock.onEntityCollision (isLit, !isFireImmune, LivingEntity, no FROST_WALKER -> damage(IN_FIRE, 1; SOUL_CAMPFIRE 2))
// through LivingEntity.damage's i-frames (invulnerable 20 ticks: a hit of <= lastDamage is ignored while the timer is > 10).
const TICKS = 60;
function lane(salt, kind, block, lit) {
  cells.clear(); EL.list.length = 0;
  const wall = S.stateOf('stone');
  for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
    w.set(x, -1, z, wall);
    if (Math.max(Math.abs(x), Math.abs(z)) === 1) for (let y = 0; y < 4; y++) w.set(x, y, z, wall);
  }
  const r = stream(salt); EL.random = r; Math.random = r;
  w.set(0, 0, 0, cfState(block, lit || forceLit));
  const e = EL.spawn(kind, 0.5, 0, 0.5); e.persistent = true; M.Player = { x: 30, y: 0, z: 30 };
  const amt = block === 'soul_campfire' ? 2 : 1;
  const fireImm = M.Combat.fireImmuneOf(e);
  let hp = e.health, timer = 0, last = 0, dead = false;
  const bad = [];
  for (let t = 0; t < TICKS; t++) {
    EL.tick();
    if (dead) break;
    if (timer > 0) timer--;
    if (lit && !fireImm) {
      if (timer > 10) { if (amt > last) { hp -= amt - last; last = amt; } }
      else { hp -= amt; last = amt; timer = 20; }
    }
    if (hp <= 0) dead = true;
    const got = e.removed || e.health <= 0 ? 0 : e.health;
    if (Math.abs(Math.max(0, hp) - got) > 1e-6) { bad.push({ t, ref: hp, got }); break; }
  }
  return bad[0] || null;
}
let forceLit = false;
const cfCache = {};
function cfState(name, lit) {   // the lit/unlit, not waterlogged state of the block, found by scanning the registry states
  const k = name + lit; if (cfCache[k] !== undefined) return cfCache[k];
  for (let id = 1; id < 20344; id++) if (S.block[id] === M.Reg.id[name] && (M.Reg.valueNames[S.propValue(id, M.Reg.PROP.lit)] === 'true') === lit
    && M.Reg.valueNames[S.propValue(id, M.Reg.PROP.waterlogged)] === 'false') return (cfCache[k] = id);
  throw new Error('no state ' + k);
}
let cases = 0;
for (const kind of ['zombie', 'pig', 'blaze', 'villager']) for (const block of ['campfire', 'soul_campfire']) for (const lit of [true, false]) {
  const bad = salts.map((s) => lane(s, kind, block, lit)).filter(Boolean); cases++;
  ok(!bad.length, `${kind} ${block} lit=${lit}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = () => [0, 1, 2].some((s) => lane(s, 'pig', 'soul_campfire', true) || lane(s, 'pig', 'campfire', false));
const R = M.Reg, hurt0 = M.Combat.hurt;
M.Combat.hurt = function (e, a, ...rest) { return hurt0.call(this, e, a === 2 ? 1 : a, ...rest); };
brk(anyBad(), 'soul damage 2 -> 1 caught'); M.Combat.hurt = hurt0;
forceLit = true;   // the unlit campfire behaves as lit = the isLit gate removed
brk(anyBad(), 'isLit gate removed caught'); forceLit = false;
console.log(`campfirestandlockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
