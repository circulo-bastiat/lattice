#!/usr/bin/env node
// phonewebcheck.mjs - #3920 step 1: the push pipeline. A fake push service decrypts what the brain sends (RFC 8291) and verifies the
// VAPID signature (RFC 8292); 410 endpoints are reported for pruning; a failed send falls back to ntfy. Plus static checks of the PWA
// (manifest, service worker, install hint) and the subscription upsert. ANTI-VACUITY: broken copies must be caught ("<n> breaks caught").
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const T = fileURLToPath(new URL('.', import.meta.url));
const rd = (p) => readFileSync(join(T, p), 'utf8');
const FILES = { wp: 'infra/webpush.mjs', subs: 'phone-web/subs.js', runs: 'phone-web/runs.js', controls: 'phone-web/controls.js', requests: 'phone-web/requests.js', home: 'phone-web/home.js', launch: 'brain/launch.mjs', build: 'phone-web/build.mjs', sw: 'phone-web/sw.js', manifest: 'phone-web/manifest.webmanifest', html: 'phone-web/index.html', app: 'phone-web/app.js', home: 'brain/home.mjs', yml: '../.github/workflows/phone-pages.yml' };
const SRC = Object.fromEntries(Object.entries(FILES).map(([k, p]) => [k, rd(p)]));
const hk = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

// the device side: a subscription + the decryption a push service client does
function device() {
  const e = crypto.createECDH('prime256v1'), pub = e.generateKeys(), auth = crypto.randomBytes(16);
  return { sub: (endpoint) => ({ endpoint, keys: { p256dh: pub.toString('base64url'), auth: auth.toString('base64url') } }),
    decrypt(body) {
      const salt = body.subarray(0, 16), idlen = body[20], as = body.subarray(21, 21 + idlen), rec = body.subarray(21 + idlen);
      const ikm = hk(e.computeSecret(as), auth, Buffer.concat([Buffer.from('WebPush: info\0'), pub, as]), 32);
      const d = crypto.createDecipheriv('aes-128-gcm', hk(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hk(ikm, salt, 'Content-Encoding: nonce\0', 12));
      d.setAuthTag(rec.subarray(rec.length - 16));
      const p = Buffer.concat([d.update(rec.subarray(0, rec.length - 16)), d.final()]);
      if (p[p.length - 1] !== 2) throw new Error('no 0x02 delimiter');
      return p.subarray(0, p.length - 1).toString();
    } };
}
let N = 0;
async function run(S, mods) {
  const f = [], ok = (c, m) => { N++; if (!c) f.push(m); };
  const W = mods.wp, Subs = mods.subs;
  // ---- the sender against a fake push service
  const vapid = W.makeVapid(), A = device(), B = device(), C = device(), seen = [];
  const status = { 'https://push.example/a': 201, 'https://push.example/b': 410, 'https://push.example/c': 404 };
  const fake = async (url, o) => { seen.push({ url, o }); if (!(url in status)) throw new Error('down'); return { status: status[url] }; };
  let ntfy = 0;
  const subs = [A.sub('https://push.example/a'), B.sub('https://push.example/b'), C.sub('https://push.example/c')];
  const r = await W.deliver({ subs, vapid, text: 'master is red', title: 'MC-Lite', url: '/#q1', priority: 5, fetch: fake, ntfy: async () => { ntfy++; } });
  ok(r.sent === 1 && !r.fellBack && ntfy === 0, `one of three delivered, no ntfy fallback (sent ${r.sent}, ntfy ${ntfy})`);
  ok(r.dead.length === 2 && r.dead.every((d) => /\/(b|c)$/.test(d.endpoint)), '410 and 404 endpoints are reported dead (pruned)');
  const a = seen.find((x) => x.url.endsWith('/a'));
  let pl = null; try { pl = JSON.parse(A.decrypt(a.o.body)); } catch {}
  ok(pl && pl.body === 'master is red' && pl.title === 'MC-Lite' && pl.url === '/#q1' && pl.tag === '/#q1', 'the device decrypts title/body/url/tag (aes128gcm)');
  ok(a.o.headers['Content-Encoding'] === 'aes128gcm' && a.o.headers.Urgency === 'high' && Number(a.o.headers.TTL) > 0, 'headers: Content-Encoding aes128gcm, Urgency high for priority 5, TTL');
  const auth = a.o.headers.Authorization, m = /^vapid t=([\w-]+\.[\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth || '');
  let sigOk = false, aud = null;
  if (m) { const pub = Buffer.from(m[3], 'base64url'), key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
    sigOk = m[3] === vapid.publicKey && crypto.verify('sha256', Buffer.from(m[1]), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[2], 'base64url')); aud = JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url')).aud; }
  ok(sigOk && aud === 'https://push.example', 'VAPID: ES256 signature verifies with the published public key, aud is the push service origin');
  ok(JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url')).sub === 'https://github.com/owner/mclite' && !/\.invalid/.test(W.VAPID_SUBJECT) && r.statuses.join() === 'push.example=201,push.example=410,push.example=404', 'VAPID sub is an https URL (Apple rejects mailto:@.invalid); per-endpoint status is reported');
  ok(W.urgencyOf(1) === 'very-low' && W.urgencyOf(2) === 'low' && W.urgencyOf(3) === 'normal' && W.urgencyOf(4) === 'high', 'urgency follows the priority');
  ntfy = 0; const r2 = await W.deliver({ subs: [B.sub('https://push.example/b'), A.sub('https://push.example/down')], vapid, text: 'x', title: 't', fetch: fake, ntfy: async () => { ntfy++; } });
  ok(r2.fellBack && ntfy === 1 && r2.sent === 0, 'every send failed (410 + network error): ntfy fallback runs once');
  ntfy = 0; await W.deliver({ subs: [], vapid, text: 'x', title: 't', fetch: fake, ntfy: async () => { ntfy++; } });
  ok(ntfy === 1, 'no subscriptions: ntfy fallback');
  // ---- the PWA, statically
  let mf = {}; try { mf = JSON.parse(S.manifest); } catch {}
  ok(mf.display === 'standalone' && mf.start_url && mf.scope && ['192x192', '512x512'].every((z) => (mf.icons || []).some((i) => i.sizes === z && i.type === 'image/png')), 'manifest: standalone, start_url, scope, 192 and 512 PNG icons');
  ok(/addEventListener\('push'[\s\S]*?showNotification\([\s\S]*?data: \{ url:/.test(S.sw) && /addEventListener\('notificationclick'[\s\S]*?data\.url[\s\S]*?(openWindow|navigate)/.test(S.sw), 'service worker: push shows a notification carrying the deep-link URL; a tap opens it');
  ok(/rel="manifest"/.test(S.html) && /rel="apple-touch-icon"/.test(S.html) && /apple-mobile-web-app-capable/.test(S.html) && /viewport-fit=cover/.test(S.html), 'index.html links the manifest, the apple-touch-icon, the standalone meta tags');
  ok(/Turn on alerts/.test(S.app) && /Add to Home Screen/.test(S.app) && /standalone\(\) \? ''/.test(S.app) && /userVisibleOnly: true/.test(S.app) && /MCLITE_VAPID/.test(S.app), "app: 'Turn on alerts' subscribes with the VAPID key, explains Add to Home Screen when not installed");
  ok(/localStorage\.setItem\('gh-token'/.test(S.app) && /register\('sw\.js'\)/.test(S.app), 'app: token screen, service worker registered');
  ok(/MCLITE_VAPID/.test(S.home) && /vapid\.json/.test(S.home) && /mode: 0o600/.test(S.home) && !/privateKey[^\n]*MCLITE_VAPID/.test(S.home) && /value: v\.publicKey/.test(S.home), 'brain: VAPID keypair kept in ~/.brain/vapid.json (0600), only the PUBLIC key published');
  ok(/deliver\(\{ subs/.test(S.home) && /ntfy\(\)/.test(S.home) && /DELETE[^\n]*issues\/comments/.test(S.home) && /labels=push-subs/.test(S.home), 'notify(): web push to the push-subs issue, prunes dead endpoints, ntfy on failure');
  ok(/mclite-phone/.test(S.yml) && /tools\/phone-web\/\*\*/.test(S.yml) && /PHONE_PAGES_TOKEN/.test(S.yml) && /build\.mjs _site/.test(S.yml), 'deploy workflow pushes the built site to the mclite-phone repo on changes to tools/phone-web');
  // ---- the subscription upsert
  const s1 = { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' } }, s2 = { endpoint: 'https://push.example/zz', keys: { p256dh: 'k2', auth: 'a2' } };
  const u1 = Subs.upsert([], s1); ok(u1.method === 'POST', 'upsert: first subscription is a new comment');
  const cs = [{ id: 7, body: u1.body }, { id: 8, body: Subs.body(s2) }];
  const u2 = Subs.upsert(cs, { ...s1, keys: { p256dh: 'new', auth: 'a' } });
  ok(u2.method === 'PATCH' && u2.id === 7, 'upsert: the same endpoint updates its own comment (not another device\'s)');
  ok(Subs.upsert(cs, { endpoint: 'https://push.example/other', keys: {} }).method === 'POST', 'upsert: a new device adds a comment');
  const parsed = Subs.parse([...cs, { id: 9, body: 'a human comment\n{"endpoint":"x"}' }, { id: 10, body: '<!-- push-sub x -->\n{bad' }]);
  ok(parsed.length === 2 && parsed[0].id === 7 && parsed[0].sub.endpoint === s1.endpoint, 'parse: only subscription comments, bad JSON skipped');
  // ---- icons
  const out = mkdtempSync(join(tmpdir(), 'pw-out-'));
  try { mods.build.build(out); const names = readdirSync(out); const p = readFileSync(join(out, 'icon-192.png'));
    ok(['index.html', 'app.js', 'ui.js', 'tabs.js', 'subs.js', 'mobs.js', 'runs.js', 'home.js', 'controls.js', 'requests.js', 'bugs.js', 'sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'].every((n) => names.includes(n)), 'build writes every file the manifest/index need');
    ok(p.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && p.readUInt32BE(16) === 192 && p.readUInt32BE(20) === 192, 'icon-192.png is a 192x192 PNG'); }
  catch (e) { ok(false, `build failed: ${e.message}`); }
  rmSync(out, { recursive: true, force: true });
  return f;
}
const load = async (src, d, name) => { const p = join(d, name); writeFileSync(p, src); return import(pathToFileURL(p).href); };
async function mods(S, d) {
  mkdirSync(join(d, 'infra'), { recursive: true }); mkdirSync(join(d, 'phone-web'), { recursive: true });
  writeFileSync(join(d, 'phone-web', 'index.html'), S.html); writeFileSync(join(d, 'phone-web', 'app.js'), S.app); writeFileSync(join(d, 'phone-web', 'sw.js'), S.sw); writeFileSync(join(d, 'phone-web', 'manifest.webmanifest'), S.manifest);
  writeFileSync(join(d, 'phone-web', 'subs.js'), S.subs); writeFileSync(join(d, 'phone-web', 'runs.js'), S.runs); writeFileSync(join(d, 'phone-web', 'controls.js'), S.controls); writeFileSync(join(d, 'phone-web', 'requests.js'), S.requests); writeFileSync(join(d, 'phone-web', 'home.js'), S.home); writeFileSync(join(d, 'phone-web', 'subs.cjs'), S.subs); for (const f of ['ui.js', 'tabs.js', 'bugs.js', 'mobs.js', 'theme.css']) writeFileSync(join(d, 'phone-web', f), readFileSync(join(T, 'phone-web', f), 'utf8'));
  const wp = await load(S.wp, join(d, 'infra'), 'webpush.mjs'), subs = (await import('node:module')).createRequire(import.meta.url)(join(d, 'phone-web', 'subs.cjs'));
  const build = await load(S.build, join(d, 'phone-web'), 'build.mjs');
  return { wp, subs, build };
}
const d0 = mkdtempSync(join(tmpdir(), 'pw-')); let fails = [];
fails = await run(SRC, await mods(SRC, d0)); const total = N; rmSync(d0, { recursive: true, force: true });
const rep = (k, a, b) => (S) => { if (!S[k].includes(a)) throw new Error(`no such text in ${k}: ${a}`); return { ...S, [k]: S[k].split(a).join(b) }; };
const BREAKS = [
  ['VAPID subject is the invalid mailto again', rep('wp', "VAPID_SUBJECT = 'https://github.com/owner/mclite'", "VAPID_SUBJECT = 'mailto:brain@mclite.invalid'")],
  ['per-endpoint status not recorded', rep('wp', 'out.statuses.push(', '0 && out.statuses.push(')],
  ['wrong HKDF info: nothing decrypts', rep('wp', "'Content-Encoding: aes128gcm\\0'", "'Content-Encoding: aes128gcm'")],
  ['no padding delimiter', rep('wp', 'Buffer.from([2])', 'Buffer.from([1])')],
  ['VAPID signed in DER, not raw', rep('wp', "dsaEncoding: 'ieee-p1363'", "dsaEncoding: 'der'")],
  ['VAPID aud is not the push origin', rep('wp', 'new URL(endpoint).origin', "'https://x.example'")],
  ['410 is not pruned', rep('wp', 'st === 404 || st === 410', 'st === 404')],
  ['no ntfy fallback', rep('wp', 'if (!out.sent) {', 'if (false) {')],
  ['ntfy always runs', rep('wp', 'if (!out.sent) {', 'if (true) {')],
  ['urgency always high', rep('wp', "priority === 2 ? 'low' : 'very-low'", "priority === 2 ? 'high' : 'high'")],
  ['no TTL header', rep('wp', 'TTL: String(ttl), ', '')],
  ['manifest not standalone', rep('manifest', '"standalone"', '"browser"')],
  ['manifest lacks the 512 icon', rep('manifest', '"512x512"', '"256x256"')],
  ['service worker ignores push', rep('sw', "addEventListener('push'", "addEventListener('pushx'")],
  ['a tap opens no deep link', rep('sw', 'data.url', 'data.u')],
  ['no apple-touch-icon', rep('html', 'rel="apple-touch-icon"', 'rel="icon"')],
  ['no install hint in Safari', rep('app', 'Add to Home Screen', 'Install')],
  ['subscription without the VAPID key', rep('app', 'userVisibleOnly: true', 'userVisibleOnly: false')],
  ['upsert always adds a comment', rep('subs', "mine ? { method: 'PATCH'", "false ? { method: 'PATCH'")],
  ['upsert patches another device', rep('subs', 'startsWith(`${MARK}${key(sub.endpoint)} -->`)', 'startsWith(MARK)')],
  ['parse keeps human comments', rep('subs', "filter((c) => (c.body || '').startsWith(MARK))", 'filter((c) => true)')],
  ['private key published', rep('home', 'value: v.publicKey', 'value: v.privateKey')],
  ['vapid.json world-readable', rep('home', 'mode: 0o600', 'mode: 0o644')],
  ['dead endpoints never pruned', rep('home', 'DELETE', 'GET')],
  ['icons are not PNG', rep('build', "writeFileSync(join(out, n), png(s))", "writeFileSync(join(out, n), Buffer.alloc(10))")],
  ['deploy workflow dropped', rep('yml', 'tools/phone-web/**', 'nothing/**')],
];
let caught = 0;
for (const [name, mut] of BREAKS) {
  const d = mkdtempSync(join(tmpdir(), 'pw-')); let r;
  try { const S = mut(SRC); r = await run(S, await mods(S, d)); } catch (e) { r = [`threw: ${e.message}`]; if (/no such text/.test(e.message)) fails.push(`break "${name}": ${e.message}`); }
  rmSync(d, { recursive: true, force: true });
  if (r.length) { caught++; console.log(`  ✓ break caught: ${name}`); } else fails.push(`break NOT caught: ${name}`);
}
console.log(`phonewebcheck: ${caught} breaks caught (of ${BREAKS.length})`);
for (const x of fails) console.log(`  ✗ ${x}`);
console.log(` assertions passed .... ${total - fails.filter((x) => !/^break/.test(x)).length}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
