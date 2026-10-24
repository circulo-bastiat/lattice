#!/usr/bin/env node
// bowfovcheck.mjs — #7883: bow-draw FOV zoom in getFovMultiplier (f *= 1 - g*0.15, g = min(1, (t/20)^2)).
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
const Iv = MCL.Inventory, FM = MCL.FovMult;
let pass = 0; const fails = [];
const near = (a, b) => Math.abs(a - b) < 1e-4;
const mk = (item, using, t) => {
  const inv = Iv.create();
  Iv.setItem(inv, 0, Iv.stack(item, 1));
  return { inventory: inv, slot: 0, usingItem: using, useHand: 0, useTicks: t, sprinting: false };
};
function run() {
  const f = (p) => FM.target(FM.speedAttr(p), FM.WALK_SPEED, false, 1, false, MCL.Use.bowUseTicks(p));
  const want = [[0, 1], [5, 0.99063], [10, 0.9625], [20, 0.85], [40, 0.85]];
  for (const [t, w] of want) { const g = f(mk('bow', true, t)); if (near(g, w)) pass++; else fails.push(`bow t=${t}: ${g} != ${w}`); }
  for (const [n, p] of [['crossbow', mk('crossbow', true, 20)], ['bow idle', mk('bow', false, 20)]]) {
    const g = f(p); if (near(g, 1)) pass++; else fails.push(`${n} should be 1, got ${g}`);
  }
}
run();
const clean = fails.length === 0;
const saved = FM.BOW_ZOOM; let caught = 0;
FM.BOW_ZOOM = 0.2; fails.length = 0; run(); if (fails.length) caught++;
if (caught) console.log("✓ break caught");
FM.BOW_ZOOM = saved; fails.length = 0; if (!clean) { run(); }
console.log(`bowfovcheck: ${pass} assertions, ${fails.length} failures, ${caught} breaks caught`);
if (!clean || caught < 1) { console.log('FAIL'); process.exit(1); }
