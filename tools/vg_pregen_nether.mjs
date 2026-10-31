#!/usr/bin/env node
// vg_pregen_nether.mjs — #256: the REAL 1.18.2 server generates a patch of the Nether; the blocks are kept
// as tools/golden/nether-golden-1.18.2.json for netherterraincheck §7.  Needs jars/1.18.2/server.jar + Java 17.
//   node tools/vg_pregen_nether.mjs [--seed 12345] [--half 4]
// Same recipe as vg_pregen.mjs (jar SHA-1 refused if wrong, forceload, `save-all flush`, census after the JVM exits).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readNBT } from './nbt.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHA = 'c8f83c5655308435b3dcf03c06d9fe8740a77469';
const JAR = join(ROOT, 'jars', '1.18.2', 'server.jar');
const arg = (n, d) => { const i = process.argv.indexOf('--' + n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const SEED = arg('seed', 12345), H = arg('half', 4);
const die = (m) => { console.log('[nether] FAIL — ' + m); process.exit(1); };
if (!existsSync(JAR) || createHash('sha1').update(readFileSync(JAR)).digest('hex') !== SHA) die('no 1.18.2 server.jar with the right SHA-1');

const OUT = join(tmpdir(), 'vg_nether_' + process.pid); mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'eula.txt'), 'eula=true\n');
writeFileSync(join(OUT, 'server.properties'), [`level-seed=${SEED}`, 'level-type=minecraft\\:normal', 'online-mode=false', 'server-port=25598',
  'max-tick-time=-1', 'view-distance=4', 'simulation-distance=4', 'sync-chunk-writes=true', 'spawn-protection=0', ''].join('\n'));
const srv = spawn('java', ['-Xmx2G', '-jar', JAR, 'nogui'], { cwd: OUT, stdio: ['pipe', 'pipe', 'pipe'] });
const waiters = []; let exited = false, buf = '', tail = [];
srv.on('exit', () => { exited = true; for (const w of waiters.splice(0)) w.rej(new Error('server exited')); });
const onData = (d) => { buf += d; let k; while ((k = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, k); buf = buf.slice(k + 1); tail.push(l); if (tail.length > 30) tail.shift();
  for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].re.test(l)) waiters.splice(i, 1)[0].res(l); } };
srv.stdout.on('data', onData); srv.stderr.on('data', onData);
const waitFor = (re, ms) => new Promise((res, rej) => { const w = { re, res, rej }; waiters.push(w); setTimeout(() => rej(new Error('timeout ' + re)), ms); });
const cmd = (c) => srv.stdin.write(c + '\n');
const REG = join(OUT, 'world', 'DIM-1', 'region');

function chunkNBT(x, z) {
  const p = join(REG, `r.${x >> 5}.${z >> 5}.mca`); if (!existsSync(p)) return null;
  const raw = readFileSync(p), i = ((x & 31) + (z & 31) * 32) * 4, off = (raw[i] << 16 | raw[i + 1] << 8 | raw[i + 2]) * 4096;
  if (!off) return null;
  const len = raw.readInt32BE(off); const v = readNBT(raw.subarray(off + 5, off + 4 + len), { plain: true }).value;
  return v.Level ?? v;
}
const full = () => { let n = 0; for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) { try { const c = chunkNBT(x, z); if (c && String(c.Status).replace('minecraft:', '') === 'full') n++; } catch {} } return n; };

try {
  await waitFor(/\]: Done \(/, 600000);
  cmd(`execute in minecraft:the_nether run forceload add ${-H * 16} ${-H * 16} ${H * 16 + 15} ${H * 16 + 15}`);
  const want = (2 * H + 1) ** 2; let best = -1, last = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000)); cmd('save-all flush'); await waitFor(/Saved the game/, 300000);
    const n = full(); console.log(`[nether] full ${n}/${want}`);
    if (n >= want) break; if (n > best) { best = n; last = Date.now(); } else if (Date.now() - last > 180000) die('stalled');
  }
  cmd('stop'); if (!exited) await new Promise((r) => srv.on('exit', r));
} catch (e) { console.log(tail.join('\n')); die(e.message); }

// census + compact dump: per chunk, run-length blocks in the engine's order (y, z, x), y 0..127
const unpack = (data, plen) => { const out = new Uint16Array(4096); if (plen <= 1 || !data) return out; const bits = Math.max(4, 32 - Math.clz32(plen - 1)), per = Math.floor(64 / bits), m = (1n << BigInt(bits)) - 1n;
  for (let i = 0; i < 4096; i++) { const w = BigInt.asUintN(64, BigInt(data[Math.floor(i / per)])); out[i] = Number((w >> BigInt((i % per) * bits)) & m); } return out; };
const names = []; const nid = (n) => { n = n.replace('minecraft:', ''); let i = names.indexOf(n); if (i < 0) { i = names.length; names.push(n); } return i; };
const chunks = {};
for (let x = -H; x <= H; x++) for (let z = -H; z <= H; z++) {
  const c = chunkNBT(x, z); if (!c || String(c.Status).replace('minecraft:', '') !== 'full') die(`chunk ${x},${z} not full`);
  const col = new Uint16Array(128 * 256).fill(nid('air'));
  for (const s of c.sections) {
    const sy = s.Y; if (sy < 0 || sy > 7 || !s.block_states) continue;
    const pal = s.block_states.palette.map((p) => nid(p.Name)), idx = unpack(s.block_states.data, pal.length);
    for (let j = 0; j < 4096; j++) col[sy * 4096 + j] = pal[idx[j]];   // section order is y,z,x: the same as the engine's
  }
  const rle = []; let prev = -1, run = 0;
  for (const v of col) { if (v === prev) run++; else { if (run) rle.push(prev, run); prev = v; run = 1; } } rle.push(prev, run);
  chunks[x + ',' + z] = rle;
}
writeFileSync(join(ROOT, 'tools', 'golden', 'nether-golden-1.18.2.json'), JSON.stringify({
  note: 'GENERATED by tools/vg_pregen_nether.mjs (#256): blocks of the real 1.18.2 server\'s Nether, Status full, y 0..127, order y,z,x, run-length [name,count,...]',
  minecraft: '1.18.2', jarSha1: SHA, seed: SEED, half: H, names, chunks }) + '\n');
rmSync(OUT, { recursive: true, force: true });
console.log(`[nether] wrote golden: ${Object.keys(chunks).length} chunks, ${names.length} block names`);
