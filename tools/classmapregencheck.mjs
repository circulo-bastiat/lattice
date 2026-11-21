#!/usr/bin/env node
// classmapregencheck.mjs - #11906: the lander regenerates the generated class map (docs/audits/classmap.md, tools/classmap.json) instead of bouncing a conflict in it
// or landing a tree whose summed counts are stale. Real git merges in a temp repo with a stub generator; every rule is also run against a broken copy ("<n> breaks caught").
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mergeLists } from './infra/listmerge.mjs';
import { regenClassmap } from './infra/classmapregen.mjs';
import { mergeBatch } from './infra/landbatch.mjs';

const rd = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
let bad = 0, caught = 0, asserts = 0;
const hit = (m) => { caught++; console.log(' ✓ break caught: ' + m); };   // the suite counts these check marks (suite.mjs) and the lander's anti-vacuity gate reads them
const ok = (c, m) => { asserts++; if (!c) { bad++; console.log('FAIL ' + m); } };
// stub generator: classmap.md = "count N" on line 1 + one entry per src file at a slot set by its first letter (entries of different files are 12 lines apart, so
// two PRs that add different files merge TEXTUALLY CLEAN while their counts are summed wrongly); tools/classmap.json = the same layout.
const GEN = `import fs from 'node:fs'; const f = fs.readdirSync('src').sort(); const L = ['count ' + f.length]; for (let i = 0; i < 120; i++) L.push('-');
for (const x of f) L[1 + (x.charCodeAt(0) - 97) * 12] = 'class ' + x; fs.mkdirSync('docs/audits', { recursive: true }); fs.writeFileSync('docs/audits/classmap.md', L.join('\\n') + '\\n');
fs.writeFileSync('tools/classmap.json', L.join('\\n') + '\\n');\n`;
const mk = () => {
  const d = mkdtempSync(join(tmpdir(), 'cmregen-'));
  const sh = (...a) => { const r = spawnSync('git', a, { cwd: d, encoding: 'utf8', }); return r; };
  const gen = () => spawnSync('node', ['tools/classmap.mjs'], { cwd: d });
  sh('init', '-q', '-b', 'master'); sh('config', 'user.name', 't'); sh('config', 'user.email', 't@t'); mkdirSync(join(d, 'src')); mkdirSync(join(d, 'tools')); mkdirSync(join(d, '.decomp'));
  writeFileSync(join(d, 'tools/classmap.mjs'), GEN); writeFileSync(join(d, 'src/a.js'), '1'); gen(); sh('add', '-A'); sh('commit', '-q', '-m', 'base');
  const side = (branch, file) => { sh('checkout', '-q', '-b', branch, 'master'); writeFileSync(join(d, 'src', file), '1'); gen(); sh('add', '-A'); sh('commit', '-q', '-m', branch); sh('checkout', '-q', 'master'); };
  side('prb', 'b.js'); side('prc', 'c.js');
  return { d, sh };
};
const md = (d) => readFileSync(join(d, 'docs/audits/classmap.md'), 'utf8').split('\n')[0];
const rm = (d) => rmSync(d, { recursive: true, force: true });

// RULE 1 (clean merge, stale sum): master has b, PR has c, both regenerated "count 2"; git merges them cleanly into "count 2" with three entries. The regen step must fix it to 3 and commit.
function rule1({ skipGen }) {
  const { d, sh } = mk(); sh('merge', '-q', '--no-ff', '-m', 'b', 'prb'); const m = sh('merge', '-q', '--no-ff', '-m', 'c', 'prc');
  ok(!m.status, 'scenario 1 must merge cleanly in git (else it tests nothing)');
  const stale = md(d); ok(stale === 'count 2', 'scenario 1: the textual merge must leave the stale count 2, got ' + stale);
  if (skipGen) rmSync(join(d, '.decomp'), { recursive: true });
  const r = regenClassmap(d); const out = { changed: r.changed, count: md(d), committed: sh('status', '--porcelain').stdout.trim() === '' };
  rm(d); return out;
}
{ const g = rule1({}); ok(g.changed && g.count === 'count 3' && g.committed, `rule 1: regen did not fix + commit the stale sum (${JSON.stringify(g)})`);
  const b = rule1({ skipGen: true }); if (!b.changed && b.count === 'count 2') hit('regen skipped (no .decomp): the stale sum stays visible'); else ok(false, 'break 1 (no .decomp, regen skipped) must leave the stale count visible'); }

// RULE 2 (conflict): master and PR both add the SAME-slot entry, so git conflicts in classmap.md; mergeLists must finish the merge by regenerating.
{ // a conflict confined to the generated files: PR rewrote the entry line of a, master the same line differently
  const { d, sh } = mk(); sh('checkout', '-q', '-b', 'x1', 'master'); writeFileSync(join(d, 'docs/audits/classmap.md'), 'count 9\n'); sh('commit', '-q', '-am', 'x1'); sh('checkout', '-q', 'master');
  writeFileSync(join(d, 'docs/audits/classmap.md'), 'count 7\n'); sh('commit', '-q', '-am', 'm7');
  const m = sh('merge', '-q', '--no-ff', '-m', 'x', 'x1'); ok(m.status !== 0, 'scenario 2 must conflict in git');
  const why = mergeLists(d); ok(why === '', 'rule 2: a conflict confined to the generated class map must be finished by regenerating, got: ' + why);
  ok(md(d) === 'count 1' && !existsSync(join(d, '.git/MERGE_HEAD')), 'rule 2: merge not finished with the regenerated map, line 1: ' + md(d)); rm(d); }
{ const { d, sh } = mk(); sh('checkout', '-q', '-b', 'x1', 'master'); writeFileSync(join(d, 'docs/audits/classmap.md'), 'count 9\n'); sh('commit', '-q', '-am', 'x1'); sh('checkout', '-q', 'master');
  writeFileSync(join(d, 'docs/audits/classmap.md'), 'count 7\n'); sh('commit', '-q', '-am', 'm7'); sh('merge', '-q', '--no-ff', '-m', 'x', 'x1');
  writeFileSync(join(d, 'tools/classmap.mjs'), 'process.exit(3)');   // break 2: a failing generator must leave the conflict (bounce), never a half-finished merge
  const why = mergeLists(d); if (why && /classmap/.test(why)) hit('a failing generator is reported, the merge is not finished'); else ok(false, 'break 2 (generator fails) must make mergeLists report why: ' + why); sh('merge', '--abort'); rm(d); }

// RULE 3 (batch): mergeBatch reports which members the regen changed, so land.mjs heals exactly those onto their PR branches before the API merge.
{ const { d, sh } = mk(); const s = (...a) => sh(...a);
  const run = (after) => mergeBatch((c, a) => { const r = spawnSync(c, a, { cwd: d, encoding: 'utf8', }); return r; }, [{ n: 1, ref: 'prb' }, { n: 2, ref: 'prc' }], null, after);
  const r = run((n) => regenClassmap(d).changed);
  ok(r.members.join() === '1,2' && !r.regen[1] && r.regen[2] === true, 'rule 3: only member 2 (the clean merge with a stale sum) should be marked regenerated: ' + JSON.stringify(r.regen));
  ok(md(d) === 'count 3' && s('rev-parse', 'HEAD').stdout.trim() === r.heads[2], 'rule 3: heads[2] must be the regenerated commit');
  rm(d); }
{ const { d } = mk(); const r = mergeBatch((c, a) => spawnSync(c, a, { cwd: d, encoding: 'utf8', }), [{ n: 1, ref: 'prb' }, { n: 2, ref: 'prc' }], null);   // break 3: no after() hook
  if (md(d) === 'count 2' && !Object.keys(r.regen).length) hit('no regen hook: the stale sum stays and no member is marked'); else ok(false, 'break 3 (no regen hook) must leave the stale sum'); rm(d); }

// RULE 4 (wiring in land.mjs): both paths regenerate, the batch passes the hook, and a changed tree is healed onto the PR branch BEFORE the API merge.
const LAND = rd('./infra/land.mjs');
const W = [
  ['single path regenerates after the merge', /const rg = regenClassmap\(ROOT/],
  ['single path heals a changed tree before the API merge', /if \(rg\.changed\) \{[^\n]*healBranch[^\n]*\}\n  let refused = await apiMerge\(n, pr\)/],
  ['batch passes the regen hook to mergeBatch', /mergeBatch\(sh, prs, \(\) => mergeLists\(ROOT\), \(n\) => \{ const r = regenClassmap\(ROOT/],
  ['batch heals a regenerated member before its API merge', /const healed = regen && regen\[n\] && heads && heads\[n\] \? await healMember\(\) : false;[^\n]*\n    let err = await apiMerge\(n, p\.pr\)/],
];
for (const [name, re] of W) { ok(re.test(LAND), 'wiring: ' + name); const broken = LAND.replace(re, '/*gone*/'); if (broken !== LAND && !re.test(broken)) hit('wiring removed: ' + name); else ok(false, 'break (wiring): ' + name + ' not caught'); }
console.log(`classmapregencheck: ${asserts} assertions, ${bad} failures, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
