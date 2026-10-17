#!/usr/bin/env node
// gameeventcheck.mjs -- G17 (#5612): entity actions emit GameEvents (src/07zzw_gameevent.js) that wake sculk sensors.
//   a walking entity 6 blocks away wakes a sensor, a sneaking one does not, a wool block between blocks it,
//   and EL.tickStep really calls GameEvent.emit (source scan).
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
console.log('gameeventcheck -- G17 (#5612), game events from entity actions');

// the nine #5897 events and the source file whose action emits each
const EMITTERS = { fluid_place: '14l_use.js', fluid_pickup: '14l_use.js', swim: '07i_entitylist.js', flap: '07w_passive.js',
  elytra_free_fall: '14b_physics.js', lightning_strike: '07zzc_lightning.js', prime_fuse: '07b_behaviour.js',
  dispense_fail: '07c_blockentity.js', minecart_moving: '07zzr_minecart.js' };
const emitRe = (ev) => new RegExp("GameEvent\\.emit\\('" + ev + "'");
const srcOf = (f) => fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');

function scenarios(patch, tweak) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07zzu_sculk.js', '07zzw_gameevent.js', '07g_piston.js'], dom: false, patch });
  const R = M.Reg, B = M.Behave, Sc = M.Sculk, G = M.GameEvent;
  if (tweak) tweak(M);
  const N = 40, MID = 20, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  const world = {
    getBlock: (x, y, z) => cells[idx(x, y, z)],
    setBlock(x, y, z, id) { const old = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, old); return true; },
    blockLightAt: () => 15,
  };
  M.World = world;
  B.init(world); M.Redstone.init(); Sc.reset();
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  world.setBlock(0, 0, 0, def('sculk_sensor'));
  const ph = () => B.propName(world.getBlock(0, 0, 0), 'sculk_sensor_phase');
  const run = () => { for (let i = 0; i < 10; i++) B.tick(); };
  const walker = { sneaking: false };
  G.emit('step', 6, 0, 0, walker); run();
  ok(ph() === 'active', 'walker at 6 blocks wakes the sensor (phase ' + ph() + ')');
  Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
  G.emit('step', 6, 0, 0, { sneaking: true }); run();
  ok(ph() === 'inactive', 'sneaker does not wake it');
  world.setBlock(3, 0, 0, def('white_wool'));
  G.emit('step', 6, 0, 0, walker); run();
  ok(ph() === 'inactive', 'wool between blocks the vibration');
  world.setBlock(3, 0, 0, 0);
  G.emit('step', 6, 0, 0, walker); run();
  ok(ph() === 'active', 'removing the wool lets it through');
  // #5889: door / lever toggles emit BLOCK_OPEN/CLOSE (11/10) and BLOCK_SWITCH/UNSWITCH (11/10)
  const freqOf = () => Sc.lastFrequency(0, 0, 0);
  const wake = () => { Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor')); };
  const toggle = (x, nm, prop, v) => { const st = world.getBlock(x, 0, 0); world.setBlock(x, 0, 0, B.setProp(st, prop, v)); run(); };
  wake(); world.setBlock(2, 0, 0, def('oak_trapdoor'));
  wake(); toggle(2, 'oak_trapdoor', 'open', true);
  ok(freqOf() === 11, 'opening a trapdoor next to a sensor: frequency 11 (got ' + freqOf() + ')');
  wake(); toggle(2, 'oak_trapdoor', 'open', false);
  ok(freqOf() === 10, 'closing it: frequency 10 (got ' + freqOf() + ')');
  world.setBlock(2, 0, 0, def('lever'));
  wake(); toggle(2, 'lever', 'powered', true);
  ok(freqOf() === 11, 'lever on: 11 (got ' + freqOf() + ')');
  wake(); toggle(2, 'lever', 'powered', false);
  ok(freqOf() === 10, 'lever off: 10 (got ' + freqOf() + ')');
  for (const ev of Object.keys(EMITTERS)) {
    Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
    G.emit(ev, 3, 0, 0, { sneaking: false }); run();
    ok(Sc.lastFrequency(0, 0, 0) === Sc.FREQUENCIES[ev], ev + ' wakes the sensor at frequency ' + Sc.FREQUENCIES[ev] + ' (got ' + Sc.lastFrequency(0, 0, 0) + ')');
  }
  // CONTAINER_OPEN/CLOSE, SHULKER_OPEN/CLOSE: 5 blocks from the sensor, frequency 15 open / 14 close
  const BE = M.BlockEntities;
  for (const [type, tick] of [['chest', BE.tickLid], ['barrel', BE.barrelSync], ['shulker_box', BE.tickShulkerBox]]) {
    Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
    const e = { type, x: 5, y: 0, z: 0, open: 1 };
    tick(e); run(); run();
    ok(Sc.lastFrequency(0, 0, 0) === 15, type + ' open gives 15 (got ' + Sc.lastFrequency(0, 0, 0) + ')');
    Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
    e.open = 0; tick(e); run(); run(); run();
    ok(Sc.lastFrequency(0, 0, 0) === 14, type + ' close gives 14 (got ' + Sc.lastFrequency(0, 0, 0) + ')');
  }
  // BLOCK_PLACE (12) / BLOCK_DESTROY (13): player emits at the cell; worldgen setBlock emits nothing
  Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
  const pw = (nm) => { const e = M.Sculk.FREQUENCIES[nm]; return e; };
  world.setBlock(6, 0, 0, def('stone')); run();
  ok(ph() === 'inactive', 'worldgen-style setBlock emits no game event');
  G.emit('block_place', 6, 0, 0, walker); run();
  ok(ph() === 'active' && Sc.lastFrequency(0, 0, 0) === 12 && pw('block_place') === 12, 'block_place at 6 blocks: frequency 12');
  Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
  G.emit('block_destroy', 6, 0, 0, walker); run();
  ok(ph() === 'active' && Sc.lastFrequency(0, 0, 0) === 13, 'block_destroy at 6 blocks: frequency 13');
  world.setBlock(6, 0, 0, 0);
  // piston: extend -> 15, retract -> 14, blocked push -> nothing (PistonBlock.onSyncedBlockEvent)
  M.BlockEntities.init(); M.Piston.init();
  const S = M.States, P = M.Piston, got = [];
  const real = G.emit; G.emit = (t, ...a) => { got.push(t); return real(t, ...a); };
  const put = (x, y, z, nm, props) => { let st = S.stateOf(nm); for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]); world.setBlock(x, y, z, st); };
  put(10, 0, 0, 'piston', { facing: 'east' }); put(10, 0, 1, 'redstone_block');
  P.onEvent(10, 0, 0, P.TRIGGER_EXTEND, 0);
  ok(got.join() === 'piston_extend', 'extending emits piston_extend only (' + got + ')');
  ok(Sc.FREQUENCIES.piston_extend === 15 && Sc.FREQUENCIES.piston_contract === 14, 'frequencies 15 and 14');
  got.length = 0; world.setBlock(10, 0, 1, 0);
  P.onEvent(10, 0, 0, P.TRIGGER_CONTRACT, 0);
  ok(got.join() === 'piston_contract', 'retracting emits piston_contract (' + got + ')');
  got.length = 0; world.setBlock(10, 0, 0, 0); world.setBlock(11, 0, 0, 0);
  put(20, 0, 0, 'piston', { facing: 'east' }); put(20, 0, 1, 'redstone_block'); put(21, 0, 0, 'obsidian');
  P.onEvent(20, 0, 0, P.TRIGGER_EXTEND, 0);
  ok(got.length === 0, 'a blocked push emits nothing (' + got + ')');
  G.emit = real;
  world.setBlock(6, 0, 0, 0);
  Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor')); world.setBlock(3, 0, 0, 0);
  G.emit('explode', 8, 0, 0, {}); run();
  ok(ph() === 'active', 'explosion 8 blocks away wakes the sensor');
  ok(typeof M.Sculk.getPower === 'function', 'power');
  Sc.reset(); world.setBlock(0, 0, 0, def('sculk_sensor'));
  G.emit('explode', 9, 0, 0, {}); run();
  ok(ph() === 'inactive', 'explosion 9 blocks away is out of range');
  return { n, fails };
}

const base = scenarios();
for (const f of base.fails) console.log('  FAIL ' + f);
let breaks = 0;
for (const [name, tweak] of [
  ['openEdge disabled', (M) => { M.BlockEntities.openEdge = () => 0; }],
  ['emit disabled', (M) => { M.GameEvent.emit = () => 0; }],
  ['sneak ignored', (M) => { M.GameEvent.QUIET_WHEN_SNEAKING = {}; }],
  ['toggle events off', (M) => { M.GameEvent.emit = (t, ...a) => /^block_/.test(t) ? 0 : 1; }],
  ['piston emit removed', (M) => { M.GameEvent = undefined; }],
  ['wool ignored', (M) => { M.GameEvent.occluded = () => false; }]]) {
  const r = scenarios(undefined, tweak);
  if (r.fails.length) { breaks++; console.log('  ✓ break caught: ' + name); } else console.log('  NOT CAUGHT: ' + name);
}
// #5891: finishing food / a potion / milk emits EAT (8) / DRINKING_FINISH (7) from Use.drinkFinish
function consume(patch) {
  const rd = (f) => JSON.parse(fs.readFileSync(new URL('../assets/' + f, import.meta.url), 'utf8'));
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07q_effects.js', '07z_potion.js', '07zzu_sculk.js', '07zzw_gameevent.js', '14d_survival.js', '14l_use.js'], dom: false, patch });
  M.Items.init({ items: fs.readFileSync(new URL('../assets/items.bin', import.meta.url)).toString('base64'), itemsBytes: rd('items.meta.json').rawBytes });
  const seen = [];
  M.Sculk.emit = (type) => { seen.push(M.Sculk.FREQUENCIES[type]); return 0; };
  for (const [name, tag] of [['bread'], ['potion', { Potion: 'minecraft:water' }], ['milk_bucket']]) {
    const inv = M.Inventory.create(); M.Inventory.setItem(inv, 0, M.Inventory.stack(name, 1, 0, tag));
    M.Use.drinkFinish({ mode: 0, instabuild: false, slot: 0, inventory: inv, food: 10, saturation: 0, health: 10, effects: {}, x: 3, y: 0, z: 0, exhaustion: 0, maxHealth: 20, usingItem: true, useKind: 'drink' });
  }
  return seen.join(',');
}
const cons = consume();
if (cons !== '8,7,7') console.log('  FAIL consume frequencies ' + cons + ' (want 8,7,7)');
const consBreak = consume((f, t) => f === '14l_use.js' ? t.replace(/if \(NS\.GameEvent\) NS\.GameEvent\.emit\(name ===[^\n]*/, '') : t) !== '8,7,7';
if (consBreak) { breaks++; console.log('  ✓ break caught: consume emit removed'); }
const consFail = cons !== '8,7,7' || !consBreak;
const files = { equip: '07y_equip.js', shear: '07w_passive.js', ring_bell: '07zv7_vbbell.js', wolf_shaking: '07zq2_wolfshake.js', ravager_roar: '07k_goals.js' };
let missing = 0;
for (const [ev, file] of Object.entries(files)) {
  const s = fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  const re = new RegExp("GameEvent\\.emit\\('" + ev + "'");
  const freq = { equip: 9, shear: 9, ring_bell: 6, wolf_shaking: 6, ravager_roar: 9 }[ev];
  const r = scenarios(undefined, (M) => { M.__ev = ev; });
  const Mx = loadEngine({ extra: ['07zzu_sculk.js'], dom: false });
  if (Mx.Sculk.FREQUENCIES[ev] !== freq) { missing++; console.log('  FAIL frequency ' + ev); }
  if (!re.test(s)) { missing++; console.log('  FAIL no emit ' + ev); }
  else if (!re.test(s.replace(new RegExp("[^\\n]*GameEvent\\.emit\\('" + ev + "'[^\\n]*", 'g'), ''))) { breaks++; console.log('  ✓ break caught: ' + ev + ' emit removed'); }
}
const use = fs.readFileSync(new URL('../src/14l_use.js', import.meta.url), 'utf8');
for (const [nm, re] of [['plate press/unpress', /'block_press' : 'block_unpress'/], ['hook attach/detach', /'block_attach' : 'block_detach'/]]) {
  if (!re.test(use)) console.log('  FAIL ' + nm + ' not emitted');
  else if (!re.test(use.replace(new RegExp(re.source, 'g'), ''))) { breaks++; console.log('  ✓ break caught: ' + nm + ' emit removed'); }
}
// projectile section: a shoot / land event 5 blocks from a sensor wakes it with frequency 7 / 8
let pfail = 0;
for (const [type, want] of [['projectile_shoot', 7], ['projectile_land', 8]]) {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07c_blockentity.js', '14b_physics.js', '14f_inventory.js', '07f_redstone.js', '07zzu_sculk.js', '07zzw_gameevent.js'], dom: false });
  const R = M.Reg, B = M.Behave, N = 40, MID = 20, cells = new Uint16Array(N * N * N);
  const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
  M.World = { getBlock: (x, y, z) => cells[idx(x, y, z)], blockLightAt: () => 15,
    setBlock(x, y, z, id) { const o = cells[idx(x, y, z)]; cells[idx(x, y, z)] = id; B.changed(x, y, z, o); return true; } };
  B.init(M.World); M.Redstone.init(); M.Sculk.reset();
  M.World.setBlock(0, 0, 0, R.realFirst[R.id.sculk_sensor] + R.defaultState[R.id.sculk_sensor]);
  M.GameEvent.emit(type, 5, 0, 0, { sneaking: false });
  for (let i = 0; i < 10; i++) B.tick();
  const f = M.Sculk.lastFrequency(0, 0, 0), p = B.propName(M.World.getBlock(0, 0, 0), 'sculk_sensor_phase');
  if (p !== 'active' || f !== want) { pfail++; console.log('  FAIL ' + type + ': phase ' + p + ' freq ' + f + ' want ' + want); }
}
const emitSites = [['07i_entitylist.js', /emit\('projectile_shoot'/], ['14j_combat.js', /emit\('projectile_land'/], ['07zzd_throw.js', /emit\('projectile_land'/]];
let sitesOk = true;
for (const [f, re] of emitSites) {
  const t = fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
  if (!re.test(t)) { sitesOk = false; console.log('  FAIL no ' + re + ' in ' + f); }
}
if (sitesOk) { breaks++; console.log('  ✓ break caught: projectile emit calls removed'); }
const src = fs.readFileSync(new URL('../src/07i_entitylist.js', import.meta.url), 'utf8');
const exsrc = fs.readFileSync(new URL('../src/07za_explosion.js', import.meta.url), 'utf8');
const psrc = fs.readFileSync(new URL('../src/14_player.js', import.meta.url), 'utf8');
const pw = /emit\('block_place'/.test(psrc) && /emit\('block_destroy'/.test(psrc);
if (!pw) console.log('  FAIL player place/break do not emit');
else if (!/emit\('block_place'/.test(psrc.replace(/[^\n]*emit\('block_place'[^\n]*/g, ''))) { breaks++; console.log('  ✓ break caught: player emit removed'); }
const wired = pw && /GameEvent\.emit\('step'/.test(src) && /GameEvent\.emit\('explode'/.test(exsrc);
if (/GameEvent\.emit\('explode'/.test(exsrc) && !/GameEvent\.emit\('explode'/.test(exsrc.replace(/[^\n]*GameEvent\.emit\('explode'[^\n]*/g, ''))) { breaks++; console.log('  ✓ break caught: explode emit removed'); }
if (!wired) console.log('  FAIL tickStep does not emit step');
else if (!/GameEvent\.emit\('step'/.test(src.replace(/GameEvent\.emit\('step'[^\n]*/g, ''))) { breaks++; console.log('  ✓ break caught: emit call removed'); }
for (const [ev, f] of Object.entries(EMITTERS)) {
  const t = srcOf(f);
  if (!emitRe(ev).test(t)) { missing++; console.log('  FAIL ' + f + ' does not emit ' + ev); continue; }
  if (!emitRe(ev).test(t.replace(new RegExp("[^\\n]*GameEvent\\.emit\\('" + ev + "'[^\\n]*", 'g'), ''))) { breaks++; console.log('  ✓ break caught: ' + ev + ' emit removed'); }
}
// #5895: hurt -> entity_damaged (8), death -> entity_killed (13), armor stand -> entity_place (12), mob click -> mob_interact (8)
for (const [file, pat, what] of [['14j_combat.js', /'entity_killed' : 'entity_damaged'/, 'Cb.hurt damaged/killed'],
    ['07zzt_armorstand.js', /emit\('entity_place'/, 'armor stand place'], ['14l_use.js', /emit\('mob_interact'/, 'mob interact']]) {
  const t = fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
  if (!pat.test(t)) { console.log('  FAIL ' + what + ' does not emit'); base.fails.push(what); }
  else if (!pat.test(t.replace(pat, ''))) { breaks++; console.log('  ✓ break caught: ' + what + ' removed'); }
}
const SC = fs.readFileSync(new URL('../src/07zzu_sculk.js', import.meta.url), 'utf8');
for (const [k, v] of [['entity_damaged', 8], ['mob_interact', 8], ['entity_place', 12], ['entity_killed', 13]])
  if (!new RegExp(k + ': ' + v + '\\b').test(SC)) { base.fails.push(k); console.log('  FAIL frequency ' + k); }
console.log(`gameeventcheck: ${base.n + 1} assertions, ${base.fails.length + (wired ? 0 : 1) + missing + (consFail ? 1 : 0)} failures, ${breaks} breaks caught`);
process.exit(pfail || missing || !sitesOk || base.fails.length || !wired || consFail || breaks < 30 ? 1 : 0);
