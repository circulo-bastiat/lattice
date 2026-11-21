#!/usr/bin/env node
// blockxpcheck.mjs — G21c: block-break experience (OreBlock / SpawnerBlock.onStacksDropped) via Xp.blockXp.
// Ranges are parsed from .decomp Blocks.java, not retyped. Silk touch gives 0.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, '.decomp/net/minecraft/block/Blocks.java'), 'utf8');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07d_mining.js', '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '07m_breed.js', '07w_passive.js', '07zd_slime.js',
  '14d_survival.js', '14j_combat.js', '07ox_enchhelper.js', '07p_trade.js', '07zz_xporb.js', '14g_menu.js', '14g2_invclasses.js'], initReg: false });
const fails = []; let pass = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
// vanilla table from decomp: every register("x_ore"...OreBlock(... UniformIntProvider.create(a,b)))
const van = {};
const re = /"([a-z_]+)",\s*new OreBlock\(((?:(?!new OreBlock)[\s\S])*?)UniformIntProvider\.create\((\d+), (\d+)\)\s*\)/g;
let m; while ((m = re.exec(src))) { if (+m[4] > 0) van[m[1]] = [+m[3], +m[4]]; }
const names = Object.keys(van);
ok(names.length === 10 && van.coal_ore, 'parsed vanilla ore ranges (' + names.length + ')');
const seq = (v) => () => v;   // rand() -> v in [0,1)
function checkAll(blockXp, tag) {
  const bad = [];
  for (const n of names) {
    const [a, b] = van[n];
    if (blockXp(n, false, seq(0)) !== a) bad.push(n + ' min');
    if (blockXp(n, false, seq(0.9999)) !== b) bad.push(n + ' max');
    if (blockXp(n, true, seq(0.5)) !== 0) bad.push(n + ' silk');
  }
  if (blockXp('spawner', false, seq(0)) !== 15 || blockXp('spawner', false, seq(0.9999)) !== 43) bad.push('spawner');
  if (blockXp('spawner', true, seq(0)) !== 15) bad.push('spawner silk-immune');
  if (blockXp('iron_ore', false, seq(0.5)) !== 0 || blockXp('stone', false, seq(0.5)) !== 0) bad.push('non-xp block');
  return bad;
}
const Xp = M.Xp;
const real = (n, s, r) => Xp.blockXp(n, s, r);
const bad = checkAll(real);
ok(bad.length === 0, 'blockXp mismatches: ' + bad.join(', '));
// anti-vacuity
const brk = (f, label) => { breaks++; if (checkAll(f).length) pass++; else fails.push('anti-vacuity: ' + label + ' not caught'); };
brk((n, s, r) => real(n, false, r), 'ignoring silk touch');
brk((n, s, r) => { const v = real(n, s, r); return van[n] && v === van[n][1] ? v + 1 : v; }, 'widened range');
brk((n, s, r) => n === 'spawner' ? 0 : real(n, s, r), 'no spawner xp');
brk((n, s, r) => n === 'coal_ore' ? 0 : real(n, s, r), 'dropping one ore');
console.log(breaks + ' breaks caught');
console.log((fails.length ? 'FAIL' : 'PASS') + '  blockxpcheck — ' + pass + ' assertions, ' + fails.length + ' failures');
for (const f of fails) console.log('   x ' + f);
process.exit(fails.length ? 1 : 0);
