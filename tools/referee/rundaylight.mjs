#!/usr/bin/env node
// rundaylight.mjs — the referee's DAYLIGHT DETECTOR runner (infra I6, 24 Sept 2026).
//
//   node tools/referee/rundaylight.mjs      # ~40 s
//
// Two detectors (normal + inverted) under open sky, clear weather, doDaylightCycle off. For each time of day in
// TIMES: `time set t`, wait 1.5 s (> the detector's once-per-20-ticks update: one bounded wait on a server WE started,
// not polling a queue -- D-436), then read both detectors' `power` (one `execute if block` per level).
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/daylight.json  { times, normal[], inverted[] }
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';

export const TIMES = Array.from({ length: 49 }, (_, i) => i * 500).concat([12500, 13000, 13500, 22500, 23000, 23500, 12750, 23250]);
const P = { x: 8, y: -60, z: 200 };

async function main() {
  const server = await startServer({});
  let rcon;
  const t0 = Date.now();
  const normal = [], inverted = [], notes = [];
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); }
    }
    for (const c of ['gamerule doDaylightCycle false', 'weather clear 1000000', `forceload add ${P.x - 8} ${P.z - 8} ${P.x + 8} ${P.z + 8}`,
                     `fill ${P.x - 4} -61 ${P.z - 4} ${P.x + 4} 200 ${P.z + 4} minecraft:air`, `fill ${P.x - 4} -61 ${P.z - 4} ${P.x + 4} -61 ${P.z + 4} minecraft:stone`,
                     `setblock ${P.x} ${P.y} ${P.z} minecraft:daylight_detector[inverted=false]`,
                     `setblock ${P.x + 2} ${P.y} ${P.z} minecraft:daylight_detector[inverted=true]`]) {
      const r = await rcon.command(c);
      if (/Unknown|Invalid|Incorrect|expected|error/i.test(r)) notes.push(`${c}: ${r.trim().slice(0, 100)}`);
    }
    const readPower = async (x, inv) => {
      for (let L = 0; L < 16; L++) {
        const r = await rcon.command(`execute if block ${x} ${P.y} ${P.z} minecraft:daylight_detector[inverted=${inv},power=${L}]`);
        if (/passed/i.test(r)) return L;
      }
      return -1;
    };
    for (const t of TIMES) {
      await rcon.command(`time set ${t}`);
      await new Promise((r) => setTimeout(r, 1500));
      normal.push(await readPower(P.x, false));
      inverted.push(await readPower(P.x + 2, true));
    }
  } finally {
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'daylight', version: '1.18.2', generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    times: TIMES, normal, inverted, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  const out = join(dir, 'daylight.json');
  writeFileSync(out, JSON.stringify(golden) + '\n');
  console.log(`referee/rundaylight: ${TIMES.length} times in ${golden.seconds} s -> ${out}`);
  for (const n of notes) console.log('  - ' + n);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
