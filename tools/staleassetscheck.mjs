#!/usr/bin/env node
// staleassetscheck.mjs — #11401: build.mjs must REFUSE when assets/ is older than the generators (tools/extract-*.mjs, tools/build-*.mjs) that write it.
// Runs the real build.mjs copied into a scratch tree (it resolves ROOT from its own location) and reads its verdict:
//   stale generator -> exit 1 + "assets/ is OLDER"; fresh -> that message absent; MCLITE_ALLOW_STALE_ASSETS=1 -> absent; CI -> warns, does not exit on it.
// ANTI-VACUITY: the guard call is removed from a copy of build.mjs; the stale scenario must then NOT refuse, which this check reports as a caught break.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const BUILD = readFileSync(new URL('../build.mjs', import.meta.url), 'utf8');
function run(src, { stale, env }) {
  const d = mkdtempSync(join(tmpdir(), 'sac-'));
  mkdirSync(join(d, 'assets')); mkdirSync(join(d, 'tools')); mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'build.mjs'), src);
  const old = new Date(Date.now() - 86400e3 * 30), now = new Date();
  writeFileSync(join(d, 'assets', 'gui.bin'), 'x'); utimesSync(join(d, 'assets', 'gui.bin'), old, old);
  writeFileSync(join(d, 'tools', 'build-gui.mjs'), '//'); utimesSync(join(d, 'tools', 'build-gui.mjs'), stale ? now : old, stale ? now : old);
  const r = spawnSync(process.execPath, [join(d, 'build.mjs')], { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', CI: '', ...env } });
  return { code: r.status, hit: /assets\/ is OLDER/.test(r.stderr), ci: /WARNING: assets\/ is OLDER/.test(r.stderr) };
}
const fails = []; const ck = (c, m) => { if (!c) fails.push(m); };
const s1 = run(BUILD, { stale: true, env: {} });
ck(s1.hit && s1.code === 1, 'stale generator must refuse with exit 1: ' + JSON.stringify(s1));
const s2 = run(BUILD, { stale: false, env: {} }); ck(!s2.hit, 'fresh assets must not trip the guard: ' + JSON.stringify(s2));
const s3 = run(BUILD, { stale: true, env: { MCLITE_ALLOW_STALE_ASSETS: '1' } }); ck(!s3.hit, 'MCLITE_ALLOW_STALE_ASSETS=1 must skip the guard: ' + JSON.stringify(s3));
const s4 = run(BUILD, { stale: true, env: { GITHUB_ACTIONS: 'true' } }); ck(s4.ci, 'CI must warn: ' + JSON.stringify(s4));
let caught = 0;
const broken = BUILD.replace(/\nassertAssetsFresh\(\);\n/, '\n');
if (broken === BUILD) fails.push('break target missing: assertAssetsFresh() call');
else { const b = run(broken, { stale: true, env: {} }); if (!b.hit) caught++; else fails.push('break NOT caught: guard call removed but build still refused'); }
console.log(`staleassetscheck: ${caught} break caught (of 1)`);
if (fails.length) { console.log('FAIL staleassetscheck'); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log('PASS staleassetscheck');
