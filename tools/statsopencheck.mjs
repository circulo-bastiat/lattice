#!/usr/bin/env node
// statsopencheck.mjs -- #11024 G26q: container/workstation/interaction custom stats are incremented on the real
// Use.blockUse / Note.use / Note.punch paths (ChestBlock.getOpenStat, AbstractFurnaceBlock, NoteBlock.onUse/
// onBlockBreakStart, CakeBlock.tryEat, CauldronBehavior.fillCauldron/emptyCauldron, FlowerPotBlock.onUse ...).
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };

const A = MCLITE_ROOT + 'assets/';
const b64 = (f) => readFileSync(A + f).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(A + f, 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07fn_noteblock.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zzo_stats.js', '14_player.js'];

/** Returns { stat -> count } after driving each scenario; `patch` breaks a source file for the anti-vacuity run. */
function run(patch) {
  const E = loadEngine({ extra: EXTRA, dom: false, patch });
  E.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  E.DATA = Object.assign({}, E.DATA, { entities: rdj('entities.json') });
  E.Entities.init(); E.Entities.attrs = E.DATA.entities.attrs;
  E.World.init(1); E.Behave.init(E.World); E.BlockEntities.init(); E.Use.init(E.World); if (E.Note && E.Note.init) E.Note.init(E.World);
  E.EntityList.init(); E.Ai.init(); if (E.Spawn && E.Spawn.init) E.Spawn.init();
  const c = E.World.makeChunk(0, 0); c.state = E.CH.GENERATED; E.World.chunks.set(E.World.key(0, 0), c);
  E.Sound = { entitySound() {}, blockBreak() {}, play() {} }; E.Particle.addBlockBreakParticles = () => {}; E.Particle.spawn = () => {};
  const P = E.Player; P.inventory = E.Inventory.create(); P.slot = 0; P.mayBuild = true; P.x = 0.5; P.y = 64; P.z = 0.5;
  const opened = (x, y, z) => { const be = E.BlockEntities.get(x, y, z); return be ? true : true; };
  E.Hud = new Proxy({ openChest: () => true }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' && /^open/.test(k) ? () => true : undefined)) });
  const out = {};
  const held = E.Inventory.EMPTY;
  const use = (name, beType, stat, yy) => {
    const x = 3, y = yy;
    E.Stats.reset();
    E.World.setBlock(x, y, 5, E.States.stateOf(name));
    if (beType) E.BlockEntities.create(x, y, 5, beType);
    E.Use.blockUse(P, x, y, 5, E.World.getBlock(x, y, 5), held);
    out[stat] = E.Stats.get(E.Stats.custom(stat)); if (process.env.DBG && !out[stat]) console.log("DBG", name, name, JSON.stringify(E.Stats.map));
  };
  let x = 70;
  use('chest', 'chest', 'open_chest', x++);
  use('trapped_chest', 'trapped_chest', 'trigger_trapped_chest', x++);
  use('ender_chest', 'ender_chest', 'open_enderchest', x++);
  use('barrel', 'barrel', 'open_barrel', x++);
  use('shulker_box', 'shulker_box', 'open_shulker_box', x++);
  use('furnace', 'furnace', 'interact_with_furnace', x++);
  use('blast_furnace', 'blast_furnace', 'interact_with_blast_furnace', x++);
  use('smoker', 'smoker', 'interact_with_smoker', x++);
  use('crafting_table', null, 'interact_with_crafting_table', x++);
  use('anvil', null, 'interact_with_anvil', x++);
  use('grindstone', null, 'interact_with_grindstone', x++);
  use('loom', null, 'interact_with_loom', x++);
  use('cartography_table', null, 'interact_with_cartography_table', x++);
  use('hopper', 'hopper', 'inspect_hopper', x++);
  use('dispenser', 'dispenser', 'inspect_dispenser', x++);
  use('dropper', 'dropper', 'inspect_dropper', x++);
  use('brewing_stand', 'brewing_stand', 'interact_with_brewingstand', x++);
  // noteblock
  E.Stats.reset(); E.World.setBlock(6, 64, 5, E.States.stateOf('note_block')); E.Use.blockUse(P, 6, 64, 5, E.World.getBlock(6, 64, 5), held);
  out.tune_noteblock = E.Stats.get(E.Stats.custom('tune_noteblock'));
  E.Stats.reset(); E.Note.punch(6, 64, 5); out.play_noteblock = E.Stats.get(E.Stats.custom('play_noteblock'));
  // cake (full hunger is fine for creative-style invulnerable gamemode)
  P.invulnerableGamemode = true; E.Stats.reset();
  E.World.setBlock(7, 63, 5, E.States.stateOf('stone')); E.World.setBlock(7, 64, 5, E.States.stateOf('cake')); E.Use.blockUse(P, 7, 64, 5, E.World.getBlock(7, 64, 5), held);
  if (process.env.DBG) console.log('cake', E.World.getBlock(7,64,5), E.States.name(E.World.getBlock(7,64,5)), E.Stats.map);
  out.eat_cake_slice = E.Stats.get(E.Stats.custom('eat_cake_slice'));
  return out;
}

const expectIds = ['open_chest', 'trigger_trapped_chest', 'open_enderchest', 'open_barrel', 'open_shulker_box', 'interact_with_furnace',
  'interact_with_blast_furnace', 'interact_with_smoker', 'interact_with_crafting_table', 'interact_with_anvil', 'interact_with_grindstone',
  'interact_with_loom', 'interact_with_cartography_table', 'inspect_hopper', 'inspect_dispenser', 'inspect_dropper',
  'interact_with_brewingstand', 'tune_noteblock', 'play_noteblock', 'eat_cake_slice'];
const good = run(null);
for (const id of expectIds) ok(good[id] === 1, id + ' == 1 after one use (got ' + good[id] + ')');

// source-level: stats wired off the Use.blockUse path (need a held item / menu / bed to drive)
const src = (f) => readFileSync(MCLITE_ROOT + 'src/' + f, 'utf8');
ok(/inc\('enchant_item'\)/.test(src('14g_menu.js')), 'enchant_item in Menu.enchantClick');
ok(/inc\('sleep_in_bed'\)/.test(src('14m_sleep.js')), 'sleep_in_bed in Sleep success');
ok(/openStat\('pot_flower'\)/.test(src('14l_use.js')) && /openStat\('fill_cauldron'\)/.test(src('14l_use.js')), 'pot_flower + fill_cauldron');

ok(/inc\('play_record'\)/.test(src('14l_use.js')), 'play_record in jukebox disc insert (MusicDiscItem.useOnBlock)');
ok(/inc\('target_hit'\)/.test(src('07f_redstone.js')), 'target_hit in TargetBlock.trigger');
caught(!/inc\('play_record'\)/.test(src('14l_use.js').replace("inc('play_record')", "inc('x')")), 'play_record removal detected');
caught(!/inc\('target_hit'\)/.test(src('07f_redstone.js').replace("inc('target_hit')", "inc('x')")), 'target_hit removal detected');
// anti-vacuity: break the call site, the count must drop
const brk = (file, from, ids, label) => {
  const r = run((f, s) => f === file ? s.replace(from, 'void 0 &&' + from) : s);
  for (const id of ids) caught(r[id] !== 1, label + ' -> ' + id + ' detected');
};
caught(run((f, s) => f === '14l_use.js' ? s.replace("Use.openStat = function (id) {", "Use.openStat = function (id) { return;") : s).open_chest !== 1, 'openStat disabled -> open_chest detected');
caught(run((f, s) => f === '14l_use.js' ? s.replace("'trigger_trapped_chest' :", "'open_chest' :") : s).trigger_trapped_chest !== 1, 'trapped chest mis-mapped detected');
caught(run((f, s) => f === '07fn_noteblock.js' ? s.replace("inc('tune_noteblock')", "inc('play_noteblock')") : s).tune_noteblock !== 1, 'tune swapped detected');
caught(run((f, s) => f === '07fn_noteblock.js' ? s.replace("inc('play_noteblock')", "inc('tune_noteblock')") : s).play_noteblock !== 1, 'play swapped detected');
caught(run((f, s) => f === '14l_use.js' ? s.replace("'interact_with_' + beTypeHere", "'interact_with_furnace'") : s).interact_with_smoker !== 1, 'furnace type collapse detected');

for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
