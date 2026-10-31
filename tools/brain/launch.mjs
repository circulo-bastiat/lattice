#!/usr/bin/env node
// launch.mjs - start ONE headless Claude Code session for a role (#86). Called by brain.yml on the `brain` runner
// in the sandbox VM; also by hand there: node tools/brain/launch.mjs --role commander --reason "test".
// The role's model/prompt come from roles.json; the login is a `claude setup-token` token per account in BRAIN_HOME.
// Nothing here needs an app scheduled task, update_trigger or anyone's approval (Dan's order, 28 Sept).
import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CFG, P, secret, history, saveHistory, notify, post, setPendingMail, pendingMail } from './home.mjs';
import { trimLaunch, pickAccount, accountWeekCap, rateOk, promptFor, burnVerdict, needsPc, usageCap, parseLimit, applyLimits, authFailed, modelFor } from './route.mjs';
import { workerModelFor, dependsOn, trustPatch, escalationFor } from './route.mjs';   // #5017
import { ensurePlugins, ponytailMode, readPluginState } from './plugins.mjs';
import { mobHash, readLedger, writeLedger, record } from './auditledger.mjs';
import { ROOT, gh } from '../infra/gh.mjs';
import { cutOff, continuation, salvage } from './salvage.mjs';   // #5052
import { accountFault, claimIsVoid } from './acctfault.mjs';   // #10723
import { releaseOrphan } from './orphan.mjs';   // #8977
import { wantsResume, ranProduced, resumeMessage, resumeArgs, mergeRun } from './shortfall.mjs';   // 21 Oct: an early empty ending is resumed once
import { classifyBlocker, planGap, gapBody } from '../infra/envgap.mjs';
import { reviewBrief } from './reviewtick.mjs';   // #9739   // #9376: the env-gap hold calls these; 22 Oct: they were never imported (ReferenceError swallowed by its try/catch)

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const role = arg('--role'), reason = arg('--reason') || '', dry = process.argv.includes('--dry');
// #8893: no waker role - wanted wake times live in history.wakes and the 5-minute schedule tick in brain.yml acts on them.
const R = CFG.roles[role];
if (!R) { console.log(`unknown role "${role}" - roles: ${Object.keys(CFG.roles).join(', ')}`); process.exit(2); }

const now = Date.now(), h = history();
if (!dry && /^(fill|test slot)/.test(reason)) {   // #4991: a fill-made run already dispatched (or parked) when Dan set FILL_WORKERS=0 must not start
  const sw = await gh('GET', '/repos/{repo}/actions/variables/FILL_WORKERS', null, { ok404: true }).catch(() => null);
  const st = role === 'tester' ? await gh('GET', '/repos/{repo}/actions/variables/FILL_TESTERS', null, { ok404: true }).catch(() => null) : null;
  if (st && String(st.value).trim() === '0') { console.log(`SKIP ${role}: the tester switch FILL_TESTERS=0 (#4991)`); setPendingMail(role, null); process.exit(0); }
  if (sw && String(sw.value).trim() === '0' && !(st && /^[1-9]/.test(String(st.value).trim()))) { console.log(`SKIP ${role}: the worker switch FILL_WORKERS=0 (#4991)`); setPendingMail(role, null); process.exit(0); }
}
if (!rateOk(h.starts, role, now, R.maxPerHour)) {
  console.log(`SKIP ${role}: already started ${R.maxPerHour}x in the last hour (roles.json maxPerHour)`);
  if (role !== 'worker' && reason && !dry) {           // #3947: a capped MAIL is parked, not dropped: fill() re-routes it when the hour rolls
    const already = !!pendingMail()[role];                // #4970: the post re-triggers the brain; re-posting every re-launch was a 30 s bus flood
    setPendingMail(role, { reason, at: now });
    if (!already) await post('log', `brain: ${role} mail held - ${role} already started ${R.maxPerHour}x this hour (maxPerHour); it runs when the oldest start leaves the hour`).catch(() => {});
  }
  if (!dry) {                                          // a waker for when the oldest start leaves the hour (no runner sleeps)
    const oldest = Math.min(...h.starts.filter((x) => x.role === role && now - x.at < 3600e3).map((x) => x.at));
    const mins = Math.max(1, Math.ceil((oldest + 3600e3 + 30e3 - now) / 60e3));
    spawnSync('node', ['tools/brain/brain.mjs', 'wake', String(mins)], { stdio: 'inherit' });
  }
  process.exit(0);
}
let U = null; if (!dry) { try { U = JSON.parse((await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }))?.value || 'null'); } catch {} }
U = applyLimits(U, history().limits, now);   // #1937: an account claude said is out stays out until its stated reset
const forced = arg('--account');                       // #1496: a reserved pool's run names its account (brain.yml `account` input)
const account = forced && CFG.accounts.some((a) => a.name === forced) && secret('tokens', `${forced}.txt`) ? forced : pickAccount(CFG, now, (n) => !!secret('tokens', `${n}.txt`), U);
let MODEL = workerModelFor(role, modelFor(reason, (role === 'worker' && forced === account && (CFG.accounts.find((a) => a.name === account) || {}).model) || R.model), R.model);   // Opus only on the pool that asked for it
if (!account) {
  const msg = 'The brain has no Claude login: double-click MAKE-BRAIN-TOKEN.cmd in Projects (once per account).';
  console.log(`FAIL ${msg}`);
  if (!dry) { await notify(msg); await post('commander', `brain: could not start ${role} - ${msg}`).catch(() => {}); }
  process.exit(1);
}
// PRO (30 Sept, Dan: "leave it good for the pro acc"): fill() caps only the WORKERS it dispatches; a health alert could
// still start an Opus commander (or a fixer/tester/chore) on a window Dan is using himself. Every role now obeys the
// same fill.maxWindowPct / maxWeekPct caps, read for the account this run would use.
if (!dry) {
  let usage = null; try {
    const u = U;
    const a = u && u.accounts ? u.accounts[account] : u;
    usage = a && a.window ? { window: a.window, week: a.week, at: u.at, weekCap: accountWeekCap(CFG, account) } : null;
  } catch {}
  if (usageCap(CFG, usage, now) === 0) {
    console.log(`SKIP ${role}: ${account} usage at the cap (${usage.window.pct}%/5h, ${usage.week?.pct}%/wk; roles.json fill.maxWindowPct/maxWeekPct)`);
    await post('log', `brain: ${role} not started - ${account} usage at the cap (${usage.window.pct}%/5h, ${usage.week?.pct}%/wk)`).catch(() => {});
    process.exit(0);
  }
}
// #125: a worker's issue is claimed and its workspace built by brain.yml BEFORE Claude starts (`go.mjs start` hung for
// 10+ min inside ~20 of 39 worker sessions on 28 Sept, each one a burned run). The brief goes straight into the prompt.
const BRIEF = join(ROOT, '.git', 'mclite-brief.txt');
const brief = role === 'worker' && existsSync(BRIEF) ? readFileSync(BRIEF, 'utf8').slice(0, 12000)
  : role === 'reviewer' ? await reviewBrief(reason, gh) : '';   // #9739: the reviewer gets its inputs in the prompt (it ran out of turns fetching them)
if (role === 'worker' && !/^## YOUR ISSUE/m.test(brief) && !dry) { console.log('SKIP worker: no brief (brain.yml runs go.mjs start first)'); process.exit(0); }
const issueNo = Number((brief.match(/^## YOUR ISSUE\s+#(\d+)/m) || [])[1] || 0);
const branch = (brief.match(/^branch (work\/\S+)/m) || [])[1] || '';
const ESC = role === 'worker' ? escalationFor(history().burns, issueNo) : null;   // #2861: the 3rd attempt, after 2 empty Sonnet runs, is Opus at medium - once
if (ESC) { MODEL = ESC.model; console.log(`ESCALATE #${issueNo}: 2 empty Sonnet runs -> ${ESC.model} at ${ESC.effort}, once`); }
const help = spawnSync('claude', ['--help'], { encoding: 'utf8' }).stdout || '';
const args = ['-p', promptFor(CFG, role, reason, (forced === 'phase' && role === 'worker' ? ((CFG.fill.phaseLane || {}).prompt || '') + '\n\n' : '') + brief), '--model', MODEL, '--max-turns', String(R.maxTurns),
  '--output-format', 'json', '--permission-mode', 'bypassPermissions'];
const issTitle = (brief.match(/^## YOUR ISSUE\s+#\d+\s+(.*?)\s*(?:\[[^\]]*\])?\s*$/m) || [])[1] || '';
// 21 Oct: `low` effort is right for a RED check rerun (5 turns, $0.05) and wrong for a port or a lockstep scene; roles.json effortFeature is used for every worker issue that is not a RED one
const EFFORT = ESC ? ESC.effort : role === 'worker' && R.effortFeature && issueNo && !/^RED /.test(issTitle) ? R.effortFeature : R.effort;
if (/--effort\b/.test(help) && EFFORT) args.push('--effort', EFFORT);   // only where this Claude Code has it
const TRIM = trimLaunch(R); args.push(...TRIM.args);                       // #4992: tools / slash commands / MCP / ponytail off for worker + tester
// 30 Sept: 39 of 162 worker runs had commands DENIED. A build or suite outlived the Bash tool's 2-min default, Claude
// Code moved it to the background, and the retry was refused - the worker handed off unverified ("that command was
// denied to me, so I stopped there"). Foreground commands may now run 10 min (our checks run with timeout 590).
const env = { ...process.env, CLAUDE_CODE_OAUTH_TOKEN: secret('tokens', `${account}.txt`), MCLITE_BRAIN: '1',
  BASH_DEFAULT_TIMEOUT_MS: '600000', BASH_MAX_TIMEOUT_MS: '900000' };
Object.assign(env, TRIM.env);                                           // #4992: auto memory off
env.PONYTAIL_DEFAULT_MODE = ponytailMode(CFG);                          // #1852: the ponytail plugin's intensity (roles.json plugins.ponytail.mode)
if (forced === 'phase') env.MCLITE_LANE = 'phase';                    // #3948: the phase lane worker (go.mjs queue() reads it)
const slice = (String(reason || '').match(/slice\s+(\d+)\s+of\s+\d+/i) || [])[1];            // #7772: one address per enlarger instance
if (R.who) env.MCLITE_WHO = slice && role === 'enlarger' ? `${R.who}-${slice}` : R.who;                                      // identity set, never guessed (#4 of the hand-off)
const gt = secret('github-token'); if (gt) env.GH_TOKEN = gt;           // the PAT: its writes trigger the lander
// #7585 (Dan, 15 Oct: 'switch on for all pilots'; proof run matched local hashes): lockstep pilots run as hosted jobs on the public test mirror when the VM holds its credentials; pilot.mjs falls back to running here if the mirror is unreachable. MCLITE_PILOT_REMOTE=local opts out.
const mrepo = secret('mirror-repo'), mtok = secret('mirror-token'); if (mrepo && mtok) { env.MIRROR_REPO = mrepo; env.MIRROR_TOKEN = mtok; env.MCLITE_PILOT_REMOTE = process.env.MCLITE_PILOT_REMOTE || 'mirror'; }
if (dry) { console.log(JSON.stringify({ role, account, model: MODEL, cwd: ROOT, args: args.slice(2) })); process.exit(0); }

// #4175: tag the worker's issue with this run's id so the phone's live runs view can say which issue a run holds. An issue comment (never the bus: it wakes nothing); best effort.
if (role === 'worker' && issueNo && process.env.GITHUB_RUN_ID) {
  const ttl = (brief.match(/^## YOUR ISSUE\s+#\d+\s+(.*?)\s*(?:\[[^\]]*\])?\s*$/m) || [])[1] || '';
  await gh('POST', `/repos/{repo}/issues/${issueNo}/comments`, { body: `<!-- brain-run ${process.env.GITHUB_RUN_ID} worker #${issueNo} model=${MODEL} -->\n${ttl.replace(/\s+/g, ' ').trim()}` }).catch(() => {});
}
// Dan, 10 Oct: testers, fixers, commanders and chores carry the marker too (model + what they were started for), on a housekeeping issue (never the bus)
else if (role !== 'worker' && CFG.markerIssue && process.env.GITHUB_RUN_ID) {
  await gh('POST', `/repos/{repo}/issues/${CFG.markerIssue}/comments`, { body: `<!-- brain-run ${process.env.GITHUB_RUN_ID} ${role} model=${MODEL} -->\n${(reason || role).replace(/\s+/g, ' ').trim().slice(0, 100)}` }).catch(() => {});
}
const mob = role === 'tester' ? (/\bmob (\w+)/.exec(reason) || [])[1] : null, mobH = mob && mobHash(mob);   // #4588: the hash the audit STARTS from
h.starts.push({ role, at: now, account, ...(mob ? { mob } : {}) }); saveHistory(h);
setPendingMail(role, null);                            // #3947: this run answers any parked mail
mkdirSync(P('logs'), { recursive: true });
const log = P('logs', `${new Date(now).toISOString().replace(/[:.]/g, '-')}-${role}.json`);
console.log(`START ${role} on ${account} (${MODEL}) -> ${log}`);
{ const did = TRIM.plugins.length ? [] : ensurePlugins(); if (did.length) console.log(`installed plugin(s): ${did.join(', ')}`); }   // #1852: best-effort, never fails the launch
const plugs = readPluginState(env.PONYTAIL_DEFAULT_MODE);                    // #1930: what this run really had, for its bus line
// #5052: trust this runner workspace BEFORE claude starts, or its permissions.allow list is ignored and the run is denied commands (atomic write: other runners and claude itself use the same file)
try { const f = join(homedir(), '.claude.json'), out = trustPatch(existsSync(f) ? readFileSync(f, 'utf8') : '', ROOT); if (out) { writeFileSync(f + '.tmp' + process.pid, out); renameSync(f + '.tmp' + process.pid, f); console.log(`trusted workspace ${ROOT} in ${f} (#5052)`); } } catch {}
const child = spawn('claude', args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
let out = '', err = '';
child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { err += d; });
const LIMIT = 100 * 60e3;                                               // a runaway session is killed, not waited on
const kill = setTimeout(() => { err += '\n[brain] killed at the 100-minute limit'; child.kill('SIGTERM'); }, LIMIT);
let code = await new Promise((r) => child.on('close', r)); clearTimeout(kill);
writeFileSync(log, out || JSON.stringify({ stderr: err }));
let res = {}; try { res = JSON.parse(out); } catch {}
let resumeTag = '';
// 21 Oct SHORTFALL RESUME (shortfall.mjs): a worker that ends early with no PR, no code and the issue still open is resumed ONCE in the same session
if (wantsResume({ role, issueNo, limit: parseLimit(`${res.result || ''}\n${err}`, Date.now()), cut: cutOff(res, err), code, res, resumed: false }) && !(await ranProduced({ gh, branch, issueNo, since: now, dependsOn }))) {
  const used = Number(res.num_turns) || 0;
  const rc = spawn('claude', resumeArgs(args, res.session_id, resumeMessage({ turns: used, max: R.maxTurns, issueNo }), used, R.maxTurns), { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out2 = '', err2 = ''; rc.stdout.on('data', (d) => { out2 += d; }); rc.stderr.on('data', (d) => { err2 += d; });
  const kill2 = setTimeout(() => { err2 += '\n[brain] killed at the 100-minute limit'; rc.kill('SIGTERM'); }, LIMIT);
  const code2 = await new Promise((r) => rc.on('close', r)); clearTimeout(kill2);
  writeFileSync(log, (out || '') + '\n=== RESUMED after a ' + used + '-turn shortfall ===\n' + (out2 || JSON.stringify({ stderr: err2 })));
  let res2 = {}; try { res2 = JSON.parse(out2); } catch {}
  if (Object.keys(res2).length) { res = mergeRun(res, res2); code = code2; err += err2; resumeTag = ` RESUMED once after a ${used}-turn shortfall (no PR, no code, issue open).`; }
}
// #1937: a run that ended on an ACCOUNT LIMIT never worked - it is not a burned run (3 Oct 03:14Z: 9 limit deaths paused the
// fill as 'boondoggling' and put a burn on 9 innocent issues). Record the account as out until its stated reset instead.
const limit = parseLimit(`${res.result || ''}\n${err}\n${res.result ? '' : out}`, Date.now());
if (limit) { const h = history(); h.limits = { ...(h.limits || {}), [account]: Math.max(limit.until, (h.limits || {})[account] || 0) }; saveHistory(h); }
// #10723: "subscription access disabled" is an ACCOUNT fault: park the account's fill (FILL_WORKERS_<ACCT>=0), one bus line, release the claim, no burn;
// the next successful run on that account restores the switch.
const AF = accountFault({ text: `${res.result || ''}\n${err}\n${res.result ? '' : out}`, ok: code === 0 && !res.is_error, turns: res.num_turns, account }, h.parked || {});
const acctHeld = !!(AF && (AF.park || AF.hold));
if (!dry && AF && (AF.park || AF.unpark)) {
  const VN = `FILL_WORKERS_${account.toUpperCase()}`, P2 = `/repos/{repo}/actions/variables/${VN}`;
  const setVar = async (v) => { const b = { name: VN, value: String(v) }; if ((await gh('PATCH', P2, b, { ok404: true })) === null) await gh('POST', '/repos/{repo}/actions/variables', b); };
  try {
    const hp = history(); hp.parked = hp.parked || {};
    if (AF.park) {
      const cur = (await gh('GET', P2, null, { ok404: true }))?.value;
      hp.parked[account] = cur == null ? '' : String(cur); saveHistory(hp);
      await setVar(0);
      await post('commander', `brain: ${account} PARKED (${VN}=0, was ${cur ?? 'unset'}): its subscription access is disabled (ended plan). Not re-enabled by hand; Dan runs \`go.mjs loop ${account} ${cur || 10}\` if it returns. A successful run on ${account} unparks it.`);
    } else {
      const prev = AF.restore; delete hp.parked[account]; saveHistory(hp);
      if (prev === '') await gh('DELETE', P2, null, { ok404: true }).catch(() => {}); else await setVar(prev);
      await post('log', `brain: ${account} UNPARKED (${VN} back to ${prev || 'unset'}): a run on it succeeded`);
    }
  } catch (e) { console.log(`account park: ${e.message}`); }
}
if ((acctHeld || claimIsVoid({ turns: res.num_turns, code })) && branch && !dry) { try { await releaseOrphan({ gh, branch }); } catch {} }
// #5052 (Dan, 11 Oct): a run cut off by its turn cap (or the 100-minute kill) keeps its work - its tree goes to wip/<branch> and the
// claim is released (salvage.mjs), and a commander/fixer/chore task is re-parked ONCE as a CONTINUE mail instead of being lost.
const cut = cutOff(res, err) && !limit;
let sv = null;
if (cut) { try { sv = await salvage({ root: ROOT, gh, env: { GH_TOKEN: gt || '' }, turns: res.num_turns, last: res.result || err }); } catch (e) { sv = { changed: false, why: e.message }; } }
const cont = cut ? continuation(role, reason, R.maxTurns) : null;
if (cont) setPendingMail(role, { reason: cont, at: Date.now() });
// 21 Oct ENV GAP (envgap.mjs; Dan: "there should never be an infrastructure/environment gap again"): a run that says its WORKSPACE lacks something
// (no real-server harness, audio objects absent, a cited decision note missing, work that never landed) opens ONE top-priority provisioning issue,
// holds this issue (env-gap + blocked) until it closes, and tells the commander once - so no fresh worker is handed it to rediscover the same gap.
if (role === 'worker' && issueNo && !limit) {
  try {
    const c = classifyBlocker(res.result || '');
    const is = c ? await gh('GET', `/repos/{repo}/issues/${issueNo}`) : null;
    if (c && is && is.state === 'open' && !(is.labels || []).some((l) => l.name === 'env-gap')) {
      const open = ((await gh('GET', '/repos/{repo}/issues?state=open&labels=env-gap&per_page=100')) || []).map((i) => ({ number: i.number, title: i.title, state: i.state }));
      const plan = planGap({ kind: c.kind, issue: issueNo, issues: open }); let gapNo = plan.number;
      if (plan.op === 'create') gapNo = (await gh('POST', '/repos/{repo}/issues', { title: plan.title, body: gapBody({ kind: c.kind, issue: issueNo, what: c.what, handoffRun: process.env.GITHUB_RUN_ID }), labels: ['infra', 'severe', 'env-gap'] })).number;
      await gh('POST', `/repos/{repo}/issues/${issueNo}/labels`, { labels: ['env-gap', 'blocked', c.label] });
      await gh('POST', `/repos/{repo}/issues/${issueNo}/comments`, { body: `**Held by the brain (environment gap, #${gapNo})**: this worker's workspace lacks something (${c.kind}): ${c.what}\n\nNo worker is handed #${issueNo} until #${gapNo} provisions it.` });
      if (plan.op === 'create') await post('commander', `env gap (${c.kind}) filed as #${gapNo} for #${issueNo}: ${c.what}`);
      resumeTag += ` ENV GAP ${c.kind} -> #${gapNo}.`;
    }
  } catch (e) { console.log(`env gap: ${e.message}`); }
}
// #125: no PR and no new code (30 Sept: a bare hand-off no longer counts) = a burned run; two in a row on one issue -> `blocked` (queue() skips it), no third burn
if (issueNo && !limit && !acctHeld && !claimIsVoid({ turns: res.num_turns, code })) {
  let produced = false;
  try {
    const owner = (await gh('GET', '/repos/{repo}')).owner.login;
    const prs = await gh('GET', `/repos/{repo}/pulls?state=open&head=${owner}:${encodeURIComponent(branch)}`);
    // 30 Sept: a hand-off with NO new code counted as progress, so stuck issues churned forever - #512 was started 6
    // times in 5 min, each run reading the brief and handing off again. Progress = a PR, or real commits on the branch
    // this run (not the hand-off/takeover/merge commits the tools make).
    const cm = await gh('GET', `/repos/{repo}/commits?sha=${encodeURIComponent(branch)}&since=${new Date(now).toISOString()}&per_page=50`);
    const real = (cm || []).filter((c) => !/^(handoff: released|takeover:|Merge )/.test(c.commit.message) && (c.parents || []).length < 2);
    produced = (prs || []).length > 0 || real.length > 0;
    // 3 Oct: `done --already-fixed` closes a stale issue - useful work, no PR; 4 of those in an hour paused the fill
    if (!produced) {
      const is = await gh('GET', `/repos/{repo}/issues/${issueNo}`);
      produced = is.state === 'closed';
      // #5039 (11 Oct): a worker that finds the issue needs another one first records `Depends on: #M` and stops - a CORRECT outcome, not a burn.
      // 3 of those in 4 minutes paused the whole fill for 30 min. M must still be open, or the line is stale and the run really burned.
      if (!produced) for (const m of dependsOn(is.body)) { const d = await gh('GET', `/repos/{repo}/issues/${m}`).catch(() => null); if (d && d.state === 'open') { produced = true; break; } }
    }
  } catch { produced = true; }                                            // can't tell: never block on a guess
  if (sv && sv.changed && sv.pushed) produced = true;                     // #5052: salvaged work is progress, not a burn
  if (!produced && branch) { try { await releaseOrphan({ gh, branch }); } catch {} }   // #8977: no PR and no new code = free the claim now, not after STALE_H (3 h)
  const h2 = history(); h2.burns = h2.burns || {};
  if (!produced) h2.burnTimes = [...(h2.burnTimes || []).filter((t) => Date.now() - t < 3600e3), Date.now()];   // #1503: feeds burnPaused
  const v = burnVerdict(h2.burns, issueNo, produced); h2.burns[issueNo] = v.n; saveHistory(h2);
  if (!produced) {   // #2071: a RED check issue this GPU-less worker could not verify goes to the PC, not to the next worker
    const il = ((await gh('GET', `/repos/{repo}/issues/${issueNo}`).catch(() => null))?.labels || []).map((l) => l.name);
    if (needsPc(il)) {
      await gh('POST', `/repos/{repo}/issues/${issueNo}/labels`, { labels: ['pc-gpu'] }).catch(() => {});
      await gh('POST', `/repos/{repo}/issues/${issueNo}/comments`, { body: `**Parked by the brain** (#2071): a worker ran on this red check with no PR and no new code (brain workers have no GPU, so a browser check often cannot be verified there). Labelled \`pc-gpu\` so no other brain worker takes it; a session on Dan's PC, or Dan, removes the label. Last run said: ${String(res.result || err || '').replace(/\s+/g, ' ').slice(0, 400)}` }).catch(() => {});
    }
  }
  if (v.block) {
    const why = String(res.result || err || '').replace(/\s+/g, ' ').slice(0, 600);
    await gh('POST', `/repos/{repo}/issues/${issueNo}/labels`, { labels: ['blocked', 'burn-blocked'] }).catch(() => {});   // #9889: burn-blocked tells it from autorebase's block
    await gh('POST', `/repos/{repo}/issues/${issueNo}/comments`, { body: `**Blocked by the brain** (#125): ${v.n} worker runs in a row ended with no PR and no new code on the branch. Last run said: ${why}\n\nThe commander (or Dan) removes the \`blocked\` label once the cause is fixed.` }).catch(() => {});
    await post('commander', `brain: #${issueNo} blocked - ${v.n} runs in a row ended empty (2 Sonnet, then Opus medium once). Last run said: ${why.slice(0, 200)}`).catch(() => {});   // #2861
  }
}
// Dan 1 Oct (Pro usage looked fishy): every run's log line says what it actually cost - the models really used, their tokens
// (in / out / cache write / cache read), USD and wall minutes - so the bus shows where a window went, run by run.
// #1503 (Dan, 2 Oct: "test how much usage the test sessions used each with accurate /usage"): this account's 5-hour window and
// week BEFORE the run (U, read at its start) and AFTER it (re-read now) go on the run's own bus line. usaged refreshes the
// reading every 5 min (its age is printed) and runs overlap, so one run is approximate - the pairs add up over many runs.
let upts = '';
try {
  const U2 = JSON.parse((await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }))?.value || 'null');
  const a0 = U && U.accounts && U.accounts[account], a1 = U2 && U2.accounts && U2.accounts[account];
  if (a0 && a1 && a0.window && a1.window) upts = `; ${account} 5h ${a0.window.pct}->${a1.window.pct}%, week ${a0.week?.pct}->${a1.week?.pct}% (reading ${Math.max(0, Math.round((Date.now() - Date.parse(a1.readAt || U2.at)) / 60e3))} min old)`;
  else upts = `; ${account} usage UNKNOWN (${String(a1 && a1.why || 'no reading').slice(0, 120)})`;   // #2246: say so, never print a frozen number as fresh
} catch {}
const limTag = limit ? ` LIMIT: ${account} ${limit.kind} limit until ${new Date(limit.until).toISOString()} - not counted as a burn, the fill waits for the reset.` : '';
const cutTag = cut ? ` CUT OFF at ${res.num_turns ?? '?'} turns: ${sv && sv.changed && sv.pushed ? `salvaged to wip/${sv.ref}${sv.released ? ', claim released' : ''}` : `nothing salvaged (${sv ? sv.why : 'no work branch'})`}${cont ? '; task re-parked as CONTINUE' : ''}.` : '';
const mu = res.modelUsage ? Object.entries(res.modelUsage).map(([m, v]) => `${m} in ${v.inputTokens} out ${v.outputTokens} cw ${v.cacheCreationInputTokens} cr ${v.cacheReadInputTokens} $${(v.costUSD ?? 0).toFixed(2)}`).join('; ') : 'no modelUsage';
const spent = `[usage ${mu}; total $${(res.total_cost_usd ?? 0).toFixed(2)}; ${Math.round((res.duration_ms ?? 0) / 60e3)} min${upts}; ${R.trim ? `; trim tools=${R.trim.tools || 'all'}` : ''}; plugins ${plugs}]`;
const line = `brain: ${role} run ended (${code === 0 ? 'ok' : `exit ${code}`}, ${res.num_turns ?? '?'} turns, ${account}) ${spent} -${resumeTag}${cutTag}${limTag}${String(res.result || err || '').replace(/\s+/g, ' ').slice(0, 300)}${issueNo ? ` [#${issueNo}]` : ''}`;
console.log(line);
await post('log', line).catch((e) => console.log(`bus post failed: ${e.message}`));
if (role === 'tester' && !limit) {   // #4298: the fill shape's "testing is done" = the last doneRuns tester runs filed no bug; an unreadable report counts as a find
  const m = /(\d+) bugs? filed/.exec(String(res.result || '')), h3 = history();
  h3.testerRuns = [...(h3.testerRuns || []), { at: Date.now(), bugs: m ? Number(m[1]) : 1 }].slice(-20); saveHistory(h3);
  if (mob) try { writeLedger(record(readLedger(), mob, mobH, !!m && Number(m[1]) === 0, Date.now())); } catch (e) { console.log('audit ledger not updated: ' + e.message); }   // #4588
}
if (code !== 0 && authFailed(err, res, limit)) await notify(`The brain's ${account} login failed - double-click MAKE-BRAIN-TOKEN.cmd again for "${account}".`);
process.exit(code === 0 ? 0 : 1);
