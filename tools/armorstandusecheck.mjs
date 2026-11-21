#!/usr/bin/env node
// armorstandusecheck.mjs -- #4391: ArmorStandItem placement yaw, ArmorStandEntity.interactAt (slot from height, swap,
// disabledSlots, showArms), headless.
// Anti-vacuity: the same scenarios run on engines whose source text is edited; each must produce failures.
import { loadEngine } from './loadsrc.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSETS } from './loadsrc.mjs';

console.log('armorstandusecheck -- #4391, armor_stand placement / interaction ');

function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); return c; };
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07y_equip.js', '07zzt_armorstand.js'], dom: false, patch });
  const A = M.ArmorStand, Eq = M.Equip, IT = M.Items, Iv = M.Inventory;
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  Eq.init();
  const sounds = [], drops = [], removed = [];
  M.Sound = { play: (ev, o) => sounds.push([ev, o.volume, o.pitch]) };
  M.EntityList = {
    canSpawn: () => true, random: () => 0.5,
    spawn: (t, x, y, z) => ({ type: t, x, y, z, yaw: 0 }),
    dropStack: (x, y, z, item, c) => drops.push([item, c, y]),
    remove: (e) => { e.removed = true; removed.push(e); },
  };
  const stand = (o) => Object.assign({ type: 'armor_stand', x: 5.5, y: 64, z: 5.5, health: 20 }, o);
  const P = () => ({ inventory: Iv.create(), slot: 0, instabuild: false, yaw: 0 });
  const give = (p, name, n = 1) => Iv.setItem(p.inventory, 0, Iv.stack(name, n, 0));
  const held = (p) => Iv.getItem(p.inventory, 0);
  const helmet = IT.of('iron_helmet'), cheast = IT.of('iron_chestplate');

  // placement: yaw snapped to 45 degrees, one item spent, place sound 0.75/0.8
  for (const [deg, want] of [[0, 180], [10, 180], [30, 225], [90, 270]]) {
    const p = P(); p.yaw = deg * Math.PI / 180; give(p, 'armor_stand', 2);
    const r = A.place(p, held(p), 3, 64, 3);
    const e = r && M.EntityList.last;
    ok(r === true && held(p).n === 1, 'place spends one item (yaw ' + deg + ')');
  }
  { const p = P(); p.yaw = 30 * Math.PI / 180; give(p, 'armor_stand'); let spawned;
    const sp = M.EntityList.spawn; M.EntityList.spawn = (...a) => (spawned = sp(...a));
    sounds.length = 0; A.place(p, held(p), 3, 64, 3);
    ok(Math.abs(spawned.yaw * 180 / Math.PI - 225) < 1e-6, 'yaw 30 snaps to 225 (45-degree steps), got ' + (spawned.yaw * 180 / Math.PI));
    ok(spawned.x === 3.5 && spawned.z === 3.5, 'placed at cell centre');
    ok(sounds[0] && sounds[0][0] === 'entity.armor_stand.place' && sounds[0][1] === 0.75 && Math.abs(sounds[0][2] - 0.8) < 1e-9, 'place sound 0.75/0.8');
    { const p2 = P(); give(p2, 'armor_stand', 2); M.EntityList.list = [{ type: 'cow', x: 3.5, y: 64, z: 3.5, width: 0.9, height: 1.4 }];
      ok(A.place(p2, held(p2), 3, 64, 3) === false && held(p2).n === 2, 'entity in the box blocks placement, nothing spent');
      M.EntityList.list = [{ type: 'cow', x: 6.5, y: 64, z: 3.5, width: 0.9, height: 1.4 }];
      ok(A.place(p2, held(p2), 3, 64, 3) === true, 'entity beside the box does not block'); M.EntityList.list = []; }
    const c = P(); c.instabuild = true; give(c, 'armor_stand'); A.place(c, held(c), 3, 64, 3);
    ok(held(c).n === 1, 'creative does not spend'); M.EntityList.spawn = sp; }

  // slotFromPosition
  { const e = stand(); Eq.setEquipped(e, 2, { i: IT.of('iron_boots'), n: 1 }); Eq.setEquipped(e, 3, { i: IT.of('iron_leggings'), n: 1 });
    Eq.setEquipped(e, 4, { i: cheast, n: 1 }); Eq.setEquipped(e, 5, { i: helmet, n: 1 });
    ok(A.slotFromPosition(e, 0.2) === 2, 'y 0.2 -> feet'); ok(A.slotFromPosition(e, 0.5) === 2, 'y 0.5 still feet (window to 0.55)');
    ok(A.slotFromPosition(e, 1.0) === 4, 'y 1.0 -> chest'); ok(A.slotFromPosition(e, 1.7) === 5, 'y 1.7 -> head');
    ok(A.slotFromPosition(e, 0.7) === 3, 'y 0.7 -> legs'); ok(A.slotFromPosition(e, 0.05) === 0, 'y 0.05 -> mainhand');
    e.small = true; ok(A.slotFromPosition(e, 0.2) === 2 && A.slotFromPosition(e, 0.3) === 4 && A.slotFromPosition(e, 0.9) === 5 || A.slotFromPosition(e, 0.9) === 4, 'small stand doubles the height'); }

  // interact: equip armour, swap, disabledSlots, hands need arms
  { const e = stand(), p = P(); give(p, 'iron_helmet');
    ok(A.interact(e, p, held(p), 1) === true && Eq.getEquipped(e, 5).i === helmet && Iv.isEmpty(held(p)), 'helmet goes on the head slot, hand emptied');
    ok(A.interact(e, p, held(p), 1.7) === true && Iv.isEmpty(Eq.getEquipped(e, 5) || Iv.EMPTY) && held(p).i === helmet, 'empty hand at head height takes it back');
    give(p, 'iron_helmet', 3); A.interact(e, p, held(p), 1);
    ok(Eq.getEquipped(e, 5).n === 1 && held(p).n === 2, 'a stack of 3 gives one');
    ok(A.interact(e, p, held(p), 1) === false && held(p).n === 2, 'full slot + stack: PASS, nothing moves');
    const q = P(); give(q, 'iron_chestplate'); const d = stand({ disabledSlots: 1 << 3 });
    ok(A.interact(d, q, held(q), 1) === true && !Eq.getEquipped(d, 4) && held(q).n === 1, 'disabled slot refuses (FAIL)');
    const f = stand(); give(q, 'stick'); ok(A.interact(f, q, held(q), 1) === true && !Eq.getEquipped(f, 0), 'hand slot needs showArms');
    f.showArms = true; A.interact(f, q, held(q), 1); ok(Eq.getEquipped(f, 0) && Eq.getEquipped(f, 0).i === IT.of('stick'), 'with arms the stick is held');
    const m = stand({ marker: true }); give(q, 'iron_chestplate'); ok(A.interact(m, q, held(q), 1) === false, 'marker stand: PASS');
    const r = stand({ disabledSlots: 1 << (4 + 16) }), c = P(); give(c, 'iron_helmet');
    A.interact(r, c, held(c), 1); ok(!Eq.getEquipped(r, 5), 'put-on lock (bit+16) refuses'); }

  { const e = stand(), p = P(); give(p, 'iron_chestplate'); Iv.setItem(p.inventory, Iv.OFFHAND, held(p)); Iv.setItem(p.inventory, p.slot, Iv.EMPTY);
    ok(A.interact(e, p, held(p), 1) === true && Eq.getEquipped(e, 4) && Eq.getEquipped(e, 4).i === cheast && Iv.isEmpty(Iv.getItem(p.inventory, Iv.OFFHAND)), 'empty main hand PASS -> offhand chestplate dresses the stand'); }

  return { fails, n };
}

const real = scenarios();
const fails = real.fails.slice();
const breaksList = [
  ['yaw snap step 45 -> 30', '/ 45) * 45', '/ 30) * 30'],
  ['place sound volume', "0.75, 0.8, 'block'", "1, 0.8, 'block'"],
  ['disabledSlots ignored', '((e.disabledSlots | 0) & (1 << SLOT_ID[slot])) !== 0 ||', ''],
  ['showArms ignored', '(slot < 2 && !e.showArms)', 'false'],
  ['marker not PASS', 'if (e.marker || (stack', 'if ((stack'],
  ['small stand height not doubled', 'small ? hy * 2 : hy', 'hy'],
  ['offhand pass dropped', ' || interactHand(e, P, NS.Inventory.getItem', ' && 0 && interactHand(e, P, NS.Inventory.getItem'],
  ['entity box ignored', 'return false;\n    }\n    var rnd', '}\n    var rnd'],
  ['creative place spends', 'if (!P.instabuild && Iv', 'if (Iv'],
];
let breaks = 0;
for (const [label, a, b] of breaksList) {
  let matched = true;
  const patch = (f, src) => { if (f !== '07zzt_armorstand.js') return src; if (!src.includes(a)) matched = false; return src.split(a).join(b); };
  let r;
  try { r = scenarios(patch); } catch (err) { r = { fails: ['threw: ' + err.message] }; }
  if (!matched) { fails.push('anti-vacuity: the edit for "' + label + '" matched nothing'); continue; }
  if (r.fails.length > 0) { breaks++; console.log('   ✓ break caught: ' + label); }
  else fails.push('anti-vacuity: breaking "' + label + '" went unnoticed');
}
if (fails.length) { console.log('FAIL'); fails.forEach((f) => console.log('  ' + f)); process.exit(1); }
console.log(`armorstandusecheck: ${real.n} assertions, 0 failures, ${breaks} breaks caught`);
