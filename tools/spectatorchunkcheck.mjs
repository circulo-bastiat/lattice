#!/usr/bin/env node
// spectatorchunkcheck.mjs - #8305: ThreadedAnvilChunkStorage.doesNotGenerateChunks. With spectatorsGenerateChunks=false a spectator's
// stream ring requests 0 NEW chunk generations; with true the normal ring; a survival player is unaffected. Anti-vacuity: breaks below.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WORLD = readFileSync(join(ROOT, 'src/07_world.js'), 'utf8');
const GM = readFileSync(join(ROOT, 'src/14e_gamemode.js'), 'utf8');
function run(worldSrc, mode, rule) {
  const NS = {};
  for (const f of ['00_ns', '01_util', '03_section']) new Function('MCL', readFileSync(join(ROOT, `src/${f}.js`), 'utf8'))(NS);
  new Function('MCL', GM)(NS);
  let gens = 0;
  NS.Survive = {};
  NS.Jobs = { mode: 'main', workers: [], requestGen: () => { gens++; return new Promise(() => {}); }, requestMesh: () => new Promise(() => {}), lastId: 1 };
  NS.Player = { mode: NS.Gamemode[mode.toUpperCase()] };
  NS.Commands = { ruleGet: () => String(rule) };
  new Function('MCL', worldSrc)(NS);
  NS.World.stream(0, 0, 4);
  return gens;
}
const fails = [];
function verify(src) {
  const f = [], a = run(src, 'spectator', false), b = run(src, 'spectator', true), c = run(src, 'survival', false);
  if (a !== 0) f.push(`spectator, rule false: ${a} generations (want 0)`);
  if (b <= 0) f.push('spectator, rule true: no generations');
  if (c !== b) f.push(`survival, rule false: ${c} generations (want ${b})`);
  return f;
}
let real;
try { real = verify(WORLD); } catch (e) { real = ['threw: ' + e.message]; }
const BREAKS = [
  ['rule ignored', WORLD.replace("return v === 'false' || v === false;", 'return false;')],
  ['gate removed', WORLD.replace('if (noGen) continue;', '')],
  ['survival gated too', WORLD.replace('!NS.Gamemode.isSpectator(e)', 'false')],
];
for (const [n, s] of BREAKS) if (s === WORLD) { console.log(' no-op break (not found):', n); process.exit(1); }
let caught = 0;
for (const [n, s] of BREAKS) { let r; try { r = verify(s); } catch (e) { r = ['threw']; } if (r.length) caught++; else console.log(' NOT CAUGHT:', n); }
for (const x of real) console.log(' FAIL:', x);
console.log(`spectatorchunkcheck: ${caught} breaks caught (of ${BREAKS.length})`);
process.exit(real.length || caught < BREAKS.length ? 1 : 0);
