// cactusprick lockstep check -- #8793 (G17-L242): lockstep scenario 'cactusprick'.
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
const CX = 3, TICKS = 60;
// Reference = .decomp CactusBlock.getCollisionShape (x 1/16..15/16 so the walker stops at CX + 1/16 - hw), Entity.checkBlockCollisions
// (box shrunk 0.001 overlaps the cell -> onEntityCollision -> damage(CACTUS, 1)), LivingEntity.damage (invulnerableTime 20, ticking down;
// while > 10 an amount <= lastDamage is ignored; armor 2 on a zombie: 1 * (1 - clamp(2 - 1/2, 2/5, 20)/25)) and ItemEntity.damage
// (health 5, -1 per hit with no grace, discarded at 0).
const KINDS = { zombie: { armor: 2 }, pig: { armor: 0 }, skeleton: { armor: 0 }, item: {} };
function lane(salt, kind) {
  cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 8; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stateOf('stone'));
  for (let y = 0; y < 3; y++) w.set(CX, y, 0, S.stateOf('cactus'));
  const r = stream(salt); EL.random = r; Math.random = r; M.Player = { x: 30, y: 0, z: 30 };
  const x0 = 1 + Math.floor(r() * 8) / 16, v = 0.05 + Math.floor(r() * 6) / 40;
  const e = EL.spawn(kind, x0, 0, 0.5); e.persistent = true; if (e.ai) e.ai.tick = () => {};   // not aiDisabled: NoAI mobs skip travel (#9462), so the push would never move them
  const { armor } = KINDS[kind], hw = e.width / 2, item = kind === 'item';
  let x = x0, iv = 0, hp = item ? 5 : e.health, gone = false;
  const dmg = item ? 1 : 1 * (1 - Math.min(20, Math.max(armor - 0.5, armor / 5)) / 25);
  for (let t = 0; t < TICKS; t++) {
    e.vx = v; EL.tick();
    if (iv > 0) iv--;
    if (!gone) {
      x = Math.min(x + v, CX + 1 / 16 - hw);
      if (x + hw - 0.001 >= CX) {
        if (item) { hp -= 1; if (hp <= 0) gone = true; }
        else if (iv <= 10) { hp -= dmg; iv = 20; }
      }
    }
    const got = e.removed || (item && e.health <= 0) ? 0 : e.health;
    if (gone !== !!e.removed) return { t, n: 'removed', ref: gone, got: !!e.removed };
    if (gone) continue;
    if (Math.abs(x - e.x) > 2 * Ph.EPS) return { t, n: 'x', ref: x, got: e.x };
    if (Math.abs(hp - got) > 1e-4) return { t, n: 'hp', ref: hp, got };
    if (!item && iv !== e.invulnerableTime) return { t, n: 'iv', ref: iv, got: e.invulnerableTime };
  }
  return null;
}
if (process.env.DBG) for (const k of ['zombie','skeleton']) salts.forEach((s) => { const b = lane(s, k); if (b) console.log(k, s, JSON.stringify(b)); });
let cases = 0;
for (const kind of Object.keys(KINDS)) {
  const bad = salts.map((s) => lane(s, kind)).filter(Boolean); cases++;
  ok(!bad.length, `${kind}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = () => Object.keys(KINDS).some((k) => [0, 1, 2].some((s) => lane(s, k)));
const sf = Ph.shapesFor, cactusId = M.Reg.id.cactus;
Ph.shapesFor = (id) => (M.States.block[id] === cactusId ? Ph.FULL_CUBE : sf(id));
brk(anyBad(), 'collision inset 1/16 -> 0 caught'); Ph.shapesFor = sf;
const hu = M.Combat.hurt;
M.Combat.hurt = (e, a, ...rest) => hu(e, rest[2] && rest[2].source === 'cactus' ? a * 2 : a, ...rest);
brk(anyBad(), 'damage 1 -> 2 caught'); M.Combat.hurt = hu;
console.log(`cactuspricklockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
