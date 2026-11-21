// mirrorcap.mjs - #7726 (Dan, 16 Oct: "the lockstep pilot cap follows the GitHub test mirror's real headroom instead of a hand-set number.
// Self-calibrating, never a constant."). Pilots run one hosted job per salt on the public test mirror, which allows 20 concurrent free jobs shared
// with ci and the 16-shard ci-full. Pure rules + one cached live read; mirrorcapcheck proves them.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
export const MIRROR_LIMIT = 20, CACHE_MS = 60e3, STALE_MS = 5 * 60e3, SAMPLE_RUNS = 10;
/** jobs dispatched per finished ci-pilot run, MEASURED: mean of the samples (job counts), rounded up; 20 until there are samples. */
export function jobsPerPilot(samples) {
  const s = (samples || []).filter((n) => Number.isFinite(n) && n > 0).slice(0, SAMPLE_RUNS);
  return s.length ? { jobs: Math.max(1, Math.ceil(s.reduce((a, b) => a + b, 0) / s.length)), runs: s.length } : { jobs: MIRROR_LIMIT, runs: 0 };
}
/** The cap. reading = { at, used (running+queued jobs), samples } or null. fallback = the old "auto" value. A held pilot is never evicted: cap >= held.
 *  Another pilot may be held while used + held*J < budget (J reserved per pilot already held). */
export function mirrorCap({ reading, now, held, budget, fallback }) {
  const J = jobsPerPilot(reading && reading.samples);
  const base = { jobs: reading ? reading.used : null, budget, jobsPerPilot: J.jobs, runs: J.runs, held };
  if (!reading || !Number.isFinite(reading.used) || !Number.isFinite(reading.at) || now - reading.at > STALE_MS || !(budget > 0))
    return { ...base, cap: Math.max(held, fallback), fallback: true };
  const extra = Math.max(0, Math.ceil((budget - reading.used - held * J.jobs) / J.jobs));
  return { ...base, cap: held + extra, fallback: false };
}
const API = 'https://api.github.com';
async function gj(path, repo, token, f) {
  const r = await f(`${API}/repos/${repo}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`mirror ${path} -> ${r.status}`);
  return r.json();
}
/** One live read: running+queued jobs over queued and in_progress runs, and the job counts of the last finished ci-pilot runs. Throws on any failure. */
export async function readMirror({ repo, token, f = fetch, now = Date.now() }) {
  if (!repo || !token) throw new Error('no mirror credentials');
  let used = 0;
  for (const st of ['queued', 'in_progress']) {
    const runs = (await gj(`/actions/runs?status=${st}&per_page=100`, repo, token, f)).workflow_runs;
    if (!Array.isArray(runs)) throw new Error('mirror runs unreadable');
    for (const r of runs) used += (await gj(`/actions/runs/${r.id}/jobs?filter=latest&per_page=100`, repo, token, f)).jobs.filter((j) => j.status === 'queued' || j.status === 'in_progress').length;
  }
  const done = (await gj(`/actions/workflows/ci-pilot.yml/runs?status=completed&per_page=30`, repo, token, f)).workflow_runs.filter((r) => r.name === 'ci-pilot').slice(0, SAMPLE_RUNS);
  const samples = []; for (const r of done) samples.push((await gj(`/actions/runs/${r.id}/jobs?filter=latest&per_page=1`, repo, token, f)).total_count);
  return { at: now, used, samples };
}
/** readMirror behind a 60 s file cache. A failed read returns the last cached reading (which mirrorCap treats as stale after 5 min) or null. */
export async function cachedReading({ repo, token, f = fetch, now = Date.now(), file = join(tmpdir(), 'mclite-mirror-headroom.json') } = {}) {
  let c = null; try { c = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  if (c && Number.isFinite(c.at) && now - c.at < CACHE_MS) return c;
  try { const r = await readMirror({ repo, token, f, now }); try { writeFileSync(file, JSON.stringify(r)); } catch {} return r; } catch { return c; }
}
