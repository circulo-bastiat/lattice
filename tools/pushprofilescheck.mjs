// pushprofilescheck (#10418): ADD-CLAUDE-ACCOUNT -> pushprofiles uploads only logged-in profiles to CLAUDE_PROFILES, sealed, never printing a token; the cmd calls it.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const SRC = readFileSync('tools/infra/pushprofiles.mjs', 'utf8');
import { readdirSync } from 'node:fs';
let N = 0;
process.on('exit', () => { for (const x of readdirSync('tools/infra')) if (x.startsWith('_pp_mut_')) rmSync(join('tools/infra', x), { force: true }); });
async function verdict(code) {
  const f = join('tools', 'infra', `_pp_mut_${process.pid}_${++N}.mjs`); writeFileSync(f, code);
  const bad = [];
  try {
    const M = await import('file://' + join(process.cwd(), f));
    const b = mkdtempSync(join(tmpdir(), 'pp-')); const mk = (n, o) => { mkdirSync(join(b, '_secrets', 'claude-profiles', n), { recursive: true }); writeFileSync(join(b, '_secrets', 'claude-profiles', n, '.credentials.json'), JSON.stringify(o)); };
    mk('max', { claudeAiOauth: { accessToken: 'A', refreshToken: 'R' } }); mk('pro', { claudeAiOauth: { accessToken: 'A' } }); mk('default', { claudeAiOauth: { accessToken: 'A', refreshToken: 'R' } });
    const c = M.collect([b]);
    if (Object.keys(c).join() !== 'max') bad.push('collect must keep only logged-in, non-default profiles: got ' + Object.keys(c).join());
    const calls = []; const fake = async (u, i = {}) => { calls.push([u, i.method || 'GET', i.body]); return { status: 204, json: async () => ({ key: 'AAAA', key_id: 'k1' }) }; };
    const sod = { ready: Promise.resolve(), crypto_box_seal: (m) => m, from_string: (s) => s, from_base64: (s) => s, to_base64: (s) => 'ENC:' + s, base64_variants: { ORIGINAL: 1 } };
    const st = await M.push(c, { repo: 'o/l', token: 'TOK', f: fake, sod });
    const put = calls.find((x) => x[1] === 'PUT');
    if (st !== 204 || !put || !/\/repos\/o\/l\/actions\/secrets\/CLAUDE_PROFILES$/.test(put[0])) bad.push('push must PUT the CLAUDE_PROFILES secret of the repo');
    if (put && !/"max"/.test(JSON.parse(put[2]).encrypted_value)) bad.push('push must upload the collected profiles');
    if (put && (JSON.parse(put[2]).key_id !== 'k1' || !/^ENC:/.test(JSON.parse(put[2]).encrypted_value))) bad.push('push must send the sealed value with the key id');
  } catch (e) { bad.push('threw: ' + e.message); } finally { rmSync(f, { force: true }); }
  return bad;
}
const breaks = [SRC.replace('c.refreshToken && c.accessToken', 'c.accessToken'), SRC.replace("n === 'default' || ", ''), SRC.replace('/actions/secrets/CLAUDE_PROFILES`, { method: \'PUT\'', '/actions/secrets/OTHER`, { method: \'PUT\''), SRC.replace('crypto_box_seal(s.from_string(JSON.stringify(profiles))', 'crypto_box_seal(s.from_string("{}")'), SRC.replace('key_id: k.key_id', 'key_id: 0')];
const bad = await verdict(SRC); bad.forEach((x) => console.log('FAIL', x));
let caught = 0; for (const [i, s] of breaks.entries()) { if (s === SRC) { console.log('MUTATION DID NOT APPLY #' + (i + 1)); continue; } if ((await verdict(s)).length) caught++; else console.log('NOT CAUGHT #' + (i + 1)); }
console.log(`pushprofilescheck: ${bad.length} failed; ${caught} breaks caught (of ${breaks.length})`);
process.exit(bad.length || caught < breaks.length ? 1 : 0);
