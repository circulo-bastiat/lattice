#!/usr/bin/env node
// tools/usaged.mjs - Dan's Claude usage, readable by every session without Claude in Chrome (Dan, 28 Sept 2026:
// "give sessions true, non claude in chrome access to my usage totals at all times").
//
// HOW: the same endpoint the fan tools use (claude-usage-tracker, usage-monitor-for-claude, Claude-Code-Usage-Monitor):
// GET https://api.anthropic.com/api/oauth/usage with the OAuth login Claude Code keeps in ~/.claude/.credentials.json.
// It reports the 5-hour and weekly utilization of WHICHEVER account Claude Code is logged into on this PC.
//
// This is a SERVICE, started at logon by SETUP-PC.cmd, not a session waiting on something: it is what lets sessions
// read usage ONCE instead of polling a browser. It publishes to
//   <Projects>/_status/usage.json          (Cowork/loop sessions on any synced PC read this file)
//   repo variable MCLITE_USAGE on GitHub   (cloud sessions read it through the API)
//
//   node tools/usaged.mjs --once     one reading, printed and published, exit
//   node tools/usaged.mjs --print    one live reading as a plain table, renewing logins if needed; publishes nothing (Projects\USAGE.cmd double-clicks this)
//   node tools/usaged.mjs --serve    every 5 minutes (backs off to 15 on a 429)
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { homedir, hostname } from 'node:os';
import { gh, projectsDirs } from './infra/gh.mjs';

// MULTIPLE ACCOUNTS (Dan, 28 Sept: "i do this from multiple accounts so it must be easily switchable"):
// every folder <Projects>/_secrets/claude-profiles/<name>/ is a Claude Code CLAUDE_CONFIG_DIR that
// ADD-CLAUDE-ACCOUNT.cmd logged into once; the default ~/.claude login is the profile "default".
// Each is read and published under its name; <Projects>/_status/active-account.txt (SWITCH-ACCOUNT.cmd, or the
// MCLITE_ACCOUNT variable) says which one a session budgets against.
export function profiles() {
  const out = { default: process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') };
  for (const d of projectsDirs()) {
    const p = join(d, '_secrets', 'claude-profiles');
    if (existsSync(p)) for (const n of readdirSync(p)) out[n] = join(p, n);
  }
  return out;
}

// #2329 (4 Oct): the logins under _secrets/claude-profiles expire after hours and nothing renewed them, so usage went blind for
// ~20 h. Now usaged renews them itself with the refreshToken (the same OAuth refresh Claude Code does). Only those profiles, never
// the default ~/.claude login (Claude Code refreshes that one; two renewers would race and rotate each other out). Brain workers
// use `claude setup-token` tokens in BRAIN_HOME, so rotation here cannot log them out. A token is never printed or logged.
export const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
export const TOKEN_URLS = ['https://platform.claude.com/v1/oauth/token', 'https://console.anthropic.com/v1/oauth/token'];
export const RENEW_MARGIN_MS = 5 * 60e3;
const credOf = (raw) => raw.claudeAiOauth || raw;
export async function renewLogin(dir, { fetchFn = (u, o) => netFetch(u, o), now = Date.now() } = {}) {
  const CRED = join(dir, '.credentials.json');
  let raw, o;
  try { raw = JSON.parse(readFileSync(CRED, 'utf8')); o = credOf(raw); } catch (e) { return { ok: false, why: 'unreadable credentials: ' + e.message }; }
  if (!o.refreshToken) return { ok: false, why: 'no refresh token: run ADD-CLAUDE-ACCOUNT.cmd for this account' };
  if (o.refreshTokenExpiresAt && o.refreshTokenExpiresAt < now) return { ok: false, why: `refresh token expired ${new Date(o.refreshTokenExpiresAt).toISOString()}: run ADD-CLAUDE-ACCOUNT.cmd for this account` };
  let j = null, why = 'no token endpoint answered';
  for (const url of TOKEN_URLS) {
    let r;
    try { r = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: o.refreshToken, client_id: OAUTH_CLIENT_ID }) }); }
    catch (e) { why = 'renewal network error: ' + e.message; continue; }
    if (r.ok) { j = await r.json().catch(() => null); if (j && j.access_token) break; why = 'renewal answered without a token'; j = null; continue; }
    why = `renewal refused (HTTP ${r.status})`;
    if (r.status === 400 || r.status === 401 || r.status === 403) { why += ': the refresh token is no longer valid, run ADD-CLAUDE-ACCOUNT.cmd for this account'; break; }
  }
  if (!j) return { ok: false, why };
  const o2 = { ...o, accessToken: j.access_token, refreshToken: j.refresh_token || o.refreshToken, expiresAt: now + (Number(j.expires_in) || 3600) * 1000 };
  const out = raw.claudeAiOauth ? { ...raw, claudeAiOauth: o2 } : o2;
  try {                                              // atomic, and BEFORE the new token is used anywhere
    copyFileSync(CRED, CRED + '.prev');
    writeFileSync(CRED + '.tmp', JSON.stringify(out, null, 1)); renameSync(CRED + '.tmp', CRED);
  } catch (e) { return { ok: false, why: 'renewed but could not save the new login (' + e.message + '); run ADD-CLAUDE-ACCOUNT.cmd for this account' }; }
  return { ok: true, renewed: true, expiresAt: o2.expiresAt };
}

// 14 Oct (#7473): Node's fetch ignores HTTPS_PROXY, so on a host that only reaches the internet through a proxy (the sandbox/cloud boxes)
// every live read died with "fetch failed". When a proxy is set, go through curl (it honours the proxy and its CA); else plain fetch.
export const proxied = () => !!(process.env.HTTPS_PROXY || process.env.https_proxy);
export function curlFetch(url, { headers = {}, method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const a = ['-sS', '-m', '20', '-X', method, '-w', '\n%{http_code}'];
    for (const [k, v] of Object.entries(headers)) a.push('-H', `${k}: ${v}`);
    if (body != null) a.push('--data-binary', '@-');
    a.push(url);
    const c = spawn('curl', a); let out = '', err = '';
    c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (err += d));
    c.on('error', reject);
    c.on('close', (code) => {
      if (code !== 0) return reject(new Error('curl ' + code + ': ' + err.trim().slice(0, 100)));
      const i = out.lastIndexOf('\n'), status = Number(out.slice(i + 1)), text = out.slice(0, i);
      resolve({ status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) });
    });
    c.stdin.end(body != null ? body : undefined);
  });
}
export const netFetch = (u, o) => (proxied() ? curlFetch(u, o) : fetch(u, o));
export async function readUsage(dir, { renew = false, fetchFn = netFetch, now = Date.now() } = {}) {
  const CRED = join(dir, '.credentials.json');
  if (!existsSync(CRED)) return { ok: false, why: `no Claude Code login in ${dir}` };
  const tokenOf = () => { const c = credOf(JSON.parse(readFileSync(CRED, 'utf8'))); return { tok: c.accessToken, exp: c.expiresAt }; };
  let tok, exp, renewedNote = null;
  try { ({ tok, exp } = tokenOf()); } catch (e) { return { ok: false, why: 'unreadable credentials: ' + e.message }; }
  const doRenew = async () => { const r = await renewLogin(dir, { fetchFn, now }); if (!r.ok) return r; ({ tok, exp } = tokenOf()); renewedNote = true; return r; };
  if (renew && exp && exp < now + RENEW_MARGIN_MS) { const r = await doRenew(); if (!r.ok) return { ok: false, why: 'login expired and ' + r.why }; }
  const get = (u) => fetchFn(u, { headers: { Authorization: `Bearer ${tok}`, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'mclite-usaged' } });
  let r = await get('https://api.anthropic.com/api/oauth/usage');
  if (r.status === 401 && renew && !renewedNote) { const rr = await doRenew(); if (!rr.ok) return { ok: false, why: 'login rejected and ' + rr.why, status: 401 }; r = await get('https://api.anthropic.com/api/oauth/usage'); }
  if (r.status === 401) return { ok: false, why: renew ? 'login rejected even after renewing it' : 'login expired; opening Claude Code once refreshes it', status: 401 };
  if (!r.ok) return { ok: false, why: `HTTP ${r.status}`, status: r.status };
  const j = await r.json();
  const pick = (k) => j[k] ? { pct: j[k].utilization, resets_at: j[k].resets_at } : null;
  let email = null;
  try { const p = await get('https://api.anthropic.com/api/oauth/profile'); if (p.ok) { const pj = await p.json(); email = (pj.account || pj).email || null; } } catch {}
  return { ok: true, email, week: pick('seven_day'), window: pick('five_hour'), raw: j, ...(renewedNote ? { renewed: true } : {}) };
}

// One plain-English line per account for `usaged --print` / USAGE.cmd (Dan, 4 Oct: an easy way that is not Claude in Chrome).
export function table(rec, now = Date.now()) {
  const left = (iso) => { if (!iso) return '?'; const m = Math.round((Date.parse(iso) - now) / 60e3); if (m <= 0) return 'already reset'; return m >= 1440 ? `${Math.floor(m / 1440)}d ${Math.floor(m % 1440 / 60)}h` : m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
  const lines = [`Claude usage, read ${rec.at}`, ''];
  for (const [n, u] of Object.entries(rec.accounts)) {
    if (!u.ok) { lines.push(`${n.padEnd(8)} UNKNOWN - ${u.why}`); continue; }
    lines.push(`${n.padEnd(8)} ${(u.email || '').padEnd(28)} 5-hour ${String(u.window?.pct ?? '?').padStart(3)}% (resets in ${left(u.window?.resets_at)})   week ${String(u.week?.pct ?? '?').padStart(3)}% (resets in ${left(u.week?.resets_at)})${u.stale ? '   [older reading]' : ''}`);
  }
  return lines.join('\n');
}

// #2246 (3 Oct): a failed reading used to keep the last good one as {ok:true, stale:true} under a NEW rec.at, so the fill, the
// 95% rule and the run lines treated a ~20 h old number as "1 min old" (both logins' tokens had expired). Now every good reading
// carries its own `readAt`; a kept one stays usable only while it is under STALE_OK_MIN old (a transient 429/network blip), after
// that the account is {ok:false, stale:true} = UNKNOWN to every consumer (they already treat a window-less account as blind:
// at most one worker), and `lastGood` keeps the old numbers for a human to read with their true age.
export const STALE_OK_MIN = 30;
export function keepStale(rec, old, nowMs = Date.parse(rec.at)) {
  for (const [n, u] of Object.entries(old.accounts || {})) {
    if (rec.accounts[n]?.ok) continue;
    const good = u.ok ? u : u.lastGood && { ...u.lastGood, ok: true };
    if (!good) continue;
    const readAt = good.readAt || old.at, ageMin = Math.round((nowMs - Date.parse(readAt)) / 60e3);
    const { stale, ...g } = good;
    const why = rec.accounts[n]?.why || 'no live reading';
    rec.accounts[n] = ageMin <= STALE_OK_MIN
      ? { ...g, readAt, stale: true }
      : { ok: false, stale: true, why: `UNKNOWN: no live reading for ${ageMin >= 120 ? Math.round(ageMin / 60) + ' h' : ageMin + ' min'} (${why}); last good ${readAt}`, email: g.email, lastGood: { ...g, readAt } };
  }
}

async function publish(all, { write = true } = {}) {   // write:false = `--print`: a read-only view (a foreign host's disk figure must never reach the gate: 4 Oct, a 2.9 GB reading from the VM stopped every session for 10 s)
  let diskFreeGB = null;                                   // the system drive: the gate stops sessions below 8 GB
  try { const { statfsSync } = await import('node:fs'); const st = statfsSync(process.env.SystemDrive ? process.env.SystemDrive + '\\' : '/'); diskFreeGB = (st.bavail * st.bsize) / 1024 ** 3; } catch {}
  const rec = { at: new Date().toISOString(), host: hostname(), diskFreeGB, accounts: {} };
  for (const [n, u] of Object.entries(all)) { const { raw, ...rest } = u; rec.accounts[n] = rest.ok ? { ...rest, readAt: rec.at } : rest; }
  const dir = projectsDirs().map((d) => join(d, '_status')).find(() => true);
  if (dir && write) {
    mkdirSync(dir, { recursive: true });
    const f = join(dir, 'usage.json');                       // keep an account's last GOOD reading if it expired since
    try { const old = JSON.parse(readFileSync(f, 'utf8')); keepStale(rec, old); } catch {}
    // atomic: a full disk once left a 0-byte usage.json and killed the service (28 Sept, #63)
    try { writeFileSync(f + '.tmp', JSON.stringify(rec, null, 1)); renameSync(f + '.tmp', f); } catch (e) { rec.file = 'not written: ' + e.message; }
  }
  if (write) try {
    const value = JSON.stringify(rec);
    const r = await gh('PATCH', '/repos/{repo}/actions/variables/MCLITE_USAGE', { name: 'MCLITE_USAGE', value }, { ok404: true });
    if (r === null) await gh('POST', '/repos/{repo}/actions/variables', { name: 'MCLITE_USAGE', value });
  } catch (e) { rec.github = 'not published: ' + e.message; }
  return rec;
}

if (process.argv[1] && process.argv[1].endsWith('usaged.mjs')) {
  const serve = process.argv.includes('--serve');
  // #4938: a service started once at logon ran pre-#2246 code for days and published failed reads as good. --serve now re-spawns itself
  // (same args, detached) and exits the moment its own code or an import of it changes on disk, so a landed fix reaches the running service.
  const WATCH = ['usaged.mjs', 'infra/vmwatch.mjs', 'infra/gh.mjs'].map((f) => fileURLToPath(new URL(f, import.meta.url)));
  const mt = () => WATCH.map((f) => { try { return statSync(f).mtimeMs; } catch { return 0; } }).join(',');
  const started = mt();
  do {
    const all = {};
    try { for (const [n, d] of Object.entries(profiles())) all[n] = await readUsage(d, { renew: n !== 'default' }).catch((e) => ({ ok: false, why: e.message })); } catch (e) { all.error = { ok: false, why: e.message }; }
    const rec = await publish(all, { write: !process.argv.includes('--print') }).catch((e) => ({ error: e.message }));   // one bad round never kills --serve
    if (!process.argv.includes('--print')) try { const w = await (await import('./infra/vmwatch.mjs')).tick(); if (w.restart || w.skipped === undefined && w.why) console.log('vmwatch', JSON.stringify(w)); } catch (e) { console.log('vmwatch: ' + e.message); }   // #2702
    console.log(process.argv.includes('--print') ? table(rec) : JSON.stringify(rec));
    if (!serve) break;
    await new Promise((r) => setTimeout(r, (Object.values(all).some((u) => u.status === 429) ? 15 : 5) * 60e3));
    if (mt() !== started) { console.log('usaged: my code changed on disk - restarting'); spawn(process.execPath, process.argv.slice(1), { detached: true, stdio: 'ignore', windowsHide: true }).unref(); process.exit(0); }
  } while (true);
}
