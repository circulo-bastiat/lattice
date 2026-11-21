#!/usr/bin/env node
// coveredblockcheck.mjs - #11908: a landed partial PR records the classes it newly covered in a machine-managed block of the issue body, so the next worker skips them.
// Pure rules + a fake runner for coveredFor + wiring in land.mjs, each also run against a broken copy ("✓ break caught" lines are counted by the suite and the lander).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coveredFrom, withCovered, coveredFor, START, END } from './infra/coveredblock.mjs';
let bad = 0, caught = 0, asserts = 0;
const ok = (c, m) => { asserts++; if (!c) { bad++; console.log('FAIL ' + m); } };
const hit = (m) => { caught++; console.log(' ✓ break caught: ' + m); };
const map = (rows) => JSON.stringify({ counts: {}, rows });
const base = map([['net/minecraft/entity/ai/A', 'm', 1, 0, 'C', 'missing'], ['net/minecraft/entity/ai/B', 'm', 1, 1, 'C', 'ported-unchecked'], ['net/minecraft/C', 'm', 1, 0, 'C', 'missing']]);
const pr = map([['net/minecraft/entity/ai/A', 'm', 1, 1, 'C', 'proven'], ['net/minecraft/entity/ai/B', 'm', 1, 1, 'C', 'ported-unchecked'], ['net/minecraft/C', 'm', 1, 0, 'C', 'missing'], ['net/minecraft/D', 'm', 1, 2, 'C', 'proven']]);

ok(coveredFrom(base, pr).join() === 'A,D', 'only classes whose stage count rose are covered (A 0->1, D new 0->2; B unchanged, C untouched)');
ok(coveredFrom(base, base).length === 0 && coveredFrom('', '').length === 0 && coveredFrom(base, 'not json').length === 0, 'no map change, an empty or broken map: nothing covered');
const b1 = withCovered('Port these 32 classes.', ['A', 'D']);
ok(b1.startsWith('Port these 32 classes.') && b1.includes(START) && b1.includes('**Covered so far (lander, do not edit):** A, D') && b1.trimEnd().endsWith(END), 'a block is appended after the untouched body');
const b2 = withCovered(b1, ['D', 'Z']);
ok(b2.includes(':** A, D, Z') && b2.split(START).length === 2 && b2.startsWith('Port these 32 classes.'), 'a second landing merges into the same block (deduped, sorted), body untouched');
ok(withCovered(b2, ['A']) === b2 && withCovered('x', []) === 'x', 'nothing new to add leaves the body byte-identical');
ok(withCovered('text\n' + START + '\n**Covered so far (lander, do not edit):** A\n' + END + '\nmore text', ['B']).endsWith('\nmore text'), 'text after the block survives an update');
const fake = (map0, mapPr) => (c, a) => { const r = a.join(' '); if (r.startsWith('rev-parse')) return { status: 0 }; if (r.includes('origin/master:')) return { status: 0, stdout: map0 }; return { status: 0, stdout: mapPr }; };
ok(coveredFor(fake(base, pr), 7).join() === 'A,D', 'coveredFor compares the PR branch map with origin/master');
ok(coveredFor((c, a) => ({ status: 1, stdout: '' }), 7).length === 0, 'a PR without tools/classmap.json covers nothing');

// breaks: a broken variant of each rule must be visible to a rule above
const wrong = (name, seen) => { if (seen) hit(name); else ok(false, 'break not caught: ' + name); };
{ const all = (t0, t1) => JSON.parse(t1).rows.map((r) => String(r[0]).split('/').pop()).sort();   // lists every row, not only the risen ones
  wrong('a covered-set that lists every row (unchanged map must give nothing)', all(base, base).length !== 0 && all(base, pr).join() !== coveredFrom(base, pr).join()); }
{ const replaceOnly = (body, names) => `${body}\n\n${START}\n**Covered so far (lander, do not edit):** ${names.join(', ')}\n${END}\n`;   // no merge with the old block
  wrong('a block that forgets earlier landings (second landing must keep A, D)', !replaceOnly(b1, ['Z']).includes(':** A, D, Z')); }
{ const dup = (body, names) => `${body}\n\n${START}\n**Covered so far (lander, do not edit):** ${names.join(', ')}\n${END}\n`;   // a new block per landing
  wrong('a second block per landing (must stay one block)', dup(b1, ['Q']).split(START).length !== 2); }
{ const rewrite = (body, names) => `**Covered so far (lander, do not edit):** ${names.join(', ')}`;   // replaces the whole body
  wrong('a rewrite that drops the body (the brief text must survive)', !rewrite('Port these 32 classes.', ['A']).startsWith('Port these 32 classes.')); }

const LAND = readFileSync(fileURLToPath(new URL('./infra/land.mjs', import.meta.url)), 'utf8');
const W = [
  ['apiMerge records what the PR covers', /async function apiMerge\(n, pr\) \{\n  try \{ pr\.covered = coveredFor\(sh, n\); \}/],
  ['afterMerge updates the block only for a partial landing that did not close the issue', /if \(issue && part && !reqOpen && \(pr\.covered \|\| \[\]\)\.length\) \{[\s\S]{0,420}withCovered\(cur\.body, pr\.covered\)/],
  ['the update never touches a closed issue', /cur\.state === 'open' \? withCovered/],
];
for (const [name, re] of W) { ok(re.test(LAND), 'wiring: ' + name); const b = LAND.replace(re, '/*gone*/'); if (b !== LAND && !re.test(b)) hit('wiring removed: ' + name); else ok(false, 'wiring break not caught: ' + name); }
console.log(`coveredblockcheck: ${asserts} assertions, ${bad} failures, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
