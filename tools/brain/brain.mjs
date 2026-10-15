#!/usr/bin/env node
// brain.mjs - what brain.yml runs (#86).
//   node tools/brain/brain.mjs comment   a bus comment arrived (GITHUB_EVENT_PATH): wake a role, or push to Dan
//   node tools/brain/brain.mjs health    every 15 min: find what is wrong, mail the commander (which wakes it),
//                                        push to Dan when it has been wrong for over an hour
// Decisions live in route.mjs (tested by braincheck); this file only gathers facts and acts on them.
import { readFileSync, mkdirSync, rmSync, statSync, existsSync, readdirSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import { loadavg, cpus, setPriority } from 'node:os';
import { sourceHash, lockState, texauditDir } from '../texauditjob.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gh, ghAll, rateLimit, busComments } from '../infra/gh.mjs';
import { CFG, history, saveHistory, notify, post, mirrorQuestion, busIssue, P, pendingMail, setPendingMail } from './home.mjs';
import { prune } from '../infra/prune.mjs';
import { sweep as rebaseSweep } from '../infra/autorebase.mjs';
import { stalled, climb, rungs as ladderRungs, BEAT_MIN, allCapped } from '../infra/ladder.mjs';
import { clearNoclaim, diskRungVM, restartRunners } from '../infra/ladderlocal.mjs';
import { mobList, mobHash, readLedger, pickMobs, provenSet, readVisual, pruneVisual } from './auditledger.mjs';
import { LANE, laneSlots } from '../infra/phaselane.mjs';
import { fillShape, overdueRuns, burnHoldEnd, holdWakeAt, fillIdleMin, landIdleAction, texauditDue, routeComment, findings, dueAlerts, field, fillCount, fillWant, testerSwitch, capsExplain, reservePlan, capsLiftAt, burnPaused, usageCap, apiCap, busFull, pickAccount, acctFresh, accountWeekCap, applyLimits, primaryCaps, quietState, pendingMailDue, withAccountSwitches, noClaimReleased } from './route.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const start = (role, reason) => spawnSync(process.execPath, [join(HERE, 'launch.mjs'), '--role', role, '--reason', reason], { stdio: 'inherit' }).status;

/** comment: route AND start here (by hand). route: print role=/reason= for brain.yml's run job (its log goes to stderr). */
async function comment(printOnly) {
  const ev = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (!(ev.issue?.labels || []).some((l) => l.name === 'bus')) return console.error('not the bus');
  const d = routeComment(ev.comment.body, CFG);
  console.error(`bus ${ev.comment.id}: ${d.do} ${d.role || d.why || ''}`);
  if (d.do === 'notify') { const asks = await mirrorQuestion(ev.comment.id, ev.comment.body); await notify(d.text, { title: 'MC-Lite needs you', url: asks ? '/#/questions' : '/' }); }   // #4176: a question is also kept for the phone's Questions tab
  if (d.do !== 'start') return;
  const reason = `${d.reason} (bus message ${ev.comment.id})`.replace(/[\r\n]+/g, ' ');
  if (printOnly) console.log(`role=${d.role}\nreason=${reason}`);
  else process.exit(start(d.role, reason) ?? 1);
}

/** 30 Sept: open a fresh bus when this one is long (route.mjs busFull). Only the health pass does it (one runner, locked),
 *  so two new buses never race. The old issue keeps its `bus` label (closed): a reply posted there still routes. */
async function rotateBus(bus) {
  const cur = await gh('GET', `/repos/{repo}/issues/${bus}`);
  if (!busFull(CFG, cur.comments)) return;
  const nu = await gh('POST', '/repos/{repo}/issues', { title: 'Message bus', labels: ['bus'],
    body: `The message bus (#86). Continues #${bus}, closed at ${cur.comments} comments so every read stays a few API calls (30 Sept: reading the whole bus emptied the GitHub quota). Mail = a comment with \`to:\` / \`from:\` lines - see RUN.md.` });
  await gh('POST', `/repos/{repo}/issues/${bus}/comments`, { body: `to: log\nfrom: brain\n\nbus continues in #${nu.number}` });
  await gh('PATCH', `/repos/{repo}/issues/${bus}`, { state: 'closed' });
  console.log(`health: bus #${bus} had ${cur.comments} comments - continues in #${nu.number}`);
}

/** #1529: the GPU texture audit, a detached nice-19 background job (tools/texauditjob.mjs). Decision in route.mjs texauditDue;
 *  never awaited, never in the foreground, one at a time (its own lock). */
async function texauditMaybe(h, now) {
  try {
    const srcHash = sourceHash(), lk = lockState(texauditDir());
    let capped = false;
    try {
      const u = JSON.parse((await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }))?.value || 'null');
      const acct = pickAccount(CFG, now, () => true, u), a = u && u.accounts ? u.accounts[acct] : u;
      capped = !!(a && a.window) && usageCap(CFG, { window: a.window, week: a.week, at: u.at, weekCap: accountWeekCap(CFG, acct) }, now) === 0;
    } catch {}
    const busy = (process.platform !== 'win32' && loadavg()[0] > 0.5 * cpus().length) || capped || existsSync(join(HERE, '..', '..', '.infra', 'STOP-SUITE'));
    const d = texauditDue({ last: h.lastTexaudit || null, srcHash, now, busy, running: lk.held && !lk.stale });
    console.log(`texaudit: ${d.run ? 'starting' : 'not now'} (${d.why})`);
    if (!d.run) return;
    const c = spawn(process.execPath, [join(HERE, '..', 'texauditjob.mjs')], { detached: true, stdio: 'ignore', env: { ...process.env, MCLITE_TEXAUDIT_BG: '1' } });
    c.unref();
    try { setPriority(c.pid, 19); } catch {}
    h.lastTexaudit = { at: now, srcHash };
  } catch (e) { console.log(`texaudit: skipped (${e.message})`); }
}
/** #4975: the VM's half of the self-healing ladder (the PC's is infra/vmwatch.mjs). One symptom: no merge and no worker/tester run for 45 min
 *  while work is claimable -> one rung per pass (tools/infra/ladder.mjs), a page only when every rung has been tried. Also the VM's look at the
 *  PC: usaged republishes MCLITE_USAGE every 5 min, so a stale one = the PC watcher is down; land/full-suite then go back to hosted runners.
 *  The VM's own beat is repo variable BRAIN_HEALTH_AT, which the PC watcher reads. */
async function ladderPass(snap, now) {
  const set = async (name, value) => { const b = { name, value }; if ((await gh('PATCH', `/repos/{repo}/actions/variables/${name}`, b, { ok404: true })) === null) await gh('POST', '/repos/{repo}/actions/variables', b); };
  await set('BRAIN_HEALTH_AT', String(now)).catch(() => {});
  const say = (t) => post('log', t).catch(() => {});
  let U0 = null;   // #5105: the ladder reads usage too - every account capped is not a stall
  try {
    const u = JSON.parse((await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }))?.value || 'null'); U0 = u;
    const tr = (await gh('GET', '/repos/{repo}/actions/variables/TEST_RUNNER', null, { ok404: true }))?.value;
    if (u?.at && now - Date.parse(u.at) > BEAT_MIN * 60e3 && tr === 'pc') { await set('TEST_RUNNER', 'hosted'); await say(`ladder: PC watcher silent for ${Math.round((now - Date.parse(u.at)) / 60e3)} min - TEST_RUNNER=hosted`); }
  } catch {}
  let claimable = 0; try { const r = spawnSync(process.execPath, [join(HERE, '..', 'go.mjs'), 'claimable'], { encoding: 'utf8', timeout: 120e3 }), v = r.stdout.trim().split('\n').pop(); claimable = /^\d+$/.test(v) ? Number(v) : 0; } catch {}
  let lastRunAt = snap.running.some((t) => /^brain (worker|tester)/.test(t)) ? now : 0;
  if (!lastRunAt) lastRunAt = Math.max(0, ...(((await gh('GET', '/repos/{repo}/actions/workflows/brain.yml/runs?per_page=50').catch(() => null))?.workflow_runs) || []).filter((r) => /^brain (worker|tester)/.test(r.display_title || r.name)).map((r) => Date.parse(r.created_at)));
  const h = history();
  const r = await climb({ st: h.ladder, isStalled: stalled({ now, lastMergeAt: snap.lastMasterAt, lastRunAt, claimable, capped: allCapped(CFG, U0, now, usageCap, accountWeekCap) }), say, page: (t) => notify(t),
    now, save: async (st) => { const hs = history(); hs.ladder = st; saveHistory(hs); },   // #5105: state saved before each rung
    rungs: ladderRungs({ gh, now, sweep: () => rebaseSweep({ gh, ghAll, post }), local: { clearNoclaim: clearNoclaim(P()), freeDisk: diskRungVM(), restartRunners: restartRunners() } }) });
  h.ladder = r.st; saveHistory(h);
  if (r.acted) console.log(`health: ladder acted - ${r.acted}`);
}
async function health() {
  const now = Date.now();
  const bus = await busIssue();
  await rotateBus(bus);
  const all = await busComments(2);
  const answered = new Set(all.map((c) => field(c.body, 're')).filter(Boolean));
  const mail = all.map((c) => ({ id: c.id, created_at: c.created_at, to: field(c.body, 'to').toLowerCase(),
    from: field(c.body, 'from').toLowerCase(), re: field(c.body, 're'), answered: answered.has(String(c.id)) }));
  const red = (await gh('GET', '/repos/{repo}/issues?state=open&labels=severe&per_page=50')).find((i) => /^master is red/i.test(i.title));
  // full-suite.yml reports its reds as a comment on the "master is red" issue ("**N red**"); the run itself stays green
  const lastRed = red ? (await ghAll(`/repos/{repo}/issues/${red.number}/comments?since=${new Date(now - 3 * 86400e3).toISOString()}`)).at(-1) : null;
  const nRed = Number(((lastRed?.body || '').match(/\*\*(\d+) red\*\*/) || [])[1] || 0);
  const runners = (await gh('GET', '/repos/{repo}/actions/runners', null, { ok404: true }).catch(() => null))?.runners || [];
  { // #3568: a runner with an open env-fault issue keeps NO gpu/express label until smoke.yml passes on it (full.mjs removes them
    // at once; this catches a re-add by hand or a failed removal), and smoke is re-dispatched at most every 30 min
    const { quarantine, restore, isLastGpu, faultTitle, FAULT_LABEL, SMOKE_PASSED } = await import('../infra/runnerguard.mjs');
    // github.token cannot edit runner labels, so full.mjs/smoke.mjs only mark issues; every label write is here, with the PAT.
    // Fresh list, one pass: restore the smoke-passed ones first, quarantine only what is STILL open (a stale list once
    // removed gpu right after a restore closed the issue, 6 Oct).
    const faults = (await gh('GET', `/repos/{repo}/issues?state=open&labels=${FAULT_LABEL}&per_page=50`).catch(() => [])) || [];
    const dry = process.argv.includes('--dry');
    for (const r of runners) {
      const f = faults.find((i) => i.title === faultTitle(r.name));
      if (!f || dry) continue;
      if (f.labels.some((l) => l.name === SMOKE_PASSED)) { await restore(gh, r.name, ['gpu']).then(() => console.log(`health: runner ${r.name} passed smoke: gpu restored`)).catch((e) => console.log(`restore ${r.name} failed: ${e.message}`)); continue; }
      if (await isLastGpu(gh, r.name).catch(() => true)) continue;
      const gone = await quarantine(gh, r.name).catch(() => []);
      if (gone.length) console.log(`health: runner ${r.name} has an open env-fault issue: removed ${gone.join(',')}`);
    }
    const h0 = history();
    // #6627: 12 Oct, no full-suite result for 21 h and nothing said so. One mail to fixer + commander per 6 h while it lasts.
    if (!dry && now - (h0.fullStaleAt || 0) > 6 * 3600e3) {
      const { fullStale } = await import('../infra/runnerguard.mjs');
      // #6750: a workflow Dan disabled on purpose (13 Oct: PC full suite paused until it moves to hosted runners) is not stale
      const wfState = (await gh('GET', '/repos/{repo}/actions/workflows/full-suite.yml').catch(() => null))?.state;
      const fr = wfState && wfState !== 'active' ? null : (await gh('GET', '/repos/{repo}/actions/workflows/full-suite.yml/runs?per_page=50').catch(() => null))?.workflow_runs;
      const stale = fr ? fullStale(fr, runners.map((r) => ({ name: r.name, status: r.status, labels: r.labels.map((l) => l.name) })), now) : null;
      if (stale) { h0.fullStaleAt = now; saveHistory(h0); for (const to of ['fixer', 'commander']) await post(to, `brain: ${stale} (#6627)`).catch(() => {}); }
    }
    if (faults.some((i) => !i.labels.some((l) => l.name === SMOKE_PASSED)) && !process.argv.includes('--dry') && now - (h0.lastSmoke || 0) > 30 * 60e3) {
      await gh('POST', '/repos/{repo}/actions/workflows/smoke.yml/dispatches', { ref: 'master' }).then(() => { h0.lastSmoke = now; saveHistory(h0); }).catch((e) => console.log(`smoke dispatch failed: ${e.message}`));
    }
  }
  const loopPosts = mail.filter((m) => m.from === 'loop');
  const snap = { now, masterRed: nRed > 0, redSince: lastRed?.created_at,
    runners: runners.map((r) => ({ name: r.name, status: r.status })), mail,
    loopEnabled: process.env.BRAIN_LOOP_WATCH === '1', lastLoopAt: loopPosts.at(-1)?.created_at, fillIdleMin: 0 };
  { // #1575: the fill wants workers but nothing runs or waits (no worker, tester, waker) = a hold left no wake
    const act = [];
    let listFailed = false;   // #5550: a failed listing (API quota out) is UNKNOWN, not 'nothing runs' - 11 Oct 22:16Z false fill-idle while a waker slept
    for (const st of ['queued', 'in_progress']) { const r = await gh('GET', `/repos/{repo}/actions/workflows/brain.yml/runs?status=${st}&per_page=100`).catch(() => null); if (!r) listFailed = true; act.push(...(r?.workflow_runs || [])); }
    if (!process.argv.includes('--dry')) for (const o of overdueRuns(act, now)) {   // 6 Oct: a hung run blocks its concurrency group
      await gh('POST', `/repos/{repo}/actions/runs/${o.id}/cancel`).then(() => console.log(`health: cancelled overdue run ${o.id} "${o.title}" (${o.age} min, limit ${o.limit})`), (e) => console.log(`health: cancel of run ${o.id} failed (${e.message})`));
      await post('log', `brain: cancelled overdue run ${o.id} "${o.title}" - in progress ${o.age} min, limit ${o.limit}`).catch(() => {});
    }
    snap.fillWant = fillWant(CFG, now, process.env.FILL_WORKERS);
    snap.running = act.filter((r) => r.status === 'in_progress').map((r) => r.display_title || r.name);
    snap.lastMasterAt = Date.parse((await gh('GET', '/repos/{repo}/commits/master').catch(() => null))?.commit?.committer?.date || '') || 0;
    // 7 Oct 01:34Z: `loop 0` (00:28Z) then `loop 10` (01:34Z) paged fill-idle + dormant at once - the idle time of a PAUSE is not the fill's fault.
    // The switch's own updated_at is the earliest an idle can start.
    const sw = Date.parse((await gh('GET', '/repos/{repo}/actions/variables/FILL_WORKERS', null, { ok404: true }).catch(() => null))?.updated_at || '') || 0;
    snap.lastMasterAt = Math.max(snap.lastMasterAt, sw);
    try {   // usage explains it when EVERY account is capped (same sources fill() uses) or the API quota is out
      const u = applyLimits(JSON.parse((await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }))?.value || 'null'), history().limits, now);
      snap.usageExplained = apiCap(CFG, await rateLimit()) === 0 || capsExplain(CFG, u, now);   // #2050
    } catch {}
    if (!listFailed) snap.fillIdleMin = fillIdleMin({ starts: [...(history().starts || []), { at: sw }, ...noClaimMarks()] }, act.filter((r) => /^brain (worker|tester|waker)/.test(r.display_title || r.name)).length + (history().wakes || []).filter((w) => w <= now && now - w < 5 * 60e3).length, fillWant(CFG, now, process.env.FILL_WORKERS), now);
  }
  { // #2700: PRs wait for the lander but no land.yml run is queued or in progress = nothing will land them: start it ourselves
    const lp = ((await gh('GET', '/repos/{repo}/issues?state=open&labels=land&per_page=100').catch(() => null)) || []).filter((i) => i.pull_request);
    let la = 0;
    for (const st of ['queued', 'in_progress']) la += ((await gh('GET', `/repos/{repo}/actions/workflows/land.yml/runs?status=${st}&per_page=20`).catch(() => null))?.workflow_runs || []).length;
    snap.landWaiting = lp.length;
    snap.landAction = landIdleAction(lp.length, la, history().lastLandDispatch, now);
    if (snap.landAction === 'dispatch' && !process.argv.includes('--dry')) await gh('POST', '/repos/{repo}/actions/workflows/land.yml/dispatches', { ref: 'master' }).catch((e) => console.log(`lander-idle: dispatch failed (${e.message})`));
  }
  if (!process.argv.includes('--dry')) {   // #4589: bounced merge-conflict PRs re-queue themselves; a failure mails once an hour, never loops
    const r = await rebaseSweep({ gh, ghAll, post }).catch((e) => ({ acts: [], errors: ['sweep: ' + e.message.slice(0, 160)] }));
    if (r.acts.length) console.log('health: auto-rebase - ' + r.acts.join(', '));
    const h0 = history();
    if (r.errors.length && now - (h0.rebaseErrAt || 0) > 3600e3) {
      h0.rebaseErrAt = now; saveHistory(h0);
      for (const to of ['fixer', 'commander']) await post(to, `brain: the auto-rebase sweep (#4589) failed: ${r.errors.join('; ')}`).catch(() => {});
    }
  }
  if (!process.argv.includes('--dry')) await ladderPass(snap, now).catch((e) => console.log(`ladder: ${e.message}`));
  { // #4965: free space gates everything (0 bytes = every run dies at 'Set up job'); clean regenerable files first, ask again, then alert
    const { clean, freeGB } = await import('../infra/diskclean.mjs');
    try { if (freeGB() < 15 && !process.argv.includes('--dry')) console.log(`health: disk low - auto-clean removed ${clean()} stale item(s)`); snap.diskFreeGB = freeGB(); } catch (e) { console.log(`disk check failed: ${e.message}`); }
  }
  { // #6663: a `blocked` issue that others depend on deadlocks the queue (#5094 held 341 on 13 Oct): unblock it, bounded, and alert
    const { heldByBlocked, unblockDue } = await import('./route.mjs');
    const open = ((await ghAll('/repos/{repo}/issues?state=open&per_page=100').catch(() => null)) || []).filter((i) => !i.pull_request);
    const held = open.length ? heldByBlocked(open) : [], h1 = history(); h1.unblocked = h1.unblocked || {};
    snap.blockedHolds = held.filter((x) => x.holds >= 5);
    if (!process.argv.includes('--dry')) for (const x of unblockDue(held, h1.unblocked, now)) {
      await gh('DELETE', `/repos/{repo}/issues/${x.n}/labels/blocked`).catch(() => {});
      await gh('POST', `/repos/{repo}/issues/${x.n}/comments`, { body: `**Unblocked by the brain** (#6663): ${x.holds} open issues wait on this one through \`Depends on:\` chains, so \`blocked\` here stops all of them. Read the last hand-offs, fix the CAUSE (a tool, a timeout, a split into smaller units). The burn rule re-blocks it after 2 more empty runs; the brain unblocks it again at most every 6 h.` }).catch(() => {});
      h1.unblocked[x.n] = now; console.log(`health: unblocked #${x.n} (holds ${x.holds})`);
    }
    saveHistory(h1);
  }
  const found = findings(snap, CFG), h = history();
  if (snap.landAction === 'dispatch' && !process.argv.includes('--dry')) { h.lastLandDispatch = now; console.log(`health: lander idle with ${snap.landWaiting} PR(s) waiting - dispatched land.yml (#2700)`); }
  const { mail: toMail, dan } = dueAlerts(found, h.alerts, h.told, CFG, now);
  console.log(`health: ${found.length ? found.map((f) => f.key).join(', ') : 'all clear'}; mailing ${toMail.length}, telling Dan ${dan.length}`);
  if (process.argv.includes('--dry')) { for (const f of found) console.log(`  ${f.key}: ${f.text}`); return; }
  for (const f of toMail) { await post('commander', `health: ${f.key}\n\n${f.text}`); if (f.key === 'fill-idle') await post('fixer', `health: ${f.key}\n\n${f.text}`); if (f.key === 'dormant') await post('fixer', `health: ${f.key}\n\n${f.text}`); h.alerts.push({ key: f.key, at: now }); }
  for (const f of found) if (f.key === 'dormant' && !(h.told || []).some((t) => t.key === 'dormant' && now - t.at < 3600e3)) { await notify(`DORMANT (#4256): ${f.text}`); h.told.push({ key: 'dormant', at: now }); }   // once, no hour of waiting
  for (const f of found) if (f.key === 'disk-low' && !(h.told || []).some((t) => t.key === 'disk-low' && now - t.at < 3600e3)) { await notify(`DISK LOW (#4965): ${f.text}`); h.told.push({ key: 'disk-low', at: now }); }
  for (const f of dan) { await notify(`Still wrong after an hour: ${f.text}`); h.told.push({ key: f.key, at: now }); }
  // 6 Oct: bus traffic is the only clock, so a quiet bus never ran this pass (the 60-min dormant alert never fired). While the
  // fill wants workers a waker keeps coming back: its post is the bus comment that runs health + fill again.
  // #125: dead branches go by themselves, once a day (tools/infra/prune.mjs; prunecheck proves the rules)
  if (now - (h.lastPrune || 0) > 24 * 3600e3) { try { await prune({ now }); h.lastPrune = now; } catch (e) { console.log(`prune failed: ${e.message}`); } }
  await texauditMaybe(h, now);
  h.lastHealth = now; h.masterRed = snap.masterRed;   // #4549: the fill shape reads it
  saveHistory(h);
  if (snap.fillWant > 0) await wakeIn(15);   // after the save: wakeIn writes history too
  await fill();
}

/** #96: GitHub's `schedule` never fired for brain.yml (0 runs 18:26Z-19:20Z 28 Sept), so health + FILL also run off
 *  bus traffic: every routed comment calls this. A worker ending posts a `to: log` line, which is exactly when FILL is
 *  needed. At most one run per 14 min across all 6 runners (history.json lastHealth + an atomic mkdir lock in ~/.brain). */
/** FILL: keep the worker count up. 29 Sept: it ran only inside the 14-minute health pass, so a worker that ended within
 *  14 min of the last pass started nobody, and with no other bus traffic the loop went dormant (Dan: "when a session
 *  ends it starts a new one or doesn't"). Now EVERY routed comment fills (a worker's end posts one), one runner at a
 *  time (a 2-min mkdir lock), so a session ending always starts the next while FILL_WORKERS allows. */
async function fill() {
  const now = Date.now();
  const runs = [];
  for (const st of ['queued', 'in_progress']) runs.push(...((await gh('GET', `/repos/{repo}/actions/workflows/brain.yml/runs?status=${st}&per_page=100`))?.workflow_runs || []));
  const wruns = runs.filter((r) => /^brain (worker|tester)( @\w+)?$/.test(r.display_title || r.name));   // testers count toward the total
  const runningBy = {};                                   // #1496: runs of a reserved account pool are tagged `@account`
  for (const r of wruns) { const m = /@(\w+)$/.exec(r.display_title || r.name || ''); if (m && m[1] !== LANE) runningBy[m[1]] = (runningBy[m[1]] || 0) + 1; }
  const running = wruns.length - Object.values(runningBy).reduce((s, v) => s + v, 0);   // the primary pool only
  const testing = runs.filter((r) => /^brain tester$/.test(r.display_title || r.name)).length;
  // 29 Sept 04:00Z: MCLITE_USAGE is per account ({at, accounts: {max: {window, week}}}) but the caps read usage.window,
  // so usage always looked unknown and usageCap allowed ONE worker - the brain never ran more than one at a time.
  let usage = null, U = null; try {
    const u = applyLimits(JSON.parse((await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }))?.value || 'null'), history().limits, now);   // #1937: a limit claude reported beats a stale reading
    U = u;
    const a = u && u.accounts ? u.accounts[pickAccount(CFG, now, () => true, u)] : u;
    usage = a && a.window && acctFresh(a, now) ? { window: a.window, week: a.week, at: u.at, acct: pickAccount(CFG, now, () => true, u), weekCap: accountWeekCap(CFG, pickAccount(CFG, now, () => true, u)) } : null;
  } catch {}
  const api = await rateLimit();
  if (apiCap(CFG, api) === 0) console.log(`fill: GitHub API quota low (${api.remaining} of ${api.limit} left until ${new Date(api.reset).toISOString()}) - starting nobody`);
  const TS = testerSwitch(process.env.FILL_TESTERS);   // #4991: FILL_TESTERS = the tester count on its own; unset/auto = the brain's automatic split of FILL_WORKERS
  let n = fillCount(CFG, now, running, TS === null ? process.env.FILL_WORKERS : String(fillWant(CFG, now, process.env.FILL_WORKERS) + TS), usage, api);
  // #4549: the brain picks the worker/tester split from measured inputs; an input it cannot read keeps the previous shape (and mails the fixer)
  const bad = [], iso = (t) => new Date(t).toISOString(); let claimable = 0, drain = 0, landBacklog = 0;
  try { const r = spawnSync(process.execPath, [join(HERE, '..', 'go.mjs'), 'claimable'], { encoding: 'utf8', timeout: 120e3 }), v = r.stdout.trim().split('\n').pop(); if (r.status !== 0 || !/^\d+$/.test(v)) throw 0; claimable = Number(v); } catch { bad.push('queue'); }
  try { drain = (await gh('GET', `/repos/{repo}/issues?state=closed&since=${iso(now - 3 * 3600e3)}&per_page=100`)).filter((i) => !i.pull_request && Date.parse(i.closed_at) > now - 3 * 3600e3).length / 3; } catch { bad.push('drain'); }
  try { landBacklog = (await gh('GET', '/repos/{repo}/issues?state=open&labels=land&per_page=100')).filter((i) => i.pull_request).length; } catch { bad.push('lander'); }
  if (!usage || (usage.at && now - Date.parse(usage.at) > 30 * 60e3)) bad.push('usage');
  const H = history(), PC = primaryCaps(CFG, pickAccount(CFG, now, () => true, U), now);   // #1939: Pro carries at most its own caps (Dan: 1 tester 2 workers)
  if (TS !== null) PC.testers = TS;   // #4991: Dan's explicit tester count beats the account's default tester cap (usage caps still apply)
  const shape = fillShape(CFG, now, process.env.FILL_WORKERS, { claimable, drain, landBacklog, bad, masterRed: !!H.masterRed, prev: H.shape,
    testerBugs: (H.testerRuns || []).map((r) => r.bugs), usage, budgetSlots: Math.min(usageCap(CFG, usage, now), apiCap(CFG, api), PC.sessions) });
  if (TS !== null) { shape.workers = fillWant(CFG, now, process.env.FILL_WORKERS); shape.testers = TS; shape.total = shape.workers + TS; shape.line += ` [FILL_TESTERS=${TS}: workers and testers set separately]`;
    shape.changed = !H.shape || shape.workers !== H.shape.workers || shape.total !== H.shape.total; }   // #5103: compare what is SAVED, or every pass 'changes' and floods the bus
  console.log(shape.line);
  if (shape.changed || bad.length) {
    const h = history(); h.shape = { workers: shape.workers, total: shape.total, at: shape.at, line: shape.line }; saveHistory(h);
    if (shape.changed) await post('log', `brain: ${shape.line}`).catch(() => {});
    if (bad.length && now - (h.shapeMailAt || 0) > 3600e3) { h.shapeMailAt = now; saveHistory(h); await post('fixer', `brain: the auto fill shape (#4549) could not read ${bad.join(', ')} and kept the previous shape. Find which input failed (queue = go.mjs claimable, drain/lander = GitHub API, usage = stale or missing MCLITE_USAGE) and fix the cause.`).catch(() => {}); }
  }
  n = Math.min(n, Math.max(0, PC.sessions - running));
  console.log(`fill: ${running} worker(s) running, usage ${usage ? `${usage.window?.pct}%/5h ${usage.week?.pct}%/wk` : "unknown"}, starting ${n}${process.env.FILL_WORKERS ? ` (phone switch FILL_WORKERS=${process.env.FILL_WORKERS})` : ''}`);
  // #2820: a run titled `brain waker` is NOT proof a wake is still coming - the waker that just fired is in_progress while it posts
  // and the fill it triggers runs, so counting waker runs made that fill arm nothing (5 Oct: idle 364 min after a pause ended). Armed
  // wakes are recorded in history.wakes (future times only); every waker dispatch below goes through arm().
  const armed = (atMs) => (history().wakes || []).some((w) => w > now && w <= atMs + 60e3);
  const arm = async (atMs) => {
    await gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', { ref: 'master', inputs: { role: 'waker', reason: new Date(atMs).toISOString() } });
    const h = history(); h.wakes = (h.wakes || []).filter((w) => w > now); h.wakes.push(atMs); saveHistory(h);
  };
  // #1575: arm the dead-man FIRST - anything below that throws (GitHub hiccup, reserve pool, claimable) used to end fill() with no waker (7 Oct 01:43Z-02:33Z idle).
  if (fillWant(CFG, now, process.env.FILL_WORKERS) > 0 && !armed(now + 15 * 60e3)) await arm(now + 15 * 60e3).catch((e) => console.log('fill: early dead-man failed - ' + String(e.message).slice(0, 120)));
  { // #6522 (Dan, 12 Oct: "have the fill auto restart once the backlog is all gone"): `go.mjs loop off --resume-when-landed` parks the worker count in FILL_RESUME_TO;
    // the fill puts it back when no PR is labelled land, and while parked arms its own waker (every hold arms its wake, #1575)
    try {
      const rt = (await gh('GET', '/repos/{repo}/actions/variables/FILL_RESUME_TO', null, { ok404: true }))?.value;
      if (rt && !bad.includes('lander') && landBacklog === 0) {
        const b = { name: 'FILL_WORKERS', value: String(rt) };
        if ((await gh('PATCH', '/repos/{repo}/actions/variables/FILL_WORKERS', b, { ok404: true })) === null) await gh('POST', '/repos/{repo}/actions/variables', b);
        await gh('DELETE', '/repos/{repo}/actions/variables/FILL_RESUME_TO', null, { ok404: true });
        await post('log', `brain: the land queue is empty - FILL_WORKERS back to ${rt} (loop off --resume-when-landed)`).catch(() => {});
      } else if (rt && !armed(now + 20 * 60e3)) await arm(now + 20 * 60e3);
    } catch (e) { console.log('fill: resume-when-landed failed - ' + String(e.message).slice(0, 120)); }
  }
  const fillOff = !(fillWant(CFG, now, process.env.FILL_WORKERS) > 0 || TS > 0);   // #4991: the worker switch at 0 means NOTHING fill-made starts, parked mail included
  if (fillOff || TS === 0) for (const [r, pm] of Object.entries(pendingMail())) if ((fillOff || r === 'tester') && /^(fill|test slot)/.test(pm.reason || '')) { console.log(`fill: dropping held ${r} mail - FILL_WORKERS=0 (#4991): ${pm.reason.slice(0, 80)}`); setPendingMail(r, null); }
  for (const m of pendingMailDue(pendingMail(), history().starts, CFG, now)) {   // #3947: parked mail whose role is under its cap again
    console.log(`fill: re-routing held ${m.role} mail: ${m.reason.slice(0, 120)}`);
    await gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', { ref: 'master', inputs: { role: m.role, reason: m.reason } });
    setPendingMail(m.role, { ...pendingMail()[m.role], sent: now });
  }
  if (n === 0 && running === 0 && !armed(api.reset + 60e3) && apiCap(CFG, api) === 0) {
    console.log(`fill: API quota low with nothing running - a waker for ${new Date(api.reset + 60e3).toISOString()}`);
    await arm(api.reset + 60e3);
  } else if (n === 0 && running === 0 && usageCap(CFG, usage, now) === 0 && capsLiftAt(CFG, U, now) != null) {
    // #2335 (Dan, 4 Oct: "the brain only watches one account"): wake at the first lift over EVERY account, and arm it even while a
    // LATER waker is armed (04:34Z: Max's 07:23Z waker hid Pro's 04:50Z reset for 45 min). Armed times live in history.wakes.
    const at = Math.max(capsLiftAt(CFG, U, now) + 3 * 60e3, now + 10 * 60e3);   // #1019: never a waker in the past
    if (!armed(at)) {
      console.log(`fill: capped by usage with nothing running - a waker for ${new Date(at).toISOString()}`);
      await arm(at);
    }
  }
  // reserved TESTER passes (Dan, 29 Sept): up to fill.testers of the running sessions audit finished phases
  // 30 Sept 02:46Z: fill dispatched testers past roles.json maxPerHour; each run only printed SKIP and the slot stayed
  // empty. Dispatch only what launch.mjs will actually start (its history is this same ~/.brain/history.json).
  const left = (role) => Math.max(0, CFG.roles[role].maxPerHour - history().starts.filter((x) => x.role === role && now - x.at < 3600e3).length);
  let t = Math.min(n, Math.max(0, Math.min(PC.testers, shape.testers) - testing), left('tester'));   // empty tester slots stay empty (#4298)
  // #4588: while the mob gate is open the brain names each tester's mob; clean+unchanged mobs are skipped, none left = no tester starts
  let mobs = [];
  if (t > 0 && ((await gh('GET', '/repos/{repo}/issues?labels=gate&state=open&per_page=1').catch(() => [])) || []).length) {
    try {
      const busy = history().starts.filter((x) => x.role === 'tester' && x.mob && now - x.at < 100 * 60e3).map((x) => x.mob);
      mobs = (() => { const proven = provenSet(); return pickMobs(mobList(), readLedger(), mobHash, t, busy, { proven, visual: pruneVisual(readVisual(), proven) }); })();
      console.log(`fill: audit ledger - ${mobs.length} mob(s) due: ${mobs.join(', ') || 'none (every mob audited clean and unchanged)'}`);
      t = mobs.length;
    } catch (e) {   // unreadable ledger: today's rotation, and the fixer hears of it
      console.log('fill: audit ledger unreadable - falling back to the slot rotation: ' + String(e.message).slice(0, 120));
      await post('fixer', `brain: the tester audit ledger (#4588, ~/.brain/audit-ledger.json) cannot be read: ${String(e.message).slice(0, 200)}. Testers fall back to the slot rotation (full-cost re-audits) until it is fixed.`).catch(() => {});
    }
  }
  const want = n;
  const PA = withAccountSwitches(CFG, process.env).active;   // #5045: with per-account switches the universal pool starts no workers; fillReserve starts each account's own
  n = Math.min(n, t + Math.max(0, (PA ? 0 : shape.workers) - Math.max(0, running - testing)), left('worker'));
  if (want > 0 && n === 0 && left('worker') === 0) {   // the hourly cap holds every slot: wake when the oldest start leaves the hour (#6646: only then - with per-account switches n is 0 every pass and this armed one waker per worker start)
    const oldest = Math.min(...history().starts.filter((x) => x.role === 'worker' && now - x.at < 3600e3).map((x) => x.at));
    const at = (Number.isFinite(oldest) ? oldest : now) + 3600e3 + 30e3;
    if (!armed(at)) { console.log(`fill: every start this hour is used (maxPerHour) - a waker for ${new Date(at).toISOString()}`); await arm(at); }
  }
  if (shape.testers > 0 && left('tester') === 0) {   // #4335: the tester hour cap holds the tester slots (8 Oct 02:35-03:33Z: 12 starts, 0 running, nothing woke): wake when its oldest start leaves the hour
    const at = Math.min(...history().starts.filter((x) => x.role === 'tester' && now - x.at < 3600e3).map((x) => x.at)) + 3600e3 + 30e3;
    if (!armed(at)) { console.log(`fill: every tester start this hour is used (maxPerHour) - a waker for ${new Date(at).toISOString()}`); await arm(at); }
  }
  // #3569: the quiet window (08:00-14:00 New York) changes the cap at its edges: a waker for each, so 14:00 fills UP at once
  const edge = quietState(CFG, now).next;
  if (edge && !armed(edge + 30e3)) { console.log(`fill: quiet-window edge - a waker for ${new Date(edge + 30e3).toISOString()}`); await arm(edge + 30e3); }
  let holdUntil = 0;                                     // #1575: every hold below arms its own waker (see the end of fill())
  if (n > t && noClaimHold('default', now)) { console.log('fill: nothing claimable - holding the worker fill 20 min (#1503)'); n = t; holdUntil = Math.max(holdUntil, noClaimEnd('default')); }
  if (n > t && burnPaused(history(), now)) {
    holdUntil = Math.max(holdUntil, burnHoldEnd(history(), now));            // #1503: 4 burned runs in an hour = something is wrong; stop and tell Dan once
    console.log('fill: paused - 4+ burned runs in the last hour (no PR, no new code)'); n = t;
    // #1937: to the FIXER, which is actually started - not Dan's phone (Dan, 3 Oct: "im tired of having to constantly oversee things")
    const h = history(); if (now - (h.burnNoteAt || 0) > 3600e3) { h.burnNoteAt = now; saveHistory(h); post('log', `brain: worker fill PAUSED until ~${new Date(burnHoldEnd(history(), now)).toISOString().slice(11, 16)}Z - 4+ worker runs in the last hour ended with no PR, no new code and no open dependency (#1503). The fixer was mailed.`).catch(() => {}); await post('fixer', 'brain: worker fill PAUSED for 30 min - 4+ worker runs in the last hour ended with no PR and no new code. Read their `run ended` lines on the bus, find the CAUSE (one stuck issue, a broken tool, an account problem), fix it, and report to log. A waker restarts the fill when the pause ends.').catch(() => {}); }
  }
  for (let i = 0; i < t; i++) await gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', { ref: 'master', inputs: { role: 'tester', reason: `test slot ${Math.floor(now / 60e3) + i}${mobs[i] ? ` mob ${mobs[i]}` : ''}` } });
  // #3948: one of the worker slots is the PHASE LANE (run tagged @phase, inside the total, same caps); its own no-claim hold never holds the others
  const laneHeld = noClaimHold(LANE, now);
  let lane = n > t ? laneSlots(CFG, wruns.map((r) => r.display_title || r.name || ''), laneHeld) : 0;
  if (n > t && laneHeld) holdUntil = Math.max(holdUntil, noClaimEnd(LANE));
  for (let i = t; i < n; i++, lane = 0) await gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', { ref: 'master', inputs: lane ? { role: 'worker', account: LANE, reason: 'fill (phase lane)' } : { role: 'worker', reason: 'fill (the brain keeps the worker count up)' } });
  holdUntil = Math.max(holdUntil, (await fillReserve(runs, runningBy, wruns.length, U, api, now).catch((e) => { console.log('fill: reserve pool failed - ' + String(e.message).slice(0, 160)); return 0; })) || 0);
  if (holdUntil > now && !armed(holdWakeAt(holdUntil, now))) {   // #1575: a pause with no wake sat idle 6 h on 2 Oct
    const at = holdWakeAt(holdUntil, now);
    console.log(`fill: held until ${new Date(holdUntil).toISOString()} - a waker for ${new Date(at).toISOString()} (#1575)`);
    await arm(at);
  }
  // #4256 DEAD-MAN (7 Oct: idle 10.5 h, every watchdog ran on bus traffic): a fill that ends below target ALWAYS leaves a waker for +15 min
  // (re-armed by each waker's own fill until the target is met or a usage cap explains it), whatever hold/cap code above did or did not arm.
  { const target = fillWant(CFG, now, process.env.FILL_WORKERS), have = running + Object.values(runningBy).reduce((s, v) => s + v, 0) + n;
    if (target > 0 && have < target && !armed(now + 15 * 60e3)) { console.log(`fill: ${have}/${target} - dead-man waker for ${new Date(now + 15 * 60e3).toISOString()} (#4256)`); await arm(now + 15 * 60e3); } }
  // FILL_WORKERS=N@<time> lapsing silently stopped the fill at 11:45Z: a waker for the override's own end
  { const exp = Date.parse(String(process.env.FILL_WORKERS || '').split('@')[1] || '');
    if (exp > now && !armed(exp + 30e3)) await arm(exp + 30e3); }
}
/** #1503: a pool whose last worker start found nothing to claim is held for 20 min (marker ~/.brain/noclaim-<account|default>
 *  written by brain.yml) - without it every 'not started' bus line re-ran FILL, which dispatched workers that found nothing. */
/** A worker that finds nothing to claim logs no `start` but rewrites ~/.brain/noclaim-* and re-arms its waker every 20 min: that live chain
 *  is not an idle fill (7 Oct: fill-idle 636 min on an empty backlog). A stale marker (chain dead) still raises the alert. */
const noClaimMarks = () => { try { return readdirSync(P()).filter((f) => f.startsWith('noclaim-')).map((f) => ({ at: statSync(P(f)).mtimeMs })); } catch { return []; } };
const noClaimEnd = (name) => { try { return statSync(P('noclaim-' + name)).mtimeMs + 20 * 60e3; } catch { return 0; } };
const noClaimAt = (name) => { try { return statSync(P('noclaim-' + name)).mtimeMs; } catch { return 0; } };
const noClaimHold = (name, now) => { try { return now - statSync(P('noclaim-' + name)).mtimeMs < 20 * 60e3; } catch { return false; } };
async function fillReserve(runs, runningBy, totalRunning, U, api, now) {
  // #1496: each reserved account pool (roles.json accounts[].workers) tops up on its own, never while the worker switch is off
  const SW = withAccountSwitches(CFG, process.env), C = SW.cfg;   // #5045: FILL_WORKERS_<ACCOUNT> = that account's own worker count
  if (fillWant(CFG, now, process.env.FILL_WORKERS) === 0 || !(C.accounts || []).some((a) => a.workers)) return 0;
  const TS = testerSwitch(process.env.FILL_TESTERS);   // #4991: with FILL_TESTERS set the Pro reserve tester is part of that count, never extra
  if (burnPaused(history(), now)) { console.log('fill: paused - repeated burned runs (#1503); reserve pools wait'); return burnHoldEnd(history(), now); }
  const poolOpen = {};
  for (const a of C.accounts) if (a.workers && a.pool && !(a.pool in poolOpen)) {
    const l = (await gh('GET', `/repos/{repo}/issues?state=open&labels=${a.pool}&per_page=50`)) || [];
    poolOpen[a.pool] = l.filter((i) => !i.pull_request && !i.labels.some((x) => ['blocked', 'ask-dan', 'tracking'].includes(x.name))).length;
  }
  {   // a held pool is released the moment a real new issue exists (route.mjs noClaimReleased): the commander's refill must not wait out the 20 min
    const held = (C.accounts || []).filter((a) => a.workers && noClaimHold(a.name, now));
    if (held.length) {
      const fresh = (await gh('GET', `/repos/{repo}/issues?state=open&sort=created&direction=desc&since=${new Date(Math.min(...held.map((a) => noClaimAt(a.name)))).toISOString()}&per_page=30`).catch(() => [])) || [];
      for (const a of held) if (noClaimReleased(noClaimAt(a.name), fresh)) { rmSync(P('noclaim-' + a.name), { force: true }); console.log(`fill: ${a.name} hold released - a new issue was filed since the worker found nothing to claim`); }
    }
  }
  const CFGH = { ...C, accounts: C.accounts.filter((a) => !(a.workers && noClaimHold(a.name, now))) };   // held pools (#1503)
  const heldEnd = Math.max(0, ...(C.accounts || []).filter((a) => a.workers && noClaimHold(a.name, now)).map((a) => noClaimEnd(a.name)));
  for (const p of reservePlan(CFGH, now, runningBy, totalRunning, U, api, poolOpen)) {
    if (TS !== null && p.role === 'tester') continue;
    console.log(`fill: reserve pool ${p.account} - starting ${p.n}`);
    for (let i = 0; i < p.n; i++) await gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', { ref: 'master', inputs: { role: p.role || 'worker', account: p.account, reason: `fill reserve (${p.account} pool)` } });
  }
  return heldEnd;
}
async function fillLocked() {
  const lock = P('fill.lock');
  mkdirSync(P(), { recursive: true });
  try { mkdirSync(lock); }
  catch {
    let age = 0; try { age = Date.now() - statSync(lock).mtimeMs; } catch {}
    if (age < 2 * 60e3) return console.log('fill: another runner is doing it');
    rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock); } catch { return console.log('fill: lost the lock race'); }
  }
  try { await fill(); } finally { rmSync(lock, { recursive: true, force: true }); }
}

/** A waker in `min` minutes unless one is already armed (history.wakes, future times).
 *  #2894: not "any run titled brain waker" - the waker that just fired is in_progress while its fill runs (same flaw as #2820). */
async function wakeIn(min) {
  const now = Date.now(), at = now + min * 60e3;
  if ((history().wakes || []).some((w) => w > now && w <= at + 60e3)) return console.log('wake: a waker is already pending');
  await gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', { ref: 'master', inputs: { role: 'waker', reason: new Date(at).toISOString() } });
  const h = history(); h.wakes = (h.wakes || []).filter((w) => w > now); h.wakes.push(at); saveHistory(h);
  console.log(`wake: waker dispatched for ${new Date(at).toISOString()}`);
}
async function healthIfDue() {
  const due = () => Date.now() - (history().lastHealth || 0) >= 14 * 60e3;
  if (!due()) return console.log('health: not due');
  const lock = P('health.lock');
  mkdirSync(P(), { recursive: true });
  try { mkdirSync(lock); }
  catch {
    let age = 0; try { age = Date.now() - statSync(lock).mtimeMs; } catch {}
    if (age < 10 * 60e3) return console.log('health: another runner is doing it');
    rmSync(lock, { recursive: true, force: true });
    try { mkdirSync(lock); } catch { return console.log('health: lost the lock race'); }
  }
  try { if (due()) await health(); else console.log('health: done by another runner meanwhile'); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}

const cmd = process.argv[2];
if (cmd === 'comment' || cmd === 'route') await comment(cmd === 'route');
else if (cmd === 'health' && process.argv.includes('--if-due')) await healthIfDue();
else if (cmd === 'health') await health();
else if (cmd === 'fill') await fillLocked();
else if (cmd === 'wake') await wakeIn(Number(process.argv[3] || 20));
else { console.log('usage: brain.mjs route|comment|health'); process.exit(2); }
