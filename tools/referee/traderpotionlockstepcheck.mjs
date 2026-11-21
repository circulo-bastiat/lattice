// traderpotion lockstep check -- #8726 (G18f-L20): lockstep scenario 'traderpotion', 20 salts, a wandering trader + two trader llamas through 2 days.
// Reference = WanderingTraderEntity (UseItemGoal-style HoldInHandsGoal: night & !invisible -> potion, day & invisible -> milk; 32-tick use; potion adds INVISIBILITY 3600,
// milk clears all; tickDespawnDelay) + TraderLlamaEntity.tryDespawn (.decomp), re-written below with vanilla constants only.
// Per tick: mainhand item, invisibility duration, trader despawn countdown, removal tick of trader and llamas -- through trace.mjs compareTraces.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { compareTraces } from './lockstep/trace.mjs';
const BASE = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '07i_entitylist.js', '07k_goals.js', '07q_effects.js', '07y_equip.js', '07ze_llama.js', '07zt_wtrader.js'];
const M = loadEngine({ extra: BASE, dom: false, initReg: true });
M.Entities.init && M.Entities.init();
M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes });
const WT = M.WT, ES = M.Effects, Ll = M.Llama || M.Ll;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const TICKS = 48100, FL = { fields: ['goals', 'entities'] };
const nightAt = (clock) => { const d = ((clock % 24000) + 24000) % 24000; return d >= 13000 && d < 23000; };
const offsetOf = (salt) => Math.floor(stream(salt)() * 24000);
// reference lane: vanilla constants only, no WT.* values
function ref(salt) {
  const off = offsetOf(salt); let delay = 48000, inv = 0, hand = 'none', use = 0, item = null, tr = true, l1 = true, l2 = true; const rows = [];
  let llDelay = [47999, 47999];
  for (let t = 1; t <= TICKS; t++) {
    const ev = [], night = nightAt(off + t);
    if (tr) {
      if (inv > 0) inv--;
      if (use > 0 && --use === 0) { if (item === 'potion') inv = 3600; else inv = 0; }
      // goal selector: running goal stops when no longer using; then idle goals start
      if (item && use === 0) { hand = 'none'; item = null; }
      if (!item) {
        if (night && inv === 0) { item = 'potion'; hand = 'potion'; use = 32; }
        else if (!night && inv > 0) { item = 'milk_bucket'; hand = 'milk_bucket'; use = 32; }
      }
      if (delay > 0 && --delay === 0) { tr = false; ev.push(['removed', 'trader']); }
    }
    [0, 1].forEach((i) => {
      if (!(i ? l2 : l1)) return;
      llDelay[i] = tr ? delay - 1 : llDelay[i] - 1;
      if (llDelay[i] <= 0) { if (i) l2 = false; else l1 = false; ev.push(['removed', 'llama' + i]); }
    });
    rows.push({ tick: t, goals: [[0, hand + ':' + inv + ':' + (tr ? delay : -1)]], entities: ev });
  }
  return rows;
}
function eng(salt) {
  const off = offsetOf(salt); let clock = off;
  M.Sky = { isNight: () => nightAt(clock), isDay: () => !nightAt(clock) };
  const trader = { type: 'wandering_trader', x: 0, y: 64, z: 0, despawnDelay: WT.DESPAWN_DELAY, effects: {}, equip: [], tradeOffers: [] };
  const llamas = [0, 1].map(() => ({ type: 'trader_llama', x: 0, y: 64, z: 0, leashHolder: { kind: 'entity', entity: trader } }));
  const gs = new M.Ai.GoalSelector(); gs.add(0, 0, new WT.DrinkInvisibilityGoal(trader)); gs.add(0, 0, new WT.DrinkMilkGoal(trader));
  const rows = []; let tAlive = true; const lAlive = [true, true];
  const held = () => { const s = M.Equip.getEquipped ? M.Equip.getEquipped(trader, M.Items.MAINHAND) : null; return s ? (M.Items.nameOf ? M.Items.nameOf(s.i) : s.name || s.i) : 'none'; };
  for (let t = 1; t <= TICKS; t++) {
    clock = off + t; const ev = [];
    if (tAlive) {
      ES.tick(trader); WT.tickUse(trader); gs.tick();
      if (trader.despawnDelay > 0 && !trader.customer && --trader.despawnDelay === 0) { trader.removed = true; tAlive = false; ev.push(['removed', 'trader']); }
    }
    llamas.forEach((l, i) => { if (!lAlive[i]) return; Ll.tickTraderLlamaDespawn(l); if (l.removed) { lAlive[i] = false; ev.push(['removed', 'llama' + i]); } });
    const inv = trader.effects && trader.effects.invisibility ? trader.effects.invisibility.duration : 0;
    rows.push({ tick: t, goals: [[0, held() + ':' + inv + ':' + (tAlive ? trader.despawnDelay : -1)]], entities: ev });
  }
  return rows;
}
const run = (n = 20) => Array.from({ length: n }, (_, salt) => ({ salt, d: compareTraces(ref(salt), eng(salt), FL) }));
const report = (res) => res.filter((r) => r.d).map((r) => `salt ${r.salt} ${JSON.stringify(r.d)}`).slice(0, 2);
const res = run();
ok(res.every((r) => !r.d), 'traderpotion lane: ' + report(res));
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const od = WT.DESPAWN_DELAY; WT.DESPAWN_DELAY = 24000;
brk(run(3).some((r) => r.d), 'despawn delay 48000 -> 24000 is reported'); WT.DESPAWN_DELAY = od;
const ou = WT.INVIS_DURATION; WT.INVIS_DURATION = 3000;
brk(run(3).some((r) => r.d), 'invisibility 3600 -> 3000 is reported'); WT.INVIS_DURATION = ou;
console.log(`traderpotionlockstepcheck: ${1 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
