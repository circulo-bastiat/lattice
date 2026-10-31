// tools/packhomecheck.mjs - #8992: RUNS tools/infra/mirror/pack-home.sh and pack-slot.sh (the hosted worker's home and per-slot sequence) in bash with stub tools, on a
// temp dir. worker-pack.yml had never started a worker: a hosted runner has no ~/.brain (launch.mjs needs tokens/<account>.txt and github-token), no Claude CLI and nobody ran
// `go.mjs start` first. The mirror's job log is public, so every case also asserts that nothing reaches stdout. Anti-vacuity: each rule is broken in a copy of the scripts.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { home: rd('./infra/mirror/pack-home.sh'), slot: rd('./infra/mirror/pack-slot.sh'), yml: rd('./infra/mirror/worker-pack.yml') };
if (process.platform === 'win32') { console.log('packhomecheck: NOT RUN on Windows (needs bash + flock); the mirror runs it in core'); process.exit(0); }
const hasFlock = spawnSync('bash', ['-c', 'command -v flock'], { encoding: 'utf8' }).status === 0;
if (!hasFlock) { console.log('packhomecheck: FAIL, flock is missing (util-linux): the hosted pack and the VM both need it'); process.exit(1); }
const sh = (cwd, script, env = {}) => spawnSync('bash', ['-c', script], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd, ...env } });
function verdict(S) {
  const bad = [], root = mkdtempSync(join(tmpdir(), 'phc-'));
  try {
    writeFileSync(join(root, 'home.sh'), S.home); writeFileSync(join(root, 'slot.sh'), S.slot);
    // ---- pack_home
    const bh = join(root, 'bh1');
    const h1 = sh(root, `. ./home.sh; pack_home; echo "rc=$?"`, { BRAIN_HOME: bh, CLAUDE_TOKEN_MAX: 'TOK-MAX', CLAUDE_TOKEN_PRO: 'TOK-PRO', MCLITE_PAT: 'PAT-1', MIRROR_REPO: 'o/lat', MIRROR_TOKEN: 'MT-1' });
    const f = (n) => { try { return readFileSync(join(bh, n), 'utf8'); } catch { return null; } };
    if (!/rc=0/.test(h1.stdout)) bad.push('pack_home fails with all secrets present');
    if (f('tokens/max.txt') !== 'TOK-MAX' || f('tokens/pro.txt') !== 'TOK-PRO') bad.push('pack_home does not write tokens/<account>.txt');
    if (f('github-token') !== 'PAT-1') bad.push('pack_home does not write github-token');
    if (f('mirror-repo') !== 'o/lat' || f('mirror-token') !== 'MT-1') bad.push('pack_home does not write the mirror pair');
    if (existsSync(join(bh, 'github-token')) && (statSync(join(bh, 'github-token')).mode & 0o077)) bad.push('pack_home writes the PAT readable by others (umask)');
    if (h1.stdout.replace(/rc=\d+\n?/, '').trim() || h1.stderr.trim()) bad.push('pack_home prints to the public log');
    const h2 = sh(root, `. ./home.sh; pack_home; echo "rc=$?"`, { BRAIN_HOME: join(root, 'bh2'), CLAUDE_TOKEN_MAX: 'T' });
    if (!/rc=[1-9]/.test(h2.stdout)) bad.push('pack_home succeeds without a GitHub token');
    const h3 = sh(root, `. ./home.sh; pack_home; echo "rc=$?"`, { BRAIN_HOME: join(root, 'bh3'), MCLITE_PAT: 'P' });
    if (!/rc=[1-9]/.test(h3.stdout)) bad.push('pack_home succeeds without any Claude token');
    const h4 = sh(root, `. ./home.sh; pack_home; echo "rc=$?"`, { BRAIN_HOME: join(root, 'bh4'), CLAUDE_TOKEN_PRO: 'T', MCLITE_PAT: 'P', MIRROR_TOKEN: 'M' });
    if (existsSync(join(root, 'bh4', 'mirror-token'))) bad.push('pack_home writes a mirror token without a mirror repo');
    // ---- pack_slot with stub tools
    const run = (mode, { pre = '', rc = 0, pin = '', account = '' } = {}) => {
      const d = join(root, 'slot-' + Math.random().toString(36).slice(2)), out = join(d, 'out'), bhd = join(d, 'bh');
      mkdirSync(join(d, '.git'), { recursive: true }); mkdirSync(join(d, 'tools', 'infra'), { recursive: true }); mkdirSync(join(d, 'tools', 'brain'), { recursive: true }); mkdirSync(out); mkdirSync(bhd);
      writeFileSync(join(bhd, 'github-token'), 'PAT-2');
      writeFileSync(join(d, 'tools', 'go.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(out, 'go.args'))}, process.argv.slice(2).join(' ')+'\\n'); const m=${JSON.stringify(mode)}; if(m==='noclaim'){console.log('nothing to claim: BRIEF-SECRET');process.exit(1)} if(m==='fail'){console.log('boom BRIEF-SECRET');process.exit(1)} console.log('## YOUR ISSUE #5 BRIEF-SECRET');`);
      writeFileSync(join(d, 'tools', 'infra', 'prelaunch.mjs'), `console.log(${JSON.stringify(pre)})`);
      writeFileSync(join(d, 'tools', 'brain', 'launch.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(join(out, 'launch.args'))}, process.argv.slice(2).join(' ')+'\\n'); console.log('LAUNCH-SECRET'); process.exit(${rc});`);
      writeFileSync(join(d, 'tools', 'brain', 'home.mjs'), `import {appendFileSync} from 'node:fs'; export const post = async (to, text) => appendFileSync(${JSON.stringify(join(out, 'posts.txt'))}, to + ': ' + text + '\\n');`);
      spawnSync('git', ['init', '-q'], { cwd: d });
      const r = sh(d, `. ${root}/slot.sh; export BRAIN_HOME=${bhd} ACCOUNT=${account}; pack_slot ${d} ${pin}; echo "rc=$?"`, { PATH: process.env.PATH });
      const rf = (n) => { try { return readFileSync(join(out, n), 'utf8'); } catch { return ''; } };
      return { r, rc: +(/rc=(\d+)/.exec(r.stdout) || [])[1], go: rf('go.args'), launch: rf('launch.args'), posts: rf('posts.txt'), noclaim: existsSync(join(bhd, `noclaim-${account || 'default'}`)), quiet: !/SECRET/.test(r.stdout + r.stderr) };
    };
    const a = run('noclaim'); if (a.rc !== 0 || !a.noclaim || a.launch || !/^log: noclaim: default \(/.test(a.posts) || a.posts.trim().split('\n').length !== 1) bad.push('nothing to claim: must end 0, write the noclaim marker, start nothing and post exactly one `noclaim: <account>` line (#9735: the fill turns it into the hold of a mirror pool)');
    const b = run('fail'); if (b.rc !== 0 || b.launch || !/not started/.test(b.posts) || !/boom/.test(b.posts)) bad.push('a failed go.mjs start must post its last lines to the private bus and start no Claude');
    const c = run('ok', { pre: 'SATISFIED x' }); if (c.launch || c.rc !== 0) bad.push('a SATISFIED prelaunch must not start Claude');
    const d1 = run('ok', { account: 'max', pin: '42' });
    if (!/--role worker/.test(d1.launch) || !/--account max/.test(d1.launch)) bad.push('launch.mjs is not started as `--role worker --account <name>`');
    if (!/--issue 42/.test(d1.go)) bad.push('a pinned issue is not passed to go.mjs start');
    const d2 = run('ok'); if (/--account/.test(d2.launch)) bad.push('--account is passed when no account was given');
    const e = run('ok', { rc: 7 }); if (e.rc !== 7 || !/launch FAILED/.test(e.posts) || !/exit 7/.test(e.posts)) bad.push('a failing launch must return its code and post it to the private bus');
    for (const [n, x] of [['noclaim', a], ['fail', b], ['ok', d1], ['launch fail', e]]) if (!x.quiet) bad.push(`pack_slot (${n}) lets brief or launch output reach the public log`);
    // ---- the workflow wires it, and sets nothing public
    if (!/pack-home\.sh/.test(S.yml) || !/pack-slot\.sh/.test(S.yml) || !/pack_home \|\|/.test(S.yml)) bad.push('worker-pack.yml does not source and run the home and slot scripts');
    if (!/claude-code/.test(S.yml)) bad.push('worker-pack.yml does not install the Claude CLI');
    if (!/bootstrap\.mjs --store/.test(S.yml)) bad.push('worker-pack.yml does not prepare the game data');
    for (const s of ['MCLITE_PAT', 'MCLITE_SRC', 'CLAUDE_TOKEN_MAX', 'CLAUDE_TOKEN_PRO', 'STORE_URL']) if (!new RegExp(`secrets\\.${s}`).test(S.yml)) bad.push(`worker-pack.yml never reads secret ${s}`);
    if (/toJSON\(secrets\)/.test(S.yml)) bad.push('worker-pack.yml passes ALL secrets to the step (toJSON(secrets))');
  } finally { rmSync(root, { recursive: true, force: true }); }
  return bad;
}
const sub = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error('break target missing: ' + a); return { ...S, [k]: S[k].replace(a, b) }; };
const BREAKS = [
  ['no max token', sub('home', '> "$h/tokens/max.txt"', '> /dev/null')],
  ['no PAT file', sub('home', '> "$h/github-token"', '> /dev/null')],
  ['world-readable', sub('home', 'umask 077; ', '')],
  ['succeeds without a PAT', sub('home', '[ -s "$h/github-token" ] && ', '')],
  ['succeeds without Claude tokens', sub('home', ' && { [ -s "$h/tokens/max.txt" ] || [ -s "$h/tokens/pro.txt" ]; }', '')],
  ['mirror token alone', sub('home', '[ -n "$MIRROR_REPO" ] && [ -n "$MIRROR_TOKEN" ]', '[ -n "$MIRROR_TOKEN" ]')],
  ['no noclaim marker', sub('slot', 'date +%s > "$BRAIN_HOME/noclaim-${ACCOUNT:-default}"; ', '')],
  ['failed start not posted', sub('slot', 'pack_post "brain: packed worker not started', ': "brain: packed worker not started')],
  ['pin ignored', sub('slot', '${pin:+--issue "$pin"}', '')],
  ['account dropped', sub('slot', '${ACCOUNT:+--account "$ACCOUNT"}', '')],
  ['prelaunch ignored', sub('slot', "grep -q '^SATISFIED'", 'grep -q "^NEVER-MATCHES"')],
  ['launch rc lost', sub('slot', '  return $rc\n}', '  return 0\n}')],
  ['launch failure not posted', sub('slot', 'pack_post "brain: packed worker launch FAILED', ': "brain: packed worker launch FAILED')],
  ['brief printed', sub('slot', '> .git/mclite-brief.txt 2>&1', '2>&1 | tee .git/mclite-brief.txt')],
  ['launch printed', sub('slot', '> .git/launch.log 2>&1; rc=$?', '2>&1 | tee .git/launch.log; rc=${PIPESTATUS[0]}')],
  ['claude cli not installed', sub('yml', 'npm install -g @anthropic-ai/claude-code', 'true')],
  ['all secrets passed', sub('yml', 'MIRROR_REPO: ${{ github.repository }}', 'MIRROR_REPO: ${{ github.repository }}\n          TOKENS: ${{ toJSON(secrets) }}')],
  ['data not prepared', sub('yml', 'bootstrap.mjs --store', 'bootstrap.mjs --nostore')],
];
const real = verdict(SRC); let caught = 0;
for (const [n, mk] of BREAKS) { let m; try { m = mk(SRC); } catch (e) { console.log(' BAD BREAK:', n, e.message); continue; } if (verdict(m).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`packhomecheck: ${real.length} failed; ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
