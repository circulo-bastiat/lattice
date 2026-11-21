#!/usr/bin/env node
// lockstep/pearlrun.mjs -- #6312 (G17-L61): the pearl lane against the real server, salts 0..N-1 (SeedAgent pins java.util.Random per salt).
//   node tools/referee/lockstep/pearlrun.mjs [--salts 20] [--from 0] [--fault gravity]   -> one JSON line per salt, last line {"pearl":"done"|"partial"}
// Server traces are cached in tools/referee/lockstep/pearl-results/<salt>.json (a finished salt is never re-run).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAgent } from './run.mjs';
import { engineRows, comparePearl } from './pearllane.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url)), CACHE = join(HERE, 'pearl-results');
const arg = (k, d) => { const i = process.argv.indexOf(k); return i < 0 ? d : process.argv[i + 1]; };
export function serverTrace(salt, agent) {
  const f = join(CACHE, salt + '.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const dir = mkdtempSync(join(tmpdir(), 'pearl-' + salt + '-'));
  try {
    const out = join(dir, 'pearl.json');
    const jvm = [`-javaagent:${agent}`, `-Dmclite.lockstep.salt=${salt}`, `-Dmclite.lockstep.reset=${join(dir, 'reset.txt')}`, '--add-exports=java.base/jdk.internal.org.objectweb.asm=ALL-UNNAMED'];
    const r = spawnSync(process.execPath, [join(HERE, '..', 'runpearl.mjs')], { encoding: 'utf8', maxBuffer: 1 << 26,
      env: { ...process.env, MCLITE_PEARL_OUT: out, MCLITE_PEARL_WORKDIR: join(dir, 'srv'), MCLITE_LOCKSTEP_RESET: join(dir, 'reset.txt'), MCLITE_JVM_ARGS: jvm.join(' ') } });
    if (r.status !== 0) throw new Error('runpearl failed:\n' + (r.stderr || r.stdout).slice(-1500));
    const t = JSON.parse(readFileSync(out, 'utf8'));
    mkdirSync(CACHE, { recursive: true }); writeFileSync(f, JSON.stringify(t));
    return t;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const N = +arg('--salts', 20), from = +arg('--from', 0), t0 = Date.now();
  const agent = buildAgent(mkdtempSync(join(tmpdir(), 'lockstep-agent-')));
  let done = true, bad = 0;
  for (let salt = from; salt < N; salt++) {
    if (Date.now() - t0 > 480000 && !existsSync(join(CACHE, salt + '.json'))) { done = false; break; }   // each call stays under 10 minutes
    const s = serverTrace(salt, agent), div = comparePearl(s, engineRows(s));
    if (div) bad++;
    console.log(JSON.stringify({ salt, throws: s.uses, ok: !div, div }));
  }
  console.log(JSON.stringify({ pearl: done ? 'done' : 'partial', divergences: bad, again: done ? undefined : `node tools/referee/lockstep/pearlrun.mjs --salts ${N}` }));
}
