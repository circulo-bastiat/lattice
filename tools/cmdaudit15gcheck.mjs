#!/usr/bin/env node
// cmdaudit15gcheck.mjs — #11480: the 15g_commands.js classes no stage cited, driven through the real
// dispatcher (C.run) with the exact lang string asserted. Each row names the vanilla classes it covers.
// Argument types: AngleArgumentType RotationArgumentType ColumnPosArgumentType EntityArgumentType
// EntitySelectorReader ItemStackArgumentType NbtPathArgumentType ScoreHolderArgumentType
// OperationArgumentType TimeArgumentType EntitySummonArgumentType DimensionArgumentType
// BlockArgumentParser BlockPredicateArgumentType ItemSlotArgumentType; support: ServerCommandSource
// Scoreboard BossBarManager CommandBossBar NbtHelper NbtList Inventories StackReference Criterion
// CommandFunction CommandFunctionManager Clearable GameMode BlockEntity BiomeSource ParticleEffect
// AbstractDustParticleEffect. Commands: see the ROWS table.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; void 0; } else fails.push('anti-vacuity: ' + m); };

const EXTRA = ['02g_items.js', '02h_recipes.js', '07e_loot.js', '02j_sounds.js', '16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js',
  '02i_text.js', '02n_nbt.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '07zzo2_scoreboard.js', '07s_raid.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
{
  const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
{
  const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
M.Entities.init();
const W = M.World, EL = M.EntityList, Sp = M.Spawn, Diff = M.Diff, C = M.Commands;
W.init(1337); M.Gen.init(1337, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); EL.init(); M.Ai.init();
Sp.init(); Sp.ready = false;
M.Player = { x: 300, y: 64, z: 0, yaw: 0, pitch: 0, mode: 0, health: 20, inventory: M.Inventory.create(), syncHotbar() {} };
C.build();
const run = (l, o) => C.run(l, M.Player, o || {});


const ROWS = [
  ['GameModeCommand GameMode', '/gamemode creative', true, /^Set own game mode to Creative Mode$/],
  ['GameModeCommand', '/gamemode survival', true, /^Set own game mode to Survival Mode$/],
  ['DifficultyCommand', '/difficulty hard', true, /^The difficulty has been set to Hard$/],
  ['TimeCommand TimeArgumentType', '/time set 1000', true, /^Set the time to 1000$/],
  ['TimeCommand TimeArgumentType', '/time add 5t', true, /^Set the time to 1005$/],
  ['TimeCommand', '/time query daytime', true, /^The time is 1005$/],
  ['WeatherCommand', '/weather clear', true, /^Set the weather to clear$/],
  ['WeatherCommand', '/weather rain 100', true, /^Set the weather to rain$/],
  ['HelpCommand', '/help gamemode', true, /^\/gamemode <mode>/],
  ['TeleportCommand ColumnPosArgumentType', '/tp 0 70 0', true, /^Teleported Player to 0\.00, 70\.00, 0\.00$/],
  ['TeleportCommand AngleArgumentType RotationArgumentType', '/tp @s 1 70 1 90 0', true, /^Teleported Player to 1\.00, 70\.00, 1\.00$/],
  ['TeleportCommand ExecuteCommand EntityArgumentType EntitySelectorReader', '/execute as @s at @s run tp @s ~ ~1 ~', true, /^Teleported Player to 1\.00, 71\.00, 1\.00$/],
  ['SpawnPointCommand', '/spawnpoint @s 1 2 3', true, /^Set spawn point to 1, 2, 3 \[0\.0\] in minecraft:overworld for Player$/],
  ['SetWorldSpawnCommand', '/setworldspawn 1 2 3', true, /^Set the world spawn point to 1, 2, 3 \[0\.0\]$/],
  ['WorldBorderCommand', '/worldborder set 100', true, /^Set the world border to 100 blocks wide$/],
  ['WorldBorderCommand', '/worldborder center 0 0', true, /^Set the center of the world border to 0, 0$/],
  ['GiveCommand ItemStackArgumentType', '/give @s stone 3', true, /^Gave 3 Stone to Player$/],
  ['ClearCommand Inventories StackReference ItemSlotArgumentType', '/clear @s stone', true, /^Removed 3 items from player Player$/],
  ['ClearCommand', '/clear @s', false, /^No items were found on player Player$/],
  ['MessageCommand', '/msg @s hi', true, /^You whisper to Player: hi$/],
  ['TeamMsgCommand', '/teammsg hi', false, /^You must be on a team to message your team$/],
  ['TagCommand NbtHelper', '/tag @s add foo', true, /^Added tag 'foo' to Player$/],
  ['TagCommand', '/tag @s list', true, /^Player has 1 tags?: foo$/],
  ['ScoreboardCommand Scoreboard Criterion', '/scoreboard objectives add a dummy', true, /^Created new objective \[a\]$/],
  ['ScoreboardCommand ScoreHolderArgumentType', '/scoreboard players set @s a 5', true, /^Set \[a\] for Player to 5$/],
  ['ScoreboardCommand OperationArgumentType', '/scoreboard players operation @s a += @s a', true, /^Set \[a\] for Player to 10$/],
  ['ScoreboardCommand', '/scoreboard players get @s a', true, /^Player has 10 \[a\]$/],
  ['TriggerCommand', '/trigger a', false, /^You can only trigger objectives that are 'trigger' type$/],
  ['TeamCommand', '/team add t', true, /^Created team \[t\]$/],
  ['TeamCommand', '/team join t @s', true, /^Added Player to team \[t\]$/],
  ['BossBarCommand BossBarManager CommandBossBar', '/bossbar add x:y "hi"', true, /^Created custom bossbar \[hi\]$/],
  ['BossBarCommand', '/bossbar set x:y value 3', true, /^Custom bossbar \[hi\] has changed value to 3$/],
  ['BossBarCommand', '/bossbar remove x:y', true, /^Removed custom bossbar \[hi\]$/],
  ['ExecuteCommand', '/execute if entity @s', true, /^Test passed$/],
  ['ExecuteCommand DimensionArgumentType', '/execute in minecraft:overworld run say hi', true, null],
  ['ExecuteCommand', '/execute store result score @s a run time query daytime', true, null],
  ['ExecuteCommand NbtPathArgumentType', '/data get entity @s Pos[0]', true, /^Player has the following entity data: 1$/],
  ['FunctionCommand CommandFunction CommandFunctionManager', '/function a:b', false, /^Unknown function a:b$/],
  ['ScheduleCommand', '/schedule function a:b 1t', false, /^Unknown function a:b$/],
  ['AttributeCommand', '/attribute @s generic.max_health get', true, /^Value of attribute Max Health for entity Player is 20\.0$/],
  ['StopSoundCommand', '/stopsound @s master', true, /^Stopped all 'master' sounds$/],
  ['PlaySoundCommand', '/playsound minecraft:block.stone.break master @s', false, /^Unknown ID:/],
  ['CloneCommand Clearable', '/clone 0 0 0 1 1 1 5 5 5 replace move', true, /^Successfully cloned 8 blocks$/],
  ['SpreadPlayersCommand', '/spreadplayers 0 0 1 10 false @s', false, /^Could not spread 1 entities/],
  ['ReloadCommand', '/reload', true, /^Reloading!$/],
  ['PlaceFeatureCommand', '/placefeature minecraft:oak', false, /^Failed to place feature$/],
  ['SpectateCommand', '/spectate', false, /^Player is not in spectator mode$/],
  ['RecipeCommand', '/recipe give @s *', false, /^No new recipes were learned$/],
  ['EntitySummonArgumentType', '/summon minecraft:zombie 1 70 1', true, /^Summoned new Zombie$/],
];
function suite(expectBroken) {
  let bad = 0;
  const chk = expectBroken ? (c) => { if (!c) bad++; } : ok;
  Diff.set('easy'); M.Player.mode = 0;
  for (const [cls, line, good, re] of ROWS) {
    let r; try { r = run(line, { level: 4 }); } catch (e) { r = { ok: !good, lines: ['THROW ' + e.message] }; }
    const txt = (r.lines || []).join('\n');
    chk(r.ok === good && (!re || re.test(txt)), cls + ': ' + line + ' => ' + r.ok + ' ' + JSON.stringify(txt).slice(0, 100));
  }
  if (expectBroken) okAv(bad > 0, '(' + bad + ' rows failed)');
}
suite(false);
const T = M.Text, tr = T.translate;
T.translate = function (k, a) { return tr.call(T, k, a) + '!'; };
suite(true); T.translate = tr;
const runO = C.run;
C.run = function (l, p, o) { const r = runO.call(C, l, p, o); return Object.assign({}, r, { ok: !r.ok }); };
suite(true); C.run = runO;
const dg = C.dispatcher.get('give'); const ex = dg.executes;
C.run = function (l, p, o) { const r = runO.call(C, l.replace(/^\/give /, '/gibe '), p, o); return r; };
suite(true); C.run = runO; void ex;
console.log(`\n${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
for (const f of fails.slice(0, 30)) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
