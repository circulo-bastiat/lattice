#!/usr/bin/env node
// lockstep/pilotsum.mjs -- #6426: merge pilot.mjs chunk outputs into one {"pilot":"done",...} line over salts 0..19.
//   node tools/referee/lockstep/pilotsum.mjs <chunk output files...>
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export function merge(texts, total = 20) {
  const chunks = [];
  for (const t of texts) for (const l of t.split('\n')) {
    if (!l.startsWith('{')) continue;
    let j; try { j = JSON.parse(l); } catch { continue; }
    if (j.pilot === 'chunk' || j.pilot === 'done') chunks.push(j.pilot === 'done' ? { lanes: j.lanes, from: 0, seeds: total, divergences: j.divergences } : j);
  }
  if (!chunks.length) throw new Error('no pilot summary lines');
  const lanes = JSON.stringify(chunks[0].lanes);
  if (!chunks.every((c) => c.lanes && JSON.stringify(c.lanes) === lanes)) throw new Error('chunks ran different lanes');
  const seen = new Set();
  for (const c of chunks) for (let s = c.from; s < c.from + c.seeds; s++) {
    if (seen.has(s)) throw new Error('salt ' + s + ' appears in two chunks');
    seen.add(s);
  }
  for (let s = 0; s < total; s++) if (!seen.has(s)) throw new Error('salt ' + s + ' missing');
  if (seen.size !== total) throw new Error('salts beyond ' + total);
  return { pilot: 'done', runs: chunks[0].lanes.length * total, divergences: chunks.flatMap((c) => c.divergences) };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(merge(process.argv.slice(2).map((f) => readFileSync(f, 'utf8'))))); } catch (e) { console.error('pilotsum: ' + e.message); process.exit(1); }
}
