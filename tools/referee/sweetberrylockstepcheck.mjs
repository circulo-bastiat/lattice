// sweetberry lockstep check -- #8792 (G17-L241): lockstep scenario 'sweetberry'.
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
const { EntityList: EL, States: S, Physics: Ph, Combat: Cb } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
// Reference = .decomp SweetBerryBushBlock.onEntityCollision: living and not FOX/BEE -> slowMovement(0.8F, 0.75, 0.8F) (the NEXT move is scaled and the
// velocity zeroed, Entity.move head); age > 0 and |x - lastRenderX| >= 0.003F or |z - lastRenderZ| >= 0.003F -> damage(SWEET_BERRY_BUSH, 1.0F), gated by
// (zombie base armor 2: DamageUtil.getDamageLeft 1 * (1 - 1.5/25) = 0.94) the 20-tick invulnerableTime (hurtTime 10) like any hit. Scripted walk along +x through the bush cell x=4, then a slow creep.
const F = Math.fround, TICKS = 60;
function lane(salt, kind, age, o) {
  cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 12; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stateOf('stone'));
  w.set(4, 0, 0, M.Behave.setProp(S.stateOf('sweet_berry_bush'), 'age', String(age)));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(kind, 3.0, 0, 0.5); e.persistent = true; M.Player = { x: 30, y: 0, z: 30 };
  const hw = e.width / 2, thr = o.thr === undefined ? F(0.003) : o.thr, exempt = o.exempt || ['fox', 'bee'];
  const walk = 0.03 + 0.05 * r(), creep = 0.0031 + 0.002 * r();
  let x = e.x, hp = e.health, pend = false, inv = 0, hurt = 0; const bad = [];
  for (let t = 0; t < TICKS; t++) {
    const d0 = t < 25 ? walk : t < 40 ? creep : 0;
    e.px = e.x; e.py = e.y; e.pz = e.z; e.vx = d0; e.vz = 0;
    Cb.tickEntity(e);
    if (inv > 0) inv--; if (hurt > 0) hurt--;
    Ph.move(e, d0, 0, 0);
    const px = x, dx = pend ? d0 * F(0.8) : d0; pend = false; x += dx;
    const inB = Math.floor(x - hw + 0.001) <= 4 && 4 <= Math.floor(x + hw - 0.001);
    if (inB && !exempt.includes(kind)) {
      pend = true;
      if (age > 0 && Math.abs(x - px) >= thr && !(inv > 10)) { hp -= kind === 'zombie' ? 0.94 : 1; inv = 20; hurt = 10; }
    }
    const chk = [['x', x, e.x], ['vx', pend ? 0 : 0, e.vx], ['hp', hp, e.health], ['hurt', hurt > 0 ? 1 : 0, e.hurtTime > 0 ? 1 : 0]];
    for (const [n, a, b] of chk) if (n === 'vx' ? false : Math.abs(a - b) > 1e-6) bad.push({ t, n, ref: a, got: b });
    if (bad.length) break;
  }
  return bad.length ? bad[0] : null;
}
let cases = 0;
for (const kind of ['zombie', 'cow', 'fox', 'bee']) for (const age of [3, 0]) {
  const bad = salts.map((s) => lane(s, kind, age, {})).filter(Boolean); cases++;
  ok(!bad.length, `${kind} age=${age}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = (kinds, o) => kinds.some((k) => [0, 1, 2, 3, 4].some((s) => lane(s, k, 3, o)));
brk(anyBad(['zombie', 'cow'], { thr: 0.03 }), 'threshold 0.003 -> 0.03 caught');
brk(anyBad(['fox'], { exempt: ['bee'] }), 'fox exemption removed caught');
console.log(`sweetberrylockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
