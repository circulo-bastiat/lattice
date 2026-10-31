// landhealcheck (#9500, 22 Oct): RUNS tools/infra/landheal.mjs against a fake GitHub and checks land.mjs calls it only after GitHub refused with `merge conflicts`. One check mark per caught break.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = dirname(fileURLToPath(import.meta.url)), SRC = readFileSync(join(TOOLS, 'infra', 'landheal.mjs'), 'utf8'), LAND = readFileSync(join(TOOLS, 'infra', 'land.mjs'), 'utf8');
const T = 'a'.repeat(40), M = 'b'.repeat(40), H = 'c'.repeat(40), C = 'd'.repeat(40);
async function verdict(src, land) {
  const bad = [], t = (n, c) => { if (!c) bad.push(n); };
  const d = mkdtempSync(join(tmpdir(), 'lhc-')); writeFileSync(join(d, 'landheal.mjs'), src);
  const m = await import(pathToFileURL(join(d, 'landheal.mjs')).href + '?' + Math.random()); rmSync(d, { recursive: true, force: true });
  let pushedTree = false;   // #9656: like GitHub, the fake refuses a commit on a tree that was never pushed (422 Tree SHA does not exist)
  const sh = (c, a) => { if (a.includes('push') && a.some((x) => /^HEAD:refs\/heads\/heal\/1$/.test(x))) { pushedTree = true; return { status: 0, stdout: '' }; } return { stdout: a.join(' ').includes('HEAD^{tree}') ? T + '\n' : M + '\n' }; };
  const calls = []; const gh = async (me, p, b) => { calls.push([me, p, b]); if (me === 'POST' && /git\/commits/.test(p) && !pushedTree) throw new Error('422 Tree SHA does not exist'); return me === 'POST' ? { sha: C } : {}; };
  const pr = { head: { sha: H, ref: 'work/1-x' } }, logs = [];
  const r = await m.healBranch({ gh, sh, n: 1, pr, log: (x) => logs.push(x) });
  t('returns the new head sha', r === C);
  const post = calls.find(([me, p]) => me === 'POST' && /git\/commits/.test(p)); t('creates a commit with the tested tree', post && post[2].tree === T);
  t('its parents are the PR head and the master tip, in that order', post && JSON.stringify(post[2].parents) === JSON.stringify([H, M]));
  const patch = calls.find(([me]) => me === 'PATCH'); t('moves the PR branch ref to it, without force', patch && /git\/refs\/heads\/work\/1-x$/.test(patch[1]) && patch[2].sha === C && patch[2].force === false);
  t('never touches master', !calls.some(([, p]) => /heads\/master/.test(p)));
  t('#9683: after moving the ref it waits for GitHub to see the PR mergeable before the retry', /p\.mergeable === true && p\.head && p\.head\.sha === c\.sha/.test(src));
  t('#9656: the tested tree is pushed to a scratch ref first, and the scratch ref is deleted after', pushedTree && calls.some(([me, p]) => me === 'DELETE' && /git\/refs\/heads\/heal\/1$/.test(p)));
  const bad1 = await m.healBranch({ gh: async () => { throw new Error('nope'); }, sh, n: 1, pr, log: () => {} }); t('a GitHub failure returns null', bad1 === null);
  const bad2 = await m.healBranch({ gh, sh: () => ({ stdout: 'garbage' }), n: 1, pr, log: () => {} }); t('a bad tree or sha returns null and calls nothing', bad2 === null);
  t('land.mjs heals only on a "merge conflicts" refusal, then retries the merge once', /refused && \/merge conflicts\/i\.test\(String\(refused\.message\)\)/.test(land) && /landheal\.mjs/.test(land) && (land.match(/refused = await apiMerge\(n, pr\)/g) || []).length >= 2);
  return bad;
}
const real = await verdict(SRC, LAND); let caught = 0;
const B = [
  ['force push', SRC.replace('force: false', 'force: true'), LAND],
  ['no mergeable wait (#9683)', SRC.replace('p.mergeable === true && p.head && p.head.sha === c.sha', 'true'), LAND], ['wrong parent order', SRC.replace('[pr.head.sha, master]', '[master, pr.head.sha]'), LAND],
  ['no tree check', SRC.replace("if (!/^[0-9a-f]{40}$/.test(tree) || !/^[0-9a-f]{40}$/.test(master)) return null;", ''), LAND],
  ['failure not swallowed', SRC.replace('catch (e) { log(', 'catch (e) { throw e; log('), LAND],
  ['land.mjs heals on any refusal', SRC, LAND.replace('refused && /merge conflicts/i.test(String(refused.message))', 'refused')],
  ['the tested tree is never pushed (#9656)', SRC.replace(/const up = sh\('git', \[[^\n]*\n/, 'const up = { status: 1 };\n'), LAND],
  ['land.mjs never retries', SRC, LAND.replace('refused = await apiMerge(n, pr); } } catch', '} } catch')],
];
for (const [n, s, l] of B) { let r; try { r = await verdict(s, l); } catch { r = ['threw']; } if (r.length) { caught++; console.log(' \u2713 break caught: ' + n); } else console.log(' NOT CAUGHT: ' + n); }
for (const x of real) console.log(' FAIL: ' + x);
// #9683: the BATCH path heals a member GitHub refused (every member edits the one-line core.json) with that member's own tested commit,
// and only while GitHub's master is exactly what the batch pushed so far. mergeBatch must record each member's local merge commit.
{
  const LB = readFileSync(join(TOOLS, 'infra', 'landbatch.mjs'), 'utf8');
  const runMB = async (src) => { const d = mkdtempSync(join(tmpdir(), 'lhb-')); writeFileSync(join(d, 'landbatch.mjs'), src); const m = await import(pathToFileURL(join(d, 'landbatch.mjs')).href + '?' + Math.random()); rmSync(d, { recursive: true, force: true });
    let k = 0; const sh = (c, a) => (a[0] === 'rev-parse' ? { status: 0, stdout: `sha${k}\n` } : (a[0] === 'merge' && a.includes('--no-ff') ? (k++, { status: 0 }) : { status: 0 }));
    return m.mergeBatch(sh, [{ n: 1, ref: 'p1' }, { n: 2, ref: 'p2' }]); };
  const bv = async (lb, land) => { const bad = []; let r; try { r = await runMB(lb); } catch { r = {}; }
    if (!(r.heads && r.heads[1] === 'sha1' && r.heads[2] === 'sha2')) bad.push('mergeBatch does not record each member\'s merge commit');
    if (!/const \{ members, excluded, heads \} = mergeBatch\(/.test(land)) bad.push('landBatch does not take the heads');
    if (!/healBranch\(\{ gh, sh, n, pr: p\.pr, head: heads\[n\], master: cur \}\)/.test(land)) bad.push('the batch path does not heal a refused member with its own tested commit');
    if (!/if \(cur === expect\)/.test(land) || !/expect = lastMergeSha \|\| expect/.test(land)) bad.push('the batch heal does not check that master is exactly what the batch pushed');
    return bad; };
  const rb = await bv(LB, LAND); for (const x of rb) console.log(' FAIL (batch): ' + x);
  let bc = 0; const BB = [['heads not recorded', LB.replace(/heads\[it\.n\] = head\(\); continue;/, 'continue;'), LAND], ['no batch heal', LB, LAND.replace('healBranch({ gh, sh, n, pr: p.pr, head: heads[n], master: cur })', 'null')], ['no master guard', LB, LAND.replace('if (cur === expect)', 'if (true)')]];
  for (const [n, l, p] of BB) { const r = await bv(l, p); if (r.length) { bc++; console.log(' ✓ break caught: ' + n); } else console.log(' NOT CAUGHT: ' + n); }
  console.log(`landhealcheck (batch #9683): ${rb.length ? 'FAILED' : 'ok'} ${bc} breaks caught (of ${BB.length})`);
  if (rb.length || bc < BB.length) process.exitCode = 1;
}

console.log(`landhealcheck: ${real.length ? 'FAILED' : 'ok'} ${caught} breaks caught (of ${B.length})`);
process.exit(real.length || caught < B.length || process.exitCode ? 1 : 0);

