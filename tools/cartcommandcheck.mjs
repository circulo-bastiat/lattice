#!/usr/bin/env node
// cartcommandcheck.mjs -- #4433: a command_block_minecart on a powered activator rail EXECUTES its Command
// (CommandBlockExecutor.execute: level-2 source at the cart, successCount, LastOutput), at most once per 4 ticks.
// Anti-vacuity: the same scenario against edited sources must fail ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '02f_tags.js',
  '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js', '14f_inventory.js',
  '14d_survival.js', '14h_brigadier.js', '15g_commands.js', '07zzr_minecart.js'];
console.log('cartcommandcheck -- #4433, command block minecart executes its command');

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
  const W = new Map(); const key = (x, y, z) => x + ',' + y + ',' + z;
  NS.World = { getBlock: (x, y, z) => W.get(key(x, y, z)) || 0, setBlock: (x, y, z, id) => { W.set(key(x, y, z), id); return true; } };
  NS.Sky.dayTime = 0; NS.Sky.weather = NS.Sky.newWeather();
  NS.Commands.build();
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const Mc = NS.Minecart, stone = NS.States.stateOf('stone');
  const cart = { type: 'command_block_minecart', x: 5.5, y: 64, z: 7.5, yaw: 0, age: 10, lastExecuted: 0, command: 'setblock ~ ~2 ~ stone', successCount: 0, trackOutput: true, lastOutput: null };
  Mc.onActivatorRail(cart, false);
  ok(W.size === 0, 'an unpowered rail runs nothing');
  Mc.onActivatorRail(cart, true);
  ok(W.get(key(5, 66, 7)) === stone, 'powered rail: setblock ~ ~2 ~ stone landed at the cart (got ' + W.get(key(5, 66, 7)) + ')');
  ok(cart.successCount > 0, 'successCount > 0 after a successful command');
  ok(typeof cart.lastOutput === 'string' && cart.lastOutput.length > 0, 'LastOutput stored while TrackOutput');
  W.clear(); cart.age = 12; NS.Main.ticks = 12; Mc.onActivatorRail(cart, true);
  ok(W.size === 0, 'rate limit: age-lastExecuted < 4 does not run again');
  cart.age = 14; NS.Main.ticks = 14; Mc.onActivatorRail(cart, true);
  ok(W.get(key(5, 66, 7)) === stone, 'runs again 4 ticks later');
  cart.command = 'setblock ~ ~2 ~ not_a_block'; cart.age = 20; NS.Main.ticks = 20; Mc.onActivatorRail(cart, true);
  ok(cart.successCount === 0, 'a failing command leaves successCount 0');
  ok(/^\{"text":"\[\d\d:\d\d:\d\d\] /.test(cart.lastOutput || ''), 'LastOutput carries the [HH:mm:ss] prefix: ' + cart.lastOutput);
  cart.cmdName = 'Bob'; const nb = Mc.writeNbt(cart); const c2 = { type: cart.type }; Mc.readNbt(c2, nb);
  ok(c2.cmdName === 'Bob', 'executor CustomName round-trips through NBT (got ' + c2.cmdName + ')');
  cart.command = 'sEaRgE'; cart.age = 30; NS.Main.ticks = 30; Mc.onActivatorRail(cart, true);
  ok(cart.successCount === 1 && cart.lastOutput === '{"text":"#itzlipofutzli"}', 'Searge easter egg sets lastOutput + successCount 1');
  NS.Main.ticks = 77; cart.command = 'setblock ~ ~2 ~ stone'; cart.lastExecution = -1; W.clear();
  Mc.commandExecute(cart); ok(cart.lastExecution === 77 && W.size === 1, 'execute records lastExecution = world time');
  W.clear(); ok(Mc.commandExecute(cart) === false && W.size === 0, 'second execute in the same world tick is refused');
  const o = Mc.writeNbt(cart); ok(o.UpdateLastExecution === true && o.LastExecution === 77, 'NBT writes UpdateLastExecution/LastExecution');
  const c3 = { type: 'command_block_minecart' }; Mc.readNbt(c3, o); ok(c3.lastExecution === 77, 'NBT round-trips LastExecution');

  W.clear(); NS.Commands.ruleSet('sendCommandFeedback', 'false');
  cart.command = 'setblock ~ ~2 ~ stone'; cart.age = 100; NS.Main.ticks = 100; Mc.onActivatorRail(cart, true);
  ok(cart.successCount > 0 && cart.lastOutput === null, 'sendCommandFeedback false: LastOutput stays null');
  NS.Commands.ruleSet('sendCommandFeedback', 'true');
  const said = []; NS.Chat = { add: (c) => said.push(NS.Text.plain(c)) };
  cart.command = 'say hi'; cart.age = 200; NS.Main.ticks = 200; Mc.onActivatorRail(cart, true);
  ok(said[0] === '[Minecart with Command Block] hi', '/say shows the cart display name (got ' + said[0] + ')');
  cart.customName = 'Rex'; cart.command = 'say yo'; cart.age = 210; NS.Main.ticks = 210; Mc.onActivatorRail(cart, true);
  ok(said[1] === '[Rex] yo', '/say shows the cart CustomName (got ' + said[1] + ')');
  return { fails };
}

const real = await scenario(null);
if (real.fails.length) { for (const f of real.fails) console.log('FAIL  ' + f); process.exit(1); }
const breaks = [
  ['07zzr_minecart.js', '        Mc.commandExecute(e);\n', ''],
  ['07zzr_minecart.js', 'if (r.ok && (r.result === undefined || r.result > 0)) e.successCount = 1;', ''],
  ['07zzr_minecart.js', "C.ruleGet('sendCommandFeedback') !== 'false' && r.lines", 'r.lines'],
  ['07zzr_minecart.js', "displayName: e.customName ||", "zz: e.customName ||"],
  ['15g_commands.js', "'chat.type.announcement', [c.source.displayName", "'chat.type.announcement', [c.source.name"],
  ['07zzr_minecart.js', 'level: 2, name', 'level: 0, name'],
  ['07zzr_minecart.js', 'x: e.x, y: e.y, z: e.z,', 'x: 0, y: 0, z: 0,'],
  ['07zzr_minecart.js', 'e.age - e.lastExecuted >= 4', 'true'],
  ['07zzr_minecart.js', 'if (now === e.lastExecution) return false;', ''],
  ['07zzr_minecart.js', "=== 'searge'", "=== 'zzz'"],
  ['07zzr_minecart.js', 'o.UpdateLastExecution = e.updateLastExecution !== false;', 'o.UpdateLastExecution = false;']
];
let caught = 0;
for (const b of breaks) { const r = await scenario(b); if (r.fails.length) { caught++; console.log("   ✓ caught: " + b[2].trim().slice(0, 40)); } else console.log('NOT CAUGHT  ' + b[2]); }
if (caught !== breaks.length) process.exit(1);
console.log(`cartcommandcheck: 13 assertions, 0 failures, ${caught} breaks caught`);
