#!/usr/bin/env node
// tools/go.mjs - the ONE front door (RUN.md). Dan says "cloud session" or "loop session"; this does the rest.
//
//   node tools/go.mjs start [--loop] [--issue N]   set up, claim, brief   (--loop: claim one issue per worker)
//   node tools/go.mjs prep --dir <clone>             build that workspace's assets/ (a loop worker's FIRST command)
//   node tools/go.mjs check                          still mine? (someone may have taken over a stale claim)
//   node tools/go.mjs done --msg "…" --try "…" [--finished | --part --owed "<what is left>"] [--dir <clone>]
//   node tools/go.mjs usage                          Dan's 5-hour + weekly usage (tools/usaged.mjs publishes it)
//   node tools/go.mjs status                         what is claimed, in review, queued; is master red
//   node tools/go.mjs say [--to all|sessions|commander|#N|<branch>] "…"   message other sessions (the bus issue)
//   node tools/go.mjs inbox [--all]                  unread messages for this session (start/check/done show them too)
//   node tools/go.mjs reply <id> "…"                 answer a message - REQUIRED before any other go.mjs command runs
//   node tools/go.mjs texaudit [status]              the last GPU texture audit (#1529): READ-ONLY; the brain's background job makes it
//   node tools/go.mjs loop on|off|<n>                the brain's worker count (repo variable FILL_WORKERS; LOOP-ON/OFF.cmd)
//
// The branch work/<issue> IS the claim. GitHub refuses to create a ref that exists, so exactly one session wins.
// A claim is stale when its branch has had no push for STALE_H hours and no open PR; taking it over is a
// fast-forward-only ref update, so two sessions racing for the same stale claim still produce one winner.
import { execFileSync, spawnSync } from 'node:child_process';
import { usageLines } from './infra/usagefmt.mjs';
import { existsSync, readFileSync, mkdirSync, symlinkSync, writeFileSync, rmSync, statfsSync } from 'node:fs';
import { addresses, pending, news, field } from './infra/bus.mjs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gateFilter, gateOpen, handGate, phaseOpen, inGate, inheritLabels } from './infra/queuegate.mjs';
import { laneFilter, isLockstep, lockstepFront } from './infra/phaselane.mjs';
import { stuckByHandoffs } from './infra/handoffstuck.mjs';
import { goldenNames, publishGolden } from './infra/golden.mjs';
import { isHeld, heldRefs } from './infra/heldnow.mjs';
import { claimKey, heldByComment } from './infra/claimlock.mjs';
import { quietState, acctPlanLine, capacityState } from './brain/route.mjs';
import { gh, ghAll, token, gitAuthArgs, findUnder, ROOT, REPO, CLOUD, proxyBlocked, busIssue, busComments } from './infra/gh.mjs';

const STALE_H = 3;
const DATA = ['jars', '.mcdata', '.mcsnd', '.chromium', '.decomp'];   // NOT assets/: generated per clone (D-6)
const argv = process.argv.slice(2), cmd = argv[0] || 'help';   // #2065: a bare call must never claim an issue (3 Oct: two sessions did) - `start` has to be typed
const opt = (n) => { const i = argv.indexOf(n); return i > 0 ? argv[i + 1] : null; };
const flag = (n) => argv.includes(n);
const PART_MARK = '<!-- mclite:part -->';   // #4646: tools/infra/land.mjs reads it
const die = (line) => { console.log(`FAIL  ${line}`); process.exit(1); };
const git = (args, cwd = ROOT, auth = false) =>
  execFileSync('git', [...(auth ? gitAuthArgs() : []), ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function where() {
  if (process.platform === 'win32') return 'windows';
  if ((process.env.HOME || '').startsWith('/sessions/')) return 'cowork';
  return 'cloud';
}
// ---- cloud relay: a write the cloud proxy refuses becomes an op commit on the session's own branch, performed by
// .github/workflows/relay.yml (tools/infra/relay.mjs) on Dan's PC runners. See relay.mjs for the ops.
const outFile = (dir) => join(dir, '.git', 'mclite-outbranch');
function outBranch(dir) {
  if (existsSync(outFile(dir))) return readFileSync(outFile(dir), 'utf8').trim();
  const b = git(['branch', '--show-current'], dir);
  if (!/^claude\//.test(b)) return null;
  writeFileSync(outFile(dir), b); return b;
}
const ID = ['-c', 'user.name=MC-Lite session', '-c', 'user.email=session@mclite.invalid'];
function opCommit(dir, op, payload) {
  git([...ID, 'commit', '-q', '--allow-empty', '-m', `mclite-op: ${op}`, '-m', JSON.stringify(payload)], dir);
  git(['push', '-q', 'origin', `HEAD:${outBranch(dir)}`], dir, true);
  console.log(`(via the relay: ${op} - it takes effect when Dan's PC runner picks it up, usually within a minute)`);
}
async function write(dir, op, payload, direct) {
  try { return await direct(); }
  catch (e) { if (!proxyBlocked(e) || !outBranch(dir)) throw e; opCommit(dir, op, payload); return null; }
}
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function queue(forClaim = false) {   // #7579: forClaim = a worker is about to claim (go.mjs start): only then does the lockstep pilot cap hide issues; status / claimable keep counting them
  const [issues, pulls] = await Promise.all([
    ghAll('/repos/{repo}/issues?state=open&sort=created&direction=asc'),
    ghAll('/repos/{repo}/pulls?state=open'),
  ]);
  // 29 Sept (Dan: the loop works through EVERY phase by itself): a PR the lander BOUNCED (needs-rebase on the PR or its
  // issue) is not "in review" - it waits for a session. Before this, a bounced PR was skipped forever and the loop
  // jumped phases (#110 sat while a worker took G19b).
  const bounced = new Set(issues.filter((i) => i.labels.some((x) => x.name === 'needs-rebase')).map((i) => i.number));
  // ...but a PR labelled `land` is queued again (a session re-handed it in): it is in review, whatever its issue says
  // (29 Sept 03:00Z: #110's issue kept `needs-rebase`, so 10 workers in a row re-claimed and re-queued PR #117).
  const isBounced = (p) => !p.labels.some((x) => x.name === 'land')
    && (p.labels.some((x) => x.name === 'needs-rebase') || bounced.has(Number((p.head.ref.match(/^work\/(\d+)-/) || [])[1])));
  const inReview = new Set(pulls.filter((p) => !isBounced(p)).map((p) => p.head.ref));
  inReview.rebase = new Set(pulls.filter(isBounced).map((p) => p.head.ref));
  const lab = (i, l) => i.labels.some((x) => x.name === l);
  // #100: a brain worker runs in the Linux sandbox VM (no Java referee, no Windows, no real GPU): it skips issues
  // labelled needs-pc / pc-gpu instead of claiming them and ending with nothing done (28 Sept 19:25Z: #24, #11)
  const vm = process.env.MCLITE_BRAIN === '1';
  // #1496: issues labelled `opus` belong to the Opus pool (a reserved account with pool=opus in roles.json): only those
  // workers claim them and they claim nothing else (Dan, 1 Oct: Opus only for the pertinent issues, the rest Sonnet)
  let pool = ''; try { pool = ((JSON.parse(readFileSync(join(ROOT, 'tools', 'brain', 'roles.json'), 'utf8')).accounts || []).find((a) => a.name === process.env.MCLITE_RUN_ACCOUNT) || {}).pool || ''; } catch {}
  const list = issues.filter((i) => !i.pull_request && !lab(i, 'blocked') && !lab(i, 'ask-dan') && !lab(i, 'tracking') && !lab(i, 'env-fault') && !lab(i, 'bus') && lab(i, 'opus') === (pool === 'opus')
    && !(vm && (lab(i, 'needs-pc') || lab(i, 'pc-gpu') || lab(i, 'needs-java'))));
  // DEPENDENCIES (Dan, 29 Sept: "no session does any part that presupposes a different part that isn't done"): an issue
  // whose body says `Depends on: #12, #34` waits until those are closed. `go.mjs depends` writes the line.
  const openNums = new Set(issues.filter((i) => !i.pull_request).map((i) => i.number));
  const deps = (i) => [...((i.body || '').matchAll(/^Depends on:\s*(.+)$/gim))].flatMap((m) => [...m[1].matchAll(/#(\d+)/g)].map((x) => Number(x[1])));
  for (let k = list.length - 1; k >= 0; k--) if (deps(list[k]).some((d) => openNums.has(d))) list.splice(k, 1);
  // GATES (Dan, 30 Sept: "we dont move on until its perfect"): an open `gate` issue holds the queue to the gated phases
  // #3948 PHASE LANE: the one lane worker (MCLITE_LANE=phase) sees only smart phase candidates; passGate (roles.json) lifts the gate for it alone
  const lane = process.env.MCLITE_LANE === 'phase';
  let passGate = false; try { passGate = !!JSON.parse(readFileSync(join(ROOT, 'tools', 'brain', 'roles.json'), 'utf8')).fill.phaseLane.passGate; } catch {}
  if (lane) list.splice(0, list.length, ...laneFilter(list));
  const gated = new Set(lane && passGate ? list : gateFilter(list, issues));
  for (const i of list) if (lab(i, 'needs-rebase')) gated.add(i);   // #4589: a bounced PR is finished work: the gate never holds its rebase
  for (let k = list.length - 1; k >= 0; k--) if (!gated.has(list[k])) list.splice(k, 1);
  const ms = (i) => (i.milestone ? i.milestone.title : 'zz');
  // #4589: a bounced (needs-rebase) issue leads every milestone. Then Track G phase order (Dan, 28 Sept); severe / dan only reorder WITHIN a milestone - a severe
  // label once put stale harness bugs ahead of the infrastructure milestone
  list.sort((a, b) => ms(a).localeCompare(ms(b), 'en', { numeric: true })
    || (lab(b, 'severe') - lab(a, 'severe')) || (lab(b, 'dan') - lab(a, 'dan')) || a.number - b.number);
  // #5039 (Dan, 11 Oct: "one worker can have the next worker work on the dependency if it's pertinent"): an issue another open issue waits on goes first
  // (inside the needs-rebase lead below), so the worker that records `Depends on: #M` is followed by one that builds #M - M is claimable only if it is itself unblocked.
  const wanted = new Set(issues.filter((i) => !i.pull_request).flatMap(deps));
  list.sort((a, b) => wanted.has(b.number) - wanted.has(a.number));
  // 11 Oct (Dan: "divert any two of the workers to the lockstep"): lockstep issues lead for the next (cap - busy) claims, so two workers at a time are on it and the rest are not
  let pilots = null;
  if (list.some(isLockstep)) {
    let cap = 2, pilotCap = 0; try { const f = JSON.parse(readFileSync(join(ROOT, 'tools', 'brain', 'roles.json'), 'utf8')).fill; cap = Number(f.lockstepWorkers); if (!Number.isFinite(cap)) cap = 2; pilotCap = f.lockstepPilotCap === 'auto' ? capacityState({ fill: f }, Date.now()).slots : Number(f.lockstepPilotCap) || 0; } catch {}
    WORKREFS = WORKREFS || (await gh('GET', '/repos/{repo}/git/matching-refs/heads/work/')) || [];
    // #7579: busy = lockstep branches HELD right now (not every work/ ref: ~70 released ones made the cap a no-op); pilotCap bounds the real-server pilots to the VM's slots.
    // An explicit --issue (Dan / the commander) is never hidden; an unreadable GraphQL answer falls back to no cap rather than to an empty queue.
    const held = await heldWorkRefs(inReview);
    pilots = held ? { held: list.filter((i) => isLockstep(i) && held.some((r) => r.startsWith('work/' + i.number + '-') && !inReview.has(r))).length, cap: pilotCap } : null;
    list.splice(0, list.length, ...lockstepFront(list, held || [], inReview, cap, forClaim && held && !opt('--issue') ? pilotCap : 0));
  }
  list.sort((a, b) => lab(b, 'needs-rebase') - lab(a, 'needs-rebase'));   // stable: keeps the order above inside each group
  return { list, inReview, pulls, pilots, gate: handGate(issues) || (phaseOpen(issues).length ? { number: 0, title: 'computed', computed: phaseOpen(issues).length } : undefined) };
}
// #7579: every work/ branch with its head commit in ONE GraphQL read (100 a page), reduced to the HELD ones by phaselane.heldRefs. null = unreadable.
async function heldWorkRefs(inReview) {
  try {
    const [owner, name] = REPO.split('/'); const nodes = []; let after = '';
    for (let page = 0; page < 10; page++) {
      const q = `query{repository(owner:"${owner}",name:"${name}"){refs(refPrefix:"refs/heads/work/",first:100${after}){pageInfo{hasNextPage endCursor}nodes{name target{...on Commit{committedDate message}}}}}}`;
      const r = await gh('POST', '/graphql', { query: q }), refs = r && r.data && r.data.repository && r.data.repository.refs;
      if (!refs) return null;
      nodes.push(...refs.nodes);
      if (!refs.pageInfo.hasNextPage) return heldRefs(nodes, inReview, STALE_H);
      after = `,after:"${refs.pageInfo.endCursor}"`;
    }
    return null;
  } catch { return null; }
}
const branchOf = (i) => `work/${i.number}-${slug(i.title)}`;

// 30 Sept (API quota): claim() fetched master and the issue's refs for EVERY issue it walked past - a start that walked
// 40 held issues spent 80+ calls. Both are read once per process now; a stale view only loses a race, which the
// fast-forward-only ref writes below already handle.
let MASTER = null, WORKREFS = null;
async function claim(issue, inReview) {
  if (!opt('--issue') && issue.labels.some((l) => /^(red-check|needs-rebase)$/.test(l.name))) {   // #4998: "already passes, no code change" x3 = not work
    const cs = (await gh('GET', `/repos/{repo}/issues/${issue.number}/comments?per_page=100`).catch(() => [])) || [];
    if (stuckByHandoffs(cs)) { await gh('POST', `/repos/{repo}/issues/${issue.number}/labels`, { labels: ['blocked'] }).catch(() => {}); console.log(`#${issue.number}: its last hand-offs all say it already passes - labelled blocked, not claimed.`); return null; }
  }
  const master = MASTER || (MASTER = (await gh('GET', '/repos/{repo}/git/ref/heads/master')).object.sha);
  WORKREFS = WORKREFS || (await gh('GET', '/repos/{repo}/git/matching-refs/heads/work/')) || [];
  const existing = WORKREFS.filter((r) => r.ref.startsWith(`refs/heads/work/${issue.number}-`));
  if (existing.length) {
    const ref = existing[0].ref.replace('refs/heads/', '');
    if (inReview.has(ref)) return null;                                     // waiting on the lander
    const head = await gh('GET', `/repos/{repo}/commits/${existing[0].object.sha}`);
    const age = (Date.now() - Date.parse(head.commit.committer.date)) / 36e5;
    // a hand-off without --finished ends with a `handoff: released` commit: free at once, not after STALE_H (28 Sept:
    // blocked passes left ~25 claims nobody worked, and the loop found nothing to claim)
    // a bounced PR's branch is free - unless another session just took it (a fresh `takeover:` commit): 29 Sept 04-06Z
    // five workers kept taking #165 from each other and every push was refused
    const bouncedFree = inReview.rebase && inReview.rebase.has(ref) && !/^takeover:/.test(head.commit.message);
    if (isHeld({ age, message: head.commit.message, bouncedFree }, STALE_H)) return null;   // someone is on it
    // #6416: exclusive takeover. Another run's fresh worker marker on the issue = held; then one atomic lock ref per (issue, stale head, 10-min bucket): 422 = someone holds it.
    if (!opt('--issue')) {
      const cs = (await gh('GET', `/repos/{repo}/issues/${issue.number}/comments?per_page=100&sort=created&direction=desc`).catch(() => [])) || [];
      if (heldByComment(cs, process.env.GITHUB_RUN_ID)) return null;
    }
    try { await gh('POST', '/repos/{repo}/git/refs', { ref: claimKey(issue.number, head.sha), sha: head.sha }); }
    catch (e) { if (e.status === 422) return null; if (!proxyBlocked(e)) throw e; }
    // takeover: an empty commit on top, fast-forward only. A second racer's update is not a fast-forward -> 422.
    let c;
    try { c = await gh('POST', '/repos/{repo}/git/commits', { message: `takeover: stale for ${age.toFixed(1)} h`,
      tree: head.commit.tree.sha, parents: [head.sha] }); }
    catch (e) {
      // cloud: the proxy refuses API writes (28 Sept: this path had no relay fallback, so a cloud start died on the
      // first stale claim). Bring the stale work into the session's branch; the relay's claim op then fast-forwards
      // work/... to it, which only succeeds while nobody else moved it (the same fast-forward-only race as above).
      if (!proxyBlocked(e) || !outBranch(ROOT)) throw e;
      git(['fetch', '-q', 'origin', ref], ROOT, true);
      try { git([...ID, 'merge', '-q', '--no-edit', 'FETCH_HEAD'], ROOT); } catch { try { git(['merge', '--abort'], ROOT); } catch {} return null; }
      opCommit(ROOT, 'claim', { issue: issue.number, ref });
      return { ref, resumed: true, relayed: true };
    }
    try { await gh('PATCH', `/repos/{repo}/git/refs/heads/${ref}`, { sha: c.sha, force: false }); return { ref, resumed: true }; }
    catch { return null; }
  }
  const ref = branchOf(issue);
  try { await gh('POST', '/repos/{repo}/git/refs', { ref: `refs/heads/${ref}`, sha: master }); return { ref, resumed: false }; }
  catch (e) {
    if (proxyBlocked(e) && outBranch(ROOT)) {           // cloud: optimistic claim through the relay
      git(['fetch', '-q', 'origin', 'master'], ROOT, true);
      try { git(['merge', '-q', '--ff-only', 'FETCH_HEAD'], ROOT); } catch {}
      opCommit(ROOT, 'claim', { issue: issue.number, ref });
      return { ref, resumed: false, relayed: true };
    }
    if (e.status === 422) { if (process.env.GO_DEBUG) console.log('claim', ref, e.message); return null; }
    throw e;
  }
}

// assets/ is generated once per clone (~1.5-2.5 min). A MARKER says it finished, not the folder's existence: a Cowork
// call is cut off at 3 min, so `start --loop` generating N workspaces in one call died every time, and the half-made
// assets/ it left passed for a whole one on the next start (28 Sept, #19's workspace). --loop now leaves generation
// to each worker's own call (`go.mjs prep --dir`), one workspace per call.
export const ASSETS_OK = (dir) => join(dir, '.git', 'mclite-assets-ok');
// #1821 (2 Oct): runners 1,2,3,4,7 kept the marker but lost assets/, jars/ and .mcdata, so no worker's build could ever
// run (bake-geometry ENOENT). The marker only counts while the file the build ends with is still there.
export const ASSETS_DONE = (dir) => existsSync(ASSETS_OK(dir)) && existsSync(join(dir, 'assets', 'block-geometry.meta.json'));
function prepDir(dir) {
  if (ASSETS_DONE(dir)) return;
  rmSync(ASSETS_OK(dir), { force: true });
  console.log(`generating assets/ for ${dir} (~2 min, once)…`);
  rmSync(join(dir, 'assets'), { recursive: true, force: true });
  const need = ['1.18.2', '1.13.2'].filter((v) => !existsSync(join(dir, 'jars', v, v + '.jar')) && !existsSync(join(dir, 'jars', v + '.jar')));
  // #1706: a fresh runner checkout has no jars/.mcdata/.decomp (DATA links only come from the synced ROOT, empty on runners): fetch them from the store
  if (need.length || !existsSync(join(dir, '.mcdata'))) { try { execFileSync('node', ['tools/cloud/bootstrap.mjs', '--no-suite', '--no-build'], { cwd: dir, stdio: 'inherit' }); } catch { /* the warning below says what is missing */ } need.splice(0, need.length, ...need.filter((v) => !existsSync(join(dir, 'jars', v, v + '.jar')) && !existsSync(join(dir, 'jars', v + '.jar')))); }
  if (need.length) console.log(`⚠ ${dir}/jars lacks ${need.join(', ')}.jar - the build falls back to MCLITE_JARS / mclite.config.json / ~/.minecraft/versions; with none, asset-dependent checks SKIP (strict: MCLITE_TESTER=1 makes that a failure). Jars are copied from the main folder's jars/ (DATA symlinks).`);
  execFileSync('node', ['tools/suite.mjs', '--fast', '--to', 'build'], { cwd: dir, stdio: 'ignore' });
  if (!existsSync(join(dir, 'assets', 'block-geometry.meta.json'))) throw new Error(`assets/ was not generated in ${dir}`);
  writeFileSync(ASSETS_OK(dir), new Date().toISOString());
  console.log('assets/ ready');
}

const freeGB = (p) => { try { const f = statfsSync(p); return (f.bavail * f.bsize) / 2 ** 30; } catch { return -1; } };
export function coworkBase(free = freeGB) {
  const tmp = `/tmp/mc-${process.getuid ? process.getuid() : 'x'}`, home = join(process.env.HOME || '/tmp', 'mc-work');
  return free(process.env.HOME || '/tmp') > free('/tmp') ? home : tmp;
}

function workspace(ref, gen = true) {
  const w = where();
  if (w === 'cloud') {                                   // claude.ai/code: the checkout we are in is the workspace
    if (!outBranch(ROOT)) {
      git(['fetch', '-q', 'origin', ref], ROOT, true); git(['checkout', '-q', '-B', ref, 'FETCH_HEAD'], ROOT);
      // 29 Sept 03:21Z: an OLD issue branch (made before tools/brain existed) was checked out over the runner's
      // checkout, so brain.yml's own launch.mjs vanished and every worker died. Bring the branch up to master first.
      git(['fetch', '-q', 'origin', 'master'], ROOT, true);
      try { git(['-c', 'user.name=mclite brain', '-c', 'user.email=brain@mclite.local', 'merge', '-q', '--no-edit', 'FETCH_HEAD'], ROOT); }
      catch { try { git(['merge', '--abort'], ROOT); } catch {} console.log('▶ this branch CONFLICTS with master: first `git merge origin/master` and resolve it.'); }
    }
    writeFileSync(join(ROOT, '.git', 'mclite-claim'), ref);
    // 29 Sept: brain workers in the VM died here - bootstrap ran the whole --fast suite (any red = no worker), and the
    // checkout never got its generated assets/, so every worker's first build failed. Data only, then build assets.
    if (!existsSync(join(ROOT, '.mcdata'))) execFileSync('node', ['tools/cloud/bootstrap.mjs', '--no-suite'], { cwd: ROOT, stdio: 'inherit' });
    if (gen) prepDir(ROOT);
    return ROOT;
  }
  // Cowork / Windows: a private clone, never the synced folder. Data folders are links into the synced copy.
  // Cowork: /tmp (its own disk - /sessions is ONE small disk every session shares), one folder per Linux user: each
  // Cowork session is its own user, and a /tmp/mc made by one session is read-only to the next
  // 28 Sept 13:37Z-17:20Z: /tmp is on the VM's 9.6 GB root and a clone left there by one session can't be deleted by
  // the next (another Linux user), so every pass leaked ~250 MB until the disk guard stopped the loop at 1.7 GB free.
  // Cowork now uses whichever of /tmp and this session's own $HOME (the /sessions disk) has more room.
  const base = w === 'cowork' ? coworkBase() : join(process.env.LOCALAPPDATA || process.env.TEMP, 'mclite-work');
  const dir = join(base, ref.replace(/\//g, '_'));
  if (!existsSync(join(dir, '.git'))) {
    mkdirSync(base, { recursive: true });
    git(['clone', '-q', '--shared', ROOT, dir]);
    git(['remote', 'set-url', 'origin', `https://github.com/${REPO}.git`], dir);
    for (const d of DATA) if (existsSync(join(ROOT, d)) && !existsSync(join(dir, d))) symlinkSync(join(ROOT, d), join(dir, d), 'junction');
    mkdirSync(join(dir, 'dist'), { recursive: true });
  }
  git(['fetch', '-q', 'origin', ref], dir, true); git(['checkout', '-q', '-B', ref, 'FETCH_HEAD'], dir);
  writeFileSync(join(dir, '.git', 'mclite-claim'), ref);
  // a previous session's unfinished work, saved by the automatic autosave (tools/infra/gate.mjs): put it back
  try {
    git(['fetch', '-q', 'origin', `wip/${ref}`], dir, true);
    git(['checkout', 'FETCH_HEAD', '--', '.'], dir);
    console.log(`▶ restored wip/${ref}: the last session's UNCOMMITTED work is in your working tree - read \`git diff HEAD\` first`);
  } catch { /* no autosave for this issue */ }
  if (gen) prepDir(dir);                                  // --loop: each worker runs `go.mjs prep --dir` itself
  return dir;
}

async function brief(issue, c, dir) {
  const comments = await ghAll(`/repos/{repo}/issues/${issue.number}/comments`);
  const handoffs = comments.filter((x) => x.body.startsWith('**Hand-off**')).slice(-2);
  console.log(`\n## YOUR ISSUE  #${issue.number}  ${issue.title}   [${issue.milestone ? issue.milestone.title : 'no milestone'}]`);
  console.log(`branch ${c.ref}${c.resumed ? '  (RESUMING earlier work - read the hand-off)' : ''}\nworkspace ${dir}\n`);
  if (/whole phase/i.test(issue.title)) console.log(`▶ THIS ISSUE IS A WHOLE PHASE. Your job is ONLY to split it - no game code in this issue.
  MUCH OF THIS PHASE IS ALREADY BUILT: the text below marks what is done (✅) and what is still owed (◐/⚠), and src/ + the
  core checks show the rest. Split ONLY what is still owed - never re-port what exists. Read .decomp/ for the owed parts
  (tools/port/deps.mjs if present lists a class's dependencies). Create one issue per
  PORT UNIT, in dependency order (substrate first), each small enough for one session:
    node tools/go.mjs newissue --parent ${issue.number} --title "<phase id><letter>: <unit>" --body "<the .decomp classes to translate, the src/ file it lands in, the check that proves same outputs as vanilla>"
  Game LOGIC is ported class by class from .decomp; rendering may be hand-written. Every unit that builds on another
  unit gets a body line 'Depends on: #<that unit>' (the queue holds it until that one is closed). Then:
    node tools/go.mjs splitdone --issue ${issue.number}
  (labels this issue 'tracking' so the loop skips it, and releases the claim). Then end: the loop takes the units in order.
`);
  console.log(issue.body || '(no body)');
  try {                                                 // a bounced PR: say so, so nobody starts over
    const pr = (await gh('GET', `/repos/{repo}/pulls?state=open&head=${(await gh('GET', '/repos/{repo}')).owner.login}:${encodeURIComponent(c.ref)}`))[0];
    if (pr) {
      console.log(`\n▶ This branch has PR #${pr.number}, bounced by the lander. FIX THE REASON BELOW (re-queuing without a change bounces again), merge origin/master, then done --finished (it re-queues the same PR).`);
      const why = (await gh('GET', `/repos/{repo}/issues/${pr.number}/comments`)).filter((x) => x.body.startsWith('**Lander:**')).at(-1);
      if (why) console.log(why.body.slice(0, 900));
    }
  } catch {}
  for (const h of handoffs) console.log('\n' + h.body);
  console.log(`\nFinish: node tools/go.mjs done --dir ${dir} --msg "…" --try "…" [--finished]`);
}

async function start() {
  if (!token() && !CLOUD) die('no GitHub token. Dan: copy the token and double-click SAVE-GITHUB-TOKEN.cmd (cloud: set GH_TOKEN in the environment).');
  if (existsSync(join(ROOT, 'docs', 'INFRA-V2.md')) && !flag('--issue') && !flag('--loop'))
    console.log('▶ docs/INFRA-V2.md is unfinished: it is issue #1 until it is empty (RUN.md).');
  const H = process.env.HOME || process.env.USERPROFILE;
  if (H && flag('--loop')) writeFileSync(join(H, '.mclite-who'), 'loop');      // the orchestrator is `loop` on the bus
  const n = flag('--loop') ? await workers() : 1;
  if (n === 0) { console.log('WAVE 0: usage too high for workers.'); return; }
  const { list, inReview } = await queue(true);
  // --issue: fetch that one issue directly - the list endpoint can lag a just-created issue by a few seconds
  // SPREAD (Dan, 29 Sept: "they should all get different jobs on the phases"): phases someone already holds an issue
  // in go to the back, so parallel workers land in DIFFERENT phases (fewer conflicts on the same files), each still
  // taking the earliest free issue of its phase. A held phase is still worked when every phase is held.
  let spread = list;
  if (!opt('--issue')) {
    const refs = (await gh('GET', '/repos/{repo}/git/matching-refs/heads/work/').catch(() => [])) || [];
    const held = new Set(refs.map((r) => Number((r.ref.match(/^refs\/heads\/work\/(\d+)-/) || [])[1])));
    const ms = (i) => (i.milestone ? i.milestone.number : 0);
    const busy = new Set(list.filter((i) => held.has(i.number) && !inReview.has(branchOf(i))).map(ms));
    spread = [...list.filter((i) => !busy.has(ms(i))), ...list.filter((i) => busy.has(ms(i)))];
  }
  const want = opt('--issue') ? [await gh('GET', `/repos/{repo}/issues/${opt('--issue')}`)] : spread;
  const got = [];
  for (const i of want) { if (got.length >= n) break; const c = await claim(i, inReview); if (c) got.push([i, c]); }
  if (!got.length && process.env.MCLITE_BRAIN === '1' && !opt('--issue')) {
    // #5045 (Dan, 11 Oct: "the queue should be deepenable automatically by workers calling a commander ... no boondoggle expansion"): a headless worker that finds nothing mails the
    // commander ONCE per 45 min per workspace; the commander prompt (roles.json) deepens the queue with REAL units only and answers "queue is deep enough" when it cannot.
    const f = join(ROOT, '.git', 'mclite-queuethin.json');
    let last = 0; try { last = JSON.parse(readFileSync(f, 'utf8')).at || 0; } catch {}
    if (Date.now() - last > 45 * 60e3) {
      try { writeFileSync(f, JSON.stringify({ at: Date.now() })); } catch {}
      const msg = `to: commander\nfrom: ${whoAmI(ROOT)}\n\nqueue-thin: a worker found nothing claimable (open issues are taken, in review, blocked or waiting on a dependency). Deepen the queue with REAL units only (see your queue-thin rules).`;
      await write(ROOT, 'say', { body: msg }, async () => gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body: msg })).catch(() => {});
    }
  }
  if (!got.length) die('nothing to claim: every open issue is taken, in review or blocked. Tell Dan the backlog is empty.');
  const role = flag('--loop') ? 'loop-worker' : where() === 'cloud' ? 'cloud' : 'loop-worker';
  for (const [i, c] of got) {
    const d = workspace(c.ref, !flag('--loop')); writeFileSync(join(d, '.git', 'mclite-role'), role); await brief(i, c, d);
    if (flag('--loop')) console.log(`FIRST, in the worker's own command: node tools/go.mjs prep --dir ${d}`);
    await inbox(d);
  }
  if (flag('--loop')) console.log(`\nWAVE ${got.length}: one Workflow, one Sonnet-5-medium worker per issue above; each gets its FIRST (prep) line, RUN.md steps 2-4 and its workspace.`);
}

/** #105: a refused push printed "someone took this issue over" for EVERY error (28 Sept: 3 finished fixes stranded in
 *  brain-runner clones by a read-only credential). Only a remote ref that moved to commits this clone lacks is a
 *  takeover. Either way the work is first saved to rescue/<ref>-<time> when possible, so it is never lost in a clone. */
export function pushVerdict(moved, why) {
  return moved ? `push to the issue branch refused: someone took this issue over (its branch moved). Stop; do not force. git said: ${why}`
    : `push refused, and NOT a takeover (the branch did not move) - a credential/network problem. git said: ${why}`;
}
function pushFailed(dir, ref, e) {
  const why = String((e && (e.stderr || e.message)) || e).trim().split('\n').filter(Boolean).slice(-2).join(' | ').slice(0, 300);
  let moved = false;
  try { git(['fetch', '-q', 'origin', ref], dir, true); try { git(['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD'], dir); } catch { moved = true; } } catch { /* no remote branch: nothing moved */ }
  const rescue = `rescue/${ref.replace(/^work\//, '')}-${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, '')}`;
  let saved = '';
  try { git(['push', '-q', 'origin', `HEAD:refs/heads/${rescue}`], dir, true); saved = ` Your commits were saved to branch ${rescue}: tell the commander (go.mjs say --to commander).`; }
  catch { saved = ` Your commits are ONLY in ${dir} (HEAD ${git(['rev-parse', '--short', 'HEAD'], dir)}).`; }
  die(pushVerdict(moved, why) + saved);
}

async function done() {
  const dir = opt('--dir') || ROOT;
  const ref = existsSync(join(dir, '.git', 'mclite-claim')) ? readFileSync(join(dir, '.git', 'mclite-claim'), 'utf8').trim() : git(['branch', '--show-current'], dir);
  const num = (ref.match(/^work\/(\d+)-/) || [])[1];
  if (!num) die(`${dir} is not on a work/<issue> branch`);
  const msg = opt('--msg') || die('--msg is required'), tryLine = opt('--try') || '';
  // #4646: --part lands the tested work like --finished but the lander keeps the issue open and posts the owed list
  const owed = flag('--part') ? (opt('--owed') || die('--part needs --owed "<what is left>"')) : '';
  if (owed && !flag('--finished')) argv.push('--finished');
  const closes = owed ? `${PART_MARK}\nPart of #${num}. **Owed (the issue stays open):** ${owed}` : `Closes #${num}`;
  execFileSync('node', ['build.mjs'], { cwd: dir, stdio: 'inherit' });
  // build.mjs rewrites src/19_data.gen.js (a build output; a Linux build deflates it to different bytes): never
  // hand that in unless the data pipeline itself changed, or every PR carries a spurious diff
  try { git(['checkout', '--', 'src/19_data.gen.js'], dir); } catch {}
  git(['add', '-A'], dir);
  // a fresh VM or container has no git identity; commits are attributed to the session, never silently dropped
  const who = (() => { try { return git(['config', 'user.email'], dir) ? [] : null; } catch { return null; } })() ||
    ['-c', 'user.name=MC-Lite session', '-c', 'user.email=session@mclite.invalid'];
  if (git(['status', '--porcelain'], dir)) git([...who, 'commit', '-q', '-m', `#${num}: ${msg}`], dir);
  if (git(['rev-list', '--count', `origin/master..HEAD`], dir) === '0') {
    if (flag('--already-fixed')) {   // 3 Oct: workers looped on issues whose fix was already on master - they had no way to close them
      await gh('POST', `/repos/{repo}/issues/${num}/comments`, { body: `**Already fixed on master** (closed by a worker via \`done --already-fixed\`): ${msg}` });
      await gh('PATCH', `/repos/{repo}/issues/${num}`, { state: 'closed', state_reason: 'completed' });
      console.log(`closed #${num} as already fixed`); return;
    }
    die('nothing to hand in: this branch has no commits beyond master. If the fix is ALREADY on master (you verified it), close the issue: done --already-fixed --msg "<which commit/landing fixed it and what you ran>"');
  }
  if (flag('--finished')) {
    // the LANDER'S OWN anti-vacuity test, run here before the PR (29 Sept: #172 #175 #219 bounced on it again and again,
    // a full lander cycle each): every check this branch ADDS must show "<n> breaks caught" in its suite row
    git(['fetch', '-q', 'origin', 'master'], dir, true);
    const added = git(['diff', '--name-only', '--diff-filter=A', 'FETCH_HEAD...HEAD', '--', 'tools/stages.d/'], dir).split('\n').filter(Boolean);
    const ids = added.flatMap((f) => { try { return JSON.parse(readFileSync(join(dir, f), 'utf8')).map((e) => e.id); } catch { return []; } });
    if (ids.length) {
      const v = spawnSync('node', ['tools/suite.mjs', '--fast', '--only', ids.join(',')], { cwd: dir, encoding: 'utf8', maxBuffer: 1 << 26, env: { ...process.env, MCLITE_PRESET: 'medium' } });
      const vacuous = ids.filter((id) => { const line = ((v.stdout || '').match(new RegExp(`^.*\\s${id}\\s.*$`, 'm')) || [''])[0];
        return !/[1-9]\d*\s+(deliberate\s+)?breaks?\s+caught/i.test(line) && !/·/.test(line.slice(0, 3)); });
      if (vacuous.length) die(`anti-vacuity (the lander's own test, run here first - nothing was pushed): ${vacuous.join(', ')} never shows it can fail. Each must break its own data and PRINT "<n> breaks caught" so its suite row shows it. Fix, then done --finished again.`);
    }
    // #6524: the golden a referee check reads lives on THIS machine; the lander only has the store branch's golden/. Without this the lander sees
    // "SKIP (golden not generated)", no "<n> breaks caught", and bounces the PR as vacuous (12 Oct: 36 of 68 bounces).
    const refs = git(['diff', '--name-only', '--diff-filter=AM', 'FETCH_HEAD...HEAD', '--', 'tools/referee/'], dir).split('\n').filter((f) => /\.mjs$/.test(f));
    const gn = [...new Set(refs.flatMap((f) => { try { return goldenNames(readFileSync(join(dir, f), 'utf8')); } catch { return []; } }))];
    if (gn.length) {
      const r = await publishGolden(gn, gh);
      console.log(`golden for the lander (store branch): ${r.pushed.length} pushed, ${r.same.length} already there${r.missing.length ? `, NOT FOUND on this machine: ${r.missing.join(', ')}` : ''}`);
      if (r.missing.length) die(`the referee golden ${r.missing.join(', ')} is read by a check you changed but is not in ${process.env.MCLITE_REFEREE_DIR || '~/.mclite-referee/1.18.2'}/golden - generate it (node tools/referee/run<name>.mjs) first; the lander would SKIP the check and bounce the PR as vacuous.`);
    }
  }
  if (!flag('--finished')) git([...who, 'commit', '-q', '--allow-empty', '-m', 'handoff: released (not finished; the next session may claim it at once)'], dir);
  try { git(['push', '-q', 'origin', `HEAD:${outBranch(dir) || ref}`], dir, true); }
  catch (e) { pushFailed(dir, ref, e); }
  const hbody = `**Hand-off** (${new Date().toISOString().slice(0, 16)}Z)\n\n${msg}${tryLine ? `\n\n**Try:** ${tryLine}` : ''}`;
  if (outBranch(dir)) {                                  // cloud: one op does the hand-off, the ref move and the PR
    opCommit(dir, 'handoff', { issue: Number(num), body: hbody });
    opCommit(dir, 'done', { issue: Number(num), ref, finished: flag('--finished'), title: `#${num}: ${msg.split('\n')[0].slice(0, 90)}`,
      body: `${closes}\n\n${msg}\n\n**Try in the game:** ${tryLine || '(nothing visible)'}` });
    console.log(flag('--finished') ? 'OK  handed to the lander through the relay.' : `OK  pushed; the next session resumes ${ref}.`);
    return inbox(dir);
  }
  await gh('POST', `/repos/{repo}/issues/${num}/comments`, { body: hbody });
  if (flag('--finished')) {
    // a bounced PR (conflict / red) is still open: hand the fixed branch back to the SAME PR
    const owner = (await gh('GET', '/repos/{repo}')).owner.login;
    const open = await gh('GET', `/repos/{repo}/pulls?state=open&head=${owner}:${encodeURIComponent(ref)}`);
    const pr = open[0] || await gh('POST', '/repos/{repo}/pulls', { title: `#${num}: ${msg.split('\n')[0].slice(0, 90)}`, head: ref, base: 'master',
      body: `${closes}\n\n${msg}\n\n**Try in the game:** ${tryLine || '(nothing visible)'}` });
    await gh('POST', `/repos/{repo}/issues/${pr.number}/labels`, { labels: ['land'] });
    try { await gh('DELETE', `/repos/{repo}/issues/${num}/labels/needs-rebase`); } catch { /* not labelled */ }
    console.log(`OK  PR #${pr.number} queued for the lander.`);
  } else {
    console.log(`OK  pushed ${ref}; the next session resumes it.`);
    // #4335: #4319 was handed off unfinished 3 times (a duplicate nobody could fix); the 3rd unfinished hand-off takes it out of the queue
    const n = ((await gh('GET', `/repos/{repo}/issues/${num}/comments?per_page=100`).catch(() => [])) || []).filter((c) => c.body.startsWith('**Hand-off**')).length;
    if (n >= 3) { await gh('POST', `/repos/{repo}/issues/${num}/labels`, { labels: ['blocked'] }); console.log(`#${num}: ${n} hand-offs without a finish - labelled blocked (no-claim) until the commander looks.`); }
  }
  await inbox(dir);
}

async function check() {
  const dir = opt('--dir') || ROOT;
  const ref = readFileSync(join(dir, '.git', 'mclite-claim'), 'utf8').trim();
  try { git(['fetch', '-q', 'origin', ref], dir, true); }
  catch { console.log(`PENDING  ${ref} does not exist yet (the relay creates it from your claim); carry on.`); return inbox(dir); }
  const mine = (() => { try { git(['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD'], dir); return true; } catch { return false; } })();
  const num = (ref.match(/^work\/(\d+)-/) || [])[1];
  const closed = num && (await gh('GET', `/repos/{repo}/issues/${num}`)).state === 'closed';
  console.log(!mine ? `YIELD  ${ref} moved without you: another session took it over. Stop this issue.`
    : closed ? `YIELD  issue #${num} was closed (see its last comment). Stop; do not hand it in.` : `OWNER  ${ref}`);
  await inbox(dir);
}

// ---- the session bus (Dan, 28 Sept: "sessions both cloud and local ... and the commander sessions too" must talk
// frequently and easily). One GitHub issue labelled `bus`; one comment = one message; first line `to: <who>`.
// Every kind of session reaches GitHub, so cloud, loop, workers and commander sessions all share it. Reading happens
// at natural checkpoints (start, check, done, inbox) - never in a wait loop.
function whoAmI(dir) {
  if (process.env.MCLITE_WHO) return process.env.MCLITE_WHO;                         // commander | loop | cloud
  const whoF = join(process.env.HOME || process.env.USERPROFILE || '.', '.mclite-who');  // written by start, per session user
  if (!existsSync(join(dir || ROOT, '.git', 'mclite-claim')) && existsSync(whoF)) return readFileSync(whoF, 'utf8').trim();
  const f = join(dir || ROOT, '.git', 'mclite-claim');
  return existsSync(f) ? readFileSync(f, 'utf8').trim() : 'commander';
}
/** Every address this session answers to: branch, #N, role file, the session's role (tools/infra/bus.mjs). */
function names(dir) {
  const rf = join(dir || ROOT, '.git', 'mclite-role');
  const whoF = join(process.env.HOME || process.env.USERPROFILE || '.', '.mclite-who');
  return addresses({ me: whoAmI(dir), role: existsSync(rf) ? readFileSync(rf, 'utf8').trim() : null,
    sess: process.env.MCLITE_WHO || (existsSync(whoF) ? readFileSync(whoF, 'utf8').trim() : null) });
}
/** Messages to this session that still need ITS answer: addressed to it by name (not `to: all` unless it says
 *  `reply: required`), not a reply themselves, and not yet answered by a comment of ours carrying `re: <id>`. */
// 30 Sept (API quota): the PreToolUse mail hook, the build/test gate and every go.mjs call each re-read the WHOLE bus -
// ~9 calls every 30 s per worker; 10 workers emptied the hourly quota (5000) in 16 min and every session died on 403s.
// The bus is now read INCREMENTALLY into .git/mclite-mail.json (only comments newer than the last read), at most once
// per MAIL_TTL per workspace, shared by the hook, the gate and go.mjs. apibudgetcheck holds it to that.
const MAIL_TTL = 60e3;
async function mailbox(dir) {
  const f = join(dir || ROOT, '.git', 'mclite-mail.json');
  let c = null; try { c = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  const now = Date.now();
  if (c && now - c.at < MAIL_TTL) return c.msgs;
  const busOld = c && now - (c.busAt || 0) < 10 * 60e3;               // re-ask which issue is the bus every 10 min (rotation)
  const bus = busOld ? c.bus : await busIssue(), busAt = busOld ? c.busAt : now;
  const fresh = !c || c.bus !== bus;
  const since = fresh ? now - 2 * 86400e3 : c.at - 5 * 60e3;          // 5-min overlap: a comment landing during the last read
  const got = await ghAll(`/repos/{repo}/issues/${bus}/comments?since=${new Date(since).toISOString()}`);
  const byId = new Map((fresh ? [] : c.msgs).map((m) => [m.id, m]));
  for (const m of got) byId.set(m.id, { id: m.id, body: m.body, created_at: m.created_at });
  const msgs = [...byId.values()].filter((m) => Date.parse(m.created_at) > now - 2 * 86400e3).sort((a, b) => a.id - b.id);
  try { writeFileSync(f, JSON.stringify({ at: now, bus, busAt, msgs })); } catch {}
  return msgs;
}
async function unanswered(dir) {
  const mine = names(dir);
  const all = await mailbox(dir);
  const rf = join(dir || ROOT, '.git', 'mclite-replied');                 // a relayed answer shows up a minute later
  const extra = existsSync(rf) ? readFileSync(rf, 'utf8').split(/\s+/).filter(Boolean) : [];
  return pending(all, mine, extra);
}
/** THE MAIL GATE (Dan, 28 Sept: messages "must be going to them rather than just sitting in an inbox, they must
 *  respond before anything else"). Every go.mjs command except say/reply/inbox stops here while a message waits. */
async function mailGate(dir) {
  const waiting = await unanswered(dir).catch(() => []);
  if (!waiting.length) return;
  for (const c of waiting) console.log(`\n✉ MESSAGE ${c.id} (${c.created_at.slice(5, 16)}Z)\n   ${c.body.replace(/\n+/g, '\n   ')}`);
  console.log(`\nANSWER FIRST - before any other work: node tools/go.mjs reply ${waiting[0].id} "<your answer>"${opt('--dir') ? ` --dir ${opt('--dir')}` : ''}`);
  process.exit(3);
}
async function inbox(dir = opt('--dir') || ROOT, { all = false } = {}) {
  const seenF = join(dir, '.git', 'mclite-bus-seen');
  const seen = existsSync(seenF) ? Number(readFileSync(seenF, 'utf8')) : 0;
  const msgs = (all ? await busComments(1) : await mailbox(dir)).filter((c) => all || c.id > seen);
  const mine = names(dir);
  const forMe = msgs.filter((c) => {
    const to = (field(c.body, 'to') || 'all').toLowerCase();
    return all || to === 'all' || mine.includes(to);  }).slice(-15);
  for (const c of forMe) console.log(`\n✉ ${c.created_at.slice(5, 16)}Z  ${c.body.replace(/\n+/g, '\n   ')}`);
  if (!forMe.length && !all) console.log('✉ no new messages');
  if (msgs.length) writeFileSync(seenF, String(Math.max(seen, ...msgs.map((c) => c.id))));
}
async function reply() {
  const dir = opt('--dir') || ROOT, id = argv[1], text = argv.slice(2).filter((a, i, arr) => !a.startsWith('--') && arr[i - 1] !== '--dir').join(' ');
  if (!/^\d+$/.test(id || '') || !text) die('usage: go.mjs reply <message id> "answer" [--dir <workspace>]');
  const m = await gh('GET', `/repos/{repo}/issues/comments/${id}`);
  const body = `to: ${field(m.body, 'from') || 'all'}\nfrom: ${whoAmI(dir)}\nre: ${id}\n\n${text}`;
  await write(dir, 'reply', { body }, async () => gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body }));
  writeFileSync(join(dir, '.git', 'mclite-replied'), `${existsSync(join(dir, '.git', 'mclite-replied')) ? readFileSync(join(dir, '.git', 'mclite-replied'), 'utf8') : ''} ${id}`);
  for (const f of ['mclite-mailhook.json', 'mclite-gate.json']) try { writeFileSync(join(dir, '.git', f), JSON.stringify({ at: 0, pending: [] })); } catch {}
  console.log(`OK  answered ${id}`);
}
// LOOP-ON.cmd / LOOP-OFF.cmd (#121): the brain's worker count, the same switch as the phone app. No app scheduled
// task, trigger or cron is ever part of this project (Dan, 28 Sept 21:30Z).
async function loop() {
  const T = argv[1] === 'testers';   // #4991: `go.mjs loop testers <n|auto>` = the separate tester switch (repo variable FILL_TESTERS)
  const AC = /^(max|pro)$/i.test(argv[1] || '') ? argv[1].toUpperCase() : null;   // #5045: `go.mjs loop max 8` / `loop pro 2` / `loop max clear` = that account's own worker count (FILL_WORKERS_MAX/PRO)
  const VN = AC ? `FILL_WORKERS_${AC}` : T ? 'FILL_TESTERS' : 'FILL_WORKERS';
  const P = `/repos/{repo}/actions/variables/${VN}`, a = T || AC ? argv[2] : argv[1];
  if (AC && a === 'clear') { await gh('DELETE', P, null, { ok404: true }).catch(() => {}); console.log(`${VN}: cleared (that account follows the universal FILL_WORKERS pool again)`); return; }
  const n = T && a === 'auto' ? 'auto' : a === 'on' ? 5 : a === 'off' ? 0 : /^\d+$/.test(a || '') ? Math.min(10, Number(a)) : null;
  if (n !== null) {
    if (!T && !AC && n === 0 && argv.includes('--resume-when-landed')) {   // #6522: park the current count; the brain restores it when no PR is labelled land
      const cur = (await gh('GET', P, null, { ok404: true }))?.value;
      if (/^[1-9]\d*$/.test(cur || '')) { const rb = { name: 'FILL_RESUME_TO', value: cur }; if ((await gh('PATCH', '/repos/{repo}/actions/variables/FILL_RESUME_TO', rb, { ok404: true })) === null) await gh('POST', '/repos/{repo}/actions/variables', rb); console.log(`FILL_RESUME_TO=${cur}: the brain sets FILL_WORKERS back to ${cur} when no PR is labelled land`); }
    }
    const body = { name: VN, value: String(n) };
    if ((await gh('PATCH', P, body, { ok404: true })) === null) await gh('POST', '/repos/{repo}/actions/variables', body);
    // the brain reacts to bus comments only: 6 Oct the switch was set to 10 and nothing ran for 3h20m. Say it on the bus.
    const msg = T ? `to: log\nfrom: ${whoAmI(ROOT)}\n\ntesters set to ${n}` : AC ? `to: log\nfrom: ${whoAmI(ROOT)}\n\nfill ${AC.toLowerCase()} set to ${n}` : `to: log\nfrom: ${whoAmI(ROOT)}\n\nfill set to ${n}`;
    await write(ROOT, 'say', { body: msg }, async () => gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body: msg }));
  }
  const v = await gh('GET', P, null, { ok404: true });
  console.log(`${AC ? `brain ${AC.toLowerCase()} workers` : T ? 'brain testers' : 'brain workers'}: ${v ? v.value : T ? 'auto' : AC ? 'not set (universal pool)' : 'roles.json decides'} (running sessions finish their issue; the brain tops up on the next bus message)`);
}
async function runner() {                            // #3568: go.mjs runner list | quarantine <name> | restore <name> [--labels gpu,express]
  const { listRunners, quarantine, restore } = await import('./infra/runnerguard.mjs');
  const [sub, name] = argv.slice(1);
  if (sub === 'list') for (const r of await listRunners(gh)) console.log(`${r.name}\t${r.status}${r.busy ? '/busy' : ''}\t${r.labels.join(',')}`);
  else if (sub === 'quarantine' && name) console.log(`OK  ${name}: removed ${(await quarantine(gh, name)).join(',') || 'nothing (already quarantined)'}`);
  else if (sub === 'restore' && name) { const l = (opt('--labels') || 'gpu').split(','); await restore(gh, name, l); console.log(`OK  ${name}: added ${l.join(',')}`); }
  else die('usage: go.mjs runner list | quarantine <name> | restore <name> [--labels gpu,express]');
}
async function say() {
  const dir = opt('--dir') || ROOT, to = opt('--to') || 'all', text = argv.filter((a, i) => i > 0 && !a.startsWith('--') && !['--to', '--dir'].includes(argv[i - 1])).join(' ');
  if (!text) die('usage: go.mjs say [--to all|sessions|commander|fixer|dan|loop|#<issue>|<branch>] "message"  (commander/fixer: the brain wakes one; dan: his phone)');
  const body = `to: ${to}\nfrom: ${whoAmI(dir)}\n\n${text}`;
  await write(dir, 'say', { body }, async () => gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body }));
  console.log(`OK  sent to ${to}`);
}

export async function usage() {
  const f = findUnder(join('_status', 'usage.json'));
  let u = null;                                                        // an empty/corrupt file (a full disk, 28 Sept) = no file
  if (f) try { u = JSON.parse(readFileSync(f, 'utf8')); } catch {}
  if (!u && token()) { const v = await gh('GET', '/repos/{repo}/actions/variables/MCLITE_USAGE', null, { ok404: true }); if (v) u = JSON.parse(v.value); }
  if (!u || !u.accounts) return null;
  const af = findUnder(join('_status', 'active-account.txt'));
  const name = opt('--account') || process.env.MCLITE_ACCOUNT || (af ? readFileSync(af, 'utf8').trim() : 'default');
  const a = u.accounts[name] || Object.values(u.accounts).find((x) => x.email === name);
  return a ? { ...a, account: name, at: u.at, all: Object.fromEntries(Object.entries(u.accounts).map(([k, v]) => [k, v.ok ? `${v.email || ''} week ${v.week?.pct}% 5h ${v.window?.pct}%` : v.why])) } : { ok: false, why: `no usage for account "${name}"` };
}
async function workers() {
  const u = await usage(), L = JSON.parse(readFileSync(join(ROOT, '.claude', 'loop.json'), 'utf8'));
  // the loop's scheduled task fires HOURLY on its own (28 Sept: a scheduled run may not re-arm itself), so the stop
  // time is enforced here: past stop_at (minus its margin) every pass is WAVE 0 and ends at once
  if (!L.enabled || (L.stop_at && Date.now() > Date.parse(L.stop_at) - (L.stop_margin_min || 30) * 60e3)) return 0;
  if (!u || !u.ok) return 2;
  if (u.week.pct + (L.first_cost || 5) > (L.weekly_stop || 95)) return 0;
  return u.window.pct >= 70 ? 2 : 4;
}
async function status() {
  { // #4256: first line, red when either age > 45 min - "healthy" is never judged from a commit COUNT or brain-online
    const R = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8')), ago = (t) => t ? Math.round((Date.now() - t) / 60e3) : null;
    const m = ago(Date.parse((await gh('GET', '/repos/{repo}/commits/master').catch(() => null))?.commit?.committer?.date || ''));
    const rr = (await gh('GET', '/repos/{repo}/actions/workflows/brain.yml/runs?per_page=100').catch(() => null))?.workflow_runs || [];
    const wr = rr.filter((r) => /^brain (worker|tester)/.test(r.display_title || r.name));
    const w = wr.some((r) => r.status !== 'completed') ? 0 : ago(Date.parse((wr[0] || {}).updated_at || ''));
    const run = wr.filter((r) => r.status === 'in_progress').length, want = R.fill.workers;
    const stale = m == null || w == null || m > 45 || w > 45;
    console.log(`${stale ? 'RED ' : ''}last master commit ${m ?? '?'} min ago, last worker run ${w ?? '?'} min ago, fill ${run} running (slot ceiling ${want}; per-account targets below)`);
  }
  const Q0 = await queue(), { list, pulls, gate } = Q0;
  { let h = {}; try { h = JSON.parse(readFileSync(join(process.env.BRAIN_HOME || join(homedir(), '.brain'), 'history.json'), 'utf8')); } catch {}   // #4549: the brain's own choice and why
    if (!h.shape) { const c = (await busComments(3).catch(() => [])).filter((x) => /brain: fill shape:/.test(x.body || '')).pop(); if (c) h.shape = { line: c.body.match(/fill shape:[^\n]*/)[0], at: Date.parse(c.created_at) }; }   // #4610: history.json exists only on the brain VM; elsewhere take the newest line the brain posted to the bus
    console.log(h.shape ? `${h.shape.line} (since ${new Date(h.shape.at).toISOString()})` : 'fill shape: no change logged on this bus yet (the brain posts a line only when the shape changes, and keeps its choice in ~/.brain/history.json on the brain VM; the bus rotates about every 150 comments)'); }
  try {   // #5110: the real per-account fill counts (FILL_WORKERS_<ACCOUNT> x the quiet factor) and what runs on each account right now
    const R = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8')), env = {};
    for (const v of (await gh('GET', '/repos/{repo}/actions/variables'))?.variables || []) if (/^FILL_WORKERS_/.test(v.name)) env[v.name] = v.value;
    const by = {}; for (const r of (await gh('GET', '/repos/{repo}/actions/workflows/brain.yml/runs?per_page=100&status=in_progress'))?.workflow_runs || []) { const mm = /^brain (?:worker|tester) @(\w+)/.exec(r.display_title || r.name || ''); if (mm) by[mm[1]] = (by[mm[1]] || 0) + 1; }
    console.log(acctPlanLine(R, env, Date.now(), by));
  } catch (e) { console.log(`fill per account: unreadable (${String(e.message || e).slice(0, 80)})`); }
  if (gate && gate.computed) console.log(`GATE OPEN: G17/G18 + lockstep not complete (${gate.computed} open) - only bugs and the G17/G18 mob phases are handed out`);
  else if (gate) console.log(`GATE OPEN: #${gate.number} ${gate.title} - only bugs and the G17/G18 mob phases are handed out`);
  { const fq = await freeQueue({ list, inReview: Q0.inReview }); console.log(`queue ${fq.free.length} claimable (${list.length} listed, ${fq.held} held by a running branch or in review) · in review ${pulls.length}`); if (Q0.pilots) console.log(`lockstep pilots: ${Q0.pilots.held} held of ${Q0.pilots.cap || 'no'} cap (each runs a 20-salt pilot on one of the brain VM's real-server slots; a worker past the cap takes other work, #7579)`); }
  for (const i of list.slice(0, 10)) console.log(`  #${i.number} ${i.title}  [${i.milestone ? i.milestone.title : '-'}]`);
  { const R = JSON.parse(readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8')), q = quietState(R, Date.now()), Q = R.fill.quiet;   // #3569
    if (Q) console.log(`fill regime: ${q.active ? 'QUIET (' + Q.factor + 'x)' : 'FULL'} - flips ${q.next ? new Date(q.next).toISOString() : 'never'} (${Q.from}-${Q.to} ${Q.tz})`);
    const C = capacityState(R, Date.now()); if (C.cores) console.log(`capacity now: ${C.cores} cores = ${C.slots} real-server slots${C.window ? ' (weekday window until ' + C.window.to + ' ' + R.fill.capacity.tz + ')' : ''}; lockstep pilot cap ${R.fill.lockstepPilotCap === 'auto' ? C.slots : R.fill.lockstepPilotCap} (#7584)`); }
  try {   // #7520: proven mobs from the proof matrix
    const { buildMatrix } = await import('./mobproof.mjs'), M = buildMatrix();
    const A = await import('./brain/auditledger.mjs'), proven = A.provenSet(), vis = A.pruneVisual(A.readVisual(), proven);
    console.log(`proven ${M.proven}/${M.roster} (tools/mobproof/matrix.md; #7520) · visually signed-off ${A.signedCount(A.mobList(), { proven, visual: vis })}/${M.roster} (#7540)`);
  } catch (e) { console.log(`proof matrix unreadable: ${String(e.message).slice(0, 100)}`); }
  try {   // 10 Oct (Dan: usage must come with status, never a separate ask): a LIVE read of every account, not the published file
    const U = await import('./usaged.mjs'), acc = {};
    for (const [n, d] of Object.entries(U.profiles())) acc[n] = await U.readUsage(d, { renew: false }).catch((e) => ({ ok: false, why: e.message }));
    const live = Object.values(acc).filter((a) => a.ok);
    if (live.length) { console.log('usage LIVE (read now from Anthropic, per account):'); console.log(U.table({ at: new Date().toISOString(), accounts: acc })); }
    else { const pub = await usage();
      if (pub && pub.all) { console.log('usage per account (published by the PC usage daemon; this host cannot renew logins):'); for (const [n, x] of Object.entries(pub.all)) console.log('  ' + n + ': ' + x); }
      console.log('usage LIVE: no account readable from this host (' + Object.entries(acc).map(([n, a]) => n + ': ' + a.why).join('; ').slice(0, 200) + ') - falling back to the published file'); }
  } catch (e) { console.log('usage LIVE read failed: ' + String(e.message).slice(0, 120)); }
  for (const l of usageLines(await usage())) console.log(l);
  // the brain (#86): is anyone there to wake the commander when mail arrives?
  const rs = ((await gh('GET', '/repos/{repo}/actions/runners', null, { ok404: true }).catch(() => null))?.runners || [])
    .filter((r) => r.labels.some((l) => l.name === 'brain'));
  const on = rs.filter((r) => r.status === 'online').length;
  console.log('dormancy rule (#1966): fill wants workers + no master commit/worker run for 60 min + not usage-capped = health `dormant` wakes commander AND fixer');
  console.log(on ? `brain ${on}/${rs.length} runners online - mail to commander/fixer wakes them; --to dan reaches Dan's phone`
    : `brain OFFLINE (${rs.length} registered) - mail to commander wakes nobody; use the wake line in _status/commander-wake.md`);
}

async function gitPush() {                            // for the autosave: an authenticated push without a shell
  const dir = opt('--dir') || ROOT, spec = argv[1];
  git(['push', '-q', ...(flag('--force') ? ['--force'] : []), 'origin', spec], dir, true);
}
async function depends() {                            // record that --issue N needs --on M first (the queue then waits)
  const n = opt('--issue') || die('--issue N is required'), m = opt('--on') || die('--on M is required');
  const i = await gh('GET', `/repos/{repo}/issues/${n}`);
  await gh('PATCH', `/repos/{repo}/issues/${n}`, { body: `${i.body || ''}\n\nDepends on: #${String(m).replace('#', '')}` });
  console.log(`OK  #${n} now waits for #${m}`);
}
async function bug() {                                // a tester's finding, into 01 BUGS (first in phase order)
  const ms = await gh('GET', '/repos/{repo}/milestones?state=open&per_page=100');
  const m = ms.find((x) => /^01 BUGS/.test(x.title));
  const dk = opt('--dedupe');                          // an audit check files by mob+class: an open issue carrying the marker is the finding already
  if (dk) { const open = (await ghAll('/repos/{repo}/issues?state=open')) || []; const hit = open.find((x) => (x.body || '').includes(`<!-- dedupe:${dk} -->`)); if (hit) { console.log(`DUP  #${hit.number} already files ${dk}`); return; } }
  const labels = (opt('--labels') || 'bug').split(',');
  const i = await gh('POST', '/repos/{repo}/issues', { title: opt('--title') || die('--title is required'), body: `${opt('--body') || ''}\n\n(filed by ${dk ? 'an audit check' : 'a tester pass'})${dk ? `\n<!-- dedupe:${dk} -->` : ''}`, labels, milestone: m ? m.number : undefined });
  console.log(`OK  #${i.number} ${i.title}`);
}
async function audit() {                             // #1166: a mob is audited only if it RENDERS like the vanilla model
  const mob = opt('--mob') || die('--mob <name> is required (e.g. wolf)');
  const r = spawnSync('node', ['tools/mobshapecheck.mjs', '--mob', mob], { cwd: ROOT, stdio: 'inherit' });
  if (r.status) { console.log(`\nNOT AUDITED: ${mob} does not match the vanilla model. File it (go.mjs bug) and do not mark it audited.`); process.exit(1); }
  console.log(`AUDIT-RENDER-OK ${mob} — quote this line in the audit report`);
}
async function newissue() {                           // a port unit of a whole-phase issue, in the parent's milestone
  const parent = await gh('GET', `/repos/{repo}/issues/${opt('--parent') || die('--parent N is required')}`);
  const i = await gh('POST', '/repos/{repo}/issues', { title: opt('--title') || die('--title is required'),
    body: `${opt('--body') || ''}\n\nPart of #${parent.number}.`, milestone: parent.milestone ? parent.milestone.number : undefined, labels: inheritLabels(parent) });
  console.log(`OK  #${i.number} ${i.title}`);
  try {
    const open = (await gh('GET', '/repos/{repo}/issues?state=open&per_page=100')) || [];
    if (gateOpen(open) && !inGate({ ...i, milestone: i.milestone || parent.milestone, labels: (i.labels && i.labels.length ? i.labels : inheritLabels(parent)) }))
      console.log(`WARNING  the open gate hides #${i.number} (needs milestone 01 BUGS / G17 / G18 or label 'mobs') - no worker can claim it`);
  } catch {}
}
async function splitdone() {                          // the umbrella leaves the queue for good; its units carry the work
  const n = opt('--issue') || die('--issue N is required');
  await gh('POST', `/repos/{repo}/issues/${n}/labels`, { labels: ['tracking'] });
  const refs = (await gh('GET', `/repos/{repo}/git/matching-refs/heads/work/${n}-`)) || [];
  for (const r of refs) try { await gh('DELETE', `/repos/{repo}/git/${r.ref}`); } catch {}
  console.log(`OK  #${n} is now 'tracking' (skipped by the loop); its port units are claimed in phase order.`);
}
// #1529: the last GPU texture audit. READ-ONLY by construction: there is no subcommand but `status`, nothing here can
// start a render (the audit is a background job only the brain starts).
async function texaudit() {
  if (argv[1] && argv[1] !== 'status') die(`texaudit has only "status" (read-only); the audit is a background job started by the brain, not from here`);
  const dir = join(process.env.MCLITE_TEXAUDIT_DIR || join(findUnder('_status') || join(homedir(), '.brain', '_status'), 'texaudit'));
  let s = null, from = dir;
  try { s = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')); } catch {}
  if (!s && token()) { try { const v = await gh('GET', '/repos/{repo}/actions/variables/MCLITE_TEXAUDIT', null, { ok404: true }); if (v) { s = JSON.parse(v.value); from = 'repo variable MCLITE_TEXAUDIT'; } } catch {} }
  if (!s) return console.log('texaudit: no result yet (the brain starts the audit in the background when the entity/model/texture sources change)');
  console.log(`texaudit: ${s.state}, ${new Date(s.at).toISOString()}, src ${s.srcHash}, ${Math.round((s.elapsedMs || 0) / 1000)}s  (${from})`);
  for (const [m, r] of Object.entries(s.mobs || {})) console.log(`  ${m.padEnd(16)} mism ${r.mism ?? '?'}${['webgl2', 'webgpu'].map((b) => (r[b] !== undefined ? `  ${b} ${r[b]}` : '')).join('')}${r.error ? `  ERROR ${r.error}` : ''}`);
  console.log(`PNGs: ${dir}/<mob>/<layer>.png (webgl2), <layer>.webgpu.png (engine | gpu | diff; red mismatch, yellow band)`);
}
const realQueue = (list) => list.filter((i) => !i.labels.some((l) => /^(needs-pc|pc-gpu|blocked)$/.test(l.name)) && !/INFRA/.test(i.milestone?.title || '') && !/^INFRA/.test(i.title));   // #4549: what a brain worker could really take
/** #5116 (Dan, 11 Oct): what a worker can REALLY claim = realQueue minus issues whose work/ branch is held (isHeld, the rule claim() uses) or whose PR is in review.
 *  11 Oct 15:25Z: status said 9 claimable while two workers found nothing, so the commander's thin-queue test never fired. */
async function freeQueue(q) {
  const base = realQueue(q.list), refs = (await gh('GET', '/repos/{repo}/git/matching-refs/heads/work/').catch(() => null)) || [];
  const free = []; let held = 0;
  for (const i of base) {
    const ex = refs.filter((r) => r.ref.startsWith(`refs/heads/work/${i.number}-`));
    let taken = false;
    if (ex.length) {
      const ref = ex[0].ref.replace('refs/heads/', '');
      if (q.inReview.has(ref)) taken = true;
      else { const head = await gh('GET', `/repos/{repo}/commits/${ex[0].object.sha}`).catch(() => null);
        taken = !!head && isHeld({ age: (Date.now() - Date.parse(head.commit.committer.date)) / 36e5, message: head.commit.message, bouncedFree: !!(q.inReview.rebase && q.inReview.rebase.has(ref)) && !/^takeover:/.test(head.commit.message) }, STALE_H); }
    }
    if (taken) held++; else free.push(i);
  }
  return { free, held };
}
async function claimable() { console.log((await freeQueue(await queue())).free.length); }   // #4298: what the brain's fill shape reads
const CMDS = { claimable, texaudit, 'git-push': gitPush, start, done, check, status, say, reply, loop, newissue, splitdone, depends, bug, audit,
  prep: async () => prepDir(opt('--dir') || die('--dir is required: the workspace start printed')),
  gatecheck: async () => {                             // for tools/infra/gate.mjs: {pending, yield} as one JSON line
    const dir = opt('--dir') || ROOT, out = { pending: [], yield: null };
    try { out.pending = (await unanswered(dir)).map((c) => ({ id: c.id, body: c.body })); } catch {}
    const cf = join(dir, '.git', 'mclite-claim'), yf = join(dir, '.git', 'mclite-yield.json');
    // the YIELD check (issue closed / branch taken over) costs 2 calls: every 3 min is soon enough (30 Sept, API quota)
    let yc = null; try { yc = JSON.parse(readFileSync(yf, 'utf8')); } catch {}
    if (yc && Date.now() - yc.at < 180e3) out.yield = yc.yield;
    else if (existsSync(cf)) {
      const ref = readFileSync(cf, 'utf8').trim(), num = (ref.match(/^work\/(\d+)-/) || [])[1];
      try {
        if (num && (await gh('GET', `/repos/{repo}/issues/${num}`)).state === 'closed') out.yield = `issue #${num} was closed (read its last comment)`;
        const r = await gh('GET', `/repos/{repo}/git/ref/heads/${ref}`, null, { ok404: true });
        if (r && !out.yield) { try { git(['cat-file', '-e', r.object.sha], dir); git(['merge-base', '--is-ancestor', r.object.sha, 'HEAD'], dir); }
          catch { try { git(['fetch', '-q', 'origin', ref], dir, true); git(['merge-base', '--is-ancestor', 'FETCH_HEAD', 'HEAD'], dir); }
            catch { out.yield = `${ref} moved without you: another session took this issue over`; } } }
      } catch {}
      try { writeFileSync(yf, JSON.stringify({ at: Date.now(), yield: out.yield })); } catch {}
    }
    console.log(JSON.stringify(out));
  },
  runner,
  help: async () => console.log(`usage: node tools/go.mjs <command>   commands: ${Object.keys(CMDS).join(', ')}\n(start claims an issue - type it; see RUN.md)`),
  pending: async () => console.log(JSON.stringify((await unanswered(opt('--dir') || ROOT)).map((c) => ({ id: c.id, body: c.body })))),
  news: async () => console.log(JSON.stringify(news(await mailbox(opt('--dir') || ROOT), names(opt('--dir') || ROOT)).map((c) => ({ id: c.id, body: c.body })))),   // the mail hook shows each once
   inbox: () => inbox(opt('--dir') || ROOT, { all: flag('--all') }), usage: async () => console.log(JSON.stringify(await usage(), null, 1)) };
if (!CMDS[cmd]) die(`unknown command ${cmd}; see the header of tools/go.mjs`);
if (!['help', 'say', 'reply', 'inbox', 'loop', 'usage', 'start', 'pending', 'news', 'gatecheck', 'git-push', 'texaudit', 'claimable'].includes(cmd) && token()) await mailGate(opt('--dir') || ROOT);
await CMDS[cmd]().catch((e) => die(e.message === 'NO_TOKEN' ? 'no GitHub token (see RUN.md, one-time setup)' : e.message));
