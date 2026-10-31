// webpush.mjs - #3920 Web Push from node:crypto only (RFC 8291 aes128gcm payloads, RFC 8292 VAPID): no npm dependency in the brain VM.
// deliver() sends to every stored subscription, reports the dead ones (404/410) so the caller prunes them, and falls back to ntfy
// when nothing was delivered, so Dan is never silent. phonewebcheck proves it against a fake push service.
import crypto from 'node:crypto';
export const b64u = (b) => Buffer.from(b).toString('base64url');
const hkdf = (ikm, salt, info, len) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, len));

export function makeVapid() {
  const j = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({ format: 'jwk' });
  return { publicKey: b64u(Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')])), privateKey: j.d };
}
export function vapidHeader(endpoint, vapid, subject, now = Date.now()) {
  const pub = Buffer.from(vapid.publicKey, 'base64url');
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33)), d: vapid.privateKey } });
  const body = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' })) + '.' + b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  return `vapid t=${body}.${b64u(crypto.sign('sha256', Buffer.from(body), { key, dsaEncoding: 'ieee-p1363' }))}, k=${vapid.publicKey}`;
}
export function encrypt(payload, sub) {                 // sub = { keys: { p256dh, auth } } as PushSubscription.toJSON()
  const ua = Buffer.from(sub.keys.p256dh, 'base64url'), ecdh = crypto.createECDH('prime256v1'), salt = crypto.randomBytes(16);
  const as = ecdh.generateKeys();
  const ikm = hkdf(ecdh.computeSecret(ua), Buffer.from(sub.keys.auth, 'base64url'), Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32);
  const c = crypto.createCipheriv('aes-128-gcm', hkdf(ikm, salt, 'Content-Encoding: aes128gcm\0', 16), hkdf(ikm, salt, 'Content-Encoding: nonce\0', 12));
  const rec = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([as.length]), as, rec]);
}
export const urgencyOf = (priority) => (priority >= 4 ? 'high' : priority === 3 ? 'normal' : priority === 2 ? 'low' : 'very-low');
/** One send. Returns the HTTP status (0 = network error). */
export async function sendPush(sub, payload, { vapid, subject, urgency = 'high', ttl = 3600, fetch: f = fetch }) {
  try {
    const r = await f(sub.endpoint, { method: 'POST', body: encrypt(payload, sub), signal: AbortSignal.timeout(15e3),
      headers: { Authorization: vapidHeader(sub.endpoint, vapid, subject), TTL: String(ttl), Urgency: urgency, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream' } });
    return r.status;
  } catch { return 0; }
}
// Apple rejects a mailto: on a non-resolving domain (403 BadJwtToken), so the subject is the repo's https URL.
export const VAPID_SUBJECT = 'https://github.com/owner/mclite';
/** subs: [{endpoint, keys, ...}]. Returns { sent, dead: [subs that answered 404/410], fellBack }. ntfy() runs when nothing was delivered. */
export async function deliver({ subs, vapid, subject = VAPID_SUBJECT, text, title, url = '/', priority = 4, ttl, fetch: f, ntfy }) {
  const payload = JSON.stringify({ title, body: text, url, tag: url });
  const out = { sent: 0, dead: [], fellBack: false, statuses: [] };
  if (vapid) for (const s of subs || []) {
    const st = await sendPush(s, payload, { vapid, subject, urgency: urgencyOf(priority), ttl, fetch: f });
    out.statuses.push(`${new URL(s.endpoint).host}=${st}`);
    if (st >= 200 && st < 300) out.sent++; else if (st === 404 || st === 410) out.dead.push(s);
  }
  if (!out.sent) { out.fellBack = true; await ntfy(); }
  return out;
}
