#!/usr/bin/env node
// lockstep_pearl -- #6312 (G17-L61): the pearl lane. The real 1.18.2 server's traces (runpearl.mjs via lockstep/pearlrun.mjs, cached in
// lockstep/pearl-results/<salt>.json) against the engine (lockstep/pearllane.mjs): player pos/health, ender_pearl + endermite pos/vel,
// 3 throws (stone, wall, cow) x 20 salts, to ZERO. Faults: gravity 0.03 -> 0.04 (reported at the first flight tick), drag, fall damage, a shifted trace.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { engineRows, comparePearl } from './referee/lockstep/pearllane.mjs';
import { SALTS } from './referee/pearlscen.mjs';

const DIR = fileURLToPath(new URL('./referee/lockstep/pearl-results/', import.meta.url));
let bad = 0, breaks = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const traces = [];
for (let s = 0; s < SALTS; s++) { const f = join(DIR, s + '.json'); ok(existsSync(f), `salt ${s}: no server trace (node tools/referee/lockstep/pearlrun.mjs)`); if (existsSync(f)) traces.push(JSON.parse(readFileSync(f, 'utf8'))); }
traces.forEach((S, i) => {
  ok(S.uses.length === 3 && S.rows.length === S.T, `salt ${i}: ${S.uses.length} throws, ${S.rows.length} rows`);
  const d = comparePearl(S, engineRows(S));
  ok(!d, `salt ${i}: first divergence ${JSON.stringify(d)}`);
});
const S = traces[0];
if (S) {
  const first = S.uses[0] + 1;
  const g = comparePearl(S, engineRows(S, { gravity: Math.fround(0.04) }));
  caught(g && g.tick === first && g.field === 'e0vel', `gravity 0.03 -> 0.04 at the first flight tick ${first}: ${JSON.stringify(g && { tick: g.tick, field: g.field })}`);
  const d = comparePearl(S, engineRows(S, { drag: 0.98 }));
  caught(d && d.tick === first && d.field === 'e0vel', `drag 0.99 -> 0.98: ${JSON.stringify(d && { tick: d.tick, field: d.field })}`);
  const hurt = S.rows.findIndex((r, t) => t && r.health < S.rows[t - 1].health);
  const fd = comparePearl({ ...S, rows: S.rows.map((r) => (r.tick >= hurt ? { ...r, health: r.health + 1 } : r)) }, engineRows(S));
  caught(fd && fd.tick === hurt && fd.field === 'health', `fall damage 5 -> 4 at tick ${hurt}: ${JSON.stringify(fd && { tick: fd.tick, field: fd.field })}`);
  const tp = S.rows.findIndex((r, t) => t && r.pos[0] !== S.rows[t - 1].pos[0]);
  caught(comparePearl({ ...S, rows: S.rows.map((r) => (r.tick === tp ? { ...r, pos: [r.pos[0] + 1e-6, r.pos[1], r.pos[2]] } : r)) }, engineRows(S))?.tick === tp, `teleport target off by 1e-6 at tick ${tp}`);
  caught(comparePearl({ ...S, rows: S.rows.slice(1) }, engineRows(S)) !== null, 'server trace shifted one tick');
}
console.log(`pearl: ${traces.length}/${SALTS} salts, ${bad} divergences, ${breaks} breaks caught (3 throws: stone, wall, cow)`);
process.exit(bad ? 1 : 0);
