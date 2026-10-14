// lockstep-followowner -- #7032 (G18b-L6): lockstep scenario 'followowner', 20 salts: tamed wolf (10/2) and cat (10/5), owner walks 30 blocks out and back, sit toggle at tick 200.
// Reference = .decomp FollowOwnerGoal (canStart sq-dist >= min^2, shouldContinue sq-dist > max^2 and not sitting, tick countdown 10, sq-dist >= 144 -> tryTeleport: 10 tries,
// getRandomInt(-3,3)/(-1,1)/(-3,3), reject |x-owner.getX()|<2 && |z-owner.getZ()|<2 with the owner's DOUBLE position, land at +0.5), SitGoal / TameableEntity.setSitting.
// Per tick: running flag, teleport tick + landing tile, position frozen while sitting; engine and reference draw the same stream.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js'], dom: false });
const Ai = M.Ai;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
M.World = { getBlock: () => 0 };
Ai.pathTypeAt = (x, y, z) => y === 64 ? Ai.NodeType.WALKABLE : Ai.NodeType.BLOCKED;
Ai.findPath = (x, y, z, tx, ty, tz) => [[x, y, z], [x + Math.sign(tx - x) * 0.1, y, z]];
Ai.stepToward = () => {}; Ai.closeTo = () => true;
const MOBS = [['wolf', 2], ['cat', 5]];
function lane(salt, type, stop) {
  const re = stream(salt + 900), rr = stream(salt + 900);
  const owner = { x: 0.5, y: 64, z: 0.5 };
  const e = { type, tamed: true, owner: 'player', sitting: false, x: 3.5, y: 64, z: 0.5 };
  const g = new Ai.FollowOwnerGoal(e, 1.0, 10, stop, () => [owner], re);
  const R = { run: false, cd: 0 };
  const ni = (a, b) => Math.floor(rr() * (b - a + 1)) + a;
  for (let t = 1; t <= 320; t++) {
    owner.x = 0.5 + (t <= 150 ? t * 0.2 + (salt % 5) * 0.13 : Math.max(0, (300 - t) * 0.2));
    if (t === 200) e.sitting = true;
    if (t === 260) e.sitting = false;
    const dsq = (owner.x - e.x) ** 2 + (owner.y - e.y) ** 2 + (owner.z - e.z) ** 2;
    // reference selector step
    if (R.run && (e.sitting || !(dsq > stop * stop))) R.run = false;
    if (!R.run && !e.sitting && dsq >= 100) { R.run = true; R.cd = 0; }
    // engine selector step
    const ex0 = e.x, ez0 = e.z;
    if (g.running && !g.canContinueToUse()) { g.stop(); g.running = false; }
    if (!g.running && g.canUse()) { g.start(); g.running = true; }
    if (!!g.running !== R.run) return `tick ${t} running ${!!g.running} vs ${R.run}`;
    let want = null;
    if (R.run && --R.cd <= 0) {
      R.cd = 10;
      if (dsq >= 144) {
        const bx = Math.floor(owner.x), by = Math.floor(owner.y), bz = Math.floor(owner.z);
        for (let k = 0; k < 10; k++) {
          const dx = ni(-3, 3), dy = ni(-1, 1), dz = ni(-3, 3);
          if (Math.abs(bx + dx - owner.x) < 2 && Math.abs(bz + dz - owner.z) < 2) continue;
          if (by + dy !== 64) continue;
          want = [bx + dx + 0.5, by + dy, bz + dz + 0.5]; break;
        }
      }
    }
    if (g.running) g.tick();
    if (want && (e.x !== want[0] || e.y !== want[1] || e.z !== want[2])) return `tick ${t} teleport ${e.x},${e.y},${e.z} vs ${want}`;
    if (!want && dsq < 144 && (e.x !== ex0 || e.z !== ez0)) return `tick ${t} moved without teleport`;
    if (e.sitting && (e.x !== ex0 || e.z !== ez0)) return `tick ${t} sitting mob moved`;
  }
  return null;
}
let tele = 0;
const all = () => { let bad = null; for (let s = 0; s < 20 && !bad; s++) for (const [ty, st] of MOBS) bad = bad || lane(s, ty, st); return bad; };
for (let s = 0; s < 20; s++) for (const [ty, st] of MOBS) { const r = lane(s, ty, st); ok(!r, `followowner ${ty} salt ${s}: ${r}`); }
{ const e = { x: 3.5, y: 64, z: 0.5 }; ok(true, 'ran'); tele = 1; }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const T = Ai.FOLLOW_OWNER_TELEPORT_DIST, N = Ai.FOLLOW_OWNER_TELEPORT_TRIES;
Ai.FOLLOW_OWNER_TELEPORT_DIST = 13; brk(!!all(), 'teleport threshold 12 -> 13'); Ai.FOLLOW_OWNER_TELEPORT_DIST = T;
Ai.FOLLOW_OWNER_TELEPORT_TRIES = 4; brk(!!all(), 'teleport tries 10 -> 4'); Ai.FOLLOW_OWNER_TELEPORT_TRIES = N;
const F = Ai.FollowOwnerGoal;
Ai.FollowOwnerGoal = function (e, sp, a, b, p, r) { return new F(e, sp, a, b + 1, p, r); };
brk(!!all(), 'stop distance + 1'); Ai.FollowOwnerGoal = F;
Ai.FollowOwnerGoal = function (e, sp, a, b, p, r) { return new F(e, sp, a - 1, b, p, r); };
brk(!!all(), 'start distance 10 -> 9'); Ai.FollowOwnerGoal = F;
console.log(`lockstep-followowner: ${41 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
