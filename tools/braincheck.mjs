#!/usr/bin/env node
// braincheck.mjs - proves the brain's decisions (tools/brain/route.mjs, #86). The brain acts with nobody watching:
// a wrong route wakes an Opus commander on every reply (usage burn) or never wakes it (today's 4 lost hours), a
// wrong rate limit lets a loop of wakes run away, a wrong alert rule spams Dan's phone or never reaches it.
// ANTI-VACUITY: broken copies of route.mjs must each be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SRC = fileURLToPath(new URL('./brain/route.mjs', import.meta.url));
const CFG = JSON.parse(readFileSync(fileURLToPath(new URL('./brain/roles.json', import.meta.url)), 'utf8'));
const CF0 = { ...CFG, fill: { workers: CFG.fill.workers, until: CFG.fill.until } };   // the usage caps are tested on their own below
const T0 = Date.parse('2026-09-29T12:00:00Z'), MIN = 60e3, HR = 3600e3;

let N = 0;
function run(R) {
  const f = [];
  const ok = (c, m) => { N++; if (!c) f.push(m); };
  const rc = (b) => R.routeComment(b, CFG);
  ok(rc('to: commander\nfrom: loop\n\nHUGE ERROR disk').role === 'commander', 'mail to commander wakes the commander');
  ok(rc('to: commander\nfrom: brain\n\nhealth: master-red').role === 'commander', 'a health alarm from the brain wakes the commander');
  ok(rc('to: commander\nfrom: loop\nre: 123\n\nthanks').do === 'none', 'a reply wakes nobody');
  ok(rc('to: commander\nfrom: commander\n\nnote to self').do === 'none', 'mail to itself wakes nobody');
  ok(rc('to: #52\nfrom: commander\n\nhi').do === 'none', 'mail to a worker wakes nobody (it reads at its next go.mjs call)');
  ok(rc('to: log\nfrom: brain\n\nbrain: commander run ended').do === 'none', 'the brain\'s log lines wake nobody');
  ok(rc('to: dan\nfrom: commander\n\npress F9').do === 'notify', 'mail to dan goes to his phone');
  ok(rc('plain comment').do === 'none', 'a comment without to: is ignored');
  ok(R.routeComment('to: fixer\nfrom: commander\n\ndisk full', CFG).role === 'fixer', 'mail to fixer starts a fixer');
  { // 6 Oct: hung runs are cancelled (overdueRuns)
    const run = (title, status, minAgo) => ({ id: 1, display_title: title, status, run_started_at: new Date(T0 - minAgo * MIN).toISOString() });
    const od = (r) => R.overdueRuns([r], T0).length;
    ok(od(run(`brain waker ${new Date(T0 - 6 * MIN).toISOString()}`, 'in_progress', 20)) === 1, 'a waker 6 min past its wake time is cancelled');
    ok(od(run(`brain waker ${new Date(T0 + 8 * MIN).toISOString()}`, 'in_progress', 7)) === 0, 'a waker still sleeping toward its wake time is left alone');
    ok(od(run(`brain waker ${new Date(T0 - 6 * MIN).toISOString()}`, 'queued', 20)) === 0, 'a queued waker is the pending one: never cancelled');
    ok(od(run('brain issue_comment', 'in_progress', 11)) === 1 && od(run('brain issue_comment', 'in_progress', 4)) === 0, 'a comment-routed run is cancelled after 10 min');
    ok(od(run('brain worker @pro', 'in_progress', 121)) === 1 && od(run('brain worker @pro', 'in_progress', 100)) === 0, 'a session run is cancelled after 120 min, not before');
  }
  const have = (s) => (n) => s.includes(n);
  ok(R.pickAccount(CFG, Date.parse('2026-09-29T00:00Z'), have(['max', 'pro'])) === 'max', 'max is used until it ends');
  ok(R.pickAccount(CFG, Date.parse('2026-11-01T00:00Z'), have(['max', 'pro'])) === 'pro', 'pro after max ends');
  ok(R.pickAccount(CFG, Date.parse('2026-09-29T00:00Z'), have(['pro'])) === 'pro', 'an account with no token is skipped');
  ok(R.pickAccount(CFG, T0, have([])) === null, 'no token at all = no account');
  // 1 Oct (Dan): run on Max until ITS week reaches 96, then Pro (each account has its own weekly cap)
  const UA = (mx, pr, at = T0) => ({ at: new Date(at).toISOString(), accounts: { max: { week: { pct: mx[0] }, window: { pct: mx[1] } }, pro: { week: { pct: pr[0] }, window: { pct: pr[1] } } } });
  const pk = (u) => R.pickAccount(CFG, T0, have(['max', 'pro']), u);
  ok(pk(UA([85, 0], [51, 91])) === 'max', 'max under its caps is used even when pro is capped');
  ok(pk(UA([95, 0], [10, 10])) === 'max', 'max keeps going past the shared 90 up to its own 96');
  ok(pk(UA([96, 0], [51, 10])) === 'pro', 'max at its 96 weekly falls to pro');
  ok(pk(UA([96, 0], [91, 10])) === 'max', 'every account capped = the first valid one (launch then skips)');
  ok(pk(UA([96, 0], [51, 10], T0 - 40 * MIN)) === 'max', 'stale usage is unknown, so the first valid account');
  ok(R.accountWeekCap(CFG, 'max') === 96 && R.accountWeekCap(CFG, 'pro') === CFG.fill.maxWeekPct, 'max has its own weekly cap, pro uses the shared one');
  const UC = (wk, cap) => ({ window: { pct: 0, resets_at: null }, week: { pct: wk }, at: new Date(T0).toISOString(), ...(cap ? { weekCap: cap } : {}) });
  ok(R.usageCap(CFG, UC(93, 96), T0) !== 0 && R.usageCap(CFG, UC(96, 96), T0) === 0, 'usageCap honours the account\'s own weekly cap');
  ok(R.usageCap(CFG, UC(93), T0) === 0, 'without an account cap the shared maxWeekPct still stops it');
  const st = (n, ago) => Array.from({ length: n }, () => ({ role: 'commander', at: T0 - ago }));
  ok(R.rateOk(st(2, 10 * MIN), 'commander', T0, 3) === true, '2 starts in the hour leaves room under 3');
  ok(R.rateOk(st(3, 10 * MIN), 'commander', T0, 3) === false, '3 starts in the hour blocks a 4th');
  ok(R.rateOk(st(3, 2 * HR), 'commander', T0, 3) === true, 'starts over an hour old do not count');
  const m = (o) => ({ id: 1, to: 'commander', from: 'loop', re: '', answered: false, created_at: new Date(T0 - 30 * MIN).toISOString(), ...o });
  const keys = (snap) => R.findings({ now: T0, runners: [], mail: [], ...snap }, CFG).map((x) => x.key);
  ok(keys({ mail: [m({})] }).includes('mail-unanswered'), 'mail to commander unanswered for 30 min is found');
  ok(!keys({ mail: [m({ answered: true })] }).length, 'answered mail is not');
  ok(!keys({ mail: [m({ from: 'commander' })] }).length, 'self-mail is not');
  ok(!keys({ mail: [m({ created_at: new Date(T0 - 5 * MIN).toISOString() })] }).length, 'fresh mail is not (the wake is still running)');
  ok(keys({ masterRed: true }).includes('master-red'), 'a red master is found');
  ok(keys({ runners: [{ name: 'X', status: 'offline' }, { name: 'Y', status: 'online' }] }).join() === 'runner-offline:X', 'only the offline runner is found');
  ok(keys({ runners: [{ name: 'DADS', status: 'offline', labels: ['self-hosted', 'Windows', 'mclite', 'win'] }, { name: 'PC', status: 'online', labels: ['self-hosted', 'mclite', 'win', 'gpu'] }] }).length === 0, 'an offline runner whose labels an online runner covers raises nothing');
  ok(keys({ runners: [{ name: 'PC2', status: 'offline', labels: ['self-hosted', 'mclite', 'gpu'] }, { name: 'PC', status: 'online', labels: ['self-hosted', 'mclite'] }] }).join() === 'runner-offline:PC2', 'an offline runner with a label nobody online has (gpu) is found');
  const F = [{ key: 'mail-unanswered', text: 't' }], MR = [{ key: 'master-red', text: 't' }];
  let d = R.dueAlerts(F, [], [], CFG, T0); ok(d.mail.length === 1 && d.dan.length === 0, 'new problem: mail the commander, not Dan yet');
  d = R.dueAlerts(F, [{ key: 'mail-unanswered', at: T0 - 30 * MIN }], [], CFG, T0); ok(!d.mail.length, 'no second mail within 2 h');
  d = R.dueAlerts(MR, [{ key: 'master-red', at: T0 - 3 * HR }], [], CFG, T0); ok(!d.mail.length, 'master-red re-alerts only after 12 h');
  d = R.dueAlerts(F, [{ key: 'mail-unanswered', at: T0 - 90 * MIN }], [], CFG, T0); ok(d.dan.length === 1, 'wrong for over an hour: tell Dan');
  d = R.dueAlerts(F, [{ key: 'mail-unanswered', at: T0 - 90 * MIN }], [{ key: 'mail-unanswered', at: T0 - 30 * MIN }], CFG, T0); ok(!d.dan.length, 'Dan is not told twice within 2 h');
  d = R.dueAlerts(F, [{ key: 'mail-unanswered', at: T0 - 3 * 86400e3 }], [], CFG, T0); ok(!d.dan.length, 'an old, finished episode does not page Dan at once');
  ok(R.fillCount(CF0, Date.parse('2026-09-29T12:00Z'), 1) === CF0.fill.workers - 1, 'fill tops the workers up');
  ok(R.fillCount(CF0, Date.parse('2026-09-29T12:00Z'), CF0.fill.workers + 3) === 0, 'fill never goes negative');
  ok(R.fillCount(CF0, Date.parse('2028-01-01T00:00Z'), 0) === 0, 'fill stops at its end date');
  ok(R.fillCount(CF0, Date.parse('2028-01-01T00:00Z'), 1, '3') === 2, 'the phone switch (FILL_WORKERS) wins over the end date');
  ok(R.fillCount(CF0, Date.parse('2026-09-29T12:00Z'), 0, '0') === 0, 'the phone switch can turn workers off');
  ok(R.fillCount(CF0, Date.parse('2026-09-29T12:00Z'), 0, '') === CF0.fill.workers, 'an empty switch leaves roles.json in charge');
  ok(R.fillCount(CF0, Date.parse('2026-09-29T12:00Z'), 0, '40') === 10, 'the switch is capped at the 10 brain runners');
  ok(R.fillCount(CF0, Date.parse('2026-09-29T12:00Z'), 0, '5@2026-09-30T04:00Z') === 5, 'a timed switch holds until its time');
  ok(R.fillCount(CF0, Date.parse('2028-01-01T12:00Z'), 0, '5@2026-09-30T04:00Z') === 0, 'a timed switch expires (roles.json decides: past its end = 0)');
  const C2 = { ...CFG, fill: { workers: 3, maxWindowPct: 70, maxWeekPct: 85 } }, U = (w, k, at = T0) => ({ window: { pct: w }, week: { pct: k }, at: new Date(at).toISOString() });
  ok(R.fillCount(C2, T0, 0, '', U(40, 30)) === 3, 'usage under the caps: fill as normal');
  ok(R.fillCount(C2, T0, 0, '', U(70, 30)) === 0, 'the 5-hour window at its cap starts no worker');
  ok(R.fillCount(C2, T0, 0, '5', U(95, 30)) === 0, 'the usage cap beats the phone switch');
  ok(R.fillCount(C2, T0, 0, '', U(10, 85)) === 0, 'the week at its cap starts no worker');
  ok(R.fillCount(C2, T0, 0, '', null) === 1, 'unknown usage: at most one worker');
  ok(R.fillCount(C2, T0, 1, '', U(10, 10, T0 - 2 * HR)) === 0, 'stale usage counts as unknown (one worker, already running)');
  // #1496: reserved account pools (Dan, 1 Oct: Pro keeps 2 Opus workers of its own; Opus only for `opus` issues)
  const CP = { ...CFG, fill: { ...CF0.fill, maxWindowPct: 90, maxWeekPct: 90, maxTotal: 5 }, accounts: [{ name: 'max' }, { name: 'pro', workers: 2, pool: 'opus' }] };
  const UPA = (pw, ww, resets = null) => ({ at: new Date(T0).toISOString(), accounts: { max: { window: { pct: 10 }, week: { pct: 10 } }, pro: { window: { pct: pw, resets_at: resets }, week: { pct: ww } } } });
  const rp = (by, tot, u, open) => JSON.stringify(R.reservePlan(CP, T0, by, tot, u, null, open));
  const PRO = (n) => JSON.stringify(n ? [{ account: 'pro', n }] : []);
  ok(rp({}, 3, UPA(0, 50), { opus: 5 }) === PRO(2), 'Pro under its caps gets its 2 reserved workers');
  ok(rp({ pro: 1 }, 3, UPA(0, 50), { opus: 5 }) === PRO(1), 'one Pro worker already running: one more');
  ok(rp({ pro: 2 }, 5, UPA(0, 50), { opus: 5 }) === PRO(0), 'both running: nothing more');
  ok(rp({}, 3, UPA(95, 50), { opus: 5 }) === PRO(0), "Pro's own 5-hour window at its cap starts none (Max's usage is not Pro's)");
  ok(rp({}, 3, UPA(0, 91), { opus: 5 }) === PRO(0), "Pro's own week at its cap starts none");
  ok(rp({}, 3, UPA(98, 50, new Date(T0 - 60e3).toISOString()), { opus: 5 }) === PRO(2), 'a Pro window that has reset counts as 0%: both workers start');
  ok(rp({}, 4, UPA(0, 50), { opus: 5 }) === PRO(1), 'fill.maxTotal (5) holds over every running worker');
  ok(rp({}, 3, UPA(0, 50), { opus: 0 }) === PRO(0), 'no open `opus` issue = no Opus session started');
  ok(rp({}, 3, UPA(0, 50), { opus: 1 }) === PRO(1), 'one open `opus` issue = one Opus worker');
  ok(rp({ pro: 1 }, 4, UPA(0, 50), { opus: 1 }) === PRO(0), 'the running Opus worker holds the only `opus` issue');
  ok(rp({}, 3, null, { opus: 5 }) === PRO(1), 'unknown Pro usage: at most one worker (blind, not stopped)');
  ok(JSON.stringify(R.reservePlan({ ...CP, accounts: [{ name: 'max' }, { name: 'pro', workers: 2, pool: 'opus', until: new Date(T0 - 1).toISOString() }] }, T0, {}, 0, UPA(0, 50), null, { opus: 5 })) === '[]', 'an ended account gets no reserve');
  ok(R.fillWant(CP, T0, '0') === 0 && R.fillWant(CP, T0, '3') === 3, 'the worker switch is readable on its own (reserve never runs while it is 0)');
  ok(CFG.fill.testers >= 1 && CFG.fill.testers + CFG.accounts.reduce((n, a) => n + (a.workers || 0), 0) <= CFG.fill.maxTotal, 'Max runs tester passes and testers + the reserved pools never exceed maxTotal (#4298: 1 worker + 9 testers is the default shape, so testers may now fill all but the one worker slot)')
  // #5045: per-account worker counts (FILL_WORKERS_<ACCOUNT>)
  ok(R.acctSwitch('8') === 8 && R.acctSwitch('99') === 10 && R.acctSwitch('') === null && R.acctSwitch(undefined) === null && R.acctSwitch('x') === null, 'acctSwitch reads 0-10 (capped at 10); anything else is unset');
  const SWC = { accounts: [{ name: 'max' }, { name: 'pro', workers: 1, role: 'tester' }] }, SW5 = R.withAccountSwitches(SWC, { FILL_WORKERS_MAX: '6', FILL_WORKERS_PRO: '2' });
  ok(SW5.active && SW5.cfg.accounts[0].workers === 6 && SW5.cfg.accounts[1].workers === 2 && !('role' in SW5.cfg.accounts[1]), 'each account gets its own worker count and a switched account is a worker pool, not the reserved tester');
  ok(!R.withAccountSwitches(SWC, {}).active && R.withAccountSwitches(SWC, {}).cfg.accounts[1].role === 'tester', 'no switch set = nothing changes (the universal FILL_WORKERS pool and the reserved tester stay)');
  // #5039: a dependency wait is not a burn - dependsOn is what launch.mjs and the queue read
  ok(R.dependsOn('x\n\nDepends on: #12, #34\nDepends on: 56').join() === '12,34', 'dependsOn reads every #N of a Depends on line');
  ok(R.dependsOn('no dependency here #7').length === 0 && R.dependsOn(null).length === 0, 'no Depends on line, no dependency');
  // #5047: the 08:00-14:00 window scales each account's count by the quiet factor (Max 8 + Pro 2 -> 4 + 1), full outside it
  { const mkq = (q) => ({ fill: { maxTotal: 10, maxWindowPct: 90, maxWeekPct: 90, sessionPctPerHour: 6, ...(q ? { quiet: { tz: 'UTC', from: '00:00', to: '24:00', factor: 0.5 } } : {}) }, accounts: [{ name: 'max', workers: 8 }, { name: 'pro', workers: 2 }] });
    const uq = { at: new Date(T0).toISOString(), accounts: { max: { window: { pct: 0 }, week: { pct: 10 } }, pro: { window: { pct: 0 }, week: { pct: 10 } } } };
    ok(JSON.stringify(R.reservePlan(mkq(true), T0, {}, 0, uq, null, {})) === '[{"account":"max","n":4},{"account":"pro","n":1}]', 'in the quiet window Max 8 + Pro 2 become 4 + 1 (proportional, Pro is not starved)');
    ok(JSON.stringify(R.reservePlan(mkq(false), T0, {}, 0, uq, null, {})) === '[{"account":"max","n":8},{"account":"pro","n":2}]', 'outside the window Max 8 + Pro 2 run in full'); }
  // #5052: the runner workspace is trusted before claude starts (else permissions.allow is ignored)
  { const tp = R.trustPatch('{"projects":{"/w":{"x":1}}}', '/w'); const tj = tp && JSON.parse(tp);
    ok(tj && tj.projects['/w'].hasTrustDialogAccepted === true && tj.projects['/w'].x === 1, 'trustPatch sets hasTrustDialogAccepted and keeps the rest of the project entry');
    ok(R.trustPatch('{"projects":{"/w":{"hasTrustDialogAccepted":true}}}', '/w') === null && R.trustPatch('not json', '/w') === null, 'already trusted, or an unreadable file, writes nothing');
    ok(JSON.parse(R.trustPatch('', '/w')).projects['/w'].hasTrustDialogAccepted === true, 'a missing file gets created trusted'); }
  // #1503: the boondoggle guard
  const bt = (...mins) => ({ burnTimes: mins.map((m) => T0 - m * MIN) });
  ok(R.burnPaused(bt(5, 10, 20, 40), T0) === true, '4 burned runs in the last hour pause the fill');
  ok(R.burnPaused(bt(5, 10, 20), T0) === false, '3 burns do not');
  ok(R.burnPaused(bt(35, 40, 50, 55), T0) === false, '4 burns but the newest is 35 min old: the pause is over');
  ok(R.burnPaused(bt(5, 10, 20, 70), T0) === false, 'a burn older than an hour does not count');
  ok(R.burnPaused({}, T0) === false && R.burnPaused(null, T0) === false, 'no history = no pause');
  { // #6631: the bar scales with the hour's worker starts
    const busy = (nb) => ({ ...bt(...Array.from({ length: nb }, (_, i) => 5 + i)), starts: Array.from({ length: 35 }, (_, i) => ({ role: 'worker', at: T0 - (i + 1) * 60e3 })) });
    ok(R.burnPaused(busy(4), T0) === false, '#6631: 4 burns of 35 worker starts do not pause a busy fill');
    ok(R.burnPaused(busy(14), T0) === true, '#6631: 14 burns of 35 starts (40%) do');
    const fixed = (h, now) => { const b = (h.burnTimes || []).filter((t) => now - t < 3600e3); return b.length >= 4 && now - Math.max(...b) < 30 * 60e3; };
    ok(fixed(busy(4), T0) === true, '#6631 break: a fixed bar of 4 must pause the busy case (so the case can fail)');
  }
  // #1575: a pause must end with a wake, and a stall with no wake must be detected
  ok(R.burnHoldEnd(bt(5, 10, 20, 40), T0) === T0 - 5 * MIN + 30 * MIN, 'the burn pause ends 30 min after the newest burn (the waker fires then)');
  ok(R.burnHoldEnd(bt(5, 10, 20), T0) === 0, 'no pause, no hold end');
  ok(R.holdWakeAt(T0 - 5 * MIN, T0) === T0 + 60e3, 'a waker is never set in the past');
  ok(R.holdWakeAt(T0 + 10 * MIN, T0) === T0 + 10 * MIN + 30e3, 'a waker fires just after the hold ends');
  const ST = (...m) => ({ starts: m.map((x) => ({ role: 'worker', at: T0 - x * MIN })) });
  ok(R.fillIdleMin(ST(50), 0, 6, T0) === 50, 'the fill wanted workers, nothing ran for 50 min: idle');
  ok(R.fillIdleMin(ST(50), 1, 6, T0) === 0, 'a queued waker or worker means not idle');
  ok(R.fillIdleMin(ST(50), 0, 0, T0) === 0, 'the worker switch is off: not idle');
  ok(R.findings({ now: T0, runners: [], mail: [], fillIdleMin: 50 }, CFG).some((f) => f.key === 'fill-idle'), 'an idle fill raises the fill-idle alert (mails the commander AND the fixer)');
  ok(!R.findings({ now: T0, runners: [], mail: [], fillIdleMin: 10 }, CFG).some((f) => f.key === 'fill-idle'), 'a short gap raises nothing');
  ok(R.reservePlan({ ...CP, accounts: [{ name: 'max' }, { name: 'pro', workers: 2, role: 'tester' }] }, T0, {}, 0, UPA(0, 50), null, {})[0]?.role === 'tester', 'a reserve account can hold TESTER slots (Pro: 2 testers)');
  // 30 Sept: the shared GitHub quota ran dry twice and killed every running session - fill must stop BEFORE that
  const A = (remaining) => ({ remaining, limit: 5000, reset: T0 + HR });
  ok(R.fillCount(C2, T0, 0, '', U(40, 30), A(4000)) === 3, 'plenty of API quota: fill as normal');
  ok(R.fillCount(C2, T0, 0, '', U(40, 30), A(900)) === 0, 'API quota under fill.minApiLeft starts no worker');
  ok(R.fillCount(C2, T0, 0, '10', U(40, 30), A(0)) === 0, 'an empty API quota beats the phone switch');
  ok(R.fillCount(C2, T0, 0, '', U(40, 30), null) === 3, 'unknown API quota does not stop the fill');
  ok(R.busFull(CFG, 5000) === true && R.busFull(CFG, 20) === false, 'a long bus is rotated, a short one kept');
  ok(R.burnVerdict({}, 7, false).block === false && R.burnVerdict({ 7: 1 }, 7, false).block === false && R.burnVerdict({ 7: 2 }, 7, false).block === true, '#2861: the Opus attempt after two empty Sonnet runs is allowed; its failure blocks the issue');
  ok(R.escalationFor({ 7: 1 }, 7) === null && R.escalationFor({}, 7) === null && R.escalationFor({ 7: 3 }, 7) === null, '#2861: Sonnet for attempts 1-2, nothing after the block');
  ok(R.escalationFor({ 7: 2 }, 7)?.model === 'claude-opus-5-5' && R.escalationFor({ 7: 2 }, 7)?.effort === 'medium', '#2861: exactly the 3rd attempt is Opus at medium');
  ok(R.burnVerdict({ 7: 1 }, 7, true).n === 0, 'a run that produced a PR or hand-off resets the count');
  const sum = { result: 'fixed the token auth bug (invalid token path, oauth, 401 unauthorized, 403)', is_error: false };
  ok(R.authFailed('', sum, null) === false, 'a summary mentioning token/auth/403 is not a login failure');
  ok(R.authFailed('', { result: 'Invalid API key · Please run /login', is_error: true }, null) === true, 'a real CLI auth error notifies');
  ok(R.authFailed('Error: not logged in', {}, null) === true, 'stderr auth error notifies');
  ok(R.authFailed('Invalid API key', {}, { kind: 'week' }) === false, 'a limit-ended run never notifies');
  { // #3947: mail parked at the cap re-routes after the hour rolls, at once under the cap, never twice in 5 min
    const full = [{ role: 'fixer', at: T0 - 50 * MIN }, { role: 'fixer', at: T0 - 40 * MIN }, { role: 'fixer', at: T0 - 30 * MIN }, { role: 'fixer', at: T0 - 20 * MIN }];
    const pm = { fixer: { reason: 'task (bus message 1)' } };
    ok(R.pendingMailDue(pm, full, CFG, T0).length === 0, 'parked fixer mail waits while the fixer is at maxPerHour');
    ok(R.pendingMailDue(pm, full, CFG, T0 + 11 * MIN)[0]?.reason === 'task (bus message 1)', 'parked fixer mail re-routes once the oldest start leaves the hour');
    ok(R.pendingMailDue(pm, [], CFG, T0).length === 1, 'parked mail under the cap starts at once');
    ok(R.pendingMailDue({ fixer: { reason: 'x', sent: T0 - MIN } }, [], CFG, T0).length === 0, 'mail dispatched a minute ago is not dispatched twice');
    ok(CFG.roles.fixer.maxPerHour >= 4, 'fixer maxPerHour is 4');
  }
  return f;
}

const R0 = await import(pathToFileURL(SRC).href), fails = run(R0);
// 30 Sept: an unbounded read of the whole bus (thousands of comments, up to 50 calls each) in every go.mjs call emptied
// the shared GitHub quota. Bus reads go through busComments(days) (gh.mjs), which asks only for recent comments.
for (const f of ['go.mjs', 'brain/brain.mjs', 'brain/launch.mjs', 'infra/relay.mjs']) {
  const code = readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8');
  N++; if (/ghAll\(`\/repos\/\{repo\}\/issues\/\$\{(bus|await busIssue\(\)|await busNo\(\))\}\/comments`\)/.test(code)) fails.push(`${f} reads the WHOLE bus - use busComments(days)`);
}
const total = N;
const src = readFileSync(SRC, 'utf8');
const BREAKS = [
  ['replies wake the commander', "if (re) return { do: 'none', why: 'a reply needs no answer' };", ''],
  ['parked mail ignores the cap', 'rateOk(starts, r, now, cfg.roles[r].maxPerHour) && ', ''],
  ['parked mail is re-sent every pass', 'now - (p.sent || 0) > 5 * 60e3', 'true'],
  ['the rate limit lets one extra start through', '.length < maxPerHour', '.length <= maxPerHour'],
  ['answered mail counts as unanswered', '!m.re && !m.answered &&', '!m.re &&'],
  ['fill ignores its end date', ' || (F.until && Date.parse(F.until) <= now)', ''],
  ['the phone switch is ignored', "(/^\\d+$/.test(o) && !(exp", "(false && !(exp"],
  ['a timed switch never expires', " && !(exp && Date.parse(exp) <= now)", ""],
  ['the window cap is ignored', 'usage.window.pct >= F.maxWindowPct) return 0', 'usage.window.pct > 999) return 0'],
  ['the week cap is ignored', '|| 0) >= weekCap) return 0', '|| 0) > 999) return 0'],
  ["the account's own weekly cap is ignored", 'usage.weekCap ?? F.maxWeekPct', 'F.maxWeekPct'],
  ['account choice ignores usage', 'const fresh = u && u.accounts &&', 'const fresh = false && u.accounts &&'],
  ['account choice ignores the weekly cap', '!(cap != null && x.week.pct >= cap)', 'true'],
  ['stale usage picks the account', ' && !(u.at && now - Date.parse(u.at) > 30 * 60e3);', ';'],
  ['unknown usage runs blind at full strength', 'if (!fresh) return 1;', 'if (!fresh) return Infinity;'],
  ['stale usage counts as fresh', ' && !(usage.at && now - Date.parse(usage.at) > 30 * 60e3)', ''],
  ['empty runs never block', 'block: n >= BURNS_BEFORE_BLOCK', 'block: false'],
  ['no Opus escalation', '=== SONNET_ATTEMPTS ? ESCALATION', '=== 99 ? ESCALATION'],
  ['Opus at high, not medium', "effort: 'medium' }", "effort: 'high' }"],
  ['the API quota is ignored', 'Math.min(fillWant(cfg, now, override, usage), usageCap(cfg, usage, now), apiCap(cfg, api))', 'Math.min(fillWant(cfg, now, override, usage), usageCap(cfg, usage, now))'],
  ['reserve ignores the account\'s own usage', 'usageCap(cfg, usage, now), apiCap(cfg, api), room, open', 'apiCap(cfg, api), room, open'],
  ['reserve ignores fill.maxTotal', 'apiCap(cfg, api), room, open', 'apiCap(cfg, api), open'],
  ['reserve ignores the pool\'s open issues', 'room, open)', 'room, Infinity)'],
  ['reserve ignores workers already running', 'want - mine', 'want'],
  ['an ended account still gets a reserve', "if (!a.workers || (a.until && Date.parse(a.until) <= now)) continue;", 'if (!a.workers) continue;'],
  ['an account switch is ignored', "const n = acctSwitch((env || {})['FILL_WORKERS_'", "const n = acctSwitch(({})['FILL_WORKERS_'"],
  ['a switched account keeps the tester role', 'const { role, ...rest } = a; return { ...rest, workers: n };', 'return { ...a, workers: n };'],
  ['dependsOn finds nothing', 'matchAll(/^Depends on:', 'matchAll(/^Dependz on:'],
  ['the quiet window does not scale the accounts', 'scaledTarget(a.workers, quietState(cfg, now).factor)', 'a.workers'],
  ['trust is never set', 'hasTrustDialogAccepted: true };', 'hasTrustDialogAccepted: false };'],
  ['burns never pause', 'return b.length >= Math.max(4, Math.ceil(0.4 * starts)) && now - Math.max(...b) < 30 * 60e3;', 'return false;'],
  ['old burns still count', "const b = ((hist && hist.burnTimes) || []).filter((t) => now - t < 3600e3);", "const b = ((hist && hist.burnTimes) || []).filter((t) => true);"],
  ['the pause never ends', 'b.length >= Math.max(4, Math.ceil(0.4 * starts)) && now - Math.max(...b) < 30 * 60e3', 'b.length >= Math.max(4, Math.ceil(0.4 * starts))'],
  ['#6631 the bar ignores throughput', 'Math.max(4, Math.ceil(0.4 * starts))', '4'],
  ['the worker switch off does not stop fill', 'const base = Math.ceil(want * quietState', 'const base = 1 || Math.ceil(want * quietState'],
  ['a low API quota still fills', 'api.remaining < floor ? 0 : Infinity', 'Infinity'],
  ['the burn hold never ends', 'return Math.max(...((hist && hist.burnTimes) || []).filter((t) => now - t < 3600e3)) + 30 * 60e3;', 'return 0;'],
  ['a waker can be set in the past', 'Math.max(holdUntil + 30e3, now + 60e3)', 'holdUntil + 30e3'],
  ['an idle fill is never noticed', 'if (!wanted || activeRuns > 0) return 0;', 'return 0;'],
  ['overdue runs are never cancelled', "if (age > limit) out.push", 'if (false) out.push'],
  ['a queued waker is cancelled too', "if (r.status !== 'in_progress') continue;", ''],
  ['a waker gets the 2-hour limit', "(at ? (at + 5 * 60e3 - Date.parse(r.run_started_at || r.created_at)) / 60e3 : 105)", '120'],
  ['the fill-idle alert is dropped', "snap.fillIdleMin >= (H.fillIdleMinutes || 45)", 'false'],
  ['a reserve account loses its role', "...(a.role ? { role: a.role } : {})", ''],
  ['the bus is never rotated', 'comments >= ((cfg.bus', 'comments >= 1e9 + ((cfg.bus'],
  ['auth check reads the summary', "res && (res.is_error || res.error) ?", 'res ?'],
  ['auth check ignores limit', 'if (limit) return false;', ''],
  ['auth check matches bare words', 'invalid (api key|.*token)|not logged in|', 'login|auth|token|403|'],
  ['an ended account is still used', "(!a.until || Date.parse(a.until) > now) && ", ''],
];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (!src.includes(from)) { fails.push(`break "${name}": route.mjs no longer contains ${from} - update this check`); continue; }
  const dir = mkdtempSync(join(tmpdir(), 'braincheck-')), f = join(dir, 'route.mjs');
  writeFileSync(f, src.split(from).join(to));
  const bf = run(await import(pathToFileURL(f).href));
  if (bf.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`braincheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !x.startsWith('break')).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
