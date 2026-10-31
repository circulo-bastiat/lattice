#!/usr/bin/env node
// matrixlivecheck.mjs - #9733: the full run's proof matrix reaches every clone (branch `proof` -> .ledger/matrix-live.json) and go.mjs reads the newest
// copy for status, the tester gate and GATE-AUTO. Cases on matrixlive.mjs with a fake GitHub + a temp clone; wiring of go.mjs/full.mjs. Breaks below.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const T = dirname(fileURLToPath(import.meta.url)), SRC = readFileSync(join(T, 'infra', 'matrixlive.mjs'), 'utf8');
const GO = readFileSync(join(T, 'go.mjs'), 'utf8'), FULL = readFileSync(join(T, 'infra', 'full.mjs'), 'utf8');
let asserts = 0, fails = 0, breaks = 0, k = 0; const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const OLD = { full: true, sha: 'old', builtAt: '2026-10-22T10:00:00Z', proven: 0 }, NEW = { full: true, sha: 'new', builtAt: '2026-10-22T21:53:46Z', proven: 15 };
async function cases(src) {
  const d = mkdtempSync(join(tmpdir(), 'mlc-')), bad = []; const t = (n, c) => { if (!c) bad.push(n); };
  try {
    writeFileSync(join(d, `ml${k}.mjs`), src); const M = await import(pathToFileURL(join(d, `ml${k++}.mjs`)).href);
    const root = join(d, 'clone'); mkdirSync(join(root, 'tools', 'mobproof'), { recursive: true }); writeFileSync(join(root, 'tools', 'mobproof', 'matrix.json'), JSON.stringify(OLD));
    const calls = []; const branch = { date: NEW.builtAt }; let exists = true;
    const gh = async (m, p, b) => { calls.push(m + ' ' + p); if (p.includes('/branches/proof')) return exists ? { commit: { commit: { committer: { date: branch.date } } } } : null;
      if (p.startsWith('/repos/{repo}/contents/matrix.json?ref=proof')) return m === 'GET' ? (exists ? { sha: 'S1', content: Buffer.from(JSON.stringify(NEW)).toString('base64') } : null) : {};
      if (p.includes('/git/ref/heads/master')) return { object: { sha: 'M' } }; return {}; };
    t('no live copy: the committed matrix', M.loadMatrix(root).sha === 'old');
    const r = await M.refreshMatrix(gh, root);
    t('a newer branch copy is downloaded and wins', r && r.sha === 'new' && M.loadMatrix(root).sha === 'new');
    t('it lands in .ledger (untracked), never in tools/', existsSync(join(root, '.ledger', 'matrix-live.json')) && JSON.parse(readFileSync(join(root, 'tools', 'mobproof', 'matrix.json'), 'utf8')).sha === 'old');
    const n0 = calls.filter((c) => c.includes('contents')).length; await M.refreshMatrix(gh, root);
    t('an unchanged branch is not downloaded again', calls.filter((c) => c.includes('contents')).length === n0);
    t('a failing GitHub never throws', (await M.refreshMatrix(async () => { throw new Error('x'); }, root)).sha === 'new');
    exists = false; calls.length = 0; await M.publishMatrixBranch(gh, NEW);
    t('publish creates the branch from master when missing, then PUTs matrix.json on it', calls.includes('POST /repos/{repo}/git/refs') && calls.some((c) => c === 'PUT /repos/{repo}/contents/matrix.json'));
    t('a partial matrix is never published', (await M.publishMatrixBranch(gh, { ...NEW, full: false })) !== 'published');
  } catch (e) { bad.push('threw: ' + String(e.message).slice(0, 100)); } finally { rmSync(d, { recursive: true, force: true }); }
  return bad;
}
const real = await cases(SRC); ok(real.length === 0, 'matrixlive: ' + real.join('; '));
for (const [n, s] of [['loadMatrix ignores the live copy', SRC.replace('return at(a) >= at(b) ? (a || b) : b;', 'return b;')], ['refresh never downloads', SRC.replace("if (c && c.content) {", 'if (false) {')], ['partial matrices published', SRC.replace("if (!mx || !mx.full) return 'not a full matrix';", '')]]) {
  if (s === SRC) { ok(false, 'break did not apply: ' + n); continue; } const b = await cases(s); ok(b.length > 0, `cases cannot tell "${n}"`); if (b.length) { breaks++; console.log(`  ✓ "${n}" caught: ${b[0]}`); } }
const W = [['GATE-AUTO reads the live matrix', GO, /matrix = await \(await import\('\.\/infra\/matrixlive\.mjs'\)\)\.refreshMatrix\(gh, ROOT\)/], ['the tester gate reads it', GO, /const M = \(await import\('\.\/infra\/matrixlive\.mjs'\)\)\.loadMatrix\(ROOT\); console\.log\(`tester gate:/],
  ['status ages it by builtAt', GO, /refreshMatrix\(gh, ROOT\), t = m && m\.full \? Date\.parse\(m\.builtAt \|\| ''\) : 0; if \(t\) over\.matrix = t;/], ['full.mjs publishes it to the proof branch', FULL, /publishMatrixBranch\(gh, fullMatrix\)/]];
for (const [n, s, re] of W) { ok(re.test(s), n); const br = s.replace(re, 'X'); if (br !== s && !re.test(br)) { breaks++; console.log(`  ✓ wiring "${n}" removed is caught`); } }
console.log(`matrixlivecheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
