// tools/infra/fullshard.mjs - hosted-runner cutover (Dan, 6 Oct 2026: tests run on GitHub's free runners, never on his PC).
//   node tools/infra/fullshard.mjs <i> <n>   build, then run slice i of n of EVERY stage id; writes shard-out/shard-<i>.{json,log}
//   mergeShards(dir, n)                      what full.mjs reads in the aggregate job (FULL_AGG_DIR)
// A stage file's NAME is not its id (117 of 788 differ, found 7 Oct) and one file may hold several: ids come from the JSON.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function stageIds(root) {
  const dir = join(root, 'tools', 'stages.d'); const ids = [];
  for (const f of readdirSync(dir)) { if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8')); for (const e of Array.isArray(j) ? j : [j]) ids.push(e.id); }
  return ids.sort();
}
/** #7727: the shard planner. `times` = {id: [seconds, ...last runs]} (tools/stage-times.json, committed so it survives a mirror reset); a stage
 *  with no timing costs the median. Greedy longest-first into n bins; ties and equal costs fall back to the sorted position, so no timings = a
 *  plain balanced split by count. Every id lands in exactly one bin. */
/** #9251: suite.mjs prints one ` ✓|✗ <id>  <ms> ms  ...` row per finished stage; a shard killed by its wall never writes its ledger, but these rows give its seconds. */
export const rowSeconds = (stdout) => { const o = {}; for (const m of String(stdout || '').matchAll(/^ [✓✗] (\S+)\s+(\d+) ms/gm)) o[m[1]] = Math.round(+m[2] / 100) / 10; return o; };
/** 21 Oct: ids from `ids` whose FINAL row is a TIMEOUT (suite.mjs prints `✗ <id>  <ms> ms  TIMEOUT after <n> min`). A stage that only timed out
 *  is INCONCLUSIVE, not red: ~35 of 48 short worker runs a day were closing `RED lockstep-*` issues whose only evidence was a cold-cache timeout
 *  on the hosted mirror (480 lockstep stages = 9.5 h cold, they cannot fit 16 x 32 min). An assertion failure is still red. */
export const timedOutIds = (stdout, ids) => ids.filter((id) => new RegExp(`^ ✗ ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+ ms\\s+TIMEOUT after`, 'm').test(String(stdout || '')));
/** #9651: the LAST row each id printed anywhere in the log decides (first run or retry). A retry killed by its own wall prints no row, so the first run's TIMEOUT stands instead of the stage silently staying red. */
export const lastRowTimedOut = (log, ids) => ids.filter((id) => { const rows = [...String(log || '').matchAll(new RegExp(`^ [✓✗] ${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+\\d+ ms\\s+(.*)$`, 'gm'))]; return rows.length > 0 && /^TIMEOUT after/.test(rows[rows.length - 1][1]); });
export const family = (id) => (/^lockstep/.test(id) ? 'lockstep' : 'other');
export function planShards(ids, n, times = {}) {
  const avg = (id) => { const v = times[id]; return Array.isArray(v) && v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
  const known = ids.map(avg).filter((x) => x !== null).sort((a, b) => a - b);
  const med = known.length ? known[known.length >> 1] : 1;
  // #9251: a stage with no timing costs the median of ITS FAMILY (real-server lockstep-* stages are far above the rest), never the global one
  const famMed = {}; for (const f of ['lockstep', 'other']) { const k = ids.filter((id) => family(id) === f).map(avg).filter((x) => x !== null).sort((a, b) => a - b); famMed[f] = k.length ? k[k.length >> 1] : med; }
  const cost = new Map(ids.map((id) => [id, avg(id) ?? famMed[family(id)]]));
  const bins = Array.from({ length: n }, () => ({ ids: [], sec: 0 }));
  for (const id of [...ids].sort((a, b) => cost.get(b) - cost.get(a) || (a < b ? -1 : 1))) {
    let m = bins[0]; for (const b of bins) if (b.sec < m.sec || (b.sec === m.sec && b.ids.length < m.ids.length)) m = b;
    m.ids.push(id); m.sec += cost.get(id);
  }
  return bins.map((b) => b.ids.sort());
}
export const slice = (ids, i, n, times = {}) => planShards(ids, n, times)[i];
/** #9251: THE FEED. full.mjs folds every run's shard seconds into this file (the persistent Projects/_status folder, the same place tia-misses.jsonl and
 *  full-dry-*.json go) and snapshot() carries it into the mirror as tools/stage-times.json, so the planner always plans from real seconds with nobody copying a file. */
export const feedPath = (root) => join(process.env.MCLITE_PROJECTS || root, '_status', 'stage-times.json');
export const readFeed = (root) => { try { const t = JSON.parse(readFileSync(feedPath(root), 'utf8')); if (t && Object.keys(t).length) return t; } catch { /* no feed yet */ } return readTimes(root); };
export const readTimes = (root) => { try { return JSON.parse(readFileSync(join(root, 'tools', 'stage-times.json'), 'utf8')); } catch { return {}; } };
/** The shards' per-stage seconds folded into `prev`, keeping the last `keep` runs of each stage. */
export function mergeTimes(dir, n = 16, prev = {}, keep = 5) {
  const out = JSON.parse(JSON.stringify(prev));
  for (let i = 0; i < n; i++) { const jf = join(dir, `shard-${i}.json`); if (!existsSync(jf)) continue;
    for (const [id, sec] of Object.entries(JSON.parse(readFileSync(jf, 'utf8')).stageSec || {})) out[id] = [...(out[id] || []), sec].slice(-keep); }
  return out;
}

/** #7765: the shards' stage -> files maps (shard-out/tia-map-<i>.json, written by `suite --map`) as ONE map; later shards win on a stage seen twice. */
export function mergeMaps(dir, n = 16) {
  const map = { at: '', head: '', stages: {} };
  for (let i = 0; i < n; i++) { const f = join(dir, `tia-map-${i}.json`); if (!existsSync(f)) continue;
    try { const m = JSON.parse(readFileSync(f, 'utf8')); Object.assign(map.stages, m.stages || {}); map.at = m.at || map.at; map.head = m.head || map.head; } catch { /* a torn map file: that shard's stages stay unmapped */ } }
  return map;
}

/** The shards' results as ONE suite record. A shard that never reported is a SETUP fault (`pack-` prefix = runner fault in
 *  runnerguard), never a red check: a missing shard must not read as green and must not open per-check RED issues. */
export function mergeShards(dir, n = 16) {
  const failed = []; let ran = 0; const skippedInSlice = [], flaky = [], timedOut = [], mirrorFaults = []; let out = '';
  for (let i = 0; i < n; i++) {
    const jf = join(dir, `shard-${i}.json`);
    if (!existsSync(jf)) { failed.push(`pack-shard-${i}-missing`); continue; }
    const s = JSON.parse(readFileSync(jf, 'utf8'));
    // #9642: a shard that hit its wall or could not build/ledger is a MIRROR fault, never a red check and never this PC's: its stages did not conclude
    const setup = (s.failed || []).filter((x) => /^pack-shard-/.test(x));
    if (setup.length) { mirrorFaults.push(...setup.map((x) => `${x} (shard ${s.i ?? i})`)); skippedInSlice.push(...(s.ids || []).filter((x) => !(s.failed || []).includes(x))); s.failed = (s.failed || []).filter((x) => !setup.includes(x)); }
    ran += s.ran || 0; failed.push(...(s.failed || [])); skippedInSlice.push(...(s.skippedInSlice || [])); flaky.push(...(s.flaky || [])); timedOut.push(...(s.timedOut || []));
    const lf = join(dir, `shard-${i}.log`); if (existsSync(lf)) out += readFileSync(lf, 'utf8') + '\n';
  }
  return { out, ledger: { failedStages: [...new Set(failed)], ran, skipped: skippedInSlice, flaky: [...new Set(flaky)], timedOut: [...new Set(timedOut)], mirrorFaults } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [i, n] = [Number(process.argv[2]), Number(process.argv[3] || 16)];
  const root = process.cwd(); // #7200: a hung stage must never eat the whole shard job (shard 15 sat 50 min on 13 Oct, was killed by the job timeout and wrote nothing, so the whole run aborted).
  // Each stage gets 12 min (suite.mjs' own kill, default 30), and each suite call has a hard wall (first run 32 min, retry 10) so shard-<i>.json is ALWAYS written.
  const run = (a, env = {}, wallMin = 32) => spawnSync('node', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 27, timeout: wallMin * 60000, killSignal: 'SIGKILL', env: { ...process.env, MCLITE_PRESET: 'medium', MCLITE_STAGE_TIMEOUT_MIN: process.env.MCLITE_STAGE_TIMEOUT_MIN || '12', ...env } });
  mkdirSync(join(root, 'shard-out'), { recursive: true });
  const all = slice(stageIds(root), i, n, readTimes(root));
  // #7184-follow-up: stages that need a real GPU/CPU speed do not run on the hosted mirror (MCLITE_HOSTED=1); they are reported as not run, so no RED issue opens or closes for them
  const unfit = (() => { try { return JSON.parse(readFileSync(join(root, 'tools', 'hosted-unfit.json'), 'utf8')); } catch { return {}; } })();
  const skipUnfit = process.env.MCLITE_HOSTED === '1' ? all.filter((x) => unfit[x]) : [];
  const ids = all.filter((x) => !skipUnfit.includes(x));
  const b = run(['tools/suite.mjs', '--fast', '--to', 'build']);
  let rec;
  if (b.status) rec = { i, n, ids, ran: 0, failed: ['pack-shard-build'], skippedInSlice: skipUnfit, log: (b.stdout + b.stderr).slice(-60000) };
  else {
    const r = run(['tools/suite.mjs', '--map', '--only', ids.join(',')]);   // #7765: --map -> this shard's slice of the stage -> files map
    try { copyFileSync(join(root, '.ledger', 'tia-map.json'), join(root, 'shard-out', `tia-map-${i}.json`)); } catch { /* no map from this shard */ }
    let l = {}; try { l = JSON.parse(readFileSync(join(root, '.ledger', 'suite-last.json'), 'utf8')); } catch { /* no ledger: shard counts as setup fault */ }
    const sec = { ...(l.stageSec || {}) };
    // #9251: a shard killed by its wall writes no ledger, but suite.mjs printed one row per finished stage: keep those seconds (the planner needs the slow ones most)
    if (r.status === null) for (const [k, v] of Object.entries(rowSeconds(r.stdout))) if (!(k in sec)) sec[k] = v;
    const sk = (l.skipped || []).map((x) => (typeof x === 'string' ? x : x.id)); const set = new Set(ids);
    rec = { i, n, ids, stageSec: sec, ran: l.ran || 0, failed: r.status === null ? ['pack-shard-timeout'] : (l.failedStages || (l.ran ? [] : ['pack-shard-noledger'])), skippedInSlice: [...sk.filter((x) => set.has(x)), ...skipUnfit], flaky: [], log: ((r.stdout || '') + (r.stderr || '')) };
    // #7184: a stage that failed gets ONE more run on its own (a headless Chrome that did not come up in time on a loaded hosted runner, a
    // 14 s streaming deadline). Red = failed twice. Passed the second time = `flaky`: reported, never red. Setup faults (pack-*) are not retried.
    const again = rec.failed.filter((x) => set.has(x) && !lastRowTimedOut(rec.log, [x]).length);   // #9651: a TIMEOUT is not retried (inconclusive already; the 10-min retry wall would kill the 12-min stage before it prints a row)
    if (again.length) {
      try { unlinkSync(join(root, '.ledger', 'suite-last.json')); } catch { /* none */ }   // #9651: a killed retry must not read the first run's ledger as its own
      const r2 = run(['tools/suite.mjs', '--only', again.join(',')], {}, 10);
      let l2 = null; try { l2 = JSON.parse(readFileSync(join(root, '.ledger', 'suite-last.json'), 'utf8')); } catch { /* no second ledger: the first verdict stands */ }
      if (l2 && Array.isArray(l2.failedStages) && l2.ran > 0) {
        const still = new Set(l2.failedStages); rec.flaky = again.filter((x) => !still.has(x));
        rec.failed = rec.failed.filter((x) => !rec.flaky.includes(x));
      }
      if (l2 && l2.stageSec) for (const [k, v] of Object.entries(l2.stageSec)) sec[k] = (sec[k] || 0) + v;   // a retry is real cost
      rec.log += '\n=== RETRY of the failed stages (' + again.join(',') + ') ===\n' + r2.stdout + r2.stderr;
    }
    { rec.timedOut = lastRowTimedOut(rec.log, rec.failed); rec.failed = rec.failed.filter((x) => !rec.timedOut.includes(x)); }   // timeout-only = inconclusive, never a RED issue
  }
  try { const { collectProof } = await import('../mobproof-merge.mjs'); const P = collectProof(join(root, 'tools', 'mobproof', 'out'), process.env.GITHUB_SHA || ''); rec.sha = P.sha; rec.proof = P.proof; } catch { /* no proof from this shard */ }   // #8670
  writeFileSync(join(root, 'shard-out', `shard-${i}.log`), rec.log || ''); delete rec.log;
  writeFileSync(join(root, 'shard-out', `shard-${i}.json`), JSON.stringify(rec));
  console.log(`shard ${i}/${n}: ${ids.length} stages, ran ${rec.ran}, failed ${rec.failed.length}${rec.failed.length ? ' (' + rec.failed.join(',') + ')' : ''}, flaky ${rec.flaky.length}${rec.flaky.length ? ' (' + rec.flaky.join(',') + ')' : ''}, did not run ${rec.skippedInSlice.length}`);
}
