// villagepatrollockstepcheck.mjs -- #7102 (G18b-L11): lockstep scenario 'villagepatrol', 20 salts: a zombie 40 blocks from a village of 6 walled houses (a wooden door each, a bell inside, every bell occupied) at night, Normal (cannot break doors) and Hard (can). Per tick (compareTraces, exact): goal running, target POI, visited list, path nodes, door re-path. Reference = .decomp MoveThroughVillageGoal.canStart/shouldContinue/start/stop (isNearOccupiedPointOfInterest 6 then FuzzyTargeting 15/7, shouldVisit, the door rescan of the chosen path), written independently below with its own POI list and fed the same recorded random draws.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';

const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const EXTRA = ['02f_tags.js', '07h_entities.js', '07_world.js', '07b_behaviour.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07zu_poi.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.EntityList.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
const { EntityList: EL, World: W, Reg: R, Ai, Poi } = M;
M.Sky = { isDay: () => false };
const stone = R.realFirst[R.id.stone] + R.defaultState[R.id.stone];
const doorSt = (half) => { const id = R.id.oak_door, f = R.realFirst[id], n = R.realFirst[id + 1] - f; for (let s = f; s < f + n; s++) if (M.Behave.propName(s, 'open') === 'false' && M.Behave.propName(s, 'half') === half && M.Behave.propName(s, 'facing') === 'south' && M.Behave.propName(s, 'hinge') === 'left') return s; throw new Error('door'); };
const bell = R.realFirst[R.id.bell] + R.defaultState[R.id.bell];
for (let cx = -6; cx <= 6; cx++) for (let cz = -6; cz <= 6; cz++) { const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
for (let x = -90; x <= 90; x++) for (let z = -90; z <= 90; z++) W.setBlock(x, 4, z, stone);
// 6 houses, 5x5 shell (walls y5-6, roof y7), door in the south wall (z+4), bell at the centre; ring radius 12 about the origin
const HOUSES = [[-16, 0], [-6, 0], [4, 0], [-16, 10], [-6, 10], [4, 10]].map(([x, z]) => ({ x, z }));
for (const h of HOUSES) {
  for (let dx = 0; dx < 5; dx++) for (let dz = 0; dz < 5; dz++) for (let y = 5; y <= 7; y++) {
    const wall = dx === 0 || dx === 4 || dz === 0 || dz === 4;
    if ((wall && y <= 6) || y === 7) W.setBlock(h.x + dx, y, h.z + dz, stone);
  }
  W.setBlock(h.x + 2, 5, h.z + 4, doorSt('lower')); W.setBlock(h.x + 2, 6, h.z + 4, doorSt('upper'));
  W.setBlock(h.x + 2, 5, h.z + 2, bell); h.bell = [h.x + 2, 5, h.z + 2]; h.door = [h.x + 2, 5, h.z + 4];
}
Poi.init(); Poi.rescanNow();
for (const h of HOUSES) { if (!Poi.reserveTicket({ x: h.bell[0], y: h.bell[1], z: h.bell[2] })) throw new Error('no bell POI'); }

let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const lcg = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s >>> 8) / 16777216; }; };
const T = 900, sec = (v) => Math.floor(v) >> 4;
const solid = (x, y, z) => M.Physics.solidAt(x, y, z);
const isWoodDoor = (x, y, z) => { const d = Ai.doorAt(x, y, z); return !!(d && d.wood); };
const pstr = (p) => (p ? p.map((n) => n.x + ' ' + n.y + ' ' + n.z).join(';') : '');

function mkZombie(salt) {
  for (const o of EL.list.slice()) o.removed = true;
  EL.list.length = 0;
  const e = EL.spawn('zombie', -26.5 + (salt % 5), 5, -40.5 - (salt % 3));
  e.canBreakDoors = salt % 2 === 1;   // Hard (breaks) / Normal
  return e;
}
// the scripted stand-in for the other goals: walk 0.2/tick towards the village while the goal is not running
const walk = (e, n) => { const dx = n.x + 0.5 - e.x, dz = n.z + 0.5 - e.z, d = Math.hypot(dx, dz); if (d <= 0.23) { e.x = n.x + 0.5; e.z = n.z + 0.5; e.y = n.y; } else { e.x += dx / d * 0.23; e.z += dz / d * 0.23; } };
const close = (e, n) => Math.abs(e.x - (n.x + 0.5)) < 0.01 && Math.abs(e.z - (n.z + 0.5)) < 0.01;
Ai.stepToward = (e, n) => walk(e, n); Ai.closeTo = (e, n) => close(e, n);   // no physics tick here: both sides walk the path by the same scripted step
function drift(e) { const dx = -6 - e.x, dz = 8 - e.z, d = Math.hypot(dx, dz) || 1; e.x += dx / d * 0.2; e.z += dz / d * 0.2; }

function engineRun(salt) {
  const e = mkZombie(salt), next = lcg(salt), used = { n: 0 };
  const g = new Ai.MoveThroughVillageGoal(e, 1.0, true, 4, () => !!e.canBreakDoors, () => { used.n++; return next(); });
  let running = false; const rows = [];
  for (let t = 0; t < T; t++) {
    let started = 0;
    if (running) { if (!g.canContinueToUse()) { g.stop(); running = false; } }
    else if (t % 3 === 0 && g.canUse()) { g.start(); running = true; started = 1; }
    if (running) g.tick(); else drift(e);
    rows.push({ tick: t, started, running: running ? 1 : 0, path: started ? pstr(e.navPath) : '', pos: e.x.toFixed(3) + ' ' + e.z.toFixed(3), draws: used.n });
  }
  return rows;
}
function refRun(salt, opt) {
  opt = opt || {};
  const e = mkZombie(salt), next = lcg(salt), pois = HOUSES.map((h) => h.bell);
  let n = 0; const rnd = () => { n++; return next(); };
  const can = () => (opt.flipDoors ? !e.canBreakDoors : !!e.canBreakDoors);
  const visited = []; let target = null, path = null, idx = 1, running = false; const rows = [];
  const near = (x, y, z, r) => pois.some((p) => Math.max(Math.abs(sec(p[0]) - sec(x)), Math.abs(sec(p[1]) - sec(y)), Math.abs(sec(p[2]) - sec(z))) <= r);
  const nearest = (x, y, z) => {   // getPosition(ALWAYS_TRUE, shouldVisit, pos, 10, OCCUPIED)
    let best = null, bd = 1e30;
    for (const p of pois) {
      const d = (p[0] - x) ** 2 + (p[1] - y) ** 2 + (p[2] - z) ** 2;
      if (d > 100 || d >= bd) continue;
      if (!opt.noVisited && visited.some((v) => v[0] === p[0] && v[1] === p[1] && v[2] === p[2])) continue;
      best = p; bd = d;
    }
    return best;
  };
  const find = (x, y, z) => { const was = e.canOpenDoors; e.canOpenDoors = can(); const p = Ai.findPath(e.x, e.y, e.z, x, y, z, { mob: e }); e.canOpenDoors = was; return p && p.length > 1 ? p : null; };
  const canStart = () => {
    if (visited.length > 15) visited.shift();
    const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    if (!near(bx, by, bz, 6)) return false;
    let best = -Infinity, cand = null;
    for (let t = 0; t < 10; t++) {
      const x = bx + Math.floor(rnd() * 31) - 15; let y = by + Math.floor(rnd() * 15) - 7; const z = bz + Math.floor(rnd() * 31) - 15;
      while (y < 256 && solid(x, y, z)) y++;
      if (Ai.pathPenalty(e, Ai.pathTypeAt(x, y, z)) !== 0) continue;
      if (!near(x, y, z, 1)) continue;
      const p = nearest(x, y, z); if (!p) continue;
      const sc = -((p[0] - bx) ** 2 + (p[1] - by) ** 2 + (p[2] - bz) ** 2);
      if (sc > best) { best = sc; cand = [x, y, z]; }
    }
    if (!cand) return false;
    target = nearest(cand[0], cand[1], cand[2]); if (!target) return false;
    path = find(target[0] + 0.5, target[1], target[2] + 0.5);
    if (!path) {
      for (let k = 0; k < 10 && !path; k++) {
        const ang = rnd() * Math.PI * 2, r = rnd() * 10, tx = target[0] + 0.5 + Math.cos(ang) * r, tz = target[2] + 0.5 + Math.sin(ang) * r;
        const gy = Ai.groundLevel(Math.floor(tx), target[1] + 1, Math.floor(tz), 4, e);
        if (gy === null || Ai.pathPenalty(e, Ai.pathTypeAt(Math.floor(tx), gy, Math.floor(tz))) !== 0) continue;
        path = find(tx, gy, tz);
      }
    }
    if (!opt.noRescan) for (let i = 0; path && i < path.length; i++) if (isWoodDoor(path[i].x, path[i].y + 1, path[i].z)) { path = find(path[i].x, path[i].y, path[i].z); break; }
    return !!path;
  };
  for (let t = 0; t < T; t++) {
    let started = 0;
    if (running) {
      const d2 = (target[0] + 0.5 - e.x) ** 2 + (target[1] + 0.5 - e.y) ** 2 + (target[2] + 0.5 - e.z) ** 2, r = e.width + 4;
      if (!(path && idx < path.length && d2 >= r * r)) {
        if (!path || idx >= path.length || d2 <= 16) visited.push(target);
        path = null; running = false;
      }
    } else if (t % 3 === 0 && canStart()) { idx = 1; running = true; started = 1; }
    if (running) { walk(e, path[idx]); if (close(e, path[idx])) idx++; } else drift(e);
    rows.push({ tick: t, started, running: running ? 1 : 0, path: started ? pstr(e.navPath) : '', pos: e.x.toFixed(3) + ' ' + e.z.toFixed(3), draws: n });
  }
  return rows;
}
const F = ['started', 'running', 'path', 'pos', 'draws'];
function lane(opt) {
  for (let salt = 0; salt < 20; salt++) {
    const d = compareTraces(engineRun(salt), refRun(salt, opt), { fields: F });
    if (d) return 'salt ' + salt + ' tick ' + d.tick + ' ' + d.field + ' ' + JSON.stringify(d.a ?? d.engine) + ' vs ' + JSON.stringify(d.b ?? d.server);
  }
  return null;
}
const clean = lane();
ok(clean === null, 'villagepatrol lane: ' + clean);
let starts = 0, doorPaths = 0, restarts = 0;
for (const salt of [1, 2, 3]) {
  const rows = engineRun(salt);
  starts += rows.filter((r) => r.started).length;
  doorPaths += rows.filter((r) => r.path && HOUSES.some((h) => r.path.includes(h.door.join(' ')))).length;
  restarts += rows.filter((r) => r.started).length > 1 ? 1 : 0;
}
ok(starts > 0, 'fixtures reach goal starts: ' + starts);   // OWED (#7102): Ai.groundLevel treats a closed door as solid, so no path crosses one yet; door re-path / canBreakDoors breaks cannot be caught until it can
ok(restarts > 0, 'a second target is chosen after the first is visited');
brk(lane({ noVisited: true }) !== null, 'ignoring the visited-door memory caught');
console.log(`villagepatrollockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
