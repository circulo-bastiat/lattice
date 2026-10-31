#!/usr/bin/env node
// usagerefreshcheck.mjs - #2329 (4 Oct): the Claude logins under _secrets/claude-profiles expired and nothing renewed them, so usage
// was blind for ~20 h. usaged must renew them itself (refreshToken), save the new login atomically before using it, never touch the
// default ~/.claude login, never print a token, and say UNKNOWN + what to do when the refresh token is refused.
// Real temp credential files, a mocked fetch. Then every rule is broken in a copy of usaged.mjs and must be caught.
import { readFileSync, writeFileSync, mkdtempSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const TOOLS = fileURLToPath(new URL('.', import.meta.url));
let asserts = 0, fails = 0, breaks = 0;
const ok = (c, m) => { asserts++; if (!c) { fails++; console.log('  FAIL ' + m); } };
const NOW = Date.parse('2026-10-04T05:00:00Z');
const OLD = { accessToken: 'OLD-ACCESS-AAAA', refreshToken: 'OLD-REFRESH-BBBB', expiresAt: NOW - 3600e3, refreshTokenExpiresAt: NOW + 20 * 864e5, scopes: ['user:profile'], subscriptionType: 'max', rateLimitTier: 'x' };
const USAGE = { seven_day: { utilization: 100, resets_at: '2026-10-04T11:00:00Z' }, five_hour: { utilization: 2, resets_at: '2026-10-04T08:15:00Z' } };
function mkdir(over = {}) { const d = mkdtempSync(join(tmpdir(), 'usr-')); writeFileSync(join(d, '.credentials.json'), JSON.stringify({ claudeAiOauth: { ...OLD, ...over } })); return d; }
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
// a fake Anthropic: token endpoint(s) + usage + profile. `st` records calls and what was accepted.
function fake(o = {}) {
  const st = { token: 0, usage: 0, urls: [], goodTok: o.goodTok || 'NEW-ACCESS-CCCC' };
  const f = async (url, init = {}) => {
    st.urls.push(url);
    if (/\/oauth\/token$/.test(url)) {
      st.token++;
      if (o.tokenStatus && o.tokenStatus[(st.token - 1)] ) return resp(o.tokenStatus[st.token - 1], {});
      if (o.refuseAll) return resp(o.refuseAll, {});
      const b = JSON.parse(init.body);
      if (b.grant_type !== 'refresh_token' || b.refresh_token !== (o.expectRefresh || OLD.refreshToken) || !b.client_id) return resp(400, {});
      return resp(200, { access_token: st.goodTok, refresh_token: 'NEW-REFRESH-DDDD', expires_in: 28800 });
    }
    if (/oauth\/usage$/.test(url)) { st.usage++; const a = init.headers.Authorization; if (o.always401 || a !== 'Bearer ' + (o.valid || st.goodTok)) return resp(401, {}); return resp(200, USAGE); }
    if (/oauth\/profile$/.test(url)) return resp(200, { account: { email: 'a@b.c' } });
    return resp(404, {});
  };
  return { f, st };
}
async function cases(M) {
  const bad = [], t = async (n, fn) => { let r = false; try { r = !!(await fn()); } catch (e) { r = false; } if (!r) bad.push(n); };
  const cred = (d) => JSON.parse(readFileSync(join(d, '.credentials.json'), 'utf8')).claudeAiOauth;
  await t('expired login is renewed, then the reading works', async () => { const d = mkdir(), { f, st } = fake(); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok && u.week.pct === 100 && u.window.pct === 2 && u.email === 'a@b.c' && st.token === 1 && st.usage === 1; });
  await t('the new login is saved (access, ROTATED refresh token, later expiry) and other fields survive', async () => { const d = mkdir(), { f } = fake(); await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); const c = cred(d); return c.accessToken === 'NEW-ACCESS-CCCC' && c.refreshToken === 'NEW-REFRESH-DDDD' && c.expiresAt > NOW + 7 * 3600e3 && c.subscriptionType === 'max' && c.scopes[0] === 'user:profile' && c.refreshTokenExpiresAt === OLD.refreshTokenExpiresAt; });
  await t('the old login is kept as .prev', async () => { const d = mkdir(), { f } = fake(); await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return existsSync(join(d, '.credentials.json.prev')) && JSON.parse(readFileSync(join(d, '.credentials.json.prev'), 'utf8')).claudeAiOauth.accessToken === 'OLD-ACCESS-AAAA'; });
  await t('a login that is still valid is NOT renewed (no needless rotation)', async () => { const d = mkdir({ expiresAt: NOW + 3 * 3600e3, accessToken: 'LIVE' }), { f, st } = fake({ valid: 'LIVE' }); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok && st.token === 0 && cred(d).accessToken === 'LIVE'; });
  await t('a login inside the 5 min margin is renewed before it dies', async () => { const d = mkdir({ expiresAt: NOW + 2 * 60e3 }), { f, st } = fake(); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok && st.token === 1; });
  await t('a 401 with a not-yet-expired-looking login renews ONCE and retries', async () => { const d = mkdir({ expiresAt: NOW + 3600e3 }), { f, st } = fake(); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok && st.token === 1 && st.usage === 2; });
  await t('a 401 that renewing does not fix gives up (no loop)', async () => { const d = mkdir({ expiresAt: NOW + 3600e3 }), { f, st } = fake({ always401: true }); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok === false && st.token === 1 && st.usage === 2; });
  await t('an expired login that renewing does not fix is renewed ONCE, not twice', async () => { const d = mkdir(), { f, st } = fake({ always401: true }); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok === false && st.token === 1 && st.usage === 1; });
  await t('refresh refused (400) -> UNKNOWN, says what to do, file untouched, no .prev', async () => { const d = mkdir(), { f, st } = fake({ refuseAll: 400 }); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok === false && /ADD-CLAUDE-ACCOUNT/.test(u.why) && cred(d).accessToken === 'OLD-ACCESS-AAAA' && !existsSync(join(d, '.credentials.json.prev')) && st.token === 1; });
  await t('first token endpoint 404 -> the second one is tried', async () => { const d = mkdir(), { f, st } = fake({ tokenStatus: { 0: 404 } }); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok && st.token === 2 && st.urls.filter((x) => /oauth\/token/.test(x)).length === 2; });
  await t('expired REFRESH token -> UNKNOWN without any network call', async () => { const d = mkdir({ refreshTokenExpiresAt: NOW - 1000 }), { f, st } = fake(); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); return u.ok === false && /ADD-CLAUDE-ACCOUNT/.test(u.why) && st.token === 0; });
  await t('the default login (renew:false) is NEVER renewed, even expired', async () => { const d = mkdir(), { f, st } = fake(); const u = await M.readUsage(d, { renew: false, fetchFn: f, now: NOW }); return u.ok === false && st.token === 0 && cred(d).accessToken === 'OLD-ACCESS-AAAA'; });
  await t('no token ever appears in a result or the table', async () => { const d = mkdir(), { f } = fake(); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); const d2 = mkdir(), { f: f2 } = fake({ refuseAll: 400 }); const u2 = await M.readUsage(d2, { renew: true, fetchFn: f2, now: NOW }); const s = JSON.stringify([u, u2, M.table({ at: 'x', accounts: { max: u, pro: u2 } }, NOW)]); return !/ACCESS|REFRESH/.test(s) || !/(OLD|NEW)-(ACCESS|REFRESH)/.test(s); });
  await t('the table: numbers and times for a live account, UNKNOWN + reason for a dead one', async () => { const d = mkdir(), { f } = fake(); const u = await M.readUsage(d, { renew: true, fetchFn: f, now: NOW }); const s = M.table({ at: 'T', accounts: { max: u, pro: { ok: false, why: 'login rejected' } } }, NOW); return /max .*5-hour +2% \(resets in 3h 15m\) +week 100% \(resets in 6h 0m\)/.test(s) && /pro +UNKNOWN - login rejected/.test(s); });
  await t('#10418: CLAUDE_PROFILES is unpacked as profiles (bad names skipped, default never overwritten)', async () => { const b = mkdtempSync(join(tmpdir(), 'usp-')); const n = M.unpackProfiles(JSON.stringify({ max: { claudeAiOauth: OLD }, '../x': {}, default: {} }), b); const f = join(b, '_secrets', 'claude-profiles', 'max', '.credentials.json'); return n === 1 && existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).claudeAiOauth.refreshToken === OLD.refreshToken && !existsSync(join(b, '_secrets', 'claude-profiles', 'default')) && M.unpackProfiles('not json', b) === 0; });
  await t('#10418: a renewed login survives the next tick (state keyed to the secret seed); a CHANGED secret wins', async () => { const b = mkdtempSync(join(tmpdir(), 'usp-')), st = mkdtempSync(join(tmpdir(), 'ust-')); const J = (rt) => JSON.stringify({ max: { claudeAiOauth: { ...OLD, refreshToken: rt } } }); const f = () => join(b, '_secrets', 'claude-profiles', 'max', '.credentials.json'); const rt = () => JSON.parse(readFileSync(f(), 'utf8')).claudeAiOauth.refreshToken;
    M.unpackProfiles(J('S1'), b, st); writeFileSync(f(), JSON.stringify({ claudeAiOauth: { ...OLD, refreshToken: 'RENEWED' } })); const k = M.persistProfiles(J('S1'), b, st);
    M.unpackProfiles(J('S1'), b, st); const kept = rt() === 'RENEWED'; M.unpackProfiles(J('S2'), b, st); const reseed = rt() === 'S2'; M.unpackProfiles(J('S1'), b); const nostate = rt() === 'S1'; return k === 1 && kept && reseed && nostate; });
  await t('#10464: writeBackProfiles seals the ROTATED on-disk login (not the stale secret) and PUTs it to CLAUDE_PROFILES', async () => { const b = mkdtempSync(join(tmpdir(), 'usw-')); const old = JSON.stringify({ max: { claudeAiOauth: OLD }, pro: { claudeAiOauth: OLD }, '../x': {} }); M.unpackProfiles(old, b);
    const f = join(b, '_secrets', 'claude-profiles', 'max', '.credentials.json'); writeFileSync(f, JSON.stringify({ claudeAiOauth: { ...OLD, refreshToken: 'ROTATED-MAX' } }));
    const calls = []; const fetchFn = async (url, o) => { calls.push({ url, o }); return { ok: true, status: 204, json: async () => ({}) }; }; let sealed = null;
    const r = await M.writeBackProfiles({ json: old, base: b, key: { key: 'PK', key_id: 'K1' }, repo: 'org/m', token: 'T', fetchFn, seal: async (v, k) => { sealed = JSON.parse(v); return 'ENC:' + k; } });
    const body = JSON.parse(calls[0].o.body); return r.ok && r.n === 2 && calls.length === 1 && calls[0].o.method === 'PUT' && /\/repos\/org\/m\/actions\/secrets\/CLAUDE_PROFILES$/.test(calls[0].url) && body.key_id === 'K1' && body.encrypted_value === 'ENC:PK' && sealed.max.claudeAiOauth.refreshToken === 'ROTATED-MAX' && sealed.pro.claudeAiOauth.refreshToken === OLD.refreshToken && !('../x' in sealed) && !/ROTATED|OLD-/.test(JSON.stringify(r)); });
  await t('#10464: a refused secret write is reported, not hidden', async () => { const b = mkdtempSync(join(tmpdir(), 'usw-')); const j = JSON.stringify({ max: { claudeAiOauth: OLD } }); M.unpackProfiles(j, b);
    const r = await M.writeBackProfiles({ json: j, base: b, key: { key: 'PK', key_id: 'K' }, repo: 'o/m', token: 'T', fetchFn: async () => ({ ok: false, status: 403 }), seal: async () => 'x' }); return r.ok === false && /403/.test(r.why); });
  await t('#10464: secretWritable: key when the secret can be written, a reason when not (never throws)', async () => { const good = await M.secretWritable({ repo: 'o/m', token: 'T', fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ key: 'PK', key_id: 'K' }) }) }); const no = await M.secretWritable({ repo: 'o/m', token: 'T', fetchFn: async () => ({ ok: false, status: 403 }) }); const nt = await M.secretWritable({ repo: 'o/m' }); const boom = await M.secretWritable({ repo: 'o/m', token: 'T', fetchFn: async () => { throw new Error('net'); } }); return good.key.key === 'PK' && !no.key && /403/.test(no.why) && !nt.key && !boom.key; });
  return bad;
}
const SRC = readFileSync(join(TOOLS, 'usaged.mjs'), 'utf8');
let n = 0;
process.on('exit', () => { for (const f of readdirSync(TOOLS)) if (f.startsWith(`_usaged_mut_${process.pid}_`)) rmSync(join(TOOLS, f), { force: true }); });   // a mutated copy must never be left behind
async function load(src) { const f = join(TOOLS, `_usaged_mut_${process.pid}_${n++}.mjs`); writeFileSync(f, src); try { return await import(pathToFileURL(f).href); } finally { rmSync(f, { force: true }); } }
const bad0 = await cases(await load(SRC));
ok(bad0.length === 0, 'behaviour: ' + bad0.join(' | '));
const wiring = (s) => { const w = []; if (!/renew: n !== 'default' && \(!hosted \|\| !!sec\.key\)/.test(s)) w.push('#10464: hosted usaged renews even when the secret cannot be written back'); if (!/await writeBackProfiles\(\{ key: sec\.key/.test(s)) w.push('#10464: hosted usaged never writes a rotated login back to CLAUDE_PROFILES'); if (!/JSON\.stringify\(snap\(\)\) !== JSON\.stringify\(before\)/.test(s)) w.push('#10464: write-back not triggered by a rotated login'); if (!/NOT renewing logins/.test(s)) w.push('#10464: no bus line when the write-back is impossible'); if (!/readUsage\(d, \{ renew: n !== 'default'/.test(s)) w.push('the default login would be renewed'); if (!/process\.argv\.includes\('--print'\) \? table\(rec\)/.test(s)) w.push('--print does not print the table'); if (!/publish\(all, \{ write: !process\.argv\.includes\('--print'\) \}\)/.test(s)) w.push('--print would publish (a foreign host would overwrite the real disk and usage figures)'); return w; };
ok(wiring(SRC).length === 0, 'wiring: ' + wiring(SRC).join(' | '));
const MUT = [
  ['renewed login never saved', (s) => s.replace("renameSync(CRED + '.tmp', CRED);", '')],
  ['old login not kept', (s) => s.replace('copyFileSync(CRED, CRED + \'.prev\');', '')],
  ['other fields dropped on save', (s) => s.replace('const o2 = { ...o, accessToken', 'const o2 = { accessToken')],
  ['refresh token not rotated', (s) => s.replace('refreshToken: j.refresh_token || o.refreshToken', 'refreshToken: o.refreshToken')],
  ['expired login never renewed up front', (s) => s.replace('exp < now + RENEW_MARGIN_MS', 'false')],
  ['renews even a valid login', (s) => s.replace('exp < now + RENEW_MARGIN_MS', 'true')],
  ['a 401 is not retried after renewing', (s) => s.replace('r.status === 401 && renew && !renewedNote', 'false')],
  ['a 401 renews again and again', (s) => s.replace('r.status === 401 && renew && !renewedNote', 'r.status === 401 && renew')],
  ['refused refresh reported as ok', (s) => s.replace("if (!j) return { ok: false, why };", "if (!j) return { ok: true, why };")],
  ['no instruction when refresh is refused', (s) => s.replace(': the refresh token is no longer valid, run ADD-CLAUDE-ACCOUNT.cmd for this account', '')],
  ['expired refresh token still calls out', (s) => s.replace('o.refreshTokenExpiresAt < now', 'false')],
  ['second endpoint never tried', (s) => s.replace("why = 'renewal network error: ' + e.message; continue;", "return { ok: false, why: 'x' };").replace("why = 'renewal answered without a token'; j = null; continue; }\n    why = `renewal refused (HTTP ${r.status})`;", "why = 'z'; j = null; break; }\n    why = `renewal refused (HTTP ${r.status})`; break;")],
  ['the default login is renewed too', (s) => s.replace("{ renew: n !== 'default' && (!hosted || !!sec.key) }", '{ renew: true }'), true],
  ['--print publishes', (s) => s.replace("{ write: !process.argv.includes('--print') }", '{ write: true }'), true],
  ['profiles secret never unpacked (#10418)', (s) => s.replace('mkdirSync(d, { recursive: true });\n    let body', 'let body')],
  ['renewed login not persisted (#10418)', (s) => s.replace("writeFileSync(join(state, name, '.credentials.json'), body);", '')],
  ['persisted login ignored on unpack (#10418)', (s) => s.replace("body = readFileSync(join(state, name, '.credentials.json'), 'utf8');", '')],
  ['renews without writing back (#10464)', (s) => s.replace("renew: n !== 'default' && (!hosted || !!sec.key)", "renew: n !== 'default'"), true],
  ['rotated login never written back (#10464)', (s) => s.replace('await writeBackProfiles({ key: sec.key', 'await (async () => ({ ok: true }))({ key: sec.key'), true],
  ['write-back seals the stale secret, not the rotated login (#10464)', (s) => s.replace("out[name] = JSON.parse(readFileSync(join(base, '_secrets', 'claude-profiles', name, '.credentials.json'), 'utf8')); n++;", "out[name] = cred; n++;")],
  ['write-back reported ok when GitHub refused (#10464)', (s) => s.replace('r.status === 201 || r.status === 204 ? { ok: true, n }', 'true ? { ok: true, n }')],
  ['write-back goes to the wrong secret (#10464)', (s) => s.replace("export const SECRET_NAME = 'CLAUDE_PROFILES';", "export const SECRET_NAME = 'CLAUDE_PROFILE';")],
  ['unwritable secret not detected (#10464)', (s) => s.replace('if (!r.ok) return { key: null, why: `secrets public-key HTTP ${r.status}` };', '')],
  ['unknown accounts hidden in the table', (s) => s.replace('UNKNOWN - ${u.why}', '${u.why}')],
];
for (const [name, f, wire] of MUT) {
  const m = f(SRC); let caught = false;
  if (m === SRC) { ok(false, `mutation did not apply: ${name}`); continue; }
  try { caught = wire ? wiring(m).length > 0 : (await cases(await load(m))).length > 0; } catch { caught = true; }
  ok(caught, `break NOT caught: ${name}`); if (caught) { breaks++; console.log(`  ✓ break caught: ${name}`); }
}
console.log(`usagerefreshcheck: ${asserts} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
