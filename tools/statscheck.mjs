#!/usr/bin/env node
// statscheck.mjs -- G26a: src/07zzo_stats.js against Stats.java / StatFormatter.java and the
// .mcdata registries (custom_stat, stat_type), the counters, and the save round trip.
//   node tools/statscheck.mjs
import { readFileSync } from 'node:fs';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const dec = (f) => readFileSync(MCLITE_ROOT + '.decomp/net/minecraft/stat/' + f, 'utf8');
const reg = JSON.parse(readFileSync(MCLITE_ROOT + '.mcdata/1.18.2/_registries.json', 'utf8'));
const javaRows = [...dec('Stats.java').matchAll(/register\("(\w+)", StatFormatter\.(\w+)\)/g)].map((m) => [m[1], m[2]]);
const CODE = { DEFAULT: 'D', DIVIDE_BY_TEN: 'V', DISTANCE: 'S', TIME: 'T' };
const javaTypes = [...dec('Stats.java').matchAll(/registerType\("(\w+)"/g)].map((m) => m[1]);

let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const caught = (c, m) => { breaks++; if (!c) fails.push('anti-vacuity: ' + m); };

const M = loadEngine({ extra: ['07zzo_stats.js'] });
const St = M.Stats;

function verify(S, tag) {
  const ids = S.CUSTOM.map((r) => r[0]);
  ok(JSON.stringify(ids.slice().sort()) === JSON.stringify(reg.custom_stat.slice().sort()), tag + ': custom stat ids == .mcdata custom_stat');
  ok(JSON.stringify(S.CUSTOM.map((r) => [r[0], r[1]])) === JSON.stringify(javaRows.map((r) => [r[0], CODE[r[1]]])), tag + ': ids+formatters == Stats.java');
  ok(JSON.stringify(S.TYPES.map((t) => t[0]).sort()) === JSON.stringify(reg.stat_type.slice().sort()), tag + ': stat types == .mcdata stat_type');
  ok(JSON.stringify(S.TYPES.map((t) => t[0])) === JSON.stringify(javaTypes), tag + ': stat types order == Stats.java');
}
verify(St, 'engine');
ok(St.CUSTOM.length === 75, '75 custom stats');

// formatters (StatFormatter.java)
const F = (id, n) => St.format(id, n);
ok(F('jump', 1234567) === '1,234,567', 'DEFAULT groups thousands');
ok(F('damage_dealt', 25) === '2.50', 'DIVIDE_BY_TEN');
ok(F('walk_one_cm', 50) === '50 cm' && F('walk_one_cm', 51) === '0.51 m', 'DISTANCE cm/m');
ok(F('walk_one_cm', 60000) === '0.60 km' || F('walk_one_cm', 60000) === '0.60 km', 'DISTANCE km');
ok(F('walk_one_cm', 200000) === '2.00 km', 'DISTANCE km 2');
ok(F('play_time', 20) === '1.0 s' && F('play_time', 30) === '1.5 s', 'TIME seconds (Java double toString)');
ok(F('play_time', 1200 * 2) === '2.00 m' && F('play_time', 72000) === '1.00 h', 'TIME m/h');
ok(F('play_time', 72000 * 24) === '1.00 d', 'TIME d');

// counters
St.reset();
ok(St.getCustom('jump') === 0, 'fresh counter is 0');
St.inc('jump'); St.inc('jump');
ok(St.getCustom('jump') === 2, 'inc twice');
ok(St.custom('walk_one_cm') === 'minecraft.custom:minecraft.walk_one_cm', 'Stat.getName');
St.inc('deaths', 2147483647); St.inc('deaths', 5);
ok(St.getCustom('deaths') === 2147483647, 'saturates at Integer.MAX_VALUE');
St.reset();
St.onMove(1, { sprinting: true }); St.onMove(1, {}); St.onMove(0.5, { sneaking: true }); St.onMove(1, { swimming: true });
ok(St.getCustom('sprint_one_cm') === 100 && St.getCustom('walk_one_cm') === 100 && St.getCustom('crouch_one_cm') === 50 && St.getCustom('swim_one_cm') === 100, 'onMove buckets');
St.reset();
St.travel({ inWater: true }, 1, 0.5, 0); St.travel({ inWater: true, submerged: true }, 0, 3, 4); St.travel({ inWater: true, swimming: true }, 0, 3, 4);
St.travel({ climbing: true }, 0.3, 0.2, 0); St.travel({ climbing: true }, 0, -0.2, 0); St.travel({ fallFlying: true }, 0, 3, 4);
St.travel({}, 0.2, 0, 0); St.travel({}, 0.3, 0, 0); St.onFall(1.9); St.onFall(3.5);
ok(St.getCustom('walk_on_water_one_cm') === 100 && St.getCustom('walk_under_water_one_cm') === 500 && St.getCustom('swim_one_cm') === 500
  && St.getCustom('climb_one_cm') === 20 && St.getCustom('aviate_one_cm') === 500 && St.getCustom('fly_one_cm') === 30 && St.getCustom('fall_one_cm') === 350, 'travel classification');
St.reset();
for (const [t, k] of [['minecart','minecart_one_cm'],['hopper_minecart','minecart_one_cm'],['boat','boat_one_cm'],['pig','pig_one_cm'],['donkey','horse_one_cm'],['strider','strider_one_cm']]) {
  St.reset(); St.travel({ vehicle: { type: t }, onGround: true }, 0.3, 0, 0.4); St.travel({ vehicle: { type: t } }, 0, 0, 0);
  ok(St.getCustom(k) === 50 && St.getCustom('walk_one_cm') === 0, 'riding ' + t);
}
St.reset(); St.travel({ vehicle: { type: 'cow' } }, 1, 0, 0); ok(St.getCustom('walk_one_cm') === 0, 'unknown vehicle counts nothing');
St.reset(); St.leaveGame(); ok(St.getCustom('leave_game') === 1, 'leave_game');
{ const sv = St.riding; St.riding = () => 0; St.reset(); St.travel({ vehicle: { type: 'boat' } }, 1, 0, 0);
  caught(St.getCustom('boat_one_cm') === 0, 'neutered riding counts nothing'); St.riding = sv; }
St.reset(); St.onJump(); ok(St.getCustom('jump') === 1, 'onJump');
St.onTick(true); St.onTick(false);
ok(St.getCustom('play_time') === 2 && St.getCustom('sneak_time') === 1 && St.getCustom('time_since_death') === 2, 'onTick');
ok(St.getCustom('time_since_rest') === 2, 'rest counts awake');
St.onTick(false, false, true); ok(St.getCustom('time_since_rest') === 2 && St.getCustom('time_since_death') === 3, 'rest frozen while sleeping');
St.onTick(false, true);
ok(St.getCustom('time_since_death') === 3 && St.getCustom('play_time') === 4, 'onTick: dead player keeps play_time but not time_since_death');
St.onDeath(); ok(St.getCustom('deaths') === 1 && St.getCustom('time_since_death') === 0 && St.getCustom('time_since_rest') === 0, 'onDeath resets both');

St.onTick(false); St.onTick(false, true, false); St.onTick(false, false, true);
ok(St.getCustom('time_since_death') === 2 && St.getCustom('time_since_rest') === 2, 'dead/asleep ticks skip time_since_*');
St.onSleep(); ok(St.getCustom('time_since_rest') === 0 && St.getCustom('time_since_death') === 2, 'onSleep resets rest only');
St.onTick(false); St.onDeath(); ok(St.getCustom('time_since_rest') === 0, 'onDeath resets time_since_rest');

// save round trip
const j = JSON.parse(JSON.stringify(St.toJSON()));
St.reset(); St.fromJSON(j);
ok(St.getCustom('jump') === 1 && St.getCustom('play_time') === 8, 'save round trip');
St.fromJSON({ 'bad key': 5, 'minecraft.custom:minecraft.jump': -3, 'minecraft.custom:minecraft.drop': 7 });
ok(St.getCustom('jump') === 0 && St.getCustom('drop') === 7, 'fromJSON rejects junk');

{ const sv = St.travel; St.travel = () => 0; St.reset(); St.travel({ climbing: true }, 0, 1, 0);
  caught(St.getCustom('climb_one_cm') === 0, 'neutered travel counts nothing'); St.travel = sv; }
// anti-vacuity: break the data, the verifier must notice
{
  const bad = { CUSTOM: St.CUSTOM.map((r) => r.slice()), TYPES: St.TYPES.slice() };
  const n0 = fails.length;
  bad.CUSTOM[0][0] = 'not_a_stat'; verify(bad, 'broken-id');
  caught(fails.length > n0, 'renamed id detected'); fails.length = n0; pass += 0;
  const bad2 = { CUSTOM: St.CUSTOM.map((r) => r.slice()), TYPES: St.TYPES.slice() };
  bad2.CUSTOM[10][1] = bad2.CUSTOM[10][1] === 'D' ? 'T' : 'D'; verify(bad2, 'broken-fmt');
  caught(fails.length > n0, 'swapped formatter detected'); fails.length = n0;
  const bad3 = { CUSTOM: St.CUSTOM.slice(1), TYPES: St.TYPES.slice(1) }; verify(bad3, 'dropped');
  caught(fails.length > n0, 'dropped row/type detected'); fails.length = n0;
  const save = St.inc; St.inc = () => 0; St.reset(); St.onJump();
  caught(St.getCustom('jump') === 0, 'neutered counter reads 0 (counter assertions can fail)'); St.inc = save;
}

// #541: movement/jump stats must also run for creative/spectator (increaseTravelMotionStats has no gamemode gate).
{
  const src = readFileSync(MCLITE_ROOT + 'src/14_player.js', 'utf8');
  const hasCreativeBranch = (t) => /\} else if \(Sv\) \{[\s\S]{0,900}Sv\.movement\(P, cdist[\s\S]{0,400}Sv\.jumped\(P/.test(t);
  ok(hasCreativeBranch(src), 'player tick feeds Sv.movement/jumped when invulnerableGamemode (#541)');
  caught(!hasCreativeBranch(src.replace('} else if (Sv) {', '} else if (false) {').replace('Sv.movement(P, cdist', 'Sv.x(P, cdist')), 'removed creative movement branch detected');
}

// G26l (#10871): killed.<mob> / killed_by.<mob> / mob_kills / player_kills through the REAL paths (Cb.hurt killing blow, Sv.hurt lethal blow).
{
  const { join } = await import('node:path');
  const { ROOT } = await import('./paths.mjs');
  const A = join(ROOT, 'assets'); const b64 = (f) => readFileSync(join(A, f)).toString('base64'); const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
  const EXTRA = ['02f_tags.js', '02g_items.js', '02l_advancements.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
    '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
    '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
    '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zu_poi.js', '07zzm_wither.js', '07zzo_stats.js'];
  const run = (patch) => {
    const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
    MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
    MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
    MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
    MCL.World.init(1); MCL.Behave.init(MCL.World);
    if (MCL.BlockEntities && MCL.BlockEntities.init) MCL.BlockEntities.init();
    MCL.EntityList.init(); MCL.Ai.init(); if (MCL.Spawn && MCL.Spawn.init) MCL.Spawn.init();
    MCL.Breed.init(); MCL.Combat.init && MCL.Combat.init();
    for (let cx = -4; cx <= 4; cx++) for (let cz = -4; cz <= 4; cz++) {
      const c = MCL.World.makeChunk(cx, cz); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(cx, cz), c);
    }
    const S = MCL.Stats, P = MCL.Player = { x: 0.5, y: 70, z: 0.5, type: 'player', health: 20, maxHealth: 20 };
    S.reset();
    const z = MCL.EntityList.spawn('zombie', 3.5, 70, 0.5);
    MCL.Combat.hurt(z, 1000, 0, true, { source: 'player', attacker: P });
    const f = [];
    const g = (n) => S.get(S.statName(...n));
    if (S.getCustom('mob_kills') !== 1) f.push('mob_kills ' + S.getCustom('mob_kills'));
    if (g(['killed', 'zombie']) !== 1) f.push('killed.zombie ' + g(['killed', 'zombie']));
    const k = MCL.EntityList.spawn('cow', 5.5, 70, 0.5);
    MCL.Combat.hurt(k, 1000, 0, false, { source: 'fall' });
    if (S.getCustom('mob_kills') !== 1 || g(['killed', 'cow']) !== 0) f.push('non-player kill counted');
    const atk = { type: 'skeleton', x: 2, y: 70, z: 0.5 };
    if (MCL.Survival.hurt) { MCL.Survival.hurt(P, 'mob', 1000, atk); }
    if (g(['killed_by', 'skeleton']) !== 1) f.push('killed_by.skeleton ' + g(['killed_by', 'skeleton']));
    if (S.getCustom('deaths') !== 1) f.push('deaths ' + S.getCustom('deaths'));
    return f;
  };
  const base = run(); for (const m of base) fails.push('G26l: ' + m); ok(!base.length, 'G26l base');
  const brk = (file, a, b) => (f, s) => { if (f !== file) return s; if (!s.includes(a)) throw new Error('anchor gone: ' + a); return s.replace(a, b); };
  for (const [name, patch] of [
    ['onKilledOther hook gone', brk('14j_combat.js', 'NS.Stats.onKilledOther(e.type)', '0')],
    ['onKilledBy hook gone', brk('14d_survival.js', 'NS.Stats.onKilledBy(e.deathAttacker.type)', '0')],
    ['killed stat not typed', brk('07zzo_stats.js', "St.statName('killed', type)", "St.statName('killed', 'x')")],
  ]) { let bad; try { bad = run(patch); } catch (e) { bad = [e.message]; } caught(bad.length > 0, 'G26l mutant ' + name); }
}

// #10869: ItemStack.damage break -> Stats.BROKEN, driven through the real Use.damage.
{
  const { join } = await import('node:path');
  const A = MCLITE_ROOT + 'assets/';
  const b64 = (f) => readFileSync(A + f).toString('base64');
  const run = (patch) => {
    const E = loadEngine({ extra: ['07zzo_stats.js', '02f_tags.js', '02g_items.js', '14f_inventory.js', '14l_use.js'], dom: false, patch });
    E.Items.init({ items: b64('items.bin'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes });
    E.Stats.reset();
    const inv = E.Inventory.create(), P = { x: 0, y: 8, z: 0, instabuild: false, inventory: inv, slot: 0 };
    const st = E.Inventory.stack('wooden_pickaxe', 1); E.Inventory.setItem(inv, 0, st);
    E.Use.damage(P, st, 1);
    const before = E.Stats.get('minecraft.broken:minecraft.wooden_pickaxe');
    E.Use.damage(P, st, 59);
    return [before, E.Stats.get('minecraft.broken:minecraft.wooden_pickaxe')];
  };
  const [b0, b1] = run();
  ok(b0 === 0 && b1 === 1, 'tool break increments broken:wooden_pickaxe via Use.damage (' + b0 + ',' + b1 + ')');
  const [, c1] = run((f, t) => t.replace("NS.Stats.statName('broken'", "NS.Stats.statName('brokenX'"));
  caught(c1 === 0, 'removed broken hook detected');
}

// #10868: used.<item> through the REAL Use.rightClick path (ItemStack.useOnBlock -> incrementStat(USED))
{
  const { readFileSync: rf } = await import('node:fs');
  const { join } = await import('node:path');
  const rdj = (f) => JSON.parse(rf(join(MCLITE_ROOT, 'assets', f), 'utf8'));
  const X = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js', '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14c_raycast.js', '14e_gamemode.js', '14i_hand.js', '14l_use.js', '07zze_oxidize.js', '07zx_particle.js', '07zzo_stats.js'], dom: false });
  X.Items.init({ items: rb(), itemsBytes: rdj('items.meta.json').rawBytes });
  function rb() { return rf(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'); }
  const cells = new Map();
  const W = { getBlock: (x, y, z) => cells.get(x + ',' + y + ',' + z) | 0, setBlock: () => true, blockLightAt: () => 15 };
  X.World = W; X.Behave.init(W); X.BlockEntities.init(); X.Redstone && X.Redstone.init && X.Redstone.init();
  X.Entities && X.Entities.init && X.Entities.init(); X.EntityList && X.EntityList.init && X.EntityList.init(); X.Use.init(W);
  const click = () => {
    X.Stats.reset(); cells.clear();
    const i = X.Items.of('stone');
    const P = { mode: 1, instabuild: true, invulnerableGamemode: true, mayBuild: true, slot: 0, inventory: null, hasTarget: true, tx: 0, ty: 0, tz: 0, tface: 2,
      ex: 0.5, ey: 1, ez: 0.5, eyeHeight: 0.5, lookVec() { return [0, -1, 0]; }, heldItem() { return { i, n: 1, d: 0 }; }, syncHotbar() {}, placeBlock() { return true; } };
    return X.Use.rightClick(P);
  };
  const r = click();
  ok(r === 'place' && X.Stats.get('minecraft.used:minecraft.stone') === 1, 'placing stone through Use.rightClick counts used:stone (got ' + r + ')');
  const sv = X.Use.countUsed; X.Use.countUsed = () => {}; click();
  caught(X.Stats.get('minecraft.used:minecraft.stone') === 0, 'hook removed -> used:stone stays 0'); X.Use.countUsed = sv;
}

// #10870: picked_up.<item> / dropped.<item> / custom drop, driven through the REAL Player.pickupItems / dropHeld.
{
  const { join } = await import('node:path');
  const A = (f) => join(MCLITE_ROOT, 'assets', f);
  const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '09b_sky.js', '14b_physics.js', '14f_inventory.js', '07h_entities.js',
    '07y_equip.js', '07i_entitylist.js', '07l_spawn.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '07zk_undead.js',
    '07zx_particle.js', '07zzo_stats.js', '14_player.js'];
  const run = (mutate) => {
    const E = loadEngine({ extra: EXTRA, dom: false });
    E.Items.init({ items: readFileSync(A('items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(A('items.meta.json'), 'utf8')).rawBytes });
    E.DATA = Object.assign({}, E.DATA, { entities: JSON.parse(readFileSync(A('entities.json'), 'utf8')) });
    E.Entities.init(); E.EntityList.init();
    const P = E.Player, Iv = E.Inventory, S = E.Stats;
    if (mutate) mutate(E);
    S.reset();
    P.hotbar = new Int32Array(9); P.inventory = Iv.create();
    P.x = 0.5; P.y = 64; P.z = 0.5; P.slot = 0;
    const e = E.EntityList.spawn('item', 0.5, 64, 0.5, { item: E.Items.of('iron_sword'), count: 1 });
    const e2 = E.EntityList.spawn('item', 0.5, 64, 0.5, { item: E.Items.of('stick'), count: 3 });
    e.pickupDelay = 0; e2.pickupDelay = 0;
    P.pickupItems();
    const got = [S.get(S.statName('picked_up', 'iron_sword')), S.get(S.statName('picked_up', 'stick'))];
    P.dropHeld && P.dropHeld(true);
    return { got, drop: S.get(S.statName('dropped', 'iron_sword')) + S.get(S.statName('dropped', 'stick')), custom: S.getCustom('drop') };
  };
  let r; try { r = run(); } catch (x) { fails.push('pickup/drop stat run threw: ' + x.message); r = null; }
  if (r) {
    ok(r.got[0] === 1 && r.got[1] === 3, 'picked_up.<item> counts the taken count via Player.pickupItems: ' + JSON.stringify(r.got));
    ok(r.drop >= 1 && r.custom === r.drop, 'dropped.<item> and custom drop via Player.dropHeld: ' + JSON.stringify(r));
    const z = run((E) => { E.Stats.increase = () => 0; });
    caught(z.got[0] === 0 && z.got[1] === 0 && z.drop === 0 && z.custom === 0, 'neutered stat hook reads 0 (row can fail)');
  }
}

// #10867: crafted.<item> counter via the REAL click path (Menu.doClick on the result slot / quickMove), not St.increase.
{
  const { readFileSync: rf } = await import('node:fs');
  const A = MCLITE_ROOT + 'assets/';
  const MC = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '14g_menu.js', '14g2_invclasses.js', '07c_blockentity.js', '07zzo_stats.js', '13_input.js', '15_hud.js'], dom: false });
  MC.Items.init({ items: rf(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(rf(A + 'items.meta.json', 'utf8')).rawBytes });
  MC.Recipes.init({ recipes: rf(A + 'recipes.bin').toString('base64'), recipesBytes: JSON.parse(rf(A + 'recipes.meta.json', 'utf8')).jsonBytes });
  MC.BlockEntities.init();
  const Inv = MC.Inventory, Mn = MC.Menu, H = MC.Hud;
  MC.Player = { menu: { inventory: Inv.create() } };
  MC.World = { getBlock: () => MC.States.stateOf('crafting_table') };
  const run = () => {
    MC.Stats.reset();
    H.openCraftingTable(1, 1, 1);
    const m = H.craftingMenu;
    m.grid.set(0, Inv.stack('oak_planks', 1)); m.grid.set(3, Inv.stack('oak_planks', 1));
    H.refreshCraftingResult();
    Mn.doClick(m, 0, 0, Mn.PICKUP, {});                       // take 4 sticks by hand
    const k = MC.Stats.statName('crafted', 'stick');
    const a = MC.Stats.get(k);
    m.grid.set(0, Inv.stack('oak_planks', 1)); m.grid.set(3, Inv.stack('oak_planks', 1));
    H.refreshCraftingResult();
    const sl = m.slots[0]; const c = Mn.getCarried(m); Mn.setCarried(m, null);
    Mn.quickMove ? Mn.quickMove(m, MC.Player, 0) : m.quickMove(m, MC.Player, 0);   // shift-click
    const b = MC.Stats.get(k);
    H.close();
    return [a, b];
  };
  const [a, b] = run();
  ok(a === 4, 'taking the crafting result adds its count to crafted.stick (got ' + a + ')');
  ok(b === 8, 'shift-click on the result adds the moved amount (got ' + b + ')');
  const save = Mn.craftedStat; Mn.craftedStat = () => {};
  const [a2] = run();
  caught(a2 === 0, 'removed crafted hook leaves the counter at 0'); Mn.craftedStat = save;
}

// G26g: mined.<block> via the REAL P.breakBlock (Block.afterBreak -> incrementStat(MINED)); survival only.
{
  const A = MCLITE_ROOT + 'assets/';
  const b64 = (f) => readFileSync(A + f).toString('base64');
  const rdj = (f) => JSON.parse(readFileSync(A + f, 'utf8'));
  const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
    '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
    '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
    '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zzo_stats.js', '14_player.js'];
  const mined = (patch, creative) => {
    const E = loadEngine({ extra: EXTRA, dom: false, patch });
    E.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
    E.DATA = Object.assign({}, E.DATA, { entities: rdj('entities.json') });
    E.Entities.init(); E.Entities.attrs = E.DATA.entities.attrs;
    E.World.init(1); E.Behave.init(E.World);
    E.EntityList.init(); E.Ai.init(); if (E.Spawn && E.Spawn.init) E.Spawn.init();
    const c = E.World.makeChunk(0, 0); c.state = E.CH.GENERATED; E.World.chunks.set(E.World.key(0, 0), c);
    E.Sound = { entitySound() {}, blockBreak() {} }; E.Particle.addBlockBreakParticles = () => {};
    const P = E.Player; P.inventory = E.Inventory.create(); P.slot = 0; P.instabuild = !!creative; P.invulnerableGamemode = !!creative; P.mayBuild = true;
    P.x = 0.5; P.y = 64; P.z = 0.5; E.Stats.reset();
    E.World.setBlock(3, 64, 3, E.States.stateOf('stone'));
    P.hasTarget = true; P.tx = 3; P.ty = 64; P.tz = 3;
    P.breakBlock();
    return E.Stats.get ? E.Stats.get(E.Stats.statName('mined', 'stone')) : (E.Stats.map[E.Stats.statName('mined', 'stone')] || 0);
  };
  ok(mined(null, false) === 1, 'survival P.breakBlock increments mined.stone');
  ok(mined(null, true) === 0, 'creative break does not count mined');
  caught(mined((f, src) => f === '14_player.js' ? src.replace("statName('mined'", "statName('minedX'") : src, false) === 0, 'removed mined hook detected');
}

// G26n: damage_* stats through the real Survival.hurt / Combat.hurt paths (x10 rounding).
{
  const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
    '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
    '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
    '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zzo_stats.js', '14_player.js'];
  const run = (patch, f) => {
    const E = loadEngine({ extra: EXTRA, dom: false, patch });
    const P = E.Player; E.Stats.reset();
    P.health = 20; P.armor = 0; P.armorToughness = 0; P.invulnerable = 0; P.dead = false; P.absorption = 0; P.invulnerableGamemode = false;
    f(E, P);
    const g = (id) => E.Stats.get(E.Stats.custom(id));
    return { taken: g('damage_taken'), absorbed: g('damage_absorbed'), resisted: g('damage_resisted'), blocked: g('damage_blocked_by_shield') };
  };
  const tag = (f, a, b) => (name, src) => name === f ? src.split(a).join(b) : src;
  const plain = (E, P) => { const r = E.Survival.hurt(P, 'generic', 3.25); };
  const r1 = run(null, plain);
  ok(r1.taken === Math.round(32.5), 'damage_taken = round(3.25*10) = ' + r1.taken);
  const r2 = run(null, (E, P) => { P.absorption = 2; E.Survival.hurt(P, 'generic', 3.25); });
  ok(r2.absorbed === 20 && r2.taken === 13, 'absorption 2 of 3.25: absorbed 20, taken 13 (got ' + r2.absorbed + '/' + r2.taken + ')');
  caught(run((f, src) => f === '14d_survival.js' ? src.replace("'damage_taken'", "'damage_takenX'") : src, plain).taken === 0, 'removed damage_taken hook detected');
  caught(run((f, src) => f === '14d_survival.js' ? src.replace("'damage_absorbed'", "'damage_absorbedX'") : src, (E, P) => { P.absorption = 2; E.Survival.hurt(P, 'generic', 3.25); }).absorbed === 0, 'removed damage_absorbed hook detected');
  caught(run((f, src) => f === '07zzo_stats.js' ? src.replace('Math.round(Math.fround(amount * 10))', 'Math.round(amount)') : src, plain).taken !== 33, 'wrong x10 rounding detected');
}

for (const f of fails) console.log('FAIL ' + f);
console.log(`${pass} assertions, ${fails.length} failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
