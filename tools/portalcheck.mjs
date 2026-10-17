// tools/portalcheck.mjs - #6702: portal travel (src/07zzs_portal.js) against hand-derived vanilla results. Anti-vacuity below.
import { readFileSync } from 'node:fs';
const SRC = readFileSync(new URL('../src/07zzs_portal.js', import.meta.url), 'utf8');
const load = (src, NS = {}) => { new Function('MCL', src.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);'))(NS); return NS.Portal; };
const flat = () => {                                   // flat world: solid y<64, air above
  const set = new Map(), W = { bottomY: -64, topLimit: 256, sets: set, topY: () => 64,
    key: (x, y, z) => x + ',' + y + ',' + z, inBorder: () => true, portals: () => [],
    isAir: (x, y, z) => { const v = set.get(W.key(x, y, z)); return v ? v[0] === 'air' : y >= 64; },
    solid: (x, y, z) => { const v = set.get(W.key(x, y, z)); return v ? v[0] === 'obsidian' : y < 64; },
    set: (x, y, z, k, a) => set.set(W.key(x, y, z), [k, a]) };
  return W;
};
let SRC_NOW = SRC;
const verdict = (P) => {
  const bad = [], e = { type: 'player' }, moved = [], ctx = { netherAllowed: true, hasTarget: true, moveToWorld: (x) => moved.push(x) };
  P.onEntityCollision(e, 1, 2, 3);
  if (!e.inNetherPortal || e.lastNetherPortalPosition.y !== 2) bad.push('collision must flag the entity');
  for (let i = 0; i < 80; i++) { P.tick(e, ctx); P.onEntityCollision(e, 1, 2, 3); }
  if (moved.length) bad.push('player moved before 81 ticks');
  P.tick(e, ctx);
  if (moved.length !== 1 || e.netherPortalCooldown !== 299 || e.netherPortalTime !== 80) bad.push('player must travel at tick 81, cooldown 300: ' + JSON.stringify(e));
  P.tick(e, ctx); if (e.netherPortalTime !== 76 || e.netherPortalCooldown !== 298) bad.push('decay -4 and cooldown -1 when out of portal');
  const m = { type: 'zombie' }; P.onEntityCollision(m, 0, 0, 0); P.tick(m, ctx);
  if (moved.length !== 2) bad.push('non-player travels the first tick (max time 0)');
  const r = { type: 'player', vehicle: {} }; P.onEntityCollision(r, 0, 0, 0); if (r.inNetherPortal) bad.push('riders never enter');
    const f = P.findLargestRectangle([2, 3, 3, 1]); if (f.min !== 1 || f.max !== 2 || f.h !== 3) bad.push('findLargestRectangle [2,3,3,1] -> 1..2 h3: ' + JSON.stringify(f));
  const W = flat(), g = P.createPortal(W, { x: 100, y: 64, z: 100 }, 'x');
  if (!g || g.w !== 2 || g.h !== 3) bad.push('createPortal result');
  else {
    const n = [...W.sets.values()]; const ob = n.filter((v) => v[0] === 'obsidian').length, po = n.filter((v) => v[0] === 'portal').length;
    if (po !== 6 || ob !== 14) bad.push('frame must be 14 obsidian + 6 portal, got ' + ob + '/' + po);
    if (g.x !== 100 || g.z !== 100 || g.y !== 64) bad.push('portal origin on the flat ground at the spiral centre: ' + JSON.stringify(g));
    const cells = [...W.sets.entries()].filter(([, v]) => v[0] === 'portal').map(([k]) => k.split(',').map(Number));
    if (cells.some((c) => c[2] !== 100) || new Set(cells.map((c) => c[0])).size !== 2) bad.push('axis x portal spans x and 1 z-plane, going east');
  }
  const M = flat(); M.portals = () => [{ x: 5, y: 70, z: 5 }, { x: 5, y: 66, z: 5 }]; M.axisAt = () => 'x';
  M.samePortal = (a, b) => b.y >= 66 && b.y <= 68 && b.x >= 5 && b.x <= 6 && b.z === 5;
  const q = P.getPortalRect(M, { x: 5, y: 68, z: 5 }, true);
  if (!q || q.y !== 66 || q.h !== 3 || q.w !== 2) bad.push('getPortalRect: ' + JSON.stringify(q));
  if (P.getPortalRect(M, { x: 100, y: 67, z: 5 }, true)) bad.push('POI outside 16 must not be found');
  const ev = [], ns = { World: { dimension: 'overworld', setDimension(d) { this.dimension = d; } }, Dim: { norm: (d) => d, scaleFactor: (a, b) => a === b ? 1 : a === 'overworld' ? 0.125 : 8 }, Adv: { trigger: (p, id) => ev.push(id) } };
  const T = load(SRC_NOW, ns), pl = { x: 80, y: 70, z: 160 };
  T.moveToWorld(pl, 'the_nether');
  if (pl.x !== 10 || pl.z !== 20 || pl.dimension !== 'the_nether' || ns.World.dimension !== 'the_nether') bad.push('moveToWorld must scale 1/8 and set dimension');
  if (!pl.enteredNetherPos || pl.enteredNetherPos[0] !== 80) bad.push('enteredNetherPos recorded on entry');
  if (ev.join() !== '') bad.push('entry fires nothing itself (World.setDimension fires changed_dimension): ' + ev);
  T.moveToWorld(pl, 'overworld');
  if (ev.join() !== 'minecraft:nether_travel' || pl.x !== 80) bad.push('return fires nether_travel: ' + ev);
  return bad;
};
const BREAKS = [
  ['wait 80 ticks gone', (s) => s.replace(': 80);', ': 0);')], ['cooldown 300', (s) => s.replace('return 300', 'return 30')],
  ['decay 4', (s) => s.replace('-= 4', '-= 1')], ['vehicle gate', (s) => s.replace('!e.vehicle && !(e.pass', 'true && !(e.pass')],
  ['frame', (s) => s.replace("i === 2 || j === -1", "i === 9 || j === -1")], ['radius', (s) => s.replace('toNether ? 16 : 128', '128')],
  ['scale', (s) => s.replace('p.x *= f;', 'p.x *= 1;')], ['entered pos', (s) => s.replace("from === 'overworld' && to", "from === 'x' && to")],
  ['rect stack', (s) => s.replace('st[st.length - 1] + 1 : 0', 'st[st.length - 1] : 0')], ['lowest y tie', (s) => s.replace('p.y < best.y', 'p.y > best.y')],
];
const real = verdict(load(SRC)); let caught = 0;
for (const [n, f] of BREAKS) { let v; try { SRC_NOW = f(SRC); v = verdict(load(SRC_NOW)); } catch (x) { v = ['threw']; } if (v.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`portalcheck: ${caught} breaks caught (of ${BREAKS.length})`);
SRC_NOW = SRC;
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
