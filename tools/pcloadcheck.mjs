// pcloadcheck (#10414): the ratchet on Dan's PC load. Every private-repo workflow job that still runs on a self-hosted runner (= a process on his machines)
// must be listed here with why; a new self-hosted job fails until it is listed on purpose, a listed one that went hosted fails until it is struck off.
// Then each rule is broken to prove the check fails.
import fs from 'node:fs';
const DIR = '.github/workflows';
// file:job -> why it is still on the PC (shrinks as the move lands; retire = delete the line)
const ALLOWED = {
  'brain.yml:route': 'brain VM until BRAIN_RUNNER=mirror is the only path (scheduled ticks already skip it)',
  'brain.yml:run': 'brain VM role runner (workers) until the mirror worker pool replaces it',
  'full-suite.yml:full-pc': 'TEST_RUNNER=pc fallback; the 4 GPU-only stages',
  'localcopy.yml:copy': 'syncs the folder on the PC itself',
  'pilot-farm.yml:farm': 'private repo has no hosted minutes (#9425)',
  'ram-report.yml:report': 'measures the PC itself',
  'relay.yml:relay': 'PC phone relay',
  'smoke.yml:smoke': 'real-GPU smoke',
  'usagetest.yml:usagetest': 'reads PC-side usage',
  'vm-cap.yml:cap': 'caps the Hyper-V VM on the PC itself',
};
function selfHosted(files) {
  const out = [];
  for (const [f, t] of Object.entries(files)) {
    let job = null, inJobs = false;
    for (const l of t.split('\n')) {
      if (/^jobs:/.test(l)) { inJobs = true; continue; }
      if (/^\S/.test(l) && !/^jobs:/.test(l)) inJobs = false;
      const m = inJobs && /^  ([A-Za-z0-9_-]+):\s*$/.exec(l);
      if (m) job = m[1];
      if (inJobs && job && /^\s{4}runs-on:.*self-hosted/.test(l)) out.push(`${f}:${job}`);
    }
  }
  return out;
}
const SRC = Object.fromEntries(fs.readdirSync(DIR).filter((f) => f.endsWith('.yml')).map((f) => [f, fs.readFileSync(`${DIR}/${f}`, 'utf8')]));
function verdict(files, allowed) {
  const bad = [], now = selfHosted(files);
  for (const k of now) if (!allowed[k]) bad.push(`${k} runs on a self-hosted runner (PC load) and is not in ALLOWED`);
  for (const k of Object.keys(allowed)) if (!now.includes(k)) bad.push(`${k} is listed but no longer self-hosted: strike it off`);
  return bad;
}
const withJob = { ...SRC, 'new.yml': 'jobs:\n  x:\n    runs-on: [self-hosted, mclite]\n' };
const hosted = { ...SRC, 'smoke.yml': SRC['smoke.yml'].replace(/runs-on:.*self-hosted.*/, 'runs-on: ubuntu-latest') };
const breaks = [
  [withJob, ALLOWED], [hosted, ALLOWED], [SRC, { ...ALLOWED, 'ghost.yml:g': 'x' }],
  [SRC, Object.fromEntries(Object.entries(ALLOWED).filter(([k]) => k !== 'vm-cap.yml:cap'))],
  [{ ...SRC, 'bench.yml': SRC['bench.yml'].replace('ubuntu-latest', '[self-hosted, brain]') }, ALLOWED],
];
let bad = verdict(SRC, ALLOWED); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; breaks.forEach(([f, a], i) => { if (verdict(f, a).length) caught++; else console.log('NOT CAUGHT: break #' + (i + 1)); });
console.log(`pcloadcheck: ${Object.keys(ALLOWED).length} PC jobs listed, ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
if (caught < breaks.length) bad = bad.concat('vacuous');
process.exit(bad.length ? 1 : 0);
