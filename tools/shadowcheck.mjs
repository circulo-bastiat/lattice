#!/usr/bin/env node
// shadowcheck.mjs — G18a-SD1 (#6739): entity shadow radius table + fade (EntityRenderDispatcher.renderShadow).
// Radii are read from the .decomp renderer sources (`super(ctx, model, R)` / `this.shadowRadius = R`), not typed here.
// Anti-vacuity: a forged radius for one mob must fail its row.
import fs from 'node:fs';
import { loadEngine } from './loadsrc.mjs';
console.log('shadowcheck — G18a-SD1, entity shadow radii + fade');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07h_entities.js', '07i_entitylist.js', '07j_entityrender.js'], initReg: false });
M.EntityRender.init();
const ER = M.EntityRender;
const D = '.decomp/net/minecraft/client/render/entity/';
const f = (n) => fs.readFileSync(D + n + 'EntityRenderer.java', 'utf8');
// ctor float of the first `super(` that ends in `, N F)` (MobEntityRenderer radius), else `this.shadowRadius = N F`
function jar(n) {
  const s = f(n);
  let m = /super\([^;]*?,\s*([0-9.]+)F\s*(?:,\s*[0-9.]+F\s*)*\);/.exec(s);
  if (m) return +m[1];
  m = /this\.shadowRadius = ([0-9.]+)F/.exec(s);
  return m ? +m[1] : null;
}
const ROWS = { cow: 'Cow', pig: 'Pig', sheep: 'Sheep', chicken: 'Chicken', creeper: 'Creeper', ghast: 'Ghast', wolf: 'Wolf', cat: 'Cat',
  ocelot: 'Ocelot', panda: 'Panda', polar_bear: 'PolarBear', ravager: 'Ravager', spider: 'Spider', bat: 'Bat', blaze: 'Blaze',
  enderman: 'Enderman', endermite: 'Endermite', vex: 'Vex', wither: 'Wither', phantom: 'Phantom', fox: 'Fox', bee: 'Bee',
  rabbit: 'Rabbit', parrot: 'Parrot', axolotl: 'Axolotl', salmon: 'Salmon', cod: 'Cod', dolphin: 'Dolphin', goat: 'Goat',
  hoglin: 'Hoglin', zoglin: 'Zoglin', iron_golem: 'IronGolem', snow_golem: 'SnowGolem', witch: 'Witch', silverfish: 'Silverfish',
  squid: 'Squid', turtle: 'Turtle', villager: 'Villager', wandering_trader: 'WanderingTrader', vindicator: 'Vindicator',
  pillager: 'Pillager', evoker: 'Evoker', illusioner: 'Illusioner', skeleton: 'Skeleton', zombie: 'ZombieBase', player: 'Player',
  horse: 'HorseBase', minecart: 'Minecart', boat: 'Boat', falling_block: 'FallingBlock', tnt: 'Tnt', end_crystal: 'EndCrystal',
  ender_dragon: 'EnderDragon', item: 'Item', experience_orb: 'ExperienceOrb', armor_stand: 'ArmorStand', shulker: 'Shulker',
  magma_cube: 'MagmaCube', tropical_fish: 'TropicalFish', llama: 'Llama', mooshroom: 'Mooshroom', pufferfish: 'Pufferfish' };
function run(tbl) {
  let bad = 0, n = 0;
  for (const [t, j] of Object.entries(ROWS)) {
    const want = jar(j); n++;
    if (want === null) { bad++; console.log(' no jar value for ' + t); continue; }
    if (Math.abs((tbl[t] ?? -1) - Math.fround(want)) > 1e-6) { bad++; console.log(' ' + t + ': ' + tbl[t] + ' != jar ' + want); }
  }
  return { bad, n };
}
const r = run(ER.SHADOW_RADIUS);
let bad = r.bad, n = r.n;
// special-cased radii and the fade
const eq = (a, b, w) => { n++; if (Math.abs(a - b) > 1e-6) { bad++; console.log(' ' + w + ': ' + a + ' != ' + b); } };
eq(ER.shadowRadiusOf({ type: 'slime', size: 4 }), 1, 'slime size 4');
eq(ER.shadowRadiusOf({ type: 'pufferfish', puffState: 2 }), 0.3, 'puffer 2');
eq(ER.shadowRadiusOf({ type: 'strider', baby: true }), 0.25, 'baby strider');
eq(ER.shadowRadiusOf({ type: 'giant' }), 3, 'giant');
eq(ER.shadowPartRadius(0.7, true), Math.fround(0.35), 'baby halved');
eq(ER.shadowOpacity(0), 1, 'opacity d=0'); eq(ER.shadowOpacity(64), 0.75, 'opacity d=8'); eq(ER.shadowOpacity(128), 0.5, 'opacity d=sqrt128');
eq(ER.shadowPartAlpha(1, 64, 64, 1), 0.5, 'alpha at feet, full light');
eq(ER.shadowPartAlpha(0.75, 64.5, 64, 0.5), Math.fround((0.75 - 0.25) * 0.5 * 0.5), 'alpha 0.5 up, half light');
n++; if (ER.shadowPartAlpha(0.1, 66, 64, 1) !== null) { bad++; console.log(' deep part must be null'); }
const forged = Object.assign({}, ER.SHADOW_RADIUS, { cow: 0.71 });
const fb = run(forged).bad;
console.log(' ✓ ' + (fb > 0 ? 1 : 0) + ' breaks caught (forged cow radius: ' + fb + ' rows fail)');
if (!fb) bad++;
console.log((bad ? 'FAIL' : 'PASS') + '  shadowcheck: ' + n + ' assertions, ' + bad + ' failures, 1 breaks caught');
process.exit(bad ? 1 : 0);
