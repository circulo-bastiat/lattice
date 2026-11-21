#!/usr/bin/env node
// soakcapturecheck -- #9446 (G17-L38a): the offline half of the real-server soak capture: the scripted /summon list, ENTX -> per-mob split, and the a == b comparator.
// The server run itself is `node tools/referee/lockstep/soakcapture.mjs` (two fresh JVM runs, ~10 min: lane:soak, not a suite stage). Anti-vacuity: each broken capture must be caught.
import { SOAK_MOBS, SOAK_TICKS } from './lockstep/soak.mjs';
import { soakSummons, soakPack, splitEntx, sameCapture, BASES, landProbes } from './lockstep/soakcapture.mjs';
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const ys = SOAK_MOBS.map((_, i) => 60 + i), S = soakSummons(ys, [64, -64]);
ok(SOAK_TICKS === 3000, '3000 ticks');
ok(S.length === 12 && new Set(SOAK_MOBS.map((m) => m.id)).size === 10, '12 mobs of 10 kinds');
S.forEach((c, i) => ok(c === `summon minecraft:${SOAK_MOBS[i].id} ${64 + SOAK_MOBS[i].x + 0.5} ${60 + i} ${-64 + SOAK_MOBS[i].z + 0.5} {Tags:["soak${i}"],PersistenceRequired:1b}`, 'summon ' + i));
ok(soakPack(ys).spawn.filter((l) => l.startsWith('summon ')).length === 12 && soakPack(ys).spawn.some((l) => /#run mc 1/.test(l)), 'spawn function: 12 summons then run');
ok(!S.some((c) => /positioned over/.test(c)), 'no 1.19 syntax');
ok(BASES[0].join() === '-448,448' && BASES[1].join() === '0,0' && new Set(BASES.map((b) => b.join())).size === BASES.length, 'land bases unique, pinned base then origin first');
// synthetic server log: 12 mobs (ids 100..111, first tick 1), a baby (id 200, first tick 7), a straggler zombie id 5 first seen at tick 900; 40 ticks
const lines = [], T = 40;
for (let t = 1; t <= T; t++) {
  for (let i = 0; i < 12; i++) lines.push(`ENTX ${t} minecraft:${SOAK_MOBS[i].id} ${100 + i} ${i === 0 && t > 20 ? 3000 - t : -1} ${i === 1 ? '18:0:' + (999 - t) : '-'}`);
  if (t >= 7) lines.push(`ENTX ${t} minecraft:cow 200 -1 -`);
}
lines.push('ENTX 900 minecraft:zombie 5 -1 -');
const text = lines.join('\n'), A = splitEntx(text, T);
ok(A.mobs.length === 12 && A.mobs.every((m) => m.length === T), 'twelve mobs, 40 rows each');
ok(A.ids.join() === Array.from({ length: 12 }, (_, i) => 100 + i).join(), 'ids in summon order');
ok(A.extra === T - 6, 'baby counted as extra, straggler cut by the tick bound: ' + A.extra);
ok(A.mobs[0][25].entities[0][2] === 2974 && A.mobs[1][0].entities[0][3][0].join() === '18,0,998', 'conv and effects parsed');
ok(A.mobs[3][0].entities[0][0] === 'wolf', 'mob 3 is the wolf');
ok(sameCapture(A, splitEntx(text, T)), 'a == b for an identical log');
ok(sameCapture(A, splitEntx(lines.map((x) => x.replace(/ (1\d\d|200) /, (m, d) => ` ${+d + 3} `)).join('\n'), T)), 'raw entity ids may shift run to run');
const alt = (f) => splitEntx(f(lines).join('\n'), T);
caught(!sameCapture(A, alt((l) => l.filter((x) => x !== 'ENTX 17 minecraft:pig 110 -1 -'))), 'a dropped row');
caught(!sameCapture(A, alt((l) => l.map((x) => x.replace('18:0:998', '18:0:997')))), 'one effect duration off');
caught(!sameCapture(A, alt((l) => l.map((x) => (x === 'ENTX 30 minecraft:zombie 100 2970 -' ? 'ENTX 30 minecraft:zombie 100 2971 -' : x)))), 'a conversion timer off by one');
caught(!sameCapture(A, alt((l) => l.filter((x) => !/ 111 /.test(x)))), 'a mob missing (11 of 12)');
caught(splitEntx(lines.filter((x) => !/^ENTX 1 minecraft:chicken/.test(x)).join('\n'), T).mobs[11].length !== T, 'a mob whose first tick is lost');
const lp = landProbes(0, 0), covers = (pts) => SOAK_MOBS.every((m) => pts.some(([x, z]) => Math.abs(x - m.x) <= 12 && Math.abs(z - m.z) <= 12));
ok(covers(lp), 'land probes cover every mob within 12 blocks');
caught(!covers(lp.filter(([x, z]) => z <= 0)), 'a probe grid that misses the far rows');
console.log(`${12 + 8 + 6} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad || breaks !== 6 ? 1 : 0);
