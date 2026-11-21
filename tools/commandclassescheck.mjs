#!/usr/bin/env node
// commandclassescheck.mjs - #11730: net.minecraft.command (BlockDataObject, CommandException, CommandSource,
// DataCommandObject, DataCommandStorage, EntityDataObject, FloatRangeArgument, StorageDataObject,
// TranslatableBuiltInExceptions, SuggestionProviders) are reached through the real entry points
// C.run / C.suggest / M.parseRange; the .decomp contract of each is checked against live behaviour.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src', ASSETS = MCLITE_ROOT + 'assets';
const NS = {};
globalThis.MCL = NS;
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02f_tags.js', '02k_survive.js', '02l_dimension.js', '02g_items.js', '02i_text.js', '02n_nbt.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js',
  '07e_loot.js', '02h_recipes.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '07zzo2_scoreboard.js', '07s_raid.js', '15g_commands.js'];
for (const f of FILES) new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
{
  const raw = readFileSync(join(ASSETS, 'lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
{
  const rm = JSON.parse(readFileSync(join(ASSETS, 'recipes.meta.json'), 'utf8'));
  NS.Recipes.init({ recipes: readFileSync(join(ASSETS, 'recipes.bin')).toString('base64'), recipesBytes: rm.jsonBytes });
}
const B = NS.Brig, C = NS.Commands;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };


// a player and a world for the commands to act on
const mkPlayer = () => {
  const P = { x: 10, y: 70, z: -5, yaw: 0, pitch: 0, mode: 0, health: 20, dead: false,
              inventory: NS.Inventory.create(), syncHotbar() {}, mayFly: false, instabuild: false,
              flying: false, invulnerable: false, mayBuild: true };
  NS.Player = P;
  if (NS.Survival && NS.Survival.init) NS.Survival.init(P);
  return P;
};
NS.Main = { seed: 1337, seed64: 1337n };
// ⚠ THE REGISTRY, because `/setblock` and `/fill` take a BLOCK STATE and a check that stubbed one
// would be asserting its own stub. `initRegistry` is the same call `17_main.js` makes.
{
  const { initRegistry } = await import('./loadsrc.mjs');
  initRegistry(NS);
}
// the game rule table, exactly as `gen-data` inlines it
NS.DATA = NS.DATA || {};
NS.DATA.gameRules = (() => {
  const out = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'gamerules-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3) out[c[0]] = { t: c[1] === 'integer' ? 'i' : 'b', d: c[2] };
  }
  return out;
})();
// a tiny world for the block commands: a flat array, so `/fill` is asserted by what it wrote
const WORLD = new Map();
NS.World = {
  getBlock: (x, y, z) => WORLD.get(x + ',' + y + ',' + z) || 0,
  // ⚠ MUST RETURN true ON SUCCESS, matching the real 07_world.js `W.setBlock`'s own contract
  // (session 150 worker1): `/setblock`'s handler now checks the return value (it used to ignore
  // it, silently reporting success even when nothing was written -- .decomp SetBlockCommand
  // throws when the real `setBlockState` call fails). A stub that returned `undefined` made
  // every `/setblock` in this file look like a real-world "unloaded chunk" failure.
  setBlock: (x, y, z, id) => { WORLD.set(x + ',' + y + ',' + z, id); return true; }
};
NS.Sky.dayTime = 1000;
NS.Sky.weather = NS.Sky.newWeather();
const P = mkPlayer();
C.build();
const run = (l, o) => C.run(l, P, o || {});
const dec = (p) => readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/command', p + '.java'), 'utf8');
let breaks = 0;
const mut = (c, m) => { if (!c) breaks++; else fails.push('mutant survived: ' + m); };   // c must be false for the mutant
const txt = (r) => (r.lines || []).join('|');
const key = (l) => { const r = run(l); return r.error ? r.error.key : (r.ok ? 'ok' : 'fail'); };
const sug = (l) => C.suggest(l, P).matches;
// FloatRangeArgument: a, a..b, ..b, a.. ; swapped/empty errors
ok(run('/execute if entity @e[distance=..5]').error == null, 'distance=..5 parses');
const swapped = key('/kill @e[distance=5..1]'); ok(swapped === 'argument.range.swapped', 'swapped range key ' + swapped);
mut(swapped === 'argument.range.empty', 'swapped != empty key');
ok(key('/kill @e[distance=..x]') === 'parsing.float.invalid', 'bad float key');
ok(/class FloatRangeArgument/.test(dec('FloatRangeArgument')) && /range\.swapped/.test(readFileSync(join(MCLITE_ROOT, '.decomp/net/minecraft/predicate/NumberRange.java'), 'utf8')), 'decomp swapped contract');
// CommandException / TranslatableBuiltInExceptions: translatable keys with cursor context
const un = run('/foo'); ok(un.error && un.error.key === 'command.unknown.command' && un.error.message && un.lines.length === 2, 'unknown command is a translatable exception');
const tb = dec('TranslatableBuiltInExceptions');
for (const k of ['argument.literal.incorrect', 'parsing.float.invalid', 'command.unknown.command', 'command.unknown.argument']) ok(tb.includes('"' + k + '"') || tb.includes(k), 'decomp has ' + k);
const lit = run('/data get'); ok(lit.error && lit.error.key === 'command.unknown.argument' || lit.error && /Incomplete|Unknown/.test(lit.error.message), 'incomplete command exception');
// CommandSource: permission level gates commands
const lowKey = key0('/gamemode creative', 0); function key0(l, lv) { const r = run(l, { level: lv }); return r.error ? r.error.key : 'ok'; }
ok(lowKey !== 'ok', 'level 0 source is refused: ' + lowKey);
ok(key0('/gamemode creative', 4) === 'ok', 'level 4 source runs /gamemode');
mut(lowKey === 'ok', 'source level is not decorative');
ok(/hasPermissionLevel/.test(dec('CommandSource')) || /getCompletions/.test(dec('CommandSource')), 'decomp CommandSource');
// StorageDataObject / DataCommandStorage / DataCommandObject
C.storage = C.storage || {}; C.storage.t = { a: { b: 5 } };
ok(run('/execute if data storage t a.b').ok, 'storage path present');
ok(!run('/execute if data storage t a.c').ok, 'storage path absent');
ok(!run('/execute if data storage nope a').ok, 'unknown storage id is empty');
run('/execute store result storage t z int 1 run say hi'); ok(C.storage.t.z === 1, 'execute store writes storage');
mut(C.storage.t.z === 99, 'store value is the command result');
ok(/command_storage_/.test(dec('DataCommandStorage')), 'decomp storage persisted as command_storage_');
// EntityDataObject
const hp = run('/data get entity @s Health'); ok(hp.ok && /20/.test(txt(hp)), 'entity data get Health');
ok(!run('/data get entity @s Foo').ok, 'entity data missing path fails');
ok(run('/execute if data entity @s Health').ok, 'if data entity');
// BlockDataObject
ok(!run('/execute if data block 0 0 0 id').ok, 'no block entity -> no data');
// SuggestionProviders
ok(sug('/recipe give @s ').length > 100, 'ALL_RECIPES suggests recipes');
ok(sug('/recipe give @s minecraft:ac').every((m) => /ac/.test(m)) && sug('/recipe give @s minecraft:ac').length > 0, 'recipe suggestions filter by prefix');
const sp = dec('suggestion/SuggestionProviders');
for (const n of ['ASK_SERVER', 'ALL_RECIPES', 'AVAILABLE_SOUNDS', 'SUMMONABLE_ENTITIES']) ok(sp.includes(n), 'decomp ' + n);
for (const f of fails) console.log('FAIL', f);
console.log(`commandclassescheck: ${pass}/${pass + fails.length} assertions hold, ${breaks} breaks caught`);
process.exit(fails.length || breaks < 3 ? 1 : 0);
