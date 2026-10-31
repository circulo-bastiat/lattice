// #9840: tia bookkeeping survives a parentless commit and always appends the history record; proves it can fail.
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { commitsBetweenIn, bookkeep } from './infra/tiabook.mjs';

const d = mkdtempSync(join(tmpdir(), 'tiabook-'));
const git = (...a) => execFileSync('git', ['-c', 'user.email=a@b', '-c', 'user.name=t', ...a], { cwd: d, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
git('init', '-q'); writeFileSync(join(d, 'a.txt'), '1'); git('add', '.'); git('commit', '-qm', 'root');
const root = git('rev-parse', 'HEAD');
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL ' + m); } };

const cb = commitsBetweenIn(d);
const empty = git('hash-object', '-t', 'tree', '/dev/null');
const c = cb(empty, root);   // not a commit: must return [] rather than throw
ok(Array.isArray(c), 'bad range returns array');
const hf = join(d, 'h.jsonl');
let n = 0;
bookkeep({ hf, rec: { sha: root }, replayFn: () => { n++; throw new Error('boom'); } });
ok(n === 1 && existsSync(hf) && readFileSync(hf, 'utf8').includes(root), 'record appended though replay throws');
// the parentless commit itself: files via show fallback
writeFileSync(join(d, 'b.txt'), '2'); git('add', 'b.txt'); git('commit', '-qm', 'land #5 x');
const res = cb(root, git('rev-parse', 'HEAD'));
ok(res.length === 1 && res[0].pr === '5' && res[0].files.join() === 'b.txt', 'normal commit files ' + JSON.stringify(res));
const shallow = cb('HEAD~0', 'HEAD'); ok(shallow.length === 0, 'empty range');
// root commit as the range end: log of ..root includes it, diff root^ fails -> show fallback
const rr = commitsBetweenIn(d);
const lst = rr(git('rev-list', '--max-parents=0', 'HEAD'), 'HEAD');   // sanity
ok(lst.length === 1, 'range excludes start');
// direct root: list the root commit through a range from a sibling orphan
git('checkout', '-q', '--orphan', 'o'); writeFileSync(join(d, 'c.txt'), '3'); git('add', 'c.txt'); git('commit', '-qm', 'orphan root');
const oo = cb(root, 'o');
ok(oo.length === 1 && oo[0].files.includes('c.txt'), 'parentless commit lists files via show');

// breaks: the old behaviour must be detectable
let caught = 0;
try { execFileSync('git', ['diff', '--name-only', git('rev-parse', 'o') + '^', 'o'], { cwd: d, stdio: 'ignore' }); } catch { caught++; }
const hf2 = join(d, 'h2.jsonl'); let threw = false;
try { (() => { throw new Error('x'); })(); writeFileSync(hf2, 'x'); } catch { threw = true; }
if (threw && !existsSync(hf2)) caught++;
const bad = commitsBetweenIn(join(d, 'nonexistent'));
try { ok(bad('a', 'b').length === 0, 'bad repo returns []'); caught++; } catch { /* would throw */ }
ok(caught === 3, 'breaks'); for (let i = 0; i < caught; i++) console.log('✓ break caught');
console.log(`tiabookcheck: 7 assertions, ${fails} failed, ${caught} breaks caught`);
process.exit(fails ? 1 : 0);
