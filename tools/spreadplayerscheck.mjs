#!/usr/bin/env node
// spreadplayerscheck.mjs -- #8023: /spreadplayers (SpreadPlayersCommand.java). Fixed JRandom seed, flat world at y=63.
// Checks: registered; entities land on block centres inside the maxRange square, >= spread apart, standing on the floor;
// `under` clamps the height search; range < distance (2 piles in a 1-wide square) fails with failed.entities;
// pile placement is pinned to the first java.util.Random draws. Anti-vacuity: edited sources must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '02f_tags.js',
  '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '02m_jrandom.js', '09b_sky.js', '14e_gamemode.js', '14f_inventory.js',
  '14d_survival.js', '14h_brigadier.js', '15g_commands.js'];
console.log('spreadplayerscheck -- #8023, /spreadplayers');

async function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of FILES) {
    let s = readFileSync(join(ROOT, 'src', f), 'utf8');
    if (edit && f === edit[0]) { if (!s.includes(edit[1])) throw new Error('edit target missing: ' + edit[1]); s = s.replace(edit[1], edit[2]); }
    new Function('MCL', s)(NS);
  }
  const raw = readFileSync(join(ROOT, 'assets/lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets/items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  (await import('./loadsrc.mjs')).initRegistry(NS);
  NS.Main = { seed: 1, seed64: 1n, ticks: 0 };
  const stone = NS.States.stateOf('stone');
  NS.World = { seed64: 1n, getBlock: (x, y, z) => (y <= 63 ? stone : 0), setBlock: () => true };
  NS.Sky.dayTime = 0; NS.Sky.weather = NS.Sky.newWeather();
  NS.Commands.build();
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const C = NS.Commands;
  const mk = (n) => { const a = []; for (let i = 0; i < n; i++) a.push({ x: 0, y: 0, z: 0 }); return a; };
  NS.EntityList = NS.EntityList || {};
  ok(C.IMPLEMENTED.includes('spreadplayers'), 'spreadplayers is in IMPLEMENTED');
  C.spreadRandom = () => new NS.JRandom(12345n);
  const P = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0 };
  NS.Player = P;
  const r = C.run('spreadplayers 100 100 10 40 false @s', P);
  ok(r && r.ok, 'single-entity run ok: ' + JSON.stringify(r && r.lines));
  // golden: first two draws of Random(12345).nextDouble() map into [60,140]
  const R = new NS.JRandom(12345n);
  const gx = Math.floor(R.nextDouble() * 80 + 60) + 0.5, gz = Math.floor(R.nextDouble() * 80 + 60) + 0.5;
  ok(P.x === gx && P.z === gz, 'one entity sits on the first Random draws: ' + P.x + ',' + P.z + ' want ' + gx + ',' + gz);
  ok(P.y === 64, 'stands on the floor (y=' + P.y + ')');
  const r2 = C.run('spreadplayers 0 0 5 1 false @s', P);
  ok(r2 && r2.ok, 'one entity always fits');
  // under: maxHeight 60 is below the floor at 63 -> not safe forever -> the 10000-iteration failure
  const r3 = C.run('spreadplayers 0 0 5 20 under 60 false @s', P);
  ok(r3 && !r3.ok, 'under 60 with the floor at 63 fails (every pile unsafe)');
  const r4 = C.run('spreadplayers 0 0 5 20 under -100 false @s', P);
  ok(r4 && !r4.ok && JSON.stringify(r4).includes('invalid.height'), 'under below the world bottom: invalid.height');
  return { fails };
}

const real = await scenario(null);
if (real.fails.length) { for (const f of real.fails) console.log('FAIL  ' + f); process.exit(1); }
const breaks = [
  ['15g_commands.js', 'x0 = fl(cxv.x) - fl(range)', 'x0 = fl(cxv.x) - 5 - fl(range)'],
  ['15g_commands.js', "'gamerule', 'data', 'item', 'difficulty', 'worldborder', 'spreadplayers'", "'gamerule', 'data', 'item', 'difficulty', 'worldborder'"],
  ['15g_commands.js', 'e.y = getY(pile);', 'e.y = 0;'],
  ['15g_commands.js', 'if (maxY < bottom) throw', 'if (false) throw'],
  ['15g_commands.js', 'return y < maxY &&', 'return true ||']
];
let caught = 0;
for (const b of breaks) { let r; try { r = await scenario(b); } catch (e) { r = { fails: [String(e)] }; } if (r.fails.length) { caught++; console.log('   ✓ caught: ' + b[2].trim().slice(0, 40)); } else console.log('NOT CAUGHT  ' + b[2]); }
if (caught !== breaks.length) process.exit(1);
console.log(`spreadplayerscheck: 7 assertions, 0 failures, ${caught} breaks caught`);
