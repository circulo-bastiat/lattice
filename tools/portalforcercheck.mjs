// tools/portalforcercheck.mjs - #262: PortalForcer.createPortal / getPortalRect (src/07zzs_portal.js) pinned on scripted worlds
// (LCG-seeded terrain). Hand-derivable cases are asserted by rule; seeded cases are pinned. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/07zzs_portal.js', import.meta.url), 'utf8');
const load = (src) => { const NS = {}; new Function('MCL', src.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);'))(NS); return NS.Portal; };
const world = (seed, opts = {}) => {
  let s = seed >>> 0; const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
  const hs = new Map(), h = (x, z) => { const k = x + ',' + z; if (!hs.has(k)) hs.set(k, opts.flat ? 64 : 60 + Math.floor(rnd() * 12)); return hs.get(k); };
  const set = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
  const W = { bottomY: -64, topLimit: 256, sets: set, topY: (x, z) => opts.solid ? 255 : h(x, z) + 1, portals: () => [],
    inBorder: (x, z) => !opts.border || (Math.abs(x) <= opts.border && Math.abs(z) <= opts.border),
    isAir: (x, y, z) => { const v = set.get(key(x, y, z)); return v ? v[0] === 'air' : !opts.solid && y > h(x, z); },
    solid: (x, y, z) => { const v = set.get(key(x, y, z)); return v ? v[0] === 'obsidian' : opts.solid || y <= h(x, z); },
    set: (x, y, z, k, a) => set.set(key(x, y, z), [k, a]) };
  return W;
};
const cells = (W, k) => [...W.sets.entries()].filter(([, v]) => v[0] === k).map(([c]) => c.split(',').map(Number));
const PINS = { 1: [8, 61, 14], 7: [0, 70, 0], 42: [8, 70, 11] };   // seed -> origin for pos (0,66,0) axis x (pinned from the engine)
const verdict = (P) => {
  const bad = [];
  // solid world: no air anywhere -> fallback platform, y clamped to >= 70, 4x3 frame sits on a 3x2 obsidian floor
  let W = world(1, { solid: true }), r = P.createPortal(W, { x: 10, y: 64, z: 10 }, 'x');
  if (!r || r.y !== 70 || r.x !== 10 || r.z !== 10) bad.push('solid fallback origin: ' + JSON.stringify(r));
  else {
    const ob = cells(W, 'obsidian'), po = cells(W, 'portal');
    if (po.length !== 6 || ob.length < 14) bad.push('fallback frame counts ' + ob.length + '/' + po.length);
    if (!ob.some((c) => c[1] === 69 && c[0] === 10 && c[2] === 11)) bad.push('fallback floor obsidian at y69');
  }
  W = world(1, { solid: true }); r = P.createPortal(W, { x: 10, y: 200, z: 10 }, 'z');
  if (!r || r.y !== 200) bad.push('fallback keeps y when in range: ' + JSON.stringify(r));
  else if (new Set(cells(W, 'portal').map((c) => c[0])).size !== 1) bad.push('axis z portal spans one x-plane');
  W = world(1, { solid: true, border: 5 }); if (P.createPortal(W, { x: 10, y: 64, z: 10 }, 'x')) bad.push('fallback outside border must fail');
  // flat: a border cuts the spiral so the portal must stay inside it (and one cell east for axis x)
  W = world(1, { flat: true, border: 3 }); r = P.createPortal(W, { x: 3, y: 65, z: 0 }, 'x');
  if (!r || r.x + 1 > 3 || Math.abs(r.x) > 3) bad.push('portal must keep both columns inside the border: ' + JSON.stringify(r));
  // flat, centre cell preferred (nearest valid, 3-wide clear on both sides)
  W = world(1, { flat: true }); r = P.createPortal(W, { x: 0, y: 65, z: 0 }, 'z');
  if (!r || r.x !== 0 || r.z !== 0 || r.y !== 65) bad.push('flat origin on the centre column at y65: ' + JSON.stringify(r));
  // seeded hilly terrain: pinned origins, always on a valid floor
  for (const [seed, exp] of Object.entries(PINS)) {
    W = world(+seed); r = P.createPortal(W, { x: 0, y: 66, z: 0 }, 'x');
    if (!r || [r.x, r.y, r.z].join() !== exp.join()) bad.push('seed ' + seed + ' origin ' + (r && [r.x, r.y, r.z]) + ' != ' + exp);
    else if (cells(W, 'portal').length !== 6) bad.push('seed ' + seed + ' 6 portal cells');
  }
  // getPortalRect: 128 radius to overworld, 16 to nether; tie at equal distance -> lower y; non-portal axis skipped
  const M = world(1, { flat: true }); M.portals = () => [{ x: 100, y: 70, z: 0 }, { x: 0, y: 70, z: 20 }]; M.axisAt = () => 'x'; M.samePortal = (a, b) => b.y >= 70 && b.y <= 72 && b.x >= a.x && b.x <= a.x + 1 && b.z === a.z;
  const o = P.getPortalRect(M, { x: 0, y: 70, z: 0 }, false);
  if (!o || o.x !== 0 || o.z !== 20) bad.push('overworld search picks nearest: ' + JSON.stringify(o));
  if (P.getPortalRect(M, { x: 0, y: 70, z: 0 }, true)) bad.push('nether search radius 16 excludes both');
  M.axisAt = (x) => x === 0 ? null : 'x'; const n2 = P.getPortalRect(M, { x: 0, y: 70, z: 0 }, false);
  if (!n2 || n2.x !== 100) bad.push('POI without a portal block is skipped');
  M.inBorder = (x, z) => z < 10; M.axisAt = () => 'x'; const n3 = P.getPortalRect(M, { x: 0, y: 70, z: 0 }, false);
  if (!n3 || n3.x !== 100) bad.push('outside-border POI skipped');
  // End transit: platform is a 5x5 obsidian floor at y48 under 5x5x3 air; targets are centred
  W = world(1, { flat: true }); P.createEndSpawnPlatform(W);
  if (cells(W, 'obsidian').length !== 25 || cells(W, 'air').length !== 75) bad.push('platform counts ' + cells(W, 'obsidian').length + '/' + cells(W, 'air').length);
  if (!cells(W, 'obsidian').every((c) => c[1] === 48 && Math.abs(c[0] - 100) <= 2 && Math.abs(c[2]) <= 2)) bad.push('platform floor y48 / extent');
  if (!cells(W, 'air').every((c) => c[1] >= 49 && c[1] <= 51)) bad.push('platform air y49..51');
  const t = P.endTeleportTarget('overworld', 'the_end', null, null);
  if (!t || t.x !== 100.5 || t.y !== 50 || t.z !== 0.5) bad.push('end target ' + JSON.stringify(t));
  const u = P.endTeleportTarget('the_end', 'overworld', { x: 8, z: -4 }, () => 70);
  if (!u || u.x !== 8.5 || u.y !== 70 || u.z !== -3.5) bad.push('end->overworld target ' + JSON.stringify(u));
  if (P.endTeleportTarget('overworld', 'the_nether', null, null)) bad.push('nether is not an end target');
  const dest = []; const mv = (d, sh) => (e, to) => dest.push(to);
  P.onEndPortalCollision({}, { dimension: 'overworld', inShape: true, moveToWorld: mv() });
  P.onEndPortalCollision({}, { dimension: 'the_end', inShape: true, moveToWorld: mv() });
  P.onEndPortalCollision({ vehicle: {} }, { dimension: 'overworld', inShape: true, moveToWorld: mv() });
  P.onEndPortalCollision({}, { dimension: 'overworld', inShape: false, moveToWorld: mv() });
  if (dest.join() !== 'the_end,overworld') bad.push('end portal collision ' + dest.join());
  return bad;
};
const BREAKS = [
  ['end portal vehicle', (s) => s.replace('if (e.vehicle || (e.passengers', 'if ((e.passengers')],
  ['end portal shape', (s) => s.replace(' || !ctx.inShape) return false', ') return false')],
  ['end portal return', (s) => s.replace("ctx.dimension === 'the_end' ? 'overworld'", "ctx.dimension === 'the_end' ? 'the_end'")],
  ['platform floor', (s) => s.replace('y0 + 1; y <= y0 + 3', 'y0 + 1; y <= y0 + 2')],
  ['platform y', (s) => s.replace('c.y - 2, x, z, y', 'c.y - 1, x, z, y')],
  ['platform extent', (s) => s.replace('for (x = c.x - 2; x <= c.x + 2; x++) for (z = c.z - 2; z <= c.z + 2; z++) W.set(x, y0, z', 'for (x = c.x - 2; x <= c.x + 1; x++) for (z = c.z - 2; z <= c.z + 2; z++) W.set(x, y0, z')],
  ['end spawn pos', (s) => s.replace('{ x: 100, y: 50, z: 0 }', '{ x: 100, y: 49, z: 0 }')],
  ['return centre', (s) => s.replace('x: spawn.x + 0.5', 'x: spawn.x')],

  ['fallback min y', (s) => s.replace('Math.max(W.bottomY + 1, 70)', 'Math.max(W.bottomY + 1, 60)')],
  ['fallback floor', (s) => s.replace("c < 0 ? 'obsidian'", "c < -1 ? 'obsidian'")],
  ['border check', (s) => s.replace('|| !W.inBorder(x + d[0], z + d[1])', '')],
  ['fallback border', (s) => s.replace('if (!W.inBorder(bestP.x, bestP.z)) return null;', '')],
  ['spiral radius', (s) => s.replace('spiral(pos, 16,', 'spiral(pos, 2,')],
  ['run rule', (s) => s.replace('run <= 0 || run >= 3', 'run >= 3')],
  ['best vs fallback', (s) => s.replace('bestD > dist)) { bestD', 'bestD < dist)) { bestD')],
  ['side check', (s) => s.replace('validPos(W, tmp, d, cw, -1) && ', '')],
  ['axis dir', (s) => s.replace("axis === 'x' ? [1, 0] : [0, 1]", "axis === 'x' ? [0, 1] : [1, 0]")],
  ['radius', (s) => s.replace('toNether ? 16 : 128', '16')],
  ['axis skip', (s) => s.replace('|| !W.axisAt(p.x, p.y, p.z)', '')],
  ['border skip', (s) => s.replace('!W.inBorder(p.x, p.z) ||', '')],
];
const real = verdict(load(SRC)); let caught = 0;
for (const [n, f] of BREAKS) { let v; const m = f(SRC); if (m === SRC) { console.log(' NO-OP BREAK:', n); continue; } try { v = verdict(load(m)); } catch (x) { v = ['threw']; } if (v.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`portalforcercheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
