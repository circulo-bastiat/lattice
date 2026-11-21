// #8670: shard proof artifacts merge per mob + dimension; missing/foreign-sha/empty stay MISSING, red wins, green only when all present+green.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergeProof, writeMerged, publishMatrix } from './mobproof-merge.mjs';
import { buildMatrix, DIMS } from './mobproof.mjs';
const HERE = new URL('.', import.meta.url).pathname;
const roster = Object.keys(JSON.parse(readFileSync(join(HERE, 'mobl3-mobs.json'), 'utf8')).mobs), A = roster[0], B = roster[1];
let bad = 0, caught = 0;
const ok = (c, m) => { if (!c) { bad++; console.log('FAIL ' + m); } };
const cell = (recs, mob, d, sha = 'S') => {
  const M = mergeProof(recs), od = mkdtempSync(join(tmpdir(), 'mpm-')); writeMerged(M, od);
  return buildMatrix({ out: od, sha, hashes: false, prev: null }).rows[mob][d];
};
const all = (pass, mobs = [A]) => Object.fromEntries(DIMS.map((d) => [d, Object.fromEntries(mobs.map((m) => [m, { pass }]))]));
const rec = (proof, sha = 'S') => ({ sha, proof });
const full = (r) => { const M = mergeProof(r), od = mkdtempSync(join(tmpdir(), 'mpm-')); writeMerged(M, od); return buildMatrix({ out: od, sha: 'S', hashes: false, prev: null }).rows[A]; };
// baseline: every dimension present and green in two shards (half each) -> green (lockstep needs a lane, so check the other six)
const half1 = { model: all(true).model, texture: all(true).texture, animation: all(true).animation }, half2 = { drops: all(true).drops, spawn: all(true).spawn, goals: all(true).goals };
const row = full([rec(half1), rec(half2)]);
ok(['model', 'texture', 'animation', 'drops', 'spawn', 'goals'].every((d) => row[d] === 'green'), 'both shards present -> green');
const brk = (name, c) => { if (c) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
brk('dropped shard', full([rec(half1)]).drops === 'missing');
brk('red wins', cell([rec({ model: { [A]: { pass: true } } }), rec({ model: { [A]: { pass: false } } })], A, 'model') === 'red');
brk('red wins (order)', cell([rec({ model: { [A]: { pass: false } } }), rec({ model: { [A]: { pass: true } } })], A, 'model') === 'red');
brk('wrong sha shard', full([rec(half1), rec(half2, 'OTHER')]).drops === 'missing');
brk('empty artifact', full([rec({}), rec({})]).model === 'missing' && full([{ sha: 'S' }]).model === 'missing');
{ const od = mkdtempSync(join(tmpdir(), 'mpm-')); writeMerged(mergeProof([rec(half1, 'OLD')]), od);
  brk('stale file vs expected sha', buildMatrix({ out: od, sha: 'NEW', hashes: false, prev: null }).rows[A].model === 'missing'); }
brk('mob not run stays missing', cell([rec({ model: { [A]: { pass: true } } })], B, 'model') === 'missing');
// the fresh matrix must reach BOTH files in the aggregate's checkout and Dan's Projects copy, after its pull (the 18 Oct bug: only matrix.json, only in the runner)
{ const r1 = mkdtempSync(join(tmpdir(), 'mpp-')), r2 = mkdtempSync(join(tmpdir(), 'mpp-')), M = { roster: 1, proven: 0, rows: {}, full: true, builtAt: 'T' };
  publishMatrix(M, [r1, r2]);
  const got = (r) => { try { return JSON.parse(readFileSync(join(r, 'tools', 'mobproof', 'matrix.json'), 'utf8')).builtAt === 'T' && /proven 0\/1/.test(readFileSync(join(r, 'tools', 'mobproof', 'matrix.md'), 'utf8')); } catch { return false; } };
  ok(got(r1) && got(r2), 'publishMatrix writes matrix.json + matrix.md into every root');
  const full = readFileSync(join(HERE, 'infra', 'full.mjs'), 'utf8'), pull = full.indexOf('updateLocalCopy(DATA, { force: true })'), pub = full.indexOf('publishMatrix(fullMatrix, [DATA])');
  brk('full.mjs publishes to the Projects copy after the pull', pull > 0 && pub > pull);
  brk('no matrix published -> no Projects copy', !got(mkdtempSync(join(tmpdir(), 'mpp-')))); }
console.log(`mobproofmergecheck: ${bad ? bad + ' FAILED' : 'ok'}, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
