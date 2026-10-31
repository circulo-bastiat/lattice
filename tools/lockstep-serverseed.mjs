#!/usr/bin/env node
// lockstep-serverseed -- #6964: the engine blaze lane seeds its entity Random exactly as SeedAgent seeds the server's nth summoned
// BlazeEntity (tools/referee/lockstep/serverseed.mjs). Pinned from a real-server run (salt 0, blaze lane): the server blaze starts to rise at
// tick 4 with pos.y 0.2884 (BlazeEntity.mobTick vy += (0.3-vy)*0.3, i.e. eyeOffset < the player's eye gap). With the old LCG stream the engine
// drew eyeOffset 6.9 and never rose; with the server seed it rises to 0.28842 at tick 4. Breaks: wrong class key, wrong salt, no seed.
import { serverEntitySeed, javaHash } from './referee/lockstep/serverseed.mjs';
import { engineBlazeTrace } from './referee/lockstep/blazelane.mjs';
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
let bad = 0, breaks = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { n++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
ok(javaHash('abc') === 96354 && javaHash('') === 0, 'String.hashCode');
ok(serverEntitySeed(0, 'bln') !== serverEntitySeed(1, 'bln') && serverEntitySeed(0, 'bln') !== serverEntitySeed(0, 'bln', 2), 'seed depends on salt and n');
const y4 = (rows) => rows[3].pos[1];
const good = y4(engineBlazeTrace(0).rows);
ok(Math.abs(good - 0.2884) < 5e-4, `salt 0 engine row 3 (server row 4: the server's log starts one row later) pos.y ${good} vs server 0.2884`);
caught(Math.abs(y4(engineZombieTrace(0, { mob: 'blaze', uuidSteps: true, serverSeed: 'xxx', T: 6 })) - 0.2884) > 5e-4, 'wrong class key');
caught(Math.abs(y4(engineZombieTrace(0, { mob: 'blaze', T: 6 })) - 0.2884) > 5e-4, 'no server seed (LCG stream)');
caught(Math.abs(y4(engineZombieTrace(5, { mob: 'blaze', uuidSteps: true, serverSeed: 'bln', T: 6 })) - 0.2884) > 5e-4, 'wrong salt');
console.log(`${n} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
