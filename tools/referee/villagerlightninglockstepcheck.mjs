// villagerlightninglockstepcheck.mjs -- #7947 (G18f-L10): lockstep scenario 'villagerlightning': 20 salts x difficulty (peaceful|easy|normal|hard) x (adult | baby | bed+job site, custom name, NoAI) strike a villager. Reference = .decomp VillagerEntity.onStruckByLightning (non-Peaceful: a fresh witch at the villager's position/angles, NoAI + custom name carried, persistent, villager discarded; NOT baby, health/equipment NOT carried: create+initialize, not convertTo) else Entity.onStruckByLightning (fire 8s = 160 ticks, 5 damage).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07y_equip.js', '07m_breed.js', '07zn_mooshroom.js', '07l_spawn.js', '09b_sky.js', '14j_combat.js', '07s_raid.js', '07zzc_lightning.js'],
  dom: false
});
initRegistry(M);
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Equip.init();
const EL = M.EntityList, Lgt = M.Lightning;
const CELLS = new Map();
M.World = { getBlock: (x, y, z) => CELLS.get(x + ',' + y + ',' + z) || 0, setBlock: (x, y, z, s) => { CELLS.set(x + ',' + y + ',' + z, s); return true; }, get: () => null, heightAt: () => 63, biomeAt: () => 1, chunks: new Map(), tickingAt: () => true };
M.CH = { GENERATED: 2 };
M.Behave.init(M.World);
M.Commands = { rules: {}, ruleGet(n) { return (n in this.rules) ? this.rules[n] : 'true'; } };
M.Diff = { value: 'normal', get() { return this.value; } };
M.Sky = { weather: { raining: true, thundering: true, rainLevel: 1, thunderLevel: 1 }, newWeather() { return this.weather; }, isThundering() { return true; }, isRainingAt() { return true; } };
let fails = 0, breaks = 0, cells = 0, conv = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const bolt = EL.spawn('lightning_bolt', 0, 64, 0, {});
function lane(salt) {
  const r = stream(salt), out = [];
  for (const diff of ['peaceful', 'easy', 'normal', 'hard']) for (const kind of ['adult', 'baby', 'bedjob']) {
    M.Diff.value = diff;
    const x = 100 + salt * 8 + (kind === 'baby' ? 2 : kind === 'bedjob' ? 4 : 0), z = 100 + ['peaceful', 'easy', 'normal', 'hard'].indexOf(diff) * 8;
    const v = EL.spawn('villager', x, 64, z, {});
    v.yaw = r() * 360; v.pitch = r() * 30;
    if (kind === 'baby') { v.isBaby = true; v.growAge = -24000; }
    if (kind === 'bedjob') { v.home = { x: x + 1, y: 64, z }; v.jobSite = { x, y: 64, z: z + 1 }; }
    const named = r() < 0.5, noai = r() < 0.5, name = 'v' + salt;
    if (named) { v.customName = name; v.customNameVisible = r() < 0.5; }
    if (noai) v.aiDisabled = true;
    const hp = v.health, vis = v.customNameVisible, yaw = v.yaw, pitch = v.pitch, id = v.id;
    Lgt.onStruckByLightning(v, bolt);
    cells++;
    const tag = 'salt ' + salt + ' ' + diff + ' ' + kind + ': ';
    const witches = EL.list.filter((e) => e.type === 'witch' && !e.removed && e.x === x && e.z === z);
    if (diff === 'peaceful') {
      if (v.removed || witches.length) out.push(tag + 'peaceful converted');
      if (v.health !== hp - 5) out.push(tag + 'peaceful health ' + v.health + ' want ' + (hp - 5));
      if (v.remainingFireTicks !== 160) out.push(tag + 'peaceful fire ' + v.remainingFireTicks + ' want 160');
    } else {
      conv++;
      const w = witches[0];
      if (!v.removed) out.push(tag + 'villager not discarded');
      if (witches.length !== 1) { out.push(tag + witches.length + ' witches'); continue; }
      if (w.isBaby) out.push(tag + 'witch is baby');
      if (w.yaw !== yaw || w.pitch !== pitch) out.push(tag + 'angles not carried');
      if (!w.persistent) out.push(tag + 'witch not persistent');
      if (!!w.aiDisabled !== noai) out.push(tag + 'NoAI not carried');
      if (named && (w.customName !== name || w.customNameVisible !== vis)) out.push(tag + 'name not carried');
      if (!named && w.customName !== undefined) out.push(tag + 'phantom name');
      if (w.health !== w.maxHealth && w.maxHealth !== undefined && w.health !== 26) out.push(tag + 'witch not at fresh health ' + w.health);
      if (w.remainingFireTicks > 0 || v.health !== hp) out.push(tag + 'fire/damage applied on conversion');
    }
    if (witches[0]) witches[0].removed = true;
  }
  return out;
}
const pass = () => Array.from({ length: 20 }, (_, i) => i).flatMap(lane);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(cells === 240 && conv === 180, 'lane covers ' + cells + ' cells, ' + conv + ' conversions');
const real = Lgt.convertVillager;
const oS = Lgt.onStruckByLightning;
Lgt.onStruckByLightning = (e, b) => { if (e.type === 'villager' && M.Diff.value === 'peaceful') { Lgt.convertVillager(e); return; } oS(e, b); };
brk(pass().length > 0, 'PEACEFUL converting caught');
Lgt.onStruckByLightning = oS;
Lgt.convertVillager = function (e) { real(e); const w = EL.list.filter((q) => q.type === 'witch' && !q.removed && q.x === e.x && q.z === e.z)[0]; if (w) w.persistent = false; };
brk(pass().length > 0, 'non-persistent witch caught');
Lgt.convertVillager = function (e) { real(e); const w = EL.list.filter((q) => q.type === 'witch' && !q.removed && q.x === e.x && q.z === e.z)[0]; if (w && e.isBaby) w.isBaby = true; };
brk(pass().length > 0, 'baby carried into witch caught');
Lgt.convertVillager = function (e) { real(e); e.removed = false; };
brk(pass().length > 0, 'villager not discarded caught');
Lgt.convertVillager = real;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerlightninglockstepcheck: ${3 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
