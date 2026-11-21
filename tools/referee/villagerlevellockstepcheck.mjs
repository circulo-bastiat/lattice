// villagerlevellockstepcheck.mjs -- #7026 (G18f-L5): lockstep scenario 'villagerlevel', 20 salts: a villager (profession per salt) whose first offer a scripted player trades until XP crosses 10/70/150/250. Per tick: experience, canLevelUp, levelUpTimer, Regeneration (200), level, offer count, orb amount. Reference = .decomp VillagerEntity.afterUsing/canLevelUp/levelUp/mobTick + VillagerData.LEVEL_BASE_EXPERIENCE (written independently below); offer count per level = min(2, pool) added by fillRecipesFromPool, ids drawn from the level's pool.
import { readFileSync } from 'node:fs';
import { loadEngine } from '../loadsrc.mjs';
const ROOT = new URL('../../', import.meta.url).pathname;
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07q_effects.js', '07o_profession.js', '07ox_enchhelper.js', '07p_trade.js'], dom: false, initReg: true });
const T = M.Trade;
{ // villager-trades table off the golden TSV (as tradecheck §3)
  const lines = readFileSync(ROOT + 'tools/golden/villager-trades-1.18.2.tsv', 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
  const hdr = lines[0].split('\t'), NUMF = new Set(['itemQty', 'item2Qty', 'priceEmerald', 'maxUses', 'xp', 'durationTicks', 'effectId']), trades = {};
  for (const l of lines.slice(1)) {
    const c = l.split('\t'), r = {}; hdr.forEach((h, i) => { r[h] = c[i]; });
    const row = { kind: r.kind };
    for (const h of hdr) { if (h === 'profession' || h === 'level' || h === 'kind' || r[h] === undefined || r[h] === '') continue; row[h] = h === 'byVillagerType' ? JSON.parse(r[h]) : (NUMF.has(h) ? +r[h] : r[h]); }
    ((trades[r.profession] ||= {})[+r.level] ||= []).push(row);
  }
  M.DATA = Object.assign({}, M.DATA, { villagerTrades: trades });
  const im = JSON.parse(readFileSync(ROOT + 'assets/items.meta.json', 'utf8'));
  M.Items.init({ items: readFileSync(ROOT + 'assets/items.bin').toString('base64'), itemsBytes: im.rawBytes });
}
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const PROFS = ['farmer', 'librarian', 'armorer', 'cleric', 'fisherman', 'fletcher', 'butcher', 'mason', 'shepherd', 'toolsmith'];
const BASE = [0, 10, 70, 150, 250]; // VillagerData.LEVEL_BASE_EXPERIENCE
let orbs = [];
M.Xp = { ready: true, spawn: (x, y, z, n) => { orbs.push(n); return []; } };
function lane(salt, mutate) {
  const r = stream(salt);
  M.EntityList = { random: r };
  const prof = PROFS[salt % PROFS.length];
  const e = { type: 'villager', profession: prof, x: 0, y: 64, z: 0 };
  T.ensure(e);
  const P = { inventory: M.Inventory.create(), instabuild: true };
  // reference
  const v = { xp: 0, lvl: 1, timer: 0, leveling: false, regen: 0, n: e.tradeOffers.length };
  const canUp = () => v.lvl < 5 && v.xp >= BASE[v.lvl];
  const offerXp = e.tradeOffers[0].xp || 0;
  if (!offerXp) return 'salt ' + salt + ' offer 0 has no xp (' + prof + ')';
  const gate = 1 + Math.floor(r() * 9);
  for (let t = 0; t < 4000 && v.lvl < 5; t++) {
    orbs = []; let refOrb = 0, lvlBonus = false;
    if (t % gate === 0 && v.timer === 0) {
      e.tradeUses[0] = 0;
      const res = T.attempt(e, 0, P);
      if (!res.ok) return 'salt ' + salt + ' tick ' + t + ' attempt ' + res.reason;
      v.xp += offerXp;
      refOrb = 1; // 3..6
      if (canUp()) { v.timer = 40; v.leveling = true; lvlBonus = true; } // +5 -> 8..11
    }
    if (orbs.length !== refOrb) return 'salt ' + salt + ' tick ' + t + ' orbs ' + orbs.length + ' ref ' + refOrb;
    if (refOrb) { const lo = lvlBonus ? 8 : 3; if (orbs[0] < lo || orbs[0] > lo + 3) return 'salt ' + salt + ' tick ' + t + ' orb amount ' + orbs[0]; }
    // mobTick
    let newOffers = 0;
    if (v.timer > 0) { v.timer--; if (v.timer <= 0) { if (v.leveling) { v.lvl++; v.leveling = false; newOffers = 1; } v.regen = 200; } }
    T.tick(e);
    if (mutate) mutate(e);
    if (newOffers) {
      const pool = T.poolForLevel(prof, v.lvl);
      const add = Math.min(2, pool.length);
      v.n += add;
    }
    const reg = e.effects && e.effects.regeneration;
    const eng = [e.tradeXp, T.canLevelUp(e) ? 1 : 0, e.tradeCelebrateTicks || 0, e.villagerLevel, e.tradeOffers.length, reg ? reg.duration : 0];
    const ref = [v.xp, canUp() ? 1 : 0, v.timer, v.lvl, v.n, v.regen];
    if (v.regen) v.regen--; // effect ticks down only via the mob tick of later ticks; compare duration on the expiry tick only
    if (eng.slice(0, 5).join() !== ref.slice(0, 5).join()) return 'salt ' + salt + ' tick ' + t + ' eng ' + eng + ' ref ' + ref;
    if (newOffers || (v.timer === 0 && eng[5] !== 0 && ref[5] === 200 && eng[5] !== 200)) { if (eng[5] !== ref[5]) return 'salt ' + salt + ' tick ' + t + ' regen ' + eng[5] + ' ref ' + ref[5]; }
  }
  if (v.lvl !== 5) return 'salt ' + salt + ' never reached level 5, lvl ' + v.lvl;
  return null;
}
const pass = (mu) => salts.map((s) => lane(s, mu)).filter(Boolean);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
const mk = (fn) => fn;
const saveBase = T.xpForNextLevel;
const cl = T.canLevelUp;
T.canLevelUp = (e) => { const l = e.villagerLevel || 1; return l >= 1 && l < 5 && (e.tradeXp || 0) >= [0, 10, 71, 150, 250][l]; };
brk(pass().length > 0, 'level threshold 70 -> 71 caught'); T.canLevelUp = cl;
const tk = T.tick;
T.tick = (e) => { const had = e.tradeCelebrateTicks; if (had === 40) e.tradeCelebrateTicks = 41; tk(e); };
brk(pass().length > 0, 'levelUp timer 40 -> 41 caught'); T.tick = tk;
const il = T.increaseLevel;
T.increaseLevel = (e) => { il(e); if (e.villagerLevel === 3) { e.tradeOffers.pop(); e.tradeUses.pop(); } };
brk(pass().length > 0, 'level-3 offer dropped caught'); T.increaseLevel = il;
brk(pass().length === 0, 'unfaulted lane passes after restore');
console.log(`villagerlevellockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
