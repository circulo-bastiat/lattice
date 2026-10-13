// pregen-fetch.mjs — step one of unblocking vanillacheck's golden pregen (QUEUE 0.4, D-543).
// Runs ON WINDOWS through the lane (`node tools/lane.mjs run pregenfetch -- node tools/pregen-fetch.mjs`):
// the VM and the cloud container cannot reach Mojang (D-498), but Dan's Windows PC can reach the
// internet directly. It (1) downloads the 1.18.2 SERVER jar from the URL and SHA-1 in the launcher's
// own 1.18.2.json manifest (the same c8f83c56… D-199's golden world came off), refusing any other
// bytes; (2) finds a Java >= 17 — PATH first, then the Minecraft launcher's bundled runtimes — and
// prints what it found. The 1.18.2 server jar is a bundler: its libraries are inside it, so no
// Maven fetch is needed. Output: jars/1.18.2/server.jar (gitignored) + one report line per step.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const URL_ = 'https://piston-data.mojang.com/v1/objects/c8f83c5655308435b3dcf03c06d9fe8740a77469/server.jar';
const SHA = 'c8f83c5655308435b3dcf03c06d9fe8740a77469';
const out = join(ROOT, 'jars', '1.18.2', 'server.jar');
const sha1 = (b) => createHash('sha1').update(b).digest('hex');

if (existsSync(out) && sha1(readFileSync(out)) === SHA) console.log('server.jar: already present, SHA-1 ok');
else {
  try {
    const r = await fetch(URL_);
    const b = Buffer.from(await r.arrayBuffer());
    if (sha1(b) !== SHA) { console.log(`server.jar: FAIL — got ${b.length} bytes with the wrong SHA-1 (HTTP ${r.status})`); process.exitCode = 1; }
    else { mkdirSync(join(ROOT, 'jars', '1.18.2'), { recursive: true }); writeFileSync(out, b); console.log(`server.jar: downloaded ${b.length} bytes, SHA-1 ok`); }
  } catch (e) { console.log('server.jar: FAIL — ' + e.message); process.exitCode = 1; }
}

const cands = ['java'];
const rt = join(process.env.APPDATA || '', '.minecraft', 'runtime');
if (existsSync(rt)) for (const d of readdirSync(rt)) cands.push(join(rt, d, 'windows-x64', d, 'bin', 'java.exe'));
let best = null;
for (const j of cands) {
  const r = spawnSync(j, ['-version'], { encoding: 'utf8' });
  const m = /version "(\d+)/.exec((r.stderr || '') + (r.stdout || ''));
  const v = m ? +m[1] : 0;
  console.log(`java: ${j} → ${v || 'not runnable'}`);
  if (v >= 17 && !best) best = j;
}
console.log(best ? `JAVA17: ${best}` : 'JAVA17: none found'); if (!best) process.exitCode = 1;
