#!/usr/bin/env node
// scrubstablecheck.mjs (#10500) — a CHECK must not carry a literal the test mirror scrubs (tools/infra/mirror.mjs REPLACE: PC host name,
// account names, C:\Users\<name>, gmail addresses). Such a check is green on the PC and red on the hosted lander only (pcretirecheck, #10487).
// Runs scrubTree over every tools/*check.mjs and tools/stages.d/*.json and fails when the scrubbed text differs from the original.
// This file builds its own planted literal from pieces, as it must.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scrubTree } from './infra/mirror.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// checks that legitimately read scrubbed literals and are proven green on the mirror (measured 27 Oct)
const ALLOW = new Set(['mirrorfaultcheck', 'mobl3check', 'mobtexcheck', 'phonecontrolscheck', 'phonerequestscheck', 'phonerunscheck', 'phonestatscheck', 'phonewebcheck', 'vmcheck']);

export function scrubbed(files) {
  const { out } = scrubTree(files.map((f) => ({ path: f.path, buf: Buffer.from(f.text, 'utf8') })));
  return files.filter((f, i) => out[i] && out[i].buf.toString('utf8') !== f.text).map((f) => f.path);
}
const idOf = (p) => p.replace(/^.*\//, '').replace(/\.(mjs|json)$/, '');

const files = [];
for (const [dir, re] of [['tools', /check\.mjs$/], ['tools/stages.d', /\.json$/]])
  for (const n of readdirSync(join(ROOT, dir))) if (re.test(n)) files.push({ path: `${dir}/${n}`, text: readFileSync(join(ROOT, dir, n), 'utf8') });

let fails = 0, breaks = 0;
const bad = scrubbed(files).filter((p) => !ALLOW.has(idOf(p)));
for (const p of bad) { fails++; console.log(`   x ${p} carries a literal the mirror scrubs (build it from pieces like mirror.mjs)`); }

// anti-vacuity: a clean check with a planted literal must be named
const clean = files.find((f) => !scrubbed([f]).length);
const planted = [{ path: 'tools/plantedcheck.mjs', text: clean.text + `\nconst e = 'someone@` + `gmail.com';\n` }];
if (scrubbed(planted).join() === 'tools/plantedcheck.mjs') { breaks++; console.log('   ✓ planted literal caught'); } else { fails++; console.log('   x planted literal not caught'); }
if (!scrubbed([clean]).length) { breaks++; console.log('   ✓ clean file passes'); } else { fails++; console.log('   x clean file flagged'); }
console.log(`scrubstablecheck: ${files.length + 2} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
