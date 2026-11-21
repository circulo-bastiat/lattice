#!/usr/bin/env node
// raidcmdcheck.mjs — #11567: RaidCommand (/raid, level 3) through the real dispatcher with its VANILLA-LITERAL strings.
// AdvancementCommand and EnchantCommand are proven by advcommandcheck / enchantcmdcheck (stage text now cites the classes).
// Each scenario is broken by source patch of 15g_commands.js.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry, MCLITE_ROOT } from './loadsrc.mjs';
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const EXTRA = ['02g_items.js', '02h_recipes.js', '07e_loot.js', '02j_sounds.js', '16_settings.js', '02f_tags.js', '07_world.js', '08_lighting.js', '07b_behaviour.js',
  '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js',
  '07c_blockentity.js', '09b_sky.js', '14j_combat.js', '07w_passive.js', '14c_raycast.js',
  '02i_text.js', '02n_nbt.js', '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '07zzo2_scoreboard.js', '07s_raid.js', '15g_commands.js'];
function trial(patch) {
  const M = loadEngine({ extra: EXTRA, dom: false, ...(patch ? { patch } : {}) });
  initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'entities.json'), 'utf8')) });
  {
    const raw = readFileSync(join(MCLITE_ROOT, 'assets', 'lang.bin'));
    M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  }
  {
    const meta = JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', 'items.meta.json'), 'utf8'));
    M.Items.init({ items: readFileSync(join(MCLITE_ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  }
  M.Entities.init();
  const W = M.World, EL = M.EntityList, Sp = M.Spawn, Diff = M.Diff, C = M.Commands;
  W.init(1337); M.Gen.init(1337, M.Gen.defaults()); M.Light.init(); M.Behave.init(W); EL.init(); M.Ai.init();
  Sp.init(); Sp.ready = false;
  M.Player = { x: 300, y: 64, z: 0, yaw: 0, pitch: 0, mode: 0, health: 20, inventory: M.Inventory.create(), syncHotbar() {} };
  C.build();
  
  const run = (l, o) => C.run(l, M.Player, o || {});
  const o = {};
  const rr = (l, lvl) => { try { return run(l, { level: lvl === undefined ? 4 : lvl }); } catch (e) { return { ok: false, lines: ['THROW ' + e.message] }; } };
  const t = (r) => (r.lines || []).join('\n');
  let r = rr('/raid stop'); o.stopNone = !r.ok && /No raid here/.test(t(r));
  r = rr('/raid check'); o.checkNone = !r.ok && /Found no started raids/.test(t(r));
  r = rr('/raid setomen 1'); o.omenNone = !r.ok && /No raid found here/.test(t(r));
  r = rr('/raid spawnleader'); o.leader = r.ok && /Spawned a raid captain/.test(t(r));
    return o;
}
const A = trial(null);
for (const k of Object.keys(A)) ok(A[k], 'scenario ' + k);
const BR = [
  ['stopNone', "'No raid here'", "'Nope'"],
  ['checkNone', "'Found no started raids'", "'Nope'"],
  ['omenNone', "'No raid found here'", "'Nope'"],
  ['leader', "'Spawned a raid captain'", "'Nope'"],
];
let breaks = 0;
for (const [k, a, b] of BR) {
  const src = readFileSync(join(MCLITE_ROOT, 'src/15g_commands.js'), 'utf8');
  if (!src.includes(a)) { fails.push('no-op break ' + k); continue; }
  breaks++;
  let B; try { B = trial((f, s) => f === '15g_commands.js' ? s.replace(a, b) : s); } catch { B = {}; }
  ok(!B[k], 'anti-vacuity: break ' + k);
}
console.log(fails.length ? 'FAIL\n' + fails.join('\n') : `${pass} assertions, 0 failures, ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
