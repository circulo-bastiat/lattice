#!/usr/bin/env node
// zombievillagercheck.mjs -- #2466. A villager killed by a zombie-family attacker through the REAL
// Combat.mobAttack -> Cb.hurt path becomes a zombie_villager (ZombieEntity.onKilledOther, .decomp:405-421).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('zombievillagercheck -- zombie kills villager -> zombie_villager');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
               '07m_breed.js', '07o_profession.js', '07ox_enchhelper.js', '07p_trade.js', '07zk_undead.js',
               '07q_effects.js', '07zr_zvillager.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Zv = MCL.ZVillager, Prof = MCL.Profession, Trade = MCL.Trade, Village = MCL.Village;
const W = MCL.World, S = MCL.States;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Prof.init();
Village.init();
MCL.Breed.init();   // loop/mob-test-passive: EL.spawn's zombie-family baby roll (07i_entitylist.js) calls
                    // NS.Breed.setBaby and every OTHER check tool that spawns via EL.spawn already does this;
                    // this one didn't, so zombie_villager's 5% baby roll ran Br.setBaby with Br unready.

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}


const Cb = MCL.Combat;
function trial(diff, rnd, attackerType) {
  MCL.Diff.value = diff; EL.random = () => rnd;
  const z = EL.spawn(attackerType, 10, 64, 10, {}), v = EL.spawn('villager', 11, 64, 10, {});
  const before = EL.list.filter((e) => e.type === 'zombie_villager' && !e.removed).length;
  v.health = 1; v.hurtTime = 0; v.invulnTicks = 0; z.attackDamage = 1000;
  for (let i = 0; i < 3 && !v.dead; i++) { Cb.mobAttack(z, v); }
  return { dead: !!v.dead, got: EL.list.filter((e) => e.type === 'zombie_villager' && !e.removed).length - before };
}
let r = trial('hard', 0, 'zombie');
ok(r.dead && r.got === 1, 'hard: zombie kill must yield a zombie_villager (dead=' + r.dead + ' got=' + r.got + ')');
r = trial('normal', 0.9, 'zombie'); ok(r.dead && r.got === 1, 'normal roll>=0.5 converts');
r = trial('normal', 0.1, 'zombie'); ok(r.dead && r.got === 0, 'normal roll<0.5 skips');
r = trial('easy', 0.9, 'zombie'); ok(r.dead && r.got === 0, 'easy: no conversion (anti-vacuity)');
r = trial('hard', 0, 'skeleton'); ok(r.dead && r.got === 0, 'non-zombie killer: no conversion');
// Silent flag (#4374): cure / converted / infect sounds follow the sounding entity's silent flag
const played = []; const op = MCL.Sound; MCL.Sound = { play: (n) => { played.push(n); } };
function sounds(silent, fn) { played.length = 0; fn(silent); return played.length; }
const mkZv = (s) => { const z = EL.spawn('zombie_villager', 5, 64, 5, {}); z.silent = s; return z; };
const io = (z) => { MCL.Effects.addStatusEffect(z, 'weakness', 200, 0); };
for (const s of [false, true]) {
  ok(sounds(s, () => { const z = mkZv(s); io(z); MCL.ZVillager.interact({ uuid: 'u' }, z, 'golden_apple', () => 0.5); }) === (s ? 0 : 1), 'cure sound vs silent=' + s);
  ok(sounds(s, () => { const z = mkZv(s); z.converting = true; z.conversionTimer = 0; z.converterId = null; MCL.ZVillager.finishConversion(z); }) === (s ? 0 : 1), 'converted sound vs silent=' + s);
  ok(sounds(s, () => { const k = EL.spawn('zombie', 9, 64, 9, {}); k.silent = s; const v = EL.spawn('villager', 11, 64, 10, {}); MCL.ZVillager.convertVillagerToZombie(v, 'hard', () => 0, k); }) === (s ? 0 : 1), 'infect sound vs killer silent=' + s);
}
MCL.Sound = op;
// break the hook: the check must notice
let breaks = 0;
const orig = MCL.ZVillager.convertVillagerToZombie;
MCL.ZVillager.convertVillagerToZombie = () => null;
r = trial('hard', 0, 'zombie');
if (r.got === 0) { breaks++; console.log(' ✓ stubbed conversion: noticed'); } else fails.push('anti-vacuity: stubbed conversion unnoticed');
MCL.ZVillager.convertVillagerToZombie = orig;
if (fails.length) { console.log('FAIL:'); fails.forEach((f) => console.log(' x ' + f)); }
console.log('\nzombievillagercheck: ' + pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length ? 1 : 0);
