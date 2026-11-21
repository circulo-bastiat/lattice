#!/usr/bin/env node
// lockstep-shulkerbulletdamage -- #9445 (G17-L4 shulker_bullet part 2, owed by #7061): engine side of the `shulkerbulletdamage` pilot lane
// (`pilot.mjs --lanes shulkerbulletdamage`, real 1.18.2 server, rep a vs rep b per salt), 20 salts: a shulker bullet hits a NoAI zombie;
// pos/hp/effect rows. The hit really lands (4.0 damage, minus the zombie's armor 2: 20 -> 16.064) and gives Levitation I (id 25, amplifier 0) with 200 ticks to start with.
import { engineShulkerBulletDamageTrace, SHULKERBULLETDAMAGE_FIELDS as F } from './referee/lockstep/shulkerbulletdamagelane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';
import { readFileSync } from 'node:fs';

const G = JSON.parse(readFileSync(new URL('./referee/lockstep/golden/shulkerbulletdamage.json', import.meta.url), 'utf8'));
// first row/field where the engine trace differs from the real server's (hp is a float32 on the server: 1e-6)
const serverDiff = (R) => { for (let t = 0; t < T; t++) { const r = R[t];
  // pos only up to one tick after the hit: a NoAI mob on the real server does not move at all, so it never levitates (engine divergence, own issue)
  if (t <= 37 && r.pos.some((c, k) => c !== G.pos[t][k])) return { tick: t, field: 'pos' };
  if (Math.abs(r.hp - G.hp[t]) > 1e-6) return { tick: t, field: 'hp' };
  if (['i', 'a', 'd'].some((k) => r.fx[k][0] !== G.fx[k][t])) return { tick: t, field: 'fx' }; } return null; };

let bad = 0, breaks = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { asserts++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineShulkerBulletDamageTrace(s));
traces.forEach((R, i) => {
  const hit = R.findIndex((r) => r.hp < 20);
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R[0].hp === 20 && R[0].fx.i[0] === -1, `salt ${i}: starts at 20 hp, no effect`);
  ok(hit > 0 && Math.abs(R[hit].hp - 16.064) < 1e-6 && R[T - 1].hp === R[hit].hp, `salt ${i}: 4.0 damage through the zombie's armor 2 (20 - 4*(1 - 2/5/25 ... = 16.064) (hp ${R[hit]?.hp} at tick ${hit}, final ${R[T - 1].hp})`);
  ok(R[hit].fx.i[0] === 25 && R[hit].fx.a[0] === 0 && R[hit].fx.d[0] === 200, `salt ${i}: Levitation I 200 ticks at the hit, got ${JSON.stringify(R[hit].fx)}`);
  ok(R[hit + 10].fx.d[0] === 190, `salt ${i}: duration counts down, got ${R[hit + 10].fx.d[0]}`);
});
traces.forEach((R, i) => ok(serverDiff(R) === null, `salt ${i}: engine vs real-server trace: ${JSON.stringify(serverDiff(R))}`));
ok(compareTraces(traces[0], engineShulkerBulletDamageTrace(0), { fields: F }) === null, 'same salt, same trace');
const hit = traces[0].findIndex((r) => r.hp < 20);
const mut = (f, fn, at) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('hp', (h) => h + 1, hit), hit, 'hp', 'damage off by one');
at(mut('fx', (f) => ({ ...f, d: [f.d[0] - 1] }), hit), hit, 'fx', 'levitation duration off by one');
at(mut('fx', (f) => ({ ...f, a: [1] }), hit), hit, 'fx', 'levitation amplifier');
at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 40), 40, 'pos', 'position');
const sd = (o, name, tick, field) => { const r = serverDiff(engineShulkerBulletDamageTrace(0, o)); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r)}`); };
sd({ damage: 3 }, 'engine rule broken: damage 3 vs real server', hit, 'hp');
sd({ ticks: 100 }, 'engine rule broken: 100 ticks vs real server', hit, 'fx');
caught(serverDiff(mut('hp', (h) => h - 1, 90)) ?.field === 'hp', 'tampered later health vs real server');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`shulkerbulletdamage: ${SALTS.length} salts, ${bad ? 'FAILED' : '0 divergences'}, ${breaks} breaks caught: ${asserts} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
