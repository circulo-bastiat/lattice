#!/usr/bin/env node
// playerheadcheck.mjs — #635: the third-person player carries the head-slot item (skull, pumpkin, banner ...) in
// e.equip[HEAD] for HeadFeatureRenderer, and the inventory preview keeps a non-armour head item.
import { loadEngine } from './loadsrc.mjs';
const M = loadEngine({ extra: ['07j_entityrender.js'], dom: false });
const ER = M.EntityRender;
const IT = { ready: true, MAINHAND: 0, OFFHAND: 1, FEET: 2, LEGS: 3, CHEST: 4, HEAD: 5, nameOf: (i) => ['air', 'skeleton_skull', 'diamond_helmet', 'stick'][i],
  isArmor: (i) => i === 2 };
M.Items = IT;
M.Inventory = { OFFHAND: 40, ARMOR_START: 36 };
const mk = (head) => { const sl = []; sl[36 + 3] = head; sl[0] = { i: 3, n: 1 };
  M.Player = { ex: 0, ey: 0, ez: 0, yaw: 0, pitch: 0, slot: 0, thirdPerson: 1, inventory: { slots: sl }, ...{} }; };
let pass = 0, fails = 0;
const ok = (c, m) => { if (c) pass++; else { fails++; console.log('FAIL ' + m); } };
function run(equipGet) {
  const r = [];
  mk({ i: 1, n: 1 }); r.push(equipGet()?.i === 1);   // skull on head
  mk({ i: 2, n: 1 }); r.push(equipGet()?.i === 2);   // helmet on head
  mk(null);           r.push(equipGet() === null);    // nothing
  mk({ i: -1, n: 0 });r.push(equipGet() === null);    // empty stack
  return r;
}
const real = () => ER.playerEntity(1).equip[IT.HEAD];
const r = run(real);
r.forEach((v, i) => ok(v, 'third-person head case ' + i));
mk({ i: 1, n: 1 });
ok(ER.playerPreviewEntity().equip[IT.HEAD]?.i === 1, 'preview keeps the skull');
mk({ i: 2, n: 1 });
ok(ER.playerPreviewEntity().equip[IT.HEAD]?.i === 2, 'preview keeps the helmet');
// anti-vacuity: broken variants must be rejected by the same grading
let caught = 0;
for (const bad of [() => null, () => ({ i: 3 }), () => { const e = ER.playerEntity(1).equip[IT.HEAD]; return e ? { i: 2 } : null; }, () => ER.playerEntity(1).equip[IT.CHEST]]) if (!run(bad).every(Boolean)) caught++;
console.log(pass + ' assertions, ' + fails + ' failures, ' + caught + ' breaks caught');
process.exit(fails || caught !== 4 ? 1 : 0);
