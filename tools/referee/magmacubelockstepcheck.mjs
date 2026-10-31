// magmacube lockstep check -- #6859 (G17-L158): lockstep scenario 'magmacube'.
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
if (M.Slime && M.Slime.init) M.Slime.init();
const { EntityList: EL, States: S } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const Sl = M.Slime, SIZES = [1, 2, 4], TICKS = 160;
// Reference = .decomp SlimeEntity.getTicksUntilNextJump nextInt(20)+10 (MagmaCubeEntity *4; SlimeMoveControl jumpOften /3),
// SlimeEntity.jump getJumpVelocity (0.42), MagmaCubeEntity.jump +size*0.1, swimUpward 0.22+size*0.05,
// getDamageAmount = ATTACK_DAMAGE (size) (+2 magma), MagmaCubeEntity.isOnFire false.
const REF = { delay: 20, base: 10 };
const refDelay = (d, mob, often) => { let t = Math.floor(d * REF.delay) + REF.base; if (mob === 'magma_cube') t *= 4; return often ? Math.floor(t / 3) : t; };
const K = { jump: 0.42 };
const refJump = (mob, size) => K.jump + (mob === 'magma_cube' ? size * 0.1 : 0);
const refDmg = (mob, size) => size + (mob === 'magma_cube' ? 2 : 0);
const refLava = (mob, size) => 0.22 + size * 0.05;
function lane(salt, mob, size, lava) {
  cells.clear(); EL.list.length = 0;
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) { w.set(x, -1, z, S.stateOf('stone')); w.set(x, -2, z, S.stateOf('stone')); }
  if (lava) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) { w.set(x, -1, z, S.stateOf('lava')); w.set(x, 0, z, S.stateOf('lava')); }
  const r = stream(salt); let draws = []; const rr = () => { const v = r(); draws.push(v); return v; };
  EL.random = rr; Math.random = rr;
  const e = EL.spawn(mob, 0.5, lava ? 0.2 : 0, 0.5); e.persistent = true; Sl.setSize(e, size, true);
  const hits = []; const oh = M.Survival.hurt; M.Survival.hurt = (p, src, amt) => { hits.push(amt); return true; };
  M.Player = { x: 1.2, y: 0, z: 0.5, width: 0.6, height: 1.8 };
  const R = [], E = [];
  let prev = e.slimeTicksUntilJump, jumps = 0, rolls = 0, fire = 0;
  for (let t = 0; t < TICKS; t++) {
    draws = []; const pvy = e.vy, nh = hits.length;
    EL.tick();
    const rolled = e.slimeTicksUntilJump !== undefined && e.slimeTicksUntilJump > (prev === undefined ? -1 : prev) + 0 && !lava;
    let delayOk = 1;
    if (rolled) { rolls++; delayOk = draws.some((d) => [false, true].some((o) => refDelay(d, mob, o) === e.slimeTicksUntilJump)) ? 1 : 0; }
    prev = e.slimeTicksUntilJump;
    const jumped = rolled && e.vy > 0.3;
    let jv = 1; if (jumped) { jumps++; jv = Math.abs(e.vy - (refJump(mob, size) - 0.08) * 0.98) < 1e-4 ? 1 : 0; }
    const dmg = hits.length - nh; let dm = 1; const gone = e.dead || e.removed || e.health <= 0; for (let i = nh; i < hits.length && !gone; i++) if (hits[i] !== refDmg(mob, size)) dm = 0;
    if (mob === 'slime' && lava && e.onFire) fire++;
    R.push(serverRow(t, { Health: 1, HurtTime: 0, Motion: [0, 0, 0], D: delayOk, J: jv, A: dm, F: mob === 'magma_cube' ? 0 : -1 }));
    E.push(engineRow(t, { health: 1, hurtTime: 0, vx: 0, vy: 0, vz: 0, D: 1, J: 1, A: 1, F: mob === 'magma_cube' ? (e.onFire ? 1 : 0) : -1 }));
    if (!delayOk || !jv || !dm) { R[R.length - 1].bad = 1; }
    if (!delayOk) E[E.length - 1] = engineRow(t, { health: 0, hurtTime: 0, vx: 0, vy: 0, vz: 0 });
    if (!jv || !dm) E[E.length - 1] = engineRow(t, { health: 0, hurtTime: 0, vx: 0, vy: 0, vz: 0 });
  }
  M.Survival.hurt = oh;
  return { e, hits: hits.length, jumps, rolls, fire, d: compareTraces(R, E, { fields: ['health', 'hurtTime', 'vel'], tol: 1e-4 }) };
}
let cases = 0, rollsSeen = 0, jumpsSeen = 0, hitsSeen = 0, fireSeen = 0;
for (const mob of ['slime', 'magma_cube']) for (const size of SIZES) for (const lava of [false, true]) {
  if (mob === 'slime' && size === 1 && lava) continue;
  const rs = salts.map((s) => lane(s, mob, size, lava)); cases++;
  const bad = rs.filter((x) => x.d);
  ok(!bad.length, `${mob} size${size}${lava ? ' lava' : ''}: ${bad.length}/20 diverge ${bad[0] ? JSON.stringify(bad[0].d) : ''}`);
  for (const x of rs) { rollsSeen += x.rolls; jumpsSeen += x.jumps; hitsSeen += x.hits; fireSeen += x.fire; }
  if (lava) ok(rs.every((x) => (mob === 'magma_cube') === !x.e.onFire || mob === 'slime'), `${mob} size${size} lava fire flag`);
}
ok(rollsSeen > 100, 'delay rolls exercised: ' + rollsSeen);
ok(jumpsSeen > 50, 'jumps exercised: ' + jumpsSeen);
ok(hitsSeen > 20, 'contact damage exercised: ' + hitsSeen);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const anyBad = (mob, size, lava) => salts.some((s) => lane(s, mob, size, lava).d);
REF.delay = 19;
brk(anyBad('slime', 2, false), 'jump delay nextInt 20 -> 19 caught'); REF.delay = 20;
REF.base = 11;
brk(anyBad('magma_cube', 2, false), 'jump delay base 10 -> 11 caught'); REF.base = 10;
const od = Sl.ticksUntilNextJump; Sl.ticksUntilNextJump = (r, e) => { const t = od(r, e); return t + 1; };
brk(anyBad('slime', 1, false), 'engine jump delay +1 caught'); Sl.ticksUntilNextJump = od;
const oa = M.Slime.setSize; Sl.setSize = function (e, s, h) { oa(e, s, h); e.attackDamage = s; };
const mk = lane(0, 'magma_cube', 2, false);
brk(mk.hits > 0 ? !!(Sl.setSize(mk.e, 2, true), anyBad('magma_cube', 2, false)) : false, 'magma damage without +2 caught'); Sl.setSize = oa;
K.jump = 0.41;
brk(anyBad('magma_cube', 4, false), 'jump velocity 0.42 -> 0.41 caught'); K.jump = 0.42;
console.log(`magmacubecheck: ${cases + 3} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
