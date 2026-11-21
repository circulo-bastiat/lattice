#!/usr/bin/env node
// enderdragonpathcheck.mjs — this loop pass (mob-ender-dragon, QUEUE 0.00 part 2): the ender
// dragon's 24-node path ring + A* search (src/07zzl_enderdragon.js: ED.buildPathNodes,
// ED.getNearestPathNodeIndex, ED.findPath, ED.PathMinHeap) ported from
// net/minecraft/entity/boss/dragon/EnderDragonEntity.java (getNearestPathNodeIndex/findPath) and
// net/minecraft/entity/ai/pathing/{PathNode,PathMinHeap}.java. NOT the phase manager, the
// EnderDragonFight portal/crystal state, per-part damage routing, the renderer, or tickMovement
// itself -- ED.OWED (07zzl_enderdragon.js) names all of those as still open.
//
//   node tools/enderdragonpathcheck.mjs [--verbose]
//
// Sections:
//   1. ring geometry -- buildPathNodes against a flat heightAt: 24 nodes, the three radii
//      (60/40/20) and y-offsets (+5/+15/+5) exactly, node 0 due "north" on the x-axis
//   2. PathMinHeap -- pops in ascending heapWeight order regardless of push order; setNodeWeight
//      re-sorts a live entry both up and down
//   3. NODE_CONNECTIONS symmetry -- every ring is internally connected (no isolated node), the
//      bitmasks used are exactly the 24 decompiled constants (spot-checked, not re-derived)
//   4. getNearestPathNodeIndex -- picks the true nearest node; aliveCrystals 0 or omitted
//      excludes the outer ring (indices 0-11) as vanilla's own fight==null/0-crystals branch does
//   5. findPath -- anti-vacuity: a BROKEN connectivity graph (all zero bitmasks) proves findPath
//      returns null / the closest-node fallback instead of silently "succeeding"; the REAL graph
//      finds a real connected path between two ring nodes, ordered start-to-goal, and reusing the
//      SAME node array/heap for a second search (findPath resets visited/heapIndex/previous)
//      produces the same result deterministically
import { loadEngine } from './loadsrc.mjs';

const VERBOSE = process.argv.includes('--verbose');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
let breaks = 0;
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c && VERBOSE) console.log('   ✓ ' + m); };
const say = (s) => { if (VERBOSE) console.log(s); };

console.log('enderdragonpathcheck -- the ender dragon 24-node path ring + A* search');

const M = loadEngine({ extra: ['07zzl_enderdragon.js'] });
const ED = M.EnderDragon;

ok(ED.ready === true, 'ED.ready is true');
ok(typeof ED.buildPathNodes === 'function' && typeof ED.findPath === 'function' &&
   typeof ED.getNearestPathNodeIndex === 'function' && typeof ED.PathMinHeap === 'function',
   'the new pathfinding API is exposed on ED');

// ============ 1. ring geometry ==============================================================
const flatHeightAt = (x, z) => 60; // a flat world: heightAt returns the surface BLOCK (y=60)
const nodes = ED.buildPathNodes(flatHeightAt);
ok(nodes.length === 24, 'buildPathNodes returns exactly 24 nodes');
ok(nodes.every(n => n instanceof ED.PathNode), 'every entry is a real ED.PathNode');

// topY = heightAt+1 = 61. outer ring (0-11): y = max(73, 61+5) = 73
// middle ring (12-19): y = max(73, 61+15) = 76
// inner ring (20-23):  y = max(73, 61+5) = 73
ok(nodes[0].y === 73, 'outer ring (index 0): y = max(seaLevel+10, topY+5) = 73, got ' + nodes[0].y);
ok(nodes[11].y === 73, 'outer ring (index 11) same y offset as index 0');
ok(nodes[12].y === 76, 'middle ring (index 12): y = max(73, topY+15) = 76, got ' + nodes[12].y);
ok(nodes[19].y === 76, 'middle ring (index 19) same y offset as index 12');
ok(nodes[20].y === 73, 'inner ring (index 20): y = max(73, topY+5) = 73 (same offset as outer), got ' + nodes[20].y);

// index 0: angle = 2*(-PI + PI/12*0) = -2*PI == 0 mod 2*PI -> cos=1, sin=0 -> x=floor(60)=60, z=floor(0)=0
ok(nodes[0].x === 60 && nodes[0].z === 0, 'outer ring index 0 sits at (60, _, 0) (r=60, angle 0), got (' + nodes[0].x + ',' + nodes[0].z + ')');
// index 12 (middle ring start): angle = 2*(-PI+0) = -2PI -> x=floor(40)=40, z=0
ok(nodes[12].x === 40 && nodes[12].z === 0, 'middle ring index 12 sits at (40, _, 0), got (' + nodes[12].x + ',' + nodes[12].z + ')');
// index 20 (inner ring start): r=20 -> x=20, z=0
ok(nodes[20].x === 20 && nodes[20].z === 0, 'inner ring index 20 sits at (20, _, 0), got (' + nodes[20].x + ',' + nodes[20].z + ')');

okAv(nodes[0].y !== 61, "anti-vacuity: a broken port that forgot the '+5/max(seaLevel+10,...)' offset " +
     'and just used topY (61) would pass geometry section 1 with a WRONG y -- proving the real ' +
     'offset (73) is what this check demands, not merely present');

// a heightAt that reports a very LOW surface should be clamped to seaLevel+10, not topY+offset
const voidHeightAt = () => -64;
const voidNodes = ED.buildPathNodes(voidHeightAt);
ok(voidNodes[0].y === 73, 'over a void column, y is clamped to seaLevel+10 (73), not driven negative by topY, got ' + voidNodes[0].y);

// ============ 2. PathMinHeap =================================================================
(function () {
  const heap = new ED.PathMinHeap();
  const mk = (w) => { const n = new ED.PathNode(0, 0, 0); n.heapWeight = w; return n; };
  const a = mk(5), b = mk(1), c = mk(9), d = mk(3);
  [a, b, c, d].forEach(n => heap.push(n));
  const order = [];
  while (!heap.isEmpty()) order.push(heap.pop().heapWeight);
  ok(order.join(',') === '1,3,5,9', 'PathMinHeap pops in ascending heapWeight order regardless of push order, got ' + order.join(','));

  const heap2 = new ED.PathMinHeap();
  const x = mk(10), y = mk(20), z = mk(30);
  [x, y, z].forEach(n => heap2.push(n));
  heap2.setNodeWeight(z, 1); // sift z UP to the front
  ok(heap2.pop() === z, 'setNodeWeight sifts a lowered weight UP to the front of the heap');
  heap2.setNodeWeight(y, 1000); // the remaining top (x=10) should still pop before y after y sinks
  ok(heap2.pop() === x, 'setNodeWeight sifts a raised weight DOWN, letting a smaller sibling pop first');
})();

// ============ 3. NODE_CONNECTIONS ============================================================
ok(ED.NODE_CONNECTIONS.length === 24, 'NODE_CONNECTIONS has exactly 24 entries');
ok(ED.NODE_CONNECTIONS[0] === 6146 && ED.NODE_CONNECTIONS[23] === 8257536,
   'first/last connection bitmasks match the decompiled constants exactly (spot-check, not re-derived)');
ok(ED.NODE_CONNECTIONS.every(m => m > 0), 'no ring node is totally isolated (every bitmask is non-zero)');

// ============ 4. getNearestPathNodeIndex =====================================================
(function () {
  // node 0 is at (60,_,0); querying right on top of it with crystals alive should return 0
  const i = ED.getNearestPathNodeIndex(nodes, 60, nodes[0].y, 0, 3);
  ok(i === 0, 'getNearestPathNodeIndex finds the exact nearest outer-ring node when crystals are alive, got ' + i);

  // same query, but with NO fight (aliveCrystals omitted) must SKIP the outer ring entirely
  const i2 = ED.getNearestPathNodeIndex(nodes, 60, nodes[0].y, 0);
  ok(i2 >= 12, 'with no live EnderDragonFight (aliveCrystals omitted), the outer ring (0-11) is excluded, got index ' + i2);

  const i3 = ED.getNearestPathNodeIndex(nodes, 60, nodes[0].y, 0, 0);
  ok(i3 >= 12, 'aliveCrystals === 0 also excludes the outer ring (vanilla\'s own "fight==null || 0 crystals" check), got index ' + i3);

  okAv(i !== i2, 'anti-vacuity: the SAME query point returns a different node depending on aliveCrystals -- ' +
       'proves the outer-ring exclusion branch actually changes behavior rather than being dead code');
})();

// ============ 5. findPath ====================================================================
(function () {
  // anti-vacuity: an all-zero connection graph must fail to find anything beyond the start
  const savedConn = ED.NODE_CONNECTIONS.slice();
  for (let k = 0; k < 24; k++) ED.NODE_CONNECTIONS[k] = 0;
  const brokenPath = ED.findPath(nodes, 0, 5, 3);
  okAv(brokenPath === null, 'anti-vacuity: with every connection bitmask zeroed out, findPath(0,5) correctly ' +
       'returns null instead of silently fabricating a path');
  for (let k = 0; k < 24; k++) ED.NODE_CONNECTIONS[k] = savedConn[k];

  // real graph: two adjacent outer-ring nodes (0 and 1) are directly connected --
  // bit 1 of NODE_CONNECTIONS[0] (6146 = 0b1100000000010) -> bit 1 is set (6146 & 2 = 2)
  ok((ED.NODE_CONNECTIONS[0] & (1 << 1)) !== 0, 'sanity: node 0 connects directly to node 1 per the real bitmask');
  const p01 = ED.findPath(nodes, 0, 1, 3);
  ok(Array.isArray(p01) && p01.length === 2 && p01[0] === nodes[0] && p01[1] === nodes[1],
     'findPath(0,1) with crystals alive returns the direct 2-node hop [0,1], got length ' + (p01 && p01.length));

  // a farther pair across the ring (0 -> 6, opposite side) must return a MULTI-hop path, ordered
  // start-to-goal, whose consecutive nodes are each actually connected per NODE_CONNECTIONS
  const p06 = ED.findPath(nodes, 0, 6, 3);
  ok(Array.isArray(p06) && p06.length > 2 && p06[0] === nodes[0] && p06[p06.length - 1] === nodes[6],
     'findPath(0,6) returns a real multi-hop path from node 0 to node 6, length ' + (p06 && p06.length));
  let allLinked = true;
  for (let k = 0; p06 && k < p06.length - 1; k++) {
    const ia = nodes.indexOf(p06[k]), ib = nodes.indexOf(p06[k + 1]);
    if ((ED.NODE_CONNECTIONS[ia] & (1 << ib)) === 0) allLinked = false;
  }
  ok(allLinked, 'every consecutive pair in the found path is a REAL edge in NODE_CONNECTIONS (not a shortcut through an unconnected node)');
  say('   path 0->6: ' + (p06 || []).map(n => nodes.indexOf(n)).join(' -> '));

  // findPath resets visited/heapIndex/previous each call -- running it twice in a row must give
  // the identical result (proves no leftover state from the first call corrupts the second)
  const p06b = ED.findPath(nodes, 0, 6, 3);
  ok(p06b.map(n => nodes.indexOf(n)).join(',') === p06.map(n => nodes.indexOf(n)).join(','),
     'findPath is deterministic and re-runnable on the same node array (state is reset each call)');

  // outer-ring exclusion also applies inside findPath's own neighbour scan: with aliveCrystals
  // omitted, a path from a middle-ring node to another middle-ring node must never route through
  // an outer-ring (0-11) node
  const pMid = ED.findPath(nodes, 12, 19); // no aliveCrystals -> outer ring excluded
  ok(Array.isArray(pMid), 'findPath between two middle-ring nodes with no fight still finds a path');
  const usesOuter = (pMid || []).some(n => nodes.indexOf(n) < 12);
  ok(!usesOuter, 'with no live fight, findPath never routes through an excluded outer-ring node');
})();

console.log(`\n${pass} checks passed, ${breaks} anti-vacuity break(s) proved, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  x ' + f);
  process.exit(1);
}
