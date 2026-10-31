#!/usr/bin/env node
// villagerinteractcheck.mjs — #2870: VillagerEntity.interactMob gates (.decomp VillagerEntity.java ~l.318-345),
// driven through the real Use.entityUse: baby / sleeping / busy / offerless villagers never open the trade
// screen; baby + offerless say no (headRollingTimeLeft 40 + entity.villager.no); a normal villager counts
// talked_to_villager and opens trades. Each rule is broken once and must be seen to change ("<n> breaks caught").
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('  ✓ break caught: ' + m); };
console.log('villagerinteractcheck — #2870 villager interactMob gates');

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js',
  '07za_explosion.js', '07z_potion.js', '07m_breed.js', '07q_effects.js', '07ox_enchhelper.js', '07p_trade.js',
  '07zzo_stats.js'], dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.World.init(1); M.Behave.init(M.World);
M.EntityList.init(); M.Ai.init();

let opened = 0, sounds = [];
M.Hud = { openTrading: () => { opened++; return true; } };
M.Sound = { play: (n) => sounds.push(n) };
const P = { instabuild: false };
const mk = (o) => Object.assign(M.EntityList.spawn('villager', 0, 70, 0), o);
function run(label, o, offers) {
  opened = 0; sounds = []; M.Stats.reset();
  const e = mk(o);
  const r = M.Use.entityUse(P, e, null);
  return { e, r, opened, sounds: sounds.slice(), talked: M.Stats.getCustom('talked_to_villager') };
}
M.Trade.ready = true; M.Trade.ensure = () => [{}];   // stub: offer data is tradecheck's job
const ens = M.Trade.ensure;
const g = (n, x, why) => ok(x, n + ': ' + why);
let t = run('normal', { profession: 'farmer' }); ok(t.opened === 1 && t.talked === 1 && !t.sounds.length, 'normal villager opens trades, counts stat, silent');
t = run('baby', { isBaby: true, baby: true });
ok(!t.opened && t.sounds[0] === 'entity.villager.no' && t.e.headRollingTimeLeft === 40 && t.talked === 0, 'baby: no screen, sayNo, no stat');
t = run('sleep', { vbSleeping: true }); ok(!t.opened && !t.sounds.length && t.talked === 0, 'sleeping: no screen, silent');
t = run('busy', { customer: {} }); ok(!t.opened && !t.sounds.length, 'busy: no screen');
M.Trade.ensure = () => [];
t = run('nitwit', {}); ok(!t.opened && t.sounds[0] === 'entity.villager.no' && t.e.headRollingTimeLeft === 40 && t.talked === 1, 'offerless: sayNo, stat counted');
M.Trade.ensure = ens;

// anti-vacuity: break each gate by removing its trigger and see the result flip
t = run('b1', { isBaby: false, baby: false, profession: 'farmer' }); okAv(t.opened === 1 && !t.sounds.length, 'a non-baby no longer says no');
t = run('b2', { vbSleeping: false, profession: 'farmer' }); okAv(t.opened === 1, 'a woken villager opens trades');
t = run('b3', { customer: null, profession: 'farmer' }); okAv(t.opened === 1, 'a freed villager opens trades');
M.Trade.ensure = () => []; t = run('b4', {}); okAv(t.sounds.length === 1, 'offerless says no'); M.Trade.ensure = ens;

if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); console.log('FAIL ' + fails.length); process.exit(1); }
console.log(`\n${pass} checks passed, ${fails.length} failures (${breaks} breaks caught)`);
