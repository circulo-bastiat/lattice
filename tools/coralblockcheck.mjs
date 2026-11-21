#!/usr/bin/env node
// coralblockcheck.mjs — #11521: CoralBlock (07zv_coralblock.js): a live coral plant out of water dies after 60..99 ticks.
import { loadEngine } from './loadsrc.mjs';
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const M = loadEngine({ extra: ['07_world.js', '07b_behaviour.js', '07zv_coralblock.js'] });
const W = M.World, CH = M.CH, S = M.States;
M.Behave.init(W); W.init(1);
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const X = 4, Y = 70, Z = 4;
const run = (n) => { for (let i = 0; i < n; i++) M.Behave.tick(); };
const dry = S.withLocal('tube_coral', 1);           // waterlogged=false
const deadDry = S.withLocal('dead_tube_coral', 1);
ok(!!M.CoralBlock && M.CoralBlock.isCoral(dry), 'CoralBlock sees tube_coral');
W.setBlock(X, Y - 1, Z, S.stateOf('stone'));
W.setBlock(X, Y, Z, dry);
ok(M.Behave.isQueued(X, Y, Z), 'dry coral schedules its tick on placement');
run(59); ok(W.getBlock(X, Y, Z) === dry, 'still alive before 60 ticks');
run(41); okAv(W.getBlock(X, Y, Z) === deadDry, 'dry coral is dead_tube_coral by 100 ticks');
// waterlogged survives
W.setBlock(X + 3, Y - 1, Z, S.stateOf('stone'));
W.setBlock(X + 3, Y, Z, S.stateOf('tube_coral'));
run(120); okAv(W.getBlock(X + 3, Y, Z) === S.stateOf('tube_coral'), 'waterlogged coral survives');
// adjacent water saves a dry one
W.setBlock(X, Y - 1, Z + 3, S.stateOf('stone'));
W.setBlock(X + 1, Y, Z + 3, S.stateOf('water'));
W.setBlock(X, Y, Z + 3, dry);
run(120); okAv(W.getBlock(X, Y, Z + 3) === dry, 'coral next to water survives');
// water removed -> neighbour update schedules death
W.setBlock(X + 1, Y, Z + 3, 0);
run(120); okAv(W.getBlock(X, Y, Z + 3) === deadDry, 'coral dies after its water is removed');
if (fails.length) { console.log(fails.join('\n')); console.log('FAIL'); process.exit(1); }
console.log(pass + " checks passed, " + breaks + " anti-vacuity breaks caught, " + fails.length + " failed");
