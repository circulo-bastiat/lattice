// tools/infra/apptoken.mjs - #9701/#9701 (22 Oct, Dan chose "GitHub App"): the mirror's own API identity. MIRROR_TOKEN was a PAT of the same GitHub user as
// the main PAT, so the lander, full suite, pilots, fill and workers shared ONE 5000/h pool (exhausted 19:59Z 22 Oct). A GitHub App installed on the mirror
// has its own pool. Creds: env MIRROR_APP_ID + MIRROR_APP_KEY (PEM text), or files _secrets/mirror-app-id.txt + _secrets/mirror-app.pem. No creds = null
// (callers keep MIRROR_TOKEN). Installation tokens live 1 h; callers re-mint after 45 min. Own code, no package (Node crypto signs the RS256 JWT).
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
/** The app JWT (RS256, iat 60 s in the past against clock skew, 9 min life). */
export function appJwt(appId, pem, now = Date.now()) {
  const iat = Math.floor(now / 1000) - 60, body = `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ iat, exp: iat + 540, iss: String(appId) }))}`;
  return `${body}.${b64u(createSign('RSA-SHA256').update(body).sign(pem))}`;
}
/** {appId, pem} from env or <secretsDir>, else null. */
export function appCreds(secretsDir) {
  const rd = (f) => { try { return readFileSync(join(secretsDir || '', f), 'utf8').trim(); } catch { return ''; } };
  const appId = process.env.MIRROR_APP_ID || (secretsDir ? rd('mirror-app-id.txt') : ''), pem = process.env.MIRROR_APP_KEY || (secretsDir ? rd('mirror-app.pem') : '');
  return appId && /BEGIN [A-Z ]*PRIVATE KEY/.test(pem) ? { appId, pem } : null;
}
/** An installation token for `repo` (owner/name), or throws. fetchFn is injectable for the check. */
export async function mintAppToken({ appId, pem, repo, fetchFn = fetch, now = Date.now() }) {
  const h = { authorization: `Bearer ${appJwt(appId, pem, now)}`, accept: 'application/vnd.github+json' };
  const inst = await fetchFn(`https://api.github.com/repos/${repo}/installation`, { headers: h });
  if (!inst.ok) throw new Error(`app: no installation on ${repo} (${inst.status})`);
  const { id } = await inst.json();
  const t = await fetchFn(`https://api.github.com/app/installations/${id}/access_tokens`, { method: 'POST', headers: h });
  if (!t.ok) throw new Error(`app: token refused (${t.status})`);
  return (await t.json()).token;
}

// CLI: `node tools/infra/apptoken.mjs` prints an installation token for MIRROR_REPO (exit 1, prints nothing, without creds): tick.sh swaps it in for MIRROR_TOKEN
if (process.argv[1] && /apptoken\.mjs$/.test(process.argv[1])) {
  const c = appCreds(process.env.MCLITE_PROJECTS ? join(process.env.MCLITE_PROJECTS, '_secrets') : '');
  if (!c || !process.env.MIRROR_REPO) process.exit(1);
  mintAppToken({ ...c, repo: process.env.MIRROR_REPO }).then((t) => { process.stdout.write(t); }, () => process.exit(1));
}
