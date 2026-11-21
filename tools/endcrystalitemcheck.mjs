#!/usr/bin/env node
// endcrystalitemcheck.mjs — #11690: net/minecraft/item/EndCrystalItem (EC.useOnBlock in
// src/07zzn_endcrystal.js) proven through the real entry point Use.itemUseOn (14l_use.js):
// obsidian/bedrock only, air above, empty 1x2 column, one item spent (creative keeps it).
// The check then cuts each rule and must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '14d_survival.js', '14j_combat.js', '07za_explosion.js', '07zzl_enderdragon.js',
  '07zzn_endcrystal.js', '07zw_mobnbt.js', '07c_blockentity.js', '07y_equip.js', '07m_breed.js',
  '07n_tame.js', '07q_effects.js', '14f_inventory.js', '14l_use.js'];
console.log('endcrystalitemcheck — EndCrystalItem via Use.itemUseOn');

function scenario(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false });
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
  M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
  M.Behave.init(M.World); M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
  if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
  M.EntityList.init(); M.Ai.init(); M.Spawn.init(); M.Combat.init(); M.Explosion.init(); M.EnderDragon.init(); M.EndCrystal.init();
  M.World.init(1);
  for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
    const c = M.World.makeChunk(cx, cz); c.state = M.CH.GENERATED; M.World.chunks.set(M.World.key(cx, cz), c);
  }
  M.Use.init(M.World);
  if (patch) patch(M);
  const W = M.World, S = M.States, EL = M.EntityList, Iv = M.Inventory;
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, ey: 65.62, EYE: 1.62, ex: 0, ez: 0, lookVec: () => [0, 0, 1], syncHotbar() {} };
  const n = () => EL.list.filter((e) => e && e.type === 'end_crystal' && !e.removed).length;
  const put = (x, y, z, nm) => W.setBlock(x, y, z, S.stateOf(nm) | 0);
  const use = (x, y, z, creative) => {
    P.instabuild = !!creative;
    Iv.setItem(P.inventory, 0, Iv.stack('end_crystal', 2, 0, null));
    const st = Iv.getItem(P.inventory, 0);
    return { r: M.Use.itemUseOn(P, x, y, z, 1, W.getBlock(x, y, z), st), count: st.n };
  };
  put(3, 60, 3, 'obsidian'); put(6, 60, 3, 'bedrock'); put(9, 60, 3, 'stone');
  put(12, 60, 3, 'obsidian'); put(12, 61, 3, 'stone'); put(15, 60, 3, 'obsidian');
  const f = []; const chk = (c, m) => { if (!c) f.push(m); };
  let t = use(3, 60, 3);
  chk(t.r === true && n() === 1 && t.count === 1, 'obsidian places, 2->1');
  const c1 = EL.list.find((e) => e && e.type === 'end_crystal');
  chk(c1 && c1.x === 3.5 && c1.y === 61 && c1.z === 3.5 && c1.showBottom === false, 'position/showBottom');
  t = use(3, 60, 3); chk(t.r === false && n() === 1 && t.count === 2, 'entity in column refuses');
  t = use(6, 60, 3); chk(t.r === true && n() === 2, 'bedrock accepted');
  t = use(9, 60, 3); chk(t.r === false && n() === 2 && t.count === 2, 'stone refuses');
  t = use(12, 60, 3); chk(t.r === false && n() === 2 && t.count === 2, 'block above refuses');
  t = use(15, 60, 3, true); chk(t.r === true && n() === 3 && t.count === 2, 'creative keeps the item');
  return f;
}
const base = scenario();
let breaks = 0; const fails = base.map((m) => 'baseline: ' + m);
const cut = (name, patch) => {
  const f = scenario(patch);
  if (f.length) breaks++; else fails.push('cut not caught: ' + name);
};
const orig = (M) => M.EndCrystal.useOnBlock;
cut('useOnBlock no-op', (M) => { M.EndCrystal.useOnBlock = () => false; });
cut('accepts any block', (M) => { const o = orig(M); M.EndCrystal.useOnBlock = (x, y, z) => { M.World.setBlock(x, y, z, M.States.stateOf('obsidian') | 0); return o(x, y, z); }; });
cut('ignores block above', (M) => { const o = orig(M); M.EndCrystal.useOnBlock = (x, y, z) => { const a = M.World.getBlock(x, y + 1, z); M.World.setBlock(x, y + 1, z, 0); const r = o(x, y, z); return r; }; });
cut('ignores entities', (M) => { const o = orig(M); M.EndCrystal.useOnBlock = (x, y, z) => { const l = M.EntityList.list.slice(); M.EntityList.list.length = 0; const r = o(x, y, z); for (const e of l) M.EntityList.list.push(e); return r; }; });
cut('wrong spawn height', (M) => { const o = orig(M); M.EndCrystal.useOnBlock = (x, y, z) => { const r = o(x, y, z); if (r) { const l = M.EntityList.list; l[l.length - 1].y += 1; } return r; }; });
cut('showBottom left true', (M) => { const o = orig(M); M.EndCrystal.useOnBlock = (x, y, z) => { const r = o(x, y, z); if (r) { const l = M.EntityList.list; l[l.length - 1].showBottom = true; } return r; }; });
console.log(` 7 assertions, ${fails.length} failures, ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); console.log('\nFAIL endcrystalitemcheck'); process.exit(1); }
console.log('PASS endcrystalitemcheck — 7 assertions, 0 failures, ' + breaks + ' breaks caught');
