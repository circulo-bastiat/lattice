// slowfalling lockstep check -- #8761 (G17-L231): lockstep scenario 'slowfalling'.
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
// Reference = .decomp LivingEntity.travel (d = 0.08; vy <= 0 && SLOW_FALLING -> d = 0.01, onLanding() = fallDistance 0; move; vy = (vy - d) * 0.98),
// Entity.fall (fallDistance -= dy while airborne; landing: damage ceil(fd - 3), fd = 0, vy zeroed by the collision) and the effect removed at tick 60.
const TICKS = 200, REMOVE = 60;
function lane(salt, kind, withFx, remove) {
  cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stateOf('stone'));
  const r = stream(salt); EL.random = r; Math.random = r;
  const e = EL.spawn(kind, 0.5, 40, 0.5); e.persistent = true; M.Player = { x: 30, y: 0, z: 30 };
  if (withFx) M.Effects.addStatusEffect(e, 'slow_falling', 400, 0, false, true, true);
  const hp0 = e.health;
  let y = 40, vy = 0, fd = 0, hp = hp0, fx = withFx, dead = false; const bad = [];
  for (let t = 0; t < TICKS; t++) {
    if (remove && t === REMOVE) { M.Effects.removeStatusEffect(e, 'slow_falling'); fx = false; }
    EL.tick();
    if (dead) break;
    if (fx && vy <= 0) fd = 0;
    const g = fx && vy <= 0 ? 0.01 : 0.08;
    let ny = y + vy;
    if (ny <= 0) {
      fd -= 0 - y;
      const dmg = Math.ceil(fd - 3);
      y = 0; vy = 0;
      if (dmg > 0) hp = Math.max(0, hp - dmg);
      fd = 0;
    } else { fd -= ny - y; y = ny; }
    vy = (vy - g) * Math.fround(0.98);   // LivingEntity drag is the float 0.98F (#6964)
    if (hp <= 0) dead = true;
    const gotHp = e.removed || e.health <= 0 ? 0 : e.health;
    const chk = [['y', y, e.y], ['vy', vy, e.vy], ['fd', fd, e.fallDistance || 0], ['hp', hp, gotHp]];
    for (const [n, a, b] of chk) if (dead && n !== 'hp') continue; else if (Math.abs(a - b) > (n === 'y' ? 2 * Ph.EPS : 1e-6))   // the engine's shared collision keeps Ph.EPS above the floor
     bad.push({ t, n, ref: a, got: b });
    if (bad.length) break;
  }
  return bad.length ? bad[0] : null;
}
let cases = 0;
for (const kind of ['pig', 'villager']) for (const [fx, rm] of [[true, false], [true, true], [false, false]]) {
  const bad = salts.map((s) => lane(s, kind, fx, rm)).filter(Boolean); cases++;
  ok(!bad.length, `${kind} fx=${fx} remove=${rm}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = () => [0, 1, 2].some((s) => lane(s, 'pig', true, false) || lane(s, 'pig', true, true));
const g0 = Ph.SLOW_FALL_GRAVITY; Ph.SLOW_FALL_GRAVITY = 0.02;
brk(anyBad(), 'slow-fall gravity 0.01 -> 0.02 caught'); Ph.SLOW_FALL_GRAVITY = g0;
const tg = Ph.travelGravity;
Ph.travelGravity = (e) => (e.vy <= 0 && M.Effects.amplifierOf(e, 'slow_falling') >= 0 ? Ph.SLOW_FALL_GRAVITY : Ph.GRAVITY);
brk(anyBad(), 'fallDistance reset removed caught'); Ph.travelGravity = tg;
console.log(`slowfallinglockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
