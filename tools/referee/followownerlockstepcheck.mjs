// lockstep-followowner -- #7912 (G18b-L20): FollowOwnerGoal for tamed wolf (10/2), cat (10/5), parrot (5/1, leaves allowed), 20 salts.
// Reference = .decomp FollowOwnerGoal (canStart: owner, not sitting, dist^2 >= min^2; shouldContinue: path not idle, not sitting, dist^2 > max^2;
// start: countdown 0, save+zero WATER malus; stop: restore; tick: every 10 ticks, if !leashed && !vehicle: dist^2 >= 144 -> tryTeleport (10 tries of nextInt(7)-3,
// nextInt(3)-1, nextInt(7)-3 around the owner block, |x-owner.x|<2&&|z-owner.z|<2 refused, landing must be WALKABLE, no leaves below unless allowed) else repath).
// Compared per tick: running, repath tick, teleport landing, WATER malus, pos.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '07b_behaviour.js', '07_world.js', '07l_spawn.js', '07k_goals.js', '07t_fly.js'], dom: false, initReg: true });
const { Ai } = M, Fl = M.Fly || M.Fl, T = Ai.NodeType;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// terrain: deterministic per cell type for the landing search
const terrain = (salt) => (x, y, z) => { const h = ((x * 73856093) ^ (y * 19349663) ^ (z * 83492791) ^ salt) >>> 0; const m = h % 7; return m < 3 ? T.WALKABLE : m === 3 ? T.LEAVES : m === 4 ? T.WATER : m === 5 ? T.BLOCKED : T.DAMAGE_FIRE; };
const MOBS = { wolf: [10, 2, false], cat: [10, 5, false], parrot: [5, 1, true] };
const GOAL_RAND = (rnd) => rnd;
function lane(c) {
  const [start, stop, leaves] = MOBS[c.mob], tf = terrain(c.salt), rnd = stream(c.salt), orand = stream(c.salt + 1000);
  Ai.pathTypeAt = (x, y, z) => tf(x, y, z);
  const calls = [];
  Ai.findPath = (...a) => { calls.push('path'); return [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]; };
  Ai.stepToward = (e) => { calls.push('step'); e.x += 0.2; };
  Ai.closeTo = () => false;
  const mk = () => ({ type: c.mob, tamed: true, owner: 'player', sitting: false, x: 0.5, y: 5, z: 0.5, leashed: !!c.leash, pathMalus: undefined, flyMove: { setWantedPosition() { calls.push('fly'); } } });
  const e = mk(), ref = mk(), owner = { x: 0.5 + c.d0, y: 5, z: 0.5, eyeHeight: 1 };
  const refOwner = { x: owner.x, y: 5, z: 0.5 };
  const G = c.mob === 'parrot' ? Fl.FollowOwnerGoal : Ai.FollowOwnerGoal;
  const g = new G(e, 1.0, start, stop, () => [owner], GOAL_RAND(stream(c.salt)), leaves);
  const eng = [], rf = [];
  let running = false, rRun = false, cd = 0, oldW = 0, rr = stream(c.salt);
  const malus = (x) => Ai.pathPenalty(x, T.WATER);
  for (let t = 0; t < 160; t++) {
    const sprint = c.sprint ? 0.5 : 0.15;
    owner.x += sprint; refOwner.x += sprint;
    if (t % 40 === 20) { owner.y -= 1; refOwner.y -= 1; owner.y += 1; refOwner.y += 1; }
    if (t === 60) e.sitting = ref.sitting = !!c.sit;
    if (t === 90) e.sitting = ref.sitting = false;
    calls.length = 0;
    if (!running) { if (g.canUse()) { g.start(); running = true; } }
    else if (!g.canContinueToUse()) { g.stop(); running = false; }
    if (running) g.tick();
    eng.push(running + '|' + calls.join(',') + '|' + e.x.toFixed(2) + ',' + e.y + ',' + e.z.toFixed(2) + '|' + malus(e));
    // reference
    const dsq = () => (refOwner.x - ref.x) ** 2 + (refOwner.y - ref.y) ** 2 + (refOwner.z - ref.z) ** 2;
    const rcalls = [];
    if (!rRun) { if (!ref.sitting && dsq() >= start * start) { rRun = true; cd = 0; oldW = malus(ref); ref.pathMalus = { [T.WATER]: 0 }; } }
    else if (ref.sitting || !(dsq() > stop * stop)) { rRun = false; ref.pathMalus = { [T.WATER]: oldW }; }
    if (rRun && --cd <= 0) {
      cd = 10;
      if (!ref.leashed) {
        if (dsq() >= 144) {
          const bx = Math.floor(refOwner.x), by = Math.floor(refOwner.y), bz = Math.floor(refOwner.z);
          for (let i = 0; i < 10; i++) {
            const a = Math.floor(rr() * 7) - 3, b = Math.floor(rr() * 3) - 1, d = Math.floor(rr() * 7) - 3;
            const x = bx + a, y = by + b, z = bz + d;
            if (Math.abs(x - refOwner.x) < 2 && Math.abs(z - refOwner.z) < 2) continue;
            if (tf(x, y, z) !== T.WALKABLE) continue;
            if (!leaves && tf(x, y - 1, z) === T.LEAVES) continue;
            ref.x = x + 0.5; ref.y = y; ref.z = z + 0.5; ref.__path = false; break;
          }
        } else if (c.mob === 'parrot') rcalls.push('fly');
        else if (!ref.__path) { rcalls.push('path'); ref.__path = true; } else rcalls.push('step'), ref.x += 0.2;
      }
    }
    if (!rRun) ref.__path = false;
    if (rRun && calls.includes('path') !== rcalls.includes('path')) ref.__path = ref.__path;
    rf.push(rRun + '|' + rcalls.join(',') + '|' + ref.x.toFixed(2) + ',' + ref.y + ',' + ref.z.toFixed(2) + '|' + malus(ref));
  }
  const i = eng.findIndex((v, k) => v !== rf[k]);
  return i < 0 ? null : 'tick ' + i + ': ' + eng[i] + ' vs ' + rf[i];
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20; s++) for (const mob of Object.keys(MOBS)) {
    const b = lane({ salt: s, mob, d0: 4 + (s % 5) * 4, sprint: s % 2, sit: s % 3 === 0, leash: s % 7 === 6 }); n++;
    if (b && !bad) bad = `salt ${s} ${mob}: ${b}`;
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 60, 'lanes ' + base.n);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Ai.FollowOwnerGoal; Ai.FollowOwnerGoal = function (e, s, a, b, p, r, l) { return new o(e, s, a, 6, p, r, l); }; brk(!!run().bad, '6-block stop distance'); Ai.FollowOwnerGoal = o; }
{ const o = Ai.FollowOwnerGoal; Ai.FollowOwnerGoal = function (e, s, a, b, p, r, l) { return new o(e, s, a, b, p, r, true); }; brk(!!run().bad, 'leaves allowed for wolf/cat'); Ai.FollowOwnerGoal = o; }
{ const o = Ai.FollowOwnerGoal; Ai.FollowOwnerGoal = function (e, s, a, b, p, r, l) { return new o(e, s, a + 3, b, p, r, l); }; brk(!!run().bad, 'start distance 13'); Ai.FollowOwnerGoal = o; }
{ const o = Ai.FollowOwnerGoal; Ai.FollowOwnerGoal = function (e, s, a, b, p, r, l) { const g = new o(e, s, a, b, p, r, l), st = g.stop; g.stop = function () { st(); e.pathMalus[T.WATER] = 0; }; return g; }; brk(!!run().bad, 'water penalty not restored on stop'); Ai.FollowOwnerGoal = o; }
console.log(`lockstep-followowner: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
