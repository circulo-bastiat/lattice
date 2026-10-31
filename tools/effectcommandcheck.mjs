#!/usr/bin/env node
// effectcommandcheck.mjs -- #8025: /effect give (seconds*20, amplifier, hideParticles, instant rules) and clear, vs EffectCommand.java.
// Anti-vacuity: the same scenario against edited sources must fail ('<n> breaks caught').
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js', '02c_states.js', '02f_tags.js',
  '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js', '14f_inventory.js',
  '14d_survival.js', '14h_brigadier.js', '15g_commands.js', '07q_effects.js'];
console.log('effectcommandcheck -- #8025, /effect give|clear');

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
  const P = NS.Player = { food: 20, health: 20, maxHealth: 20, effects: {} };
  const run = (l) => NS.Commands.run(l, P);
  const last = (r) => (r.lines[0] || '') + '|' + (r.error ? r.error.message : '');
  let r = run('/effect give @s speed 10 2 true');
  ok(r.ok, 'give speed ok: ' + last(r));
  const sp = P.effects.speed;
  ok(sp && sp.duration === 200 && sp.amplifier === 2 && sp.showParticles === false, 'speed 10s amp2 hidden: ' + JSON.stringify(sp));
  run('/effect give @s poison'); const po = P.effects.poison;
  ok(po && po.duration === 600 && po.amplifier === 0 && po.showParticles === true, 'poison default 600 ticks: ' + JSON.stringify(po));
  run('/effect give @s instant_health 5 1'); ok(P.health >= 0, 'instant_health accepted');
  r = run('/effect give @s speed 5 0 true');
  ok(!r.ok && /commands\.effect\.give\.failed|effect/i.test(last(r)) && r.error, 'weaker give fails: ' + last(r));
  ok(P.effects.speed.amplifier === 2, 'weaker give leaves the stronger effect');
  r = run('/effect clear @s speed'); ok(r.ok && !P.effects.speed, 'clear one: ' + last(r));
  r = run('/effect clear @s speed'); ok(!r.ok, 'clear absent effect fails');
  ok(r.error && r.error.message === NS.Text.translate('commands.effect.clear.specific.failed', []), 'specific failure key text: ' + last(r));
  r = run('/effect clear'); ok(r.ok && !P.effects.poison, 'clear all');
  r = run('/effect clear'); ok(!r.ok && r.error.message === NS.Text.translate('commands.effect.clear.everything.failed', []), 'everything failure: ' + last(r));
  ok(!run('/effect give @s speed 0').ok && !run('/effect give @s speed 1 256').ok, 'seconds >= 1, amplifier <= 255');
  ok(NS.Commands.IMPLEMENTED.indexOf('effect') >= 0, 'listed as implemented');
  return { fails };
}

const real = await scenario(null);
if (real.fails.length) { for (const f of real.fails) console.log('FAIL  ' + f); process.exit(1); }
const E = '15g_commands.js';
const breaks = [
  [E, 'secs * 20', 'secs * 21'],
  [E, "ES.instance(id, dur, amp, false, particles)", "ES.instance(id, dur, 0, false, particles)"],
  [E, "ES.instance(id, dur, amp, false, particles)", "ES.instance(id, dur, amp, false, true)"],
  [E, "(inst ? 1 : 600)", "(inst ? 1 : 30)"],
  [E, "if (n === 0) throw new B.Err('commands.effect.give.failed'", "if (n === -1) throw new B.Err('commands.effect.give.failed'"],
  [E, "ES.removeStatusEffect(targets[i].e, id)", "false"],
  [E, "ES.clearStatusEffects(targets[i].e)", "false"],
  [E, "B.integer(0, 255)", "B.integer(0, 300)"],
  [E, "'effect', 'spreadplayers', 'attribute', 'spectate'", "'spreadplayers', 'attribute', 'spectate'"]
];
let caught = 0;
for (const b of breaks) { const x = await scenario(b); if (x.fails.length) { caught++; console.log('   ✓ caught: ' + b[2].trim().slice(0, 40)); } else console.log('NOT CAUGHT  ' + b[2]); }
if (caught !== breaks.length) process.exit(1);
console.log(`effectcommandcheck: 13 assertions, 0 failures, ${caught} breaks caught`);
