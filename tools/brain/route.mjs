// route.mjs - the brain's decisions, as pure functions (#86). No network, no disk: launch.mjs, health.mjs and
// brain.yml feed them facts; braincheck.mjs proves each decision can fail. Keep ALL policy here so it is testable.

export const field = (body, k) => ((String(body).match(new RegExp(`^${k}:\\s*(.+)$`, 'm')) || [])[1] || '').trim();

/** A bus comment -> what the brain does. {do:'start', role, reason} | {do:'notify', text} | {do:'none', why}. */
export function routeComment(body, cfg) {
  const to = field(body, 'to').toLowerCase(), from = field(body, 'from').toLowerCase(), re = field(body, 're');
  const text = String(body).replace(/^(to|from|re|reply):.*\n?/gm, '').trim();
  if (!to) return { do: 'none', why: 'not a bus message (no to:)' };
  if (to === 'dan') return { do: 'notify', text: `${from || '?'}: ${text}`.slice(0, 1000) };
  if (re) return { do: 'none', why: 'a reply needs no answer' };
  if (from === to) return { do: 'none', why: 'mail to itself' };
  const role = cfg.wake && cfg.wake[to];
  if (!role || !cfg.roles[role]) return { do: 'none', why: `nobody is woken for "${to}"` };
  return { do: 'start', role, reason: `mail from ${from || '?'}: ${text.slice(0, 600)}` };
}

/** The weekly cap for one account: its own `maxWeekPct` in roles.json accounts (Max 96, Dan 1 Oct), else fill.maxWeekPct. */
export const accountWeekCap = (cfg, name) => ((cfg.accounts || []).find((a) => a.name === name) || {}).maxWeekPct ?? (cfg.fill || {}).maxWeekPct ?? null;

/** Which account's token to use: the first whose `until` is still ahead and whose token file exists and, when fresh
 *  usage `u` ({at, accounts: {name: {window, week}}}) is known, that is under its caps (Dan, 1 Oct: run on Max until its
 *  week reaches 96, then Pro). Usage unknown or every account capped = the first valid account (launch.mjs then SKIPs). */
/** #4938 (10 Oct): an account reading the service itself marked `stale` is only usable while its OWN readAt is under 30 min old. The
 *  pre-#2246 usaged published a failed read as {ok:true, stale:true} with no readAt for ~8 h (Max 88% / Pro 90% while live was 100% / 1%),
 *  so a stale reading with no readAt, or an old one, is UNKNOWN here too, whatever process wrote it. */
export const acctFresh = (x, now) => !!x && !(x.stale && !(x.readAt && now - Date.parse(x.readAt) <= 30 * 60e3));
export function pickAccount(cfg, now, haveToken, u) {
  const ok = cfg.accounts.filter((a) => (!a.until || Date.parse(a.until) > now) && haveToken(a.name));
  const fresh = u && u.accounts && !(u.at && now - Date.parse(u.at) > 30 * 60e3);
  const free = fresh ? ok.find((a) => {
    const x = u.accounts[a.name], cap = accountWeekCap(cfg, a.name), wc = (cfg.fill || {}).maxWindowPct;
    if (!x || !x.week || !acctFresh(x, now)) return false;
    const win = x.window && !(x.window.resets_at && Date.parse(x.window.resets_at) <= now) ? (x.window.pct || 0) : 0;
    return !(cap != null && x.week.pct >= cap) && !(wc != null && win >= wc);
  }) : null;
  return (free || ok[0] || {}).name ?? null;
}

/** May this role start now? history = [{role, at}] of past starts. */
export function rateOk(history, role, now, maxPerHour) {
  return history.filter((h) => h.role === role && now - h.at < 3600e3).length < maxPerHour;
}

/** #3947: parked mail ({role: {reason, sent?}}) whose role is under its cap again and not just re-dispatched (5 min) -> [{role, reason}]. */
export function pendingMailDue(pending, starts, cfg, now) {
  return Object.entries(pending || {}).filter(([r, p]) => cfg.roles[r] && rateOk(starts, r, now, cfg.roles[r].maxPerHour) && now - (p.sent || 0) > 5 * 60e3)
    .map(([role, p]) => ({ role, reason: p.reason }));
}

/** Fill a role's prompt. */
export const promptFor = (cfg, role, reason, brief = '') => cfg.roles[role].prompt.replace('{reason}', reason || 'none given').replace('{brief}', brief);
/** #4991 (Dan, 10 Oct: "split fill workers into fill workers and fill testers"): the repo variable FILL_TESTERS. A number 0-10 = exactly that many
 *  tester sessions, set on its own (FILL_WORKERS then counts workers only); unset, empty or "auto" = null = the brain's automatic split of FILL_WORKERS. Pure. */
export const testerSwitch = (v) => (/^\d+$/.test(String(v ?? '').trim()) ? Math.min(10, Number(String(v).trim())) : null);
/** #4992 (Dan, 10 Oct usage research): the per-role launch trim, roles.json roles.<r>.trim -> extra `claude` args and env. Absent or false = none.
 *  Measured on the brain VM: 19.8k tokens per call before, 7.2k with tools "Bash,Read,Edit,Write", slash commands, auto memory, MCP and ponytail off. Pure. */
export function trimLaunch(R) {
  const T = R && R.trim; if (!T) return { args: [], env: {}, plugins: [] };
  const args = [], off = Array.isArray(T.disablePlugins) ? T.disablePlugins : [];
  if (T.tools) args.push('--tools', T.tools);
  if (T.disableSlashCommands) args.push('--disable-slash-commands');
  if (T.strictMcp) args.push('--strict-mcp-config');
  if (off.length) args.push('--settings', JSON.stringify({ enabledPlugins: Object.fromEntries(off.map((id) => [id, false])) }));
  return { args, env: T.disableAutoMemory ? { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' } : {}, plugins: off };
}


/** Health snapshot -> findings [{key, text}]. snap = {now, masterRed: bool, redSince, runners:[{name,status}],
 *  mail:[{id, to, from, re, created_at, answered}], loopEnabled, lastLoopAt}. */
export function findings(snap, cfg) {
  const out = [], now = snap.now, H = cfg.health || {};
  if (snap.masterRed) out.push({ key: 'master-red', text: `master is red (full suite) since ${snap.redSince || '?'} - see the "master is red" issue` });
  for (const r of snap.runners || []) if (r.status !== 'online') out.push({ key: `runner-offline:${r.name}`, text: `GitHub runner ${r.name} is ${r.status}` });
  const stale = (snap.mail || []).filter((m) => m.to === 'commander' && m.from !== m.to && !m.re && !m.answered && now - Date.parse(m.created_at) > (H.mailStaleMinutes || 20) * 60e3);
  if (stale.length) out.push({ key: 'mail-unanswered', text: `${stale.length} message(s) to commander unanswered for over ${H.mailStaleMinutes || 20} min (oldest ${stale[0].id}) - the wake did not work` });
  if (snap.landWaiting >= (H.landBacklogHigh || 30)) out.push({ key: 'land-backlog', text: `${snap.landWaiting} PR(s) labelled land are waiting (alert at ${H.landBacklogHigh || 30}). Look at the lander first (_status/runner-land.log: a hung stage, a vacuous-check bounce loop), fix its cause, and if workers keep adding PRs faster than it lands them, pause the fill with \`go.mjs loop off --resume-when-landed\` - the brain restores the workers by itself when the queue is empty (#6522).` });
  if (snap.fillIdleMin >= (H.fillIdleMinutes || 45) && !snap.usageExplained) out.push({ key: 'fill-idle', text: `the fill wants workers but nothing has run or been queued for ${snap.fillIdleMin} min (no worker, tester or waker) - a hold or pause did not wake itself (#1575). Restart: node tools/go.mjs say --to log "restarting the fill", then find which hold/cap left no waker and fix that` });
  if (snap.landAction === 'alert') out.push({ key: 'lander-idle', text: `${snap.landWaiting} PR(s) labelled land wait and the lander was dispatched less than 40 min ago but still no land.yml run is queued or running (#2700) - check the express runners (PC-land, -land2) and runner-land.log` });
  if (snap.diskFreeGB < (H.diskMinGB || 5)) out.push({ key: 'disk-low', text: `the guest root disk has ${snap.diskFreeGB.toFixed(1)} GB free (gate ${H.diskMinGB || 5}) - at 0 every run fails at 'Set up job' (#4965). Auto-clean already ran; find what else grows (du -xh / --max-depth=3)` });
  for (const x of snap.blockedHolds || []) out.push({ key: `blocked-holds:${x.n}`, text: `#${x.n} is labelled blocked and ${x.holds} open issue(s) wait on it through Depends-on chains (#6663: the brain unblocks one holding 20+ at most every 6 h) - find why its runs end empty and fix that` });
  out.push(...dormancy(snap, cfg));
  if (snap.loopEnabled && snap.lastLoopAt && now - Date.parse(snap.lastLoopAt) > 3 * 3600e3) out.push({ key: 'loop-quiet', text: `the loop has not posted on the bus since ${snap.lastLoopAt}` });
  return out;
}

/** #2050: usage explains a quiet fill when EVERY account that has a reading is capped. 3 Oct: usage.json always carries a
 *  login-less `default` ({ok:false}, no window); usageCap() of no window is 1 (blind), so `every` over all keys was never true
 *  and `dormant` blamed a fill that was just waiting on Max's week and Pro's limit. Accounts without a window are ignored. */
export function capsExplain(cfg, u, now) {
  const names = Object.keys((u && u.accounts) || {}).filter((n) => u.accounts[n] && u.accounts[n].window);
  return names.length > 0 && names.every((n) => { const a = u.accounts[n];
    return usageCap(cfg, { window: a.window, week: a.week, at: u.at, weekCap: accountWeekCap(cfg, n) }, now) === 0; });
}

/** #1966 (Dan, 3 Oct: wake commander/fixer on dormancy not caused by usage). snap = {now, fillWant, lastMasterAt (ms),
 *  running: [run titles in progress now], usageExplained}. A waker is not progress; real progress = a master commit within
 *  health.dormantMinutes or a worker/tester/commander/fixer run in progress. Capped/out accounts explain it (#1575 wakers). */
export function dormancy(snap, cfg) {
  const min = ((cfg.health || {}).dormantMinutes) || 60;
  if (!(snap.fillWant > 0) || snap.usageExplained) return [];
  if ((snap.running || []).some((t) => /^brain (worker|tester|commander|fixer)/.test(t))) return [];
  const idle = Math.floor((snap.now - (snap.lastMasterAt || 0)) / 60e3);
  if (idle < min) return [];
  return [{ key: 'dormant', text: `the fill wants ${snap.fillWant} worker(s) but there has been no progress for ${idle} min (last master commit ${snap.lastMasterAt ? new Date(snap.lastMasterAt).toISOString() : 'unknown'}; running: ${(snap.running || []).join(', ') || 'nothing'}; usage: not capping). Not usage - find why: a hung waker, workers that produce nothing, a stuck lander. Log it: node tools/go.mjs say --to log "dormancy: <cause>" and fix the cause through the normal path` }];
}

/** Which findings to act on now. past = [{key, at}] health alerts already posted. Returns {mail:[f], dan:[f]}:
 *  mail the commander when a key was not alerted within realertHours; tell Dan when it has been firing longer than
 *  notifyDanAfterHours and he was not told within realertHours. */
export function dueAlerts(found, past, told, cfg, now) {
  const H = cfg.health || {}, danAfter = (H.notifyDanAfterHours || 1) * 3600e3;
  const mail = [], dan = [];
  for (const f of found) {
    const re = ((H.realertHoursFor || {})[f.key.split(':')[0]] ?? H.realertHours ?? 2) * 3600e3;
    const mine = past.filter((p) => p.key === f.key && now - p.at < 24 * 3600e3), last = Math.max(0, ...mine.map((p) => p.at)), first = Math.min(now, ...mine.map((p) => p.at));
    if (now - last >= re) mail.push(f);
    const lastTold = Math.max(0, ...told.filter((p) => p.key === f.key).map((p) => p.at));
    if (mine.length && now - first >= danAfter && now - lastTold >= re) dan.push(f);
  }
  return { mail, dan };
}

/** #3569 (Dan, 6 Oct: "from 8 am to 2 pm the overall count of max workers and testers is halved"). fill.quiet = {tz, from, to, factor}:
 *  inside [from, to) on the tz's wall clock (Intl, so DST follows) the fill total, maxTotal and default testers are scaled by factor.
 *  Returns {active, factor, next (ms of the next flip, null without a window)}. Pure. */
export function quietState(cfg, now) {
  const q = (cfg.fill || {}).quiet;
  if (!q) return { active: false, factor: 1, next: null };
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: q.tz, hour12: false, hour: '2-digit', minute: '2-digit' });
  const at = (t) => { const m = /(\d+):(\d+)/.exec(f.format(t)); return (Number(m[1]) % 24) * 60 + Number(m[2]); };
  const mins = (h) => { const [a, b] = h.split(':'); return Number(a) * 60 + Number(b); };
  const inside = (t) => { const m = at(t); return m >= mins(q.from) && m < mins(q.to); };
  const active = inside(now);
  let next = null;
  for (let t = Math.floor(now / 60e3) * 60e3 + 60e3; t < now + 25 * 3600e3; t += 60e3) if (inside(t) !== active) { next = t; break; }
  return { active, factor: active ? q.factor : 1, next };
}
/** How many workers to dispatch now: fill.workers minus those already queued/running, 0 after fill.until. */
export function fillWant(cfg, now, override, usage) {
  const F = cfg.fill || {};
  // the phone app's worker switch (#90): repo variable FILL_WORKERS, a number 0-6, wins over roles.json AND its
  // end date (Dan chose it by hand); empty/unset/garbage = roles.json decides
  // "N@<ISO time>" expires: past it, roles.json decides again (a commander's temporary boost can't outlive the Max
  // plan and burn Pro - 28 Sept)
  const [o, exp] = String(override ?? '').trim().split('@');
  const want = (/^\d+$/.test(o) && !(exp && Date.parse(exp) <= now)) ? Math.min(10, Number(o))   // 29 Sept: 10 brain runners (was capped at 6, so FILL 10 ran 6)
    : (!F.workers || (F.until && Date.parse(F.until) <= now)) ? 0 : F.workers;
  const base = Math.ceil(want * quietState(cfg, now).factor);
  return base + paceExtra(cfg, now, base, usage);
}
/** #4954 (Dan, 10 Oct: "1 worker, and if the 5-hour window would likely not overflow with another, have the fill add it, otherwise keep it at 1").
 *  FILL_WORKERS / fill.workers is the BASE. fill.paceExtra (sessions) is added on top only while usageCap's pacing (the same rule that spreads
 *  the rest of the window evenly up to maxWindowPct) says base + paceExtra sessions fit. Off (0) when the base is 0, usage is unknown/stale
 *  (usageCap 1), the window or week is spent (0), or pacing is not configured (Infinity is no evidence of room). Pure. */
export function paceExtra(cfg, now, base, usage) {
  const x = (cfg.fill || {}).paceExtra || 0;
  if (!(x > 0) || !(base > 0) || !usage) return 0;
  const only = (cfg.fill || {}).paceExtraAccounts;   // Dan, 10 Oct 02:38 ET: "keep it on 1 only for pro" = Pro never gets the extra
  if (only && !only.includes(usage.acct)) return 0;
  const cap = usageCap(cfg, usage, now);
  return Number.isFinite(cap) && cap >= base + x ? x : 0;
}
export function fillCount(cfg, now, running, override, usage, api) {
  return Math.max(0, Math.min(fillWant(cfg, now, override, usage), usageCap(cfg, usage, now), apiCap(cfg, api)) - running);
}
/** #4549 AUTO SHAPE (Dan, 8 Oct: "I shouldn't have to make this ratio decision anymore"; extends #4298). The brain picks the worker/tester
 *  split every fill pass from measured inputs; roles.json holds only Dan's bounds (fill.workers/maxTotal, fill.maxWorkers, caps, quiet).
 *  ctx = {claimable (REAL claimable depth), drain (issues finished per hour, last 3 h), testerBugs (bugs per tester run, oldest first),
 *  landBacklog (PRs labelled land), masterRed, budgetSlots (slots usage + API caps allow now), prev {workers, at} (the last shape),
 *  bad [names of inputs that could not be read]}. RULE: workers = clamp(ceil(queue / (drain * 0.5 h)), 1, maxWorkers); a red master or
 *  a lander backlog >= fill.landDeep halves them; testers = slots - workers. Hysteresis: the shape moves 1 slot at a time, at most once
 *  per 30 min (a shrinking budget clamps at once). An unreadable input keeps the previous shape. Gate M is never touched here. Pure. */
export function fillShape(cfg, now, override, ctx = {}) {
  const F = cfg.fill || {}, N = (F.adaptive || {}).doneRuns ?? 6, maxW = F.maxWorkers ?? 4, deep = F.landDeep ?? 6;
  const total = fillWant(cfg, now, override, ctx.usage), q = ctx.claimable || 0, drain = Math.max(ctx.drain || 0, 1), prev = ctx.prev;
  const slots = total > 0 ? Math.max(1, Math.min(total, ctx.budgetSlots ?? total)) : 0;   // a capped budget is the caps' job, not a shape change
  const last = (ctx.testerBugs || []).slice(-N), found = last.reduce((s, b) => s + b, 0), bad = ctx.bad || [];
  const lim = Math.min(maxW, slots), clamp = (w) => Math.max(Math.min(1, lim), Math.min(lim, w));
  const slow = ctx.masterRed || (ctx.landBacklog || 0) >= deep;
  let target = clamp(Math.ceil(q / (drain * 0.5)));
  if (slow) target = clamp(Math.ceil(target / 2));
  let workers = target, at = prev ? prev.at : now, why = '';
  if (bad.length && prev) { workers = clamp(prev.workers); why = `; KEPT, unreadable: ${bad.join(',')}`; }
  else if (prev && prev.workers != null) {
    const moved = prev.workers + Math.sign(target - prev.workers);
    workers = clamp(now - prev.at < 30 * 60e3 ? prev.workers : moved);
  }
  if (!prev || workers !== prev.workers) at = now;
  const line = `fill shape: ${workers}w+${slots - workers}t (queue ${q}, drain ${Math.round(drain * 10) / 10}/h, testers filed ${found} bug${found === 1 ? '' : 's'} in ${last.length} run${last.length === 1 ? '' : 's'}, lander ${ctx.landBacklog || 0}, master ${ctx.masterRed ? 'RED' : 'green'}, budget ${slots} slot${slots === 1 ? '' : 's'}${why})`;
  return { total, slots, workers, testers: slots - workers, at, changed: !prev || workers !== prev.workers || total !== prev.total, line };
}
/** RESERVED ACCOUNT POOLS (#1496; Dan, 1 Oct: "if the pro has reset give it 2 workers" - "Opus only for the pertinent issues").
 *  An account with `workers` in roles.json keeps that many workers of its own running IN ADDITION to the primary pool
 *  (the FILL_WORKERS count on pickAccount's account). Each is held by THAT account's own usage caps (a window whose reset
 *  has passed is 0%), the API quota, fill.maxTotal over every running worker, and the open issues of the account's `pool`
 *  label (nothing to claim = no session started). runningBy = {account: n} counts account-TAGGED runs only.
 *  Returns [{account, n}], n > 0. The caller must not call it while the worker switch is off (fillWant === 0). */
export function reservePlan(cfg, now, runningBy, totalRunning, u, api, poolOpen) {
  const out = [];
  let room = Math.max(0, Math.ceil(((cfg.fill || {}).maxTotal ?? Infinity) * quietState(cfg, now).factor) - totalRunning);
  for (const a of cfg.accounts || []) {
    if (!a.workers || (a.until && Date.parse(a.until) <= now)) continue;
    const x = u && u.accounts && u.accounts[a.name];
    const usage = x && x.window ? { window: x.window, week: x.week, at: u.at, weekCap: accountWeekCap(cfg, a.name) } : null;
    const mine = (runningBy && runningBy[a.name]) || 0;
    const open = a.pool ? ((poolOpen && poolOpen[a.pool]) || 0) - mine : Infinity;
    const want = Math.ceil(a.workers * quietState(cfg, now).factor);   // #5047 (Dan, 11 Oct: proportional 4+1 in the 08:00-14:00 window): each account scales by the quiet factor, not Max first-come
    const n = Math.max(0, Math.min(want - mine, usageCap(cfg, usage, now), apiCap(cfg, api), room, open));
    if (n > 0) { out.push({ account: a.name, n, ...(a.role ? { role: a.role } : {}) }); room -= n; }
  }
  return out;
}
/** #2335 (Dan, 4 Oct: "fix permanently that the brain only watches one account"): the earliest moment ANY account that could
 *  start work is under its caps again, so a waker fires for the FIRST of them, never only for the primary's. 4 Oct 04:34Z: Max's
 *  week was 100% (reset 11:00Z), fill armed ONE waker for Max's 5h reset (07:23Z) and Pro's own reset at 04:50Z woke nobody
 *  (Opus pool idle ~45 min). Per capped account: week-capped -> its week reset, window-capped -> its window reset, both ->
 *  the later. Accounts already under their caps (reservePlan starts them), expired ones, and ones with no window (the
 *  login-less `default`) are skipped. A cap with no reset time (pacing) = look again in 10 min. null = nothing known. */
export function capsLiftAt(cfg, u, now) {
  const F = cfg.fill || {};
  let best = null;
  for (const a of cfg.accounts || []) {
    if (a.until && Date.parse(a.until) <= now) continue;
    const x = u && u.accounts && u.accounts[a.name];
    if (!x || !x.window) continue;
    const wk = accountWeekCap(cfg, a.name);
    if (usageCap(cfg, { window: x.window, week: x.week, at: u.at, weekCap: wk }, now) > 0) continue;
    const winCapped = F.maxWindowPct != null && x.window.pct >= F.maxWindowPct && x.window.resets_at && Date.parse(x.window.resets_at) > now;
    const weekCapped = wk != null && x.week && (x.week.pct || 0) >= wk && x.week.resets_at;
    const t = Math.max(winCapped ? Date.parse(x.window.resets_at) : 0, weekCapped ? Date.parse(x.week.resets_at) : 0) || now + 10 * 60e3;
    if (best == null || t < best) best = t;
  }
  return best;
}
/** GitHub API quota (30 Sept): every worker, the lander, the brain and the phone share ONE PAT - 5000 calls an hour for
 *  Dan's user. At 01:10Z and 02:46Z it ran dry: every running session died on 403s mid-issue and the loop stopped.
 *  Below fill.minApiLeft calls left, start nobody (a session needs its calls to FINISH, not just to start).
 *  api = {remaining, reset} from GET /rate_limit (free); unknown = no cap (the call itself failed for another reason). */
export function apiCap(cfg, api) {
  const floor = (cfg.fill && cfg.fill.minApiLeft) ?? 1500;
  if (!api || api.remaining == null) return Infinity;
  return api.remaining < floor ? 0 : Infinity;
}
/** Bus rotation (30 Sept): a bus issue with thousands of comments made every full read dozens of calls. Past
 *  bus.rotateAt comments the health pass opens a fresh bus issue and closes the old one. */
export const busFull = (cfg, comments) => comments >= ((cfg.bus && cfg.bus.rotateAt) || 150);
/** Pro (#125, Dan 28 Sept): the brain starts no worker while the 5-hour window or the week is at/above the caps in
 *  roles.json fill (maxWindowPct / maxWeekPct). usage = the MCLITE_USAGE repo variable {window:{pct}, week:{pct}, at}.
 *  Unknown or older than 30 min = at most ONE worker (blind, but not stopped: usaged may lack the Pro login). */
export function usageCap(cfg, usage, now) {
  const F = cfg.fill || {};
  if (F.maxWindowPct == null && F.maxWeekPct == null) return Infinity;
  const fresh = usage && usage.window && usage.window.pct != null && !(usage.at && now - Date.parse(usage.at) > 30 * 60e3);
  if (!fresh) return 1;
  // 30 Sept 13:25Z (#1019): after a window reset MCLITE_USAGE still said 98% with resets_at already past; the cap held
  // at 0 and the loop slept 4 h. A window whose reset time has passed HAS reset - its pct is 0 until usage says otherwise.
  if (usage.window.resets_at && Date.parse(usage.window.resets_at) <= now) usage = { ...usage, window: { pct: 0, resets_at: null } };
  if (F.maxWindowPct != null && usage.window.pct >= F.maxWindowPct) return 0;
  const weekCap = usage.weekCap ?? F.maxWeekPct;   // the account's own cap rides on usage (launch.mjs / brain.mjs fill)
  if (weekCap != null && ((usage.week && usage.week.pct) || 0) >= weekCap) return 0;
  // PACING (Dan, 29 Sept: "make sure they don't get eaten by the 5 hour"): 10 Opus sessions took the window from 24% to
  // 46% in 25 min, so it would run out hours before its reset and every running session would die. Run only as many
  // sessions as spread the rest of the window evenly up to the cap by the reset (at least 1 while below the cap).
  if (F.sessionPctPerHour && F.maxWindowPct != null && usage.window.resets_at) {
    const h = Math.max(0.25, (Date.parse(usage.window.resets_at) - now) / 3600e3);
    return Math.max(1, Math.floor((F.maxWindowPct - usage.window.pct) / h / F.sessionPctPerHour));
  }
  return Infinity;
}
/** #4963 (Dan, 10 Oct: "run 1 session with 5.5 just to see if it can close an issue"): a run whose reason carries `model=<id>` (letters, digits, dot, dash)
 *  uses that model instead of roles.json, so ONE worker can be dispatched on e.g. claude-haiku-5-5 (brain.yml role=worker reason="model=claude-haiku-5-5").
 *  Anything else in the reason, or no reason, keeps the fallback. Pure. */
export function modelFor(reason, fallback) {
  const m = /(?:^|\s)model=([A-Za-z0-9][A-Za-z0-9.-]{1,60})(?=\s|$)/.exec(String(reason || ''));
  return m ? m[1] : fallback;
}
/** Dan, 10 Oct: "haiku is not permitted for workers, sonnet 5 low is". A `model=` in a dispatch reason may still pick another model,
 *  but never a Haiku for the worker role (the chore role is Haiku on purpose). Pure; launch.mjs applies it where MODEL is chosen. */
export function workerModelFor(role, model, fallback) { return role === 'worker' && /haiku/i.test(String(model || '')) ? fallback : model; }
/** #5045 (Dan, 11 Oct: "both accounts used at once, different things assigned to each, no universal fill count"): the repo variable
 *  FILL_WORKERS_<ACCOUNT> (e.g. FILL_WORKERS_MAX) = exactly that many workers on THAT account. A number 0-10, anything else = unset (null). Pure. */
export function acctSwitch(v) { const s = String(v ?? '').trim(); return /^\d+$/.test(s) ? Math.min(10, Number(s)) : null; }
/** The config with every account that has a FILL_WORKERS_<NAME> switch set to that worker count (its reserve-pool role dropped: they are workers), and whether any switch
 *  exists. When one does, the universal FILL_WORKERS pool starts no workers (it stays the master on/off). reservePlan then fills each account by its own caps. Pure. */
export function withAccountSwitches(cfg, env) {
  let active = false;
  const accounts = (cfg.accounts || []).map((a) => {
    const n = acctSwitch((env || {})['FILL_WORKERS_' + String(a.name).toUpperCase()]);
    if (n === null) return a;
    active = true; const { role, ...rest } = a; return { ...rest, workers: n };
  });
  return { cfg: { ...cfg, accounts }, active };
}
/** #5110 (Dan, 11 Oct: a commander read the shared 'fill shape: 1w+0t' line as the whole fill): the line `go.mjs status` prints for the REAL per-account counts.
 *  Per account: its FILL_WORKERS_<NAME> switch (else the roles.json reserve `workers`) x the quiet factor, rounded up, with how many are running now; the total cap is fill.maxTotal x factor. Pure. */
export function acctPlanLine(cfg, env, now, runningBy) {
  const f = quietState(cfg, now).factor, parts = [];
  for (const a of cfg.accounts || []) {
    const sw = acctSwitch((env || {})['FILL_WORKERS_' + String(a.name).toUpperCase()]), base = sw !== null ? sw : (a.workers || 0);
    const run = (runningBy && runningBy[a.name]) || 0;
    parts.push(`${a.name} target ${Math.ceil(base * f)} (${base}${f === 1 ? '' : ' x ' + f + ' quiet'}${sw === null ? ', no FILL_WORKERS_' + String(a.name).toUpperCase() + ' switch' : ''}) running ${run}`);
  }
  const mt = (cfg.fill || {}).maxTotal;
  return `fill per account (this rules when FILL_WORKERS_<ACCOUNT> is set; the 'fill shape' line above is only the shared pool): ${parts.join(' | ')} | total cap ${mt == null ? 'none' : Math.ceil(mt * f)}`;
}
/** 11 Oct (Dan: the fill must run well permanently): a pool is held 20 min after a worker found nothing to claim (#1503), but the commander can refill the queue a minute later
 *  and the hold kept EVERY pass from starting workers (16:31Z hold, #5137-#5141 filed 16:33Z, 0 running until a waker at 16:52Z). The hold is over as soon as a real issue
 *  (not a PR, the bus, tracking, blocked or ask-dan) was CREATED after its marker. Pure: markerMs = when the marker was written, issues = open issues from the API. */
export function noClaimReleased(markerMs, issues) {
  return (issues || []).some((i) => !i.pull_request && Date.parse(i.created_at) > markerMs && !(i.labels || []).some((l) => ['bus', 'tracking', 'blocked', 'ask-dan', 'dan-questions'].includes(l.name || l)));
}
/** #5039: the issue numbers a body says it waits on (`Depends on: #12, #34` lines; `go.mjs depends` writes them). Pure. */
export function dependsOn(body) {
  return [...String(body || '').matchAll(/^Depends on:\s*(.+)$/gim)].flatMap((m) => [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])));
}
/** #6663 PURE: open issues [{number, body, labels:[{name}]}] -> [{n, holds}] for every `blocked` issue that holds others through
 *  `Depends on:` chains (holds = open issues whose chain reaches it), most first. Cycles are cut; a closed dependency holds nothing.
 *  (12-13 Oct: #5094/#5095 blocked held 341-386 issues and nothing ever unblocked them.) */
export function heldByBlocked(issues) {
  const by = new Map((issues || []).map((i) => [i.number, i]));
  const isBlocked = (i) => (i.labels || []).some((l) => (l.name || l) === 'blocked');
  const count = new Map();
  for (const i of by.values()) {                 // BFS over each issue's dependencies (no memo: a cut cycle would poison it)
    const seen = new Set([i.number]), q = dependsOn(i.body).filter((d) => by.has(d));
    while (q.length) {
      const n = q.shift(); if (seen.has(n)) continue; seen.add(n);
      const d = by.get(n); if (isBlocked(d)) count.set(n, (count.get(n) || new Set()).add(i.number));
      for (const m of dependsOn(d.body)) if (by.has(m) && !seen.has(m)) q.push(m);
    }
  }
  return [...count].map(([n, s]) => ({ n, holds: s.size })).sort((a, b) => b.holds - a.holds || a.n - b.n);
}
/** #6663 PURE: which blocked issues the brain unblocks now: holds >= min, not unblocked by the brain within everyH hours. */
export function unblockDue(held, past, now, min = 20, everyH = 6) {
  return (held || []).filter((x) => x.holds >= min && !(now - ((past || {})[x.n] || 0) < everyH * 3600e3));
}
/** #5052: a headless run in a workspace Claude Code has not been told to trust IGNORES .claude/settings.json permissions.allow (11 Oct 04:32Z: the queue-thin commander ended
 *  exit 1; the fixer's "every build was denied" too). Pure: the ~/.claude.json text with projects[root].hasTrustDialogAccepted = true, or null when it already is (nothing to write). */
export function trustPatch(text, root) {
  let j; try { j = text ? JSON.parse(text) : {}; } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  j.projects = j.projects && typeof j.projects === 'object' ? j.projects : {};
  if ((j.projects[root] || {}).hasTrustDialogAccepted === true) return null;
  j.projects[root] = { ...(j.projects[root] || {}), hasTrustDialogAccepted: true };
  return JSON.stringify(j, null, 2);
}
/** #1503 BOONDOGGLE GUARD: history.burnTimes = start times of worker runs that ended with no PR and no new code. 4 within the
 *  last hour and the newest under 30 min old = pause the worker fill (the commander is told). Pure: caller passes history(). */
export function burnPaused(hist, now) {
  const b = ((hist && hist.burnTimes) || []).filter((t) => now - t < 3600e3);
  // #6631: 4 burns of ~35 worker starts (a 9-worker fill, 13 Oct 00:58-01:26Z) is noise, not a stuck system: the bar is
  // max(4, 40% of the hour's worker starts); with no start history it stays 4
  const starts = ((hist && hist.starts) || []).filter((s) => s && s.role === 'worker' && now - s.at < 3600e3).length;
  return b.length >= Math.max(4, Math.ceil(0.4 * starts)) && now - Math.max(...b) < 30 * 60e3;
}
/** #1575 (Dan, 2 Oct: the 11:07 boondoggle pause expired with NO bus comment to restart the fill - 6 h idle, no worker, no
 *  usage). RULE: every pause/hold that holds the fill back MUST arm its own wake. burnHoldEnd = when the boondoggle pause
 *  ends (0 = not paused); holdWakeAt = when the waker for a hold must fire (never in the past); fillIdleMin = minutes the
 *  fill has wanted workers while NOTHING ran (no run queued/in progress, so no waker either) and nothing started - the
 *  health alert `fill-idle` that wakes the fixer. */
export function burnHoldEnd(hist, now) {
  if (!burnPaused(hist, now)) return 0;
  return Math.max(...((hist && hist.burnTimes) || []).filter((t) => now - t < 3600e3)) + 30 * 60e3;
}
export const holdWakeAt = (holdUntil, now) => Math.max(holdUntil + 30e3, now + 60e3);
/** #2700 (4 Oct: the lander sat idle 16:43Z-18:30Z with 100 PRs labelled land, no land.yml run queued or running, nothing noticed).
 *  none = nothing waits or a run exists; dispatch = start land.yml now (self-heal, no session needed); alert = we dispatched
 *  under 40 min ago and still nothing runs, so a person/commander must look (finding `lander-idle`). */
export function landIdleAction(waiting, active, lastDispatchAt, now) {
  if (!(waiting > 0) || active > 0) return 'none';
  return lastDispatchAt && now - lastDispatchAt < 40 * 60e3 ? 'alert' : 'dispatch';
}
/** 6 Oct (10:44Z-11:09Z: a waker hung in its post, the next waker queued behind it, no worker started): brain.yml runs that
 *  outlived their limit. A waker's run-name ends with the ISO time it sleeps until: overdue 5 min after it. A comment-routed
 *  run (route + health + fill, job timeout 5 min) is overdue at 10; every session role (job timeout 110) at 120. Only
 *  in_progress runs: a queued waker is the pending one and must stay. Returns the runs to cancel with why. */
export function overdueRuns(runs, now) {
  const out = [];
  for (const r of runs || []) {
    if (r.status !== 'in_progress') continue;
    const t = r.display_title || r.name || '', age = (now - Date.parse(r.run_started_at || r.created_at)) / 60e3;
    const at = Date.parse((t.match(/^brain waker (\S+)$/) || [])[1]);
    const limit = /^brain waker/.test(t) ? (at ? (at + 5 * 60e3 - Date.parse(r.run_started_at || r.created_at)) / 60e3 : 105)
      : /^brain issue_comment/.test(t) ? 10 : 120;
    if (age > limit) out.push({ id: r.id, title: t, age: Math.round(age), limit: Math.round(limit) });
  }
  return out;
}
export function fillIdleMin(hist, activeRuns, wanted, now) {
  if (!wanted || activeRuns > 0) return 0;
  const last = Math.max(0, ...(((hist && hist.starts) || []).map((x) => x.at)));
  return last ? Math.floor((now - last) / 60e3) : 0;
}
/** #125: a worker run that ends with neither a PR nor a hand-off burned a session for nothing. Two in a row on the same
 *  issue -> the brain labels it `blocked` (queue() skips it) with the reason, so there is never a third burn. */
/** #2071 (Dan, 3 Oct): a brain worker (no GPU) that burns a run on a `RED <check>` issue cannot verify it - the next GPU-less
 *  worker would burn too (4 in an hour on 3 Oct tripped the pause). Label it pc-gpu after ONE wasted run; go.mjs queue() skips
 *  pc-gpu for brain workers. Only red-check issues: every other issue keeps the 2-burns -> blocked rule. */
export const needsPc = (labels) => (labels || []).includes('red-check') && !(labels || []).includes('pc-gpu');
export function burnVerdict(burns, issue, produced) {
  const n = produced ? 0 : ((burns && burns[issue]) || 0) + 1;
  return { n, block: n >= 2 };
}

/** #1529: when to start the GPU texture audit (tools/texauditjob.mjs, a detached, nice-19 background job). last = the
 *  previous run {at, srcHash} or null. Only when the entity/model/texture sources changed since, the last start was
 *  3 h or more ago, the machine is not busy (load, usage cap, a cancelled suite) and no run holds the lock. */
export function texauditDue({ last, srcHash, now, busy, running }) {
  if (running) return { run: false, why: 'a texaudit run holds the lock' };
  if (busy) return { run: false, why: 'machine busy (load, usage cap or STOP-SUITE)' };
  if (last && last.srcHash === srcHash) return { run: false, why: 'sources unchanged since the last run' };
  if (last && now - last.at < 3 * 3600e3) return { run: false, why: 'last run started under 3 h ago' };
  return { run: true, why: last ? 'sources changed' : 'never run' };
}
/** #1937 (Dan, 3 Oct: a false "boondoggling" page at 03:14Z). claude -p ends with "You've hit your session limit · resets
 *  11:20pm (America/New_York)" when the ACCOUNT is out - MCLITE_USAGE can lag it by 15+ min. parseLimit(text, now) ->
 *  null, or {kind, until} where until is the stated reset (a bare time = its next occurrence in that zone; unparseable =
 *  now + 1 h, so the account is still treated as out). Pure. */
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function tzOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
    .formatToParts(new Date(utcMs)).filter((x) => x.type !== 'literal').map((x) => [x.type, +x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}
export function parseLimit(text, now) {
  const m = /hit your ([a-z0-9 -]{1,30}?) limit(?:\s*[·\-|]\s*resets\s+([^()\n]+?)\s*\(([A-Za-z_]+\/[A-Za-z_]+)\))?/i.exec(String(text || ''));
  if (!m) return null;
  const kind = m[1].trim().toLowerCase(), fallback = { kind, until: now + 3600e3 };
  if (!m[2]) return fallback;
  const t = /^(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(m[2].trim());
  if (!t) return fallback;
  let tz = m[3]; try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { return fallback; }
  const h = (+t[3] % 12) + (/pm/i.test(t[5]) ? 12 : 0), mi = +(t[4] || 0);
  const nowLocal = new Date(now + tzOffsetMs(now, tz));
  let y = nowLocal.getUTCFullYear(), mo = nowLocal.getUTCMonth(), d = nowLocal.getUTCDate();
  if (t[1]) { mo = MON[t[1].toLowerCase()]; d = +t[2]; if (mo == null) return fallback; }
  const at = (yy) => { const g = Date.UTC(yy, mo, d, h, mi); return g - tzOffsetMs(g, tz); };
  let until = at(y);
  if (!t[1] && until <= now) until += 24 * 3600e3;                     // a bare time already passed today = tomorrow
  if (t[1] && until < now - 24 * 3600e3) until = at(y + 1);            // "Jan 2" seen on 31 Dec
  return { kind, until };
}
/** The usage the fill and pickAccount see: MCLITE_USAGE with every account whose limit is still in force (history.limits
 *  = {account: untilMs}) at 100% of its window until then - so the fill stops, switches account, and its capped-waker fires
 *  at the reset. Pure; returns a new object. */
export function applyLimits(U, limits, now) {
  const live = Object.entries(limits || {}).filter(([, until]) => until > now);
  if (!live.length) return U;
  const out = { ...(U || {}), at: (U && U.at && now - Date.parse(U.at) <= 30 * 60e3) ? U.at : new Date(now).toISOString(), accounts: { ...((U && U.accounts) || {}) } };
  for (const [name, until] of live) {
    const a = out.accounts[name] || {};
    out.accounts[name] = { ...a, window: { pct: 100, resets_at: new Date(until).toISOString() }, week: a.week || { pct: 0 } };
  }
  return out;
}
/** #1939 (Dan, 3 Oct: "1 tester 2 workers" on Pro). The PRIMARY pool (FILL_WORKERS + fill.testers) runs on whatever
 *  account pickAccount chooses; when Max is past its week cap that is Pro, which then carried 8 sessions and ran its
 *  5-hour window dry. accounts[].maxWorkers caps the primary pool's sessions while it runs on that account, and
 *  accounts[].testers how many of them may be testers (default fill.testers). Pure. */
export function primaryCaps(cfg, accountName, now = Date.now()) {
  const a = (cfg.accounts || []).find((x) => x.name === accountName) || {};
  return { sessions: a.maxWorkers ?? Infinity, testers: a.testers ?? Math.ceil(((cfg.fill || {}).testers || 0) * quietState(cfg, now).factor) };
}

// #2327: is this a real CLI login failure? Never on a limit-ended run, never on the worker's own summary prose
// ('token', 'auth', '403' are ordinary words here). Only stderr and the CLI's structured error (is_error result) are read.
export function authFailed(err, res, limit) {
  if (limit) return false;
  const t = `${err || ''}\n${res && (res.is_error || res.error) ? (res.error || res.result || '') : ''}`;
  return /invalid (api key|.*token)|not logged in|authentication[_ ]error|oauth|please run \/login|401 unauthorized|authentication_failed/i.test(t);
}
