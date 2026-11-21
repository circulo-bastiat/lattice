#!/usr/bin/env node
// acctscopecheck.mjs - ACCTSCOPE (Dan, 8 Nov: only the accounts he lists exist; 10 Nov 'do a deep fixing'). roles.json `accounts` listed one account,
// yet `go.mjs status` still printed a second one four times (a login left in _secrets/claude-profiles and in the published usage record, carried
// forward for 323 h as 'UNKNOWN ... last good'). CLASS: anything that enumerates Claude accounts must take the list from roles.json.
// Behaviour on the real usaged.mjs (temp dirs, no network), the publish wiring, the status wording, then anti-vacuity on mutated copies.
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const rd = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const SRC = { usaged: rd('./usaged.mjs'), fmt: rd('./infra/usagefmt.mjs'), roles: rd('./brain/roles.json') };
const A = 'acct' + 'one', B = 'acct' + 'two';   // neutral fixture names
// run the pure helpers out of the source text (no imports needed by them except fs/path, which we hand in)
const helpers = (src) => { const a = src.indexOf('export function configuredAccounts'), b = src.indexOf('export function profiles(');
  if (a < 0 || b < 0) throw new Error('configuredAccounts/inScope not found');
  return new Function('readFileSync', src.slice(a, b).replace(/export /g, '').replace(/new URL\('\.\/brain\/roles\.json', import\.meta\.url\)/, 'null') + '\nreturn { configuredAccounts, inScope };')(readFileSync); };
function verdict(S) {
  const bad = []; const t = (n, f) => { let r = false; try { r = !!f(); } catch { r = false; } if (!r) bad.push(n); };
  let H; try { H = helpers(S.usaged); } catch (e) { return ['helpers do not load: ' + e.message]; }
  const d = mkdtempSync(join(tmpdir(), 'as-')), f = join(d, 'roles.json'); writeFileSync(f, JSON.stringify({ accounts: [{ name: A }] }));
  t('the list comes from roles.json accounts', () => JSON.stringify(H.configuredAccounts(f)) === JSON.stringify([A]));
  t('an unreadable or empty roles.json means no filter (never blind)', () => H.configuredAccounts(join(d, 'none.json')) === null && (writeFileSync(join(d, 'e.json'), '{"accounts":[]}'), H.configuredAccounts(join(d, 'e.json')) === null));
  t('a listed account is in scope, an unlisted one is not, default always is', () => H.inScope(A, [A]) && !H.inScope(B, [A]) && H.inScope('default', [A]));
  t('no list = everything in scope', () => H.inScope(B, null) === true);
  t('profiles() lists only in-scope logins', () => /export function profiles\(keep = configuredAccounts\(\)\) \{[\s\S]{0,400}for \(const n of readdirSync\(p\)\) if \(inScope\(n, keep\)\) out\[n\] = join\(p, n\);/.test(S.usaged));
  t('profiles() does not unpack an out-of-scope login from the secret', () => /unpackProfiles\(undefined, undefined, undefined, keep\);/.test(S.usaged) && /\|\| !cred \|\| !inScope\(name, keep\)\) continue;/.test(S.usaged));
  t('publish drops an unlisted account before carrying old readings forward', () => /if \(!inScope\(n\)\) delete old\.accounts\[n\];[^\n]*\n\s*keepStale\(rec, old\);/.test(S.usaged));
  let C = {}; try { C = JSON.parse(S.roles); } catch { /* broken */ }
  t('roles.json lists at least one account, each with a plain name', () => Array.isArray(C.accounts) && C.accounts.length >= 1 && C.accounts.every((x) => /^[\w-]+$/.test(x.name || '')));
  t('the status usage line names no account besides the active one', () => { const m = /account "\$\{u\.account\}" \(([^)]*)\)/.exec(S.fmt); return !!m && m[1] === 'the ACTIVE one'; });
  return bad;
}
const real = verdict(SRC); for (const b of real) console.log('FAIL ' + b);
const rep = (s, a, b) => { if (!s.includes(a)) throw new Error('break text not found: ' + a.slice(0, 50)); return s.replace(a, b); };
const BREAKS = [
  ['list ignored', { ...SRC, usaged: rep(SRC.usaged, 'return Array.isArray(a) && a.length ? a.map((x) => x.name) : null;', 'return null;') }],
  ['empty list blinds usage', { ...SRC, usaged: rep(SRC.usaged, 'Array.isArray(a) && a.length ? a.map', 'Array.isArray(a) ? a.map') }],
  ['everything in scope', { ...SRC, usaged: rep(SRC.usaged, "name === 'default' || !keep || keep.includes(name)", 'true') }],
  ['default dropped', { ...SRC, usaged: rep(SRC.usaged, "name === 'default' || !keep || keep.includes(name)", '!keep || keep.includes(name)') }],
  ['profiles lists every folder', { ...SRC, usaged: rep(SRC.usaged, 'if (inScope(n, keep)) out[n] = join(p, n);', 'out[n] = join(p, n);') }],
  ['secret unpacked unfiltered', { ...SRC, usaged: rep(SRC.usaged, 'unpackProfiles(undefined, undefined, undefined, keep);', 'unpackProfiles();') }],
  ['unpack ignores the list', { ...SRC, usaged: rep(SRC.usaged, ' || !inScope(name, keep)) continue;', ') continue;') }],
  ['old readings carried forward', { ...SRC, usaged: rep(SRC.usaged, 'if (!inScope(n)) delete old.accounts[n];', '') }],
  ['roles.json lists nobody', { ...SRC, roles: JSON.stringify({ ...JSON.parse(SRC.roles), accounts: [] }) }],
  ['status wording names another account', { ...SRC, fmt: rep(SRC.fmt, '(the ACTIVE one)', '(the ACTIVE one, not necessarily ' + B + ')') }],
];
let caught = 0; for (const [n, S] of BREAKS) { if (verdict(S).length) caught++; else console.log('NOT CAUGHT: ' + n); }
console.log(`acctscopecheck: ${real.length ? 'FAIL' : 'ok'}, ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
