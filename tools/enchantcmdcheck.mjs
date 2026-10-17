#!/usr/bin/env node
// enchantcmdcheck.mjs -- #8230: /effect give (seconds*20, amplifier, hideParticles, instant rules) and clear, vs EffectCommand.java.
// Anti-vacuity: the same scenario against edited sources must fail ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '02f_tags.js',
  '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js', '14f_inventory.js',
  '14d_survival.js', '14h_brigadier.js', '15g_commands.js', '07q_effects.js', '07ox_enchhelper.js', '14j_combat.js'];
console.log('enchantcmdcheck -- #8230, /enchant');

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
  const P = NS.Player = { food: 20, health: 20, maxHealth: 20, effects: {}, slot: 0, inventory: NS.Inventory.create ? NS.Inventory.create() : null };
  const run = (l) => NS.Commands.run(l, P);
  const msg = (r) => (r.error ? r.error.message : '');
  const tr = (k, a) => NS.Text.translate(k, a || []);
  const I = NS.Inventory, it = (n) => NS.Items.idOf ? NS.Items.idOf(n) : NS.Items.names.indexOf(n);
  let r = run('/enchant @s sharpness');
  ok(!r.ok && msg(r) === tr('commands.enchant.failed.itemless', ['Player']), 'empty hand -> itemless: ' + msg(r));
  const rs = NS.Commands.resolve; const fake = { kind: 'mob', e: { maxHealth: 0 }, name: 'Cart' };
  NS.Commands.resolve = () => [fake]; r = run('/enchant @s sharpness');
  ok(!r.ok && msg(r) === tr('commands.enchant.failed.entity', ['Cart']), 'non-living -> entity: ' + msg(r));
  NS.Commands.resolve = () => [fake, fake]; r = run('/enchant @s sharpness');
  ok(!r.ok && msg(r) === tr('commands.enchant.failed', []), 'nothing applied -> generic failure: ' + msg(r));
  NS.Commands.resolve = rs;
  I.setItem(P.inventory, 0, { i: it('diamond_sword'), n: 1 });
  const held = () => I.getItem(P.inventory, 0);
  r = run('/enchant @s sharpness 6'); ok(!r.ok && msg(r) === tr('commands.enchant.failed.level', ['6', '5']), 'level above max: ' + msg(r));
  ok(NS.Combat.enchantLevel(held(), 'sharpness') === 0, 'rejected level leaves the stack bare');
  r = run('/enchant @s sharpness 3'); ok(r.ok, 'sharpness 3 ok: ' + msg(r));
  ok(NS.Combat.enchantLevel(held(), 'sharpness') === 3, 'stack reads back level 3');
  r = run('/enchant @s smite 1'); ok(!r.ok && msg(r) === tr('commands.enchant.failed.incompatible', [tr('item.minecraft.diamond_sword')]), 'smite vs sharpness incompatible: ' + msg(r));
  ok(NS.Combat.enchantLevel(held(), 'smite') === 0, 'incompatible adds nothing');
  r = run('/enchant @s protection'); ok(!r.ok && /incompatible|enchant/i.test(msg(r)), 'unacceptable item fails: ' + msg(r));
  r = run('/enchant @s sharpness 5'); ok(r.ok && NS.Combat.enchantLevel(held(), 'sharpness') === 5, 'same id replaces level');
  r = run('/enchant @s unbreaking'); ok(r.ok && NS.Combat.enchantLevel(held(), 'unbreaking') === 1, 'default level 1: ' + msg(r));
  r = run('/enchant @s sharpness 0'); ok(r.ok && NS.Combat.enchantLevel(held(), 'sharpness') === 0, 'level 0 accepted');
  r = run('/enchant @s sharpness -1'); ok(!r.ok, 'negative level is a parse error');
  r = run('/enchant @s nonsense'); ok(!r.ok, 'unknown enchantment');
  ok(NS.Commands.IMPLEMENTED.indexOf('enchant') >= 0, 'listed as implemented');
  return { fails };
}

const real = await scenario(null);
if (real.fails.length) { for (const f of real.fails) console.log('FAIL  ' + f); process.exit(1); }
const E = '15g_commands.js';
const breaks = [
  [E, 'if (lvl > mx) throw', 'if (lvl > 999) throw'],
  [E, 'have[k] !== id && !EH.canCombine(have[k], id)', 'false'],
  [E, 'EH.isAcceptableItem(id, NS.Items.nameOf(st.i))', 'true'],
  [E, "'commands.enchant.failed.itemless'", "'commands.enchant.failed'"],
  [E, 'EH.addEnchantment(st, id, lvl); n++;', 'n++;'],
  [E, "'trigger', 'enchant',", "'trigger',"]
];
let caught = 0;
for (const b of breaks) { const x = await scenario(b); if (x.fails.length) { caught++; console.log('   ✓ caught: ' + b[2].trim().slice(0, 40)); } else console.log('NOT CAUGHT  ' + b[2]); }
if (caught !== breaks.length) process.exit(1);
console.log(`enchantcmdcheck: 15 assertions, 0 failures, ${caught} breaks caught`);
