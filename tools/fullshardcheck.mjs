// tools/fullshardcheck.mjs - hosted full suite: the 16 slices cover EVERY stage id exactly once, ids come from the JSON (not
// the file name), and a shard that never reported is a setup fault, never green. Anti-vacuity: mutated copies must be caught.
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(new URL('./infra/fullshard.mjs', import.meta.url), 'utf8');
const load = async (s) => { const d = mkdtempSync(join(tmpdir(), 'fsc-')); const f = join(d, 'fs.mjs'); writeFileSync(f, s); try { return await import('file://' + f.replace(/\\/g, '/') + '?' + Math.random()); } finally { /* keep: import is lazy */ } };
const verdicts = async (s) => {
  const { stageIds, slice, mergeShards } = await load(s); const bad = [];
  const ids = stageIds(root);
  // independent truth: every id written inside every stages.d file (a file name is NOT an id: 117 differ)
  const truth = new Set(); for (const f of readdirSync(join(root, 'tools', 'stages.d'))) if (f.endsWith('.json')) for (const e of [].concat(JSON.parse(readFileSync(join(root, 'tools', 'stages.d', f), 'utf8')))) truth.add(e.id);
  if (ids.length !== truth.size || ids.some((x) => !truth.has(x))) bad.push(`ids differ from the ids inside the stage files (${ids.length} vs ${truth.size})`);
  if (ids.length < 700) bad.push('stage ids not read from stages.d (' + ids.length + ')');
  if (new Set(ids).size !== ids.length) bad.push('duplicate stage ids');
  const seen = new Map(); for (let i = 0; i < 16; i++) for (const id of slice(ids, i, 16)) seen.set(id, (seen.get(id) || 0) + 1);
  if (seen.size !== ids.length) bad.push(`slices cover ${seen.size} of ${ids.length} ids`);
  if ([...seen.values()].some((c) => c !== 1)) bad.push('an id is in more than one slice');
  const sizes = Array.from({ length: 16 }, (_, i) => slice(ids, i, 16).length); if (Math.max(...sizes) - Math.min(...sizes) > 1) bad.push('slices are unbalanced');
  const d = mkdtempSync(join(tmpdir(), 'fsm-'));
  for (let i = 0; i < 16; i++) if (i !== 3) { writeFileSync(join(d, `shard-${i}.json`), JSON.stringify({ ran: 10, failed: i === 5 ? ['bobcheck'] : [], skippedInSlice: [] })); writeFileSync(join(d, `shard-${i}.log`), `log ${i}`); }
  const m = mergeShards(d, 16); rmSync(d, { recursive: true, force: true });
  if (!m.ledger.failedStages.includes('pack-shard-3-missing')) bad.push('a missing shard is not a setup fault');
  if (!m.ledger.failedStages.includes('bobcheck')) bad.push('a red check is lost in the merge');
  if (m.ledger.ran !== 150) bad.push('ran is not summed');
  if (!/process\.env\.MCLITE_HOSTED === '1' \? all\.filter\(\(x\) => unfit\[x\]\)/.test(s) || !/\.\.\.skipUnfit\]/.test(s)) bad.push('hosted-unfit stages are not skipped and reported as not run on the hosted mirror');
  { const un = JSON.parse(readFileSync(join(root, 'tools', 'hosted-unfit.json'), 'utf8')); const real = new Set(stageIds(root)); for (const [id, why] of Object.entries(un)) { if (!real.has(id)) bad.push('hosted-unfit names a stage that does not exist: ' + id); if (!why || why.length < 10) bad.push('hosted-unfit has no reason for ' + id); } }
  if (!/const r2 = run\(\['tools\/suite\.mjs', '--only', again\.join/.test(s) || !/rec\.flaky = again\.filter/.test(s)) bad.push('a failed stage is not retried once / flaky not recorded');
  if (!/timeout: wallMin \* 60000/.test(s) || !/MCLITE_STAGE_TIMEOUT_MIN: process\.env\.MCLITE_STAGE_TIMEOUT_MIN \|\| '12'/.test(s)) bad.push('a hung stage or suite call has no time limit, so shard-<i>.json may never be written');
  if (!/r\.status === null \? \['pack-shard-timeout'\]/.test(s)) bad.push('a shard killed by its wall reads as green instead of a setup fault');
  const d2 = mkdtempSync(join(tmpdir(), 'fsf-')); writeFileSync(join(d2, 'shard-0.json'), JSON.stringify({ ran: 1, failed: [], flaky: ['flakycheck'], skippedInSlice: [] }));
  const mf = mergeShards(d2, 1); rmSync(d2, { recursive: true, force: true }); if (!(mf.ledger.flaky || []).includes('flakycheck')) bad.push('a flaky stage is lost in the merge');
  return bad;
};
const BREAKS = [
  ['ids from the file name', (s) => s.replace('ids.push(e.id)', "ids.push(f.replace(/\\.json$/, ''))")],
  ['slice drops the last id of each', (s) => s.replace('ids.filter((_, k) => k % n === i)', 'ids.filter((_, k) => k % n === i).slice(0, -1)')],
  ['slices overlap', (s) => s.replace('k % n === i', 'k % n === i || k % n === (i + 1) % n')],
  ['missing shard ignored', (s) => s.replace("failed.push(`pack-shard-${i}-missing`); continue;", 'continue;')],
  ['reds lost', (s) => s.replace('failed.push(...(s.failed || []));', '')],
  ['ran not summed', (s) => s.replace('ran += s.ran || 0;', '')],
  ['flaky lost in the merge', (s) => s.replace('flaky.push(...(s.flaky || []));', '')],
  ['unfit stages run on the mirror', (s) => s.replace("process.env.MCLITE_HOSTED === '1' ? all.filter((x) => unfit[x]) : []", '[]')],
  ['no retry', (s) => s.replace("const r2 = run(['tools/suite.mjs', '--only', again.join(',')], {}, 10);", "const r2 = { stdout: '', stderr: '' };")],
  ['no wall on the shard run', (s) => s.replace('timeout: wallMin * 60000, ', '')],
  ['hung shard reads as green', (s) => s.replace("r.status === null ? ['pack-shard-timeout'] : ", '')],
];
const real = await verdicts(src);
let caught = 0;
for (const [name, mut] of BREAKS) { const m = mut(src); if (m !== src && (await verdicts(m)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`fullshardcheck: ${caught} breaks caught (of ${BREAKS.length})`);
console.log(` assertions passed .... ${13 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length - caught}`);
