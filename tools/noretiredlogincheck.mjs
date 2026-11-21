#!/usr/bin/env node
// noretiredlogincheck.mjs (#11398, Dan 8 Nov): the retired second Claude login is gone from config text, docs and comments; Pro is the only
// login described. Fails when its name comes back anywhere outside docs/archive, docs/DECISIONS.md (frozen history) and src/. Check fixtures
// use the neutral `second`. The needle is built from pieces (the mirror scrubs account names, RUN.md step 2).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const N = ['M', 'a', 'x'].join(''), n = N.toLowerCase();
// the capitalised name as a word (not the real UI strings / Math.Max), or the lowercase name used as an account/pool/profile label
const CAP = new RegExp(`\\b${N}\\b(?! (Framerate|Health|\\d+ bottom))`);
const LOW = new RegExp(`(--account ${n}\\b|@${n}\\b|(account|acct|name|accounts|profiles|park|unpark)['"]?\\s*[:,=(]?\\s*\\{?\\s*['"]${n}['"]|['"]${n}['"]\\s*,\\s*workers|accounts: \\{ ${n}:)`);
const SKIP = /^(docs\/archive\/|docs\/DECISIONS\.md|src\/|assets\/|tools\/noretiredlogincheck\.mjs|tools\/stages\.d\/noretiredlogincheck\.json)/;

export function hits(files) {
  const out = [];
  for (const f of files) {
    if (SKIP.test(f.path)) continue;
    f.text.split('\n').forEach((l, i) => {
      if (/Math\]?::?\.?Max|\[Math\]/.test(l)) l = l.replace(/\[Math\]::Max/g, '');
      if (CAP.test(l) || LOW.test(l)) out.push(`${f.path}:${i + 1}`);
    });
  }
  return out;
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 1 << 28 }).toString().split('\0')
  .filter((p) => /\.(mjs|js|json|md|yml|yaml|cmd|txt|html|css)$/.test(p) && !SKIP.test(p));
const files = [];
for (const p of tracked) { try { files.push({ path: p, text: readFileSync(ROOT + p, 'utf8') }); } catch {} }

let fails = 0, breaks = 0;
for (const h of hits(files)) { fails++; console.log(`   x ${h} names the retired login (reword it, fixtures say "second")`); }

// anti-vacuity: planted names in each form must be caught; a clean line and the real UI string must not
const plant = (t) => hits([{ path: 'tools/x.mjs', text: t }]).length === 1;
for (const [t, why] of [[`// run on ${N} until its week`, 'capitalised prose'], [`const a = { account: '${n}' };`, 'account fixture'], [`'brain worker @${n}'`, 'run-name tag'], [`accounts: { ${n}: 1 }`, 'usage table'], [`{ name: '${n}', workers: 8 }`, 'roles accounts entry']]) {
  if (plant(t)) breaks++; else { fails++; console.log(`   x anti-vacuity: ${why} not caught`); }
}
if (hits([{ path: 'tools/x.mjs', text: `const second = 'second'; // ${N} Framerate\nMath.${n}(1, 2); { ${n}: 5 }` }]).length) { fails++; console.log('   x false positive on legitimate text'); }
if (hits([{ path: 'docs/archive/x.md', text: `${N} plan` }]).length) { fails++; console.log('   x docs/archive must be exempt'); }
console.log(`noretiredlogincheck: ${fails ? 'FAIL' : 'ok'} - ${files.length} files scanned, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
