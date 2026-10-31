// cdprelaunchcheck (#9479, 22 Oct): tools/cdp.mjs open() must relaunch chrome ONCE, on a fresh --user-data-dir, when the first chrome never opens its debug port.
// Before: it waited 20 s, fell through and died with `connect ECONNREFUSED 127.0.0.1:9600`, which bounced every PR that adds a browser stage at the lander's anti-vacuity run.
// RUNS the real open() against a fake chrome (CHROME=<script>) that exits at once the first time and serves a dummy debug endpoint the second time. Prints one check mark per caught break.
import { mkdtempSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
const TOOLS = dirname(fileURLToPath(import.meta.url)), SRC = readFileSync(join(TOOLS, 'cdp.mjs'), 'utf8');
function trial(src, tag) {
  const d = mkdtempSync(join(tmpdir(), 'cdprl-')), log = join(d, 'launches.log'), fake = join(d, 'fakechrome'), port = 9700 + Math.floor(Math.random() * 200);
  const mod = join(TOOLS, `cdp.${tag}-${process.pid}.mjs`); writeFileSync(mod, src);
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> "${log}"\nn=$(wc -l < "${log}")\n[ "$n" -lt 2 ] && exit 0\nexec "${process.execPath}" -e 'require("http").createServer((q,s)=>s.end("x")).listen(${port})'\n`); chmodSync(fake, 0o755);
  const drv = join(d, 'drive.mjs'); writeFileSync(drv, `import { open } from ${JSON.stringify(pathToFileURL(mod).href)}; try { await open('about:blank', {}); console.log('OPENED'); } catch (e) { console.log('ERR ' + e.message); } process.exit(0);`);
  const r = spawnSync(process.execPath, [drv], { encoding: 'utf8', timeout: 60000, env: { ...process.env, CHROME: fake, MCLITE_CDP_PORT: String(port), MCLITE_CDP_WAIT_MS: '1000' } });
  const launches = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
  try { rmSync(mod, { force: true }); rmSync(d, { recursive: true, force: true }); } catch { /* scratch */ }
  return { launches, out: (r.stdout || '') + (r.stderr || '') };
}
let fails = 0; const need = (c, m) => { if (!c) { fails++; console.log('FAIL: ' + m); } };
const real = trial(SRC, 'real');
need(real.launches.length === 2, 'a chrome that never listens is relaunched exactly once (launches: ' + real.launches.length + ')');
need(real.launches[1] && /--user-data-dir=/.test(real.launches[1]) && !/--user-data-dir=/.test(real.launches[0] || ''), 'the relaunch uses a fresh --user-data-dir, the first launch does not');
need(!/ECONNREFUSED/.test(real.out), 'open() no longer dies with ECONNREFUSED when the second chrome answers');
let caught = 0;
for (const [name, a, b] of [['no relaunch', 'attempt < 2 && !up', 'attempt < 1 && !up'], ['relaunch on the same profile', "launch(['--user-data-dir=' + mkdtempSync(join(tmpdir(), 'cdp-prof-'))])", 'launch()'], ['the first launch already changes profile', 'let chrome = launch();', "let chrome = launch(['--user-data-dir=/tmp/x']);"]]) {
  if (!SRC.includes(a)) { fails++; console.log('FAIL: no-op break ' + name); continue; }
  const r = trial(SRC.replace(a, b), 'brk');
  const bad = r.launches.length !== 2 || !/--user-data-dir=/.test(r.launches[1] || '') || /--user-data-dir=/.test(r.launches[0] || '') || /ECONNREFUSED/.test(r.out);
  if (bad) { caught++; console.log(' \u2713 break caught: ' + name); } else { fails++; console.log(' NOT CAUGHT: ' + name); }
}
console.log(`cdprelaunchcheck: ${fails ? 'FAILED' : 'ok'}, ${caught} breaks caught (of 3)`);
process.exit(fails ? 1 : 0);
