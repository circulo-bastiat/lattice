#!/usr/bin/env node
// lockstep-zombie-seed -- #7009: the zombie lane draws from the mob's own java.util.Random seeded like the server's SeedAgent, so the
// target is acquired on the server's schedule (x moves at row 21; the LCG float stream had it at 61). Real server: move row 22 (11.5518).
import { engineZombieTrace, agentSeed, ZOMBIE_KEY } from './referee/lockstep/zombielane.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const first = (R) => R.findIndex((r) => r.pos[0] !== 11.5);
const R0 = engineZombieTrace(0, { T: 40 });
ok(first(R0) >= 20 && first(R0) <= 22, 'salt 0 first move row ' + first(R0));
// the engine's own per-mob JRandom (#6445) replaced the EL.random LCG stream, so the old late start (row 61) can no longer happen; a wrong seed still moves the row
ok(first(engineZombieTrace(0, { T: 80, seedKey: 'ent|b' })) !== first(R0), 'a wrong seed key acquires on another row');
ok(agentSeed(0, ZOMBIE_KEY, 1) === agentSeed(0, ZOMBIE_KEY, 1) && agentSeed(0, ZOMBIE_KEY, 1) !== agentSeed(1, ZOMBIE_KEY, 1), 'seed depends on salt');
const rows = (o) => JSON.stringify(engineZombieTrace(0, { T: 60, ...o }).map((r) => r.pos));
caught(rows({ seedKey: 'ent|b' }) !== rows({}), 'wrong seed key');
console.log(`zombie-seed: ${bad ? 'FAILED' : 'ok'}, ${breaks} breaks caught (${bad} failures)`);
process.exit(bad ? 1 : 0);
