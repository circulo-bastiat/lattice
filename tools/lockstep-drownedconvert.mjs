#!/usr/bin/env node
// lockstep-drownedconvert -- #8639 (G18b-L30): lockstep scenario drownedconvert, 20 salts.
// Reference = ZombieEntity.tick (.decomp): converting -> ticksUntilWaterConversion-- , <0 -> convertInWater; else submerged -> inWaterTime++,
// >=600 -> setTicksUntilWaterConversion(300); else inWaterTime = -1. MobEntity.convertTo: fresh full-health entity, baby flag, custom name,
// persistence, equipment copied with its drop chances. Husk converts to zombie (HuskEntity.convertInWater), zombie to drowned.
// Engine quirk kept: the first tick of a fresh mob sees "not submerged" (submerged state is refreshed in baseTick, after tick()).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const M = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '07y_equip.js', '07zk_undead.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init();
const EL = M.EntityList, U = M.Undead, IT = M.Items;
M.Sound = Object.assign(M.Sound || {}, { entitySound: () => {} });
EL.random = (() => { const j = new M.JRandom(5), r = () => j.nextDouble(); r.nextDouble = r; return r; })();
const TICKS = 1200;
let wet = true;
U.isSubmergedInWater = () => wet;
const kinds = ['zombie', 'husk', 'zombie'];

// vanilla state machine, returns { convertAt, log of [inWaterTime, countdown] }
function reference(leaveAt) {
  let inW = 0, cd = null, convertAt = -1; const log = [];
  for (let t = 0; t < TICKS; t++) {
    const sub = t < leaveAt && t > 0;   // t == 0: first tick sees not submerged
    if (cd !== null) { cd--; if (cd < 0) { convertAt = t; log.push([inW, cd]); break; } }
    else if (sub) { inW++; if (inW >= U.REF_SUBMERGE) cd = U.REF_COUNT; }
    else inW = -1;
    log.push([inW, cd]);
  }
  return { convertAt, log };
}
function engine(salt, leaveAt) {
  const kind = kinds[salt % 3], baby = salt % 3 === 2;
  const e = EL.spawn(kind, 3.5, 10, 4.5);
  const helm = 'iron_helmet', hand = salt % 2 ? 'iron_sword' : 'stone_axe';
  e.equip = []; e.equipDropChance = [0.085, 0.085, 0.085, 0.085, 0.085, 0.085];
  e.equip[IT.MAINHAND] = { i: IT.id[hand], c: 1 }; e.equip[IT.HEAD] = { i: IT.id[helm], c: 1 };
  e.equipDropChance[IT.MAINHAND] = 0.5 + salt / 100;
  e.growAge = baby ? -24000 : 0;
  if (salt % 4 === 0) { e.customName = 'Z' + salt; e.customNameVisible = true; }
  if (salt % 5 === 0) e.persistent = true;
  e.health = 7;
  const log = []; let fresh = null, convertAt = -1;
  for (let t = 0; t < TICKS && !fresh; t++) {
    wet = t < leaveAt;
    U.tickWaterConversion(e);
    log.push([e.waterConvertTime || 0, e.convertCountdown === undefined ? null : e.convertCountdown]);
    if (e.removed) { convertAt = t; fresh = EL.list ? EL.list.find((x) => x !== e && !x.removed) : null; }
  }
  return { log, convertAt, kind, baby, fresh, e, hand, helm };
}
let fails = 0;
function run() {
  let bad = null, converted = 0, kept = 0;
  for (let s = 0; s < 21 && !bad; s++) {
    const leaveAt = s === 20 ? 500 : TICKS + 1;
    EL.clear();
    const g = engine(s, leaveAt), ref = reference(leaveAt);
    if (g.convertAt !== ref.convertAt) { bad = `salt ${s}: converted at ${g.convertAt}, vanilla ${ref.convertAt}`; break; }
    if (s === 20) { if (g.e.removed || g.e.convertCountdown != null) bad = 'salt 20: left the water but still converting'; kept++; continue; }
    for (let t = 0; t < g.log.length - 1; t++) {
      const a = g.log[t], b = ref.log[t];
      if (a[0] !== b[0] || a[1] !== b[1]) { bad = `salt ${s} tick ${t}: engine ${a} != vanilla ${b}`; break; }
    }
    if (bad) break;
    const f = g.fresh; converted++;
    const want = g.kind === 'husk' ? 'zombie' : 'drowned';
    if (!f || f.type !== want) { bad = `salt ${s}: spawned ${f && f.type}, want ${want}`; break; }
    if (((f.growAge | 0) < 0) !== g.baby) bad = `salt ${s}: baby flag`;
    else if (f.customName !== g.e.customName) bad = `salt ${s}: custom name`;
    else if (!!f.persistent !== !!g.e.persistent) bad = `salt ${s}: persistence`;
    else if (f.health !== f.maxHealth && f.health !== undefined && f.maxHealth !== undefined) bad = `salt ${s}: health ${f.health} not fresh ${f.maxHealth}`;
    else if (f.x !== 3.5 || f.y !== 10 || f.z !== 4.5) bad = `salt ${s}: position`;
    else if (!f.equip[IT.MAINHAND] || f.equip[IT.MAINHAND].i !== IT.id[g.hand] || !f.equip[IT.HEAD] || f.equip[IT.HEAD].i !== IT.id[g.helm]) bad = `salt ${s}: equipment`;
    else if (f.equipDropChance[IT.MAINHAND] !== 0.5 + s / 100) bad = `salt ${s}: handDropChance`;
  }
  return { bad, converted, kept };
}
U.REF_SUBMERGE = 600; U.REF_COUNT = 300;
const base = run();
if (base.bad) { fails++; console.log('  FAIL ' + base.bad); }
if (!base.converted || !base.kept) { fails++; console.log('  FAIL vacuous'); }
let breaks = 0;
const mut = (name, k, v) => {
  const old = U[k]; U[k] = v; const r = run(); U[k] = old;
  if (r.bad) { breaks++; console.log('   ✓ break caught: ' + name); } else { fails++; console.log('  ✗ break NOT caught: ' + name); }
};
mut('conversion countdown 300 -> 200', 'WATER_CONVERT_COUNTDOWN_TICKS', 200);
mut('submerge threshold 600 -> 500', 'WATER_SUBMERGE_TICKS', 500);
console.log(`lockstep-drownedconvert: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${base.converted} conversions, ${base.kept} water-leave)`);
process.exit(fails ? 1 : 0);
