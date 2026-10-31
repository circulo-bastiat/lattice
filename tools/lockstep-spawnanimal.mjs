#!/usr/bin/env node
// lockstep-spawnanimal -- #8648 (G18c-L12): lockstep lane 'spawnanimal', 20 salts x 5x5 grids of candidate positions. Floors grass_block, dirt, sand, snow, mycelium,
// ice, packed_ice, leaves, lava, clay (+ the other tag members: snow_block, podzol, coarse_dirt, stone, gravel, oak_log) at light 4, 8, 9 and 15, y just below and just
// above sea level. Spawn.RULES.<species> against an oracle written from .decomp AnimalEntity.isValidNaturalSpawn (floor in animals_spawnable_on && getBaseLightLevel > 8),
// Rabbit/Fox/Goat/Mooshroom/Parrot/Wolf.canSpawn (own floor tag + the same light), PolarBearEntity.canSpawn (frozen_ocean/deep_frozen_ocean: light + ice; else the animal rule),
// OcelotEntity.canSpawn (nextInt(3) != 0, identical random streams) and StriderEntity.canSpawn (climb the lava column, the cell above must be air). Tag members are the
// 1.18.2 data pack's block tags, typed here independently of assets/tags.bin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let bad = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL ' + m); } };

const EXTRA = ['14h_brigadier.js', '15g_commands.js', '02f_tags.js', '02g_items.js', '02i_text.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
  '14j_combat.js', '07za_explosion.js', '03b_noise.js', '07zd_slime.js', '07q_effects.js', '14f_inventory.js', '07zw_mobnbt.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Text.init({ lang: b64('lang.bin'), langBytes: rdj('lang.meta.json').rawBytes, langOverrides: readFileSync(join(ASSETS, 'lang-overrides.json'), 'utf8') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
const EL = M.EntityList, Spawn = M.Spawn, W = M.World, S = M.States;
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; EL.init(); M.Ai.init(); Spawn.init();

const stream = (salt) => { let s = (salt * 2654435761 + 8648) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const FLOORS = ['grass_block', 'dirt', 'sand', 'snow', 'mycelium', 'ice', 'packed_ice', 'oak_leaves', 'lava', 'clay',
  'snow_block', 'podzol', 'coarse_dirt', 'stone', 'gravel', 'oak_log'];
const LIGHTS = [4, 8, 9, 15], BIOMES = ['plains', 'frozen_ocean', 'deep_frozen_ocean', 'frozen_river', 'jungle'];
// 1.18.2 block tags (data/minecraft/tags/blocks)
const LEAVES = ['oak_leaves'], LOGS = ['oak_log'];
const TAG = {
  animal: ['grass_block'], rabbit: ['grass_block', 'snow', 'snow_block', 'sand'], fox: ['grass_block', 'snow', 'snow_block', 'podzol', 'coarse_dirt'],
  goat: ['stone', 'snow', 'snow_block', 'packed_ice', 'gravel'], mooshroom: ['mycelium'], parrot: ['grass_block', ...LEAVES, ...LOGS],
  wolf: ['grass_block', 'snow', 'snow_block'], bearIce: ['ice'],
};
const ST = Object.fromEntries([...FLOORS, 'air', 'cave_air', 'lava'].map((f) => [f, S.stateOf(f)]));
let cell = null;
W.getBlock = (x, y, z) => {
  const c = cell; if (!c || x !== c.x || z !== c.z) return 0;
  if (y === c.y - 1) return ST[c.floor];
  if (y >= c.y && y <= c.y + c.lava) return ST.lava;
  if (y === c.y + c.lava + 1) return ST[c.cap];
  return 0;
};
W.getLight = () => (cell.sky << 4) | cell.blk;
W.biomeAt = () => 0;
M.Biomes = { ready: true, at: () => ({ name: cell.biome }), name: () => 'minecraft:' + cell.biome };

const animalLight = (rawBase) => rawBase > 8;
const oracle = (sp, c, f) => {
  const light = Math.max(c.sky, c.blk) > 8, fl = c.floor, inT = (t) => TAG[t].includes(fl);
  switch (sp) {
    case 'cow': case 'sheep': case 'pig': case 'chicken': case 'panda': case 'cat': case 'horse': case 'donkey': case 'llama':
      return inT('animal') && light;
    case 'rabbit': case 'fox': case 'goat': case 'mooshroom': case 'parrot': case 'wolf': return inT(sp) && light;
    case 'polar_bear':
      return (c.biome === 'frozen_ocean' || c.biome === 'deep_frozen_ocean') ? light && inT('bearIce') : inT('animal') && light;
    case 'ocelot': return f(3) !== 0;
    case 'strider': return c.cap === 'air' || c.cap === 'cave_air';
  }
};
const SPECIES = ['cow', 'sheep', 'pig', 'chicken', 'panda', 'cat', 'horse', 'donkey', 'llama', 'rabbit', 'fox', 'goat', 'mooshroom', 'parrot', 'wolf', 'polar_bear', 'ocelot', 'strider'];

function run(salt) {
  const ra = stream(salt + 500), rb = stream(salt + 500), pick = stream(salt), out = { div: '', yes: {}, no: {} };
  const ria = (k) => Math.floor(ra() * k), rib = (k) => Math.floor(rb() * k);
  for (let i = 0; i < 25 && !out.div; i++) {
    const L = LIGHTS[Math.floor(pick() * 4)], lava = Math.floor(pick() * 3);
    cell = { x: 100 + (i % 5), z: 100 + Math.floor(i / 5), y: pick() < 0.5 ? 62 : 64, floor: FLOORS[Math.floor(pick() * FLOORS.length)],
      sky: pick() < 0.5 ? L : 0, blk: 0, biome: BIOMES[Math.floor(pick() * 5)], lava, cap: ['air', 'cave_air', 'stone'][Math.floor(pick() * 3)] };
    if (!cell.sky) cell.blk = L;
    for (const sp of SPECIES) {
      const got = !!Spawn.RULES[sp](cell.x, cell.y, cell.z, 'natural', ria), want = !!oracle(sp, cell, rib);
      if (got !== want || ra() !== rb()) { out.div = `salt ${salt} #${i} ${sp} on ${cell.floor} light ${L} ${cell.biome} cap ${cell.cap}/${cell.lava} engine ${got} vanilla ${want}`; break; }
      out.yes[sp] = (out.yes[sp] || 0) + (got ? 1 : 0); out.no[sp] = (out.no[sp] || 0) + (got ? 0 : 1);
    }
  }
  return out;
}
const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
ok(div.length === 0, 'divergences: ' + div[0]);
for (const sp of SPECIES) {
  const y = runs.reduce((a, r) => a + (r.yes[sp] || 0), 0), no = runs.reduce((a, r) => a + (r.no[sp] || 0), 0);
  ok(y > 3 && no > 3, `lane vacuous for ${sp}: ${y} yes / ${no} no`);
}
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0, tries = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); tries++; n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
const orb = W.rawBrightness;
tryBreak('animal light floor 9 -> 8', () => { W.rawBrightness = (x, y, z) => orb(x, y, z) + 1; }, () => { W.rawBrightness = orb; });
const ots = W.tagBelow;
tryBreak('mycelium dropped from mooshroom tag', () => { W.tagBelow = (t, s) => (t === 'mooshrooms_spawnable_on' && s === ST.mycelium) ? 0 : ots(t, s); }, () => { W.tagBelow = ots; });
tryBreak('ice allowed for plains polar bear', () => { W.tagBelow = (t, s) => (t === 'animals_spawnable_on' && s === ST.ice) ? 1 : ots(t, s); }, () => { W.tagBelow = ots; });
const oo = Spawn.RULES.ocelot;
tryBreak('ocelot always spawns', () => { Spawn.RULES.ocelot = () => true; }, () => { Spawn.RULES.ocelot = oo; });
const os = Spawn.RULES.strider;
tryBreak('strider ignores the lava column', () => { Spawn.RULES.strider = (x, y, z) => W.getBlock(x, y + 1, z) === 0; }, () => { Spawn.RULES.strider = os; });
console.log(`${n} assertions, spawnanimal: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === tries ? 0 : 1);
