// lockstep-catsit -- #7086 (G17-L223): lockstep scenario 'catsit', 20 salts: tamed cat in a room with a chest, a lit furnace, an unlit furnace, a bed (foot+head) and bare floor.
// Reference = .decomp CatSitOnBlockGoal.isTargetPos (air above; chest with no viewers; LIT furnace; bed that is not the HEAD part) + MoveToTargetPosGoal (canStart cooldown 200+nextInt(200),
// findTargetPos ring scan range 8 / maxY 1, start: safeWaitingTime, tick: isWithinDistance(centre, 1.0), tryingTime++/-- and a path restart on tryingTime % 40 == 0, shouldContinue). Written independently of src/.
// Per tick we compare: canUse/start/stop decisions, the target block (the path goal), the path restart ticks, sitting pose, position. The owner sit ORDER at tick 450 must end the goal.
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07k_goals.js'], dom: false });
const Ai = M.Ai;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const FLOOR = 1, CHEST = 10, FURN_LIT = 11, FURN = 12, BED_FOOT = 13, BED_HEAD = 14;
const BLK = { [CHEST]: 1000, [FURN_LIT]: 1001, [FURN]: 1001, [BED_FOOT]: 1002, [BED_HEAD]: 1002 };
const key = (x, y, z) => x + ',' + y + ',' + z;
function world(salt) {
  const b = new Map();
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) b.set(key(x, 63, z), FLOOR);
  const q = salt % 4;   // rotate the furniture so different salts find different first targets
  const put = [[CHEST, 3, 2], [FURN_LIT, -4, 1], [FURN, 1, -3], [BED_FOOT, -2, -5], [BED_HEAD, -2, -6]];
  for (const [s, x, z] of put) { const r = [[x, z], [z, -x], [-x, -z], [-z, x]][q]; b.set(key(r[0], 63, r[1]), s); }
  return b;
}
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 700, SIT_AT = 450;
let blocks = new Map(), calls = [];
M.World = { getBlock: (x, y, z) => blocks.get(key(x, y, z)) || 0 };
M.Tags = { ready: true, blockTag: () => 1, stateInCol: (c, s) => s === BED_FOOT || s === BED_HEAD };
M.Reg = { id: { chest: 1000, furnace: 1001 }, PROP: { lit: 1, part: 2, type: 3, facing: 4 }, PVAL: { 'true': 1, head: 2 }, valueNames: [] };
M.States = { block: [], propValue: (s, p) => p === 1 ? (s === FURN_LIT ? 1 : 0) : p === 2 ? (s === BED_HEAD ? 2 : 3) : -1 };
for (const s in BLK) M.States.block[s] = BLK[s];
M.BlockEntities = { get: () => null };
M.EntityList = { list: [] };
let now = 0;
Ai.findPath = (x, y, z, gx, gy, gz) => { calls.push([now, gx, gy, gz]); return [[x, y, z], [gx, gy, gz]]; };
Ai.stepToward = (e, p) => { const dx = p[0] - e.x, dz = p[2] - e.z, d = Math.hypot(dx, dz) || 1, s = Math.min(0.2, d); e.x += dx / d * s; e.z += dz / d * s; };
Ai.closeTo = () => false;
const START = (salt) => [0.5 + (salt % 5) - 2, 64, 0.5 + (Math.floor(salt / 5) % 4) - 1];

function enginetrace(salt) {
  blocks = world(salt); calls = []; const rnd = stream(salt);
  M.EntityList.randomOf = () => rnd;
  const [x, y, z] = START(salt), e = { type: 'cat', tamed: true, sitting: false, x, y, z };
  const g = new Ai.CatSitOnBlockGoal(e, 0.8), tr = []; let active = false;
  for (now = 0; now < TICKS; now++) {
    if (now === SIT_AT) e.sitting = true;
    let ev = '';
    if (!active) { if (g.canUse()) { g.start(); active = true; ev = 'S'; } }
    else if (!g.canContinueToUse() || e.sitting) { g.stop(); active = false; ev = 'X'; }
    if (active) g.tick();
    tr.push(`${now}${ev}${active ? 'a' : '-'}${e.sitPose ? 'P' : 'p'}:${e.x.toFixed(12)},${e.z.toFixed(12)}`);
  }
  return { tr, calls: calls.map((c) => c.join(',')) };
}

function reftrace(salt, opt = {}) {
  const b = world(salt), rnd = stream(salt), ni = (n) => Math.floor(rnd() * n);
  const at = (x, y, z) => b.get(key(x, y, z)) || 0;
  const isTarget = (x, y, z) => {
    if (at(x, y + 1, z) !== 0) return false;
    const s = at(x, y, z);
    if (BLK[s] === 1000) return true;   // no viewers in this room
    if (BLK[s] === 1001 && (opt.noLit || s === FURN_LIT)) return true;
    return (s === BED_FOOT || s === BED_HEAD) && s !== BED_HEAD;
  };
  const [x0, y0, z0] = START(salt), e = { x: x0, y: y0, z: z0, pose: false };
  let cooldown = 0, trying = 0, safe = 0, tgt = null, reached = false, active = false, sitting = false;
  const refcalls = [], tr = [];
  const find = () => {
    const bx = Math.floor(e.x), by = Math.floor(e.y), bz = Math.floor(e.z);
    for (let dy = 0; dy <= 1; dy = dy > 0 ? -dy : 1 - dy) for (let r = 0; r < 8; r++) for (let dx = 0; dx <= r; dx = dx > 0 ? -dx : 1 - dx)
      for (let dz = dx < r && dx > -r ? r : 0; dz <= r; dz = dz > 0 ? -dz : 1 - dz)
        if (isTarget(bx + dx, by + dy - 1, bz + dz)) { tgt = [bx + dx, by + dy - 1, bz + dz]; return true; }
    return false;
  };
  const move = (t) => { refcalls.push([t, tgt[0] + 0.5, tgt[1] + 1, tgt[2] + 0.5].join(',')); pathGoal = [tgt[0] + 0.5, tgt[1] + 1, tgt[2] + 0.5]; };
  let pathGoal = null;
  for (let t = 0; t < TICKS; t++) {
    if (t === SIT_AT) sitting = true;
    let ev = '';
    if (!active) {
      let can = false;
      if (!sitting) { if (cooldown > 0) cooldown--; else { cooldown = 200 + ni(200); can = find(); } }
      if (can) { trying = 0; safe = ni(ni(1200) + 1200) + 1200; e.pose = false; active = true; ev = 'S'; move(t); }
    } else if (!(trying >= -safe && trying <= (opt.max || 1200) && isTarget(tgt[0], tgt[1], tgt[2])) || sitting) { active = false; reached = false; e.pose = false; ev = 'X'; }
    if (active) {
      const cx = tgt[0] + 0.5, cy = tgt[1] + 1.5, cz = tgt[2] + 0.5;
      const d = (cx - e.x) ** 2 + (cy - e.y) ** 2 + (cz - e.z) ** 2;
      if (d >= 1.0) {
        reached = false; trying++;
        if (trying % (opt.every || 40) === 0) move(t);
        const dx = pathGoal[0] - e.x, dz = pathGoal[2] - e.z, dd = Math.hypot(dx, dz) || 1, s = Math.min(0.2, dd);
        e.x += dx / dd * s; e.z += dz / dd * s;
      } else { reached = true; trying--; }
      e.pose = reached;
    }
    tr.push(`${t}${ev}${active ? 'a' : '-'}${e.pose ? 'P' : 'p'}:${e.x.toFixed(12)},${e.z.toFixed(12)}`);
  }
  return { tr, calls: refcalls };
}
const diff = (a, b) => {
  for (let i = 0; i < Math.max(a.tr.length, b.tr.length); i++) if (a.tr[i] !== b.tr[i]) return `tick ${i}: engine ${a.tr[i]} vs ref ${b.tr[i]}`;
  for (let i = 0; i < Math.max(a.calls.length, b.calls.length); i++) if (a.calls[i] !== b.calls[i]) return `path call ${i}: engine ${a.calls[i]} vs ref ${b.calls[i]}`;
  return null;
};
let sits = 0, targets = new Set();
for (let s = 0; s < 20; s++) {
  const eng = enginetrace(s), d = diff(eng, reftrace(s));
  ok(!d, `catsit salt ${s}: ${d}`);
  if (eng.tr.some((t) => t.includes('P'))) sits++;
  if (eng.calls[0]) targets.add(eng.calls[0].split(',').slice(1).join(','));
}
ok(sits >= 15, `salts reach and sit on a target (${sits}/20)`);
ok(targets.size >= 3, `salts choose different targets (${targets.size})`);
const brk = (opt, m) => { let bad = false; for (let s = 0; s < 20 && !bad; s++) bad = !!diff(enginetrace(s), reftrace(s, opt)); if (bad) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
brk({ noLit: true }, 'lit-furnace test removed (unlit furnaces count)');
brk({ every: 10 }, 'path restart every 10 ticks instead of 40');
brk({ max: 5 }, 'tryingTime ceiling lowered');
console.log(`lockstep-catsit: ${22 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
