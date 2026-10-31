#!/usr/bin/env node
// lockstep-spawnmoon -- #7919 (G18c-L4): lockstep lane 'spawnmoon', 20 salts over 8 days (every moon phase). A swamp column, a slime-chunk arena and a plain arena;
// every attempt runs Spawn.RULES.slime and an oracle re-derived from .decomp SlimeEntity.canSpawn on identical random streams (swamp: y 51-69, nextFloat<0.5,
// nextFloat<moonSize, light<=nextInt(8); chunk: ChunkRandom(seed+..^987234911L).nextInt(10)==0, nextInt(10)==0, y<40), also the final stream state. Then
// the size roll (nextInt(3), +1 if nextFloat<0.5*d) and the split on death (2+nextInt(3) children of size/2). Anti-vacuity: moon gate ignored etc.
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

const MOON = [1.0, 0.75, 0.5, 0.25, 0.0, 0.25, 0.5, 0.75];   // DimensionType.MOON_SIZES
const SEED = 123456789012345n;
const stream = (salt) => { let s = (salt * 2654435761 + 4242) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
// independent chunk hash (ChunkRandom.getSlimeRandom) + java.util.Random.nextInt(10)
function slimeChunk(cx, cz, seed) {
  const sum = BigInt.asIntN(64, seed + BigInt(Math.imul(Math.imul(cx, cx), 4987142)) + BigInt(Math.imul(cx, 5947611)) + BigInt(Math.imul(cz, cz)) * 4392871n + BigInt(Math.imul(cz, 389711)));
  let s = (BigInt.asIntN(64, sum ^ 987234911n) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n);
  for (;;) {
    s = (s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n);
    const bits = Number(s >> 17n);   // next(31)
    const v = bits % 10;
    if (bits - v + 9 <= 2147483647) return v === 0;
  }
}
const oracle = (biome, x, y, z, phase, local, f, ri) => {
  if (biome === 'swamp' && y > 50 && y < 70 && f() < 0.5 && f() < MOON[phase] && local <= ri(8)) return true;
  return ri(10) === 0 && slimeChunk(x >> 4, z >> 4, SEED) && y < 40;
};

let cur = { biome: 'plains', phase: 0, sky: 0, blk: 0, dark: 0 };
W.seed64 = SEED; W.biomeAt = () => 0; W.getLight = () => (cur.sky << 4) | cur.blk;
M.Biomes = { ready: true, name: () => 'minecraft:' + cur.biome };
M.Sky = { dayTime: 0, moonPhase: () => cur.phase, darknessNow: () => cur.dark, isThundering: () => false };
W.seed64 = SEED;

function run(salt) {
  const ra = stream(salt), rb = stream(salt), out = { div: '', sw: 0, ch: 0, pl: 0 };
  const ria = (k) => Math.floor(ra() * k), rib = (k) => Math.floor(rb() * k);
  EL.wr = ra;
  const pick = stream(salt + 1000);
  for (let day = 0; day < 8 && !out.div; day++) for (let i = 0; i < 400; i++) {
    const arena = ['swamp', 'chunk', 'plain'][i % 3];
    cur = { biome: arena === 'swamp' ? 'swamp' : 'plains', phase: day % 8, sky: Math.floor(pick() * 16), blk: pick() < 0.5 ? 0 : Math.floor(pick() * 8), dark: pick() < 0.6 ? 11 : 0 };
    const x = Math.floor(pick() * 512) - 256, z = Math.floor(pick() * 512) - 256;
    const y = arena === 'swamp' ? 45 + Math.floor(pick() * 30) : arena === 'chunk' ? 5 + Math.floor(pick() * 50) : 30 + Math.floor(pick() * 60);
    const local = Math.max(cur.blk, cur.sky - cur.dark);
    const got = Spawn.RULES.slime(x, y, z, 'spawner', ria), want = oracle(cur.biome, x, y, z, cur.phase, local, rb, rib);
    if (got !== want || ra() !== rb()) { out.div = `salt ${salt} day ${day} ${arena} (${x},${y},${z}) phase ${cur.phase} engine ${got} vanilla ${want}`; break; }
    if (got) out[arena.slice(0, 2)]++;
  }
  // size roll + split
  const rs = stream(salt + 5000), rr = stream(salt + 5000), d = [0.25, 0.5, 0.75, 1][salt % 4];
  M.Equip.clampedLocalDifficulty = () => d;
  const cnt = [0, 0, 0];
  for (let i = 0; i < 300 && !out.div; i++) {
    const e = { type: 'slime', x: 0, y: 64, z: 0 };
    Sl.rollSize(e, rs);
    let idx = Math.floor(rr() * 3); if (idx < 2 && rr() < 0.5 * d) idx++;
    if (e.size !== (1 << idx)) out.div = `salt ${salt} size ${e.size} vs ${1 << idx}`;
    cnt[idx]++;
    if (e.size > 1) {
      const kids = [];
      Sl.split(e, (t, X, Y, Z, o) => { const k = { type: t, size: o.size }; kids.push(k); return k; });
      if (kids.length < 2 || kids.length > 4 || kids.some((k) => k.size !== e.size / 2)) out.div = `salt ${salt} split ${kids.length}`;
    }
  }
  out.cnt = cnt;
  return out;
}

const all = (mut) => { const r = []; for (let s = 0; s < 20; s++) r.push(run(s)); return r; };
const runs = all();
const div = runs.filter((r) => r.div).map((r) => r.div);
const tot = runs.reduce((a, r) => [a[0] + r.sw, a[1] + r.ch], [0, 0]);
ok(div.length === 0, 'divergences: ' + div[0]);
ok(tot[0] > 50 && tot[1] > 50, `lane vacuous: swamp ${tot[0]} chunk ${tot[1]} spawns`);
ok(JSON.stringify(run(3)) === JSON.stringify(runs[3]), 'not deterministic');

let caught = 0;
const tryBreak = (name, apply, undo) => { apply(); const x = all().some((r) => r.div); undo(); n++; if (x) caught++; else { bad++; console.log('NOT CAUGHT ' + name); } };
const om = EL.MOON_SIZES;
tryBreak('moon gate ignored', () => { EL.MOON_SIZES = [1, 1, 1, 1, 1, 1, 1, 1]; }, () => { EL.MOON_SIZES = om; });
const os = Sl.SLIME_CHUNK_SALT;
tryBreak('chunk hash salt', () => { Sl.SLIME_CHUNK_SALT = 987234912; }, () => { Sl.SLIME_CHUNK_SALT = os; });
const oi = Sl.isSlimeChunk;
tryBreak('every chunk slime', () => { Sl.isSlimeChunk = () => true; }, () => { Sl.isSlimeChunk = oi; });
const ol = W.getLight;
tryBreak('light ignored', () => { W.getLight = () => 0; }, () => { W.getLight = ol; });
console.log(`${n} assertions, spawnmoon: ${caught} breaks caught, ${div.length} divergences${div[0] ? ' ' + div[0] : ''}`);
process.exit(bad === 0 && caught === 4 ? 0 : 1);
