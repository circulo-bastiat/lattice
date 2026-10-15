#!/usr/bin/env node
// fullmirrorcheck.mjs - #6767 owed part: the WHOLE suite runs on the public test mirror's free hosted runners (16 shards, ci-full.yml),
// this PC only pushes the snapshot and gathers the shard results (mirror.mjs runFull -> full.mjs). Wiring rules over the real files,
// a behaviour test of the shard merge, then anti-vacuity: deleting what any one rule demands must make that rule fail.
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FORBID } from './infra/mirror.mjs';
import { mergeShards } from './infra/fullshard.mjs';
let asserts = 0, fails = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log(`  FAIL ${m}`); } };
const F = { ci: 'infra/mirror/ci-full.yml', mirror: 'infra/mirror.mjs', full: 'infra/full.mjs', wf: '../.github/workflows/full-suite.yml' };
const files = Object.fromEntries(Object.entries(F).map(([k, f]) => [k, readFileSync(new URL(f, import.meta.url), 'utf8')]));
// [name, file, regex that must match]. Removing the match from that file must fail exactly this rule.
const RULES = [
  ['ci-full runs only on f/**', 'ci', /branches: \['f\/\*\*'\]/],
  ['ci-full has 16 shards', 'ci', /i: \[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15\]/],
  ['ci-full runs fullshard for its own index of 16', 'ci', /fullshard\.mjs \$\{\{ matrix\.i \}\} 16/],
  ['a red shard does not stop the others', 'ci', /continue-on-error: true/],
  ['each shard reports on r/<id>.<i>', 'ci', /refs\/heads\/r\/\$id\.\$i/],
  ['the report step runs even when the shard failed', 'ci', /name: report\n\s+if: always\(\)/],
  ['ci-full reads its data from a secret', 'ci', /secrets\.STORE_URL/],
  ['private workflows are put back for the checks, never run', 'ci', /cp -r \.ci-wf\/\. \.github\//],
  ['mirror.mjs publishes ci-full.yml', 'mirror', /writeFileSync\(join\(dir, '\.github', 'workflows', 'ci-full\.yml'\)/],
  ['mirror.mjs exports runFull', 'mirror', /export async function runFull/],
  ['runFull deletes the f/ branch', 'mirror', /'DELETE', `\/repos\/\$\{repo\}\/git\/refs\/heads\/f\/\$\{id\}`/],
  ['runFull deletes every r/<id>.<i> branch', 'mirror', /'DELETE', `\/repos\/\$\{repo\}\/git\/refs\/heads\/r\/\$\{id\}\.\$\{i\}`/],
  ['mirror.mjs has a `full` command', 'mirror', /cmd === 'full'/],
  ['full.mjs goes to the mirror only for TEST_REMOTE=mirror', 'full', /MIRRORED = [^\n]*MCLITE_TEST_REMOTE === 'mirror'/],
  ['full.mjs takes the shards from runFull', 'full', /MIRRORED \? await \(await import\('\.\/mirror\.mjs'\)\)\.runFull\(\)/],
  ['missing mirror shards report nothing and fail the job (never an env fault on this PC)', 'full', /if \(MIRRORED && merged[^\n]*pack-shard[^\n]*\{\n[^\n]*process\.exit\(1\)/],
  ['with the mirror the PC job runs on the schedule, not on every master push', 'wf', /github\.event_name == 'push' && vars\.TEST_REMOTE != 'mirror'\) \|\| \(github\.event_name == 'schedule' && vars\.TEST_REMOTE == 'mirror'/],
  ['FULL_MODE=off does nothing', 'full', /MODE === 'off'\) \{[^\n]*process\.exit\(0\)/],
  ['FULL_MODE=dry exits before any issue write', 'full', /if \(MODE === 'dry'\) \{[\s\S]*?process\.exit\(0\);\n\}\n(?:[\s\S]*?)const open = /],
  ['FULL_SOURCE=pc runs the suite on this PC even with TEST_REMOTE=mirror', 'full', /process\.env\.FULL_SOURCE !== 'pc' && process\.env\.MCLITE_TEST_REMOTE === 'mirror'/],
  ['the workflow passes FULL_MODE and the dispatch source', 'wf', /FULL_MODE: \$\{\{ vars\.FULL_MODE \}\}\n\s+FULL_SOURCE: \$\{\{ github\.event\.inputs\.source \}\}/],
  ['the workflow takes a source input', 'wf', /workflow_dispatch:\n\s+inputs:\n\s+source:/],
  ['the local copy is still refreshed after a mirror run', 'full', /if \(!AGG \|\| MIRRORED\) updateLocalCopy/],
  ['full-pc passes the mirror token, repo and TEST_REMOTE', 'wf', /MIRROR_TOKEN: \$\{\{ secrets\.MIRROR_TOKEN \}\}\n\s+MIRROR_REPO: \$\{\{ vars\.MIRROR_REPO \}\}\n\s+MCLITE_TEST_REMOTE: \$\{\{ vars\.TEST_REMOTE \}\}/],
  ['the landing-quiet wait is skipped on the mirror', 'wf', /fullgate\)\n\s+if: vars\.TEST_REMOTE != 'mirror'/],
];
const failing = (fs) => RULES.filter(([, k, re]) => !re.test(fs[k])).map((r) => r[0]);
const real = failing(files);
ok(real.length === 0, `wiring broken: ${real.join(' | ')}`);
ok(!FORBID.test(files.ci), 'ci-full.yml names the owner, an account or a path');
// the shard merge: all 16 present = no setup fault; one gone = exactly that shard is reported missing
const d = mkdtempSync(join(tmpdir(), 'fmc-'));
for (let i = 0; i < 16; i++) { writeFileSync(join(d, `shard-${i}.json`), JSON.stringify({ i, ran: 10, failed: i === 3 ? ['x-red'] : [], skippedInSlice: [] })); writeFileSync(join(d, `shard-${i}.log`), `log ${i}`); }
let m = mergeShards(d);
ok(m.ledger.ran === 160 && m.ledger.failedStages.join() === 'x-red', 'all 16 shards merge to 160 ran and only the real red');
writeFileSync(join(d, 'shard-9.json'), '{}'); // present but empty: still a shard
const d2 = mkdtempSync(join(tmpdir(), 'fmc-')); for (let i = 0; i < 16; i++) if (i !== 11) writeFileSync(join(d2, `shard-${i}.json`), JSON.stringify({ i, ran: 1, failed: [], skippedInSlice: [] }));
m = mergeShards(d2);
ok(m.ledger.failedStages.join() === 'pack-shard-11-missing', 'a shard that never reported is pack-shard-11-missing, not green');
// anti-vacuity: break each rule's own text and the rule must be the one that fails
let breaks = 0;
for (const [name, k, re] of RULES) {
  const broken = { ...files, [k]: files[k].replace(re, '') };
  const f = failing(broken);
  ok(f.includes(name), `deleting what "${name}" demands is not caught`);
  if (f.includes(name)) breaks++;
}
console.log(`fullmirrorcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
