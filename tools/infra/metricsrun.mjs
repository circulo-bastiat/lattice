// metricsrun.mjs (#9191, 22 Oct, Dan: "move metrics to a brain-VM job"): metrics.yml needed hosted minutes the private repo does not have (failed every run since 8 Oct).
// The brain health pass now refreshes the throughput/cost figures every 30 min on the VM: restore the history from the `metrics` branch, run tools/metrics.mjs, push the result back.
import { execFileSync, spawnSync } from 'node:child_process';
import { gitExec } from './gitenv.mjs';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export const metricsDue = (last, now, everyMin = 30) => !last || now - last >= everyMin * 60e3;
export function runMetrics({ root = process.cwd(), token = process.env.GH_TOKEN, repo = process.env.MCLITE_REPO || process.env.GITHUB_REPOSITORY || 'owner/mclite', git = (args, o = {}) => gitExec(args, { stdio: 'pipe', ...o }), node = (args, o) => spawnSync(process.execPath, args, { stdio: 'pipe', ...o }) } = {}) {
  if (!token) throw new Error('no GH_TOKEN');
  const auth = `http.https://github.com/.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString('base64')}`;
  mkdirSync(join(root, '_status'), { recursive: true });
  try { writeFileSync(join(root, '_status', 'metrics.json'), git(['-c', auth, '-C', root, 'show', '--no-textconv', (git(['-c', auth, '-C', root, 'fetch', '-q', '--depth', '1', 'origin', 'metrics']), 'FETCH_HEAD:metrics.json')])); } catch { /* first run: no history yet */ }
  const r = node(['tools/metrics.mjs'], { cwd: root, timeout: 120000, env: { ...process.env, GH_TOKEN: token, GH_REPO: repo } });
  if (r.status !== 0) throw new Error('metrics.mjs exit ' + r.status + ' ' + String(r.stderr || '').slice(0, 120));
  const d = mkdtempSync(join(tmpdir(), 'metrics-'));
  try {
    for (const f of ['metrics.json', 'metrics.html']) copyFileSync(join(root, '_status', f), join(d, f));
    git(['init', '-q', '-b', 'metrics'], { cwd: d }); git(['add', '.'], { cwd: d });
    git(['-c', 'user.name=metrics', '-c', 'user.email=metrics@users.noreply.github.com', 'commit', '-qm', `metrics ${new Date().toISOString()}`], { cwd: d });
    git(['-c', auth, 'push', '-qf', `https://github.com/${repo}.git`, 'metrics'], { cwd: d });
  } finally { try { rmSync(d, { recursive: true, force: true }); } catch { /* scratch */ } }
  return 'pushed metrics branch';
}
