// lockstep-catgift -- #6783 (G17-L138): lockstep scenario 'catgift', 20 salts: tamed cat + sleeping owner in a bed, 20 goal ticks, then the owner wakes at sky angle 0.78.
// Reference = .decomp CatEntity.SleepWithOwnerGoal.stop / dropMorningGifts: nextFloat < 0.7, teleport(x+nextInt(11)-5, y+nextInt(5)-2, z+nextInt(11)-5), loot cat_morning_gift (6 x weight 10, phantom_membrane 2),
// drop at (blockX - sin(bodyYaw), blockY, blockZ + cos(bodyYaw)). Engine and reference draw the same stream; per tick the pose (head down 1..16, asleep from 17) is compared, then the whole gift outcome.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js'], dom: false });
const Ai = M.Ai;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const BED = 100, FOOT = 101, blocks = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
blocks.set(key(5, 64, 0), FOOT); blocks.set(key(6, 64, 0), BED);
for (let x = -6; x <= 12; x++) for (let z = -8; z <= 8; z++) if (!blocks.has(key(x, 50, z))) blocks.set(key(x, 50, z), 1);
M.World = { getBlock: (x, y, z) => blocks.get(key(x, y, z)) || 0 };
M.Tags = { ready: true, blockTag: () => 1, stateInCol: (c, s) => s === BED || s === FOOT };
M.Reg = { id: { lava: 998, water: 999 }, PROP: { part: 1, facing: 2 }, PVAL: { head: 'head', foot: 'foot', east: 'east' } };
M.States = { block: [], solid: [0, 1], waterIn: [], propValue: (s, p) => p === 1 ? (s === BED ? 'head' : 'foot') : 'east' };
M.Player = { dirStep: () => [1, 0] };
M.EntityList = { list: [] };
Ai.findPath = () => null; Ai.stepToward = () => {}; Ai.closeTo = () => true;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const VAN = [['rabbit_hide', 10], ['rabbit_foot', 10], ['chicken', 10], ['feather', 10], ['rotten_flesh', 10], ['string', 10], ['phantom_membrane', 2]];
function lane(salt, yaw) {
  const re = stream(salt + 500), rr = stream(salt + 500), drops = [];
  const e = { type: 'cat', tamed: true, owner: 'player', sitting: false, x: 5.5, y: 64, z: 0.5, bodyYaw: yaw };
  const o = { x: 6.5, y: 64, z: 0.5, sleeping: true, sleepTimer: 100 };
  const g = new Ai.SleepWithOwnerGoal(e, () => [o], re, () => 0.78, (x, y, z, it) => drops.push([x, y, z, it]));
  if (!g.canUse()) return 'canUse false';
  g.start();
  for (let t = 1; t <= 20; t++) {
    g.tick();
    if (t <= 16 ? (e.inSleepingPose || !e.headDown) : (!e.inSleepingPose || e.headDown)) return `tick ${t} pose asleep=${!!e.inSleepingPose} headDown=${!!e.headDown}`;
  }
  o.sleeping = false; g.stop();
  if (e.inSleepingPose || e.headDown) return 'stop left a pose';
  const ni = (n) => Math.floor(rr() * n);
  if (!(rr() < 0.7)) return drops.length ? 'gift despite failed 0.7 roll' : null;
  const ex = 5 + ni(11) - 5, ey = 64 + ni(5) - 2, ez = 0 + ni(11) - 5;
  if (e.x !== ex || e.y !== 51 || e.z !== ez) return `teleport ${e.x},${e.y},${e.z} vs ${ex},51,${ez}`;
  let r = rr() * 62, item = null;
  for (const [n, w] of VAN) { if ((r -= w) < 0) { item = n; break; } }
  const rad = yaw * Math.PI / 180, d = drops[0];
  if (drops.length !== 1) return `drops ${drops.length}`;
  if (d[3] !== item) return `item ${d[3]} vs ${item}`;
  if (Math.abs(d[0] - (ex - Math.sin(rad))) > 1e-9 || d[1] !== ey && d[1] !== 51 || Math.abs(d[2] - (ez + Math.cos(rad))) > 1e-9) return `drop pos ${d.slice(0, 3)}`;
  return null;
}
let gifts = 0;
for (let s = 0; s < 20; s++) { const r = lane(s, (s * 37) % 360); ok(!r, `catgift salt ${s}: ${r}`); }
for (let s = 0; s < 20; s++) { const re = stream(s + 500); if (re() < 0.7) gifts++; }
ok(gifts > 5 && gifts < 20, `salts exercise both outcomes (${gifts} gifts)`);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const orig = Ai.CAT_GIFTS.map((x) => x.slice());
const any = (mut) => { mut(); let bad = null; for (let s = 0; s < 20 && !bad; s++) bad = lane(s, (s * 37) % 360); Ai.CAT_GIFTS.length = 0; orig.forEach((x) => Ai.CAT_GIFTS.push(x.slice())); return bad; };
brk(!!any(() => { Ai.CAT_GIFTS[0][1] = 30; }), 'gift table weight swapped (rabbit_hide 10 -> 30)');
brk(!!any(() => { Ai.CAT_GIFTS[6][1] = 10; }), 'phantom_membrane weight 2 -> 10');
brk(!!any(() => { Ai.CAT_GIFTS.pop(); }), 'phantom_membrane dropped from the pool');
console.log(`lockstep-catgift: ${21 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
