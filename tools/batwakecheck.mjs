#!/usr/bin/env node
// batwakecheck -- #5880: Bat's roost-wake canSee is LivingEntity.canSee: raycast(COLLIDER, FluidHandling.NONE) == MISS.
// Expected answers are computed from the vanilla collision boxes (carpet 0..1/16, fence post 0..1.5 at 6/16..10/16,
// open door leaf 3/16 thick at the hinge side), not from the engine's own shapes.
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCLITE_ROOT } from './loadsrc.mjs';
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '14b_physics.js', '14c_raycast.js'] });
M.World.init(1);
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) { const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c); }
const W = M.World, S = M.States, R = M.Ray;
let pass = 0, breaks = 0; const fails = [];
const eq = (got, want, m) => { if (got === want) pass++; else fails.push(`${m}: got ${got} want ${want}`); };
const clear = () => { for (let x = 0; x < 6; x++) for (let y = 9; y < 14; y++) for (let z = 0; z < 6; z++) W.setBlock(x, y, z, 0); };
// raw write (the save-replay path): a door leaf must not be judged by the survive gate here
const raw = (x, y, z, id) => { const ly = y - M.CFG.WORLD_MIN_Y, c = W.get(x >> 4, z >> 4); M.Section.set(c.sec[ly >> 4], ((ly & 15) << 8) | ((z & 15) << 4) | (x & 15), id); };
const st = (n) => S.stateOf(n) | 0;
const DOOR = M.Reg.realFirst[M.Reg.id.oak_door];   // door states 0 / 18 are the 3/16 leaves (x 0..3/16 / z 0..3/16), read off Physics.shapesForState
const seg = (a, b) => R.colliderHit(a[0], a[1], a[2], b[0], b[1], b[2]);

clear();
eq(seg([0.5, 10.5, 0.5], [4.5, 10.5, 0.5]), false, 'open air');
// carpet: top at y=10+1/16. Ray at y=10.03 hits it; at y=10.1 passes over.
W.setBlock(2, 9, 0, st('stone')); W.setBlock(2, 10, 0, st('white_carpet'));
eq(seg([0.5, 10.03, 0.5], [4.5, 10.03, 0.5]), true, 'ray at 0.03 hits carpet');
eq(seg([0.5, 10.10, 0.5], [4.5, 10.10, 0.5]), false, 'ray at 0.10 passes over carpet (any-shape ray would hit)');
// fence post occupies x,z 6/16..10/16, y 0..1.5: a ray at z=0.5 through the post hits; at z=0.1 it is the gap
clear(); W.setBlock(2, 10, 0, st('oak_fence'));
eq(seg([0.5, 10.5, 0.5], [4.5, 10.5, 0.5]), true, 'ray through fence post');
eq(seg([0.5, 10.5, 0.1], [4.5, 10.5, 0.1]), false, 'ray through fence gap (z=0.1)');
// 1.5 tall: ray in the cell ABOVE the fence only counts where it crosses that cell; a ray at y=11.4 over the fence cell's column
// is in cell y=11 (air) so the cell walk never tests the post -- same as vanilla BlockView.raycast
eq(seg([0.5, 11.4, 0.5], [4.5, 11.4, 0.5]), false, 'ray in the cell above the fence is not tested against the post');
// open door: facing north hinge left open -> leaf hugs a side 3/16 thick
clear(); W.setBlock(2, 9, 0, st('stone')); raw(2, 10, 0, DOOR);
// open door facing=north hinge=left -> leaf on the west (x 0..3/16): a ray along +x enters at x=2.0 and hits it; a ray along z at x=2.6 misses
eq(seg([2.6, 10.5, -0.5 + 1], [2.6, 10.5, 4.5]), false, 'ray along z beside the open leaf (x=0.6 of cell) misses');
eq(seg([2.1, 10.5, 0.5], [2.1, 10.5, 4.5]), true, 'ray along z inside the open leaf slab hits');
// closed door is the full-height 3/16 slab on the south... a ray crossing the cell centre along x hits an OPEN? no: just check closed blocks z-crossing
clear(); W.setBlock(2, 9, 2, st('stone')); raw(2, 10, 2, DOOR + 18);
eq(seg([2.5, 10.5, 0.5], [2.5, 10.5, 4.5]), true, 'door leaf on the z=0 side blocks a ray crossing it');
eq(seg([2.5, 10.5, 2.5], [2.5, 10.5, 4.5]), false, 'ray starting past the leaf (z>=2.5) misses');
// anti-vacuity: the OLD predicate (any shape) answers carpet-over as blocked; we must differ
breaks++;
clear(); W.setBlock(2, 9, 0, st('stone')); W.setBlock(2, 10, 0, st('white_carpet'));
// the old predicate: a ray that crosses a cell holding ANY collision shape is blocked
const old = !!(M.Physics.shapesForState(W.getBlock(2, 10, 0)) || []).length;
if (old) console.log('   ✓ break caught: the old any-shape predicate blocks the carpet ray the COLLIDER ray lets through');
eq(old, true, 'old any-shape predicate wrongly sees the carpet at y=0.10 (the break this check catches)');
console.log(fails.length ? fails.join('\n') : '');
console.log(` assertions passed .. ${pass}`);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
