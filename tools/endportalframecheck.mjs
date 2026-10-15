#!/usr/bin/env node
// endportalframecheck.mjs — #5084. EnderEyeItem.useOnBlock via Use.itemUseOn: fill frame, 12th eye opens the 3x3 end_portal; wrong facing / 11 eyes do not.
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
  '07n_tame.js', '07q_effects.js', '07zw_mobnbt.js', '07zzq_rail.js', '07zzr_minecart.js', '07f_redstone.js'];

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
  M.EntityList.init(); M.Use.init(W); if (M.Redstone.init) M.Redstone.init(W);
  const { Inventory: Iv, EntityList: EL, Use, Reg: R, Behave: B } = M;
  const def = (nm) => R.realFirst[R.id[nm]] + R.defaultState[R.id[nm]];
  const P = (insta) => ({ inventory: Iv.create(), slot: 0, instabuild: insta, ey: 65.62, EYE: 1.62, ez: 0, ex: 0, lookVec: () => [0, 0, 1], syncHotbar() {} });
  const use = (p, name, x, y, z) => { Iv.setItem(p.inventory, 0, Iv.stack(name, 2, 0, null)); EL.list.length = 0;
    const r = Use.itemUseOn(p, x, y, z, 2, W.getBlock(x, y, z), Iv.getItem(p.inventory, 0)); return { r, s: Iv.getItem(p.inventory, 0), c: EL.list.find((e) => e.type === name) }; };
  const FACE = { '-2,0': 'east', '2,0': 'west', '0,-2': 'south', '0,2': 'north' };
  const ring = []; for (let i = -1; i <= 1; i++) ring.push([i, -2], [i, 2], [-2, i], [2, i]);
  const build = (bad) => { cells.clear(); ring.forEach(([a, b], n) => { let f = FACE[(a === -2 ? -2 : a === 2 ? 2 : 0) + ',' + (b === -2 ? -2 : b === 2 ? 2 : 0)];
    if (bad && n === 0) f = 'north' === f ? 'east' : 'north'; W.setBlock(20 + a, 64, 20 + b, B.setProp(def('end_portal_frame'), 'facing', f)); }); };
  const portals = () => { let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (W.getBlock(20 + a, 64, 20 + b) === def('end_portal')) n++; return n; };
  const fill = (p, upto) => { for (let n = 0; n < upto; n++) { const [a, b] = ring[n]; Iv.setItem(p.inventory, 0, Iv.stack('ender_eye', 1, 0, null)); Use.itemUseOn(p, 20 + a, 64, 20 + b, 1, W.getBlock(20 + a, 64, 20 + b), Iv.getItem(p.inventory, 0)); } };
  let p = P(false); build(false); fill(p, 11);
  ok(portals() === 0, '11 eyes: portal stays closed');
  fill(Object.assign(p), 0);
  { const [a, b] = ring[11]; Iv.setItem(p.inventory, 0, Iv.stack('ender_eye', 2, 0, null)); Use.itemUseOn(p, 20 + a, 64, 20 + b, 1, W.getBlock(20 + a, 64, 20 + b), Iv.getItem(p.inventory, 0));
    ok(portals() === 9, '12th eye opens 9 portal blocks'); ok(Iv.getItem(p.inventory, 0).n === 1, 'eye consumed'); }
  build(true); p = P(false); fill(p, 12); ok(portals() === 0, 'one frame facing wrong: no portal');
  build(false); p = P(true); { const [a, b] = ring[0]; Iv.setItem(p.inventory, 0, Iv.stack('ender_eye', 3, 0, null)); Use.itemUseOn(p, 20 + a, 64, 20 + b, 1, W.getBlock(20 + a, 64, 20 + b), Iv.getItem(p.inventory, 0));
    ok(Iv.getItem(p.inventory, 0).n === 3, 'creative keeps the stack'); ok(B.propName(W.getBlock(20 + a, 64, 20 + b), 'eye') === 'true', 'frame filled');
    ok(M.Redstone.analogOutput(20 + a, 64, 20 + b, W.getBlock(20 + a, 64, 20 + b)) === 15, 'comparator reads 15'); }
  return fails.slice();
}
const real = scenarios();
let breaks = 0;
for (const [label, a, b] of [
  ['no facing predicate', "|| prop(fs, 'facing') !== inward", "|| false && prop(fs, 'facing') !== inward"],
  ['opens at 11 eyes', "|| prop(fs, 'eye') !== 'true'", "|| false"],
]) {
  let m = false;
  const f = scenarios((fn, src) => { if (fn !== '14l_use.js') return src; if (src.includes(a)) m = true; return src.split(a).join(b); });
  if (!m) { real.push('anti-vacuity: edit matched nothing: ' + label); continue; }
  if (f.length) breaks++; else real.push('anti-vacuity: unnoticed: ' + label);
}
if (real.length) { console.log('FAIL'); real.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`${pass} assertions, 0 failures, ${breaks} breaks caught`);
