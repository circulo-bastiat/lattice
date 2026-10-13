#!/usr/bin/env node
// #4799: HoldingPattern.tickInRange / StrafePlayer.updatePath / setTargetEntity call path.next()
// after findPath (vanilla), so the first pathTarget is path[1], not the dragon's own node path[0].
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07zzl_enderdragon.js'] });
const ED = M.EnderDragon;
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const mk = () => new ED.EnderDragonEntity({ pathNodes: ED.buildPathNodes(() => 60), fight: { getAliveEndCrystals: () => 0 } });
function probe(name, run) {
  const d = mk();
  const ph = d.getPhaseManager().create(ED.PHASE_TYPES.byName[name]);
  const from = d.getNearestPathNodeIndex();
  const ref = d.findPath(from, 12 + ((from - 12 + 1) & 7), null);
  run(d, ph);
  const t = ph.pathTarget;
  ok(!!t && !!ph.path, name + ': path + pathTarget set');
  const nodes = ph.path.nodes;
  ok(ph.path.nodeIndex === 2 && t.x === nodes[1].x && t.z === nodes[1].z, name + ': pathTarget is path[1] (nodeIndex 2), got index ' + ph.path.nodeIndex);
}
probe('HoldingPattern', (d, ph) => { ph.path = null; ph.tickInRange(); });
probe('StrafePlayer', (d, ph) => ph.setTargetEntity({ x: 30, y: 70, z: 10, getX() { return 30; } }));
// anti-vacuity: break next() and the assertion must fail
const saved = ED.Path.prototype.next; let breaks = 0;
ED.Path.prototype.next = function () {};
const before = fails.length;
probe('HoldingPattern', (d, ph) => { ph.path = null; ph.tickInRange(); });
if (fails.length > before) { breaks++; fails.length = before; }
ED.Path.prototype.next = saved;
console.log(`dragonpathnextcheck: ${pass} checks, ${breaks} breaks caught`);
if (fails.length || breaks < 1) { fails.forEach(f => console.log('  x ' + f)); process.exit(1); }
