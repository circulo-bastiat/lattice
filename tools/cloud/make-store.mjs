#!/usr/bin/env node
// tools/cloud/make-store.mjs — build the PRIVATE asset store (infra I1, Dan 23 Sept 2026).
//
// The store is a separate private GitHub repo (owner/mclite-store) holding what this
// repo must never commit: Mojang's jars and the data trees extracted from them. A cloud container
// (claude.ai/code) cannot reach Mojang or Maven, but it CAN clone a GitHub repo — so the store is
// how a PC-less session gets the jars. `tools/cloud/bootstrap.mjs` is the reader.
//
//   node tools/cloud/make-store.mjs <outDir>      (Linux/macOS: needs `tar`, `gzip`, `git`)
//
// Layout written to <outDir>:
//   jars/1.18.2/1.18.2.jar  jars/1.18.2/server.jar  jars/1.13.2/1.13.2.jar   (copied as-is, each < 100 MB)
//   packs/<name>.tar.gz.<nn>   .mcdata (minus chunkcache — a worldgen cache), .mcsnd, .decomp,
//                              gzip'd tars split into < 90 MB parts (GitHub's hard cap is 100 MB/file)
//   MANIFEST.json              every file's sha256 + byte size, and each pack's part list
// Then `git init` + one commit on `main` (re-running replaces the tree and commits the difference).
// Golden referee data may later be added under golden/ by tools/referee (generated, never in mclite).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = process.argv[2];
if (!OUT) { console.log('usage: node tools/cloud/make-store.mjs <outDir>'); process.exit(2); }
const PART = 90 * 1024 * 1024;

export const JARS = ['1.18.2/1.18.2.jar', '1.18.2/server.jar', '1.13.2/1.13.2.jar'];
export const PACKS = [
  { name: 'mcdata', dir: '.mcdata', exclude: ['chunkcache'] },
  { name: 'mcsnd', dir: '.mcsnd', exclude: [] },
  { name: 'decomp', dir: '.decomp', exclude: [] },
  // D-772 (26 Sept): the generated assets/ too (~7 MB). Without it a fresh container spent many minutes
  // regenerating them through the suite's pipeline stages before it could build at all.
  { name: 'assets', dir: 'assets', exclude: [] },
];
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

mkdirSync(OUT, { recursive: true });
const manifest = { made: new Date().toISOString(), from: ROOT, files: {}, packs: {} };
const note = (rel) => { const p = join(OUT, rel); manifest.files[rel] = { sha256: sha(p), bytes: statSync(p).size }; };

for (const j of JARS) {
  const src = join(ROOT, 'jars', j);
  if (!existsSync(src)) { console.log(`FAIL  make-store: missing ${src}`); process.exit(1); }
  mkdirSync(dirname(join(OUT, 'jars', j)), { recursive: true });
  copyFileSync(src, join(OUT, 'jars', j));
  note(`jars/${j}`);
  console.log(`jar   ${j}`);
}
const packsDir = join(OUT, 'packs');
if (existsSync(packsDir)) for (const f of readdirSync(packsDir)) rmSync(join(packsDir, f));
mkdirSync(packsDir, { recursive: true });
for (const pk of PACKS) {
  if (!existsSync(join(ROOT, pk.dir))) { console.log(`FAIL  make-store: missing ${pk.dir}`); process.exit(1); }
  const tgz = join(packsDir, `${pk.name}.tar.gz`);
  // -h follows the top-level symlink when run from a clone whose .mcdata etc. are links
  execFileSync('tar', ['-czhf', tgz, ...pk.exclude.map((e) => `--exclude=${pk.dir}/${e}`), pk.dir], { cwd: ROOT, stdio: 'inherit' });
  const whole = sha(tgz);
  // split in Node, not coreutils `split` (D-772: Windows has no `split`; the runner-side republish died on it)
  { const buf = readFileSync(tgz); for (let i = 0, n = 0; i < buf.length; i += PART, n++) writeFileSync(`${tgz}.${String(n).padStart(2, '0')}`, buf.subarray(i, i + PART)); }
  rmSync(tgz);
  const parts = readdirSync(packsDir).filter((f) => f.startsWith(`${pk.name}.tar.gz.`)).sort();
  parts.forEach((f) => note(`packs/${f}`));
  manifest.packs[pk.name] = { dir: pk.dir, sha256: whole, parts: parts.map((f) => `packs/${f}`) };
  console.log(`pack  ${pk.name}: ${parts.length} part(s)`);
}
writeFileSync(join(OUT, 'MANIFEST.json'), JSON.stringify(manifest, null, 1));
writeFileSync(join(OUT, 'README.md'), '# mclite-store (PRIVATE)\n\nMojang jars + extracted data for MC-Lite cloud sessions. ' +
  'Never make this repo public. Written by `tools/cloud/make-store.mjs`, read by `tools/cloud/bootstrap.mjs`.\n');
const git = (...a) => execFileSync('git', a, { cwd: OUT, encoding: 'utf8' });
if (!existsSync(join(OUT, '.git'))) git('init', '-q', '-b', 'main');
git('add', '-A');
try {
  git('-c', 'user.name=MC-Lite infra', '-c', 'user.email=infra@mclite.local', 'commit', '-q', '-m', `store ${manifest.made}`);
} catch (e) { if (!/nothing to commit/.test(String(e.stdout || e.message))) throw e; }
console.log(`OK    make-store: ${Object.keys(manifest.files).length} files -> ${OUT} (${git('rev-parse', '--short', 'HEAD').trim()})`);
