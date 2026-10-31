// soakdivcheck.mjs -- #9447 (G17-L38b): run the engine against the captured real-server 12-mob soak and print the per-mob first-divergence table.
//   node tools/referee/soakdivcheck.mjs [--print]   -> the table (docs/decisions/9447-soak-divergence-table.md pins it)
// The server side is golden/soak9446.json (soakcapture --one, run-length coded); the engine side is soakengine.mjs. Anti-vacuity: moving ONE mob's engine spawn by a tick must diverge that mob
// at its first row, and the neighbours' rows are compared against the unshifted run to show which of them moved with it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SOAK_MOBS, neighbours, fmtTable } from './lockstep/soak.mjs';
import { engineSoak } from './lockstep/soakengine.mjs';
import { compareTraces } from './lockstep/trace.mjs';
let fails = 0, breaks = 0, oks = 0;
const ok = (c, m) => { if (c) oks++, console.log('   ok: ' + m); else { fails++; console.log('  ✗ ' + m); } };
const caught = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const G = JSON.parse(readFileSync(fileURLToPath(new URL('./lockstep/golden/soak9446.json', import.meta.url)), 'utf8'));
const server = G.mobs.map(([type, conv, fx, a, b], i) => { const t = []; for (let k = a; k <= b; k++) t.push({ tick: k, entities: [[type, i, conv, fx]] }); return t; });
const O = { fields: ['entities'] };
// compareTraces pairs rows by index; the spawn tick itself is part of the trace, so a row at a different tick is a divergence too (field 'spawnTick')
const cmp = (a, b) => (a.length && b.length && a[0].tick !== b[0].tick ? { tick: Math.min(a[0].tick, b[0].tick), field: 'spawnTick' } : compareTraces(a, b, O));
const E = engineSoak(0), rep = SOAK_MOBS.map((m) => ({ n: m.n, id: m.id, div: cmp(server[m.n], E[m.n]) }));
ok(server.length === 12 && E.length === 12, '12 mobs on both sides');
ok(JSON.stringify(engineSoak(0).map((t) => t.length)) === JSON.stringify(E.map((t) => t.length)), 'the engine run is deterministic');
console.log(fmtTable(rep));
if (process.argv.includes('--print')) console.log(rep.map((r) => `${r.n} ${r.id}: server rows ${server[r.n].length}, engine rows ${E[r.n].length}, ${JSON.stringify(r.div)}`).join('\n'));
// the measured first divergences are pinned: a change to the engine that moves one is a visible event
const PIN = rep.map((r) => r.div && r.div.tick);
ok(rep.every((r) => r.div === null || typeof r.div.tick === 'number'), 'every mob has a first-divergence tick or none');
// anti-vacuity: shift each mob's engine spawn by one tick
let neighbourMoves = 0;
for (const m of SOAK_MOBS) {
  const S = engineSoak(0, { shift: m.n }), R = SOAK_MOBS.map((q) => ({ div: cmp(server[q.n], S[q.n]) }));
  caught(R[m.n].div && R[m.n].div.field === 'spawnTick' && R[m.n].div.tick === 2, `mob ${m.n} ${m.id}: spawn +1 tick diverges it at its first row (tick ${R[m.n].div && R[m.n].div.tick})`);
  const moved = neighbours(m.n).filter((k) => cmp(E[k], S[k]) !== null);
  neighbourMoves += moved.length;
  console.log(`      neighbours of ${m.n} whose engine trace changed: [${moved}] of [${neighbours(m.n)}]`);
}
// a broken capture must not pass: truncating a server trace moves the divergence
const cut = server.map((t, i) => (i === 0 ? t.slice(0, 5) : t));
caught(cmp(cut[0], E[0]).tick === 5, 'a truncated server trace for mob 0 diverges at its end');
caught(neighbourMoves > 0, 'a spawn shift moves at least one neighbour\'s engine trace (the 12 mobs interact)');
ok(JSON.stringify(PIN) === JSON.stringify([393, 2344, 237, 268, 903, 2074, 1594, null, 451, 1963, 2611, null]), 'the measured first-divergence table is the pinned one (docs/decisions/9447-soak-divergence-table.md)');
console.log(`soakdivcheck: ${oks + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
