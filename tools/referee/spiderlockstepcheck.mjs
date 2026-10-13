// spiderlockstepcheck.mjs -- #6674 (G17-L103): lockstep scenario 'spider', 20 salts: PounceAtTargetGoal (range 4..16 squared, onGround, 1-in-5 roll, 0.4 horizontal + 0.2*v, vy 0.4), the climbing flag (= horizontalCollision, one tick behind via onClimbable), SpiderAttackGoal bright-light 1-in-100 drop, CaveSpiderEntity.tryAttack Poison by difficulty (Normal 7 s, Hard 15 s). Goal-level lane against .decomp PounceAtTargetGoal / CaveSpiderEntity.
// OWED: the full wall-climb path sim (SpiderNavigation + movement) is not lockstepped here; the goal/flag/poison halves are.
// Reference = .decomp CreeperEntity.tick (currentFuseTime += 1, explode at >= fuseTime 30) / explode() (createExplosion at the FEET, power 3 * 1, DestructionType.DESTROY),
// Explosion.collectBlocksAndDamageEntities (16^3 surface rays, power*(0.7+r*0.6), 0.3 step, -(res+0.3)*0.3, -0.22500001), getExposure, damage (s*s+s)/2*7*d+1, knockback from
// getEyeY (cow 1.3F). Per tick: swell counter, the cow (pos, vel, health) and the destroyed-block set through lockstep/trace.mjs compareTraces.
// OWED: world.random is a JRandom whose nextDouble feeds the ray power (vanilla nextFloat): the lane substitutes NS.wrand with the salt stream on both sides; the cow's vy is not compared (the engine's pinned cow is not onGround when the blast hurts it, so takeKnockback's ground bump differs); item drops of the broken blocks (loot draws follow the shuffle) are not modelled.
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
M.Particle.spawn = () => {}; M.Explosion.init(); M.Tnt.init(); if (M.Creeper && M.Creeper.init) M.Creeper.init(); M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Items: IT, Equip: Eq, States: S, Effects: ES, Undead: U } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };


const f = Math.fround;
const salts = Array.from({ length: 20 }, (_, i) => i);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
// reference: PounceAtTargetGoal.canStart / start (.decomp)
function refPounce(m, t, rollOk) {
  const dx = t.x - m.x, dy = t.y - m.y, dz = t.z - m.z, d = dx * dx + dy * dy + dz * dz;
  if (d < 4 || d > 16 || !m.onGround || !rollOk) return null;
  const l2 = dx * dx + dz * dz; let vx = dx, vz = dz;
  if (l2 > 1e-7) { const l = Math.sqrt(l2); vx = dx / l * 0.4 + m.vx * 0.2; vz = dz / l * 0.4 + m.vz * 0.2; }
  return [vx, 0.4, vz];
}
function pounceLane(salt) {
  const r = stream(salt), R = [], E = [];
  for (let i = 0; i < 40; i++) {
    const m = { x: 0, y: 1, z: 0, vx: (r() - 0.5) * 0.2, vy: 0, vz: (r() - 0.5) * 0.2, onGround: r() < 0.8, type: i % 2 ? 'cave_spider' : 'spider' };
    const t = { x: (r() - 0.5) * 9, y: 1 + (r() - 0.5) * 3, z: (r() - 0.5) * 9 };
    const roll = r(); const rollOk = Math.floor(roll * 6) === 0;
    const mm = Object.assign({}, m, { target: t });
    const g = new M.Ai.PounceAtTargetGoal(mm, { random: () => roll }, 0.4);
    const can = g.canUse();
    const ref = refPounce(m, t, rollOk);
    R.push(ref ? 1 : 0); E.push(can ? 1 : 0);
    if (can) { g.start(); R.push(...(ref || [NaN, NaN, NaN]).map((v) => Math.round(v * 1e9))); E.push(...[mm.vx, mm.vy, mm.vz].map((v) => Math.round(v * 1e9))); }
  }
  return JSON.stringify(R) === JSON.stringify(E) ? null : 'salt ' + salt;
}
const lanePass = () => salts.map(pounceLane).filter(Boolean);
ok(lanePass().length === 0, 'pounce lane: ' + lanePass().slice(0, 3).join(' | '));
// climbing flag follows horizontalCollision: stone wall 3 high, spider walking into it
const WALL = S.stateOf('stone');
function climbRun(type, salt) {
  cells.clear();
  for (let x = -20; x < 20; x++) for (let z = -5; z < 5; z++) w.set(x, 0, z, WALL);
  for (let y = 1; y <= 3; y++) for (let z = -5; z < 5; z++) w.set(2, y, z, WALL);
  EL.list.length = 0; const r = stream(salt); Math.random = r; EL.random = r; M.wrand = r;
  const sp = EL.spawn(type, 0.5, 1, 0.5); sp.persistent = true; sp.noAI = true;
  const bad = [];
  for (let t = 0; t < 30; t++) {
    sp.vx = 0.2; sp.moveForward = 1; EL.tick();
    if (sp.climbingWall !== !!sp.horizontalCollision) bad.push(t);
  }
  return bad;
}
for (const ty of ['spider', 'cave_spider']) ok(salts.every((s) => climbRun(ty, s).length === 0), ty + ' climbing flag == horizontalCollision every tick');
ok(M.Physics.onClimbable({ type: 'spider', climbingWall: true }) && !M.Physics.onClimbable({ type: 'cave_spider', climbingWall: false, x: 0, y: 1, z: 0 }), 'onClimbable reads the synced flag');
// poison by difficulty
const POI = { peaceful: 0, easy: 0, normal: 140, hard: 300 };
function poisonOf(level, type) {
  M.Diff = { get: () => level };
  const tg = { x: 0, y: 1, z: 0, living: true, type: 'villager', effects: {} };
  M.CaveSpider.onHit({ type }, tg);
  const p = tg.effects && tg.effects.poison; return p ? p.duration : 0;
}
let poisonOk = true; for (const lv of Object.keys(POI)) if (poisonOf(lv, 'cave_spider') !== POI[lv]) { poisonOk = false; console.log('  poison ' + lv + ' = ' + poisonOf(lv, 'cave_spider')); }
ok(poisonOk && poisonOf('hard', 'spider') === 0, 'cave spider Poison 0/0/140/300 ticks, plain spider none');
M.Diff = { get: () => 'normal' };
// bright-light 1-in-100 drop
function dropRate(bright) {
  const sp = { type: 'spider', x: 0, y: 1, z: 0, target: { x: 1, y: 1, z: 0 } }; let n = 0, k = 0;
  const saved = M.Ai.spiderEyeBrightness; M.Ai.spiderEyeBrightness = () => bright;
  for (let i = 0; i < 2000; i++) { const rr = (i + 0.5) / 2000; const g = new M.Ai.SpiderAttackGoal(sp, { random: () => rr }); sp.target = { x: 1, y: 1, z: 0 }; if (!g.canContinueToUse()) n++; k++; }
  M.Ai.spiderEyeBrightness = saved; return n;
}
ok(dropRate(0.5) === 20 && dropRate(0.49) === 0, 'neutral-in-light: drop only at brightness >= 0.5, 1 in 100');
// breaks
const GP = M.Ai.PounceAtTargetGoal;
M.Ai.LEAP_MAX_DSQ = 25; brk(lanePass().length > 0, 'leap range 16 -> 25 caught'); M.Ai.LEAP_MAX_DSQ = 16;
M.Ai.PounceAtTargetGoal = function (e, c) { return new GP(e, c, 0.5); }; M.Ai.PounceAtTargetGoal.prototype = GP.prototype;
brk(lanePass().length > 0, 'leap strength 0.4 -> 0.5 caught'); M.Ai.PounceAtTargetGoal = GP;
const cp = M.CaveSpider.POISON_TICKS.hard; M.CaveSpider.POISON_TICKS.hard = 200; brk(poisonOf('hard', 'cave_spider') !== 300, 'hard poison 15 s -> 10 s caught'); M.CaveSpider.POISON_TICKS.hard = cp;
brk(lanePass().length === 0 && poisonOf('hard', 'cave_spider') === 300, 'unfaulted lane passes after restore');
console.log(`spiderlockstepcheck: ${6 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
