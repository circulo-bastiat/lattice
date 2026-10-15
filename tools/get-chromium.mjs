// get-chromium.mjs — a PERMANENT, project-local headless Chrome for the browser stages (D-407).
//
// ⚠ WHY. The browser stages are the only checks that look at the picture, and for most of this
// project's life they printed SKIP because the machine a session ran on had no Chromium (KW-3).
// The Cowork shell's own $HOME is thrown away every session; this project folder is Dan's disk
// and is not. So the browser lives HERE, in `.chromium/` (gitignored, regenerable — D-6), and
// every tool finds it through the one list in `tools/cdp.mjs`.
//
//   node tools/get-chromium.mjs            install if missing, then print the version (idempotent)
//   node tools/get-chromium.mjs --probe    also launch it and print WebGL2's real limits
//   node tools/get-chromium.mjs --force    reinstall the current Chrome-for-Testing Stable
//
// What it does: downloads Chrome for Testing (Stable, linux64) from Google's own bucket, unpacks
// it into `.chromium/chrome-linux64/`, fetches any shared library `ldd` says is missing from the
// Ubuntu archive into `.chromium/lib/` (on Dan's Cowork VM that was exactly one: libXdamage), and
// writes `.chromium/chrome`, a launcher that sets LD_LIBRARY_PATH. No sudo, no apt, no npm.
//
// ⚠ THE 2048 CEILING (D-379/D-380). This browser renders through SwiftShader and reports
// MAX_ARRAY_TEXTURE_LAYERS = 2048 — the same number as every Windows Chrome/Edge (D3D11). That is
// what we WANT a test browser to report: the atlas is larger than 2048 layers and only boots
// because it is sharded across two arrays (D-380). `--probe` prints the number so a session can see
// the ceiling it is testing against rather than assume it.
//
// Linux only (the Cowork VM, the container, the Hyper-V guest). On Windows the lane uses the
// installed Chrome/Edge that `cdp.mjs` already lists.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, readdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, '.chromium');
const BIN = join(DIR, 'chrome-linux64', 'chrome');
const LAUNCH = join(DIR, 'chrome');
const LIB = join(DIR, 'lib');
const argv = process.argv.slice(2);
const sh = (c, o) => execSync(c, Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, o || {}));

if (process.platform !== 'linux') {
  console.log('SKIP  get-chromium: Linux only — on Windows cdp.mjs uses the installed Chrome/Edge');
  process.exit(0);
}

// Ubuntu 22.04 (jammy) packages for the libraries Chrome links against, in case one is missing.
const DEBS = {
  'libXdamage.so.1': 'libx/libxdamage/libxdamage1_1.1.5-2build2_amd64.deb',
};

function install() {
  mkdirSync(DIR, { recursive: true });
  const meta = JSON.parse(sh('curl -sfL -m 30 https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json'));
  const st = meta.channels.Stable;
  const url = st.downloads.chrome.find(d => d.platform === 'linux64').url;
  console.log(`get-chromium: downloading Chrome for Testing ${st.version}…`);
  const zip = join(DIR, 'chrome.zip');
  sh(`curl -sfL -m 600 -o "${zip}" "${url}"`);
  if (existsSync(join(DIR, 'chrome-linux64'))) rmSync(join(DIR, 'chrome-linux64'), { recursive: true, force: true });
  sh(`python3 -c "import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "${zip}" "${DIR}"`);
  rmSync(zip, { force: true });
  for (const f of ['chrome', 'chrome_crashpad_handler', 'chrome_sandbox', 'chrome-wrapper'])
    if (existsSync(join(DIR, 'chrome-linux64', f))) chmodSync(join(DIR, 'chrome-linux64', f), 0o755);
}

function fixLibs() {
  mkdirSync(LIB, { recursive: true });
  const missing = () => sh(`ldd "${BIN}"`, { env: Object.assign({}, process.env, { LD_LIBRARY_PATH: LIB }) })
    .split('\n').filter(l => /not found/.test(l)).map(l => l.trim().split(/\s/)[0]);
  for (const so of missing()) {
    const deb = DEBS[so];
    if (!deb) { console.log(`FAIL  get-chromium: ${so} is missing and no package is mapped for it in DEBS`); process.exit(1); }
    const tmp = join(DIR, '_deb');
    mkdirSync(tmp, { recursive: true });
    sh(`curl -sfL -m 60 -o "${tmp}/p.deb" "http://archive.ubuntu.com/ubuntu/pool/main/${deb}"`);
    sh(`dpkg-deb -x "${tmp}/p.deb" "${tmp}/x"`);
    const found = sh(`find "${tmp}/x" -name "${so}"`).trim().split('\n')[0];
    copyFileSync(found, join(LIB, so));   // copyFileSync follows the symlink — the mount has none
    rmSync(tmp, { recursive: true, force: true });
    console.log(`get-chromium: bundled ${so}`);
  }
  const left = missing();
  if (left.length) { console.log('FAIL  get-chromium: still missing ' + left.join(', ')); process.exit(1); }
}

function writeLauncher() {
  writeFileSync(LAUNCH, '#!/bin/sh\n# Project-local Chromium launcher, written by tools/get-chromium.mjs (D-407).\n'
    + 'D="$(cd "$(dirname "$0")" && pwd)"\n'
    + 'LD_LIBRARY_PATH="$D/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" exec "$D/chrome-linux64/chrome" "$@"\n');
  chmodSync(LAUNCH, 0o755);
}

if (argv.includes('--force') || !existsSync(BIN)) install();
fixLibs();
writeLauncher();
const v = spawnSync(LAUNCH, ['--version'], { encoding: 'utf8' });
if (v.status !== 0) { console.log('FAIL  get-chromium: the launcher does not start\n' + v.stderr); process.exit(1); }
console.log(`ok    ${v.stdout.trim()} — .chromium/chrome`);

if (argv.includes('--probe')) {
  const { open } = await import('./cdp.mjs');
  const s = await open('about:blank', {});
  const r = await s.evaluate(() => {
    const g = document.createElement('canvas').getContext('webgl2');
    if (!g) return { webgl2: false };
    const d = g.getExtension('WEBGL_debug_renderer_info');
    return { webgl2: true, maxArrayLayers: g.getParameter(0x88FF), maxTexture: g.getParameter(g.MAX_TEXTURE_SIZE),
             renderer: d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : null, webgpu: !!navigator.gpu };
  });
  await s.close();
  console.log('probe ' + JSON.stringify(r));
  if (r.maxArrayLayers <= 2048) console.log('      ⚠ the 2048-layer ceiling applies here — the atlas boots only through its D-380 shards');
}
