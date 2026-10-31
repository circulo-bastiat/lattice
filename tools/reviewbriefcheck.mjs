#!/usr/bin/env node
// reviewbriefcheck.mjs - #9739: the reviewer gets its inputs in the prompt. A haiku reviewer that fetched the issue, the PR diff and the check output itself
// ended error_max_turns (6 turns) in 6 of 19 runs on 22 Oct and recorded nothing. The brain fetches them (reviewtick.mjs reviewBrief) and launch.mjs puts
// them into the prompt's {brief}. Unit asserts on briefText/reviewBrief plus wiring checks, each with its break.
import { readFileSync } from 'node:fs';
import { briefText, reviewBrief } from './brain/reviewtick.mjs';
import { promptFor, findings } from './brain/route.mjs';
import { roleFailures, logOk, readRoleRuns } from './brain/rolefail.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const Bsrc = readFileSync(new URL('./brain/brain.mjs', import.meta.url), 'utf8');
const L = readFileSync(new URL('./brain/launch.mjs', import.meta.url), 'utf8'), Rj = readFileSync(new URL('./brain/roles.json', import.meta.url), 'utf8');
const ROLES = JSON.parse(Rj);
let asserts = 0, fails = 0, breaks = 0; const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const t = briefText({ issue: { number: 5, title: 'T', body: 'required:\n- a check' }, pr: 7, files: [{ filename: 'a.mjs', patch: '+x' }], note: 'core: 12 green' });
ok(/Issue #5: T/.test(t) && /required:\n- a check/.test(t) && /--- a\.mjs\n\+x/.test(t) && /core: 12 green/.test(t) && /PR #7/.test(t), 'briefText carries issue, diff and check output');
ok(briefText({ files: Array(40).fill({ filename: 'f', patch: 'y'.repeat(3000) }) }).length < 16000, 'briefText is bounded');
const calls = [];
const gh = async (m, p) => { calls.push(p); if (p.includes('/issues/5')) return { number: 5, title: 'T', body: 'B' }; if (p.includes('/files')) return [{ filename: 'z.js', patch: '+1' }]; if (p.includes('/comments')) return [{ body: 'land: core green' }]; throw new Error('x'); };
const b = await reviewBrief('review #5 (PR 7)', gh);
ok(calls.some((p) => p.includes('/issues/5')) && calls.some((p) => p.includes('/pulls/7/files')) && /z\.js/.test(b) && /core green/.test(b), 'reviewBrief reads the issue, the PR files and comments from the reason');
ok(/issue unreadable/.test(await reviewBrief('review #5 (PR 7)', async () => { throw new Error('down'); })), 'reviewBrief never throws');
const p = promptFor(ROLES, 'reviewer', 'review #5 (PR 7)', briefText({ issue: { number: 5, title: 'T' }, pr: 7 }));
ok(/Issue #5: T/.test(p) && /issue number from REVIEW INPUT/.test(p) && p.trimEnd().endsWith('(none)'), 'the reviewer prompt ends with the brief, which names the issue (#9600: one per-run placeholder, last)');
// part 2: a role whose runs mostly end in an error raises the finding role-failing:<role>
ok(logOk('{"subtype":"success","type":"result"}') && !logOk('{"subtype":"error_max_turns"}') && !logOk(''), 'logOk: success only; no result line = failed');
const runs = [...Array(13).fill({ role: 'reviewer', ok: true, at: 1 }), ...Array(6).fill({ role: 'reviewer', ok: false, at: 2 }), ...Array(330).fill({ role: 'worker', ok: true }), ...Array(7).fill({ role: 'worker', ok: false }), { role: 'chore', ok: false }];
const rf = roleFailures(runs);
ok(rf.length === 1 && rf[0].role === 'reviewer' && rf[0].failed === 6 && rf[0].runs === 19, 'roleFailures: reviewer 6/19 fails, worker 7/337 and a single chore failure do not');
const fd = findings({ now: Date.now(), roleFails: rf }, { health: {} });
ok(fd.some((f) => f.key === 'role-failing:reviewer'), 'findings raises role-failing:reviewer');
{ const healed = roleFailures([...runs, { role: 'reviewer', ok: true, at: 3 }]);
  ok(healed.length === 0, 'roleFailures: a role whose newest run succeeded is not failing any more (the fix landed)');
  const R = readFileSync(new URL('./brain/rolefail.mjs', import.meta.url), 'utf8'), g = /&& !x\.lastOk\)/;
  const c = g.test(R) && !g.test(R.replace('&& !x.lastOk)', ')')); ok(c, 'rolefail.mjs: the recovered-role exemption is wired'); if (c) breaks++; }
{ const d = mkdtempSync(join(tmpdir(), 'rf-')), now = Date.now(), iso = (t) => new Date(t).toISOString().replace(/[:.]/g, '-');
  writeFileSync(join(d, iso(now - 3600e3) + '-reviewer.json'), '{"subtype":"error_max_turns"}'); writeFileSync(join(d, iso(now - 7200e3) + '-reviewer.json'), '{"subtype":"success"}');
  writeFileSync(join(d, iso(now - 20 * 3600e3) + '-reviewer.json'), '{"subtype":"error_max_turns"}'); writeFileSync(join(d, iso(now - 60e3) + '-reviewer.json'), '');
  const rr = readRoleRuns(d, now, 12); ok(rr.length === 2 && rr.filter((r) => r.ok).length === 1, 'readRoleRuns: 12 h window, skips runs younger than 5 min, reads the verdict'); }
const W = [
  ['the health pass feeds role failures to findings', Bsrc, /snap\.roleFails = roleFailures\(readRoleRuns\(P\('logs'\), Date\.now\(\), 12\)\)/],
  ['findings turns role failures into role-failing:<role>', readFileSync(new URL('./brain/route.mjs', import.meta.url), 'utf8'), /for \(const x of snap\.roleFails \|\| \[\]\) out\.push\(\{ key: `role-failing:\$\{x\.role\}`/],
  ['launch.mjs builds the reviewer brief', L, /: role === 'reviewer' \? await reviewBrief\(reason, gh\) : ''/],
  ['launch.mjs imports reviewBrief', L, /import \{ reviewBrief \} from '\.\/reviewtick\.mjs';/],
  ['the reviewer prompt has a {brief} slot', Rj, /prompt cache reuses this prefix\.\\n\\n\{brief\}"/],
  ['the reviewer prompt forbids fetching', Rj, /do NOT fetch them - 6 turns is not enough/],
];
for (const [n, s, re] of W) { ok(re.test(s), n); const br = s.replace(re, 'X'); if (br !== s && !re.test(br)) { breaks++; console.log(`  ✓ wiring "${n}" removed is caught`); } }
// a unit break: a brief without the diff must fail the first assert's shape
if (!/--- a\.mjs/.test(briefText({ issue: {}, files: [] }))) { breaks++; console.log('  ✓ a brief without the diff is caught'); }
console.log(`reviewbriefcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
