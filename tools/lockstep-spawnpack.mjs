#!/usr/bin/env node
// lockstep-spawnpack -- #7941 (G18c-L6): lockstep lane 'spawnpack'. 7 biomes (plains, forest, taiga, desert, swamp, ocean, dripstone caves) x 200 forced
// cycles per salt x 20 salts: Spawn.spawnForChunk vs an oracle re-derived from .decomp SpawnHelper.spawnEntitiesInChunk on identical random streams: pack
// size (minGroupSize + nextInt(1+max-min)), the 3-try loop with the nextInt(6)-nextInt(6) walk, the 24-block/576 distance gates, the per-type cap check after
// each member and the stop at maxCount. Compares every placed mob (type, x, z) and the final stream state. Anti-vacuity: wolf max pack 4 -> 5 etc.
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
const EL = M.EntityList, Spawn = M.Spawn, W = M.World;
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; EL.init(); M.Ai.init(); Spawn.init();

const E = (type, weight, minCount, maxCount) => ({ type, weight, minCount, maxCount });
const TABLE = {
  plains: { creature: [E('sheep', 12, 2, 4), E('pig', 10, 2, 4), E('chicken', 10, 4, 4), E('cow', 8, 2, 4), E('horse', 5, 2, 6), E('donkey', 1, 1, 3)] },
  forest: { creature: [E('sheep', 12, 2, 4), E('pig', 10, 2, 4), E('chicken', 10, 4, 4), E('cow', 8, 2, 4), E('wolf', 5, 4, 4)] },
  taiga: { creature: [E('sheep', 12, 2, 3), E('pig', 10, 1, 4), E('chicken', 10, 2, 4), E('cow', 8, 2, 4), E('wolf', 8, 4, 4), E('fox', 8, 2, 4)] },
  desert: { creature: [E('rabbit', 4, 2, 3)] },
  swamp: { creature: [E('sheep', 12, 2, 3), E('pig', 10, 1, 3), E('chicken', 10, 2, 4), E('cow', 8, 1, 3)] },
  ocean: { water_creature: [E('squid', 10, 1, 4), E('dolphin', 1, 1, 2)], water_ambient: [E('cod', 10, 3, 6)] },
  dripstone: { monster: [E('zombie', 95, 4, 4), E('skeleton', 100, 4, 4), E('creeper', 100, 4, 4), E('spider', 100, 4, 4)] }
};
const CATS = { plains: 'creature', forest: 'creature', taiga: 'creature', desert: 'creature', swamp: 'creature', ocean: 'water_creature', dripstone: 'monster' };
const NAMES = Object.keys(TABLE);
const LIMIT = (t) => ({ wolf: 8, cod: 8, salmon: 5, horse: 6, donkey: 6 }[t] || 4);
const SEED = 99;
const stream = (salt) => { let s = (salt * 2654435761 + 7) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

let cur = 'plains', placed = [];
W.heightAt = () => 62; W.biomeAt = () => 0; W.loadedAt = () => true; W.tickingAt = () => true; W.getBlock = () => 0; W.border = null;
M.Biomes = { ready: true, name: () => 'minecraft:' + cur, spawners: () => TABLE[cur] };
M.Structures = null;
Spawn.worldSpawn = () => ({ x: 1000, y: 64, z: 1000 });
Spawn.checkPlacement = () => true; Spawn.canPlace = () => true; Spawn.spawnDensity = () => null;
Spawn.spawnableFarFromPlayer = () => true; Spawn.canImmediatelyDespawn = () => false;
EL.canSpawn = () => true;
EL.spawn = (type, x, y, z) => { placed.push(type + '@' + (x - 0.5) + ',' + (z - 0.5)); return { type, x, y, z }; };
const baseEntries = {};

function oracle(table, cat, px, py, pz, cx, cz, rnd, rf) {
  const out = [];
  const sx = (cx << 4) + rnd(16), sz = (cz << 4) + rnd(16);
  const top = 62 + 2, sy = rnd(top + 64 + 1) - 64;
  if (sy < -63) return out;
  let made = 0;
  for (let j = 0; j < 3; j++) {
    let x = sx, z = sz, entry = null, cnt = Math.ceil(Math.fround(rf() * 4));
    for (let k = 0; k < cnt; k++) {
      x += rnd(6) - rnd(6); z += rnd(6) - rnd(6);
      const d2 = (px - (x + 0.5)) ** 2 + (py - sy) ** 2 + (pz - (z + 0.5)) ** 2;
      if (d2 <= 576) continue;
      if (!entry) {
        const list = table[cat]; let tot = 0; for (const e of list) tot += e.weight;
        let r = rnd(tot); for (const e of list) { r -= e.weight; if (r < 0) { entry = e; break; } }
        cnt = entry.minCount + rnd(1 + entry.maxCount - entry.minCount);
      }
      rf();
      out.push(entry.type + '@' + x + ',' + z); made++;
      if (made >= LIMIT(entry.type)) return out;
    }
  }
  return out;
}

function run(salt) {
  const ra = stream(salt), rb = stream(salt), out = { div: '', mobs: 0, max: 0 };
  EL.wr = ra;
  const ria = (k) => Math.floor(ra() * k), rib = (k) => Math.floor(rb() * k);
  Spawn.randInt = ria;
  const rng = { nextInt: ria, nextFloat: ra };
  const pick = stream(salt + 1000);
  for (let i = 0; i < 1400 && !out.div; i++) {
    cur = NAMES[i % NAMES.length]; const cat = CATS[cur];
    M.Player = { x: Math.floor(pick() * 40) - 20 + 0.5, y: 62, z: Math.floor(pick() * 40) - 20 + 0.5 };
    placed = [];
    Spawn.spawnForChunk(0, 0, cat, { rng, info: { counts: {}, field: { calculate: () => 0, addPoint() {} }, chunkCount: 1 } });
    const want = oracle(baseEntries.t[cur], cat, M.Player.x, M.Player.y, M.Player.z, 0, 0, rib, rb);
    if (placed.join() !== want.join() || ra() !== rb()) { out.div = `salt ${salt} cycle ${i} ${cur}: engine [${placed}] vanilla [${want}]`; break; }
    out.mobs += placed.length; out.max = Math.max(out.max, placed.length);
  }
  return out;
}

baseEntries.t = JSON.parse(JSON.stringify(TABLE));
const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
const tot = runs.reduce((a, r) => a + r.mobs, 0);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(tot > 2000, 'lane vacuous: ' + tot + ' mobs');
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
const wolf = TABLE.taiga.creature.find((e) => e.type === 'wolf');
tryBreak('wolf max pack 4 -> 5', () => { wolf.maxCount = 5; }, () => { wolf.maxCount = 4; });
const T = Spawn.TRAVERSAL;
tryBreak('3 tries -> 4', () => { T.TRIES = 4; }, () => { T.TRIES = 3; });
tryBreak('jitter 6 -> 7', () => { T.JITTER = 7; }, () => { T.JITTER = 6; });
tryBreak('distance gate 576 -> 400', () => { T.MIN_PLAYER_DIST2 = 400; }, () => { T.MIN_PLAYER_DIST2 = 576; });
const ol = Spawn.limitPerChunk;
tryBreak('cap ignored', () => { Spawn.limitPerChunk = () => 99; }, () => { Spawn.limitPerChunk = ol; });
console.log(`${n} assertions, spawnpack: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === 5 ? 0 : 1);
