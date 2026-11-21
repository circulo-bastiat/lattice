#!/usr/bin/env node
// forceloadcommandcheck.mjs -- #11699: /forceload add|remove|query vs ForceLoadCommand.java, through Commands.run and the real
// World.forced store (the forced-chunk block of 07_world.js is extracted from source). Anti-vacuity: edited sources must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '02f_tags.js',
  '02k_survive.js', '02g_items.js', '02i_text.js', '02n_nbt.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js', '14f_inventory.js',
  '14d_survival.js', '14h_brigadier.js', '15g_commands.js', '07q_effects.js'];
console.log('forceloadcommandcheck -- #11699, /forceload');

async function scenario(edit) {
  const NS = {}; globalThis.MCL = NS;
  const edits = (f, s) => {
    if (edit && f === edit[0]) { if (!s.includes(edit[1])) throw new Error('edit target missing: ' + edit[1]); s = s.replace(edit[1], edit[2]); }
    return s;
  };
  for (const f of FILES) new Function('MCL', edits(f, readFileSync(join(ROOT, 'src', f), 'utf8')))(NS);
  const raw = readFileSync(join(ROOT, 'assets/lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets/items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  (await import('./loadsrc.mjs')).initRegistry(NS);
  NS.Main = { seed: 1, seed64: 1n, ticks: 0 };
  const w = edits('07_world.js', readFileSync(join(ROOT, 'src/07_world.js'), 'utf8'));
  const a = w.indexOf('W.forced = new Set();'), b = w.indexOf('W.randomTick = function');
  if (a < 0 || b < a) throw new Error('forced block not found');
  const W = NS.World = { getBlock: () => 0, setBlock: () => true };
  new Function('W', w.slice(a, b))(W);
  NS.Sky.dayTime = 0; NS.Sky.weather = NS.Sky.newWeather();
  NS.Commands.build();
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const P = NS.Player = { x: 0, y: 64, z: 0, food: 20, health: 20, maxHealth: 20, effects: {} };
  const run = (l) => NS.Commands.run(l, P);
  const last = (r) => (r.lines[0] || '') + '|' + (r.error ? r.error.message : '');
  const T = (k, a) => NS.Text.translate(k, a);
  const id = 'minecraft:overworld';
  let r = run('/forceload add 0 0');
  ok(r.ok && W.forced.has('0,0') && W.forced.size === 1, 'add single: ' + last(r));
  ok(r.lines[0] === T('commands.forceload.added.single', ['[0, 0]', id]), 'add single text: ' + last(r));
  r = run('/forceload add 0 0'); ok(!r.ok && r.error.message === T('commands.forceload.added.failure', []), 'add again fails: ' + last(r));
  r = run('/forceload add -1 -1 16 16');
  ok(r.ok && W.forced.size === 9 && W.forced.has('-1,-1') && W.forced.has('1,1'), 'add range blocks->chunks (>>4): ' + [...W.forced]);
  ok(r.lines[0] === T('commands.forceload.added.multiple', ['8', id, '[-1, -1]', '[1, 1]']), 'add multiple text (8 new): ' + last(r));
  r = run('/forceload query'); ok(r.ok && r.lines[0].includes('[-1, -1]') && r.lines[0].includes('[1, 1]'), 'query list: ' + last(r));
  r = run('/forceload query 0 0'); ok(r.ok && r.lines[0] === T('commands.forceload.query.success', ['[0, 0]', id]), 'query hit: ' + last(r));
  r = run('/forceload query 160 160'); ok(!r.ok && r.error.message === T('commands.forceload.query.failure', ['[10, 10]', id]), 'query miss: ' + last(r));
  r = run('/forceload add 0 0 4000 4000'); ok(!r.ok && r.error.message === T('commands.forceload.toobig', ['256', '63001']) || (!r.ok && /256/.test(r.error.message)), 'toobig: ' + last(r));
  r = run('/forceload add 0 0 4096 0'); ok(!r.ok && r.error.message === T('commands.forceload.toobig', ['256', '257']), '257 chunks too big: ' + last(r));
  r = run('/forceload add 0 0 4095 0'); ok(r.ok && W.forced.has('255,0'), '256 chunks allowed: ' + last(r));
  r = run('/forceload add 30000000 0'); ok(!r.ok && r.error.message === T('argument.pos.outofworld', []), 'out of world: ' + last(r));
  r = run('/forceload add 40 40'); ok(r.ok && W.forced.has('2,2'), 'block 40 -> chunk 2: ' + last(r));
  r = run('/forceload remove 0 0'); ok(r.ok && !W.forced.has('0,0') && r.lines[0] === T('commands.forceload.removed.single', ['[0, 0]', id]), 'remove: ' + last(r));
  r = run('/forceload remove 0 0'); ok(!r.ok && r.error.message === T('commands.forceload.removed.failure', []), 'remove absent fails: ' + last(r));
  r = run('/forceload remove all'); ok(r.ok && W.forced.size === 0 && r.lines[0] === T('commands.forceload.removed.all', [id]), 'remove all: ' + last(r));
  r = run('/forceload query'); ok(r.lines[0] === T('commands.forceload.added.none', [id]), 'query empty: ' + last(r));
  ok(NS.Commands.IMPLEMENTED.indexOf('forceload') >= 0, 'listed as implemented');
  return { fails };
}

const real = await scenario(null);
if (real.fails.length) { for (const f of real.fails) console.log('FAIL  ' + f); process.exit(1); }
const E = '15g_commands.js';
const breaks = [
  [E, 'cx1 = x1 >> 4', 'cx1 = x1 >> 5'],
  [E, 'if (n > 256)', 'if (n > 257)'],
  [E, "if (!changed) throw new B.Err(on ? 'commands.forceload.added.failure'", "if (changed < 0) throw new B.Err(on ? 'commands.forceload.added.failure'"],
  [E, "NS.World.setChunkForced(p[0], p[1], false); });", "void 0; });"],
  [E, "if (!NS.World.forced.has(NS.World.forceKey(cx, cz))) throw", "if (NS.World.forced.has(NS.World.forceKey(cx, cz))) throw"],
  [E, "x1 >= 30000000", "x1 >= 90000000"],
  [E, "'bossbar', 'forceload', 'placefeature'", "'bossbar', 'placefeature'"],
  ['07_world.js', 'if (W.forced.has(k) === !!on) return false;', 'if (false) return false;'],
  ['07_world.js', 'if (on) W.forced.add(k); else W.forced.delete(k);', 'if (on) W.forced.add(k);']
];
let caught = 0;
for (const b of breaks) { const x = await scenario(b); if (x.fails.length) { caught++; console.log('   ✓ caught: ' + b[2].trim().slice(0, 40)); } else console.log('NOT CAUGHT  ' + b[2]); }
if (caught !== breaks.length) process.exit(1);
console.log(`forceloadcommandcheck: 16 assertions, 0 failures, ${caught} breaks caught`);
