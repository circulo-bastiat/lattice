#!/usr/bin/env node
// lockstep-projectiledamage -- #12328 (MOBPROOF-DAMAGE-B, part of #9188): engine side of the `tridentdamage` and `fireballdamage` pilot lanes
// (real 1.18.2 server; `pilot.mjs --lanes tridentdamage,fireballdamage` proves rep a == rep b per salt), 20 salts each. A NoAI zombie is hit by a
// thrown trident (8.0 damage, no RNG, minus zombie armor 2: 20 -> 12.128 at tick 3) or by a ghast fireball (power 0.1, ExplosionPower 1:
// 20 -> 14.096 at tick 14). The engine trace is compared with the real server's rep 0 (golden/*.json) per tick: hp always, pos only until the
// engine's NoAI zombie starts drifting after the hit (trident tick 20, some fireball salts tick 19+; the real server's NoAI zombie never moves: engine divergence, noted, not hidden).
// Arrow and explosion sources are lockstep-arrowdamage / lockstep-explosiondamage. Writes mobproof/out/damage-projectile.json for mobdamageproof.
import { engineTridentDamageTrace, TRIDENTDAMAGE_FIELDS as F } from './referee/lockstep/tridentdamagelane.mjs';
import { engineFireballDamageTrace } from './referee/lockstep/fireballdamagelane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const gold = (n) => JSON.parse(readFileSync(new URL(`./referee/lockstep/golden/${n}.json`, import.meta.url), 'utf8'));
const LANES = { tridentdamage: { G: gold('tridentdamage'), run: engineTridentDamageTrace, posUntil: 20, hit: 3, hp: 12.128 },
                fireballdamage: { G: gold('fireballdamage'), run: engineFireballDamageTrace, posUntil: 14, hit: 14, hp: 14.096 } };
// first row/field where the engine trace differs from the real server's (hp is a float32 on the server: 1e-6)
const serverDiff = (R, L) => { for (let t = 0; t < T; t++) {
  if (t <= L.posUntil && R[t].pos.some((c, k) => c !== L.G.pos[t][k])) return { tick: t, field: 'pos' };
  if (Math.abs(R[t].hp - L.G.hp[t]) > 1e-6) return { tick: t, field: 'hp' }; } return null; };

let bad = 0, breaks = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { asserts++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const checked = [];
for (const [name, L] of Object.entries(LANES)) {
  const traces = SALTS.map((s) => L.run(s));
  traces.forEach((R, i) => {
    const hit = R.findIndex((r) => r.hp < 20);
    ok(R.length === T && R[0].hp === 20, `${name} salt ${i}: rows/start hp`);
    ok(hit === L.hit && Math.abs(R[hit].hp - L.hp) < 1e-6 && R[T - 1].hp === R[hit].hp, `${name} salt ${i}: hit at tick ${L.hit} to ${L.hp}, got ${R[hit]?.hp} at ${hit}`);
    ok(serverDiff(R, L) === null, `${name} salt ${i}: engine vs real-server trace: ${JSON.stringify(serverDiff(R, L))}`);
  });
  ok(compareTraces(traces[0], L.run(0), { fields: F }) === null, `${name}: same salt, same trace`);
  const mut = (f, fn, at) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
  const at = (m, tick, field, what) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name} ${what}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
  at(mut('hp', (h) => h + 1, L.hit), L.hit, 'hp', 'damage off by one');
  at(mut('hp', (h) => h + 0.5, T - 1), T - 1, 'hp', 'final health');
  at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 5), 5, 'pos', 'position');
  caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, `${name} row shift`);
  const bent = traces[0].map((r) => ({ ...r, hp: r.hp < 20 ? r.hp + 1 : r.hp }));
  caught(serverDiff(bent, L)?.field === 'hp', `${name}: serverDiff catches a wrong damage`);
  const late = traces[0].map((r, t) => ({ ...r, hp: t < L.hit + 1 ? 20 : r.hp }));
  caught(serverDiff(late, L)?.tick === L.hit, `${name}: serverDiff catches a late hit`);
  checked.push(`${name} damage + hp per tick, engine trace vs real-server rep 0 (${L.hp} at tick ${L.hit})`);
}
mkdirSync(new URL('./mobproof/out/', import.meta.url), { recursive: true });
writeFileSync(new URL('./mobproof/out/damage-projectile.json', import.meta.url), JSON.stringify({ zombie: { pass: !bad, checked, failed: bad ? ['see lockstep-projectiledamage'] : [] } }));
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`projectiledamage: ${SALTS.length} salts x 2 lanes, ${bad ? 'FAILED' : '0 divergences'}: ${asserts} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
