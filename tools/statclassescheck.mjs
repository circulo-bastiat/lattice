#!/usr/bin/env node
// statclassescheck.mjs -- #11701: proves 07zzo_stats.js's four classes (StatFormatter, StatType, StatHandler,
// ServerStatHandler) through real entries: /scoreboard objectives add minecraft.<type>:... (StatType registry
// lookup), the gameplay hooks (onKilledOther/onDamage/onTick/onMove) and the player-save JSON round trip.
// Each break must be caught (D-30).
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
const EXTRA = ['16_settings.js', '02f_tags.js', '02g_items.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07zzo_stats.js', '09b_sky.js', '07c_blockentity.js', '07w_passive.js', '14j_combat.js', '14c_raycast.js',
  '02i_text.js', '02n_nbt.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js',
  '07zzo2_scoreboard.js', '15g_commands.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
initRegistry(M);
{ const A = MCLITE_ROOT + 'assets/'; M.Items.init({ items: readFileSync(A + 'items.bin').toString('base64'), itemsBytes: JSON.parse(readFileSync(A + 'items.meta.json', 'utf8')).rawBytes }); }
{ const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length }); }
const St = M.Stats, SB = M.Scoreboard, C = M.Commands;
M.Player = { x: 0, y: 64, z: 0, name: 'Player', health: 20, food: 20, air: 300 };
C.build();
const run = (l) => C.run(l, M.Player, {});
const orig = {}; for (const k of Object.keys(St)) orig[k] = St[k];
const origFmt = Object.assign({}, St.FORMAT);

function suite() {
  const bad = []; const chk = (c, m) => { if (!c) bad.push(m); };
  St.reset(); SB.reset();
  // StatFormatter
  const F = (id, n) => St.format(id, n);
  chk(F('jump', 1234567) === '1,234,567', 'DEFAULT grouping');
  chk(F('damage_taken', 25) === '2.50', 'DIVIDE_BY_TEN');
  chk(F('walk_one_cm', 50) === '50 cm' && F('walk_one_cm', 51) === '0.51 m' && F('walk_one_cm', 200000) === '2.00 km', 'DISTANCE');
  chk(F('play_time', 30) === '1.5 s' && F('play_time', 2400) === '2.00 m' && F('play_time', 72000) === '1.00 h' && F('play_time', 72000 * 24) === '1.00 d', 'TIME');
  // StatType: criterion names resolve through the type registries
  chk(run('/scoreboard objectives add a minecraft.custom:minecraft.jump').ok, 'custom stat criterion');
  chk(run('/scoreboard objectives add b minecraft.killed:minecraft.zombie').ok, 'killed entity criterion');
  chk(run('/scoreboard objectives add c minecraft.mined:minecraft.stone').ok, 'mined block criterion');
  chk(run('/scoreboard objectives add d minecraft.crafted:minecraft.stick').ok, 'crafted item criterion');
  chk(!run('/scoreboard objectives add e minecraft.mined:minecraft.stick').ok, 'item is not a block');
  chk(!run('/scoreboard objectives add f minecraft.custom:minecraft.nope').ok, 'unknown custom stat');
  chk(!run('/scoreboard objectives add g minecraft.bogus:minecraft.jump').ok, 'unknown stat type');
  chk(St.statName('killed_by', 'creeper') === 'minecraft.killed_by:minecraft.creeper', 'Stat.getName');
  // StatHandler
  St.inc('jump'); St.inc('jump', 2);
  chk(St.getCustom('jump') === 3, 'increase');
  St.inc('deaths', 2147483647); St.inc('deaths', 9);
  chk(St.getCustom('deaths') === 2147483647, 'saturates at Integer.MAX_VALUE');
  St.onKilledOther('zombie'); St.onKilledOther('player');
  chk(St.getCustom('mob_kills') === 1 && St.getCustom('player_kills') === 1 && St.get(St.statName('killed', 'zombie')) === 1, 'kill counters');
  St.onDamage('damage_taken', 3.5);
  chk(St.getCustom('damage_taken') === 35, 'damage x10');
  St.onTick(true, false, false);
  chk(St.getCustom('play_time') === 1 && St.getCustom('sneak_time') === 1, 'tick counters');
  St.onMove(2, { sprinting: true });
  chk(St.getCustom('sprint_one_cm') === 200, 'movement cm');
  // scoreboard objective fed by the stat
  run('/scoreboard objectives add jumps minecraft.custom:minecraft.jump');
  St.inc('jump');
  chk(SB.getScore('Player', SB.get('jumps')) === 1, 'stat feeds scoreboard objective');
  // ServerStatHandler: JSON save round trip
  const j = JSON.parse(JSON.stringify(St.toJSON()));
  chk(j['minecraft.custom:minecraft.jump'] === 4 && !('minecraft.custom:minecraft.drop' in j), 'toJSON skips zeros');
  St.reset();
  St.fromJSON(Object.assign({ 'bad key': 5, 'minecraft.custom:minecraft.drop': -3, 'minecraft.custom:minecraft.leave_game': 9e12 }, j));
  chk(St.getCustom('jump') === 4 && St.getCustom('drop') === 0 && St.getCustom('leave_game') === 2147483647, 'fromJSON validates/clamps');
  chk(Object.keys(St.map).every(k => k !== 'bad key'), 'bad key dropped');
  return bad;
}
const base = suite();
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const muts = {
  'format grouping': () => { St.FORMAT.D = (n) => String(n); },
  'format divide': () => { St.FORMAT.V = (n) => String(n); },
  'format distance': () => { St.FORMAT.S = (n) => n + ' cm'; },
  'format time': () => { St.FORMAT.T = (n) => n + ' s'; },
  'criterion all valid': () => { St.criterionValid = () => true; },
  'criterion none valid': () => { St.criterionValid = () => false; },
  'statName plain': () => { St.statName = (t, i) => t + ':' + i; },
  'no saturation': () => { St.increase = (n, k) => { St.map[n] = St.get(n) + k; return St.map[n]; }; },
  'increase no scoreboard': () => { St.increase = (n, k) => { St.map[n] = Math.min(St.get(n) + k, 2147483647); return St.map[n]; }; },
  'kill no type stat': () => { St.onKilledOther = (t) => { St.inc('mob_kills'); }; },
  'damage unscaled': () => { St.onDamage = (id, a) => { St.inc(id, Math.round(a)); }; },
  'tick drops sneak': () => { St.onTick = () => { St.inc('play_time'); }; },
  'move walk only': () => { St.onMove = (d) => { St.inc('walk_one_cm', Math.round(d * 100)); }; },
  'toJSON keeps zeros': () => { St.toJSON = () => { const o = {}; for (const k in St.map) o[k] = St.map[k]; o['minecraft.custom:minecraft.drop'] = 0; return o; }; },
  'toJSON empty': () => { St.toJSON = () => ({}); },
  'fromJSON no clamp': () => { St.fromJSON = (o) => { St.reset(); for (const k in o) if (/^minecraft\./.test(k)) St.map[k] = o[k]; }; },
};
let caught = 0;
for (const [n, f] of Object.entries(muts)) {
  for (const k of Object.keys(orig)) St[k] = orig[k]; Object.assign(St.FORMAT, origFmt);
  St.formatterOf = orig.formatterOf;
  f(); let r; try { r = suite(); } catch (e) { r = ['threw']; }
  for (const k of Object.keys(orig)) St[k] = orig[k]; Object.assign(St.FORMAT, origFmt);
  if (r.length) caught++; else console.log('x break not caught: ' + n);
}
console.log(caught + ' breaks caught');
process.exit(caught === Object.keys(muts).length ? 0 : 1);
