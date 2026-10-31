// metricsruncheck (#9191, 22 Oct): tools/infra/metricsrun.mjs refreshes the throughput/cost figures on the brain VM (metrics.yml, hosted minutes, was dead since 8 Oct).
// RUNS metricsDue/runMetrics with injected git/node, checks the brain health pass calls it and that the dead hosted workflows are really gone. One check mark per caught break.
import { readFileSync, existsSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url)), SRC = readFileSync(join(TOOLS, 'infra', 'metricsrun.mjs'), 'utf8'), BRAIN = readFileSync(join(TOOLS, 'brain', 'brain.mjs'), 'utf8');
async function verdict(src, brain, wf = (f) => existsSync(join(TOOLS, '..', '.github', 'workflows', f))) {
  const bad = []; const t = (n, c) => { if (!c) bad.push(n); };
  const d = mkdtempSync(join(tmpdir(), 'mrc-')); writeFileSync(join(d, 'metricsrun.mjs'), src); writeFileSync(join(d, 'gitenv.mjs'), readFileSync(join(TOOLS, 'infra', 'gitenv.mjs')));   // metricsrun imports ./gitenv.mjs (#8356)
  const m = await import(pathToFileURL(join(d, 'metricsrun.mjs')).href + '?' + Math.random());
  const now = 1e12;
  t('due when never run', m.metricsDue(undefined, now) === true);
  t('not due 10 min after a run', m.metricsDue(now - 10 * 60e3, now) === false);
  t('due 31 min after a run', m.metricsDue(now - 31 * 60e3, now) === true);
  const root = join(d, 'repo'); mkdirSync(join(root, '_status'), { recursive: true }); writeFileSync(join(root, '_status', 'metrics.html'), '<html>'); writeFileSync(join(root, '_status', 'metrics.json'), '{}');
  const calls = [];
  const git = (a, o) => { calls.push(a.filter((x) => !String(x).startsWith('http.https')).join(' ')); if (a.includes('show')) return Buffer.from('{"runs":[]}'); return Buffer.from(''); };
  const node = (a) => { calls.push('node ' + a.join(' ')); return { status: 0, stderr: '' }; };
  let ok = false; try { ok = m.runMetrics({ root, token: 't0k', repo: 'o/r', git, node }) === 'pushed metrics branch'; } catch (e) { ok = false; }
  t('runs and reports a push', ok);
  t('restores the history from the metrics branch before building', calls.findIndex((c) => /fetch .*origin metrics/.test(c)) >= 0 && calls.findIndex((c) => /fetch .*origin metrics/.test(c)) < calls.findIndex((c) => c.startsWith('node tools/metrics.mjs')));
  t('builds with tools/metrics.mjs', calls.some((c) => c === 'node tools/metrics.mjs'));
  t('pushes the metrics branch with force', calls.some((c) => /push -qf https:\/\/github\.com\/o\/r\.git metrics/.test(c)));
  { const e0 = [process.env.MCLITE_REPO, process.env.GITHUB_REPOSITORY]; process.env.MCLITE_REPO = 'priv/repo'; process.env.GITHUB_REPOSITORY = 'pub/mirror'; calls.length = 0;   // #10420: the hosted tick runs IN the public mirror: the figures belong to the private repo
    try { m.runMetrics({ root, token: 't0k', git, node }); } catch { /* judged below */ }
    t('hosted tick: pushes to MCLITE_REPO, never the public GITHUB_REPOSITORY', calls.some((c) => /push -qf https:\/\/github\.com\/priv\/repo\.git metrics/.test(c)) && !calls.some((c) => /pub\/mirror/.test(c)));
    if (e0[0] === undefined) delete process.env.MCLITE_REPO; else process.env.MCLITE_REPO = e0[0]; if (e0[1] === undefined) delete process.env.GITHUB_REPOSITORY; else process.env.GITHUB_REPOSITORY = e0[1]; }
  let threw = false; try { m.runMetrics({ root, token: '', repo: 'o/r', git, node }); } catch { threw = true; } t('refuses without a token', threw);
  let failed = false; try { m.runMetrics({ root, token: 'x', repo: 'o/r', git, node: () => ({ status: 3, stderr: 'boom' }) }); } catch { failed = true; } t('a failing metrics.mjs is an error, not a push', failed);
  t('the brain health pass calls it', /metricsrun\.mjs/.test(brain) && /runMetrics\(\)/.test(brain) && /metricsDue\(hm\.lastMetrics, now\)/.test(brain));
  t('heartbeat.yml and metrics.yml are gone', !wf('heartbeat.yml') && !wf('metrics.yml'));
  rmSync(d, { recursive: true, force: true }); return bad;
}
const real = await verdict(SRC, BRAIN); let caught = 0;
const BREAKS = [
  ['never due', SRC.replace('!last || now - last >= everyMin * 60e3', 'false'), BRAIN],
  ['always due', SRC.replace('!last || now - last >= everyMin * 60e3', 'true'), BRAIN],
  ['no history restore', SRC.replace("'fetch', '-q', '--depth', '1', 'origin', 'metrics'", "'status'"), BRAIN],
  ['push is not forced', SRC.replace("'push', '-qf'", "'push', '-q'"), BRAIN],
  ['metrics.mjs failure ignored', SRC.replace("if (r.status !== 0) throw", "if (false) throw"), BRAIN],
  ['no token guard', SRC.replace("if (!token) throw new Error('no GH_TOKEN');", ''), BRAIN],
  ['pushes to the public GITHUB_REPOSITORY', SRC.replace('process.env.MCLITE_REPO || process.env.GITHUB_REPOSITORY', 'process.env.GITHUB_REPOSITORY'), BRAIN],
  ['brain stops calling it', SRC, BRAIN.replace('runMetrics()', 'runMetricsX()')],
];
for (const [n, s, b] of BREAKS) { if ((await verdict(s, b)).length) { caught++; console.log(' \u2713 break caught: ' + n); } else console.log(' NOT CAUGHT: ' + n); }
const gone = await verdict(SRC, BRAIN, () => true); if (gone.length) { caught++; console.log(' \u2713 break caught: dead workflow still present'); } else console.log(' NOT CAUGHT: dead workflow present');
for (const x of real) console.log(' FAIL: ' + x);
console.log(`metricsruncheck: ${real.length ? 'FAILED' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length + 1})`);
process.exit(real.length || caught < BREAKS.length + 1 ? 1 : 0);
