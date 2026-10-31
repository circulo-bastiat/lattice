// lockstep/knotrun.mjs -- #7059 (G17-L4): leash_knot lane on the real 1.18.2 server. A fence at (3,-60,3), a leash_knot summoned on it at tick `attach`,
// a persistent cow leashed to it (Leash:{X,Y,Z}), the fence removed at tick `brk`. A datapack tick function logs per tick: knot count, cow Leash
// present, item count; and once per new knot / item its tick and Pos. Returns the trace.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startServer, lockReferee } from '../server.mjs';
import { connectRcon } from '../rcon.mjs';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const KT = 264, FX = 3, FY = -60, FZ = 3;
export async function runKnot({ attach, brk, port = 25681, rconPort = 26681 }) {
  const workDir = join(tmpdir(), 'knotlane-' + process.pid + '-' + Date.now());
  await lockReferee({ workDir });
  const dp = join(workDir, 'world', 'datapacks', 'knot'), f = join(dp, 'data', 'knot', 'functions');
  rmSync(dp, { recursive: true, force: true }); mkdirSync(f, { recursive: true });
  mkdirSync(join(dp, 'data', 'minecraft', 'tags', 'functions'), { recursive: true });
  writeFileSync(join(dp, 'pack.mcmeta'), JSON.stringify({ pack: { pack_format: 9, description: 'knot' } }));
  writeFileSync(join(dp, 'data', 'minecraft', 'tags', 'functions', 'tick.json'), JSON.stringify({ values: ['knot:tick'] }));
  const W = (n, l) => writeFileSync(join(f, n + '.mcfunction'), l.join('\n') + '\n');
  const at = `${FX} ${FY + 1} ${FZ}`;
  W('seen_k', ['execute store result storage knot:s tk int 1 run scoreboard players get #t k', 'data modify storage knot:s ktick append from storage knot:s tk', 'data modify storage knot:s kpos append from entity @s Pos', 'tag @s add seen']);
  W('seen_i', ['execute store result storage knot:s tk int 1 run scoreboard players get #t k', 'data modify storage knot:s itick append from storage knot:s tk', 'data modify storage knot:s ipos append from entity @s Pos', 'data modify storage knot:s icount append from entity @s Item.Count', 'tag @s add seen']);
  W('log', [
    `execute if score #t k matches ${attach} run summon cow 0.5 ${FY + 1} 0.5 {NoAI:1b,PersistenceRequired:1b,Tags:["kc"],Leash:{X:${FX},Y:${FY + 1},Z:${FZ}}}`,
    `execute if score #t k matches ${brk} run setblock ${FX} ${FY + 1} ${FZ} air`,
    'execute store result score #n k if entity @e[type=leash_knot]',
    'execute if score #n k matches 0 run data modify storage knot:s kn append value 0b', 'execute unless score #n k matches 0 run data modify storage knot:s kn append value 1b',
    'execute if entity @e[tag=kc,nbt={Leash:{}}] run data modify storage knot:s cl append value 1b', 'execute unless entity @e[tag=kc,nbt={Leash:{}}] run data modify storage knot:s cl append value 0b',
    'execute as @e[type=leash_knot,tag=!seen] run function knot:seen_k', 'execute as @e[type=item,tag=!seen,nbt={Item:{id:"minecraft:lead"}}] run function knot:seen_i']);
  W('tick', ['execute if score #run k matches 1 if score #t k matches ..' + (KT - 1) + ' run function knot:log', 'execute if score #run k matches 1 run scoreboard players add #t k 1']);
  const server = await startServer({ workDir, port, rconPort, xmx: '1024M' });
  let rcon;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await sleep(500); } }
    const C = (c) => rcon.command(c);
    for (const c of ['difficulty normal', 'gamerule doMobSpawning false', 'gamerule doDaylightCycle false', 'forceload add 0 0 16 16', 'scoreboard objectives add k dummy', 'scoreboard players set #run k 0', 'scoreboard players set #t k 1',
      `fill -2 ${FY} -2 8 ${FY + 6} 8 air`, `fill -2 ${FY - 1} -2 8 ${FY - 1} 8 stone`, `setblock ${FX} ${FY + 1} ${FZ} oak_fence`, 'data modify storage knot:s kn set value []', 'data modify storage knot:s cl set value []',
      'data modify storage knot:s ktick set value []', 'data modify storage knot:s kpos set value []', 'data modify storage knot:s itick set value []', 'data modify storage knot:s ipos set value []', 'data modify storage knot:s icount set value []', 'kill @e[type=!player]']) await C(c);
    await sleep(1500);
    await C('scoreboard players set #run k 1');
    await sleep(KT * 50 + 1500);
    for (let i = 0; i < 40; i++) { if (+(/has (-?\d+)/.exec(await C('scoreboard players get #t k')) || [0, 0])[1] > KT) break; await sleep(500); }
    return await C('data get storage knot:s');
  } finally { if (rcon) rcon.close(); await server.stop(); rmSync(workDir, { recursive: true, force: true }); }
}
if (process.argv[1] && process.argv[1].endsWith('knotrun.mjs')) console.log(await runKnot({ attach: +process.argv[2] || 3, brk: +process.argv[3] || 50 }));
// storage text -> per-tick events (row i = tick i+1): { kn:[0/1], cl:[0/1], ktick, kpos, itick, ipos, icount }
export function parseKnot(txt) {
  const arr = (k) => { const m = new RegExp(k + ': \\[([^\\]]*)\\]').exec(txt); return m ? m[1].split(', ').filter(Boolean).map((q) => parseInt(q, 10)) : []; };
  const pos = (k) => { const m = new RegExp(k + ': \\[(.*?\\]\\]|\\[)', 's').exec(txt); return m ? (m[1].match(/-?\d+(?:\.\d+)?(?=d)/g) || []).map(Number) : []; };
  const p3 = (a) => Array.from({ length: a.length / 3 }, (_, i) => a.slice(3 * i, 3 * i + 3));
  return { kn: arr('kn'), cl: arr('cl'), ktick: arr('ktick'), itick: arr('itick'), icount: arr('icount'), kpos: p3(pos('kpos')), ipos: p3(pos('ipos')) };
}
