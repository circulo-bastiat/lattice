#!/usr/bin/env node
// snbtcmdcheck.mjs — #3662: `/summon <type> <pos> {nbt}`, `/data get entity`, `/item replace entity`
// (Entity.getStackReference: pillager 300..304 -> its 5-slot inventory). Node only; the entity list is a stub.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NS = {}; globalThis.MCL = NS;
const FILES = ['00_ns.js', '01_util.js', '01b_inflate.js', '02_blocks.js', '02b_registry.js',
  '02c_states.js', '02f_tags.js', '02k_survive.js', '02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js',
  '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'];
for (const f of FILES) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
{
  const raw = readFileSync(join(ROOT, 'assets', 'lang.bin'));
  NS.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8'));
  NS.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
const { initRegistry } = await import('./loadsrc.mjs'); initRegistry(NS);
NS.DATA = NS.DATA || {}; NS.DATA.gameRules = {};
NS.Main = { seed: 1, seed64: 1n };
const P = { x: 0, y: 70, z: 0, yaw: 0, pitch: 0, mode: 0, health: 20, inventory: NS.Inventory.create(), syncHotbar() {} };
NS.Player = P; NS.Survival.init(P);

// the entity list is a stub: just enough for /summon and @e
const live = [];
NS.Entities = { types: { pillager: [1, 1], cow: [1, 1] } };
NS.EntityList = { ready: true, all: () => live, remove() {},
  spawn(type, x, y, z) { const e = { type, x, y, z, maxHealth: 24, health: 24 };
    if (type === 'pillager') e.inventory = [null, null, null, null, null]; live.push(e); return e; } };

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = (l) => NS.Commands.run(l, P);
const CHECKS = (broken) => {
  let r = run('/summon pillager 1 2 3 {Inventory:[{id:"minecraft:arrow",Count:5b},{id:"crossbow",Count:1},{id:"stone",Count:2b,tag:{a:1}}]}');
  const p = live[live.length - 1];
  ok(r.ok && p && p.type === 'pillager', 'summon with NBT succeeds');
  const iv = p.inventory || [];
  ok(iv[0] && iv[0].n === 5 && iv[1] && iv[2] && iv[2].n === 2 && iv[2].t.a === 1 && !iv[3], 'Inventory NBT fills slots 0..2');
  r = run('/summon cow 1 2 3 {Inventory:[{id:"stone",Count:1}]}');
  ok(r.ok && !live[live.length - 1].inventory, 'a mob with no inventory ignores the tag');
  r = run('/summon pillager 0 0 0 {Inventory:[');
  ok(!r.ok, 'unterminated NBT is a parse error');
  r = run('/data get entity @e[type=pillager,limit=1] Inventory[0].id');
  ok(r.ok && r.lines.join('').indexOf('minecraft:arrow') >= 0, '/data get entity path -> ' + r.lines.join('|'));
  r = run('/data get entity @e[type=pillager,limit=1] Inventory[9]');
  ok(!r.ok, '/data get entity missing path fails');
  r = run('/data get entity @e[type=pillager,limit=1]');
  ok(r.ok && /Inventory/.test(r.lines.join('')), '/data get entity whole tag lists Inventory');
  r = run('/item replace entity @e[type=pillager,limit=1] villager.4 with minecraft:diamond 3');
  ok(r.ok && p.inventory && p.inventory[4] && p.inventory[4].n === 3, '/item replace villager.4 (=slot 304) writes inventory[4]');
  r = run('/item replace entity @e[type=pillager,limit=1] villager.5 with stone');
  ok(!r.ok, 'slot 305 is past the 5-slot inventory -> no_such_slot');
  r = run('/item replace entity @e[type=cow,limit=1] villager.0 with stone');
  ok(!r.ok, 'a cow has no 300.. slots');
  r = run('/item replace entity @s hotbar.2 with stone 7');
  ok(r.ok && P.inventory.slots[2].n === 7, 'player hotbar.2 via the same path');
  return r;
};
CHECKS();
// anti-vacuity: break the data (pillager without an inventory) and the checks must notice
let breaks = 0;
{
  const base = pass, bf = fails.length;
  const spawn = NS.EntityList.spawn;
  NS.EntityList.spawn = (t, x, y, z) => { const e = spawn(t, x, y, z); delete e.inventory; return e; };
  live.length = 0; CHECKS();
  if (fails.length > bf) { breaks++; console.log('   ✓ with no pillager inventory the checks fail'); }
  NS.EntityList.spawn = spawn;
  const bf2 = fails.length; const apply = NS.Commands.applyNbt; NS.Commands.applyNbt = () => {};
  live.length = 0; CHECKS();
  if (fails.length > bf2) { breaks++; console.log('   ✓ with applyNbt a no-op the checks fail'); }
  NS.Commands.applyNbt = apply;
  fails.length = bf;   // the broken runs were meant to fail
}
console.log('\n===========================================');
console.log(' snbtcmdcheck: ' + pass + ' assertions, ' + fails.length + ' failed, ' + breaks + ' breaks caught');
console.log('===========================================');
fails.forEach(f => console.log('  FAIL ' + f));
process.exit(fails.length || breaks < 2 ? 1 : 0);
