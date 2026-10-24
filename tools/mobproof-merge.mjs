// #8670: the mirror shards each write tools/mobproof/out/*.json into their OWN workspace. A shard embeds them in its shard-<i>.json
// (collectProof), the aggregate merges them per mob + dimension (mergeProof) into the dir buildMatrix reads. Rules: a mob a shard did not
// run stays absent (MISSING); a mob in two shards: red wins; a shard on another sha than the first, or without a proof, contributes
// nothing; every merged file carries "__sha" and buildMatrix({sha}) treats a file of another sha as MISSING.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIMS, renderMd } from './mobproof.mjs';

export function collectProof(outDir, sha) {
  const proof = {};
  for (const d of DIMS) { try { proof[d] = JSON.parse(readFileSync(join(outDir, d + '.json'), 'utf8')); } catch { /* this shard did not run it */ } }
  return { sha: sha || '', proof };
}
const isMob = (k, e) => k !== '__sha' && e && typeof e.pass === 'boolean';
/** recs: [{sha, proof:{dim:{mob:{pass..}}}}] -> { sha, files:{dim:{__sha, mob:...}} } */
export function mergeProof(recs) {
  const good = recs.filter((r) => r && r.proof && r.sha), sha = good.length ? good[0].sha : '', files = {};
  for (const r of good) {
    if (r.sha !== sha) continue;
    for (const d of DIMS) for (const [m, e] of Object.entries(r.proof[d] || {})) {
      if (!isMob(m, e)) continue;
      const f = files[d] || (files[d] = { __sha: sha }), was = f[m];
      if (!was || (was.pass && !e.pass)) f[m] = e;   // red wins
    }
  }
  return { sha, files };
}
export function writeMerged(M, outDir) {
  mkdirSync(outDir, { recursive: true });
  for (const [d, f] of Object.entries(M.files)) writeFileSync(join(outDir, d + '.json'), JSON.stringify(f));
}
export function mergeFromDir(aggDir, outDir) {
  const recs = [];
  for (const f of readdirSync(aggDir)) if (/^shard-\d+\.json$/.test(f)) { try { recs.push(JSON.parse(readFileSync(join(aggDir, f), 'utf8'))); } catch { /* garbled = absent */ } }
  const M = mergeProof(recs); writeMerged(M, outDir); return M;
}
/** Write the full-run matrix (json + md) into each checkout's tools/mobproof: the aggregate's own, and Dan's Projects copy the proof feed reads. */
export function publishMatrix(mx, roots) {
  for (const r of roots) { if (!r) continue; const d = join(r, 'tools', 'mobproof'); mkdirSync(d, { recursive: true }); writeFileSync(join(d, 'matrix.json'), JSON.stringify(mx, null, 1) + '\n'); writeFileSync(join(d, 'matrix.md'), renderMd(mx)); }
}
/** #8982: a full run needs every proof dimension. Returns [{dim, reason}] for each dimension with no out/<dim>.json (or with an out/<dim>.skip marker a stage left when it SKIPped). */
export function missingDims(outDir) {
  const bad = [];
  for (const d of DIMS) {
    let skip = null; try { skip = readFileSync(join(outDir, d + '.skip'), 'utf8').trim() || 'SKIP'; } catch { /* no marker */ }
    if (skip) { bad.push({ dim: d, reason: 'stage SKIPped: ' + skip }); continue; }
    let j = null; try { j = JSON.parse(readFileSync(join(outDir, d + '.json'), 'utf8')); } catch { /* absent or garbled */ }
    if (!j || !Object.keys(j).some((k) => isMob(k, j[k]))) bad.push({ dim: d, reason: 'no out/' + d + '.json (or no mob in it)' });
  }
  return bad;
}
/** Prints one line per missing dimension; returns the exit code (non-zero when any). */
export function reportMissing(outDir, log = console.log) {
  const bad = missingDims(outDir);
  for (const b of bad) log(`proof dimension ${b.dim} MISSING for all mobs: ${b.reason}`);
  return bad.length ? 1 : 0;
}
if (process.argv[1] && process.argv[1].endsWith('mobproof-merge.mjs') && process.argv[2]) process.exit(reportMissing(process.argv[2]));
