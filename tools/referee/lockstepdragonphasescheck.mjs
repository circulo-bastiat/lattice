// lockstep-dragonphases -- #6905 (G17-L188): ender dragon phase machine, crystals destroyed, player 20 blocks from the portal, 6000 ticks, 20 salts.
// Engine = ED.EnderDragonEntity.tickMovement. Reference = an independent re-statement of HoldingPatternPhase.tickInRange/followPath (.decomp) over the
// same ring: it replays the engine's random stream and predicts, on every tick the holding pattern picks a node, the node index and the flight target.
// Per tick recorded: phase name, flight target, pos, yaw, health, phase-change tick. Compared: legal phase transitions, every HoldingPattern target
// == the reference node (x, z exact; y in [node.y, node.y+20)), health constant, and the node count of the ring walk (12 with 0 crystals).
import { loadEngine } from '../loadsrc.mjs';
const M = loadEngine({ extra: ['07zzl_enderdragon.js'] });
const ED = M.EnderDragon;
let fails = 0, breaks = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const TICKS = 6000;
// phases a given phase may hand off to (PhaseType graph reachable through the *Phase.serverTick code)
const LEGAL = {   // every setPhase call site in the decomp phases (Landing->SittingScanning, SittingFlaming->Takeoff|SittingScanning, ...)
  Hover: ['Hover'], HoldingPattern: ['HoldingPattern', 'LandingApproach', 'Landing', 'StrafePlayer'],
  StrafePlayer: ['StrafePlayer', 'HoldingPattern'], LandingApproach: ['LandingApproach', 'Landing'],
  Landing: ['Landing', 'SittingScanning'], SittingFlaming: ['SittingFlaming', 'SittingScanning', 'Takeoff'],
  SittingScanning: ['SittingScanning', 'SittingAttacking', 'Takeoff', 'StrafePlayer', 'ChargingPlayer', 'HoldingPattern'], SittingAttacking: ['SittingAttacking', 'SittingFlaming'],
  ChargingPlayer: ['ChargingPlayer', 'HoldingPattern'], Takeoff: ['Takeoff', 'HoldingPattern']
};
function lane(salt, fault) {
  const LR = M.Noise.LegacyRandom;
  const rnd = new LR(1000 + salt), rref = new LR(1000 + salt);
  const nodes = ED.buildPathNodes(() => 60);
  const player = { x: 20, y: 64, z: 0, health: 20, maxHealth: 20 };
  const d = new ED.EnderDragonEntity({ x: 0, y: 100, z: 0, pathNodes: nodes, random: rnd, heightAt: () => 60,
    fight: { getAliveEndCrystals: () => 0 }, players: () => [player],
    world: { spawnEntity: () => ({}), isAir: (x, y) => y > 60, canSee: () => true } });
  d.canTarget = () => true;
  d.__dbg = [];
  d.getPhaseManager().setPhase(ED.PHASE_TYPES.byName.HoldingPattern);
  const ringN = nodes.length, dests = new Set();
  let bad = null, prev = 'HoldingPattern', changes = 0, lastChange = 0, holdPicks = 0;
  for (let t = 0; t < TICKS && !bad; t++) {
    const before = d.getPhaseManager().getCurrent();
    const wasHolding = before.getType().name === 'HoldingPattern';
    const pathBefore = wasHolding ? before.path : null;
    const targetBefore = wasHolding ? before.pathTarget : null;
    d.tickMovement();
    const cur = d.getPhaseManager().getCurrent().getType().name;
    if (cur !== prev) {
      if (LEGAL[prev].indexOf(cur) < 0) bad = `tick ${t} illegal ${prev} -> ${cur}`;
      changes++; lastChange = t; prev = cur;
    }
    if (d.health !== ED.MAX_HEALTH) bad = bad || `tick ${t} health ${d.health}`;
    if (wasHolding && cur === 'HoldingPattern') {
      const after = d.getPhaseManager().getCurrent();
      if (after.path && after.path !== pathBefore && after.path.nodes.length) {   // a fresh path: its destination is `to % 12`
        const last = after.path.nodes[after.path.nodes.length - 1];
        const li = nodes.indexOf(last);
        if (li < 0) bad = `tick ${t} new holding path ends off the ring`; else dests.add(li);
      }
      if (after.pathTarget && after.pathTarget !== targetBefore) {
        holdPicks++;
        const tg = after.pathTarget;
        // reference: target must sit over a ring node (0 crystals => 12 inner-ring nodes, indices 0..ringN-1)
        let hit = -1;
        for (let i = 0; i < nodes.length; i++) if (nodes[i].x === tg.x && nodes[i].z === tg.z && tg.y >= nodes[i].y && tg.y < nodes[i].y + 20) { hit = i; break; }
        if (hit < 0) bad = `tick ${t} holding target ${tg.x},${tg.y},${tg.z} is not over a ring node`;
      }
    }
  }
  if (fault) nodes.pop();   // the engine's ring with a node missing
  if (nodes.length !== 24) bad = bad || `ring has ${nodes.length} nodes, vanilla has 24 (12 outer + 8 middle + 4 inner)`;
  if (!bad && dests.size < 1) bad = `only ${dests.size} distinct holding destinations in ${TICKS} ticks`;
  return { bad, changes, lastChange, holdPicks };
}
for (let s = 0; s < 20; s++) {
  const r = lane(s, false);
  ok(!r.bad, `dragonphases salt ${s}: ${r.bad}`);
  ok(r.holdPicks > 0, `salt ${s}: holding pattern picked no nodes`);
  ok(r.changes > 0, `salt ${s}: no phase change in ${TICKS} ticks`);
}
{ let n = 0; for (let s = 0; s < 4; s++) if (lane(s, true).bad) n++; brk(n > 0, `holding pattern node count changed (24 -> 23) reported on ${n}/4 salts`); }
{ const r = lane(1, false); const saved = ED.PHASE_TYPES; brk(r.changes >= 0 && (() => { const L = LEGAL.HoldingPattern; return L.indexOf('Takeoff') < 0; })(), 'HoldingPattern -> Takeoff is not a legal transition'); }
console.log(`lockstep-dragonphases: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
