// tools/fillwakecheck.mjs - #150 (Dan, 29 Sept 2026: "when a session ends it starts a new one or doesn't"): every bus
// comment the brain routes must run FILL, not only the 14-minute health pass - otherwise a worker ending inside those
// 14 minutes starts nobody and the loop goes dormant. Anti-vacuity: the same verdict on a brain.yml without the line.
import { readFileSync } from 'node:fs';
const yml = readFileSync(new URL('../.github/workflows/brain.yml', import.meta.url), 'utf8');
const brain = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8');
const go = readFileSync(new URL('./go.mjs', import.meta.url), 'utf8');
const route = readFileSync(new URL('./brain/route.mjs', import.meta.url), 'utf8');
const launch = readFileSync(new URL('./brain/launch.mjs', import.meta.url), 'utf8');
const roles = readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8');
const verdicts = (y, b, g = go, rt = route, ln = launch, rl = roles) => {
  const bad = [];
  const ic = (y.match(/issue_comment\)[\s\S]*?;;/) || [''])[0], sc = (y.match(/schedule\)[\s\S]*?;;/) || [''])[0];
  if (!/brain\.mjs fill\b/.test(sc) || !/health --if-due/.test(sc) || !/cron: '\*\/5 \* \* \* \*'/.test(y)) bad.push('#8893: the 5-minute schedule tick does not run health + FILL (a hold is revisited only by the tick)');
  if (/brain\.mjs (fill|health)\b/.test(ic) || !/contains\(github\.event\.comment\.body, 'to: commander'\)/.test(y) || /!contains\(github\.event\.comment\.body, 'from: brain'\)/.test(y)) bad.push('#8893/#8966: a bus comment runs health/fill, or the route if: has no to: filter (the brain would trigger itself on its to: log lines), or it skips from: brain mail (no alert would wake the commander)');
  if (!/cmd === 'fill'\) await fillLocked\(\)/.test(b)) bad.push("brain.mjs has no 'fill' command");
  if (!/async function fill\(\)[\s\S]*?brain\.yml\/dispatches/.test(b)) bad.push('fill() does not dispatch workers');
  if (!/worker not started[\s\S]{0,400}?brain\.mjs wake \d+/.test(y)) bad.push('a worker that could not start leaves no waker (the loop sleeps until someone posts)');
  if (!/Math\.min\(10, Number\(o\)\)/.test(rt)) bad.push('FILL_WORKERS is capped below the 10 brain runners');
  if (!/if \(perSession && [\s\S]{0,300}?resets_at[\s\S]{0,200}?Math\.floor\(\(F\.maxWindowPct - usage\.window\.pct\) \/ h/.test(rt)) bad.push('no pacing: sessions can eat the 5-hour window before its reset');
  if (!/role == 'tester' \|\| needs\.route\.outputs\.role == 'waker'\) && format\('-\{0\}', github\.run_id\)/.test(y)) bad.push('#5023: wakers share one concurrency group, so a newer pending waker replaces the armed one and the wake is lost (fill idle 27 min, 11 Oct)');
  if (!/PIN="\$\(printf[^\n]*\[Ii\]ssue #[\s\S]*?go\.mjs start \$\{PIN:\+--issue "\$PIN"\}/.test(y)) bad.push('#5029: a worker dispatched with "issue #N" in its reason is not pinned to that issue (it took the queue head)');
  if (!/role: 'tester'/.test(b)) bad.push('fill reserves no tester passes (Dan: rigorous testing of finished phases)');
  if (!/u\.accounts\[pickAccount\(/.test(b)) bad.push('fill reads usage without picking the account (usage looks unknown -> 1 worker)');
  if (!/Date\.parse\(usage\.window\.resets_at\) <= now\) usage = \{ \.\.\.usage, window: \{ pct: 0/.test(rt)) bad.push('a window whose reset has passed still caps fill (#1019: loop dead 4 h on a stale 98%)');
  if (!/Math\.max\(capsLiftAt\(CFG, U, now\) \+ 3 \* 60e3, now \+ 10 \* 60e3\)/.test(b)) bad.push('a usage waker can be set in the past (#1019: wakers re-fired at once)');
  if (!/else if \(n === 0 && running === 0 && usageCap\(CFG, usage, now\) === 0 && capsLiftAt\(CFG, U, now\) != null\)/.test(b)) bad.push('the capped-by-usage waker watches ONE account (#2335: Max capped, Pro reset at 04:50Z woke nobody for 45 min)');
  if (!/if \(!armed\(at\)\) \{\s*console\.log\(`fill: capped[\s\S]{0,200}?await arm\(at\)/.test(b)) bad.push('an armed LATER waker blocks an earlier one (#2335: Max 07:23Z hid Pro 04:50Z)');
  if (!/export function capsLiftAt/.test(rt)) bad.push('route.mjs has no capsLiftAt (earliest cap lift over every account)');
  if (!/usageCap\(CFG, usage, now\) === 0\) \{\s*console\.log\(`SKIP \$\{role\}/.test(ln)) bad.push('a commander/fixer/tester can start past the usage caps (only workers were capped; Pro)');
  if (!/pendingMailDue\(pendingMail\(\)[\s\S]{0,300}?role: m\.role/.test(b)) bad.push('fill() never re-routes parked mail (#3947: a mail at the maxPerHour cap was dropped)');
  if (!/role !== 'worker' && reason && !dry\) \{[^\n]*\n\s*(?:const [^\n]*\n\s*)?setPendingMail[\s\S]{0,900}?brain\.mjs', 'wake'/.test(ln)) bad.push('a capped commander/fixer mail is not parked with a waker (#3947)');
  if (!/const already = !!pendingMail\(\)\[role\];[\s\S]{0,300}?if \(!already\) await post\('log', `brain: \$\{role\} mail held/.test(ln)) bad.push('the "mail held" log line is posted on every capped launch, not once per hold (#4970: 30 s self-feeding bus flood)');
  if (!/modelUsage[\s\S]{0,400}?cacheReadInputTokens[\s\S]{0,300}?total_cost_usd[\s\S]{0,200}?run ended/.test(ln)) bad.push('a run ends without logging its models, tokens and cost (Dan 1 Oct: Pro usage looked fishy)');
  if (!/await fillReserve\(runs, runningBy/.test(b) || !/async function fillReserve[\s\S]*?reservePlan\(/.test(b)) bad.push('fill never tops up the reserved account pools (Pro Opus workers)');
  if (!/fillWant\(CFG, now, process\.env\.FILL_WORKERS\) === 0/.test(b)) bad.push('the reserved pools ignore the worker switch (LOOP-OFF would not stop them)');
  if (!/account: \{ description[\s\S]*?\$\{\{ inputs\.account && format\(' @\{0\}'/.test(y) && !/inputs\.account && format\(' @\{0\}'/.test(y)) bad.push('a reserved pool run carries no @account tag (fill cannot count it)');
  if (!/--account "\$ACCOUNT"/.test(y)) bad.push('brain.yml does not pass the account to launch.mjs');
  if (!/nothing to claim[\s\S]{0,260}?noclaim-[\s\S]{0,200}?exit 0/.test(y)) bad.push('a start that finds nothing to claim still posts to the bus (the spin: every post re-runs FILL)');
  if (!/if \(!listFailed\) snap\.fillIdleMin = fillIdleMin\(/.test(b)) bad.push('#5550: a failed run listing (API quota out) counts as nothing running and pages a false fill-idle');
  if (!/\(history\(\)\.wakes \|\| \[\]\)\.filter\(\(w\) => w <= now && now - w < 5 \* 60e3\)/.test(b)) bad.push('fill-idle counts the gap while a waker\'s own fill is arming the next one (14 Oct 11:55Z false alarm)');
  if (!/\.\.\.noClaimMarks\(\)/.test(b)) bad.push('fill-idle ignores the no-claim chain (an empty backlog pages fill-idle every 45 min)');
  if (!/noClaimHold\('default', now\)\) \{[^}]*n = t;/.test(b)) bad.push('fill ignores the no-claim hold (workers dispatched into an empty queue)');
  if (!/burnPaused\(history\(\), now\)\) \{[\s\S]{0,400}?n = t;/.test(b)) bad.push('fill ignores the boondoggle pause');
  if (!/h2\.burnTimes/.test(ln)) bad.push('launch.mjs records no burn times (the boondoggle guard has nothing to count)');
  if (!/holdUntil > now && !armed\(holdWakeAt\(holdUntil, now\)\)[\s\S]{0,400}?await arm\(at\)/.test(b) || /wakers/.test(b) || !/const armed = \(atMs\) => \(history\(\)\.wakes/.test(b) || !/const arm = async[\s\S]{0,300}?h\.wakes\.push/.test(b)) bad.push('a fill hold/pause arms no waker (or a RUNNING waker - the one that just fired - counts as armed, #2820: idle 364 min on 5 Oct) (#1575: the 11:07 pause expired with nothing to restart the fill - 6 h idle)');
  if (/wake: a waker is already pending/.test(b) && /brain waker\$/.test(b.slice(b.indexOf('async function wakeIn')))) bad.push('brain.mjs wake counts a RUNNING waker as pending, so the retry after "nothing to claim" is never armed (#2894)');
  if (!/noClaimHold\('default', now\)\) \{[^}]*holdUntil/.test(b) || !/burnPaused\(history\(\), now\)\) \{\s*holdUntil/.test(b) || !/return burnHoldEnd\(history\(\), now\)/.test(b)) bad.push('a hold (no-claim, boondoggle, reserve pool) does not report when it ends, so no waker can be armed for it');
  if (!/laneHeld = noClaimHold\(LANE, now\)[\s\S]{0,300}?holdUntil = Math\.max\(holdUntil, noClaimEnd\(LANE\)\)/.test(b)) bad.push('the phase lane hold (noclaim-phase) arms no waker (#3948, #1575)');
  if (!/f\.key === 'fill-idle'\) await post\('fixer'/.test(b) || !/fill-idle/.test(rl)) bad.push('the fill-idle alert does not reach the fixer / the fixer prompt does not know how to repair it');
  if (!/go\.mjs say --to fixer/.test(rl) || !/NO BOONDOGGLING/.test(rl)) bad.push('the worker prompt does not tell workers they can call a fixer / not to boondoggle');
  if (!/5h \$\{a0\.window\.pct\}->\$\{a1\.window\.pct\}%/.test(ln)) bad.push('a run line has no per-run usage before/after (Dan: how much each session used)');
  if (!/async function loop\(\)[\s\S]*?'PATCH', P, body[\s\S]*?to: log[\s\S]*?fill set to \$\{n\}/.test(g)) bad.push('go.mjs loop <n> posts nothing to the bus, so the brain never sees the new worker count (6 Oct: idle 3h20m after 10 workers were set)');
  if (!/saveHistory\(h\);\s*if \(snap\.fillWant > 0\) await wakeIn\(15\)/.test(b)) bad.push('health arms no waker while the fill wants workers: a quiet bus never runs health, so the 60-min dormant alert never fires (6 Oct)');
  if (!/target > 0 && have < target && !armed\(now \+ 15 \* 60e3\)\) \{[^\n]*\n?\s*await arm\(now \+ 15 \* 60e3\)/.test(b)) bad.push('#4256: a fill that ends below target arms no +15 min dead-man waker');
  if (!/exp > now && !armed\(exp \+ 30e3\)\) await arm\(exp \+ 30e3\)/.test(b)) bad.push('#4256: a FILL_WORKERS=N@time override lapses with no waker');
  if (!/f\.key === 'dormant' && !\(h\.told[\s\S]{0,200}?await notify\(`DORMANT/.test(b)) bad.push('#4256: dormancy does not page Dan at once');
  if (!/const stale = m == null \|\| w == null \|\| m > 45 \|\| w > 45;[\s\S]{0,200}?last master commit \$\{m \?\? '\?'\} min ago, last worker run/.test(g)) bad.push('#4256: go.mjs status has no red "last master commit N min ago" first line');
  if (!/left\('tester'\) === 0\) \{[\s\S]{0,400}?x\.role === 'tester'[\s\S]{0,300}?await arm\(at\)/.test(b)) bad.push('#4335: the tester maxPerHour cap holds the tester slots with no waker for when it lifts (8 Oct 02:35-03:33Z idle)');
  if (!/n >= 3\) \{ await gh\('POST', `\/repos\/\{repo\}\/issues\/\$\{num\}\/labels`, \{ labels: \['blocked'\]/.test(g)) bad.push('#4335: an issue handed off unfinished 3 times stays claimable (#4319)');
  const u = JSON.parse(rl).fill.until; if (Date.parse(u) < Date.now() + 30 * 864e5) bad.push(`#4256: roles.json fill.until (${u}) expires within 30 days or already has - the fill silently falls to 0`);
  return bad;
};
const real = verdicts(yml, brain);
const BREAKS = [
  ['reason issue pin dropped (#5029)', () => [yml.replace(' ${PIN:+--issue "$PIN"}', ''), brain]],
  ['wakers share one concurrency group (#5023)', () => [yml.replace(" || needs.route.outputs.role == 'waker'", ''), brain]],
  ['3 hand-offs stay claimable', () => [yml, brain, go.replace('if (n >= 3) {', 'if (n >= 99) {')]],
  ['tester cap arms no waker', () => [yml, brain.replace("left('tester') === 0) {", "left('tester') === 99) {")]],
  ['loop <n> posts nothing', () => [yml, brain, go.replace('fill set to ${n}', 'x')]],
  ['health arms no waker', () => [yml, brain.replace('if (snap.fillWant > 0) await wakeIn(15)', '')]],
  ['the tick has no schedule', () => [yml.replace("cron: '*/5 * * * *'", "cron: '0 0 1 1 *'"), brain]],
  ['a comment runs fill again', () => [yml.replace("route >> \"$GITHUB_OUTPUT\" ;;", "route >> \"$GITHUB_OUTPUT\"; node tools/brain/brain.mjs fill ;;"), brain]],
  ['the brain triggers itself', () => [yml.replace("contains(github.event.comment.body, 'to: commander')", 'true'), brain]],
  ['the brain skips its own alerts (#8966)', () => [yml.replace("(contains(github.event.comment.body, 'to: commander')", "!contains(github.event.comment.body, 'from: brain') && (contains(github.event.comment.body, 'to: commander')"), brain]],
  ['FILL only in the health pass', () => [yml.replace(/\n\s*node tools\/brain\/brain\.mjs fill[^\n]*/g, ''), brain]],
  ['no fill command', () => [yml, brain.replace("cmd === 'fill') await fillLocked()", "cmd === 'nofill') await fillLocked()")]],
  ['no waker after a failed start', () => [yml.replace(/node tools\/brain\/brain\.mjs wake \d+[^\n]*\n/g, ''), brain]],
  ['no pacing', () => [yml, brain, go, route.replace('if (perSession &&', 'if (false &&')]],
  ['no tester passes', () => [yml, brain.replace(/role: 'tester'/g, "role: 'worker'")]],
  ['usage read without the account', () => [yml, brain.replace('u.accounts[pickAccount(', 'u.accounts[(')]],
  ['stale window after its reset still caps', () => [yml, brain, go, route.replace('Date.parse(usage.window.resets_at) <= now)', 'false)')]],
  ['usage waker in the past', () => [yml, brain.replace(', now + 10 * 60e3)', ', 0)'), go, route]],
  ['launch ignores the usage caps', () => [yml, brain, go, route, launch.replace('usageCap(CFG, usage, now) === 0) {', 'false) {')]],
  ['runs log no cost', () => [yml, brain, go, route, launch.replace('cacheReadInputTokens', 'cacheRead')]],
  ['reserve pools never top up', () => [yml, brain.replace('await fillReserve(runs,', 'await 0 && fillReserve(runs,')]],
  ['reserve ignores the worker switch', () => [yml, brain.replace('=== 0 || !(C.accounts', '=== -1 || !(C.accounts')]],
  ['no account tag on runs', () => [yml.replace("inputs.account && format(' @{0}', inputs.account)", "''"), brain]],
  ['account not passed to launch', () => [yml.replace('${ACCOUNT:+--account "$ACCOUNT"}', ''), brain]],
  ['spin: no-claim still posts', () => [yml.replace(/if grep -q 'nothing to claim'[\s\S]*?\n\s+fi\n/, ''), brain]],
  ['fill-idle trusts a failed run listing (#5550)', () => [yml, brain.replace('if (!listFailed) snap.fillIdleMin', 'snap.fillIdleMin')]],
  ['fill-idle ignores a waker that just fired', () => [yml, brain.replace('(history().wakes || []).filter((w) => w <= now && now - w < 5 * 60e3).length', '0')]],
  ['fill-idle ignores no-claim marks', () => [yml, brain.replace('...noClaimMarks()', '')]],
  ['fill ignores the no-claim hold', () => [yml, brain.replace("noClaimHold('default', now)", 'false')]],
  ['fill ignores the burn pause', () => [yml, brain.replace(/burnPaused\(history\(\), now\)\) \{\s*holdUntil/, 'false) { holdUntil')]],
  ['no burn times recorded', () => [yml, brain, go, route, launch.replaceAll('h2.burnTimes', 'h2.burnX')]],
  ['a hold arms no waker', () => [yml, brain.replace('holdUntil > now && !armed(', 'false && !armed(')]],
  ['wake counts a running waker', () => [yml, brain.replace("(history().wakes || []).some((w) => w > now && w <= at + 60e3)) return console.log('wake:", "runs.some((r) => /^brain waker$/.test(r.name))) return console.log('wake:"), go, route]],
  ['the no-claim hold reports no end', () => [yml, brain.replace("n = t; holdUntil = Math.max(holdUntil, noClaimEnd('default'));", 'n = t;')]],
  ['fill-idle never reaches the fixer', () => [yml, brain.replace("if (f.key === 'fill-idle') await post('fixer'", "if (false) await post('fixer'")]],
  ['the fixer is not told how to fix fill-idle', () => [yml, brain, go, route, launch, roles.replaceAll('fill-idle', 'fill-x')]],
  ['workers are not told about the fixer', () => [yml, brain, go, route, launch, roles.replace('go.mjs say --to fixer', 'go.mjs say --to nobody')]],
  ['no per-run usage on the run line', () => [yml, brain, go, route, launch.replace('5h ${a0.window.pct}->${a1.window.pct}%', '5h')]],
  ['the phase lane hold arms no waker', () => [yml, brain.replace('holdUntil = Math.max(holdUntil, noClaimEnd(LANE))', '')]],
  ['fill dispatches nothing', () => [yml, brain.replaceAll('/brain.yml/dispatches', '/brain.yml/nothing')]],
  ['the usage waker watches one account', () => [yml, brain.replace('&& capsLiftAt(CFG, U, now) != null)', '&& usage?.window?.resets_at)')]],
  ['a later waker blocks an earlier one', () => [yml, brain.replace('if (!armed(at)) {\n      console.log(`fill: capped', 'if (!armed(at) && false) {\n      console.log(`fill: capped')]],
  ['no dead-man waker', () => [yml, brain.replace('target > 0 && have < target &&', 'false &&')]],
  ['override expiry arms nothing', () => [yml, brain.replace('exp > now && !armed(exp + 30e3)', 'false')]],
  ['dormancy pages nobody at once', () => [yml, brain.replace("await notify(`DORMANT", "await 0 && notify(`DORMANT")]],
  ['status has no age line', () => [yml, brain, go.replace('m > 45 || w > 45', 'false')]],
  ['fill.until expired', () => [yml, brain, go, route, launch, roles.replace(/"until": "2027-12-31[^"]*"/, '"until": "2026-09-30T04:00:00Z"')]],
  ['a running waker counts as armed', () => [yml, brain.replace('const armed = (atMs) => (history().wakes || []).some(', 'const armed = (atMs) => runs.some((r) => /^brain waker$/.test(r.display_title)) || (history().wakes || []).some(')]],
];
// #2335: capsLiftAt BEHAVIOUR on the real roles.json and the 4 Oct 04:34Z situation (Max week 100%, Pro window 100% resetting 04:49:59).
const cfg = JSON.parse(roles);
const Z = (s) => Date.parse(s);
const mkU = (at, o) => ({ at, accounts: { default: { ok: false }, ...o } });
const maxA = { week: { pct: 100, resets_at: '2026-10-04T11:00:00Z' }, window: { pct: 2, resets_at: '2026-10-04T07:20:00Z' } };
const proCapped = { week: { pct: 58, resets_at: '2026-10-09T07:00:00Z' }, window: { pct: 100, resets_at: '2026-10-04T04:49:59Z' } };
const proFree = { week: { pct: 59, resets_at: '2026-10-09T07:00:00Z' }, window: { pct: 3, resets_at: '2026-10-04T09:50:00Z' } };
const lift = async (src, now, o) => (await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).capsLiftAt(cfg, mkU(new Date(now).toISOString(), o), now);
const fnBad = async (src) => {
  const bad = [];
  const n1 = Z('2026-10-04T04:34:00Z'), n2 = Z('2026-10-04T04:55:00Z');
  if (await lift(src, n1, { max: maxA, pro: proCapped }) !== Z('2026-10-04T04:49:59Z')) bad.push('Max week-capped + Pro window-capped: the wake is not Pro\'s 04:49:59 reset');
  if (await lift(src, n2, { max: maxA, pro: proFree }) !== Z('2026-10-04T11:00:00Z')) bad.push('a week-capped account does not wake at its WEEK reset (07:20Z window reset re-armed every 10 min)');
  if (await lift(src, n2, { max: { ...maxA, week: { pct: 10, resets_at: maxA.week.resets_at } }, pro: proFree }) !== null) bad.push('nothing capped must arm no waker');
  const old = { ...cfg, accounts: cfg.accounts.map((a) => (a.name === 'pro' ? { ...a, until: '2026-10-01T00:00:00Z' } : a)) };
  if ((await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'))).capsLiftAt(old, mkU(new Date(n1).toISOString(), { max: maxA, pro: proCapped }), n1) !== Z('2026-10-04T11:00:00Z')) bad.push('an expired account still sets the wake');
  return bad;
};
const FBREAKS = [
  ['only the 5h window reset counts', (s) => s.replace('weekCapped ? Date.parse(x.week.resets_at) : 0', '0')],
  ['the LAST account wins, not the earliest', (s) => s.replace('if (best == null || t < best) best = t;', 'if (best == null || t > best) best = t;')],
  ['expired accounts still count', (s) => s.replace('if (a.until && Date.parse(a.until) <= now) continue;\n    const x = u && u.accounts', 'const x = u && u.accounts')],
  ['uncapped accounts set a wake', (s) => s.replace('> 0) continue;\n    const winCapped', '> 99) continue;\n    const winCapped')],
];
const fReal = await fnBad(route);
let fCaught = 0;
for (const [name, mut] of FBREAKS) { const m = mut(route); if (m !== route && (await fnBad(m)).length) { fCaught++; console.log(`  ✓ break caught: capsLiftAt ${name}`); } else console.log(`  ✗ break NOT caught: capsLiftAt ${name}`); }
for (const r of fReal) console.log(`  ✗ ${r}`);
let caught = 0;
for (const [name, mk] of BREAKS) { const [y, b, g, rt, ln, rl] = mk(); if (verdicts(y, b, g, rt, ln, rl).length) { caught++; console.log(`  ✓ break caught: ${name}`); } else console.log(`  ✗ break NOT caught: ${name}`); }
for (const r of real) console.log(`  ✗ ${r}`);
console.log(`fillwakecheck: ${caught + fCaught} breaks caught (of ${BREAKS.length + FBREAKS.length})`);
console.log(` assertions passed .... ${30 - real.length + 4 - fReal.length}`);
console.log(` failures ........... ${real.length + fReal.length + BREAKS.length - caught + FBREAKS.length - fCaught}`);
process.exit(real.length || fReal.length || caught < BREAKS.length || fCaught < FBREAKS.length ? 1 : 0);
