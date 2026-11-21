#!/usr/bin/env node
// simpleinventorycheck.mjs — #11688: net/minecraft/inventory/SimpleInventory (VB.invAddStack, the
// villager's 8-slot `MerchantEntity.inventory`) proven through the real entry point
// NS.VBGather.lootTick (VB.tick calls it every tick): top up partial stacks, then first empty slot,
// remainder stays on the floor; the check then cuts the merge/capacity logic and must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
console.log('simpleinventorycheck — SimpleInventory via villager loot pickup');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
  '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js',
  '14l_use.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js',
  '07k_goals.js', '07zv_villagerbrain.js', '07zv2_vbplay.js', '07zv4_vbidle.js', '07zv5_vbbreed.js',
  '07zv6_vbgather.js', '07zx_particle.js', '07zt_wtrader.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Entities.attrs = M.DATA.entities.attrs;
M.Effects.ready = true;
M.Breed.init();

const W = M.World, CH = M.CH, R = M.Reg, SR = M.States;
const Poi = M.Poi, Ai = M.Ai, VB = M.VB, EL = M.EntityList, Prof = M.Profession;
const Gt = M.VBGather, IT = M.Items;

ok(VB, 'NS.VB did not load');
ok(Gt && typeof Gt.tick === 'function' && typeof Gt.lootTick === 'function', 'NS.VBGather did not load (src/07zv6_vbgather.js)');
if (!VB || !Gt) { console.log('\nFAIL vbgathercheck — module missing'); process.exit(1); }

W.init(1);
M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init();
Ai.init();
Prof.init();
ok(Ai.ready, 'Ai module reports ready');

for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const STONE = SR.stateOf('stone');
const PLAT_Y = 63;
function plate(radius, y) { for (let x = -radius; x <= radius; x++) for (let z = -radius; z <= radius; z++) W.setBlock(x, y, z, STONE); }
plate(30, PLAT_Y);

function spawnVillager(x, y, z, profession) {
  const v = EL.spawn('villager', x, y, z);
  v.ai = new Ai.GoalSelector();
  v.profession = profession || 'none';
  return v;
}
function giveItem(e, name, count) {
  const inv = VB.ensureVillagerInventory(e);
  const idx = IT.of(name);
  for (let i = 0; i < inv.length; i++) if (!inv[i]) { inv[i] = { i: idx, n: count }; return; }
}
function invCountOf(e, name) {
  const inv = e.villagerInventory || [];
  const idx = IT.of(name);
  let n = 0;
  for (const st of inv) if (st && st.i === idx) n += st.n;
  return n;
}
function dropItem(x, y, z, name, count) {
  const e = EL.spawn('item', x, y, z, { item: IT.of(name), count });
  e.pickupDelay = 0;   // EL.spawn's own default (10, 07i_entitylist.js:540) would otherwise
  return e;             // refuse Gt.lootTick's own `(o.pickupDelay | 0) > 0` gate for several
                         // ticks — this check calls Gt.lootTick directly, without a real tick
                         // loop to count it down (entlistcheck.mjs's own convention, same gate).
}
function itemEntitiesOf(name) {
  const idx = IT.of(name);
  // EL.dropStack (the SAME call Gt's own giveItemTo/farmerAdditionalWork use) stores e.item as
  // the NAME STRING it was passed, not the numeric index a direct EL.spawn('item',...,{item:
  // idx}) uses (07i_entitylist.js's own two call shapes) -- match either.
  return EL.list.filter((o) => o.type === 'item' && !o.removed && (o.item === idx || o.item === name));
}
function totalOf(name) { return itemEntitiesOf(name).reduce((n, o) => n + (o.count | 0), 0); }


function scenario() {
  const res = {};
  const run = (fn) => { for (const o of EL.list.slice()) if (o.type === 'item') EL.remove(o); const v = spawnVillager(0, PLAT_Y + 1, 0, 'none'); return fn(v); };
  const bread = IT.of('bread');
  // a) merge into partial stack, remainder to empty slot
  run((v) => {
    const inv = VB.ensureVillagerInventory(v); inv[0] = { i: bread, n: 60 };
    dropItem(0.2, PLAT_Y + 1, 0, 'bread', 10); Gt.lootTick(v);
    res.merge = inv[0] && inv[0].n; res.spill = inv[1] && inv[1].n;
  });
  // b) full inventory: nothing taken, entity stays with full count
  run((v) => {
    const inv = VB.ensureVillagerInventory(v);
    for (let i = 0; i < inv.length; i++) inv[i] = { i: bread, n: 64 };
    const it = dropItem(0.2, PLAT_Y + 1, 0, 'bread', 7); Gt.lootTick(v);
    res.fullLeft = it.count; res.fullRemoved = !!it.removed;
  });
  // c) partial room: 3 free in the only non-full slot -> takes 3, 4 stay
  run((v) => {
    const inv = VB.ensureVillagerInventory(v);
    for (let i = 0; i < inv.length; i++) inv[i] = { i: bread, n: 64 };
    inv[3].n = 61;
    const it = dropItem(0.2, PLAT_Y + 1, 0, 'bread', 7); Gt.lootTick(v);
    res.partTaken = inv[3].n; res.partLeft = it.count;
  });
  // d) per-item max stack: direct addStack with a 16-stack item
  run((v) => {
    const left = VB.invAddStack(v, 'snowball', 40);
    const inv = VB.ensureVillagerInventory(v);
    res.s16 = [inv[0] && inv[0].n, inv[1] && inv[1].n, inv[2] && inv[2].n, left].join(',');
  });
  return res;
}
function verify(r, tag) {
  ok(r.merge === 64 && r.spill === 6, tag + ': partial stack topped up to 64, 6 spill to first empty slot, got ' + r.merge + '/' + r.spill);
  ok(r.fullLeft === 7 && !r.fullRemoved, tag + ': full inventory takes nothing, got left=' + r.fullLeft);
  ok(r.partTaken === 64 && r.partLeft === 4, tag + ': only what fits taken, got ' + r.partTaken + '/' + r.partLeft);
  ok(r.s16 === '16,16,8,0', tag + ': 16-stack item split 16,16,8, got ' + r.s16);
}
verify(scenario(), 'real');

// anti-vacuity: cut the SimpleInventory logic in three ways; each must be caught
const real = VB.invAddStack;
let breaks = 0;
function cut(name, impl) {
  VB.invAddStack = impl;
  const before = fails.length;
  verify(scenario(), 'cut');
  const caught = fails.length > before;
  fails.length = before; pass = pass; VB.invAddStack = real;
  breaks++; ok(caught, 'anti-vacuity: break "' + name + '" not caught'); if (caught) console.log('   ✓ break caught: ' + name);
}
const mk = (opts) => (e, name, count) => {
  const inv = VB.ensureVillagerInventory(e), idx = IT.of(name);
  const max = opts.max ? opts.max(idx) : IT.maxStack(idx);
  if (!opts.noMerge) for (let i = 0; i < inv.length && count > 0; i++) { const st = inv[i]; if (st && st.i === idx && st.n < max) { const k = Math.min(max - st.n, count); st.n += k; count -= k; } }
  for (let j = 0; j < inv.length && count > 0; j++) if (!inv[j]) { const m = Math.min(max, count); inv[j] = { i: idx, n: m }; count -= m; }
  return opts.swallow ? 0 : count;
};
cut('no merge into partial stacks', mk({ noMerge: true }));
cut('always max 64', mk({ max: () => 64 }));
cut('overflow swallowed', mk({ swallow: true }));
cut('no-op addStack', () => 0);
cut('everything fits nowhere', (e, n, c) => c);
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}\n ${breaks} breaks caught`);
if (fails.length) { for (const f of fails) console.log('  FAIL ' + f); console.log(`\nFAIL simpleinventorycheck (${fails.length})`); process.exit(1); }
console.log(`\nPASS simpleinventorycheck — ${pass} checks`);
