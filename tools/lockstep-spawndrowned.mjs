#!/usr/bin/env node
// lockstep-spawndrowned -- #8722 (G18c-L19): lockstep lane 'spawndrowned', 20 salts x 4000 attempts. River, frozen river, ocean, deep ocean and lake cells at y 55-70
// with the water surface at 58-66; Spawn.RULES.drowned against an oracle re-derived from .decomp DrownedEntity.canSpawn (river/frozen_river: nextInt(15)==0, every
// other biome nextInt(40)==0 and y < seaLevel - 5), the water-below / water-at (non-spawner) tests, HostileEntity.canSpawnInDark and the peaceful gate, on identical
// random streams; per attempt acceptance and the final stream state are compared.
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
M.Diff.value = 'normal'; Spawn.CLEAR_CHECK = false;

const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
let WATER = 0;
for (let s = 1; s < M.States.waterIn.length; s++) if (M.States.waterIn[s] === 1) { WATER = s; break; }
ok(WATER > 0, 'no water state');
const BIOMES = ['river', 'frozen_river', 'ocean', 'deep_ocean', 'lake'];
let cur = { biome: 'river', top: 62 };
W.getBlock = (x, y) => (y <= cur.top ? WATER : 0);
W.biomeAt = () => 0;
W.getLight = () => 0;
M.Sky = { dayTime: 0, moonPhase: () => 0, darknessNow: () => 0, isThundering: () => false };
M.Biomes = { ready: true, at: () => ({ name: 'minecraft:' + cur.biome }) };
W.loadedAt = () => true; W.tickingAt = () => true; W.border = null; Spawn.worldSpawn = () => null;

let RIVER = 15;
const oracle = (diff, reason, y, f) => {
  if (!(cur.top >= y - 1)) return false;
  if (diff === 'peaceful') return false;
  if (!(f(32) >= 0 && 0 <= f(8))) return false; // sky 0, block 0: the same two draws canSpawnInDark makes
  if (reason !== 'spawner' && !(cur.top >= y)) return false;
  if (cur.biome === 'river' || cur.biome === 'frozen_river') return f(RIVER) === 0;
  if (f(40) !== 0) return false;
  return y < 63 - 5;
};

function run(salt) {
  const ra = stream(salt), rb = stream(salt), out = { div: '', yes: 0, by: {} };
  const ria = (k) => Math.floor(ra() * k), rib = (k) => Math.floor(rb() * k);
  const pick = stream(salt + 1000);
  for (let i = 0; i < 4000 && !out.div; i++) {
    const b = BIOMES[Math.floor(pick() * 5)];
    const y = pick() < 0.5 ? 55 + Math.floor(pick() * 10) : 62 + Math.floor(pick() * 9);
    cur = { biome: b, top: 58 + Math.floor(pick() * 9) };
    const reason = pick() < 0.2 ? 'spawner' : 'natural', diff = pick() < 0.05 ? 'peaceful' : 'normal';
    M.Diff.value = diff;
    const got = Spawn.RULES.drowned(0, y, 0, reason, ria), want = oracle(diff, reason, y, rib);
    if (got !== want || ra() !== rb()) { out.div = `salt ${salt} #${i} ${b} y ${y} top ${cur.top} ${reason} ${diff} engine ${got} vanilla ${want}`; break; }
    if (got) { out.yes++; out.by[b] = (out.by[b] || 0) + 1; }
  }
  return out;
}

const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
const tot = {}; runs.forEach((r) => { for (const k in r.by) tot[k] = (tot[k] || 0) + r.by[k]; });
ok(div.length === 0, 'divergences: ' + div[0]);
ok(BIOMES.every((b) => b === 'lake' ? true : tot[b] > 20), 'lane vacuous: spawns per biome ' + JSON.stringify(tot));
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
tryBreak('river chance 15 -> 40', () => { RIVER = 40; }, () => { RIVER = 15; });
const sl = Spawn.SEA_LEVEL;
tryBreak('sea level cut-off moved', () => { Spawn.SEA_LEVEL = 60; }, () => { Spawn.SEA_LEVEL = sl; });
const gl = W.getLight;
tryBreak('light ignored', () => { W.getLight = () => 0xf0; }, () => { W.getLight = gl; });
console.log(`${n} assertions, spawndrowned: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === 3 ? 0 : 1);
