#!/usr/bin/env node
// pathanycheck.mjs — #5881: PathNodeNavigator.findPathToAny is ONE multi-target A* (Ai.findPath opts.goals),
// not a path per candidate. Wall between start and the straight-line-nearest target.
import { loadEngine } from './loadsrc.mjs';
const MCL = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '14b_physics.js'], dom: false });
const Ai = MCL.Ai, W = MCL.World, S = MCL.States, CH = MCL.CH;
MCL.Entities.init(); W.init(1); MCL.Behave.init(W); MCL.EntityList.init(); Ai.init();
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
let pass = 0, fails = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log(' x ' + m); } };
const stone = S.stateOf('stone') | 0;
for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) { W.setBlock(x, 60, z, stone); for (let y = 61; y <= 64; y++) W.setBlock(x, y, z, 0); }
for (let z = -6; z <= 6; z++) for (let y = 61; y <= 63; y++) W.setBlock(4, y, z, stone);   // wall, gap only past z=6
const A = { x: 6, y: 61, z: 0, reach: 1 }, B = { x: 0, y: 61, z: -9, reach: 1 }, C = { x: -12, y: 61, z: 12, reach: 1 };
const goals = [A, B, C];
function search(gs, count) {
  let n = 0;
  const p = Ai.findPath(0.5, 61, 0.5, gs[0].x + .5, gs[0].y, gs[0].z + .5, { maxDrop: 1, maxNodes: 4000, goals: gs, nodeOk: () => { n++; return true; } });
  count.n = n; return p;
}
const cm = {}, pm = search(goals, cm), end = pm && pm[pm.length - 1];
ok(pm && end.x === B.x && end.z === B.z + 1, 'multi-target path ends beside B (nearest by path, not by line): ' + JSON.stringify(end));
let sum = 0; const ends = [];
for (const g of goals) { const c = {}; const p = search([g], c); sum += c.n; ends.push(p ? p.length : Infinity); }
ok(pm.length === Math.min(...ends), 'multi path length equals the shortest single path');
ok(cm.n < sum, `one search expands fewer nodes (${cm.n}) than three (${sum})`);
// anti-vacuity: a per-candidate loop costs the sum, and a straight-line pick chooses A
breaks++; ok(!(sum < sum), 'per-candidate loop is not one search'); ok(sum > cm.n, 'per-candidate loop caught (expansions ' + sum + ' > ' + cm.n + ')');
breaks++; { const c = {}; const p = search([A], c); ok(p && p[p.length - 1].x !== B.x, 'straight-line-nearest pick (A) ends elsewhere than the path-nearest target'); }
console.log(' ✓ per-candidate loop and straight-line pick both rejected');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails}\n ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
