// tools/infra/runnerguard.mjs - #3568: a broken RUNNER must never look like a broken MASTER. 6 Oct: DADS ran the full
// suite with a bad environment, 360 of 816 stages failed and ~338 false "RED <check>" issues reached the worker queue.
// envFault() is PURE (runnerguardcheck tests it); the rest are the GitHub calls full.mjs, the brain and `go.mjs runner` share.
export const FAULT_LABEL = 'env-fault';              // never handed to a worker (go.mjs queue, brain fill)
export const SMOKE_PASSED = 'smoke-passed';        // on a fault issue: smoke.yml passed, the brain restores the runner
export const GATED = ['gpu', 'express'];             // the labels that give a runner work; quarantine removes them
export const faultTitle = (name) => `runner ${name} environment fault`;
const SETUP = /^(pack-|assets$|build$|suite-ledger-missing$)/;

/** failed: red stage ids in suite order; ran: stages that ran; prev: the previous run's failed ids (null = unknown).
 *  Only NEW failures (not in prev) count: known reds are master's, not the runner's. -> a reason string, or null. */
export function envFault({ failed, ran, prev = null, prevFault = null, maxFailed = 15, maxFrac = 0.1 }) {
  const old = new Set(prev || []), f = (failed || []).filter((id) => !old.has(id));
  if (!f.length) return null;
  // #6627: the SAME mass failure twice in a row is master's red, not the runner (12 Oct: a real engine regression broke 41 checks,
  // was called a fault, the fault branch never moved the baseline, so its reds would never have been filed)
  if (prevFault && prevFault.length) { const pf = new Set(prevFault); if (f.filter((id) => pf.has(id)).length >= 0.8 * f.length) return null; }
  if (SETUP.test(f[0])) return `the first new failure is a setup stage (${f[0]})`;
  if (!prev) return null;   // no baseline: a count would blame the runner for master's own reds
  if (f.length > maxFailed) return `${f.length} NEW stages failed in one run (limit ${maxFailed})`;
  if (ran > 0 && f.length / ran > maxFrac) return `${f.length} of ${ran} stages newly failed (over ${maxFrac * 100}%)`;
  return null;
}
const labelsOf = async (gh, id) => (await gh('GET', `/repos/{repo}/actions/runners/${id}`)).labels.map((l) => l.name);
export async function findRunner(gh, name) {
  const r = ((await gh('GET', '/repos/{repo}/actions/runners?per_page=100')).runners || []).find((x) => x.name === name);
  if (!r) throw new Error(`no runner named ${name}`);
  return r;
}
export async function listRunners(gh) {
  return ((await gh('GET', '/repos/{repo}/actions/runners?per_page=100')).runners || [])
    .map((r) => ({ name: r.name, id: r.id, status: r.status, busy: r.busy, labels: r.labels.map((l) => l.name) }));
}
/** Remove the work labels. Idempotent. -> the labels removed. */
export async function quarantine(gh, name) {
  const r = await findRunner(gh, name), gone = [];
  for (const l of GATED) if (r.labels.some((x) => x.name === l)) { await gh('DELETE', `/repos/{repo}/actions/runners/${r.id}/labels/${l}`); gone.push(l); }
  return gone;
}
/** Add labels back (default gpu) and close this runner's fault issue(s). Callers: the smoke workflow after a clean run, or a person. */
export async function restore(gh, name, labels = ['gpu']) {
  const r = await findRunner(gh, name);
  await gh('POST', `/repos/{repo}/actions/runners/${r.id}/labels`, { labels });
  for (const i of await gh('GET', `/repos/{repo}/issues?state=open&labels=${FAULT_LABEL}&per_page=100`))
    if (i.title === faultTitle(name)) {
      await gh('POST', `/repos/{repo}/issues/${i.number}/comments`, { body: `Smoke run clean: ${labels.join(',')} restored on ${name}.` });
      await gh('PATCH', `/repos/{repo}/issues/${i.number}`, { state: 'closed' });
    }
}
/** One open issue per faulty runner (comment when it already exists). -> issue number */
export async function openFaultIssue(gh, name, reason, detail = '') {
  const body = `Runner **${name}** has a broken environment: ${reason}.\n\nIts gpu/express labels were removed (quarantine); no per-check RED issue was filed from this run. It gets them back only after \`.github/workflows/smoke.yml\` passes on it (build + core + pack-entities + a browser stage), or \`node tools/go.mjs runner restore ${name}\`.\n\n\`\`\`\n${detail.slice(0, 4000)}\n\`\`\``;
  const open = (await gh('GET', `/repos/{repo}/issues?state=open&labels=${FAULT_LABEL}&per_page=100`)).find((i) => i.title === faultTitle(name));
  if (open) { await gh('POST', `/repos/{repo}/issues/${open.number}/comments`, { body }); return open.number; }
  return (await gh('POST', '/repos/{repo}/issues', { title: faultTitle(name), body, labels: [FAULT_LABEL, 'severe', 'tracking'] })).number;
}
/** True when no OTHER online runner holds the gpu label: quarantining `name` would stop the full suite.
 *  #6627: an OFFLINE sole gpu runner is still the last one (12 Oct 04:5xZ the PC runner blipped offline, the old
 *  online-only count was 0, gpu was removed, and no full suite ran for 21 h). */
export async function isLastGpu(gh, name) {
  return !(await listRunners(gh)).some((r) => r.name !== name && r.status === 'online' && r.labels.includes('gpu'));
}
/** #6627 PURE: why the full suite has produced no result for `hours`, or null. runs = full-suite.yml runs (newest first),
 *  runners = listRunners() rows. A run that FINISHED (success/failure) is a result; cancelled/pending ones are not. */
export function fullStale(runs, runners, now, hours = 6, hosted = false) {   // hosted (#10420): the full suite is the mirror's full-run.yml, no gpu runner exists
  const done = (runs || []).find((r) => r.status === 'completed' && /^(success|failure)$/.test(r.conclusion || ''));
  const at = done ? Date.parse(done.updated_at) : 0;
  if (now - at < hours * 3600e3) return null;
  const gpu = (runners || []).filter((r) => r.labels.includes('gpu'));
  const why = hosted ? "the mirror's full-run.yml has not completed: read its last runs (Actions on the mirror; its result lines are on the bus), a missing secret or an unpublished workflow"
    : !gpu.length ? 'NO runner has the gpu label (the full-pc job can never start; go.mjs runner restore <name> --labels gpu)'
    : !gpu.some((r) => r.status === 'online') ? `the gpu runner(s) ${gpu.map((r) => r.name).join(', ')} are offline`
    : 'a gpu runner is online: read the last full-suite runs (cancelled while pending? fullgate waiting forever?)';
  return `no full-suite result for ${done ? Math.round((now - at) / 3600e3) + ' h' : 'ever'}: ${why}`;
}
/** #9180: GitHub drops schedule ticks, so the brain tick (its own systemd clock) dispatches the full suite when the cron did not.
 *  Due = FULL_MODE not off, the workflow active, no run queued/in progress, the newest run created over `minMin` minutes ago,
 *  and no dispatch of ours within `gapMin` minutes. Returns true/false. */
export function fullDispatchDue(runs, now, { mode = 'on', state = 'active', lastDispatch = 0, minMin = 130, gapMin = 45 } = {}) {
  if (mode === 'off' || state !== 'active') return false;
  if (now - lastDispatch < gapMin * 60e3) return false;
  const rs = runs || [];
  if (rs.some((r) => r.status === 'queued' || r.status === 'in_progress' || r.status === 'waiting' || r.status === 'pending')) return false;
  const newest = rs.filter((r) => r.conclusion !== 'skipped' && r.conclusion !== 'cancelled').reduce((m, r) => Math.max(m, Date.parse(r.created_at) || 0), 0);   // #9721: a push run whose jobs all skipped is no full run
  return now - newest > minMin * 60e3;
}
/** Smoke passed. github.token cannot edit runner labels (403, 6 Oct), so this only marks the runner's fault issue (made if absent)
 *  `smoke-passed`; the brain health pass (a PAT) then restore()s it. */
export async function smokePassed(gh, name) {
  const open = (await gh('GET', `/repos/{repo}/issues?state=open&labels=${FAULT_LABEL}&per_page=100`)).find((i) => i.title === faultTitle(name));
  const n = open ? open.number : (await gh('POST', '/repos/{repo}/issues', { title: faultTitle(name), body: `Smoke run clean on ${name}: waiting for the brain to add gpu.`, labels: [FAULT_LABEL] })).number;
  await gh('POST', `/repos/{repo}/issues/${n}/labels`, { labels: [SMOKE_PASSED] });
  return n;
}
/** #2893 PURE: 5 Oct the host DNS forwarder died and all 10 brain runners sat offline 4.5 h with no alert. `since` = {runnerName: ms it was
 *  first seen offline} from the previous tick. Returns the new `since` and `alert`: a message once EVERY `brain` runner has been offline
 *  over `mins` minutes (a single dead runner is the fill's business; all of them offline is the VM/DNS), else null. */
export function brainOffline(runners, now, since = {}, mins = 15) {
  const brain = (runners || []).filter((r) => (r.labels || []).includes('brain'));
  const next = {};
  for (const r of brain) if (r.status !== 'online') next[r.name] = since[r.name] || now;
  if (!brain.length || Object.keys(next).length < brain.length) return { since: next, alert: null };
  const oldest = Math.min(...Object.values(next)), mn = Math.round((now - oldest) / 60e3);
  const newest = Math.max(...Object.values(next));
  if (now - newest < mins * 60e3) return { since: next, alert: null };
  return { since: next, alert: `all ${brain.length} brain runners offline for over ${mn} min: the VM is down or cannot resolve DNS (check the host forwarder; guest /etc/systemd/resolved.conf.d/fix.conf should hold a public fallback, vm-setup.sh writes it) (#2893)` };
}
