// tools/tickstatemtimecheck.mjs - #10653 (30 Oct): the hosted tick restores BRAIN_HOME with `git clone`, which stamps every file with the clone time, while brain.mjs
// noClaimHold reads a noclaim marker's age from its mtime: every marker looked fresh on every tick and held its pool forever (no hosted worker 22:50Z-03:48Z).
// `tick-state.sh restore` must give each noclaim-* marker the age written INSIDE it (epoch s from `date +%s`, or ms from fillReserve). Anti-vacuity below.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SRC = readFileSync(new URL('./infra/mirror/tick-state.sh', import.meta.url), 'utf8');
const run = (cmd, args, cwd) => spawnSync(cmd, args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
const G = ['-c', 'user.name=t', '-c', 'user.email=t@x', '-c', 'commit.gpgsign=false'];
const verdict = (script) => {
  const bad = [], root = mkdtempSync(join(tmpdir(), 'tsm-'));
  try {
    const now = Math.floor(Date.now() / 1000), old = now - 5 * 3600, recent = now - 60;
    const origin = join(root, 'origin'); mkdirSync(join(origin, 'home'), { recursive: true });
    run('git', ['init', '-q', '-b', 'usage-data'], origin);
    writeFileSync(join(origin, 'home', 'noclaim-max'), String(old));           // seconds, 5 h old
    writeFileSync(join(origin, 'home', 'noclaim-pro'), String(old * 1000));    // milliseconds, 5 h old
    writeFileSync(join(origin, 'home', 'noclaim-default'), String(recent));    // seconds, 1 min old: still a live hold
    writeFileSync(join(origin, 'home', 'history.json'), '{}');
    run('git', [...G, 'add', '-A'], origin); run('git', [...G, 'commit', '-qm', 'state'], origin);
    run('git', ['clone', '-q', origin, join(root, 'work')], root);
    writeFileSync(join(root, 'ts.sh'), script);
    const r = run('bash', [join(root, 'ts.sh'), 'restore'], root);
    if (r.status !== 0) { bad.push('restore exited ' + r.status + ' ' + String(r.stderr).slice(0, 120)); return bad; }
    const age = (n) => { try { return Date.now() / 1000 - statSync(join(root, 'ud', 'home', n)).mtimeMs / 1000; } catch { return -1; } };
    if (!(age('noclaim-max') > 4.5 * 3600)) bad.push('a seconds marker 5 h old looks fresh after restore (clone time won)');
    if (!(age('noclaim-pro') > 4.5 * 3600)) bad.push('a milliseconds marker 5 h old looks fresh after restore');
    if (!(age('noclaim-default') > 30 && age('noclaim-default') < 20 * 60)) bad.push('a marker written 1 min ago must stay a live hold (age ' + Math.round(age('noclaim-default')) + ' s)');
    if (age('history.json') < 0) bad.push('history.json was not restored');
  } finally { rmSync(root, { recursive: true, force: true }); }
  return bad;
};
const BREAKS = [
  ['no mtime fix at all', SRC.replace(/    for f in ud\/home\/noclaim-\*;.*\n/, '    ;;\n').replace('mkdir -p ud/home\n', 'mkdir -p ud/home\n')],
  ['ms markers not divided', SRC.replace('v=$((v / 1000)); ', '')],
  ['every marker aged 1 h', SRC.replace('touch -d "@$v"', 'touch -d "@$((v - 3600))"')],
  ['every marker made old', SRC.replace('touch -d "@$v"', 'touch -d "@1000000000"')],
];
const real = verdict(SRC); let caught = 0;
for (const [n, src] of BREAKS) { if (src === SRC) { console.log(' BREAK NOT APPLIED:', n); continue; } if (verdict(src).length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`tickstatemtimecheck: ${real.length} failed, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
