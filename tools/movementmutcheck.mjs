#!/usr/bin/env node
// movementmutcheck.mjs - #11511: assertions for the 8 surviving mutants of src/14b_physics.js (powder-snow walkers,
// POWDER_FALL, powder top, clip axis 1 branch, clip widening, solidVehicle, clipE axis loop). Each mutant is re-applied
// and must turn the check red.
import { readFileSync } from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
let N = 0;
function run(patch) {
  const fails = [];
  const ok = (c, m) => { N++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js'], patch });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(new URL('../assets/entities.json', import.meta.url), 'utf8')) });
  M.Entities.init(); M.EntityList.init();
  const W = M.World, CH = M.CH, S = M.States, Ph = M.Physics, EL = M.EntityList;
  W.init(1);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
  const STONE = S.stateOf('stone') | 0, POW = S.stateOf('powder_snow') | 0;
  const mk = (type, x, y, z, extra) => { const d = M.Entities.dimensions(type); return Object.assign({ type, x, y, z, vx: 0, vy: 0, vz: 0, onGround: false, width: d.width, height: d.height }, extra || {}); };

  // powder_snow_walkable_mobs
  for (const t of ['rabbit', 'endermite', 'silverfish', 'fox']) ok(Ph.canWalkOnPowderSnow({ type: t }) === true, t + ' walks on powder snow');
  ok(!Ph.canWalkOnPowderSnow({ type: 'zombie' }), 'zombie does not');

  // powder snow at y=8 over stone at y=7 (top of powder = 9)
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, 7, z, STONE);
  W.setBlock(0, 8, 0, POW);
  const drop = (e, dy) => { Ph.move(e, 0, dy, 0); return e.y; };
  let y = drop(mk('rabbit', 0.5, 9.5, 0.5, { fallDistance: 0 }), -1);
  ok(Math.abs(y - 9) < 1e-4, 'rabbit stands on powder snow top (y=' + y + ')');
  y = drop(mk('zombie', 0.5, 9.5, 0.5, { fallDistance: 0 }), -1);
  ok(y < 8.6, 'zombie sinks into powder snow (y=' + y + ')');
  y = drop(mk('zombie', 0.5, 9.5, 0.5, { fallDistance: 3 }), -1);
  ok(Math.abs(y - 8.9) < 1e-4, 'a long-falling entity lands on the 0.9 high powder (y=' + y + ')');

  // clip axis 1 (Y): a single stone block at z=5 only, player at z=5.5
  W.setBlock(5, 7, 5, STONE);
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) if (!(x === 5 && z === 5)) W.setBlock(x, 7, z, 0);
  const p = mk('player', 5.5, 9, 5.5);
  y = drop(p, -1.5);
  ok(Math.abs(y - 8) < 1e-4 && p.onGround, 'player lands on a single block (y=' + y + ')');

  // clip widening: the lowest p row queried is exactly one cell below the box (x axis sweep, box in cell y=20)
  {
    const seen = []; const o = Ph.shapeAt;
    Ph.shapeAt = function (x, yy, z) { seen.push([x, yy, z]); return null; };
    Ph.move(mk('player', 0.5, 20, 0.5), 0.1, 0, 0);
    Ph.shapeAt = o;
    const xs = seen.map(c => c[0]), ys = seen.map(c => c[1]);
    ok(seen.length > 0 && Math.min(...ys) === 19, 'widening is exactly one cell (min y ' + Math.min(...ys) + ')');
    // Z-axis rows: collect min of z cells for an x sweep
    const zs = seen.map(c => c[2]);
    ok(Math.min(...zs) === -1, 'z widening exactly one cell (min z ' + Math.min(...zs) + ')');
    // axis 1 sweep: p is x
    seen.length = 0;
    Ph.shapeAt = function (x, yy, z) { seen.push([x, yy, z]); return null; };
    Ph.move(mk('player', 0.5, 20, 0.5), 0, -0.1, 0);
    Ph.shapeAt = o;
    ok(Math.min(...seen.map(c => c[0])) === -1, 'x widening on a Y sweep exactly one cell (min x ' + Math.min(...seen.map(c => c[0])) + ')');
  }

  // solidVehicle
  ok(Ph.solidVehicle({ type: 'boat' }) === true && Ph.solidVehicle({ type: 'minecart' }) === true && Ph.solidVehicle({ type: 'chest_minecart' }) === true, 'boat/minecarts are solid');
  ok(!Ph.solidVehicle({ type: 'zombie' }), 'zombie is not a solid vehicle');
  ok(!Ph.solidVehicle({ type: 'boat', dead: true }) && !Ph.solidVehicle({ type: 'boat', removed: true }), 'dead/removed boat is not solid');
  ok(!Ph.solidVehicle({ type: 'zombie', dead: true, removed: false }) && !Ph.solidVehicle({ type: 'zombie', dead: false, removed: true }), 'dead/removed zombie not solid');

  // clipE: a cart 4 blocks away in x must not stop a player falling past it (axis 0 overlap test)
  EL.list = [{ type: 'minecart', x: 0.5, y: 9, z: 5.5, dead: false, removed: false }];
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, 8, z, STONE);
  const q = mk('player', 4.5, 12, 5.5);
  y = drop(q, -3);
  ok(Math.abs(y - 9) < 1e-4, 'a cart 4 blocks off in x does not stop the player (y=' + y + ')');
  const q2 = mk('player', 0.5, 12, 5.5);
  y = drop(q2, -3);
  ok(y > 9.4, 'a cart directly below does stop the player (y=' + y + ')');
  EL.list = [];
  return fails;
}

const base = run(), NB = N;
let breaks = 0, bad = false;
if (base.length) { console.log('FAIL'); for (const f of base) console.log('  - ' + f); bad = true; }
const F = '14b_physics.js';
const MUT = [
  ["e.type === 'rabbit' || e.type === 'endermite'", "e.type === 'rabbit' && e.type === 'endermite'"],
  ['return POWDER_FALL;', 'return !POWDER_FALL;'],
  ['if (Ph.canWalkOnPowderSnow(e) && e.y', 'if (!Ph.canWalkOnPowderSnow(e) && e.y'],
  ['else if (axis === 1) { p0 =', 'else if (axis === 2) { p0 ='],
  ['p0 -= 1; p1 += 1;', 'p0 -= 2; p1 += 1;'],
  ['return !o.dead && !o.removed && (o.type', 'return !o.dead || !o.removed && (o.type'],
  ["indexOf('minecart') >= 0", "indexOf('minecart') >= 1"],
  ['for (var a = 0; a < 3; a++) {', 'for (var a = 1; a < 3; a++) {'],
];
for (const [from, to] of MUT) {
  let saw = false;
  const patch = (name, s) => { if (name !== F) return s; if (s.includes(from)) saw = true; return s.replace(from, to); };
  let fl; try { fl = run(patch); } catch (x) { fl = ['threw']; }
  if (!saw) { console.log('FAIL mutant text not found: ' + from); bad = true; continue; }
  if (fl.length) { breaks++; console.log('   ✓ mutant caught: ' + from.slice(0, 60)); } else { console.log('FAIL not caught: ' + from); bad = true; }
}
console.log(`movementmutcheck: ${NB} assertions, ${bad ? 1 : 0} failed, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
