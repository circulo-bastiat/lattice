#!/usr/bin/env node
// lockstep-zombieinfect -- #8641 (G18b-L32): lockstep scenario zombieinfect, 20 salts x 200 trials x 3 difficulties.
// Reference = ZombieEntity.onKilledOther (.decomp:404-421): EASY/PEACEFUL never convert; NORMAL converts iff random.nextBoolean(); HARD always.
// The zombie villager carries VillagerData (type+profession+level), Offers, Xp, Gossips, position, baby flag, name and persistence (.decomp:411-418).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
  '07o_profession.js', '07ox_enchhelper.js', '07p_trade.js', '07zk_undead.js', '07s_raid.js', '07q_effects.js',
  '07zr_zvillager.js', '07j_entityrender.js', '07zw_mobnbt.js'], dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const EL = M.EntityList, Zv = M.ZVillager;
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
M.World.init(1); M.Behave.init(M.World); EL.init(); M.Ai.init(); M.Spawn.init(); M.Profession.init(); M.Village.init(); M.Breed.init();
M.Sound = Object.assign(M.Sound || {}, { play: () => {} });

const PROFS = ['farmer', 'librarian', 'cleric', 'smith_dummy', 'none'];
const TYPES = ['plains', 'desert', 'snow', 'swamp', 'taiga'];
const DIFFS = ['easy', 'normal', 'hard'];
const TRIALS = 200;

function run() {
  let bad = null, conv = 0, kept = 0;
  for (let salt = 0; salt < 20 && !bad; salt++) for (const d of DIFFS) {
    const j = new M.JRandom(salt * 31 + 7);
    const rand = () => (j.nextBoolean() ? 0.9 : 0.1);   // vanilla nextBoolean; the engine skips on rand() < 0.5
    const ref = new M.JRandom(salt * 31 + 7);
    for (let t = 0; t < TRIALS && !bad; t++) {
      EL.clear();
      const x = 2.5 + t % 7, z = 3.5 + (t >> 3) % 7;
      const v = EL.spawn('villager', x, 10, z, { profession: PROFS[(salt + t) % PROFS.length], villagerType: TYPES[t % TYPES.length] });
      v.villagerLevel = 1 + (t % 5); v.tradeXp = salt * 10 + t; v.health = 1;
      v.tradeOffers = [{ buy: 'wheat', n: t }]; v.tradeUses = [t % 4];
      v.gossip = { a: { major_positive: salt, minor_positive: t } };
      const baby = t % 3 === 0; v.growAge = baby ? -24000 : 0;
      if (t % 4 === 0) { v.customName = 'V' + t; v.customNameVisible = true; }
      if (t % 5 === 0) v.persistent = true;
      const want = d === 'hard' ? true : d === 'normal' ? ref.nextBoolean() : false;
      const zv = Zv.convertVillagerToZombie(v, d, rand);
      if (!!zv !== want) { bad = `salt ${salt} ${d} trial ${t}: converted=${!!zv}, vanilla ${want}`; break; }
      if (!want) { if (v.removed) bad = `salt ${salt} ${d} trial ${t}: villager removed without conversion`; kept++; continue; }
      conv++;
      if (zv.type !== 'zombie_villager') bad = `type ${zv.type}`;
      else if (!v.removed) bad = `salt ${salt} ${d} trial ${t}: villager not removed`;
      else if (zv.profession !== v.profession || zv.villagerType !== v.villagerType || zv.villagerLevel !== v.villagerLevel) bad = `salt ${salt} ${d} trial ${t}: VillagerData`;
      else if (JSON.stringify(zv.tradeOffers) !== JSON.stringify(v.tradeOffers) || JSON.stringify(zv.tradeUses) !== JSON.stringify(v.tradeUses)) bad = `salt ${salt} ${d} trial ${t}: Offers`;
      else if (zv.tradeXp !== v.tradeXp) bad = `salt ${salt} ${d} trial ${t}: Xp`;
      else if (JSON.stringify(zv.gossip) !== JSON.stringify(v.gossip)) bad = `salt ${salt} ${d} trial ${t}: Gossips`;
      else if (zv.x !== x || zv.y !== 10 || zv.z !== z) bad = `salt ${salt} ${d} trial ${t}: position`;
      else if (zv.brain) bad = `salt ${salt} ${d} trial ${t}: zombie villager has a Brain`;
      else if (((zv.growAge | 0) < 0) !== baby) bad = `salt ${salt} ${d} trial ${t}: baby flag`;
      else if (zv.customName !== v.customName) bad = `salt ${salt} ${d} trial ${t}: custom name`;
      else if (!!zv.persistent !== !!v.persistent) bad = `salt ${salt} ${d} trial ${t}: persistence`;
      else if (zv.health !== zv.maxHealth) bad = `salt ${salt} ${d} trial ${t}: health not fresh`;
    }
  }
  return { bad, conv, kept };
}
let fails = 0;
const base = run();
if (base.bad) { fails++; console.log('  FAIL ' + base.bad); }
if (!base.conv || !base.kept) { fails++; console.log('  FAIL vacuous'); }
let breaks = 0;
const mut = (name, fn) => { const undo = fn(); const r = run(); undo(); if (r.bad) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); } };
mut('NORMAL always converts', () => { const o = Zv.shouldConvertOnKill; Zv.shouldConvertOnKill = (d, r) => d !== 'easy' && d !== 'peaceful'; return () => { Zv.shouldConvertOnKill = o; }; });
mut('EASY converts', () => { const o = Zv.shouldConvertOnKill; Zv.shouldConvertOnKill = (d, r) => o(d === 'easy' ? 'hard' : d, r); return () => { Zv.shouldConvertOnKill = o; }; });
mut('dataFromVillager drops xp', () => { const o = Zv.dataFromVillager; Zv.dataFromVillager = (v) => Object.assign(o(v), { tradeXp: 0 }); return () => { Zv.dataFromVillager = o; }; });
console.log(`lockstep-zombieinfect: ${fails} failures, ${breaks} breaks caught (${base.conv} conv, ${base.kept} none)`);
process.exit(fails ? 1 : 0);
