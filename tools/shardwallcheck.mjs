// #10467: a stage that asks for timeoutMin 70 must not outlive the shard's wall (fullshard sets MCLITE_DEADLINE_MS): suite.mjs clamps it, skips what has not started, and still writes its ledger.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (process.argv.includes('--hang')) { setInterval(() => {}, 1000); }
else {
  const dir = mkdtempSync(tmpdir() + '/swc-');
  writeFileSync(dir + '/h.json', JSON.stringify([{ id: 'hangstage', kind: 'check', file: 'tools/shardwallcheck.mjs', args: ['--hang'], timeoutMin: 70 }]));
  const run = (deadlineMs, wait = 70000) => {
    const env = { ...process.env, MCLITE_STAGES_DIR: dir, MCLITE_STAGE_TIMEOUT_MIN: '12' }; if (deadlineMs !== null) env.MCLITE_DEADLINE_MS = String(deadlineMs);
    const r = spawnSync('node', ['tools/suite.mjs', '--only', 'hangstage'], { encoding: 'utf8', timeout: wait, killSignal: 'SIGKILL', env });
    return r;
  };
  let fails = 0, checks = 0, breaks = 0;
  const ok = (c, m) => { checks++; if (!c) { fails++; console.log('FAIL: ' + m); } };
  const a = run(Date.now() + 45000), ao = a.stdout + a.stderr;   // 45 s left: clamped to ~15 s, not 70 min
  ok(a.status !== null && /TIMEOUT after 0\.\d+ min/.test(ao), 'a 70-min stage was not clamped to the time left before the deadline\n' + ao.slice(-400));
  const s = run(Date.now() - 1000), so = s.stdout + s.stderr;   // already past: not started at all
  ok(s.status !== null && /shard wall reached/.test(so) && !/TIMEOUT after/.test(so), 'a stage was started after the deadline\n' + so.slice(-400));
  // break: with no deadline the stage runs on, so the harness kill (not the suite) ends it
  const n = run(null, 20000); if (n.status === null || !/TIMEOUT after/.test(n.stdout + n.stderr)) { breaks++; console.log('✓ break caught: without MCLITE_DEADLINE_MS the stage is not clamped'); } else { fails++; console.log('FAIL: break not caught'); }
  const fs = readFileSync('tools/infra/fullshard.mjs', 'utf8');
  ok(/MCLITE_DEADLINE_MS: String\(Date\.now\(\) \+ \(SHARD_WALL_MIN\(\) - 2\.5\) \* 60000\)/.test(fs), 'fullshard does not give the shard suite call a deadline inside its wall');
  const fsb = fs.replace('MCLITE_DEADLINE_MS: String(', 'X: String(');
  if (fsb !== fs && !/MCLITE_DEADLINE_MS: String\(/.test(fsb)) { breaks++; console.log('✓ break caught: fullshard without the deadline'); } else { fails++; console.log('FAIL: wiring break not caught'); }
  console.log(`${fails ? 'FAIL' : 'PASS'} ${checks} checks, ${breaks} breaks caught, ${fails} failures`);
  process.exit(fails ? 1 : 0);
}
