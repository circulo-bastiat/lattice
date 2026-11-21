#!/usr/bin/env node
// runcrystal.mjs — #6082 referee runner: summon an end_crystal over a dirt slab with two NoAI pigs 3 and 8 blocks away, shoot an
// arrow into it (EndCrystalEntity.damage -> remove + createExplosion(6.0, DESTROY)), read the 1331 box cells' air bits and the
// pigs' Health. Golden -> <referee dir>/golden/crystal.json. Scene: crystalscen.mjs. Own port/work dir like runtnt.mjs.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { R, W, N, PIGS, readCells } from './crystalscen.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const O = [8, -50, 8];
async function main() {
  const t0 = Date.now(), [ox, oy, oz] = O, notes = [];
  const workDir = process.env.MCLITE_CRYSTAL_WORKDIR || join(homedir(), '.mclite-referee-crystal');
  const dp = join(workDir, 'world', 'datapacks', 'mcliteec');
  rmSync(dp, { recursive: true, force: true });
  const fdir = join(dp, 'data', 'mcliteec', 'functions');
  mkdirSync(fdir, { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'mclite referee crystal' } }));
  const cells = readCells();
  writeFileSync(join(fdir, 'read.mcfunction'), [`data modify storage mcliteec:r v set value [${cells.map(() => '0').join(',')}]`,
    ...cells.map(([x, y, z], i) => `execute store result storage mcliteec:r v[${i}] int 1 if block ${ox + x} ${oy + y} ${oz + z} minecraft:air`)].join('\n') + '\n');
  writeFileSync(join(fdir, 'scene.mcfunction'), [`fill ${ox - W} ${oy - 4} ${oz - W} ${ox + W} ${oy + 8} ${oz + W} minecraft:air`,
    `fill ${ox - W} ${oy - 3} ${oz - W} ${ox + W} ${oy - 1} ${oz + W} minecraft:dirt`].join('\n') + '\n');
  const server = await startServer({ workDir, port: 25622, rconPort: 26622, xmx: '1536M' });
  let rcon; const golden = { pack: 'crystal', version: '1.18.2' };
  try {
    for (let a = 0; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'gamerule doTileDrops true', 'forceload add -16 -16 31 31']) await C(c);
    if (/Unknown function/i.test(await C('function mcliteec:read'))) throw new Error('datapack not loaded');
    const air = new Array(cells.length).fill(0), pig = { p3: [], p8: [] }, destroyed = [];
    for (let t = 0; t < N; t++) {
      await C('kill @e[type=!player]');
      await C('function mcliteec:scene');
      await C(`summon minecraft:end_crystal ${ox + 0.5} ${oy} ${oz + 0.5} {ShowBottom:0b}`);
      for (const p of PIGS) await C(`summon minecraft:pig ${ox + 0.5} ${oy} ${oz + 0.5 + p.dz} {NoAI:1b,Tags:["${p.tag}"],PersistenceRequired:1b,Attributes:[{Name:"generic.max_health",Base:1000.0d}],Health:1000.0f}`);
      await C(`summon minecraft:arrow ${ox - 1.5} ${oy + 1.0} ${oz + 0.5} {Motion:[1.5d,0.0d,0.0d],NoGravity:1b}`);
      await sleep(250);
      await C('function mcliteec:read');
      const m = /\[(.*)\]/s.exec(await C('data get storage mcliteec:r v'));
      const v = m ? m[1].split(',').map((q) => parseInt(q.trim(), 10)) : [];
      if (v.length !== cells.length) { notes.push('unreadable read box'); continue; }
      v.forEach((b, i) => { air[i] += b; });
      destroyed.push(v.reduce((a, b) => a + b, 0));
      for (const p of PIGS) {
        const r = /(-?[\d.]+)f/.exec(await C(`data get entity @e[tag=${p.tag},limit=1] Health`));
        pig[p.tag].push(r ? +r[1] : 0);
      }
    }
    golden.blast = { air, destroyed, trials: destroyed.length, pig };
    console.log(`  crystal: ${destroyed.length} trials, destroyed mean ${(destroyed.reduce((a, b) => a + b, 0) / destroyed.length).toFixed(1)}, pig3 ${pig.p3.slice(0, 5)} pig8 ${pig.p8.slice(0, 5)}`);
    await C('kill @e[type=!player]');
  } finally { if (rcon) rcon.close(); await server.stop(); }
  Object.assign(golden, { generatedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), notes });
  mkdirSync(join(refereeWorkDir(), 'golden'), { recursive: true });
  writeFileSync(join(refereeWorkDir(), 'golden', 'crystal.json'), JSON.stringify(golden) + '\n');
  console.log(`referee/runcrystal: ${golden.seconds} s`);
}
main().catch((e) => { console.error(e.stack || e); process.exit(1); });
