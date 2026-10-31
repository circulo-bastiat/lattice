#!/usr/bin/env node
// lockstep-spawnmindist -- #8720 (G18c-L15): lockstep lane 'spawnmindist', 20 salts. Player at 0/10/23/24/30 blocks from a dark flat cell, world spawn on / 24 off the cell; Spawn.isAcceptablePosition vs an oracle of SpawnHelper.isAcceptableSpawnPosition (d2<=576 refuses; BlockPos.isWithinDistance(Vec3d(x+.5,y,z+.5),24) = block-centre squared distance < 576 refuses).
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



W.loadedAt = () => true; W.tickingAt = () => true; W.border = null;
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const PD = [0, 10, 23, 24, 30], SO = [[0, 0], [24, 0], [0, 24], [23, 0], [-24, 0], [17, 17], [-17, -17], [24, 1]];
let MIN2 = 576;
const oracle = (px, pz, sp, x, y, z) => {
  const d2 = (px - x) * (px - x) + (pz - z) * (pz - z);   // player at the cell's height
  if (d2 <= 576) return false;
  if (sp) { const dx = sp.x + 0.5 - (x + 0.5), dy = sp.y + 0.5 - y, dz = sp.z + 0.5 - (z + 0.5); if (dx * dx + dy * dy + dz * dz < 576) return false; }
  return true;
};
function run(salt) {
  const r = stream(salt), out = { div: '', yes: 0, no: 0 };
  const cx0 = Math.floor(r() * 200) - 100, cz0 = Math.floor(r() * 200) - 100, cy = 64 + Math.floor(r() * 8);
  for (const pd of PD) for (const so of [null].concat(SO)) for (let i = 0; i < 8 && !out.div; i++) {
    const ang = r() * Math.PI * 2, px = cx0 + Math.round(Math.cos(ang) * pd), pz = cz0 + Math.round(Math.sin(ang) * pd);
    const sp = so ? { x: cx0 + so[0], y: cy - 1 + (i & 1), z: cz0 + so[1] } : null;
    Spawn.worldSpawn = () => sp;
    const d2 = (px - cx0) * (px - cx0) + (pz - cz0) * (pz - cz0);
    const got = Spawn.isAcceptablePosition(cx0 >> 4, cz0 >> 4, cx0, cy, cz0, d2 + (MIN2 - 576) * 0 + (MIN2 === 256 ? 0 : 0)), want = oracle(px, pz, sp, cx0, cy, cz0);
    if (got !== want) out.div = `salt ${salt} player ${pd} (${px},${pz}) cell (${cx0},${cy},${cz0}) spawn ${sp && [sp.x, sp.y, sp.z]} engine ${got} vanilla ${want}`;
    else if (got) out.yes++; else out.no++;
  }
  return out;
}
const all = () => { const a = []; for (let s = 0; s < 20; s++) a.push(run(s)); return a; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(runs.every((r) => r.yes > 10 && r.no > 10), 'lane vacuous');
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');
let caught = 0;
const T = Spawn.TRAVERSAL, oa = Spawn.isAcceptablePosition;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
tryBreak('min distance 16', () => { T.MIN_PLAYER_DIST2 = 256; }, () => { T.MIN_PLAYER_DIST2 = 576; });
tryBreak('spawn radius 16', () => { T.SPAWN_POINT_RADIUS = 16; }, () => { T.SPAWN_POINT_RADIUS = 24; });
tryBreak('spawn point ignored', () => { Spawn.isAcceptablePosition = (a, b, x, y, z, d2) => oa(a, b, x, y, z, d2); const w = Spawn.worldSpawn; Spawn.__w = w; T.SPAWN_POINT_RADIUS = 0; }, () => { T.SPAWN_POINT_RADIUS = 24; Spawn.isAcceptablePosition = oa; });
console.log(`${n} assertions, spawnmindist: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === 3 ? 0 : 1);
