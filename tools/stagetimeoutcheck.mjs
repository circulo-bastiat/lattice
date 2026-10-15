// #6384: suite.mjs kills a stage that outlives MCLITE_STAGE_TIMEOUT_MIN and records FAIL "TIMEOUT after N min".
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
if (process.argv.includes('--hang')) { setInterval(() => {}, 1000); }
else {
  const dir = mkdtempSync(tmpdir() + '/stto-');
  writeFileSync(dir + '/h.json', JSON.stringify([{ id: 'hangstage', kind: 'check', file: 'tools/stagetimeoutcheck.mjs', args: ['--hang'] }]));
  const run = (min) => spawnSync('node', ['tools/suite.mjs', '--only', 'hangstage'], { encoding: 'utf8', timeout: 60000,
    env: { ...process.env, MCLITE_STAGES_DIR: dir, MCLITE_STAGE_TIMEOUT_MIN: min } });
  let fails = 0;
  const t = run('0.03'), o = t.stdout + t.stderr;
  const good = /TIMEOUT after 0\.03 min/.test(o) && /FAIL/.test(o) && t.status !== 0 && t.status !== null;
  if (!good) { fails++; console.log('FAIL: timeout did not fire\n' + o.slice(-600)); }
  // break: a limit longer than the harness wait must NOT report a timeout (the check can fail)
  const b = run('5'); const bo = b.stdout + b.stderr;
  const caught = b.error || !/TIMEOUT after/.test(bo);
  if (caught) console.log('✓ break caught: without the short limit no TIMEOUT is reported');
  else { fails++; console.log('FAIL: break not caught'); }
  console.log(`${fails ? 'FAIL' : 'PASS'} 2 checks, ${fails} failures`);
  process.exit(fails ? 1 : 0);
}
