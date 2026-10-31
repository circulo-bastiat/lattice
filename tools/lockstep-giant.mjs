#!/usr/bin/env node
// lockstep-giant -- #5458 (G17-L4): 20 salts of the giant chasescen lane, engine trace via lockstep/zombielane.mjs. Fields per tick:
// pos, yaw, pitch, target, cooldown (none for a passive wander.
// Exit 1 on the first divergence (tick+field+both values) between two engine runs of a salt; server rep0 comparison is lockstep/pilot.mjs
// --lanes giant (#5095 found the server not always repeatable per salt - then the distribution test applies, naming the dimension).
import { engineZombieTrace } from './referee/lockstep/zombielane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let divs = 0, bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const F = ['pos', 'yaw', 'pitch', 'headYaw', 'onGround'];
const run = (s) => engineZombieTrace(s, { mob: 'giant' });
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map(run);
// giant has no goals (vanilla Giant registers none): it never moves horizontally, whatever the salt
ok(traces.every((R) => R.every((r) => r.pos[0] === R[0].pos[0] && r.pos[2] === R[0].pos[2])), 'a giant moved (it has no goals)');
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  const d = compareTraces(R, run(i), { fields: F });
  if (d) { console.log(`DIVERGE salt ${i} tick ${d.tick} ${d.field}: ${JSON.stringify(d.a ?? d.engine)} vs ${JSON.stringify(d.b ?? d.server)}`); bad++; divs++; }
});
const mutAll = (fn) => traces[0].map((r, t) => (t >= 40 ? fn(r, t) : r));
const mut = (f, fn) => traces[0].map((r, t) => (t === 77 ? { ...r, [f]: fn(r[f]) } : r));
caught(compareTraces(traces[0], mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]]), { fields: F })?.tick === 77, 'pos 1e-9');
caught(compareTraces(traces[0], mut('yaw', (y) => y + 1e-9), { fields: F })?.field === 'yaw', 'yaw 1e-9');
caught(compareTraces(traces[0], mutAll((r) => ({ ...r, pos: [r.pos[0] * 1.0000001, r.pos[1], r.pos[2]] })), { fields: F })?.field === 'pos', 'wrong attribute (speed scale)');
caught(compareTraces(traces[0], traces[0].map((r, t) => traces[0][Math.max(0, t - 1)]), { fields: F }) !== null, 'goal tick off by one');
caught(compareTraces(traces[0], mut('onGround', (g) => !g), { fields: F }) !== null, 'onGround flipped');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
console.log(`giant: ${SALTS.length}/${SALTS.length} seeds, ${divs} divergences; ${bad} failures, ${breaks} breaks caught (${SALTS.length} salts x ${T} ticks)`);
process.exit(bad ? 1 : 0);
