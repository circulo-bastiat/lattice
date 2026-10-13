// tools/infra/fullshard.mjs - hosted-runner cutover (Dan, 6 Oct 2026: tests run on GitHub's free runners, never on his PC).
//   node tools/infra/fullshard.mjs <i> <n>   build, then run slice i of n of EVERY stage id; writes shard-out/shard-<i>.{json,log}
//   mergeShards(dir, n)                      what full.mjs reads in the aggregate job (FULL_AGG_DIR)
// A stage file's NAME is not its id (117 of 788 differ, found 7 Oct) and one file may hold several: ids come from the JSON.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function stageIds(root) {
  const dir = join(root, 'tools', 'stages.d'); const ids = [];
  for (const f of readdirSync(dir)) { if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8')); for (const e of Array.isArray(j) ? j : [j]) ids.push(e.id); }
  return ids.sort();
}
export const slice = (ids, i, n) => ids.filter((_, k) => k % n === i);

/** The shards' results as ONE suite record. A shard that never reported is a SETUP fault (`pack-` prefix = runner fault in
 *  runnerguard), never a red check: a missing shard must not read as green and must not open per-check RED issues. */
export function mergeShards(dir, n = 16) {
  const failed = []; let ran = 0; const skippedInSlice = [], flaky = []; let out = '';
  for (let i = 0; i < n; i++) {
    const jf = join(dir, `shard-${i}.json`);
    if (!existsSync(jf)) { failed.push(`pack-shard-${i}-missing`); continue; }
    const s = JSON.parse(readFileSync(jf, 'utf8'));
    ran += s.ran || 0; failed.push(...(s.failed || [])); skippedInSlice.push(...(s.skippedInSlice || [])); flaky.push(...(s.flaky || []));
    const lf = join(dir, `shard-${i}.log`); if (existsSync(lf)) out += readFileSync(lf, 'utf8') + '\n';
  }
  return { out, ledger: { failedStages: [...new Set(failed)], ran, skipped: skippedInSlice, flaky: [...new Set(flaky)] } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [i, n] = [Number(process.argv[2]), Number(process.argv[3] || 16)];
  const root = process.cwd(); const run = (a, env = {}) => spawnSync('node', a, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 27, env: { ...process.env, MCLITE_PRESET: 'medium', ...env } });
  mkdirSync(join(root, 'shard-out'), { recursive: true });
  const all = slice(stageIds(root), i, n);
  // #7184-follow-up: stages that need a real GPU/CPU speed do not run on the hosted mirror (MCLITE_HOSTED=1); they are reported as not run, so no RED issue opens or closes for them
  const unfit = (() => { try { return JSON.parse(readFileSync(join(root, 'tools', 'hosted-unfit.json'), 'utf8')); } catch { return {}; } })();
  const skipUnfit = process.env.MCLITE_HOSTED === '1' ? all.filter((x) => unfit[x]) : [];
  const ids = all.filter((x) => !skipUnfit.includes(x));
  const b = run(['tools/suite.mjs', '--fast', '--to', 'build']);
  let rec;
  if (b.status) rec = { i, n, ids, ran: 0, failed: ['pack-shard-build'], skippedInSlice: skipUnfit, log: (b.stdout + b.stderr).slice(-60000) };
  else {
    const r = run(['tools/suite.mjs', '--only', ids.join(',')]);
    let l = {}; try { l = JSON.parse(readFileSync(join(root, '.ledger', 'suite-last.json'), 'utf8')); } catch { /* no ledger: shard counts as setup fault */ }
    const sk = (l.skipped || []).map((x) => (typeof x === 'string' ? x : x.id)); const set = new Set(ids);
    rec = { i, n, ids, ran: l.ran || 0, failed: l.failedStages || (l.ran ? [] : ['pack-shard-noledger']), skippedInSlice: [...sk.filter((x) => set.has(x)), ...skipUnfit], flaky: [], log: (r.stdout + r.stderr) };
    // #7184: a stage that failed gets ONE more run on its own (a headless Chrome that did not come up in time on a loaded hosted runner, a
    // 14 s streaming deadline). Red = failed twice. Passed the second time = `flaky`: reported, never red. Setup faults (pack-*) are not retried.
    const again = rec.failed.filter((x) => set.has(x));
    if (again.length) {
      const r2 = run(['tools/suite.mjs', '--only', again.join(',')]);
      let l2 = null; try { l2 = JSON.parse(readFileSync(join(root, '.ledger', 'suite-last.json'), 'utf8')); } catch { /* no second ledger: the first verdict stands */ }
      if (l2 && Array.isArray(l2.failedStages) && l2.ran > 0) {
        const still = new Set(l2.failedStages); rec.flaky = again.filter((x) => !still.has(x));
        rec.failed = rec.failed.filter((x) => !rec.flaky.includes(x));
      }
      rec.log += '\n=== RETRY of the failed stages (' + again.join(',') + ') ===\n' + r2.stdout + r2.stderr;
    }
  }
  writeFileSync(join(root, 'shard-out', `shard-${i}.log`), rec.log || ''); delete rec.log;
  writeFileSync(join(root, 'shard-out', `shard-${i}.json`), JSON.stringify(rec));
  console.log(`shard ${i}/${n}: ${ids.length} stages, ran ${rec.ran}, failed ${rec.failed.length}${rec.failed.length ? ' (' + rec.failed.join(',') + ')' : ''}, flaky ${rec.flaky.length}${rec.flaky.length ? ' (' + rec.flaky.join(',') + ')' : ''}, did not run ${rec.skippedInSlice.length}`);
}
