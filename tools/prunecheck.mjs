#!/usr/bin/env node
// tools/prunecheck.mjs - the branch pruner (tools/infra/prune.mjs) deletes exactly the dead branches and never one with
// an open PR, live work, or a fresh rescue. ANTI-VACUITY: broken copies must each be caught ("<n> breaks caught").
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const SRC = fileURLToPath(new URL('./infra/prune.mjs', import.meta.url));
const NOW = Date.parse('2026-09-29T12:00:00Z'), H = 3600e3;
const B = (o) => ({ name: 'work/7-x', date: NOW - H, msg: '#7: work', openPR: false, mergedPR: false, issueClosed: false, ...o });
let A = 0;
function run(v) {
  const f = []; const ok = (c, m) => { A++; if (!c) f.push(m); };
  ok(v(B({ name: 'master', mergedPR: true }), NOW) === null, 'master is never deleted');
  ok(v(B({ openPR: true, issueClosed: true }), NOW) === null, 'a branch with an open PR is never deleted');
  ok(!!v(B({ mergedPR: true }), NOW), 'a merged PR branch goes');
  ok(!!v(B({ issueClosed: true }), NOW), 'a closed issue branch goes');
  ok(!!v(B({ name: 'wip/work/7-x', issueClosed: true }), NOW), "a closed issue's autosave goes");
  ok(v(B({}), NOW) === null, 'live work stays');
  ok(v(B({ msg: 'handoff: released (x)', date: NOW - 2 * H }), NOW) === null, 'a fresh hand-off stays (the next session resumes it)');
  ok(!!v(B({ msg: 'handoff: released (x)', date: NOW - 30 * H }), NOW), 'a released branch untouched for 24 h goes');
  ok(!!v(B({ msg: 'takeover: stale for 3 h', date: NOW - 30 * H }), NOW), 'a stale takeover marker goes after 24 h');
  ok(v(B({ name: 'claude/abc', date: NOW - 10 * H }), NOW) === null && !!v(B({ name: 'claude/abc', date: NOW - 50 * H }), NOW), 'session branches go after 2 days');
  ok(v(B({ name: 'rescue/7-x-0929', date: NOW - 3 * 24 * H }), NOW) === null, 'a fresh rescue branch stays');
  ok(!!v(B({ name: 'cloud-merged', date: NOW - 50 * H }), NOW), 'the old cloud-merged branch goes');
  ok(v(B({ msg: 'land #99: x', date: NOW - 5 * H }), NOW) === null && !!v(B({ msg: 'land #99: x', date: NOW - 30 * H }), NOW), 'a claim with no commits goes only after 24 h');
  return f;
}
const load = async (file) => (await import(pathToFileURL(file).href)).pruneVerdict;
const fails = run(await load(SRC)).map((x) => `real code: ${x}`);
const A0 = A;
const src = readFileSync(SRC, 'utf8');
const BREAKS = [
  ['open PRs are pruned', "if (KEEP.test(b.name) || b.openPR) return null;", 'if (KEEP.test(b.name)) return null;'],
  ['fresh hand-offs are pruned', '&& age > 24 * H) return', ') return'],
  ['merged branches are kept', "if (b.mergedPR) return 'its PR merged';", ''],
  ['master is pruned', 'const KEEP = /^(master|', 'const KEEP = /^(nomaster|'],
  ['rescues pruned at once', 'age > 7 * 24 * H', 'age > 0'],
];
let caught = 0;
for (const [name, from, to] of BREAKS) {
  if (!src.includes(from)) { fails.push(`break "${name}" no longer applies - update this check`); continue; }
  const dir = mkdtempSync(join(tmpdir(), 'prunecheck-')), f = join(dir, 'prune.mjs');
  // no symlink (Windows runners refuse it, EPERM): point the copy's import at the real gh.mjs
  writeFileSync(f, src.split(from).join(to).replace("from './gh.mjs'", `from '${pathToFileURL(join(dirname(SRC), 'gh.mjs')).href}'`));
  let bf; try { bf = run(await load(f)); } catch (e) { bf = [String(e)]; }
  if (bf.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
  rmSync(dir, { recursive: true, force: true });
}
console.log(`prunecheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${A0 - fails.filter((x) => x.startsWith('real')).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
