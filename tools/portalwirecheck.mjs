// tools/portalwirecheck.mjs - #10975 (G27a): the nether-portal travel WIRING (src/07zzs2_portalwire.js + the P.tick hook)
// drives overworld -> nether -> overworld at 8:1 over a chunk-like world: 80-tick survival / 1-tick creative timer,
// 300 cooldown, nausea, PortalForcer creates then FINDS, placement waits for chunks. Anti-vacuity: breaks its own data.
import { readFileSync } from 'node:fs';
const rd = (f) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const SRCS = { dim: rd('src/02l_dimension.js'), portal: rd('src/07zzs_portal.js'), wire: rd('src/07zzs2_portalwire.js'), player: rd('src/14_player.js') };
const STONE = 3, OBS = 2, NP = 1;                        // block ids; real states: portal x=10 z=11, obsidian 20, stone 30
const load = (S) => {
  const NS = {}; const run = (src) => new Function('MCL', src.replace(/\}\)\(typeof MCL[^\n]*$/, '})(MCL);').replace(/\}\)\(MCL\);?\s*$/, '})(MCL);'))(NS);
  run(S.dim); run(S.portal); run(S.wire);
  const block = new Uint16Array(64); block[10] = block[11] = NP; block[20] = OBS; block[30] = STONE;
  const isAir = new Uint8Array(64); isAir[0] = 1; const solid = new Uint8Array(64); solid[20] = solid[30] = 1;
  NS.Reg = { id: { nether_portal: NP, obsidian: OBS }, realFirst: { 1: 10, 2: 20 } }; NS.States = { block, isAir, solid };
  NS.CFG = { WORLD_MIN_Y: -64, WORLD_MAX_Y: 256 };
  const cells = { overworld: new Map(), the_nether: new Map() }; let ready = true;
  const top = { overworld: 63, the_nether: 31 };
  const Wd = NS.World = { dimension: 'overworld', border: { contains: () => true }, get: () => null, loadedAt: () => ready,
    getBlock(x, y, z) { const v = cells[this.dimension].get(x + ',' + y + ',' + z); return v !== undefined ? v : (y <= top[this.dimension] && y >= 0 ? 30 : 0); },
    setBlock(x, y, z, id) { cells[this.dimension].set(x + ',' + y + ',' + z, id); }, heightAt() { return top[this.dimension]; },
    setDimension(n) { this.dimension = n; NS.Dim.cur = n; } };
  NS.Gamemode = { isCreative: (e) => e.mode === 1 };
  return { NS, cells, setReady: (v) => (ready = v) };
};
const count = (cells, dim, id) => [...cells[dim].values()].filter((v) => v === id).length;
const verdict = (S) => {
  const bad = [], { NS, cells, setReady } = load(S), PW = NS.PortalWire, Wd = NS.World;
  if (!S.player.includes('NS.PortalWire.tick(P)')) bad.push('P.tick must call NS.PortalWire.tick(P)');
  PW.hook();
  for (let y = 64; y < 67; y++) Wd.setBlock(800, y, 1600, 10);          // a lit 1x3 portal slab to stand in
  const p = { x: 800.5, y: 64, z: 1600.5, width: 0.6, height: 1.8, mode: 0 };
  setReady(false);
  for (let i = 0; i < 40; i++) PW.tick(p);
  if (Math.abs(p.portalNausea - 40 * 0.0125) > 1e-9) bad.push('nausea +0.0125/tick: ' + p.portalNausea);
  for (let i = 40; i < 80; i++) PW.tick(p);
  if (Wd.dimension !== 'overworld') bad.push('survival must wait 80 ticks');
  PW.tick(p);
  if (Wd.dimension !== 'the_nether' || p.dimension !== 'the_nether') bad.push('81st tick must enter the nether');
  if (p.netherPortalCooldown !== 299) bad.push('cooldown 300 less this tick: ' + p.netherPortalCooldown);
  if (Math.abs(p.x - 100.0625) > 1e-9 && Math.floor(p.x) !== 100) bad.push('x scaled 1/8: ' + p.x);
  if (!p.portalPending) bad.push('placement must wait for chunks');
  PW.tick(p); if (!p.portalPending) bad.push('still waiting while chunks are not ready');
  setReady(true); PW.tick(p);
  if (p.portalPending) bad.push('placement must finish once chunks are ready');
  const ob = count(cells, 'the_nether', 20), po = count(cells, 'the_nether', 10) + count(cells, 'the_nether', 11);
  if (ob !== 14 || po !== 6) bad.push('PortalForcer.createPortal: 14 obsidian + 6 portal, got ' + ob + '/' + po);
  if (Math.abs(p.x - 100.5) > 3 || Math.abs(p.z - 200.5) > 3) bad.push('landed near (100,200): ' + p.x + ',' + p.z);
  if (!PW.overlap(p)) bad.push('landing is inside the new portal');
  // out of the portal, wait out the cooldown, then back in
  p.x += 6; for (let i = 0; i < 301; i++) PW.tick(p);
  if (p.netherPortalCooldown !== 0 || Wd.dimension !== 'the_nether') bad.push('no travel while out of the portal');
  p.x -= 6; const nx = p.x, nz = p.z;
  for (let i = 0; i < 80; i++) PW.tick(p);
  if (Wd.dimension !== 'the_nether') bad.push('second trip also waits 80');
  PW.tick(p);
  if (Wd.dimension !== 'overworld') bad.push('return trip to the overworld');
  const ob2 = count(cells, 'overworld', 20);
  if (ob2 !== 0 || Math.abs(p.x - 800.5) > 3.5 || Math.abs(p.z - 1600.5) > 3.5) bad.push('return finds the existing overworld portal at 8x (obsidian ' + ob2 + '): ' + p.x + ',' + p.z);
  if (!PW.overlap(p) && (p.x !== 800.5 || p.z !== 1600.5)) bad.push('return landing inside the found portal');
  // creative: 1 tick
  const c = load(S), q = { x: 800.5, y: 64, z: 1600.5, width: 0.6, height: 1.8, mode: 1 };
  c.NS.PortalWire.hook(); c.NS.World.setBlock(800, 64, 1600, 11); c.NS.PortalWire.tick(q); c.NS.PortalWire.tick(q);
  if (c.NS.World.dimension !== 'the_nether') bad.push('creative travels after 1 tick');
  if (count(c.cells, 'the_nether', 11) !== 6 || count(c.cells, 'the_nether', 10)) bad.push('a z-axis portal is rebuilt on the z axis');
  // spiral: a nether->overworld trip finds a portal 128 away? one just beyond (16 for nether) must not be found
  return bad;
};
const BREAKS = [
  ['80 ticks', 'wire', (s) => s.replace("NS.Portal.tick(p,", "NS.Portal.tick(Object.assign(p,{portalDelay:5}),")],
  ['nausea step', 'wire', (s) => s.replace('0.0125', '0.05')],
  ['no collision', 'wire', (s) => s.replace('NS.Portal.onEntityCollision(p, hit.x, hit.y, hit.z);', '')],
  ['no wait for chunks', 'wire', (s) => s.replace('if (!chunksReady(', 'if (false && !chunksReady(')],
  ['no scale', 'portal', (s) => s.replace('p.x *= f;', 'p.x *= 1;')],
  ['no POI note', 'wire', (s) => s.replace('m.set(k, {', 'void 0 && m.set(k, {')],
  ['always create', 'wire', (s) => s.replace('if (rect) {', 'if (false) {')],
  ['topLimit', 'wire', (s) => s.replace('bottom + dt.logicalHeight', 'bottom + 4')],
  ['axis', 'wire', (s) => s.replace("=== 1 ? 'z'", "=== 7 ? 'z'")],
  ['hook', 'player', (s) => s.replace('NS.PortalWire.tick(P)', 'void 0')],
];
const real = verdict(SRCS); let caught = 0;
for (const [n, k, f] of BREAKS) {
  let v;
  try { v = verdict({ ...SRCS, [k]: f(SRCS[k]) }); } catch (e) { v = ['threw']; }
  if (v.length) caught++; else console.log(' NOT CAUGHT:', n);
}
for (const x of real) console.log(' FAIL:', x);
console.log(`portalwirecheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
