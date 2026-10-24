// tools/fullshardcheck.mjs - hosted full suite: the 16 slices cover EVERY stage id exactly once, ids come from the JSON (not
// the file name), and a shard that never reported is a setup fault, never green. Anti-vacuity: mutated copies must be caught.
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(new URL('./infra/fullshard.mjs', import.meta.url), 'utf8');
const load = async (s) => { const d = mkdtempSync(join(tmpdir(), 'fsc-')); const f = join(d, 'fs.mjs'); writeFileSync(f, s); try { return await import('file://' + f.replace(/\\/g, '/') + '?' + Math.random()); } finally { /* keep: import is lazy */ } };
const verdicts = async (s) => {
  const { stageIds, slice, mergeShards, planShards, mergeTimes, readFeed, rowSeconds } = await load(s); const bad = [];
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
  if (!/stageSec: sec/.test(s)) bad.push('shard-<i>.json does not record stageSec');
  { // #7727: balance by recorded seconds. One heavy stage per 4 ids (seconds 1..40) must not leave one shard with all the time.
    const times = {}; ids.forEach((id, k) => { times[id] = [k % 4 === 0 ? 40 : 1, k % 4 === 0 ? 44 : 1]; });
    const plan = planShards(ids, 16, times); const sec = plan.map((b) => b.reduce((a, id) => a + (times[id].reduce((x, y) => x + y) / 2), 0));
    const flat = plan.flat(); if (flat.length !== ids.length || new Set(flat).size !== ids.length || ids.some((x) => !flat.includes(x))) bad.push('planned shards drop or double a stage');
    const mean = sec.reduce((a, b) => a + b) / 16; if (Math.max(...sec) > 1.3 * mean) bad.push(`slowest planned shard ${Math.max(...sec).toFixed(0)} s is over 1.3x the mean ${mean.toFixed(0)} s`);
    const none = planShards(ids, 16, {}); if (none.flat().length !== ids.length || Math.max(...none.map((b) => b.length)) - Math.min(...none.map((b) => b.length)) > 1) bad.push('no timings: not a balanced split by count');
    const t1 = Object.fromEntries(ids.map((x) => [x, [1]])); t1[ids[0]] = [500]; const one = planShards(ids, 16, t1); if (one.flat().length !== ids.length || !one.some((b) => b.includes(ids[0]) && b.length <= 2)) bad.push('one huge stage does not get a shard nearly to itself');
    const nw = new Set(ids.slice(-100)); const t2 = Object.fromEntries(ids.filter((x) => !nw.has(x)).map((x) => [x, [10]])); const p2 = planShards(ids, 16, t2);
    if (Math.max(...p2.map((b) => b.filter((x) => nw.has(x)).length)) > 10) bad.push('stages with no timing are piled into one shard instead of costing the median');
    const dd = mkdtempSync(join(tmpdir(), 'fst-')); writeFileSync(join(dd, 'shard-0.json'), JSON.stringify({ stageSec: { a: 3, b: 4 } }));
    let acc = {}; for (let r = 0; r < 7; r++) acc = mergeTimes(dd, 1, acc, 5); rmSync(dd, { recursive: true, force: true });
    if (acc.a.length !== 5 || acc.b[0] !== 4) bad.push('stage times are not kept as the last 5 runs');
    { // #9251: a stage with no timing costs the median of ITS FAMILY. 8 timed lockstep stages (600 s) + 24 untimed ones that really cost 600 s, plus 200 cheap stages:
      // costed at the global median (5 s) the untimed ones pile into the 8 shards that hold no timed lockstep stage and one shard takes 3 of them
      const L = Array.from({ length: 32 }, (_, k) => 'lockstep-x' + String(k).padStart(2, '0')), O = Array.from({ length: 200 }, (_, k) => 'o' + String(k).padStart(3, '0'));
      const tf = {}; for (const id of O) tf[id] = [5]; for (const id of L.slice(0, 8)) tf[id] = [600];
      const pf = planShards([...L, ...O], 16, tf), real = (id) => (id.startsWith('lockstep') ? 600 : 5), secf = pf.map((b) => b.reduce((a, id) => a + real(id), 0)), mf = secf.reduce((a, b) => a + b) / 16;
      if (Math.max(...secf) > 1.3 * mf) bad.push('untimed lockstep stages are costed at the global median: slowest shard ' + Math.max(...secf).toFixed(0) + ' s vs mean ' + mf.toFixed(0) + ' s');
    }
    { // #9251: the feed file is read from Projects/_status, an empty one falls back to tools/stage-times.json, and a killed shard keeps its finished rows
      const pj = mkdtempSync(join(tmpdir(), 'fsp-')), rt = mkdtempSync(join(tmpdir(), 'fsr-')); const keep = process.env.MCLITE_PROJECTS; process.env.MCLITE_PROJECTS = pj;
      try {
        mkdirSync(join(pj, '_status'), { recursive: true }); mkdirSync(join(rt, 'tools'), { recursive: true }); writeFileSync(join(rt, 'tools', 'stage-times.json'), JSON.stringify({ fallback: [9] }));
        writeFileSync(join(pj, '_status', 'stage-times.json'), '{}'); if (!readFeed(rt).fallback) bad.push('an empty feed does not fall back to tools/stage-times.json');
        writeFileSync(join(pj, '_status', 'stage-times.json'), JSON.stringify({ fed: [7] })); const rf = readFeed(rt); if (!rf.fed || rf.fallback) bad.push('the feed in Projects/_status is not read first');
      } finally { if (keep === undefined) delete process.env.MCLITE_PROJECTS; else process.env.MCLITE_PROJECTS = keep; rmSync(pj, { recursive: true, force: true }); rmSync(rt, { recursive: true, force: true }); }
      const rs = rowSeconds(' ✓ foocheck          1234 ms  ok\n ✗ barcheck            50 ms  bad\n · skipcheck 0 ms\nnoise'); if (rs.foocheck !== 1.2 || rs.barcheck !== 0.1 || 'skipcheck' in rs) bad.push('a killed shard does not keep the seconds of the stages that finished');
    }
    if (ids.some((id) => /^lockstep-minecartrail$|^lockstep_turtle$|^lockstep_zombie_villager$|^lockstep-shulkerbullet-server$/.test(id))) bad.push('a verified duplicate stage is back');
  }
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
  ['plan drops the last stage of each shard', (s) => s.replace('return bins.map((b) => b.ids.sort());', 'return bins.map((b) => b.ids.sort().slice(0, -1));')],
  ['plan doubles a stage', (s) => s.replace('m.ids.push(id); m.sec += cost.get(id);', 'm.ids.push(id); if (id === ids[0]) bins[0].ids.push(id); m.sec += cost.get(id);')],
  ['all time to one shard', (s) => s.replace('let m = bins[0]; for (const b of bins) if (b.sec < m.sec || (b.sec === m.sec && b.ids.length < m.ids.length)) m = b;', 'const m = bins[0];')],
  ['unknown stage costs nothing', (s) => s.replace('avg(id) ?? famMed[family(id)]', 'avg(id) ?? 0')],
  ['unknown stage costs the global median', (s) => s.replace('avg(id) ?? famMed[family(id)]', 'avg(id) ?? med')],
  ['empty feed does not fall back', (s) => s.replace('if (t && Object.keys(t).length) return t;', 'return t;')],
  ['feed in Projects/_status ignored', (s) => s.replace("join(process.env.MCLITE_PROJECTS || root, '_status', 'stage-times.json')", "join(root, 'tools', 'nofeed.json')")],
  ['killed shard loses its finished rows', (s) => s.replace(/export const rowSeconds = [^\n]*/, 'export const rowSeconds = () => ({});')],
  ['times keep every run', (s) => s.replace('.slice(-keep)', '')],
  ['stageSec not recorded', (s) => s.replace('stageSec: sec, ', '')],
  ['missing shard ignored', (s) => s.replace("failed.push(`pack-shard-${i}-missing`); continue;", 'continue;')],
  ['reds lost', (s) => s.replace('failed.push(...(s.failed || []));', '')],
  ['ran not summed', (s) => s.replace('ran += s.ran || 0;', '')],
  ['flaky lost in the merge', (s) => s.replace('flaky.push(...(s.flaky || []));', '')],
  ['unfit stages run on the mirror', (s) => s.replace("process.env.MCLITE_HOSTED === '1' ? all.filter((x) => unfit[x]) : []", '[]')],
  ['no retry', (s) => s.replace("const r2 = run(['tools/suite.mjs', '--only', again.join(',')], {}, 10);", "const r2 = { stdout: '', stderr: '' };")],
  ['no wall on the shard run', (s) => s.replace('timeout: wallMin * 60000, ', '')],
  ['hung shard reads as green', (s) => s.replace("r.status === null ? ['pack-shard-timeout'] : ", '')],
];
// #9251: the feed is WIRED: full.mjs writes it, mirror.mjs's snapshot carries it. Mutated copies of those two files must fail the wiring.
const fullSrc = readFileSync(new URL('./infra/full.mjs', import.meta.url), 'utf8'), mirSrc = readFileSync(new URL('./infra/mirror.mjs', import.meta.url), 'utf8');
const wiring = (f, m) => { const b = [];
  if (!/writeFileSync\(feedPath\(ROOT\), JSON\.stringify\(mergeTimes\(AGG, 16, readFeed\(ROOT\)\)\)\)/.test(f)) b.push('full.mjs does not write the shard seconds to the Projects feed');
  if (!/const t = readFeed\(root\)/.test(m) || !/join\(dir, 'tools', 'stage-times\.json'\)/.test(m)) b.push('mirror.mjs snapshot() does not carry the feed into tools/stage-times.json');
  return b; };
const WIRE_BREAKS = [['feed never written', (f, m) => [f.replace('writeFileSync(feedPath(ROOT), ', 'void ('), m]], ['feed written to the clone again', (f, m) => [f.replace('writeFileSync(feedPath(ROOT)', "writeFileSync(join(ROOT, '_status', 'stage-times.json')"), m]], ['snapshot does not carry the feed', (f, m) => [f, m.replace("join(dir, 'tools', 'stage-times.json')", "join(dir, 'tools', 'x.json')")]]];
const realWire = wiring(fullSrc, mirSrc); let wcaught = 0;
for (const [name, mut] of WIRE_BREAKS) { const [f2, m2] = mut(fullSrc, mirSrc); if (wiring(f2, m2).length) { wcaught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
const real = [...(await verdicts(src)), ...realWire];
let caught = wcaught;
for (const [name, mut] of BREAKS) { const m = mut(src); if (m !== src && (await verdicts(m)).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`fullshardcheck: ${caught} breaks caught (of ${BREAKS.length + WIRE_BREAKS.length})`);
console.log(` assertions passed .... ${13 - real.length}`);
console.log(` failures ........... ${real.length + BREAKS.length + WIRE_BREAKS.length - caught}`);
