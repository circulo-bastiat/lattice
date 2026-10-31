#!/usr/bin/env node
// landconflictcheck.mjs - #7872: a PR bounced for a conflict loses `land` and its issue gains `needs-rebase`; a dirty PR is never batched.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'infra', 'land.mjs'), 'utf8');
const rules = (s) => [
  ['a bounced PR loses land', /const bounceOne[^\n]*\n[^\n]*\n[^\n]*DELETE[^\n]*labels\/land/.test(s)],
  ['the issue gains needs-rebase', /const bounceOne[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*labels: \['needs-rebase'\]/.test(s)],
  ['a PR GitHub calls dirty is NOT bounced before the by-key merge (core.json-only conflicts are merged and healed)', !/mergeable_state === 'dirty'\) \{ await bounceOne/.test(s) && /const \{ members, excluded, heads \} = mergeBatch\(/.test(s)],
  ['batch-excluded conflicts are bounced', /for \(const n of excluded\)[^\n]*bounceOne/.test(s)],
];
let fails = 0, breaks = 0;
for (const [m, f] of rules(src)) if (!f) { fails++; console.log('  FAIL ' + m); }
const mut = [[/labels\/land`\)\.catch\(\(\) => \{\}\);\n  if \(issue\) await gh\('POST'/, "labels/x`).catch(() => {});\n  if (issue) await gh('POST'"], [/labels: \['needs-rebase'\]/, "labels: ['x']"], [/(    prs\.push\(\{ n, pr, issue, ref: `pr\$\{n\}` \}\);)/, "    if (pr.mergeable_state === 'dirty') { await bounceOne(n, issue, 'x', ''); continue; }\n$1"], [/for \(const n of excluded\)/, 'for (const n of [])']];
for (const [re, ...rep] of mut) {
  const bad = src.replace(re, rep[rep.length - 1]);
  if (bad !== src && rules(bad).some(([, f]) => !f)) breaks++; else { fails++; console.log('  FAIL uncaught break ' + re); }
}
console.log(`landconflictcheck: ${fails ? 'FAIL' : 'ok'}, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
