// lockstep-gossip -- #6790 (G17-L141): lockstep scenario 'gossip', 20 salts: hurt/kill/trade/cure gossip, merge cap, daily decay, talk sharing, reputation price diff, Hero of the Village.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02h_recipes.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Mount.init();
const { EntityList: EL, Passive: Ps, Tame: Tm, Breed: Br, Use, Inventory: Iv } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
// Reference = the vanilla 2-ingredient shapeless dye recipes SheepEntity.getChildColor finds through a 2x1 CraftingInventory (order-free); no match -> nextBoolean() picks a parent.
const MIX = { 'red+yellow': 'orange', 'pink+purple': 'magenta', 'blue+white': 'light_blue', 'green+white': 'lime', 'red+white': 'pink', 'black+white': 'gray', 'gray+white': 'light_gray', 'blue+green': 'cyan', 'blue+red': 'purple' };
const mixOf = (a, b) => MIX[[a, b].sort().join('+')] || null;


const V = M.Village, Tr = M.Trade, Ef = M.Effects;
// Reference = VillagerGossips/VillageGossipType (.decomp), own constants: [mult, max, decay, share].
const T = { major_negative: [-5, 100, 10, 10], minor_negative: [-1, 200, 20, 20], minor_positive: [1, 200, 1, 5], major_positive: [5, 100, 0, 100], trading: [1, 25, 2, 20] };
const KEYS = Object.keys(T);
const rStart = (g, k, a) => { const c = g.get(k) || 0, s = c + a, v = s > T[k][1] ? Math.max(T[k][1], c) : s; if (v < 2) g.delete(k); else g.set(k, v); };
const rDecay = (g) => { for (const [k, v] of [...g]) { const n = v - T[k][2]; if (n < 2) g.delete(k); else g.set(k, n); } };
const rRep = (g) => { let s = 0; for (const [k, v] of g) s += v * T[k][0]; return s; };
function rShare(dst, src, rnd, count) {
  const es = [...src.keys()]; if (!es.length) return;
  const cum = []; let tot = 0; for (const k of es) { tot += Math.abs(src.get(k)); cum.push(tot - 1); }
  const picked = new Set();
  for (let n = 0; n < count; n++) { const r = Math.floor(rnd() * tot); let i = cum.findIndex((c) => c >= r); if (i < 0) i = cum.length; picked.add(es[i]); }
  for (const k of picked) { const v = src.get(k) - T[k][3]; if (v >= 2) dst.set(k, Math.max(dst.get(k) || 0, v)); }
}
const dump = (g) => KEYS.map((k) => k + '=' + (g.get(k) || 0)).join(',');
const mine = (e) => KEYS.map((k) => k + '=' + ((e.gossip && e.gossip[k]) || 0)).join(',');
function lane(salt) {
  cells.clear(); EL.list.length = 0; let bad = null; const note = (m) => { if (!bad) bad = m; };
  const rs = stream(salt + 4100), rA = stream(salt + 77), rB = stream(salt + 77);
  const mk = (x) => { const v = EL.spawn('villager', x, 0, 0.5, {}); v.persistent = true; v.tradeOffers = [{ kind: 'buy_item_for_emerald', item: 'wheat', itemQty: 20, priceEmerald: 24 + salt, priceMult: 0.05 }, { kind: 'buy_item_for_emerald', item: 'stick', itemQty: 4, priceEmerald: 5, priceMult: 0.2 }]; return v; };
  const A = mk(0.5), B = mk(2.5), C = mk(4.5);
  const vs = [A, B, C], ref = vs.map(() => new Map());
  M.Player = { x: 0, y: 300, z: 60 };
  let now = 100000;
  for (let step = 0; step < 60; step++) {
    const op = Math.floor(rs() * 6), i = Math.floor(rs() * 3), j = (i + 1 + Math.floor(rs() * 2)) % 3;
    if (op === 0) { V.startGossip(vs[i], 'minor_negative', 25); rStart(ref[i], 'minor_negative', 25); }
    else if (op === 1) { V.startGossip(vs[i], 'trading', 2); rStart(ref[i], 'trading', 2); }
    else if (op === 2) { const k = KEYS[Math.floor(rs() * 5)], a = 1 + Math.floor(rs() * 60); V.startGossip(vs[i], k, a); rStart(ref[i], k, a); }
    else if (op === 3) { now += 24000; for (let n = 0; n < 3; n++) { V.decayGossip(vs[n], now - 24000); V.decayGossip(vs[n], now); rDecay(ref[n]); } }
    else if (op === 4) {
      vs[i].gossipStartTime = undefined; vs[j].gossipStartTime = undefined;
      V.shareGossipFrom(vs[i], vs[j], () => rA(), V.TALK_SHARE_COUNT); rShare(ref[i], ref[j], () => rB(), 10);
    } else {
      const k = Math.floor(rs() * 3); const P = {}; const hero = rs() < 0.5, amp = Math.floor(rs() * 3);
      if (hero) Ef.addStatusEffect(P, 'hero_of_the_village', 1000, amp);
      Tr.prepareOffersFor(vs[k], P);
      const rep = rRep(ref[k]);
      vs[k].tradeOffers.forEach((o, n) => {
        let want = -Math.floor(Math.fround(Math.fround(rep) * Math.fround(o.priceMult)));
        if (hero) want += -Math.max(Math.floor((0.3 + 0.0625 * amp) * o.priceEmerald), 1);
        if (vs[k].tradeSpecial[n] !== want) note(`special price step ${step} offer ${n}: ${vs[k].tradeSpecial[n]} vs ${want}`);
      });
      Tr.clearSpecialPrices(vs[k]);
    }
    for (let n = 0; n < 3; n++) { if (mine(vs[n]) !== dump(ref[n])) note(`gossip step ${step} op ${op} villager ${n}: ${mine(vs[n])} vs ${dump(ref[n])}`); if (V.getReputation(vs[n]) !== rRep(ref[n])) note(`reputation step ${step}: ${V.getReputation(vs[n])} vs ${rRep(ref[n])}`); }
  }
  // Golem-kill anger: killing A is broadcast to nearby villagers as major_negative 25 (+ minor_negative 25 on A).
  const D = mk(0.5); D.gossip = {}; const E1 = mk(1.5); E1.gossip = {};
  D.dead = true; V.onHurt(D, M.Player);
  if (!E1.gossip.major_negative || E1.gossip.major_negative !== 25) note('kill gossip ' + JSON.stringify(E1.gossip));
  if (D.gossip.minor_negative !== 25) note('hurt gossip ' + JSON.stringify(D.gossip));
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'gossip salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = () => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return h; };
{ const sv = V.GOSSIP.trading.max; V.GOSSIP.trading.max = 26; brk(!!first(), 'trading max 25 -> 26: ' + first()); V.GOSSIP.trading.max = sv; }
{ const sv = V.GOSSIP.minor_negative.mult; V.GOSSIP.minor_negative.mult = -2; brk(!!first(), 'minor_negative weight -1 -> -2: ' + first()); V.GOSSIP.minor_negative.mult = sv; }
{ const sv = V.GOSSIP.minor_positive.decay; V.GOSSIP.minor_positive.decay = 2; brk(!!first(), 'minor_positive decay 1 -> 2: ' + first()); V.GOSSIP.minor_positive.decay = sv; }
{ const sv = V.GOSSIP.major_negative.share; V.GOSSIP.major_negative.share = 5; brk(!!first(), 'major_negative share 10 -> 5: ' + first()); V.GOSSIP.major_negative.share = sv; }
{ const sv = Tr.prepareOffersFor; Tr.prepareOffersFor = (e, P) => { sv(e, P); for (let i = 0; i < e.tradeSpecial.length; i++) e.tradeSpecial[i] -= 1; }; brk(!!first(), 'price diff off by one: ' + first()); Tr.prepareOffersFor = sv; }
console.log(`lockstep-gossip: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
