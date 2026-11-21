#!/usr/bin/env node
// lockstep-arrowdamage -- #9213 (MOBPROOF-DAMAGE-3, part of #9203): engine side of the `arrowdamage` pilot lane (`pilot.mjs --lanes arrowdamage`,
// real 1.18.2 server, rep a vs rep b per salt), 20 salts: a crit arrow hits a NoAI zombie; pos/hp rows, same salt = same trace, a hit really
// lands, and compareTraces reports tampered damage. Writes mobproof/out/damage-arrow.json, which mobdamageproof folds into damage.json.
import { engineArrowDamageTrace, ARROWDAMAGE_FIELDS as F } from './referee/lockstep/arrowdamagelane.mjs';
import { compareTraces } from './referee/lockstep/trace.mjs';
import { T } from './referee/chasescen.mjs';

let bad = 0, breaks = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { asserts++; if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const SALTS = Array.from({ length: 20 }, (_, i) => i);
const traces = SALTS.map((s) => engineArrowDamageTrace(s));
traces.forEach((R, i) => {
  ok(R.length === T, `salt ${i}: ${R.length} rows`);
  ok(R[0].hp === 20, `salt ${i}: starts at 20 hp, got ${R[0].hp}`);
  ok(R[T - 1].hp < 20, `salt ${i}: the arrow never damaged the zombie`);
  ok(R.every((r, t) => r.tick === t && r.hp <= 20 && r.hp >= 0), `salt ${i}: hp rows monotone-bounded`);
});
ok(compareTraces(traces[0], engineArrowDamageTrace(0), { fields: F }) === null, 'same salt, same trace');
const hit = traces[0].findIndex((r) => r.hp < 20);
const mut = (f, fn, at) => traces[0].map((r, t) => (t === at ? { ...r, [f]: fn(r[f]) } : r));
const at = (m, tick, field, name) => { const r = compareTraces(traces[0], m, { fields: F }); caught(r?.tick === tick && r?.field === field, `${name}: got ${JSON.stringify(r && { tick: r.tick, field: r.field })}`); };
at(mut('hp', (h) => h + 1, hit), hit, 'hp', 'arrow damage off by one');
at(mut('hp', (h) => h + 0.5, T - 1), T - 1, 'hp', 'final health');
at(mut('pos', (p) => [p[0] + 1e-9, p[1], p[2]], 40), 40, 'pos', 'position');
caught(compareTraces(traces[0], engineArrowDamageTrace(0, { speed: 1.5 }), { fields: F }) !== null, 'a slower arrow does less damage');
caught(compareTraces(traces[0], traces[0].slice(1), { fields: F }) !== null, 'row shift');
{ const fs = await import('node:fs'), path = await import('node:path'), url = await import('node:url');
  const dir = path.join(path.dirname(url.fileURLToPath(import.meta.url)), 'mobproof', 'out'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'damage-arrow.json'), JSON.stringify({ zombie: { pass: !bad, checked: ['arrow (crit, speed 2.5) damage per tick, engine trace vs real-server-stable lane arrowdamage'], failed: bad ? ['see lockstep-arrowdamage'] : [] } })); }
for (let i = 0; i < breaks; i++) console.log('✓ break caught');
console.log(`arrowdamage: ${SALTS.length} salts, ${bad ? 'FAILED' : '0 divergences'}: ${asserts} assertions, ${bad} failures`);
process.exit(bad ? 1 : 0);
