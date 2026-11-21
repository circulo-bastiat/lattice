#!/usr/bin/env node
// minecartplacecheck.mjs — #4828. MinecartItem.useOnBlock via Use.itemUseOn: rail only, y+0.0625 (+0.5 ascending), one item spent (not in creative).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
  '07n_tame.js', '07q_effects.js', '07zw_mobnbt.js', '07zzq_rail.js', '07zzr_minecart.js'];

function scenarios(patch) {
  fails.length = 0;
  const M = loadEngine({ extra: EXTRA, dom: false, patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  const cells = new Map(); const k = (x, y, z) => x + ',' + y + ',' + z;
  const W = { getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0, setBlock(x, y, z, id) { cells.set(k(x, y, z), id); return true; }, blockLightAt: () => 15 };
  M.World = W; M.Behave.init(W);
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init(); M.Use.init(W);
  const { Inventory: Iv, EntityList: EL, Use, Reg: R, Behave: B } = M;
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  const P = (insta) => ({ inventory: Iv.create(), slot: 0, instabuild: insta, ey: 65.62, EYE: 1.62, ez: 0, ex: 0, lookVec: () => [0, 0, 1], syncHotbar() {} });
  const use = (p, name, x, y, z) => { Iv.setItem(p.inventory, 0, Iv.stack(name, 2, 0, null)); EL.list.length = 0;
    const r = Use.itemUseOn(p, x, y, z, 2, W.getBlock(x, y, z), Iv.getItem(p.inventory, 0)); return { r, s: Iv.getItem(p.inventory, 0), c: EL.list.find((e) => e.type === name) }; };
  W.setBlock(10, 63, 10, def('stone'));
  W.setBlock(10, 64, 10, B.setProp(def('rail'), 'shape', 'north_south'));
  W.setBlock(12, 64, 10, B.setProp(def('rail'), 'shape', 'ascending_east'));
  let o = use(P(false), 'minecart', 10, 64, 10);
  ok(o.c && o.c.x === 10.5 && o.c.z === 10.5 && Math.abs(o.c.y - 64.0625) < 1e-9, 'flat rail: cart at rail+0.0625');
  ok(o.s && o.s.n === 1, 'one item consumed');
  o = use(P(false), 'minecart', 12, 64, 10);
  ok(o.c && Math.abs(o.c.y - 64.5625) < 1e-9, 'ascending rail: +0.5');
  o = use(P(true), 'minecart', 10, 64, 10);
  ok(o.c && o.s.n === 2, 'creative keeps the item');
  o = use(P(false), 'minecart', 10, 63, 10);
  ok(!o.c && o.s.n === 2, 'non-rail: nothing spawned, nothing spent');
  o = use(P(false), 'chest_minecart', 10, 64, 10);
  ok(o.c, 'chest_minecart places too');
  Iv.setItem(P(false).inventory, 0, null);
  { const p = P(false); Iv.setItem(p.inventory, 0, Iv.stack('minecart', 1, 0, { display: { Name: 'Bob' } })); EL.list.length = 0;
    Use.itemUseOn(p, 10, 64, 10, 2, W.getBlock(10, 64, 10), Iv.getItem(p.inventory, 0));
    const c = EL.list.find((e) => e.type === 'minecart'); ok(c && c.customName === 'Bob', 'named stack names the cart'); }
  return fails.slice();
}
const real = scenarios();
let breaks = 0;
for (const [label, a, b] of [
  ['no rail check', 'if (!NS.Rail || !NS.Rail.isRail(state)) return false;', ''],
  ['no name', 'cart.customName = cartTag.display.Name;', ''],
  ['no ascend offset', '? 0.5 : 0)', '? 0 : 0)'],
  ['item never spent', 'NS.Inventory.shrink(stack, 1);\n      return true;\n    }\n\n    // ── spawn egg ON', 'return true;\n    }\n\n    // ── spawn egg ON'],
]) {
  let m = false;
  const f = scenarios((fn, src) => { if (fn !== '14l_use.js') return src; if (src.includes(a)) m = true; return src.split(a).join(b); });
  if (!m) { real.push('anti-vacuity: edit matched nothing: ' + label); continue; }
  if (f.length) breaks++; else real.push('anti-vacuity: unnoticed: ' + label);
}
if (real.length) { console.log('FAIL'); real.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
