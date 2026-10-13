// lockstep-netherportal -- #6683 (G17-L112): lockstep scenario 'netherportal', 20 salts: a cow, a zombified_piglin and a survival/creative player body in a portal frame.
// Reference = independent state machine of .decomp Entity.tickNetherPortal / setInNetherPortal (portal time to 80 for survival players, 1 creative, 0 otherwise; cooldown 300; -4 decay outside)
// plus a brute-force nearest-portal search for PortalForcer.getPortalRect (128 radius to the overworld, 16 to the nether) and createPortal when none is found. Compared every tick.
// OWED (needs moveToWorld, #6702 OWED list): the dimension change itself and the pigman anger on a mismatched destination.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../../src/07zzs_portal.js', import.meta.url), 'utf8');
const load = (src) => { const NS = {}; new Function('MCL', src.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);'))(NS); return NS.Portal; };
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// destination world: flat ground y<64, a set of 2x3 x-axis portals
function world(portals) {
  const set = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
  const cells = () => portals.flatMap((p) => { const c = []; for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) c.push({ x: p.x + i, y: p.y + j, z: p.z }); return c; });
  const W = { bottomY: -64, topLimit: 256, topY: () => 64, inBorder: () => true, sets: set,
    portals: () => cells().concat([...set].filter(([, v]) => v[0] === 'portal').map(([q]) => { const a = q.split(',').map(Number); return { x: a[0], y: a[1], z: a[2] }; })),
    axisAt: (x, y, z) => (cells().some((c) => c.x === x && c.y === y && c.z === z) || (set.get(k(x, y, z)) || [])[0] === 'portal' ? 'x' : null),
    samePortal: (a, b) => W.axisAt(b.x, b.y, b.z) === 'x',
    isAir: (x, y, z) => { const v = set.get(k(x, y, z)); return v ? v[0] === 'air' : y >= 64; },
    solid: (x, y, z) => { const v = set.get(k(x, y, z)); return v ? v[0] === 'obsidian' : y < 64; },
    set: (x, y, z, kind, ax) => set.set(k(x, y, z), [kind, ax]) };
  return W;
}
const refNearest = (ps, pos, rad) => { let b = null, bd = 0; for (const p of ps) for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) { const q = { x: p.x + i, y: p.y + j, z: p.z }; if (Math.abs(q.x - pos.x) > rad || Math.abs(q.z - pos.z) > rad) continue; const d = (q.x - pos.x) ** 2 + (q.y - pos.y) ** 2 + (q.z - pos.z) ** 2; if (!b || d < bd || (d === bd && q.y < b.y)) { b = q; bd = d; } } return b; };
// independent reference of one entity
function refEnt(type, creative) {
  const s = { inP: false, t: 0, cd: 0 }, max = type !== 'player' ? 0 : creative ? 1 : 80;
  return { s, enter() { if (s.cd > 0) s.cd = 300; else s.inP = true; },
    tick(go) { if (s.inP) { if (s.t++ >= max) { s.t = max; s.cd = 300; go(); } s.inP = false; } else { if (s.t > 0) s.t -= 4; if (s.t < 0) s.t = 0; } if (s.cd > 0) s.cd--; } };
}
function lane(P, salt) {
  const r = stream(salt), toNether = salt % 2 === 0;
  const pos = { x: Math.floor(r() * 200 - 100), y: 64, z: Math.floor(r() * 200 - 100) };
  const portals = []; for (let i = r() * 3 | 0; i > 0; i--) portals.push({ x: pos.x + Math.floor(r() * 300 - 150), y: 64 + (r() * 10 | 0), z: pos.z + Math.floor(r() * 300 - 150) });
  const W = world(portals), rad = toNether ? 16 : 128;
  const f = P.getPortalRect(W, pos, toNether), n = refNearest(portals, pos, rad);
  if (!!f !== !!n) return `rect found=${!!f} vs ref ${!!n}`;
  if (n && (f.x > n.x || f.y > n.y || f.z !== n.z)) return `rect ${JSON.stringify(f)} does not hold nearest ${JSON.stringify(n)}`;
  if (!n) { const c = P.createPortal(W, pos, 'x'); if (!c) return 'createPortal null'; const p = [...W.sets.values()].filter((v) => v[0] === 'portal').length, o = [...W.sets.values()].filter((v) => v[0] === 'obsidian').length; if (p !== 6 || o < 14) return `created ${p} portal ${o} obsidian`; }
  const creative = salt % 4 === 1, kinds = [['cow', {}], ['zombified_piglin', {}], ['player', {}]];
  const ents = kinds.map(([type, e]) => ({ e: Object.assign(e, { type, gm: creative && type === 'player' ? 'creative' : 'survival' }), R: refEnt(type, creative && type === 'player') }));
  P.__gm = creative; const plan = []; for (let t = 1; t <= 400; t++) plan.push(t < 100 ? true : r() < .7 || (t > 150 && t < 260));
  const gotP = [], gotR = [];
  for (let t = 1; t <= 400; t++) for (const x of ents) {
    if (plan[t - 1]) { P.onEntityCollision(x.e, 1, 65, 1); x.R.enter(); }
    P.tick(x.e, { netherAllowed: true, hasTarget: true, moveToWorld: () => gotP.push(x.e.type + t) }); x.R.tick(() => gotR.push(x.e.type + t));
    const a = [!!x.e.inNetherPortal, x.e.netherPortalTime | 0, x.e.netherPortalCooldown | 0].join(), b = [x.R.s.inP, x.R.s.t, x.R.s.cd].join();
    if (a !== b) return `tick ${t} ${x.e.type} ${a} vs ref ${b}`;
  }
  if (gotP.join() !== gotR.join()) return `travel ticks ${gotP} vs ref ${gotR}`;
  return gotR.length ? null : 'nobody travelled';
}
const run = (P) => { for (let s = 0; s < 20; s++) { const m = lane(P, s); if (m) return `salt ${s}: ${m}`; } return null; };
{
  const wrap = (P) => { P.maxTime = ((o) => (e) => (e.type === 'player' && e.gm === 'creative') ? 1 : o(e))(P.maxTime); return P; };
  const P = wrap(load(SRC));
  const m = run(P); ok(!m, 'netherportal ' + m);
  const brk = (src, why) => { const Q = wrap(load(src)); const bad = run(Q); if (bad) { breaks++; console.log('   ✓ break caught: ' + why); } else { fails++; console.log('  ✗ break NOT caught: ' + why); } };
  brk(SRC.replace(': 80);', ': 79);'), 'portal time 80 -> 79');
  brk(SRC.replace('P.defaultCooldown = function () { return 300; }', 'P.defaultCooldown = function () { return 200; }'), 'cooldown 300 -> 200');
  brk(SRC.replace('netherPortalTime -= 4', 'netherPortalTime -= 2'), 'decay 4 -> 2');
  brk(SRC.replace("var rad = toNether ? 16 : 128", "var rad = toNether ? 16 : 100"), 'search radius 128 -> 100');
}
console.log(`lockstep-netherportal: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
