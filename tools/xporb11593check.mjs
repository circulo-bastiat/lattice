#!/usr/bin/env node
// xporb11593check.mjs — #11593: proves 07zz_xporb.js OreBlock/SpawnerBlock xp (Xp.blockXp/dropBlockXp) through the REAL
// P.breakBlock (14_player.js): survival break of an ore/spawner spawns orbs; silk touch, creative, doTileDrops=false, plain stone give none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { ROOT } from './paths.mjs';
const A = join(ROOT, 'assets');
const b64 = (f) => readFileSync(join(A, f)).toString('base64');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js',
  '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js',
  '07k_goals.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js',
  '07m_breed.js', '07t_fly.js', '07q_effects.js', '07zx_particle.js', '07zz_xporb.js', '14_player.js'];
let asserted = 0;
function run(patch) {
  const f = [];
  const no = (c, m) => { asserted++; if (!c) f.push(m); };
  const MCL = loadEngine({ extra: EXTRA, dom: false, patch });
  MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
  MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
  MCL.Entities.init(); MCL.Entities.attrs = MCL.DATA.entities.attrs;
  MCL.World.init(1); MCL.Behave.init(MCL.World);
  MCL.EntityList.init(); MCL.Ai.init(); if (MCL.Spawn && MCL.Spawn.init) MCL.Spawn.init();
  MCL.Xp.init();
  const c = MCL.World.makeChunk(0, 0); c.state = MCL.CH.GENERATED; MCL.World.chunks.set(MCL.World.key(0, 0), c);
  const W = MCL.World, S = MCL.States, P = MCL.Player, EL = MCL.EntityList;
  no(MCL.Xp.ready === true, 'Xp not ready');
  MCL.Sound = { entitySound() {}, blockBreak() {} };
  MCL.Particle.addBlockBreakParticles = () => {};
  P.inventory = MCL.Inventory.create(); P.slot = 0; P.mayBuild = true; P.x = 0.5; P.y = 64; P.z = 0.5;
  let rule = 'true'; if (!MCL.Commands) MCL.Commands = {};
  MCL.Commands.ruleGet = (n) => (n === 'doTileDrops' ? rule : 'true');
  let silk = false; P.miningContext = () => ({ silkTouch: silk });
  const orbs = () => EL.list.filter((e) => e.type === 'experience_orb' && !e.removed);
  const total = () => orbs().reduce((s, e) => s + (e.value | 0), 0);
  const brk = (name, o) => {
    o = o || {}; silk = !!o.silk; rule = o.rule || 'true'; P.instabuild = !!o.creative;
    for (const e of orbs()) e.removed = true;
    W.setBlock(3, 63, 3, S.stateOf('stone')); W.setBlock(3, 64, 3, S.stateOf(name));
    P.hasTarget = true; P.tx = 3; P.ty = 64; P.tz = 3;
    const r = P.breakBlock();
    return { r, n: total() };
  };
  for (const n of ['diamond_ore', 'lapis_ore', 'coal_ore']) {
    let mx = 0; for (let i = 0; i < 40; i++) { const b = brk(n); no(b.r === true, n + ' not broken'); mx = Math.max(mx, b.n); }
    no(mx > 0, n + ' survival break gave no xp');
    no(brk(n, { silk: true }).n === 0, n + ' silk touch still gave xp');
    no(brk(n, { creative: true }).n === 0, n + ' creative gave xp');
    no(brk(n, { rule: 'false' }).n === 0, n + ' gave xp with doTileDrops false');
  }
  let sp = 0; for (let i = 0; i < 5; i++) sp = Math.max(sp, brk('spawner').n);
  no(sp >= 15 && sp <= 43, 'spawner xp ' + sp + ' not in 15..43');
  no(brk('spawner', { silk: true }).n >= 15, 'spawner must ignore silk touch');
  let st = 0; for (let i = 0; i < 20; i++) st += brk('stone').n;
  no(st === 0, 'plain stone gave xp');
  return f;
}
const clean = run(null);
for (const m of clean) console.log('  x ' + m);
let breaks = 0, bad = clean.length;
const F = '07zz_xporb.js';
const BR = [
  ['spawner 15 base', "return 15 + ((r() * 15) | 0)", "return 0 + ((r() * 15) | 0)"],
  ['ore table', "diamond_ore: [3, 7], deepslate_diamond_ore", "diamond_ore: [0, 0], deepslate_diamond_ore"],
  ['lapis range', "lapis_ore: [2, 5],\n    deepslate", "lapis_ore: [0, 0],\n    deepslate"],
  ['silk gate', "if (!rg || silk) return 0;", "if (!rg) return 0;"],
  ['doTileDrops', "=== 'false') return [];\n    return Xp.spawn(x + 0.5", "=== 'zzz') return [];\n    return Xp.spawn(x + 0.5"],
  ['spawn', "return Xp.spawn(x + 0.5, y + 0.5, z + 0.5, n, rand);", "return [];"],
];
for (const [k, a, b] of BR) {
  let hit = false, r;
  try { r = run((fn, s) => { if (fn === F && s.includes(a)) { hit = true; return s.replace(a, b); } return s; }); } catch (e) { r = ['threw']; }
  if (!hit) { console.log('  x no-op break: ' + k); bad++; continue; }
  breaks++; if (r.length) console.log('  ✓ break caught: ' + k); else { console.log('  x NOT caught: ' + k); bad++; }
}
// cut the call site in the player: the break path must be what reaches it
{ let hit = false, r;
  try { r = run((fn, s) => { if (fn === '14_player.js' && s.includes('NS.Xp.dropBlockXp(P.tx')) { hit = true; return s.replace('NS.Xp.dropBlockXp(P.tx', '(function(){})(P.tx'); } return s; }); } catch { r = ['threw']; }
  if (hit && r.length) { breaks++; console.log('  ✓ break caught: player call site'); } else { bad++; console.log('  x call-site cut not caught'); } }
console.log(`xporb11593check: ${asserted} assertions, ${bad} failures, ${breaks} breaks caught`);
process.exit(bad ? 1 : 0);
