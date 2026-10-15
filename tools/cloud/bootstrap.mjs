#!/usr/bin/env node
// tools/cloud/bootstrap.mjs — make a FRESH Linux container able to build and test MC-Lite (infra I2).
//
// A claude.ai/code container has the mclite repo checked out and nothing else: no jars (Mojang and
// Maven are unreachable from it), no .mcdata/.mcsnd/.decomp, maybe no Chromium. github.com IS
// reachable, so everything comes from the PRIVATE store repo (`tools/cloud/make-store.mjs`).
//
//   node tools/cloud/bootstrap.mjs [--store <git-url|dir|file.bundle>] [--no-build] [--no-suite]
//
// store source, first hit wins: --store, $MCLITE_STORE, https://github.com/owner/mclite-store.git
// Steps (each prints one line; the first failure stops with FAIL and the fix):
//   1. store   clone (depth 1) into $MCLITE_STORE_DIR or <repo>/../mclite-store, or use a local dir
//   2. verify  every MANIFEST.json sha256
//   3. place   jars/ copied, .mcdata/.mcsnd/.decomp unpacked (skipped when already identical: a
//              .store-stamp file in each records the pack sha)
//   4. chrome  tools/cdp.mjs findChrome() — /opt/pw-browsers is on its list — else get-chromium.mjs
//   5. build   node build.mjs
//   6. suite   node tools/suite.mjs --fast   (the browser stages are session-cloud.mjs's job)
// It never touches worldgen, never commits, never pushes.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, createWriteStream, statSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_STORE = 'https://github.com/owner/mclite-store.git';
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const after = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const t0 = Date.now();
const say = (tag, msg) => console.log(`${tag.padEnd(7)}${msg}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
const die = (msg, fix) => { console.log(`FAIL  bootstrap: ${msg}${fix ? `\n      fix: ${fix}` : ''}`); process.exit(1); };

/** Resolve the store to a local directory with MANIFEST.json. */
export function fetchStore(src, dest) {
  if (existsSync(join(src, 'MANIFEST.json'))) return src;
  if (existsSync(join(dest, 'MANIFEST.json'))) {
    const r = spawnSync('git', ['-C', dest, 'pull', '-q', '--ff-only'], { encoding: 'utf8' });
    if (r.status !== 0) say('store', `pull failed (${(r.stderr || '').trim().split('\n').pop()}), using the copy on disk`);
    return dest;
  }
  mkdirSync(dirname(dest), { recursive: true });
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });   // a half-made clone from a failed run
  // -b main: a git BUNDLE carries no HEAD, and a plain clone of one checks out nothing
  const r = spawnSync('git', ['clone', '-q', '--depth', '1', '-b', 'main', src, dest], { encoding: 'utf8' });
  if (r.status !== 0) die(`could not clone the store from ${src}: ${(r.stderr || '').trim().split('\n').pop()}`,
    'the store repo must exist (private, owner/mclite-store) AND be added to this claude.ai/code environment\'s repositories; or pass --store <dir|bundle>');
  return dest;
}

export function verify(store) {
  const m = JSON.parse(readFileSync(join(store, 'MANIFEST.json'), 'utf8'));
  const bad = Object.entries(m.files).filter(([rel, f]) => !existsSync(join(store, rel)) || statSync(join(store, rel)).size !== f.bytes || sha(join(store, rel)) !== f.sha256);
  return { m, bad: bad.map(([rel]) => rel) };
}

export function place(store, m, root) {
  const done = [];
  for (const rel of Object.keys(m.files).filter((r) => r.startsWith('jars/'))) {
    const to = join(root, rel);
    if (existsSync(to) && sha(to) === m.files[rel].sha256) continue;
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(store, rel), to);
    done.push(rel);
  }
  for (const [name, pk] of Object.entries(m.packs)) {
    const stamp = join(root, pk.dir, '.store-stamp');
    if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === pk.sha256) continue;
    const tgz = join(store, `.${name}.tar.gz`);
    writeFileSync(tgz, Buffer.concat(pk.parts.map((p) => readFileSync(join(store, p)))));
    if (sha(tgz) !== pk.sha256) die(`pack ${name}: joined parts do not match the manifest sha`);
    execFileSync('tar', ['-xzf', tgz, '-C', root]);
    rmSync(tgz);
    writeFileSync(stamp, pk.sha256 + '\n');
    done.push(pk.dir);
  }
  return done;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const src = after('--store') || process.env.MCLITE_STORE || DEFAULT_STORE;
  const dest = process.env.MCLITE_STORE_DIR || join(ROOT, '..', 'mclite-store');
  let store = src;
  if (/\.bundle$/.test(src) && existsSync(src)) store = fetchStore(resolve(src), dest);
  else store = fetchStore(existsSync(src) ? resolve(src) : src, dest);
  say('store', store);
  const { m, bad } = verify(store);
  if (bad.length) die(`${bad.length} store file(s) fail their sha256: ${bad.slice(0, 5).join(', ')}`, 're-run make-store on the PC and push, or re-clone');
  say('verify', `${Object.keys(m.files).length} files OK (store made ${m.made})`);
  const placed = place(store, m, ROOT);
  say('place', placed.length ? placed.join(', ') : 'already in place');
  // Referee golden (generated on the real server, cached in the store's golden/, never in mclite — D-6). Without this every
  // *refcheck SKIPs in a fresh container and the suite reads green with 0 referee assertions (found 24 Sept 23:40Z).
  {
    const gsrc = join(store, 'golden');
    const gdst = join(process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2'), 'golden');
    const gs = existsSync(gsrc) ? readdirSync(gsrc).filter((f) => f.endsWith('.json')) : [];
    mkdirSync(gdst, { recursive: true });
    let n = 0;
    for (const f of gs) { const d = join(gdst, f); if (!existsSync(d) || statSync(d).size !== statSync(join(gsrc, f)).size) { copyFileSync(join(gsrc, f), d); n++; } }
    say('golden', gs.length ? `${gs.length} referee golden file(s) in ${gdst} (${n} copied)` : 'none in the store — every *refcheck will SKIP');
  }
  {                                                   // #5026: the lockstep spike (#4986) and the real-server referee need Java 17+; every runner job now says what it has
    const j = spawnSync('java', ['-version'], { encoding: 'utf8' });
    const banner = j.error ? '' : `${j.stdout || ''}${j.stderr || ''}`;
    const major = Number((banner.match(/version "(?:1\.)?(\d+)/) || [])[1]) || 0;
    say('java', major ? `${banner.split('\n')[0].trim()} (major ${major})` : 'none found');
    if (major < 17) console.log(`WARN  java ${major || 'missing'}: the lockstep spike (#4986) and the real-server referee need Java 17+ - issues labelled needs-java cannot be done on this runner`);
  }
  const { findChrome } = await import('../cdp.mjs');
  let chrome = findChrome();
  if (!chrome) {
    say('chrome', 'none found — node tools/get-chromium.mjs');
    const r = spawnSync('node', ['tools/get-chromium.mjs'], { cwd: ROOT, stdio: 'inherit' });
    chrome = r.status === 0 ? findChrome() : null;
    if (!chrome) die('no Chromium, and get-chromium failed', 'set CHROME=/path/to/chrome');
  }
  say('chrome', chrome);
  if (!flag('--no-build')) {
    const r = spawnSync('node', ['build.mjs'], { cwd: ROOT, encoding: 'utf8' });
    if (r.status !== 0) { console.log((r.stdout + r.stderr).split('\n').slice(-30).join('\n')); die('node build.mjs failed'); }
    say('build', (r.stdout.trim().split('\n').pop() || 'ok').slice(0, 100));
  }
  if (!flag('--no-suite') && !flag('--no-build')) {
    const r = spawnSync('node', ['tools/suite.mjs', '--fast'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });
    const tail = r.stdout.split('\n').filter((l) => /✗|stages? failed|assertions ·/.test(l));
    console.log(tail.join('\n'));
    if (r.status !== 0) die('suite --fast is red (above)', 'these are real reds at this commit, not bootstrap faults, unless they name a missing file');
    say('suite', 'fast suite green');
  }
  console.log(`OK    bootstrap: container ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}
