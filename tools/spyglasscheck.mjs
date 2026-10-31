#!/usr/bin/env node
// spyglasscheck.mjs — #188: SpyglassItem use state (1200 ticks, SPYGLASS), sounds, scoped FOV 0.1.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
  '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07f_redstone.js',
  '07h_entities.js', '07i_entitylist.js', '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
  '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js', '14kb_fovmult.js'];
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

const player = () => ({
  inventory: Iv.create(), slot: 0, instabuild: false, usingItem: false, useHand: 0, useTicks: 0,
  x: 0, y: 64, z: 0, ex: 0, ey: 64, ez: 0, EYE: 1.62, onGround: true, handsBusy: false,
  heldItem() { return Iv.getItem(this.inventory, this.slot); }, lookVec() { return [0, 0, -1]; },
});
const FM = MCL.FovMult;
function run() {
  const f = [];
  const ok = (c, m) => { if (!c) f.push(m); };
  const snd = []; MCL.Sound = { play: (n) => snd.push(n) };
  const sg = Iv.stack('spyglass', 1), P = player();
  Iv.setItem(P.inventory, 0, sg);
  ok(Use.getMaxUseTime(sg) === 1200, 'maxUseTime 1200');
  ok(Use.getUseAction(sg) === Use.UseAction.SPYGLASS, 'action SPYGLASS');
  ok(Use.spyglassStart(P, sg) && P.usingItem && Use.isUsingSpyglass(P), 'start');
  ok(snd[0] === 'item.spyglass.use', 'use sound');
  ok(FM.target(0.1, 0.1, false, 1, true) === Math.fround(0.1), 'scoped fov 0.1');
  ok(FM.target(0.1, 0.1, false, 1, false) === 1, 'unscoped fov 1');
  Use.holdStop(P);
  ok(snd[1] === 'item.spyglass.stop_using' && !P.usingItem && !Use.isUsingSpyglass(P), 'stop sound + clear');
  Use.spyglassStart(P, sg); Use.holdTick(P, 1200);
  ok(snd[3] === 'item.spyglass.stop_using' && !P.usingItem, 'finish sound at 1200');
  return f;
}
const clean = run();
if (clean.length) { console.log('FAIL ' + clean.join('; ')); process.exit(1); }
const saved = [Use.spyglassStart, Use.getMaxUseTime, FM.target, Use.stoppedHandlers.spyglass];
let caught = 0;
const brk = [() => { Use.spyglassStart = () => false; }, () => { Use.getMaxUseTime = () => 0; },
  () => { FM.target = () => 1; }, () => { Use.stoppedHandlers.spyglass = () => false; }];
brk.forEach((b) => {
  b(); if (run().length) { caught++; console.log('✓ break caught'); }
  [Use.spyglassStart, Use.getMaxUseTime, FM.target, Use.stoppedHandlers.spyglass] = saved;
});
console.log('spyglasscheck: 8 assertions, 0 failures, ' + caught + ' breaks caught');
if (caught !== brk.length) process.exit(1);
