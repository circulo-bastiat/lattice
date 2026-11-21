// tools/brainsyntaxcheck.mjs (#9287) - every .mjs under tools/brain and tools/infra must parse (node --check).
// 21 Oct: #9245 landed a stray `try { catch` in brain.mjs; every brain tick died with SyntaxError for hours and nothing noticed.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const parse = (f) => { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); return r.status ? (r.stderr.split('\n').find((l) => /Error/.test(l)) || 'syntax error') : null; };
let fails = 0, n = 0;
for (const d of ['tools/brain', 'tools/infra']) for (const f of readdirSync(join(ROOT, d)).filter((x) => x.endsWith('.mjs') && !/\.brainrunscheck-/.test(x))) { // brainrunscheck writes + deletes scratch copies here while this runs (22 Oct #9421)
  if (!existsSync(join(ROOT, d, f))) continue; // a transient brain.*-N.mjs scratch file can vanish between readdir and parse
  n++; const bad = parse(join(ROOT, d, f)); if (bad) { fails++; console.log(` ✗ ${d}/${f}: ${bad}`); }
}
// breaks: the checker must catch the real mistake
const dir = mkdtempSync(join(tmpdir(), 'bsc-')); let caught = 0;
const src = readFileSync(join(ROOT, 'tools/brain/brain.mjs'), 'utf8');
for (const [name, mut] of [['stray try{ catch', (s) => s.replace(/\n/, '\n    try { catch (e) { console.log(1); }\n')], ['unclosed brace', (s) => s + '\n{ (']]) {
  const p = join(dir, 'b.mjs'); writeFileSync(p, mut(src)); if (parse(p)) { caught++; console.log(`   ✓ break caught: ${name}`); } else { fails++; console.log(`   ✗ break NOT caught: ${name}`); }
}
try { rmSync(dir, { recursive: true, force: true }); } catch {}
console.log(`brainsyntaxcheck: ${n} files, ${fails} failed, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
