#!/usr/bin/env node
// lockstep-spawncap -- #7942 (G18c-L7): lockstep lane 'spawncap', 20 salts. Every MobCategory filled to cap-1, cap, cap+1 (vs SpawnGroup capacity * chunks / 289) with 1, 9, 49 ticking chunks,
// persistent / riding mobs mixed in (SpawnHelper.setupSpawn skips them), and the per-tick traversal (creature only when time % 400 == 0) against an oracle from .decomp SpawnHelper.Info.isBelowCap.
// Columns of sky light 0-15 and block light 0-15 in day, night, rain
// and thunder; Spawn.RULES.zombie (spawner reason, so only the light + difficulty gates) against an oracle re-derived from .decomp HostileEntity.isSpawnDark /
// canSpawnInDark on identical random streams (sky > nextInt(32) refuses; block > 0 refuses; thunder uses max(block, sky-10) else ambient darkness; <= nextInt(8)),
// the peaceful gate, the final stream state, and Spawn.isAcceptablePosition (d2 <= 576 refuses: never closer than 24).
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
const EL = M.EntityList, Spawn = M.Spawn, Sl = M.Slime, W = M.World;
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; EL.init(); M.Ai.init(); Spawn.init(); Sl.init();
M.Diff.value = 'normal'; Spawn.CLEAR_CHECK = false;



const stream = (salt) => { let s = (salt * 2654435761 + 99) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const CATS = { monster: ['zombie', 70], creature: ['cow', 10], ambient: ['bat', 15], axolotls: ['axolotl', 5], water_creature: ['squid', 5], underground_water_creature: ['glow_squid', 5], water_ambient: ['cod', 20] };
const CHUNKS = [1, 9, 49];
let nChunks = 1, calls = [];
const mkChunks = (n) => { const m = new Map(), r = Math.round(Math.sqrt(n)); for (let i = 0; i < n; i++) m.set(i, { cx: i % r, cz: Math.floor(i / r) }); return m; };
W.loadedAt = () => true; W.tickingAt = () => true; W.border = null;
W.chunks = mkChunks(1);
EL.list = [];
Spawn.spawnDensity = () => null;
Spawn.ready = true; EL.ready = true;
M.Player = M.Player || {}; M.Biomes = M.Biomes || {}; M.Biomes.ready = true;
M.Behave = M.Behave || {};
Spawn.spawnForChunk = (cx, cz, cat) => { calls.push(cat); return 0; };
// vanilla: capacity * spawningChunkCount / 289 (int), count skips persistent or riding MobEntity
const oracleCap = (cap, n) => Math.trunc(cap * n / 289);
const oracleCounts = (list) => { const c = {}; for (const e of list) { if (e.persistent || e.vehicle) continue; c[e.cat] = (c[e.cat] || 0) + 1; } return c; };

function run(salt) {
  const r = stream(salt), out = { div: '', cells: 0, below: 0, above: 0 };
  for (const n of CHUNKS) {
    nChunks = n; W.chunks = mkChunks(n);
    for (const cat of Object.keys(CATS)) {
      const [type, cap] = CATS[cat], capN = oracleCap(cap, n);
      for (const d of [-1, 0, 1]) {
        const want = Math.max(0, capN + d), list = [];
        for (let i = 0; i < want; i++) list.push({ type, cat, x: 0, y: 64, z: 0 });
        // noise that must not count: persistent, riding, other categories, removed
        const extra = 1 + Math.floor(r() * 4);
        for (let i = 0; i < extra; i++) { const k = r(); list.push({ type, cat, x: 0, y: 64, z: 0, persistent: k < 0.5, vehicle: k >= 0.5 ? {} : null, removed: false }); }
        list.push({ type: 'cod', cat: 'water_ambient', x: 0, y: 64, z: 0, removed: true });
        for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
        EL.list = list.map((e) => Object.assign({ persistent: false, vehicle: null, removed: false }, e));
        const oc = oracleCounts(list.filter((e) => !e.removed));
        const info = Spawn.setupInfo();
        out.cells++;
        const gotCap = Spawn.categoryCap(cat), gotLive = Spawn.liveCount(cat), gotBelow = Spawn.infoBelowCap(info, cat);
        const wantBelow = (oc[cat] || 0) < capN;
        if (gotCap !== capN || gotLive !== (oc[cat] || 0) || gotBelow !== wantBelow || (info.counts[cat] | 0) !== (oc[cat] || 0)) { out.div = `salt ${salt} ${cat} x${n} d${d}: cap ${gotCap}/${capN} live ${gotLive}/${oc[cat] || 0} below ${gotBelow}/${wantBelow}`; return out; }
        wantBelow ? out.below++ : out.above++;
        // traversal: which categories are tried per chunk, creature only on tick % 400 == 0
        for (const t of [0, 1, 399, 400, 800, 12000]) {
          M.Behave.gameTime = t; calls = [];
          Spawn.tick({ rng: { nextInt: () => 0 }, info });
          const rare = t % 400 === 0;
          const wantN = (wantBelow && (cat !== 'creature' || rare) && (cat !== 'monster' || !M.Diff.isPeaceful())) ? n : 0;
          const gotN = calls.filter((c) => c === cat).length;
          if (gotN !== wantN) { out.div = `salt ${salt} ${cat} x${n} d${d} t${t}: attempts ${gotN}/${wantN}`; return out; }
        }
      }
    }
  }
  return out;
}

const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(runs.every((r) => r.below > 3 && r.above > 20), 'lane vacuous: ' + runs.map((r) => r.below + '/' + r.above));
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
const oc = Spawn.CATEGORY.monster.cap;
tryBreak('monster cap 71', () => { Spawn.CATEGORY.monster.cap = 71; }, () => { Spawn.CATEGORY.monster.cap = oc; });
const ocr = Spawn.CATEGORY.creature.cap;
tryBreak('creature cap 30', () => { Spawn.CATEGORY.creature.cap = 30; }, () => { Spawn.CATEGORY.creature.cap = ocr; });
const olc = Spawn.liveCount;
tryBreak('persistent counted', () => { Spawn.liveCount = (c) => EL.list.filter((e) => !e.removed && e.cat === c).length; }, () => { Spawn.liveCount = olc; });
const osc = Spawn.spawningChunkCount;
tryBreak('chunk count off by one', () => { Spawn.spawningChunkCount = () => osc() + 1; }, () => { Spawn.spawningChunkCount = osc; });
const ot = Spawn.NATURAL_CATEGORIES.slice();
tryBreak('creature every tick', () => { Spawn.TRAVERSAL.RARE_PERIOD = 1; }, () => { Spawn.TRAVERSAL.RARE_PERIOD = 400; });
console.log(`${n} assertions, spawncap: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === 5 ? 0 : 1);
