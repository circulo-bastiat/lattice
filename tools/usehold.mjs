#!/usr/bin/env node
// usehold.mjs — G19d-a (#176): the generic use-item hold. Proves `Use.getMaxUseTime`/
// `Use.getUseAction` are `Item.getMaxUseTime`/`getUseAction` (.decomp Item.java:247-257 plus the
// PotionItem/HoneyBottleItem/MilkBucketItem/ShieldItem/BowItem overrides), that the hold counts
// whole ticks and FINISHES at 0, and that an early release runs onStoppedUsing only.
//   node tools/usehold.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
  '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js',
  '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
  '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
const W = { getBlock: () => 0, setBlock: () => true, blockLightAt: () => 15 };
MCL.World = W;
MCL.Behave.init(W); MCL.BlockEntities.init(); MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
if (MCL.Entities && MCL.Entities.init) MCL.Entities.init();
MCL.EntityList.init(); MCL.Combat.init(); MCL.Use.init(W);
const Iv = MCL.Inventory, Use = MCL.Use;

let total = 0;
const player = () => ({
  inventory: Iv.create(), slot: 0, instabuild: false, usingItem: false, useHand: 0, useTicks: 0,
  ex: 0, ey: 64, ez: 0, EYE: 1.62, vx: 0, vy: 0, vz: 0, onGround: true, handsBusy: false,
  heldItem() { return Iv.getItem(this.inventory, this.slot); }, lookVec() { return [0, 0, -1]; },
});

/** Every assertion; returns the list of failures so the anti-vacuity pass can count them. */
function run() {
  const f = [];
  const ok = (c, m) => { total++; if (!c) f.push(m); };
  const U = Use.UseAction;
  const table = [['apple', 32, U.EAT], ['dried_kelp', 16, U.EAT], ['potion', 32, U.DRINK],
    ['honey_bottle', 40, U.DRINK], ['milk_bucket', 32, U.DRINK], ['mushroom_stew', 32, U.EAT],
    ['suspicious_stew', 32, U.EAT], ['bow', 72000, U.BOW], ['shield', 72000, U.BLOCK],
    ['stick', 0, U.NONE]];
  for (const [n, t, a] of table) {
    const s = Iv.stack(n, 1, 0);
    ok(Use.getMaxUseTime(s) === t, `${n} max use time ${Use.getMaxUseTime(s)} want ${t}`);
    ok(Use.getUseAction(s) === a, `${n} use action ${Use.getUseAction(s)} want ${a}`);
  }
  // finish at 0: 32 ticks of an apple, never before
  {
    const P = player(); let fin = 0;
    Use.finishHandlers.apple = () => { fin++; };
    Iv.setItem(P.inventory, 0, Iv.stack('apple', 1, 0));
    ok(Use.holdBegin(P, P.heldItem(), 0) && P.usingItem && P.handsBusy, 'apple hold begins');
    ok(Use.holdTick(P, 31) === 'hold' && fin === 0 && P.usingItem, '31 ticks: still holding, not finished');
    ok(Use.holdTick(P, 1) === 'finish' && fin === 1 && !P.usingItem && !P.handsBusy, '32nd tick finishes once and clears');
    delete Use.finishHandlers.apple;
  }
  // early release: onStoppedUsing only, finishUsing never
  {
    const P = player(); let fin = 0, stopped = -1;
    Use.finishHandlers.apple = () => { fin++; };
    Use.stoppedHandlers.apple = (p, s, rem) => { stopped = rem; };
    Iv.setItem(P.inventory, 0, Iv.stack('apple', 1, 0));
    Use.holdBegin(P, P.heldItem(), 0);
    Use.holdTick(P, 10);
    Use.holdStop(P);
    ok(fin === 0, 'early release never finishes');
    ok(stopped === 22, `onStoppedUsing got remaining ${stopped}, want 22`);
    ok(!P.usingItem && !P.handsBusy && P.useTicks === 0, 'early release clears the hold');
    delete Use.finishHandlers.apple; delete Use.stoppedHandlers.apple;
  }
  // frame-time clock is integer ticks: 31 frames of 1/20 s + a half tick does not finish
  {
    const P = player(); let fin = 0;
    Use.finishHandlers.potion = () => { fin++; };
    Iv.setItem(P.inventory, 0, Iv.stack('potion', 1, 0));
    Use.holdBegin(P, P.heldItem(), 0);
    for (let i = 0; i < 31; i++) Use.holdAdvance(P, 0.05);
    Use.holdAdvance(P, 0.025);
    ok(fin === 0 && P.useTicks === 31, `31.5 ticks -> ${P.useTicks} whole ticks, unfinished`);
    Use.holdAdvance(P, 0.025);
    ok(fin === 1, 'the 32nd whole tick finishes');
    delete Use.finishHandlers.potion;
  }
  // a non-usable item cannot start a hold; the bow rides the same machine
  {
    const P = player();
    ok(!Use.holdBegin(P, Iv.stack('stick', 1, 0), 0) && !P.usingItem, 'a stick has no hold');
    Iv.setItem(P.inventory, 0, Iv.stack('bow', 1, 0)); Iv.setItem(P.inventory, 5, Iv.stack('arrow', 3));
    ok(Use.bowStart(P, P.heldItem()) && P.useMax === 72000, 'bowStart goes through holdBegin (useMax 72000)');
    Use.holdTick(P, 20);
    ok(Use.holdStop(P) === true && !P.usingItem, 'bow early release fires via stoppedHandlers.bow');
  }
  return f;
}

console.log('usehold — G19d-a: the generic use-item hold');
const real = run(); const asserted = total;
let bad = real.length;
for (const m of real) console.log('  ✗ ' + m);

// anti-vacuity: each mutation of the machine must make run() fail
let breaks = 0, missed = 0;
const savedMax = Use.getMaxUseTime, savedStop = Use.holdStop, savedTick = Use.holdTick;
const mutate = (name, apply, restore) => {
  apply(); const n = run().length; restore();
  if (n > 0) { breaks++; console.log('  ✓ break caught: ' + name); } else { missed++; console.log('  ✗ anti-vacuity: mutation not caught: ' + name); }
};
mutate('instant hold (getMaxUseTime 0)', () => { Use.getMaxUseTime = () => 0; }, () => { Use.getMaxUseTime = savedMax; });
mutate('early release finishes', () => { Use.holdStop = (P) => Use.holdFinish(P); }, () => { Use.holdStop = savedStop; });
mutate('finish one tick late', () => { Use.holdTick = (P, t) => { P.useTicks = (P.useTicks | 0) + t; if (P.useMax - P.useTicks < 0) { Use.holdFinish(P); return 'finish'; } return 'hold'; }; }, () => { Use.holdTick = savedTick; });
bad += missed;
console.log(`${breaks} breaks caught`);
console.log(`usehold: ${asserted} assertions, ${bad} failures, ${breaks} breaks caught`);
if (bad) { console.log(`${bad} failed`); process.exit(1); }
console.log('ok — the hold machine holds');
