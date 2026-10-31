// tools/mirrorcapcheck.mjs - #7726 (Dan, 16 Oct): the lockstep pilot cap follows the test mirror's live headroom (infra/mirrorcap.mjs), never a constant.
// Rules: headroom decides; jobsPerPilot is measured; an unreadable / missing / >5 min stale read falls back to the "auto" cap; a held pilot is never evicted;
// a read error is a fallback, not cap 0; the read is cached 60 s. Anti-vacuity: every break below must be caught.
import { readFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as M from './infra/mirrorcap.mjs';
const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const GO = rd('./go.mjs'), ROLES = rd('./brain/roles.json');
const NOW = 1e12, rdg = (used, samples = [], age = 0) => ({ at: NOW - age, used, samples });
const fakeFetch = (log, fail) => async (url) => {
  log.push(url); if (fail) throw new Error('net down');
  const j = (o) => ({ ok: true, json: async () => o });
  if (/runs\?status=queued/.test(url)) return j({ workflow_runs: [{ id: 1 }] });
  if (/runs\?status=in_progress/.test(url)) return j({ workflow_runs: [{ id: 2 }] });
  if (/runs\?status=completed/.test(url)) return j({ workflow_runs: [{ id: 3, name: 'ci-pilot' }, { id: 4, name: 'ci' }, { id: 5, name: 'ci-pilot' }] });
  if (/runs\/1\/jobs/.test(url)) return j({ jobs: [{ status: 'queued' }, { status: 'queued' }, { status: 'completed' }] });
  if (/runs\/2\/jobs/.test(url)) return j({ jobs: [{ status: 'in_progress' }] });
  return j({ total_count: 6, jobs: [] });
};
const verdict = ({ jpp, cap, cached, go, roles }) => {
  const bad = [], eq = (got, want, what) => { if (got !== want) bad.push(`${what}: got ${got}, want ${want}`); };
  const c = (o) => cap({ now: NOW, held: 0, budget: 14, fallback: 3, ...o }).cap;
  eq(c({ reading: rdg(0) }), 1, 'idle mirror, no samples (J=20): one pilot may start');
  eq(c({ reading: rdg(14) }), 0, 'budget used up: nothing new');
  eq(c({ reading: rdg(0, [2, 2]) }), 7, 'J=2 measured: 14/2 = 7 pilots fit');
  eq(c({ reading: rdg(4, [5, 5]), held: 1 }), 2, 'J=5, 4 used, 1 held: one more');
  eq(c({ reading: rdg(10, [5, 5]), held: 1 }), 1, 'J=5, 10 used, 1 held: none more');
  eq(c({ reading: rdg(20), held: 2 }), 2, 'a mirror at 20/20 never evicts the 2 held pilots');
  eq(c({ reading: null }), 3, 'no reading: the "auto" fallback');
  eq(c({ reading: rdg(14, [], 6 * 60e3) }), 3, 'a reading 6 min old is stale: the fallback, not the (busy) reading');
  eq(c({ reading: rdg(0, [], 4 * 60e3) }), 1, 'a reading 4 min old is still trusted');
  eq(c({ reading: null, held: 5 }), 5, 'fallback below the held count never evicts');
  eq(jpp([]).jobs, 20, 'no samples: 20');
  eq(jpp([4, 6]).jobs, 5, 'jobsPerPilot is the mean of the measured runs'); eq(jpp([4, 6]).runs, 2, 'samples counted');
  eq(jpp([3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 90]).jobs, 3, 'only the last ~10 runs count');
  return bad;
};
const verdictRead = async (cached) => {
  const bad = [], log = [], file = join(mkdtempSync(join(tmpdir(), 'mcap-')), 'c.json');
  const r1 = await cached({ repo: 'o/r', token: 't', f: fakeFetch(log), now: NOW, file });
  if (!r1 || r1.used !== 3 || r1.samples.join() !== '6,6') bad.push(`live read: got ${JSON.stringify(r1)}, want used 3 samples 6,6`);
  const n = log.length; await cached({ repo: 'o/r', token: 't', f: fakeFetch(log), now: NOW + 30e3, file });
  if (log.length !== n) bad.push('a 30 s old reading was read again (60 s cache)');
  await cached({ repo: 'o/r', token: 't', f: fakeFetch(log), now: NOW + 70e3, file });
  if (log.length === n) bad.push('a 70 s old reading was not refreshed');
  const e = await cached({ repo: 'o/r', token: 't', f: fakeFetch([], true), now: NOW + 400e3, file: join(tmpdir(), 'mcap-none-' + process.pid + '.json') });
  if (e !== null) bad.push('failed read with no cache must be null (fallback), got ' + JSON.stringify(e));
  const st = await cached({ repo: 'o/r', token: 't', f: fakeFetch([], true), now: NOW + 400e3, file });
  if (!st || st.at !== NOW + 70e3) bad.push('failed read must hand back the last cached reading (it goes stale by age, not by erasure)');
  if ((await cached({ repo: '', token: '', f: fakeFetch([], false), now: NOW, file: file + 'x' })) !== null) bad.push('missing credentials must give null');
  return bad;
};
const wire = ({ go, roles }) => {
  const bad = [], f = JSON.parse(roles).fill;
  if (f.lockstepPilotCap !== 'mirror') bad.push('roles.json fill.lockstepPilotCap must be "mirror"');
  if (!(f.mirrorJobBudget > 0 && f.mirrorJobBudget < 20)) bad.push('fill.mirrorJobBudget must be 1..19 (ci and ci-full keep the rest)');
  if (!/mirrorCap\(\{ reading, now: Date\.now\(\), held: pilots\.held, budget: Number\(mirrorMode\.mirrorJobBudget\) \|\| 0, fallback: pilotCap \}\)/.test(go) || !/cachedReading\(\{ repo: process\.env\.MIRROR_REPO, token: process\.env\.MIRROR_TOKEN \}\)\.catch\(\(\) => null\)/.test(go)) bad.push('go.mjs queue() does not feed mirrorCap the cached live reading, the held count, the budget and the fallback');
  if (!/pilotCap = pilots\.cap = pilots\.mirror\.cap;/.test(go)) bad.push('go.mjs queue() does not apply the mirror cap');
  if (!/mirror headroom: \$\{m\.jobs\} jobs running\+queued of 20 \(budget \$\{m\.budget\}\), jobsPerPilot \$\{m\.jobsPerPilot\} \(measured from \$\{m\.runs\} runs\) -> cap \$\{m\.cap\} \(held \$\{m\.held\}\)/.test(go)) bad.push('go.mjs status does not print the mirror headroom line');
  return bad;
};
const REAL = { jpp: M.jobsPerPilot, cap: M.mirrorCap, cached: M.cachedReading, go: GO, roles: ROLES };
const BREAKS = [
  ['headroom ignored', { cap: (o) => M.mirrorCap({ ...o, reading: rdg(0, o.reading && o.reading.samples, 0) }) }],
  ['fallback removed (null reading trusted as idle)', { cap: (o) => M.mirrorCap({ ...o, reading: o.reading || rdg(0) }) }],
  ['stale cache trusted', { cap: (o) => M.mirrorCap({ ...o, reading: o.reading && { ...o.reading, at: o.now } }) }],
  ['held pilot evicted', { cap: (o) => { const r = M.mirrorCap(o); return { ...r, cap: r.fallback ? r.cap : Math.min(r.cap, Math.max(0, o.budget - o.reading.used > 0 ? 99 : 0)) }; } }],
  ['jobsPerPilot hard-coded', { jpp: () => ({ jobs: 20, runs: 0 }) }],
  ['jobsPerPilot hard-coded to a guess', { jpp: () => ({ jobs: 4, runs: 1 }) }],
  ['read error swallowed into cap 0', { cap: (o) => (o.reading ? M.mirrorCap(o) : { cap: 0 }) }],
  ['held reserve dropped', { cap: (o) => ({ cap: o.held + M.mirrorCap({ ...o, held: 0 }).cap }) }],
  ['reading cache never reused', { cached: (o) => M.cachedReading({ ...o, file: o.file + Math.random() }) }],
  ['failed read erases the cache', { cached: async (o) => { const r = await M.cachedReading(o); return r && r.at < o.now - 60e3 ? null : r; } }],
  ['roles.json still the constant', { roles: ROLES.replace('"lockstepPilotCap": "mirror"', '"lockstepPilotCap": 3') }],
  ['no budget', { roles: ROLES.replace('"mirrorJobBudget": 14', '"mirrorJobBudget": 20') }],
  ['go.mjs ignores the mirror', { go: GO.replace('pilotCap = pilots.cap = pilots.mirror.cap;', '') }],
  ['status line missing', { go: GO.replace('mirror headroom: ${m.jobs}', 'mirror: ${m.jobs}') }],
];
const run = async (o) => [...verdict(o), ...(await verdictRead(o.cached)), ...wire(o)];
const bad0 = await run(REAL); let caught = 0, n = 0;
for (const [name, over] of BREAKS) { n++; if ((await run({ ...REAL, ...over })).length) caught++; else console.log(' NOT CAUGHT:', name); }
for (const x of bad0) console.log(' FAIL:', x);
console.log(`mirrorcapcheck: ${caught} breaks caught (of ${n})`);
process.exit(bad0.length || caught < n ? 1 : 0);
