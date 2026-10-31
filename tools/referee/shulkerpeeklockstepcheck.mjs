// shulkerpeeklockstepcheck.mjs -- #7089 (G17-L226): lockstep scenario 'shulkerpeek', 20 salts: a shulker on a stone floor, a scripted player in and out of range. Per tick (compareTraces, exact): peek byte, the +20 armor modifier (only a setPeek(0) adds it), open/close sounds. Then hurt rounds: closed + arrow swallowed, open + hit under half health -> 1-in-4 tryTeleport (5 tries, +-8), a shulker-bullet hit -> spawnNewShulker (open, tryTeleport ok, nearby alive shulkers in box.expand(8), nextFloat < (n-1)/5 blocks it). Reference = .decomp ShulkerEntity.PeekGoal / damage / spawnNewShulker / tryTeleport, written independently below and fed the same recorded random draws.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07q_effects.js',
  '14j_combat.js', '07zzk_shulker.js', '07zw_mobnbt.js', '07zx_particle.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init(); M.Combat.init(); M.Shulker.init();
const { EntityList: EL, Shulker: Sh, World: W, Reg: R, Combat: Cb } = M;
const stone = R.realFirst[R.id.stone] + R.defaultState[R.id.stone];
for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
for (let x = -60; x <= 60; x++) for (let z = -60; z <= 60; z++) W.setBlock(x, 4, z, stone);

let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const lcg = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) / 16777216; }; };
const T = 1500;

// ── part 1: PeekGoal + armor + sounds, engine ──────────────────────────────────────────────────────
const inRange = (t, salt) => { const a = 300 + (salt * 29) % 200, b = a + 250 + (salt * 41) % 150; return t >= a && t < b; };
function enginePeek(salt, bonus) {
  const prevBonus = Sh.COVERED_ARMOR_BONUS; if (bonus) Sh.COVERED_ARMOR_BONUS = bonus;
  const next = lcg(salt), log = [], rand = () => { const v = next(); log.push(v); return v; };
  const sounds = []; M.Sound = { play: (n) => sounds.push(n) };
  const e = { x: 0.5, y: 5, z: 0.5, type: 'shulker', shulkerFace: 0, target: null, shulkerPeek: 0, health: 30, maxHealth: 30 };
  const g = new Sh.PeekGoal(e, { random: rand });
  let running = false; const rows = [];
  for (let t = 0; t < T; t++) {
    e.target = inRange(t, salt) ? { type: 'player' } : null;
    sounds.length = 0;
    if (running) { if (g.canContinueToUse()) g.tick(); else { g.stop(); running = false; } }
    else if (g.canUse()) { g.start(); running = true; }
    rows.push({ tick: t, peek: e.shulkerPeek, armor: Sh.armorOf(e), sounds: sounds.join(',') });
  }
  Sh.COVERED_ARMOR_BONUS = prevBonus; M.Sound = undefined;
  return { rows, used: log.length };
}
// reference: PeekGoal.canStart/shouldContinue/start/tick/stop (.decomp ShulkerEntity.PeekGoal) and setPeekAmount's modifier rule
function refPeek(salt, bonus) {
  const next = lcg(salt); let peek = 0, mod = false, counter = 0, running = false, used = 0; const rows = [];
  const rnd = () => { used++; return next(); };
  const set = (a, sounds) => { peek = a; mod = a === 0; sounds.push(a === 0 ? 'entity.shulker.close' : 'entity.shulker.open'); };
  for (let t = 0; t < T; t++) {
    const target = inRange(t, salt), sounds = [];
    if (running) { if (!target && counter > 0) counter--; else { if (!target) set(0, sounds); running = false; } }
    else if (!target && Math.floor(rnd() * 40) === 0) { counter = 20 * (1 + Math.floor(rnd() * 3)); set(30, sounds); running = true; }
    rows.push({ tick: t, peek, armor: mod ? bonus : 0, sounds: sounds.join(',') });
  }
  return { rows, used };
}
// ── part 2: hurt rounds ─────────────────────────────────────────────────────────────────────────────
const nb = (r, lo, hi) => lo + Math.floor(r * (hi - lo + 1));
function engineHurt(salt, round) {
  for (const o of EL.list.slice()) if (o.type === 'shulker') EL.remove ? EL.remove(o) : (o.removed = true);
  EL.list.length = 0;
  const base = lcg(salt * 7 + round), cx = 0.5 + 12 * (round % 3), z0 = 0.5;
  const mk = (x, z, peek) => { const e = EL.spawn('shulker', x, 5, z); e.shulkerFace = 0; e.shulkerPeek = peek; e.target = null; e.invulnerableTicks = 0; e.hurtTime = 0; return e; };
  const open = round % 4 !== 0, bullet = round % 3 !== 0;
  const s = mk(cx, z0, open ? 30 : 0);
  const extras = Math.floor(base() * 7), ex = [];
  for (let i = 0; i < extras; i++) { const x = cx + Math.floor(base() * 15) - 7 + (i % 2 ? 6 : 0), z = z0 + Math.floor(base() * 15) - 7; if (x === cx && z === z0) continue; ex.push({ x, z, o: mk(x, z, 0) }); }
  s.health = round % 3 === 0 ? 10 : 30;   // under half (15) or not
  const hp0 = s.health;
  const next = lcg(salt * 131 + round), log = [];
  EL.random = () => { const v = next(); log.push(v); return v; };
  const ox = s.x, oz = s.z;
  const src = bullet ? { source: 'projectile', projectile: true, sourceEntity: { type: 'shulker_bullet' } } : { source: 'projectile', persistent: true, projectile: true, sourceEntity: { type: 'arrow' } };
  const arrowOnly = !bullet;
  let cut = -1; const realSpawn = EL.spawn; EL.spawn = function (...a) { if (cut < 0) cut = log.length; return realSpawn.apply(this, a); };   // the engine's own spawn init draws from the same stream; vanilla's create() uses the new mob's random
  const hit = Cb.hurt(s, 1, undefined, false, src);
  EL.spawn = realSpawn;
  EL.random = undefined;
  const spawned = EL.list.filter((o) => o.type === 'shulker' && o !== s && !ex.some((q) => q.o === o));
  return { snap: { hit, hp: s.health, x: s.x, z: s.z, peek: s.shulkerPeek, spawned: spawned.map((o) => [o.x, o.z]).sort().join(';'), used: cut < 0 ? log.length : cut }, ctx: { cx, z0, open, bullet, hp0, ex: ex.map((q) => [q.x, q.z]), ox, oz, log: log.slice(), arrowOnly } };
}
function refHurt(salt, round, c, div) {
  const log = c.log; let p = 0; const rnd = () => log[p++];
  let hit, hp = c.hp0, x = c.cx, z = c.z0, peek = c.open ? 30 : 0; const spawned = [];
  if (peek === 0 && c.arrowOnly) hit = false;     // isClosed + PersistentProjectileEntity source
  else {
    hit = true; hp -= 1;                              // armor 0 (modifier not applied in this fixture), damage 1
    if (hp < 30 * 0.5 && Math.floor(rnd() * 4) === 0) tele();
    else if (c.bullet) {
      const wasOpen = peek > 0;
      if (wasOpen && tele()) {
        let n = 1; for (const [ex, ez] of c.ex) if (Math.abs(ex - x) < 9 && Math.abs(ez - z) < 9 || (Math.abs(ex - x) < 9 && Math.abs(ez - z) < 9)) n++;
        // box is the OLD one expanded by 8: count shulkers whose box meets [old-8.. old+8]
        n = 1 + c.ex.filter(([ex, ez]) => Math.abs(ex - c.ox) < 9 && Math.abs(ez - c.oz) < 9).length;
        if (!(rnd() < (n - 1) / div)) spawned.push([c.ox, c.oz]);
      }
    }
  }
  function tele() {
    for (let i = 0; i < 5; i++) {
      const dx = nb(rnd(), -8, 8), dy = nb(rnd(), -8, 8), dz = nb(rnd(), -8, 8);
          const tx = Math.floor(c.cx) + dx, ty = 5 + dy, tz = Math.floor(c.z0) + dz;
      const occupied = c.ex.some(([ex, ez]) => Math.floor(ex) === tx && Math.floor(ez) === tz) && ty === 5;
      if (ty > -64 && (ty === 3 || ty === 5) && !occupied) { x = tx + 0.5; z = tz + 0.5; peek = 0; return true; }
    }
    return false;
  }
  return { hit, hp, x, z, peek, spawned: spawned.sort().join(';'), used: p };
}
function hurtRows(div) {
  const a = [], b = [];
  for (let salt = 0; salt < 20; salt++) for (let round = 0; round < 12; round++) {
    const { snap, ctx } = engineHurt(salt, round), r = refHurt(salt, round, ctx, div);
    a.push({ tick: a.length, ...snap }); b.push({ tick: b.length, hit: r.hit, hp: r.hp, x: r.x, z: r.z, peek: r.peek, spawned: r.spawned, used: r.used });
  }
  return [a, b];
}
const F1 = ['peek', 'armor', 'sounds'], F2 = ['hit', 'hp', 'x', 'z', 'peek', 'spawned', 'used'];
function peekRun(bonusEng, bonusRef) {
  for (let salt = 0; salt < 20; salt++) {
    const e = enginePeek(salt, bonusEng), r = refPeek(salt, bonusRef);
    if (e.used !== r.used) return 'salt ' + salt + ' draws ' + e.used + ' ref ' + r.used;
    const d = compareTraces(e.rows, r.rows, { fields: F1 });
    if (d) return 'salt ' + salt + ' tick ' + d.tick + ' ' + d.field;
  }
  return null;
}
const hr = hurtRows(5), hd = compareTraces(hr[0], hr[1], { fields: F2 });
const pr = peekRun(0, 20);
ok(pr === null, 'peek lane: ' + pr);
ok(hd === null, 'hurt lane: ' + (hd && (hd.tick + ' ' + hd.field + ' ' + JSON.stringify(hd.a ?? hd.engine) + ' vs ' + JSON.stringify(hd.b ?? hd.server))));
const fx = [hr[0].filter((r) => r.spawned).length, hr[0].filter((r) => (r.x - 0.5) % 12 !== 0 && r.hp < 15).length, hr[0].filter((r) => r.hit === false).length];
ok(fx.every((n) => n > 0), 'fixtures reach duplicate, teleport and swallowed arrow: ' + fx);
ok(enginePeek(0).rows.some((r) => r.peek === 30) && enginePeek(0).rows.some((r) => r.armor === 20), 'peek opens and armor applies');
brk(peekRun(10, 20) !== null, 'armor bonus 20 -> 10 caught');
const h6 = hurtRows(6);
brk(compareTraces(h6[0], h6[1], { fields: F2 }) !== null, 'nearby-count cap 5 -> 6 caught');
console.log(`shulkerpeeklockstepcheck: ${4 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
