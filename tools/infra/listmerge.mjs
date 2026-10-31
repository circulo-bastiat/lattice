// tools/infra/listmerge.mjs - #1612: finish a conflicted `git merge` in `cwd` when the conflicts are ONLY in the shared
// ratchet lists (see jsonmerge.mjs): 3-way merge each by key, `git add`, commit. Anything else, or a key both sides
// changed differently, stays a conflict. Returns '' when merged, else why it could not be (the caller aborts the merge).
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { merge3, MERGEABLE } from './jsonmerge.mjs';

export function mergeLists(cwd) {
  const sh = (a) => spawnSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  const u = sh(['diff', '--name-only', '--diff-filter=U']).stdout.split('\n').filter(Boolean);
  if (!u.length) return 'no conflicted files listed';
  // #9716: the same pilot result (inputs hash + salt) measured by two runs: add/add. Master's (first landed) is kept; the PR's copy is a duplicate measurement.
  const RESULT = /^tools\/referee\/lockstep\/pilot-results\//, isAddAdd = (f) => sh(['show', `:1:${f}`]).status !== 0 && sh(['show', `:2:${f}`]).status === 0;
  for (const f of u.filter((x) => RESULT.test(x) && isAddAdd(x))) { if (sh(['checkout', '--ours', '--', f]).status || sh(['add', f]).status) return `${f}: could not keep master's result`; }
  u.splice(0, u.length, ...u.filter((x) => !(RESULT.test(x) && sh(['diff', '--name-only', '--diff-filter=U', '--', x]).stdout.trim() === '')));
  if (!u.length) { const c0 = sh(['commit', '-q', '--no-edit']); return c0.status ? 'commit of the result merge failed: ' + (c0.stderr || c0.stdout).trim().slice(0, 200) : ''; }
  const other = u.filter((f) => !MERGEABLE.test(f));
  if (other.length) return `conflicts outside the lists: ${other.join(', ')}`;
  for (const f of u) {
    const at = (st) => { const r = sh(['show', `:${st}:${f}`]); return r.status ? null : r.stdout; };
    const o = at(2), t = at(3);
    if (o == null || t == null) return `${f}: deleted on one side`;
    const r = merge3(at(1), o, t);
    if (!r.ok) return `${f}: ${r.why}`;
    writeFileSync(join(cwd, f), r.text);
    if (sh(['add', f]).status) return `${f}: git add failed`;
  }
  const c = sh(['commit', '-q', '--no-edit']);
  return c.status ? 'commit of the list merge failed: ' + (c.stderr || c.stdout).trim().slice(0, 200) : '';
}
