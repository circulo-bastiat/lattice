#!/usr/bin/env node
// runplace.mjs — the referee's BLOCK PLACEMENT STATE runner (infra I6, s146). Scenarios + geometry: placescen.mjs.
//   node tools/referee/runplace.mjs [--only <regex>]      (63 scenes x 2 reps, ~2.5 min; --only merges into place.json)
// ONE growbot survival player at (0.5, F, 0.5), /tp'd with the yaw/pitch of the exact eye->click-point vector, sends ONE Player
// Block Placement (0x2e) on the scene's clicked block/face/cursor; 0.3 s later every property of the block in each landing cell is
// read back with `execute if block` (one probe per value, the property lists from .mcdata/pc/blocks.json). Own port 25876 + work
// dir (MCLITE_PLACE_WORKDIR, default ~/.mclite-referee-place); golden -> <referee dir>/golden/place.json.
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { connectFakePlayer } from './growbot.mjs';
import { MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, REPS, cellsOf, clickOf, sideStoneOf, EYE } from './placescen.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const F = -58;
const ONLY = process.argv.includes('--only') ? new RegExp(process.argv[process.argv.indexOf('--only') + 1]) : null;
const BLOCKS = new Map(JSON.parse(readFileSync(join(MCLITE_ROOT, '.mcdata', 'pc', 'blocks.json'), 'utf8')).map((b) => [b.name, b]));
export function lookAt(point) {   // vanilla yaw/pitch (degrees) from the eye at (0.5, EYE, 0.5) to a point relative to (0, F, 0)
  const dx = point[0] - 0.5, dy = point[1] - EYE, dz = point[2] - 0.5;
  return { yaw: Math.atan2(-dx, dz) * 180 / Math.PI, pitch: -Math.atan2(dy, Math.hypot(dx, dz)) * 180 / Math.PI };
}
async function main() {
  const workDir = process.env.MCLITE_PLACE_WORKDIR || join(homedir(), '.mclite-referee-place');
  rmSync(join(workDir, 'world'), { recursive: true, force: true });
  const server = await startServer({ workDir, port: 25876, rconPort: 26876, xmx: '1024M' });
  const t0 = Date.now();
  const cases = {}, notes = [];
  let rcon, bot, loop;
  try {
    for (let attempt = 1; ; attempt++) {
      try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; }
      catch (e) { if (attempt >= 15) throw e; await sleep(500); }
    }
    const C = (c) => rcon.command(c);
    const passed = async (c) => /Test passed/.test(String(await C(c)));
    for (const c of ['difficulty peaceful', 'gamerule doDaylightCycle false', 'time set 6000', 'gamerule doMobSpawning false',
      'gamerule doWeatherCycle false', 'weather clear', 'gamerule doTileDrops false', 'forceload add -16 -16 16 16']) await C(c);
    bot = await connectFakePlayer({ port: server.port, name: 'br0', confirmTeleports: true });
    await sleep(1500);
    await C('gamemode survival br0');
    await C(`tp br0 0.5 ${F} 0.5 0 0`);
    loop = setInterval(() => { if (!bot.closed) bot.sendPos(0.5, F, 0.5, true); }, 50);
    await sleep(2500);
    for (const s of SCEN.filter((q) => !ONLY || ONLY.test(q.id))) {
      const c = cases[s.id] = { attempts: 0, states: {} };
      const k = clickOf(s), look = lookAt(k.point);
      for (let r = 0; r < REPS; r++) {
        await C('kill @e[type=!player]');
        await C(`fill -3 ${F} -3 4 ${F + 3} 4 minecraft:air`);
        await C(`fill -3 ${F - 1} -3 4 ${F - 1} 4 minecraft:stone`);
        if (s.at === 'side') { const [x, y, z] = sideStoneOf(s); await C(`setblock ${x} ${F + y} ${z} minecraft:stone`); }
        await C(`tp br0 0.5 ${F} 0.5 ${look.yaw.toFixed(4)} ${look.pitch.toFixed(4)}`);
        await C('clear br0');
        await C(`item replace entity br0 weapon.mainhand with minecraft:${s.item} 1`);
        await sleep(250);
        bot.useOnBlock(k.block[0], F + k.block[1], k.block[2], k.face, k.cursor[0], k.cursor[1], k.cursor[2]);
        await sleep(300);
        const got = [];
        for (const [x, y, z] of cellsOf(s)) {
          let name = null;
          for (const n of ['air', ...(s.names || [s.item])]) if (await passed(`execute if block ${x} ${F + y} ${z} minecraft:${n}`)) { name = n; break; }
          if (!name) { got.push('other'); continue; }
          const props = [];
          for (const p of (BLOCKS.get(name) || {}).states || []) {
            const vals = p.type === 'bool' ? ['true', 'false'] : p.type === 'int' ? p.values || Array.from({ length: p.num_values }, (_, i) => String(i)) : p.values;
            let v = '?';
            for (const val of vals) if (await passed(`execute if block ${x} ${F + y} ${z} minecraft:${name}[${p.name}=${val}]`)) { v = val; break; }
            props.push(`${p.name}=${v}`);
          }
          got.push(props.length ? `${name}[${props.sort().join(',')}]` : name);
        }
        const key = got.join(' | ');
        c.states[key] = (c.states[key] || 0) + 1;
        c.attempts++;
      }
      console.log(`  ${s.id.padEnd(22)} ${JSON.stringify(c.states)}`);
    }
  } finally {
    if (loop) clearInterval(loop);
    if (bot) { try { bot.close(); } catch (e) { /* gone */ } }
    if (rcon) rcon.close();
    await server.stop();
  }
  const golden = { pack: 'place', version: '1.18.2', REPS, F,
    clock: 'growbot survival at (0.5,F,0.5), /tp yaw/pitch = the eye->click-point vector, one Player Block Placement, 0.3 s -> every property of each landing cell',
    generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), cases, notes };
  const dir = join(refereeWorkDir(), 'golden');
  mkdirSync(dir, { recursive: true });
  if (ONLY && existsSync(join(dir, 'place.json'))) {
    const old = JSON.parse(readFileSync(join(dir, 'place.json'), 'utf8'));
    golden.cases = Object.assign({}, old.cases, cases); golden.seconds += old.seconds || 0;
  }
  writeFileSync(join(dir, 'place.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runplace: ${golden.seconds} s -> ${join(dir, 'place.json')}`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
