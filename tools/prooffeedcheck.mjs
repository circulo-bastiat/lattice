// #8671: the proof feed files exactly the expected units, and every precondition / rule, when broken, is caught.
import { plan, testerReady } from './infra/prooffeed.mjs';
const now = Date.parse('2026-10-18T12:00:00Z'), G = 'green', R = 'red', X = 'missing';
const row = (o = {}) => ({ model: G, texture: G, animation: G, drops: G, spawn: G, lockstep: G, goals: G, ...o });
const base = (o = {}) => ({ free: 3, thin: 40, depLanded: true, now, lastBatchAt: 0, usageOk: true, openMarkers: new Set(), proven: ['cow'], known: new Set(), max: 20,
  order: ['zombie', 'cow', 'pig', 'sheep'], failedRow: (m, d) => `${d} row of ${m}`, changedAfter: () => false, stillRed: () => true,
  matrix: { sha: 'abc', builtAt: '2026-10-18T06:00:00Z', full: true, rows: { zombie: row({ lockstep: R, model: R }), cow: row({ model: R }), pig: row({ drops: X }), sheep: row() } }, ...o });
let breaks = 0, bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const caught = (c, m) => { if (c) breaks++; else { bad++; console.log('NOT CAUGHT ' + m); } };
const p = plan(base());
ok(p.fire && p.file.length === 2 && p.file[0].title === 'PROOF zombie model: model row of zombie' && p.file[1].key === 'proof-zombie-lockstep', 'expected issues, lockstep last: ' + JSON.stringify(p.file.map((x) => x.key)));
ok(p.file.every((x) => x.labels.join() === 'bug,dan,mobs' && x.body.includes(`<!-- dedupe:${x.key} -->`)), 'labels + marker');
ok(!p.file.some((x) => x.key.includes('cow')), 'proven mob skipped');
ok(p.pipeline.length === 0, 'a lone MISSING cell is not a pipeline fault');
// preconditions: each broken -> nothing filed
for (const [n, o] of [['queue deep', { free: 40 }], ['dep not landed', { depLanded: false }], ['matrix not full', { matrix: { ...base().matrix, full: false } }],
  ['matrix stale', { matrix: { ...base().matrix, builtAt: '2026-10-17T06:00:00Z' } }], ['all missing', { matrix: { sha: 'a', builtAt: '2026-10-18T06:00:00Z', full: true, rows: { zombie: row({ model: X, texture: X, animation: X, drops: X, spawn: X, lockstep: X, goals: X }) } } }],
  ['batch guard', { lastBatchAt: now - 10 * 60e3 }], ['usage cap', { usageOk: false }]]) caught(!plan(base(o)).fire && !plan(base(o)).file.length, n);
// rules: broken rule yields a wrong result the assertion catches
caught(!plan(base({ openMarkers: new Set(['proof-zombie-model']) })).file.some((x) => x.key === 'proof-zombie-model'), 'dedupe on open marker');
caught(!plan(base({ known: new Set(['zombie|model']) })).file.some((x) => x.key === 'proof-zombie-model'), 'known list');
caught(!plan(base({ changedAfter: () => true, stillRed: () => false })).file.length, 'already-fixed re-check');
caught(plan(base({ changedAfter: () => true, stillRed: () => true })).file.length === 2, 'changed but still red is filed');
caught(plan(base({ max: 1 })).file.length === 1, 'max');
const miss = plan(base({ matrix: { sha: 'a', builtAt: '2026-10-18T06:00:00Z', full: true, rows: { zombie: row({ spawn: X }), pig: row({ spawn: X, model: R }) } } }));
caught(miss.pipeline.length === 1 && miss.pipeline[0].title === 'proof pipeline: spawn missing' && !miss.file.some((x) => x.key.includes('spawn')), 'MISSING is a pipeline bug, never mob work');
caught(plan(base({ openMarkers: new Set(['proof-pipeline-spawn']) , matrix: { sha: 'a', builtAt: '2026-10-18T06:00:00Z', full: true, rows: { zombie: row({ spawn: X }) } } })).pipeline.length === 0, 'pipeline dedupe');
caught(testerReady(base().matrix, 'sheep') && !testerReady(base().matrix, 'cow') && !testerReady(base().matrix, 'pig'), 'tester gate');
// the gate's matrix is the live one: the feed must read it too, not the committed (never full) copy
import { readFileSync } from 'node:fs';
const PF = readFileSync(new URL('./infra/prooffeed.mjs', import.meta.url), 'utf8');
caught(/loadMatrix\(root\)/.test(PF) && !/rd\(join\(T, 'mobproof', 'matrix\.json'\)\)/.test(PF), 'feed reads the live matrix via loadMatrix');
caught(!/loadMatrix\(root\)/.test(PF.replace('loadMatrix(root)', "rd(join(T, 'mobproof', 'matrix.json'))")), 'break: committed-file read is detected');
console.log(`prooffeedcheck: ${bad ? bad + ' FAILED' : 'ok'}, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
