// lockstep/zombielane.mjs -- #6953 (G17-L4a): the ENGINE side of chasescen's zombie lane, one engineRow per tick, to be handed to
// compareTraces against the real-server rep0 log (run.mjs runLane). Same lane as chaserefcheck.mjs (stone corridor, a still survival
// player DIST blocks along, zombie summoned at START, AI on). Row t = the state after t world ticks (row 0 = the summon tick),
// so it lines up with runchase's log[t]. Fields (yaw/pitch are the engine's radians; target 'player' for the survival player): pos, yaw, pitch, target, attackTicks (MeleeAttackGoal cooldown), health.
//   engineZombieTrace(salt, opts) -> engineRow[] (T rows); opts.mob overrides 'zombie' (any chasescen LIVE mob)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../../loadsrc.mjs';
import { T, startX, playerX } from '../chasescen.mjs';
import { engineRow } from './trace.mjs';
import { serverEntitySeed } from './serverseed.mjs';

const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js', '14l_use.js'];
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const PAD = 0;
let H = null;
export function harness() {
  if (H) return H;
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
  if (M.Goat && M.Goat.init) M.Goat.init();
  if (M.Fish && M.Fish.init) M.Fish.init();   // #5326: Fish.ready gates Fish.tick (EL.tickMob)
  if (M.Bat && M.Bat.init) M.Bat.init();   // #5315: the bat lane needs Bat.mobTick/postTick (17_main.js:302 does this in the game)
  if (M.Squid && M.Squid.init) M.Squid.init();   // #5321: Sq.tick is gated on Squid.ready
  M.Player.init();
  M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
  if (M.Diff && M.Diff.set) M.Diff.set('normal');
  H = { M, w, cells };
  H.playerInit = Object.assign({}, M.Player);   // shallow snapshot: a run's hits/effects must not leak into the next salt
  return H;
}
// #6267: obstacle lane -- open 11-wide floor; a 3-wide 1-high wall (x 15, z -1..1), a 1-block ledge (x >= 18 floor one higher), a fence line
// (x 18, standing on the ledge, z -5..5, gap at z 3). The survival player stands behind all three (x 23.5, y 1).
export const OBST = { wallX: 14, ledgeX: 16, fenceX: 18, gapZ: 3, playerY: 1 };
function buildObstacle({ w, cells, M }) {
  cells.clear();
  const stone = M.States.stateOf('stone'), fence = M.States.stateOf('oak_fence');
  for (let x = -4; x <= 26; x++) {
    for (let z = -5; z <= 5; z++) { w.set(x, PAD - 1, z, stone); if (x >= OBST.ledgeX) w.set(x, PAD, z, stone); }
    for (let y = PAD; y <= PAD + 2; y++) { w.set(x, y, -6, stone); w.set(x, y, 6, stone); }
  }
  for (let z = -5; z <= 5; z++) for (let y = PAD; y <= PAD + 2; y++) { w.set(-4, y, z, stone); w.set(26, y, z, stone); }
  for (let z = -1; z <= 1; z++) w.set(OBST.wallX, PAD, z, stone);   // 1 high: the target goal needs line of sight
  for (let z = -5; z <= 5; z++) if (z !== OBST.gapZ) w.set(OBST.fenceX, PAD + 1, z, fence);   // on the ledge: top 1.5 above its floor (feetY +0.5), so a 1.125 step refuses it
}
export function buildLane({ w, cells, M }, pool) {
  cells.clear();
  const stone = M.States.stateOf('stone');
  for (let x = -4; x <= 26; x++) {
    for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, stone);
    for (let y = PAD; y <= PAD + 1; y++) { w.set(x, y, -2, stone); w.set(x, y, 2, stone); }
  }
  for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 1; y++) { w.set(-4, y, z, stone); w.set(26, y, z, stone); }
  if (pool === 'lava') { const lava = M.States.stateOf('lava'); for (let x = -3; x <= 25; x++) for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 1; y++) w.set(x, y, z, lava); }   // #10363
  else if (pool) { const water = M.States.stateOf('water'); for (let x = -3; x <= 25; x++) for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 1; y++) w.set(x, y, z, water); }   // #5375
}
// #7027: pathtypes lane -- the plain lane with one hazard in the zombie's straight line (x FEAT_X, z 0). Body blocks stand at PAD, floor swaps at PAD-1.
export const FEAT_X = 15;
export const FEATURES = ['fence', 'wall', 'cactus', 'campfire', 'lava', 'water', 'cobweb', 'sweet_berry_bush', 'powder_snow', 'magma', 'door_open', 'door_closed', 'iron_door', 'trapdoor'];
export const STUCK_FEATURES = ['gap', 'fence_corner', 'trapdoor'];   // #7936: pathstuck lane obstacles
function buildFeature({ w, M }, f) {
  const S = M.States, B = M.Behave, st = (n, props) => { let s = S.stateOf(n); for (const k of Object.keys(props || {})) s = B.setProp(s, k, props[k]); return s; };
  const x = FEAT_X, put = (y, s) => w.set(x, y, 0, s);
  const door = (n, open) => { put(PAD, st(n, { half: 'lower', open })); put(PAD + 1, st(n, { half: 'upper', open })); };
  switch (f) {
    case 'fence': put(PAD, st('oak_fence')); break;
    case 'wall': put(PAD, st('cobblestone_wall')); break;
    case 'cactus': put(PAD, st('cactus')); break;
    case 'campfire': put(PAD, st('campfire')); break;
    case 'lava': put(PAD - 1, st('lava')); break;
    case 'water': put(PAD - 1, st('water')); break;
    case 'cobweb': put(PAD, st('cobweb')); break;
    case 'sweet_berry_bush': put(PAD, st('sweet_berry_bush')); break;
    case 'powder_snow': put(PAD, st('powder_snow')); break;
    case 'magma': put(PAD - 1, st('magma_block')); break;
    case 'door_open': door('oak_door', true); break;
    case 'door_closed': door('oak_door', false); break;
    case 'iron_door': door('iron_door', false); break;
    case 'trapdoor': put(PAD, st('oak_trapdoor')); break;
    case 'gap': for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, 0); break;   // #7936: one-block hole across the whole lane floor
    case 'fence_corner': put(PAD, st('oak_fence')); w.set(x, PAD, -1, st('oak_fence')); w.set(x - 1, PAD, -1, st('oak_fence')); break;
    default: throw new Error('feature ' + f);
  }
}
// #7009: SeedAgent.next() in JS. The server's Random() seed is splitmix64(((src+key).hashCode() << 32) ^ n ^ SALT); n = nth Random built for that key.
const jhash = (s) => { let h = 0; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; };
export function agentSeed(salt, key, n) {
  let x = BigInt.asUintN(64, (BigInt(jhash('Random' + key)) << 32n) ^ BigInt(n) ^ BigInt(salt));
  x = BigInt.asUintN(64, (x ^ (x >> 30n)) * 0xbf58476d1ce4e5b9n); x = BigInt.asUintN(64, (x ^ (x >> 27n)) * 0x94d049bb133111ebn);
  return BigInt.asIntN(64, x ^ (x >> 31n));
}
export const ZOMBIE_KEY = 'ent|bmw';   // bmw = ZombieEntity (names.tsv); the 1st Random it builds is Entity.random
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

export function attackTicksOf(Ai, e) {
  const gs = e && e.ai;
  for (const en of (gs && gs.entries) || []) if (en.goal && typeof en.goal.getCooldown === 'function' && en.running) return en.goal.getCooldown();
  return 0;
}
let ran = false;
export function engineZombieTrace(salt, opts = {}) {
  const h = harness(), { M } = h, EL = M.EntityList, P = M.Player, mob = opts.mob || 'zombie';
  if (ran) { P.init(); if (M.Diff && M.Diff.set) M.Diff.set('normal'); }   // a second run starts from a fresh player (hurt/regen timers leaked: tick-120 pos differed)
  ran = true;
  if (mob === 'snow_golem') M.World.biomeAt = () => M.Biomes.index('plains');   // #5338: the stub world's biome 0 is hot (temp 2 > 1.0: SnowGolemEntity.tickMovement burns it dead); the server lane is a temperate plains
  const r = stream(salt);
  EL.random = r; Math.random = r;
  if (M.VB) M.VB.rand = r;   // #5332: villager brain draws VB.rand (default fbRand, a process-long stream): per-salt, not leaked between runs
  if (M.wrandReset) M.wrandReset();
  if (opts.obstacle) buildObstacle(h); else { buildLane(h, opts.lava ? 'lava' : !!opts.pool); if (opts.feature) buildFeature(h, opts.feature); if (opts.build) opts.build(h); } EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0; if (M.Particle && M.Particle.list) M.Particle.list.length = 0;   // #5375: GuardianMoveControl sways by age + entity id;   // #6978: the per-entity JRandom seed folds in the process-wide spawn counter
  if (M.Particle && M.Particle.clear) M.Particle.clear();   // pooled particles cap later spawns (and their rng draws)
  for (const k of Object.keys(P)) if (!(k in h.playerInit) && typeof P[k] !== 'function') delete P[k];
  for (const k of Object.keys(h.playerInit)) if (typeof h.playerInit[k] !== 'function') P[k] = (h.playerInit[k] && typeof h.playerInit[k] === 'object' && !Array.isArray(h.playerInit[k]) && Object.getPrototypeOf(h.playerInit[k]) === Object.prototype) ? Object.assign({}, h.playerInit[k]) : h.playerInit[k];
  M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  const still = () => { P.x = (opts.dist != null ? startX() + opts.dist : playerX()) + (opts.obstacle ? 1 : 0); P.y = opts.obstacle ? OBST.playerY : opts.playerY != null ? opts.playerY : PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.health = P.maxHealth || 20; };
  still(); P.invulnerable = 0; P.lastHurt = 0; P.exhaustion = 0;   // #6978: the shared player carried the last run's hurt state into the next
  let jr = null; EL.entitySeed = null;
  if (opts.serverSeed) {   // #6964: the entity's own java.util.Random, seeded as SeedAgent seeds the server's nth summoned <class>; every draw (spawn rolls, goals, mobTick) comes from it
    jr = new M.JRandom(serverEntitySeed(salt, opts.serverSeed, opts.serverSeedN || 1)); if (opts.uuidSteps) { jr.nextLong(); jr.nextLong(); }   // Entity.<init>: UUID.randomUUID-style two nextLong before any spawn roll
    if (process.env.WITHER_STEPS) { const on = jr.next.bind(jr); jr.steps = 0; jr.next = (b) => { jr.steps++; return on(b); }; }   // #10618 debug: raw draws per tick
    EL.entitySeed = () => jr; EL.random = () => jr.nextDouble(); EL.random.nextGaussian = () => jr.nextGaussian(); EL.random.nextInt = (n) => jr.nextInt(n); EL.random.nextFloat = () => jr.nextFloat();   // (arrow: this is jr, not the wrapper)
  }
  const e = EL.spawn(mob, startX(), PAD + (opts.up || 0), 0.5);
  if (!e) throw new Error('EL.spawn gives nothing');
  if (opts.uuidSteps && jr.haveG) jr.nextGaussian();   // the server's init draws a second gaussian (served by the cached spare, 0 steps): a blaze's first eyeOffset reroll is then a FRESH pair at raw step 9 (4 uuid + 4 followBonus + 1 float)
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  if (mob === 'shulker_bullet') { e.vx = e.vy = e.vz = 0; M.Shulker.initBullet(e, { target: P }); }   // #7537: the homing bullet needs a target (ShulkerBulletEntity.target), else it only waits
  if (opts.noAI) e.aiDisabled = true;   // #7062: summon NBT NoAI:1b (Mob.readAdditionalSaveData -> setNoAi)
  if (opts.obstacle || opts.feature || (opts.aggro && !opts.aggroLate)) e.target = P;   // the head-high fence blocks the acquire line of sight; vanilla's server run is aggroed the same way by the pilot (#6267)
  // #7009: the plain zombie lane draws from the mob's own java.util.Random, seeded as the server's SeedAgent seeds it (no LCG override)
  if (mob === 'zombie' && opts.javaSeed !== false && !opts.obstacle && !opts.feature && !opts.build && !opts.onStart && !opts.aggro && !opts.pool && !opts.noAI) {
    EL.random = null; e.random = new M.JRandom(agentSeed(salt, opts.seedKey || ZOMBIE_KEY, 1));
  } else if (mob === 'zombie' && opts.javaSeed === false) { e.random = null; }   // the old LCG override: drop the entity's own JRandom (G17-L7 gives every entity one)
  if (opts.onStart) opts.onStart(EL);   // #9249: before the first tick (an effect the server gave at the summon)
  const rows = [], seen = new Set();
  for (let t = 0; t < (opts.T || T); t++) {
    const shots = mob === 'pillager' ? EL.list.filter((x) => x !== e && x.type === 'arrow' && !seen.has(x)) : [];
    shots.forEach((x) => seen.add(x));
    rows.push(Object.assign(engineRow(t, e, opts.obstacle ? { goals: null } : {}), mob === 'pillager' ? { shot: shots.length ? [shots[0].vx, shots[0].vy, shots[0].vz] : null } : null, { pitch: e.pitch || 0, target: e.target ? (e.target === P ? 'player' : String(e.target.id)) : null, attackTicks: attackTicksOf(M.Ai, e) }, opts.extra ? opts.extra(EL, e, t) : null));
    still();
    EL.tick();
    if (jr && jr.steps != null) { console.log('STEPS', t + 1, jr.steps - (jr.lastSteps || 0)); jr.lastSteps = jr.steps; }
    if (opts.onTick) opts.onTick(t + 1, EL, P);
  }
  return rows;
}
export const harnessM = () => harness().M;
