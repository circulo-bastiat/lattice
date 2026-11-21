#!/usr/bin/env node
// deploy.mjs - put the LANDED phone app (origin/master's tools/phone-web) on the phone's website, https://owner.github.io/mclite-phone/
// (Dan, 10 Oct: "teach me how to redeploy or do it for me"). The repo's phone-pages workflow does this on every landing too, but only when the
// secret PHONE_PAGES_TOKEN is set - it is not - so this is the by-hand route: build the static site, force-push it to owner/mclite-phone `main`.
// Needs the GitHub token in _secrets/github-token.txt (or GH_TOKEN). Double-click DEPLOY-PHONE.cmd. Then on the phone: open the app, pull down to refresh;
// if it still looks old, close and reopen it once (the service worker updates on the next open).
import { gitArgs, gitEnv } from '../infra/gitenv.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = 'https://owner.github.io/mclite-phone/', PAGES = 'owner/mclite-phone';
const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] }).trim();
function token() {
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN.trim();
  for (let d = ROOT, i = 0; i < 4; d = dirname(d), i++) { const f = join(d, '_secrets', 'github-token.txt'); if (existsSync(f)) return readFileSync(f, 'utf8').trim(); }
  throw new Error('no GitHub token: _secrets/github-token.txt is missing (SAVE-GITHUB-TOKEN.cmd saves it)');
}
// #7856: the token goes in a header, never in the URL (a user@ URL is what Git Credential Manager stores as an account)
const AUTH = () => ['-c', `http.extraheader=AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token()}`).toString('base64')}`];
const tmp = mkdtempSync(join(tmpdir(), 'phone-deploy-'));
try {
  sh('git', [...gitArgs(), ...AUTH(), 'fetch', '-q', 'https://github.com/owner/mclite.git', 'master'], ROOT);   // the landed master, whatever this checkout has
  const sha = sh('git', ['rev-parse', '--short', 'FETCH_HEAD'], ROOT);
  const src = join(tmp, 'src'), site = join(tmp, 'site');
  execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', join(tmp, 'pw.tar'), 'FETCH_HEAD', 'tools/phone-web']);
  mkdirSync(src, { recursive: true });
  execFileSync('tar', ['-xf', join(tmp, 'pw.tar'), '-C', src]);
  const { build } = await import(pathToFileURL(join(src, 'tools', 'phone-web', 'build.mjs')).href);
  build(site);
  if (process.argv.includes('--dry')) { console.log(`DRY  built from master ${sha}: ${readdirSync(site).join(', ')} (nothing pushed)`); process.exit(0); }
  sh('git', ['init', '-q', '-b', 'main'], site); sh('git', ['config', 'user.name', 'mclite phone'], site); sh('git', ['config', 'user.email', 'phone@mclite.invalid'], site);
  sh('git', ['add', '-A'], site); sh('git', ['commit', '-q', '-m', `phone app ${sha} (by hand)`], site);
  sh('git', [...gitArgs(), ...AUTH(), 'push', '-q', '-f', `https://github.com/${PAGES}.git`, 'main'], site);
  console.log(`OK  phone app from master ${sha} is published. GitHub takes about a minute to serve it: ${SITE}`);
} catch (e) {
  console.error('FAILED: ' + String(e.stderr || e.message || e).replace(/x-access-token:[^@]+@/g, 'x-access-token:***@').trim());
  process.exitCode = 1;
} finally { rmSync(tmp, { recursive: true, force: true }); }
