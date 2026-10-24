#!/usr/bin/env node
// particlecmdcheck.mjs — /particle (ParticleCommand.java, ParticleEffectArgumentType.java, #8231).
//
//   node tools/particlecmdcheck.mjs
//
// Parse cases for every parameter form (block, falling_dust, item, dust, dust_color_transition),
// the 32/512 range split, count 0 direction semantics, speed >= 0, and the failure key. Then it
// breaks its own subject twice (swapped ranges; dust size dropped) and demands each break fails.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = ROOT + 'src', ASSETS = ROOT + 'assets';
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02f_tags.js', '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js',
  '07e_loot.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '07zzo2_scoreboard.js', '15g_commands.js'];
const { initRegistry } = await import('./loadsrc.mjs');

async function load(mutate) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of FILES) {
    let s = readFileSync(join(SRC, f), 'utf8');
    if (f === '15g_commands.js' && mutate) s = mutate(s);
    new Function('MCL', s)(NS);
  }
  const raw = readFileSync(join(ASSETS, 'lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  NS.Main = { seed: 1337, seed64: 1337n };
  initRegistry(NS);
  NS.DATA = NS.DATA || {}; NS.DATA.gameRules = {};
  NS.Sky.weather = NS.Sky.newWeather();
  NS.World = { getBlock: () => 0, setBlock: () => true };
  const P = { x: 0, y: 70, z: 0, yaw: 0, pitch: 0, mode: 0, health: 20, dead: false,
    inventory: NS.Inventory.create(), syncHotbar() {}, mayFly: false, instabuild: false,
    flying: false, invulnerable: false, mayBuild: true };
  NS.Player = P;
  if (NS.Survival && NS.Survival.init) NS.Survival.init(P);
  NS.Commands.build();
  return NS;
}

// returns the list of failed assertions
let total = 0;
async function suite(mutate) {
  const NS = await load(mutate), C = NS.Commands, B = NS.Brig;
  const fails = []; const ok = (c, m) => { total++; if (!c) fails.push(m); };
  const parse = (s) => { try { return C.parseParticle(new B.Reader(s, 0)); } catch (e) { return e; } };
  const run = (l) => C.run(l, NS.Player, {});
  const spawned = []; NS.Px = { spawn: (...a) => { spawned.push(a); return {}; } };
  const run1 = (l) => { spawned.length = 0; return run(l); };

  let e = parse('dust 1 0.5 0.25 2');
  ok(e.type === 'dust' && e.color && e.color[0] === 1 && e.color[1] === 0.5 && e.color[2] === 0.25 && e.scale === 2, 'dust r g b size');
  ok(parse('dust 1 0 0 99').scale === 4 && parse('dust 1 0 0 0').scale === 0.01, 'dust size clamps to 0.01..4');
  ok(parse('dust 1 0 0').isBrig === true, 'dust without a size fails');
  e = parse('dust_color_transition 1 0 0 1.5 0 0 1');
  ok(e.scale === 1.5 && e.toColor && e.toColor[2] === 1 && e.color[0] === 1, 'dust_color_transition from size to');
  ok(parse('dust_color_transition 1 0 0 1.5 0 0').isBrig === true, 'transition missing a blue fails');
  e = parse('block minecraft:stone'); ok(e.type === 'block' && e.state > 0, 'block <state>');
  e = parse('falling_dust minecraft:sand'); ok(e.type === 'falling_dust' && e.state > 0, 'falling_dust <state>');
  e = parse('item minecraft:apple'); ok(e.type === 'item' && e.item >= 0, 'item <stack>');
  ok(parse('item').isBrig === true, 'item without a stack fails');
  e = parse('heart'); ok(e.type === 'heart', 'plain particle');
  e = parse('nonsense'); ok(e.isBrig && e.key === 'particle.notFound', 'unknown particle -> particle.notFound');

  ok(!run('particle heart 0 70 0 0 0 0 -1 1').ok, 'speed < 0 is an argument error');
  ok(!run('particle heart 0 70 0 0 0 0 1 -1').ok, 'count < 0 is an argument error');
  ok(run('particle heart').ok, 'bare form succeeds at the source');
  ok(run('particle minecraft:heart ~ ~ ~').ok, 'pos form succeeds');
  const s = run('particle heart 0 70 0 0 0 0 1 1');
  ok(s.ok, 'full form succeeds');

  // range split, player at (0,70,0)
  ok(run('particle heart 31 70 0 0 0 0 1 1').ok, 'normal: 31 blocks is in range');
  let r = run('particle heart 40 70 0 0 0 0 1 1');
  ok(!r.ok && r.error && /particle\.failed/.test(JSON.stringify(r)), 'normal: 40 blocks fails with commands.particle.failed');
  ok(!run('particle heart 40 70 0 0 0 0 1 1 normal').ok, 'explicit normal: 40 fails');
  ok(run('particle heart 40 70 0 0 0 0 1 1 force').ok, 'force: 40 blocks succeeds');
  ok(run('particle heart 500 70 0 0 0 0 1 1 force').ok, 'force: 500 blocks succeeds');
  ok(!run('particle heart 520 70 0 0 0 0 1 1 force').ok, 'force: 520 blocks fails');
  ok(run('particle heart 40 70 0 0 0 0 1 1 force @s').ok, 'force with viewers @s');
  ok(C.particleRange(false) === 32 && C.particleRange(true) === 512, 'ranges are 32 and 512');

  // count 0: ONE particle, velocity = delta * speed
  run1('particle heart 1 70 2 0.5 0.25 0.125 2 0');
  ok(spawned.length === 1 && spawned[0][1] === 1 && spawned[0][4] === 1 && spawned[0][5] === 0.5 && spawned[0][6] === 0.25, 'count 0: one particle, velocity delta*speed, no position offset');
  run1('particle heart 1 70 2 0.5 0.25 0.125 2 7');
  ok(spawned.length === 7, 'count 7: seven particles');
  const b = C.particleBurst({}, 0, 0, 0, 0, 0, 0, 0, 5, Math.random);
  ok(b.length === 5 && b.every(p => p.x === 0 && p.vx === 0), 'zero delta and speed: no scatter');
  return fails;
}

let bad = 0;
const clean = await suite(null);
if (clean.length) { bad++; console.log('FAIL clean run:\n  ' + clean.join('\n  ')); }
else console.log('particlecmdcheck: clean run passes');

const breaks = [
  ['swapped 32/512 ranges', s => { const t = s.replace('return force ? 512 : 32;', 'return force ? 32 : 512;'); if (t === s) throw new Error('break site missing'); return t; }],
  ['dropped dust size', s => { const t = s.replace("eff.scale = clampScale(r.readDouble());\n      } else if (id === 'dust_color_transition')", "eff.scale = 1;\n      } else if (id === 'dust_color_transition')"); if (t === s) throw new Error('break site missing'); return t; }],
];
let caught = 0;
for (const [name, fn] of breaks) {
  const f = await suite(fn);
  if (f.length) { caught++; console.log('   ✓ break "' + name + '" caught (' + f.length + ' failures)'); }
  else { bad++; console.log('FAIL break "' + name + '" was NOT caught'); }
}
console.log(`particlecmdcheck: ${total} assertions, ${bad} failures, ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
