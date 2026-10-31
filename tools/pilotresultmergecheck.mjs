#!/usr/bin/env node
// pilotresultmergecheck.mjs - #9716: a farm PR whose pilot result file was already landed by another run (add/add, same inputs hash + salt) is finished by
// the lander's list merge keeping master's result (22 Oct: #9590, 242 results, orphaned since 15:01). Any other conflict still stops the merge. Real git repo.
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const INFRA = join(dirname(fileURLToPath(import.meta.url)), 'infra'), SRC = readFileSync(join(INFRA, 'listmerge.mjs'), 'utf8');
let asserts = 0, fails = 0, breaks = 0, k = 0; const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
async function cases(src) {
  const d = mkdtempSync(join(tmpdir(), 'prm-')), bad = [];
  try {
    for (const f of readdirSync(INFRA).filter((x) => x.endsWith('.mjs'))) copyFileSync(join(INFRA, f), join(d, f));
    writeFileSync(join(d, `listmerge${k}.mjs`), src); const { mergeLists } = await import(pathToFileURL(join(d, `listmerge${k++}.mjs`)).href);
    const r = join(d, 'repo'); mkdirSync(join(r, 'tools/referee/lockstep/pilot-results/h'), { recursive: true });
    const g = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: r, encoding: 'utf8' });
    const P = 'tools/referee/lockstep/pilot-results/h/';
    g('init', '-q', '-b', 'master'); g('config', 'user.name', 't'); g('config', 'user.email', 't@t'); writeFileSync(join(r, 'a.txt'), 'a\n'); g('add', '-A'); g('commit', '-qm', 'base');
    g('checkout', '-q', '-b', 'farm'); writeFileSync(join(r, P + 'x-1.json'), '{"run":"farm"}\n'); writeFileSync(join(r, P + 'x-2.json'), '{"run":"farm"}\n'); g('add', '-A'); g('commit', '-qm', 'farm');
    g('checkout', '-q', 'master'); mkdirSync(join(r, P), { recursive: true }); writeFileSync(join(r, P + 'x-1.json'), '{"run":"worker"}\n'); g('add', '-A'); g('commit', '-qm', 'worker');
    const m = g('merge', '--no-ff', '-q', '-m', 'land', 'farm'); const why = m.status ? mergeLists(r) : '';
    const t = (n, c) => { if (!c) bad.push(n); };
    t('the add/add result conflict is finished', m.status !== 0 && why === '');
    t("master's (first landed) result is kept", readFileSync(join(r, P + 'x-1.json'), 'utf8').includes('worker'));
    t("the PR's new results land", readFileSync(join(r, P + 'x-2.json'), 'utf8').includes('farm'));
    t('nothing is left conflicted', g('diff', '--name-only', '--diff-filter=U').stdout.trim() === '');
    // any other conflict still stops
    g('checkout', '-q', '-b', 'side', 'HEAD~1'); writeFileSync(join(r, 'a.txt'), 'side\n'); g('commit', '-qam', 's'); g('checkout', '-q', 'master'); writeFileSync(join(r, 'a.txt'), 'main\n'); g('commit', '-qam', 'm');
    const m2 = g('merge', '--no-ff', '-q', '-m', 'x', 'side'); t('a conflict outside the results still stops the merge', m2.status !== 0 && mergeLists(r) !== '');
  } catch (e) { bad.push('threw: ' + String(e.message).slice(0, 120)); } finally { rmSync(d, { recursive: true, force: true }); }
  return bad;
}
const real = await cases(SRC); ok(real.length === 0, 'listmerge: ' + real.join('; '));
const brk = SRC.replace(/  for \(const f of u\.filter\(\(x\) => RESULT\.test\(x\) && isAddAdd\(x\)\)\)[^\n]*\n/, '');
if (brk === SRC) ok(false, 'break did not apply'); else { const b = await cases(brk); ok(b.length > 0, 'cases cannot tell a listmerge without the result rule'); if (b.length) { breaks++; console.log('  ✓ listmerge without the result rule is caught: ' + b[0]); } }
console.log(`pilotresultmergecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
