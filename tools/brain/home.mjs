// home.mjs - the brain's machine-local state (#86). Lives OUTSIDE the repo and the synced folder, in BRAIN_HOME
// (default ~/.brain in the sandbox VM): tokens/<account>.txt (claude setup-token output), github-token, ntfy-topic,
// history.json (starts, alerts), logs/. brain-setup.sh fills it; nothing here is ever committed.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { gh, busIssue } from '../infra/gh.mjs';
import { makeVapid, deliver } from '../infra/webpush.mjs';
import Subs from '../phone-web/subs.js';
export { busIssue };

export const HOME = process.env.BRAIN_HOME || join(homedir(), '.brain');
export const P = (...a) => join(HOME, ...a);
export const CFG = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'roles.json'), 'utf8'));
export const secret = (...a) => { const f = P(...a); return existsSync(f) ? readFileSync(f, 'utf8').trim() : null; };
export function history() {                                              // #6549: default ONLY when the file is absent
  for (let i = 0; i < 20; i++) {
    try { return JSON.parse(readFileSync(P('history.json'), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') break; }
  }
  return { starts: [], alerts: [], told: [] };
}
export function saveHistory(h) {
  mkdirSync(HOME, { recursive: true });
  const cut = Date.now() - 7 * 86400e3;                                  // keep a week
  for (const k of ['starts', 'alerts', 'told']) h[k] = (h[k] || []).filter((x) => x.at > cut);
  const tmp = P(`history.json.${process.pid}.tmp`);                    // temp + rename: readers never see a truncated file
  writeFileSync(tmp, JSON.stringify(h, null, 1));
  renameSync(tmp, P('history.json'));
}
/** VAPID keys for Web Push (#3920): generated once into ~/.brain/vapid.json (the private key never leaves it); the public key is
 *  published as repo variable MCLITE_VAPID, which the phone app reads to subscribe. Retried until the variable is set. */
async function vapidKeys() {
  let v; try { v = JSON.parse(readFileSync(P('vapid.json'), 'utf8')); } catch { v = { ...makeVapid(), published: false }; mkdirSync(HOME, { recursive: true }); writeFileSync(P('vapid.json'), JSON.stringify(v), { mode: 0o600 }); }
  if (!v.published) {
    const body = { name: 'MCLITE_VAPID', value: v.publicKey };
    try { await gh('POST', '/repos/{repo}/actions/variables', body); } catch { await gh('PATCH', '/repos/{repo}/actions/variables/MCLITE_VAPID', body); }
    v.published = true; writeFileSync(P('vapid.json'), JSON.stringify(v), { mode: 0o600 });
  }
  return v;
}
/** Push to Dan's phone: real Web Push to every subscribed device (comments on the `push-subs` issue), dead endpoints pruned; if nothing
 *  was delivered, or anything at all fails, the old ntfy POST (topic in ntfy-topic). Never throws: a missed push must not kill the brain. */
export async function notify(text, { title = 'MC-Lite', priority = 4, url = '/' } = {}) {
  const ntfy = async () => {
    const topic = secret('ntfy-topic');
    if (!topic) return console.log(`(no ntfy topic) would notify: ${text}`);
    try { await fetch(`https://ntfy.sh/${topic}`, { method: 'POST', body: text, signal: AbortSignal.timeout(15e3), headers: { Title: title, Priority: String(priority), Tags: 'robot' } }); }
    catch (e) { console.log(`ntfy failed: ${e.message}`); }
  };
  try {
    const vapid = await vapidKeys(), issue = ((await gh('GET', '/repos/{repo}/issues?labels=push-subs&state=open&per_page=1')) || [])[0];
    const found = issue ? Subs.parse((await gh('GET', `/repos/{repo}/issues/${issue.number}/comments?per_page=100`)) || []) : [];
    const r = await deliver({ subs: found.map((x) => x.sub), vapid, text, title, url, priority, ntfy });
    console.log(`web push: sent ${r.sent}/${found.length}${r.statuses.length ? ` (${r.statuses.join(', ')})` : vapid ? '' : ' (no vapid)'}`);
    for (const d of r.dead) { const c = found.find((x) => x.sub.endpoint === d.endpoint); if (c) await gh('DELETE', `/repos/{repo}/issues/comments/${c.id}`).catch(() => {}); }
  } catch (e) { console.log(`web push failed: ${e.message}`); await ntfy(); }
}
/** Post on the bus as the brain. The PAT posts it, so it DOES trigger brain.yml - route.mjs ignores from: brain. */
export async function post(to, text, extra = '') {
  const body = `to: ${to}\nfrom: brain\n${extra}\n${text}`;
  return gh('POST', `/repos/{repo}/issues/${await busIssue()}/comments`, { body });
}
/** #3947: a mail to a role at its maxPerHour cap is parked here (one marker per role) until the hour rolls; fill() re-routes it. */
/** #4176: a `to: dan` question (it has an `options:` line) is mirrored onto the open issue labelled `dan-questions`, where the phone app finds it
 *  however busy the bus is (it holds only the last hours). Best effort: a failed mirror never blocks the push. Format = phone-web/controls.js mirrorBody. */
export async function mirrorQuestion(commentId, body) {
  if (!/^options:\s*\S/m.test(String(body))) return false;
  try {
    const l = (await gh('GET', '/repos/{repo}/issues?labels=dan-questions&state=open&per_page=1')) || [];
    const n = (l[0] || await gh('POST', '/repos/{repo}/issues', { title: 'questions to Dan (one comment each; mirrored by the brain, answered from the phone app)', labels: ['dan-questions'] })).number;
    await gh('POST', `/repos/{repo}/issues/${n}/comments`, { body: `<!-- dan-q ${commentId} -->\n${body}` });
    return true;
  } catch (e) { console.log(`question mirror failed: ${e.message}`); return false; }
}
export const pendingMail = () => { try { return JSON.parse(readFileSync(P('pending-mail.json'), 'utf8')); } catch { return {}; } };
export function setPendingMail(role, v) {
  const m = pendingMail(); if (v) m[role] = v; else delete m[role];
  mkdirSync(HOME, { recursive: true }); writeFileSync(P('pending-mail.json'), JSON.stringify(m, null, 1));
}
