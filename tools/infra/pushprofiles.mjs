// #10418: the hosted brain reads Claude usage from the lattice secret CLAUDE_PROFILES ({name: .credentials.json}). A login is interactive, so it happens once on a PC
// (ADD-CLAUDE-ACCOUNT.cmd); this uploads every logged-in profile folder under <Projects>/_secrets/claude-profiles to that secret so nothing else needs the PC afterwards.
// node tools/infra/pushprofiles.mjs   (token: MIRROR_TOKEN / _secrets/mirror-token.txt; repo: MIRROR_REPO / _secrets/mirror-repo.txt). A token is never printed.
import { readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { projectsDirs } from './gh.mjs';

export function collect(dirs = projectsDirs()) {
  const out = {};
  for (const d of dirs) {
    const base = join(d, '_secrets', 'claude-profiles');
    if (!existsSync(base)) continue;
    for (const n of readdirSync(base)) {
      if (!/^[\w-]+$/.test(n) || n === 'default' || out[n]) continue;
      try { const raw = readFileSync(join(base, n, '.credentials.json'), 'utf8'); const o = JSON.parse(raw); const c = o.claudeAiOauth || o; if (c && c.refreshToken && c.accessToken) out[n] = raw; } catch { /* not logged in */ }
    }
  }
  return out;
}
async function sodium() {
  const dir = join(tmpdir(), 'mclite-sodium'); mkdirSync(dir, { recursive: true });
  const req = createRequire(join(dir, 'x.js'));
  try { return req('libsodium-wrappers'); } catch { execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--no-save', '--prefix', dir, 'libsodium-wrappers@0.7.15'], { stdio: 'ignore', shell: process.platform === 'win32' }); return req('libsodium-wrappers'); }
}
export async function push(profiles, { repo, token, f = fetch, sod } = {}) {
  const s = sod || await sodium(); await s.ready;
  const H = { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'content-type': 'application/json' };
  const k = await (await f(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, { headers: H })).json();
  const sealed = s.crypto_box_seal(s.from_string(JSON.stringify(profiles)), s.from_base64(k.key, s.base64_variants.ORIGINAL));
  const r = await f(`https://api.github.com/repos/${repo}/actions/secrets/CLAUDE_PROFILES`, { method: 'PUT', headers: H, body: JSON.stringify({ encrypted_value: s.to_base64(sealed, s.base64_variants.ORIGINAL), key_id: k.key_id }) });
  return r.status;
}
if (process.argv[1] && process.argv[1].endsWith('pushprofiles.mjs')) {
  const sec = (n) => { for (const d of projectsDirs()) { try { return readFileSync(join(d, '_secrets', n), 'utf8').trim(); } catch { /* next */ } } return ''; };
  const token = process.env.MIRROR_TOKEN || sec('mirror-token.txt'), repo = process.env.MIRROR_REPO || sec('mirror-repo.txt');
  const p = collect();
  if (!Object.keys(p).length) { console.log('pushprofiles: no logged-in profile found (run ADD-CLAUDE-ACCOUNT.cmd and /login first)'); process.exit(1); }
  if (!token || !repo) { console.log('pushprofiles: no mirror token/repo'); process.exit(1); }
  const st = await push(p, { repo, token });
  console.log(`pushprofiles: ${Object.keys(p).join(', ')} -> CLAUDE_PROFILES (${st === 201 || st === 204 ? 'ok' : 'FAILED ' + st})`);
  process.exit(st === 201 || st === 204 ? 0 : 1);
}
