#!/usr/bin/env node
// ghallcheck.mjs - 13 Oct: the brain's rebase sweep died with "Spread syntax requires ...iterable[Symbol.iterator]" because
// gh() returns {} for an empty/unparsable 200 body and ghAll() spread it. ghAll must retry a non-list page, and when it
// stays non-list throw a readable error. ANTI-VACUITY: the pre-fix ghAll (spread, no retry) must fail the same scenarios.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

process.env.GH_TOKEN = 'stub';
const GH = join(dirname(fileURLToPath(import.meta.url)), 'infra', 'gh.mjs');
const src = readFileSync(GH, 'utf8');
const T = mkdtempSync(join(tmpdir(), 'ghall-'));
const J = (b, s = 200) => new Response(typeof b === 'string' ? b : JSON.stringify(b), { status: s });
const scenarios = async (M) => {
  const bad = [], real = globalThis.fetch;
  try {
    let n = 0;
    globalThis.fetch = async () => (++n === 1 ? J('<html>bad gateway page</html>') : J([{ number: 1 }, { number: 2 }]));
    const r = await M.ghAll('/repos/{repo}/pulls?state=open').catch((e) => e);
    if (!Array.isArray(r) || r.length !== 2) bad.push('a transient non-list page was not retried: ' + (r && r.message || JSON.stringify(r)));
    globalThis.fetch = async () => J('');
    const e = await M.ghAll('/repos/{repo}/pulls?state=open').then(() => null, (x) => x);
    if (!e) bad.push('a permanently non-list answer did not throw');
    else if (!/non-list answer/.test(e.message)) bad.push('the error is not readable: ' + e.message);
  } finally { globalThis.fetch = real; }
  return bad;
};
const load = async (name, code) => { const f = join(T, name + '.mjs'); writeFileSync(f, code); return import(pathToFileURL(f).href); };
const fails = await scenarios(await load('real', src));
const old = src.replace(/let page;[\s\S]*?out\.push\(\.\.\.page\);/, "const page = await gh('GET', `${path}${sep}per_page=100&page=${p}`);\n    out.push(...page);");
let caught = 0;
if (old === src) fails.push('the pre-fix copy could not be built (gh.mjs changed shape)');
else if ((await scenarios(await load('old', old))).length) { caught++; console.log('  ✓ break caught: spread without retry'); } else fails.push('break NOT caught: pre-fix ghAll passed');
rmSync(T, { recursive: true, force: true });
console.log(`ghallcheck: ${caught} breaks caught (of 1)`);
for (const f of fails) console.log(`  ✗ ${f}`);
console.log(` assertions passed .... ${3 - fails.filter((f) => !f.startsWith("break")).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
