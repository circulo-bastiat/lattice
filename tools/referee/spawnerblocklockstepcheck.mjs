// spawnerblocklockstepcheck.mjs -- #7085 (G17-L222): lockstep scenario 'spawnerblock', 20 salts: a zombie mob_spawner in a lit and an unlit 9x9 cave, a scripted player inside and outside the 16-block range. Per tick: spawnDelay (20 first, then 200+nextInt(600) after a batch that spawned or hit the cap), the placement cell of every try (spawnRange 4), the spawned count (<= 4 a cycle) and positions, the maxNearbyEntities 6 stop, the light rule. Reference = .decomp MobSpawnerLogic.serverTick, written independently below, fed the same world-random draws.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const Y = 100;

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js', '07c_blockentity.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });

// ── the room, in a cell map (one room at a time, spawner at (0, Y, 0)) ──────────────────────────────
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
let room = null;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set;
const inside = (x, y, z) => Math.abs(x) <= 4 && Math.abs(z) <= 4 && y >= Y - 1 && y <= Y + 2;
w.getLight = (x, y, z) => {
  const s = room.s;
  let sky = 0, blk = 0;
  if (!s.sealed && ((inside(x, y, z) || (Math.abs(x) <= 4 && Math.abs(z) <= 4 && y >= Y + 3)) || y > Y + 3)) sky = 15;
  if (s.lamp && inside(x, y, z)) blk = Math.max(0, s.lamp - (Math.abs(x) + Math.abs(y - (Y + 2)) + Math.abs(z)));
  return (sky << 4) | blk;
};
w.canSeeSky = (x, y, z) => ((w.getLight(x, y, z) >> 4) & 15) >= 15;
// SpawnHelper's spawningChunkCount: a full 17x17 of ticking chunks (simulation distance 8, the game's default)
w.chunks = new Map();
for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) w.chunks.set(cx + ',' + cz, { cx, cz });
w.loadedAt = () => true; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(M.World);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.CREATIVE);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.Spawn.init(); M.Spawn.ready = true;
M.BlockEntities.init();
if (M.Sky) { M.Sky.darknessNow = () => 0; M.Sky.isThundering = () => false; }
const { EntityList: EL, Spawn: Sp, States: S } = M;
const P = M.Player;
let seed = 0x5a3e11;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
Math.random = rng; EL.random = rng;
// ── lane ────────────────────────────────────────────────────────────────────────────────────────────
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stone = S.stateOf('stone');
function buildRoom(lit) {
  cells.clear();
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) for (let y = Y - 2; y <= Y + 3; y++) {
    if (Math.abs(x) === 5 || Math.abs(z) === 5 || y === Y - 2 || y === Y + 3) w.set(x, y, z, stone);
  }
  w.set(0, Y, 0, S.stateOf('spawner'));
}
// the reference: MobSpawnerLogic.serverTick (.decomp MobSpawnerLogic.java:69-168) with the spawner's defaults
// (spawnDelay 20 at first, 200..800 re-roll = 200 + nextInt(600), spawnCount 4, spawnRange 4, maxNearby 6, range 16)
// and the room's rules (zombie: dark, no floor test for SPAWNER, space empty).
function lane(salt, opt) {
  const o = Object.assign({ maxNearby: 6, spawnRange: 4 }, opt || {});
  const lit = salt % 2 === 1, T = 1800;
  room = { s: { sealed: true, lamp: lit ? 15 : 0 } };
  buildRoom(lit);
  EL.list.length = 0;
  let s = (salt * 2654435761 + 977) >>> 0;
  const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) / 16777216; };
  let log = [];
  EL.wr = () => { const v = next(); log.push(v); return v; };
  const realCP = Sp.checkPlacement;
  Sp.checkPlacement = function (type, x, y, z, reason, rnd, exact) { const at = log.length; const r = realCP.call(Sp, type, x, y, z, reason, rnd, exact); calls.push({ at, x, y, z, r, end: log.length }); return r; };
  let calls = [];
  P.x = 0.5; P.y = Y + 0.5; P.z = 0.5; P.dead = false; P.health = 20;
  const be = M.BlockEntities.create(0, Y, 0, 'mob_spawner');
  be.entity = 'zombie';
  const outAt = 200 + (salt * 37) % 300, backAt = outAt + 400 + (salt * 53) % 300;
  const FAR = 17 + (salt % 5); // outside the 16-block sphere
  let delay = 20, mobs = [];
  const near = (x, z) => 1; // all room mobs sit inside the box (spawnRange 4 around the cell)
  for (let t = 0; t < T; t++) {
    const out = t >= outAt && t < backAt;
    P.x = out ? FAR + 0.5 : 0.5;
    const d2 = (P.x - 0.5) ** 2 + (P.y - (Y + 0.5)) ** 2 + (P.z - 0.5) ** 2;
    const inRange = d2 < 256;
    log = []; calls = [];
    const before = EL.list.filter((e) => !e.removed && e.type === 'zombie').length;
    Sp.tickSpawner(be);
    const tag = 'salt ' + salt + (lit ? ' lit' : ' dark') + ' tick ' + t + ' ';
    if (!inRange) { if (log.length || be.delay !== delay) return tag + 'out of range but spawner acted (delay ' + be.delay + ' ref ' + delay + ')'; continue; }
    let refSpawned = 0, refEarly = false, refAny = false, p = 0;
    if (delay > 0) { delay--; if (log.length) return tag + 'drew during countdown'; }
    else {
      for (let i = 0; i < 4; i++) {
        const a = log[p++], b = log[p++], r = Math.floor(log[p++] * 3), c = log[p++], d = log[p++];
        const px = 0.5 + (a - b) * o.spawnRange, pz = 0.5 + (c - d) * o.spawnRange, py = Y + r - 1;
        const cp = calls[i - (0)];
        const fx = Math.floor(px), fz = Math.floor(pz), onSpawner = fx === 0 && fz === 0;
        // Monster.checkMonsterSpawnRules = dark + MobEntity.canMobSpawn (reason SPAWNER skips the floor test); then isSpaceEmpty
        const solidBelow = true, roomy = !(py <= Y && px + 0.3 > 0 && px - 0.3 < 1 && pz + 0.3 > 0 && pz - 0.3 < 1);
        // isSpaceEmpty also refuses an overlapping entity: the player (0.6 x 1.8) and the spawner's earlier zombies (0.6 x 1.95)
        const hit = (ox, oy, oz, oh) => Math.abs(ox - px) < 0.6 && oy < py + 1.95 && oy + oh > py && Math.abs(oz - pz) < 0.6;
        const clear = !hit(P.x, P.y, P.z, 1.8) && !mobs.some((m) => hit(m.x, m.y, m.z, 1.95));
        const space = Math.abs(fx) <= 4 && Math.abs(fz) <= 4 && roomy && clear, refValid = space && !lit; // an occupied box is refused before the rule, so before its draws
        const cc = calls[calls.length - 1 - (3 - i)] || null;
        const mine = calls.find((k) => k.at === p - 5 + 0 || k.at === p);
        const call = calls.find((k) => k.at === p);
        if (!call) return tag + 'attempt ' + i + ' did not reach checkPlacement';
        if (call.x !== Math.floor(px) || call.y !== py || call.z !== Math.floor(pz)) return tag + 'attempt ' + i + ' cell ' + [call.x, call.y, call.z] + ' ref ' + [Math.floor(px), py, Math.floor(pz)];
        if (call.r !== refValid) return tag + 'attempt ' + i + ' placement ' + call.r + ' ref ' + refValid + ' at ' + [px, py, pz];
        if (!space && call.end !== call.at) return tag + 'attempt ' + i + ' rule drew in an occupied box';
        p = call.end;
        if (!refValid) continue;
        const nearby = mobs.length;
        if (nearby >= o.maxNearby) { refEarly = true; break; }
        mobs.push({ x: px, y: py, z: pz }); refSpawned++; refAny = true;
      }
      if (refAny || refEarly) { delay = 200 + Math.floor(log[log.length - 1] * 600); }
    }
    const after = EL.list.filter((e) => !e.removed && e.type === 'zombie');
    if (after.length - before !== refSpawned) return tag + 'spawned ' + (after.length - before) + ' ref ' + refSpawned;
    if (refSpawned > 4) return tag + 'more than 4 in a cycle';
    for (let k = 0; k < refSpawned; k++) { const m = mobs[mobs.length - refSpawned + k], e = after[after.length - refSpawned + k]; if (e.x !== m.x || e.y !== m.y || e.z !== m.z) return tag + 'pos ' + [e.x, e.y, e.z] + ' ref ' + [m.x, m.y, m.z]; }
    if (be.delay !== delay) return tag + 'spawnDelay ' + be.delay + ' ref ' + delay;
    if (after.length > 6 + 3) return tag + 'maxNearby exceeded ' + after.length;
  }
  Sp.checkPlacement = realCP;
  return null;
}
const run = (opt) => { const bad = []; for (let sl = 0; sl < 20; sl++) { const r = lane(sl, opt); if (r) bad.push(r); Sp.checkPlacement = Sp.__real || Sp.checkPlacement; } return bad; };
const base = run(); 
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
brk(run({ maxNearby: 7 }).length > 0, 'maxNearbyEntities 6 -> 7 caught');
brk(run({ spawnRange: 5 }).length > 0, 'spawnRange 4 -> 5 caught');
console.log(`spawnerblocklockstepcheck: ${1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
