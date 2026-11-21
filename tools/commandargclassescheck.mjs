#!/usr/bin/env node
// commandargclassescheck.mjs — #11731: net/minecraft/command/argument/* Yarn classes -> the NS.Brig argument types the
// built command tree really uses. Each class names a real command line that must PARSE (dispatcher.execute / parse path)
// and a bad line that must FAIL with the vanilla error key. Anti-vacuity (D-30): a good line broken, a bad line fixed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02f_tags.js', '02k_survive.js', '02l_dimension.js', '02g_items.js', '02i_text.js', '02n_nbt.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js',
  '07e_loot.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '07zzo2_scoreboard.js', '07s_raid.js', '07ox_enchhelper.js', '07q_effects.js', '15g_commands.js'];
for (const f of FILES) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
{
  const raw = readFileSync(join(ROOT, 'assets', 'lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  const rm = JSON.parse(readFileSync(join(ROOT, 'assets', 'recipes.meta.json'), 'utf8'));
  NS.Recipes.init({ recipes: readFileSync(join(ROOT, 'assets', 'recipes.bin')).toString('base64'), recipesBytes: rm.jsonBytes });
}
NS.Main = { seed: 1337, seed64: 1337n };
{ const { initRegistry } = await import('./loadsrc.mjs'); initRegistry(NS); }
NS.DATA = NS.DATA || {}; NS.DATA.gameRules = {};
const WORLD = new Map();
NS.World = { getBlock: (x, y, z) => WORLD.get(x + ',' + y + ',' + z) || 0, setBlock: (x, y, z, id) => { WORLD.set(x + ',' + y + ',' + z, id); return true; } };
NS.Sky.dayTime = 1000; NS.Sky.weather = NS.Sky.newWeather();
const P = { x: 10, y: 70, z: -5, yaw: 0, pitch: 0, mode: 0, health: 20, dead: false, inventory: NS.Inventory.create(), syncHotbar() {},
  mayFly: false, instabuild: false, flying: false, invulnerable: false, mayBuild: true };
NS.Player = P; if (NS.Survival && NS.Survival.init) NS.Survival.init(P);
NS.Commands.build();
const run = (l) => NS.Commands.run(l, P, {});
// class -> [good line, bad line]; a class the single-player engine rules out maps to a reason string instead
const CLASSES = JSON.parse(readFileSync(join(ROOT, 'tools', 'golden', 'commandargclasses.json'), 'utf8'));
const T0 = CLASSES; const SETUP = T0._setup; delete T0._setup;
const exec = (l) => { try { const r = run(l); return r.ok ? 'OK' : String((r.error && r.error.message) || 'ERR'); } catch (e) { return 'THROW ' + e.message; } };
if (process.env.PROBE) { for (const l of SETUP) exec(l); const out = {}; for (const [c, v] of Object.entries(T0)) out[c] = typeof v === 'string' ? v : [v[0], exec(v[0]), v[1], exec(v[1])]; out._setup = SETUP; console.log(JSON.stringify(out, null, 0).replace(/\],/g, '],\n')); process.exit(0); }
// each entry: [line, expected outcome ('OK' or the vanilla message), line, expected outcome]; the good line must get past its
// argument (OK, or an execution-time message that can only come after the argument parsed), the bad one must stop AT it.
const verify = (T) => {
  const bad = [];
  for (const l of SETUP) exec(l);
  for (const [c, v] of Object.entries(T)) {
    if (typeof v === 'string') continue;
    for (let i = 0; i < 4; i += 2) { const got = exec(v[i]); if (got !== v[i + 1]) bad.push(c + ': `' + v[i] + '` -> "' + got + '" != "' + v[i + 1] + '"'); }
  }
  return bad;
};
let pass = 0, breaks = 0; const fails = [];
const bad = verify(CLASSES); bad.forEach((b) => fails.push(b));
pass += Object.keys(CLASSES).length - bad.length;
const brk = (name, mut) => { const t = JSON.parse(JSON.stringify(CLASSES)); mut(t); breaks++; if (verify(t).length) { pass++; console.log('  ✓ break caught: ' + name); } else fails.push('anti-vacuity: ' + name + ' not caught'); };
brk('bad line that parses', (t) => { t.BlockPosArgumentType[3] = 'OK'; });
brk('good line garbled', (t) => { t.ColorArgumentType[0] = "team modify t color nosuchcolor"; });
for (const f of fails) console.log('  FAIL ' + f);
console.log('\n commandargclassescheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
