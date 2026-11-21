// anvilhurt lockstep check -- #8765 (G17-L235): lockstep scenario 'anvilhurt'.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
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
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); return true; } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true; w.canSurvive = () => true;
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
const { EntityList: EL, States: S, Physics: Ph, Reg: R } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const anvilSt = S.stateOf('anvil');
const nameOf = (st) => R.names[S.block[st]];
// Reference = .decomp FallingBlockEntity.handleFallDamage (n = ceil(fd - 1); amount = min(floor(n * 2.0), 40); every entity in the box takes
// DamageSource.ANVIL; amount > 0 && nextFloat < 0.05 + n * 0.05 steps anvil -> chipped -> damaged -> destroyedOnLanding) and
// LivingEntity.damage (the helmet's x0.75 comes AFTER applyDamage in 1.18.2: it scales knockback only, health is untouched);
// DamageUtil.getDamageLeft for the zombie's 2.0 base armor.
const left = (d, a) => d * (1 - Math.min(20, Math.max(a / 5, a - d / 2)) / 25);   // toughness 0
const ARMOR = { pig: 0, zombie: 2 };
const CAP = { v: 40 };
function lane(salt, kind, height, helmet) {
  cells.clear(); EL.list.length = 0;
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) w.set(x, -1, z, S.stone || S.stateOf('stone'));
  const r = stream(salt), rr = stream(salt + 1000); Math.random = r; M.Player = { x: 30, y: 0, z: 30 };
  const m = EL.spawn(kind, 0.5, 0, 0.5); m.persistent = true; m.invulnerableTime = 0;
  if (helmet) M.Equip.setEquipped(m, M.Items.HEAD, { i: M.Items.of('carved_pumpkin'), n: 1 });
  const hp0 = m.health;
  const a = EL.spawn('falling_block', 0.5, height, 0.5, { state: anvilSt });
  EL.random = (() => { const f = () => r(); return f; })();
  const draws = []; const orig = EL.tickFallingBlock;
  EL.tickFallingBlock = function (e, fd) { const save = EL.random; EL.random = () => { const v = rr(); draws.push(v); return v; }; try { return orig.call(this, e, fd); } finally { EL.random = save; } };
  // reference kinematics: vy -= 0.04; move (clipped by the floor at y = 0); landing => handleFallDamage; drag 0.98
  let y = height, vy = 0, fd = 0, hp = hp0, land = null, rolled = 0;
  const bad = [];
  for (let t = 0; t < 120; t++) {
    EL.tick();
    if (!land) {
      vy -= 0.04; const ny = y + vy;
      if (ny <= 0) {
        fd -= 0 - y; y = 0; vy = 0;
        const n = Math.ceil(fd - 1);
        if (n >= 0) {
          const amt = Math.min(Math.floor(n * 2), CAP.v);
          const hw = (m.width || 0.6) / 2 + 0.49;   // the mob may have wandered: only a box overlap is hurt
          if (amt > 0 && Math.abs(m.x - 0.5) < hw && Math.abs(m.z - 0.5) < hw) hp = Math.max(0, hp - left(amt, ARMOR[kind]));
          land = { n, amt };
          if (amt > 0) rolled = rr2(salt, n);
        } else land = { n, amt: 0 };
      } else { fd -= ny - y; y = ny; vy *= 1; }
      if (!land) vy *= 0.98;
    }
    if (!land || t < 0) { /* airborne */ }
    const gotHp = m.removed || m.health <= 0 ? 0 : m.health;
    if (Math.abs(hp - gotHp) > 1e-4) { bad.push({ t, n: 'hp', ref: hp, got: gotHp }); break; }
    if (hp <= 0) break;
  }
  EL.tickFallingBlock = orig;
  if (!bad.length && land) {
    let want = 'anvil';
    if (rolled === 1) want = 'chipped_anvil'; else if (rolled === 2) want = 'gone';
    const got = nameOf(w.get(0, 0, 0));
    const gotName = got === 'air' || !w.get(0, 0, 0) ? 'gone' : got;
    if (gotName !== want) bad.push({ n: 'landing', ref: want, got: gotName });
  } else if (!bad.length) bad.push({ n: 'never landed' });
  return bad.length ? bad[0] : null;
  function rr2(sa, n) { const q = stream(sa + 1000); return q() < 0.05 + n * 0.05 ? 1 : 0; }
}
let cases = 0;
for (const kind of ['pig', 'zombie']) for (const h of [2, 6, 25]) for (const helm of [false, true]) {
  const bad = salts.map((s) => lane(s, kind, h, helm)).filter(Boolean); cases++;
  ok(!bad.length, `${kind} h=${h} helmet=${helm}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0]) : ''}`);
}
const brk = (c, m) => { if (c) { breaks++; console.log('   \u2713 break caught: ' + m); } else { fails++; console.log('  \u2717 break NOT caught: ' + m); } };
const anyBad = () => [0, 1, 2, 3].some((s) => lane(s, 'pig', 25, false) || lane(s, 'zombie', 25, true));
CAP.v = 20; brk(anyBad(), 'damage cap 40 -> 20 caught'); CAP.v = 40;
const hu = M.Combat.hurt;
M.Combat.hurt = (e, amt, ...rest) => hu(e, amt * 0.75, ...rest);
brk([0, 1, 2, 3].some((s) => lane(s, 'zombie', 6, true)), 'helmet x0.75 applied to health caught'); M.Combat.hurt = hu;
console.log(`anvilhurtlockstepcheck: ${cases + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
