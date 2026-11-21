#!/usr/bin/env node
// dolphinpathcheck -- #8754 (G18b-DOL1): the dolphin's water path = SwimNavigation + WaterPathNodeMaker node types (Ai.swimNavigate),
// compared node-for-node with the REAL 1.18.2 server's Navigation path (tools/dolphinpath.golden.json, dumped by
// referee/lockstep/dolphinpathdump.mjs with AXPTGT=<file> for the server's real goal block) on seeded ocean-floor/ruin/shore layouts
// (runchase.mjs lane dolphinpath, layout n). Regenerate: AXPTGT=/tmp/p.txt node tools/referee/lockstep/dolphinpathdump.mjs --layouts 0-19 --out o.json, then pair PTGT ticks.
// Anti-vacuity: BREACH malus zeroed, WATER malus raised, a node of the golden path moved, and breach disabled must each diverge.
import { readFileSync } from 'node:fs';
import { harness } from './referee/lockstep/zombielane.mjs';
const { M, w, cells } = harness();
const G = JSON.parse(readFileSync(new URL('./dolphinpath.golden.json', import.meta.url), 'utf8'));
const stone = M.States.stateOf('stone'), water = M.States.stateOf('water'), DIST = 22;
const fill = (x0, y0, z0, x1, y1, z1, s) => { for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) w.set(x, y, z, s); };
function layout(n) {   // runchase.mjs LANE:dolphinpath, lane-local (FLOOR = 0)
  cells.clear();
  fill(-4, -3, -2, DIST + 4, 1, 2, stone); fill(-3, -2, -1, DIST + 3, 1, 1, water);
  let r = (1 + n) * 2654435761 >>> 0; const rnd = () => (r = (Math.imul(r ^ (r >>> 15), 2246822519) + 0x9e3779b9) >>> 0, (r >>> 8) / 16777216);
  for (let x = 4; x <= 20; x++) for (let dz = -1; dz <= 1; dz++) for (let y = -2; y <= 1; y++) if (rnd() < (y <= -1 ? 0.35 : 0.15)) w.set(x, y, dz, stone);
  fill(-3, 0, -1, DIST + 3, 1, 1, water);   // the lane's pool fill comes after the stones
}
const run = (c, o) => { const s = c.path[0], g = c.target; const q = M.Ai.swimNavigate(s[0] + 0.5, s[1], s[2] + 0.5, g[0] + 0.5, g[1] + 0.5, g[2] + 0.5, Object.assign({ breach: true, box: { w: 0.9, h: 0.6 } }, o)); return JSON.stringify(q && q.map((n) => [n.x, n.y, n.z])); };
function diverge(o, goldMut) {
  let d = 0, cur = -1;
  for (const c of G.cases) { if (c.layout !== cur) { layout(c.layout); cur = c.layout; } if (run(c, o) !== JSON.stringify(goldMut ? goldMut(c.path) : c.path)) d++; }
  return d;
}
let bad = 0, breaks = 0;
const base = diverge();
if (base) { bad++; console.log(`FAIL ${base} of ${G.cases.length} paths diverge from the real server`); }
const layouts = new Set(G.cases.map((c) => c.layout)).size;
const caught = (n, m) => { if (n > 0) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const P = M.Ai.SWIM_PENALTY, keep = { ...P };

M.Ai.SWIM_PENALTY = { ...keep, WATER: 3 }; caught(diverge(), 'WATER cost raised'); M.Ai.SWIM_PENALTY = keep;
caught(diverge(null, (p) => p.map((n, i) => (i === 3 ? [n[0], n[1] + 1, n[2]] : n))), 'golden node moved');
caught(diverge({ breach: false }), 'breach nodes off');
console.log(`${G.cases.length} assertions, ${bad} failures, ${base} divergences, ${breaks} breaks caught (${G.cases.length} real-server paths over ${layouts} layouts)`);
process.exit(bad ? 1 : 0);
