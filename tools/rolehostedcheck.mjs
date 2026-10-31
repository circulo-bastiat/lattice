// rolehostedcheck (#10419): brain role runs and bus routing work with NO runner on the PC and none in the private repo.
//  1. pollPlan routes the bus by polling with the same decisions as brain.yml's issue_comment route (one start per role, replies/own mail/log ignored,
//     `to: dan` pushes, a first run only looks 30 min back, the cursor only moves forward).
//  2. roleStart: hosted = role-run.yml on the mirror with a SAFE input (a bus id, never mail text), VM = brain.yml as before; a worker is a pack, a waker is a no-op.
//  3. nothing in brain.mjs / ladder.mjs dispatches brain.yml directly any more; role-run.yml and role-slot.sh keep the public log silent.
// Then the checker is proven by breaking each rule ("<n> breaks caught").
import fs from 'node:fs';
const read = (f) => fs.readFileSync(f, 'utf8');
const CFG = JSON.parse(read('tools/brain/roles.json'));
const SRC = { poll: await import('./brain/poll.mjs'), rd: await import('./infra/roledispatch.mjs'), brain: read('tools/brain/brain.mjs'), ladder: read('tools/infra/ladder.mjs'),
  yml: read('tools/infra/mirror/role-run.yml'), slot: read('tools/infra/mirror/role-slot.sh'), tick: read('tools/infra/mirror/brain-tick.yml') };
const now = Date.parse('2026-10-27T05:00:00Z'), iso = (m) => new Date(now - m * 60e3).toISOString();
const C = (id, to, from, text, min = 1) => ({ id, created_at: iso(min), body: `to: ${to}\nfrom: ${from}\n\n${text}` });
async function verdict(S) {
  const bad = [], P = S.poll.pollPlan, R = S.rd;
  // 1. polling
  { const r = P([C(10, 'commander', 'brain', 'health: dormant'), C(11, 'commander', 'dan', 'hello'), C(12, 'fixer', 'brain', 'x'), C(13, 'log', 'worker', 'noise'), C(14, 'commander', 'commander', 'self mail'), { id: 15, created_at: iso(1), body: 'to: commander\nfrom: dan\nre: 11\n\nreply' }], 9, CFG, now);
    const roles = r.starts.map((s) => s.role).sort().join(',');
    if (roles !== 'commander,fixer') bad.push(`poll: expected one commander and one fixer start, got ${roles}`);
    if (r.starts.find((s) => s.role === 'commander')?.id !== 11) bad.push('poll: the later commander mail does not win');
    if (r.cursor !== 15) bad.push('poll: the cursor is not the highest comment id'); }
  { const r = P([C(20, 'dan', 'commander', 'question?')], 19, CFG, now); if (r.notifies.length !== 1 || r.starts.length) bad.push('poll: to: dan is not a push'); }
  { const r = P([C(30, 'commander', 'dan', 'old', 120), C(31, 'commander', 'dan', 'fresh', 5)], 0, CFG, now); if (r.starts.length !== 1 || r.starts[0].id !== 31) bad.push('poll: a first run (no cursor) reads more than 30 minutes back'); }
  { const r = P([C(40, 'commander', 'dan', 'already handled')], 40, CFG, now); if (r.starts.length) bad.push('poll: a comment at or below the cursor starts a run again'); if (r.cursor !== 40) bad.push('poll: the cursor moved backwards'); }
  { const r = P([], 77, CFG, now); if (r.cursor !== 77) bad.push('poll: an empty bus loses the cursor'); }
  { const r = P([C(50, 'commander', 'dan', 'SECRET-MAIL-TEXT')], 49, CFG, now); if (JSON.stringify(r.starts).includes('SECRET-MAIL-TEXT')) bad.push('poll: the start reason carries the mail text (must be bus:<id>)'); }
  // 2. dispatch
  const hosted = { BRAIN_RUNNER: 'mirror', MIRROR_REPO: 'o/lattice', MIRROR_TOKEN: 't' };
  { const q = R.roleStart({ role: 'commander', reason: 'mail from dan: SECRET-MAIL-TEXT', account: 'max' }, { env: hosted });
    if (!q.mirror || !/\/repos\/o\/lattice\/actions\/workflows\/role-run\.yml\/dispatches$/.test(q.url)) bad.push('roleStart: hosted does not dispatch role-run.yml on the mirror');
    if (JSON.stringify(q.body).includes('SECRET-MAIL-TEXT')) bad.push('roleStart: mail text reaches a public workflow input'); }
  { const q = R.roleStart({ role: 'commander', reason: 'bus:123' }, { env: hosted }); if (q.body.inputs.reason !== 'bus:123') bad.push('roleStart: a bus id is not passed through'); }
  { const q = R.roleStart({ role: 'commander', reason: 'bus:123' }, { env: {} }); if (q.mirror || !/brain\.yml\/dispatches$/.test(q.url)) bad.push('roleStart: the VM brain no longer dispatches brain.yml'); }
  { const calls = []; const r = await R.startRole({ role: 'waker', reason: 'x' }, { env: hosted, ghImpl: async () => calls.push('gh'), f: async (u) => { calls.push(u); return { ok: true, status: 204, json: async () => ({}) }; } }); if (calls.length || !r.skipped) bad.push('startRole: a hosted waker is not a no-op'); }
  { const calls = []; await R.startRole({ role: 'worker', account: 'phase' }, { env: hosted, f: async (u, i) => { calls.push([u, i && i.body]); return { ok: true, status: 204, json: async () => ({ default_branch: 'main' }) }; } }); if (!calls.some(([u]) => /worker-pack\.yml\/dispatches$/.test(u))) bad.push('startRole: a hosted worker is not a worker-pack'); }
  { const calls = []; await R.startRole({ role: 'fixer', reason: 'bus:5' }, { env: hosted, f: async (u, i) => { calls.push([u, i && i.body]); return { ok: true, status: 204, json: async () => ({ default_branch: 'trunk' }) }; } }); const d = calls.find(([u]) => /role-run\.yml\/dispatches$/.test(u)); if (!d || JSON.parse(d[1]).ref !== 'trunk') bad.push("startRole: the ref is not the mirror's default branch"); }
  { let m = ''; try { await R.startRole({ role: 'fixer' }, { env: hosted, f: async (u) => ({ ok: false, status: /dispatches/.test(u) ? 404 : 200, json: async () => ({}) }) }); } catch (e) { m = e.message; } if (!/not published/.test(m)) bad.push('startRole: a 404 does not say role-run.yml is unpublished'); }
  // 3. wiring and silence
  for (const [name, t] of [['brain.mjs', S.brain], ['ladder.mjs', S.ladder.replace(/start = \(inp\) => gh\('POST', '\/repos\/\{repo\}\/actions\/workflows\/brain\.yml\/dispatches'[^\n]*?\)\s*\}\) \{/, 'start }) {')]]) if (/workflows\/brain\.yml\/dispatches/.test(t)) bad.push(`${name} still dispatches brain.yml directly (#10419)`);
  if (!/cmd === 'poll'/.test(S.brain)) bad.push('brain.mjs has no poll command');
  if (!/brain\.mjs poll/.test(S.tick)) bad.push('the hosted tick does not run brain.mjs poll');
  for (const [re, why] of [[/upload-artifact/, 'uploads an artifact'], [/set -x|bash -x/, 'traces commands'], [/cat [^\n]*out\.log/, 'prints out.log'], [/echo[^\n]*\$\{\{ *secrets/, 'echoes a secret'], [/run-name:[^\n]*inputs\.(reason|account)/, 'puts the reason or account in the run name'], [/echo[^\n]*\$\{\{ *inputs\.reason/, 'echoes the reason']]) if (re.test(S.yml)) bad.push(`role-run.yml ${why} into a public log`);
  if (!/silent role role_slot/.test(S.yml)) bad.push('role-run.yml does not run the role through silent()');
  if (!/bus:\[0-9\]\*\)/.test(S.slot)) bad.push('role-slot.sh does not expand bus:<id> itself');
  if (/pull_request|pull_request_target/.test(S.yml)) bad.push('role-run.yml can be triggered by a pull request');
  return bad;
}
const dup = (o) => ({ ...o });
const brk = (k, f) => { const S = dup(SRC); S[k] = f(SRC[k]); return S; };
const brokenPoll = (f) => ({ ...SRC.poll, pollPlan: (...a) => f(SRC.poll.pollPlan(...a), ...a) });
const breaks = [
  { ...SRC, poll: brokenPoll((r) => ({ ...r, starts: [...r.starts, ...r.starts] })) },
  { ...SRC, poll: brokenPoll((r) => ({ ...r, cursor: 0 })) },
  { ...SRC, poll: brokenPoll((r) => ({ ...r, notifies: [] })) },
  { ...SRC, poll: brokenPoll((r, c, cur, cfg, n) => SRC.poll.pollPlan(c, 0, cfg, 0)) },
  { ...SRC, poll: brokenPoll((r, c) => ({ ...r, starts: r.starts.map((s) => ({ ...s, reason: c.find((x) => x.id === s.id).body })) })) },
  { ...SRC, rd: { ...SRC.rd, roleStart: (i, o) => ({ mirror: true, url: 'https://x/role-run.yml/dispatches', body: { ref: 'main', inputs: i } }) } },
  { ...SRC, rd: { ...SRC.rd, roleStart: (i, o) => SRC.rd.roleStart(i, { env: {} }) } },
  { ...SRC, rd: { ...SRC.rd, startRole: async () => ({}) } },
  brk('brain', (t) => t + "\nawait gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', {});"),
  brk('brain', (t) => t.replace("cmd === 'poll'", "cmd === 'pol'")),
  brk('ladder', (t) => t + "\nawait gh('POST', '/repos/{repo}/actions/workflows/brain.yml/dispatches', {});"),
  brk('tick', (t) => t.replace(/brain\.mjs poll/g, 'brain.mjs health')),
  brk('yml', (t) => t.replace('run-name: role-run ${{ inputs.role }}', 'run-name: role-run ${{ inputs.reason }}')),
  brk('yml', (t) => t + '      - uses: actions/upload-artifact@v4\n'),
  brk('yml', (t) => t.replace('silent role role_slot', 'role_slot')),
  brk('yml', (t) => t.replace('workflow_dispatch:', 'pull_request:\n  workflow_dispatch:')),
  brk('slot', (t) => t.replace('bus:[0-9]*)', 'xx)')),
];
let bad = await verdict(SRC); bad.forEach((b) => console.log('FAIL', b));
let caught = 0; for (const S of breaks) if ((await verdict(S)).length) caught++; else console.log('NOT CAUGHT: break #' + (breaks.indexOf(S) + 1));
console.log(`rolehostedcheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
if (caught < breaks.length) bad = bad.concat('vacuous');
process.exit(bad.length ? 1 : 0);
