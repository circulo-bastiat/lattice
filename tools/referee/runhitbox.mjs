#!/usr/bin/env node
// runhitbox.mjs — the referee's MOB HITBOX runner (#9197). node tools/referee/runhitbox.mjs
// Golden (GENERATED, never committed -- D-6): <referee dir>/golden/mob-hitbox.json  { cases: { mob: { spawn: [bool x12], moved: [bool x12] } } }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer, refereeWorkDir } from './server.mjs';
import { connectRcon } from './rcon.mjs';
import { first, PARTS, ALIAS, origin, MOVE, probes, fmt } from './hitboxscen.mjs';
const ONLY = process.argv[2] ? +process.argv[2] - 1 : -1;   // #9204: node runhitbox.mjs [part]; default every part, one server, one golden file per part
const HERE = dirname(fileURLToPath(import.meta.url));
export const jarOf = (tsv, m) => { for (const l of tsv.split('\n')) { const c = l.split('\t'); if (c[0] === (ALIAS[m] || m)) return [+c[1], +c[2]]; } return null; };
const EXTRA = { pufferfish: ',PuffState:2' };   // #9204: the jar row is the fully puffed box
async function main() {
  const roster = Object.keys(JSON.parse(readFileSync(join(HERE, '..', 'mobl3-mobs.json'), 'utf8')).mobs);
  const jar = readFileSync(join(HERE, '..', 'golden/entity-types-1.18.2.tsv'), 'utf8');
  const parts = [...Array(PARTS).keys()].filter((p) => ONLY < 0 || p === ONLY), outs = [];
  const server = await startServer({});
  let rcon;
  try {
    for (let a = 1; ; a++) { try { rcon = await connectRcon({ port: server.rconPort, password: server.rconPassword }); break; } catch (e) { if (a >= 15) throw e; await new Promise((r) => setTimeout(r, 500)); } }
    const maxX = origin(30).x + 16;
    await rcon.command(`forceload add 0 96 ${maxX} 112`);
    await new Promise((r) => setTimeout(r, 1500));
    await rcon.command(`kill @e[type=!player,x=0,y=-64,z=96,dx=${maxX},dy=60,dz=16]`);
    const run = async (i, m, c) => {
      const j = jarOf(jar, m); const res = [];
      for (const p of probes(c.x, c.y, c.z, j[0], j[1])) {
        const r = await rcon.command(`execute if entity @e[tag=mrh${i},limit=1,x=${fmt(p.at[0])},y=${fmt(p.at[1])},z=${fmt(p.at[2])},dx=0,dy=0,dz=0]`);
        res.push(/Test passed/i.test(r));
      }
      return res;
    };
    for (const PART of parts) {
    const mobs = first(roster, PART), cases = {}, notes = [];
    console.log(`referee/runhitbox: part ${PART + 1}: ${mobs.length} mobs`);
    for (let i = 0; i < mobs.length; i++) {
      const m = mobs[i], o = origin(i), c = { x: o.x + 0.5, y: o.y, z: o.z + 0.5 };
      const r = await rcon.command(`summon minecraft:${ALIAS[m] || m} ${fmt(c.x)} ${fmt(c.y)} ${fmt(c.z)} {NoAI:1b,NoGravity:1b,Silent:1b,PersistenceRequired:1b,Tags:["mrh${i}"]${EXTRA[m] || ''}}`);
      if (/Unknown|Invalid|Incorrect|Could not|expected|error/i.test(r)) { notes.push(`${m}: ${r.trim().slice(0, 100)}`); continue; }
      await new Promise((r2) => setTimeout(r2, 60));
      const spawn = await run(i, m, c);
      const mv = { x: c.x + MOVE.x, y: c.y + MOVE.y, z: c.z + MOVE.z };
      await rcon.command(`tp @e[tag=mrh${i},limit=1] ${fmt(mv.x)} ${fmt(mv.y)} ${fmt(mv.z)}`);
      await new Promise((r2) => setTimeout(r2, 150));
      cases[m] = { spawn, moved: await run(i, m, mv) };
      await rcon.command(`kill @e[tag=mrh${i}]`);
    }
    outs.push({ PART, cases, notes });
    }
  } finally { if (rcon) rcon.close(); await server.stop(); }
  const dir = join(refereeWorkDir(), 'golden'); mkdirSync(dir, { recursive: true });
  for (const { PART, cases, notes } of outs) {
    const out = join(dir, PART ? `mob-hitbox-p${PART + 1}.json` : 'mob-hitbox.json');
    writeFileSync(out, JSON.stringify({ pack: 'mob-hitbox', version: '1.18.2', generatedAt: new Date().toISOString(), cases, notes }) + '\n');
    console.log(`referee/runhitbox: ${Object.keys(cases).length} mobs -> ${out}`);
    for (const n of notes) console.log('  - ' + n);
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((e) => { console.error(e.stack || e); process.exit(1); });
