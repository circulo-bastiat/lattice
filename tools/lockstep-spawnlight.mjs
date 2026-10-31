#!/usr/bin/env node
// lockstep-spawnlight -- #7920 (G18c-L5): lockstep lane 'spawnlight', 20 salts x 6000 attempts. Columns of sky light 0-15 and block light 0-15 in day, night, rain
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


const SEED = 1n;
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const WEATHER = [['day', 0, false], ['night', 11, false], ['rain', 3, false], ['thunder', 11, true]];
let cur = { sky: 0, blk: 0, dark: 0, thunder: false };
W.getLight = () => (cur.sky << 4) | cur.blk;
M.Sky = { dayTime: 0, moonPhase: () => 0, darknessNow: () => cur.dark, isThundering: () => cur.thunder };
W.loadedAt = () => true; W.tickingAt = () => true; W.border = null; Spawn.worldSpawn = () => null;

const oracle = (diff, f) => {
  if (diff === 'peaceful') return false;
  if (cur.sky > f(32)) return false;
  if (cur.blk > Spawn.TEST_BLOCK_LIMIT) return false;
  const light = cur.thunder ? Math.max(cur.blk, cur.sky - 10) : Math.max(cur.blk, cur.sky - cur.dark);
  return light <= f(8);
};
Spawn.TEST_BLOCK_LIMIT = 0;

function run(salt) {
  const ra = stream(salt), rb = stream(salt), out = { div: '', yes: 0, wx: [0, 0, 0, 0] };
  const ria = (k) => Math.floor(ra() * k), rib = (k) => Math.floor(rb() * k);
  const pick = stream(salt + 1000);
  for (let i = 0; i < 6000 && !out.div; i++) {
    const wi = Math.floor(pick() * 4), w = WEATHER[wi];
    cur = { sky: Math.floor(pick() * 16), blk: pick() < 0.5 ? 0 : Math.floor(pick() * 3), dark: w[1], thunder: w[2] };
    const diff = pick() < 0.1 ? 'peaceful' : 'normal';
    M.Diff.value = diff;
    const got = Spawn.RULES.zombie(0, 64, 0, 'spawner', ria), want = oracle(diff, rib);
    if (got !== want || ra() !== rb()) { out.div = `salt ${salt} #${i} ${w[0]} sky ${cur.sky} blk ${cur.blk} ${diff} engine ${got} vanilla ${want}`; break; }
    if (got) { out.yes++; out.wx[wi]++; }
    // placement distance: 24..128 from the player
    const dd = 20 + Math.floor(pick() * 120), x = dd, d2 = dd * dd;
    if (Spawn.isAcceptablePosition(x >> 4, 0, x, 64, 0, d2) !== (d2 > 576)) out.div = `salt ${salt} distance ${dd}`;
  }
  return out;
}

const all = () => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
const tot = runs.reduce((a, r) => a.map((v, i) => v + r.wx[i]), [0, 0, 0, 0]);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(tot.every((v) => v > 50), 'lane vacuous: spawns per weather ' + tot);
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
tryBreak('block light 1 allowed', () => { Spawn.TEST_BLOCK_LIMIT = 1; M.__blk = 1; }, () => { Spawn.TEST_BLOCK_LIMIT = 0; M.__blk = 0; });
const ol = W.getLight;
tryBreak('thunder ignored', () => { M.Sky.isThundering = () => false; cur.thunder = false; const o = oracle; }, () => { M.Sky.isThundering = () => cur.thunder; });
tryBreak('sky light ignored', () => { W.getLight = (x, y, z) => cur.blk; }, () => { W.getLight = ol; });
const oa = Spawn.isAcceptablePosition;
tryBreak('24-block gate off', () => { Spawn.isAcceptablePosition = (a, b, x, y, z, d2) => oa(a, b, x, y, z, d2 + 100); }, () => { Spawn.isAcceptablePosition = oa; });
console.log(`${n} assertions, spawnlight: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === 4 ? 0 : 1);
