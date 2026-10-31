#!/usr/bin/env node
// offhandshieldcheck.mjs — #10750, a SHIELD raised from the OFFHAND (useHand 1): isBlocking reads the
// active hand's stack, 5-tick warmup, durability comes off the offhand stack, axe disable clears it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const load = (patch) => {
  const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07y_equip.js', '14j_combat.js', '14d_survival.js', '14l_use.js'], patch });
  M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  if (M.Equip.init) M.Equip.init();
  return M;
};
function scenario(NS) {
  const Sv = NS.Survival, Use = NS.Use, Iv = NS.Inventory;
  NS.Sound = { play: () => {} };
  const mk = () => {
    const P = { x: 0, y: 64, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, onGround: true, slot: 0, instabuild: false };
    P.inventory = Iv.create ? Iv.create() : Iv.newInventory();
    Sv.init(P);
    Iv.setItem(P.inventory, Iv.OFFHAND, Iv.stack('shield', 1, 0));
    return P;
  };
  const front = { type: 'zombie', x: 0, y: 64, z: -2 };
  const out = {};
  let P = mk();
  out.start = Use.shieldStart(P, Iv.getItem(P.inventory, Iv.OFFHAND), 1);
  out.hand = P.useHand;
  P.useTicks = 4; out.warm = Use.isBlocking(P);
  P.useTicks = 5; out.up = Use.isBlocking(P);
  let h = P.health; Sv.hurt(P, 'mob', 4, front); out.frontHealth = h - P.health;
  out.dur = (Iv.getItem(P.inventory, Iv.OFFHAND) || {}).d;
  out.mainUntouched = !Iv.getItem(P.inventory, 0) || Iv.isEmpty(Iv.getItem(P.inventory, 0));
  P = mk(); Use.shieldStart(P, Iv.getItem(P.inventory, Iv.OFFHAND), 1); P.useTicks = 5;
  Use.disableShield(P, true, () => 0.5);
  out.axe = !P.usingItem && P.shieldCooldown === 100;
  P = mk(); Use.shieldStart(P, Iv.getItem(P.inventory, Iv.OFFHAND), 1); P.useTicks = 5;
  Iv.setItem(P.inventory, Iv.OFFHAND, null);
  out.gone = Use.isBlocking(P);
  return out;
}
console.log('offhandshieldcheck — #10750');
const r = scenario(load());
ok(r.start && r.hand === 1, 'offhand shield raise starts with useHand 1');
ok(!r.warm, '4 ticks: not blocking');
ok(r.up, '5 ticks: blocking from the offhand');
ok(r.frontHealth === 0, 'frontal hit blocked by offhand shield');
ok(r.dur === 5, 'durability comes off the offhand stack');
ok(r.mainUntouched, 'main hand untouched');
ok(r.axe, 'axe disable drops the offhand guard for 100 ticks');
ok(!r.gone, 'emptying the offhand ends blocking');
const brk = (name, from, to, key, want) => {
  let hit = false, rr;
  try { rr = scenario(load((f, s) => { if (f === '14l_use.js' && s.includes(from)) { hit = true; return s.replace(from, to); } return s; })); } catch (e) { rr = null; }
  const caught = hit && (!rr || String(rr[key]) !== String(want));
  if (caught) { breaks++; console.log('   ✓ ' + name + ' caught'); } else fails.push('anti-vacuity: "' + name + '" not caught (matched=' + hit + ')');
};
brk('mainhand only slot', '(P.useHand === 1) ? NS.Inventory.OFFHAND : P.slot', 'P.slot', 'up', true);
brk('hand arg ignored', "P.useHand = hand === 1 ? 1 : 0; P.useTicks = 0; P.handsBusy = true;\n    return true;\n  };\n  Use.shieldStack", "P.useHand = 0; P.useTicks = 0; P.handsBusy = true;\n    return true;\n  };\n  Use.shieldStack", 'hand', 1);
brk('no warmup', 'P.useTicks >= Use.SHIELD_WARMUP_TICKS', 'true', 'warm', false);
brk('no durability', 'st.d = (st.d | 0) + n;', '', 'dur', 5);
console.log('   ' + pass + ' checks passed, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
if (fails.length) { for (const f of fails) console.log('   ✗ ' + f); process.exit(1); }
