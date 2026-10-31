#!/usr/bin/env node
// givenbtcheck.mjs — #10792: `/give @s name_tag{display:{Name:'"x"'}} 1` builds a tagged stack (ItemStringReader)
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


NS.EntityList = { ready: true, all: () => [], remove() {} };
let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const run = (l) => NS.Commands.run(l, P);
const CHECKS = (give) => {
  P.inventory = NS.Inventory.create(); NS.Survival.init(P);
  const find = (id) => P.inventory.slots.find(s => s && s.n > 0 && NS.Items.nameOf(s.i) === id);
  let r = give('/give @s name_tag{display:{Name:\'"x"\'}} 1');
  const s = find('name_tag');
  ok(r.ok, 'give with NBT succeeds: ' + (r.lines || []).join('|'));
  ok(s && s.t && s.t.display && s.t.display.Name === '"x"', 'display.Name kept verbatim');
  ok(s && NS.Inventory.tagOf(s) === s.t, 'stack carries the tag');
  r = give('/give @s diamond 2');
  const d = find('diamond');
  ok(r.ok && d && d.n === 2 && !NS.Inventory.hasTag(d), 'plain give has no tag');
  r = give('/give @s name_tag{display:{Name:');
  ok(!r.ok, 'unterminated NBT is a parse error');
  r = give('/give @s name_tag{display:{Name:\'"y"\'}} 3');
  ok(r.ok && P.inventory.slots.some(q => q && q.n === 3 && q.t && q.t.display.Name === '"y"'), 'count after NBT');
};
CHECKS(run);
let breaks = 0;
{
  const bf = fails.length;
  const strip = (l) => run(l.replace(/\{display[^]*?\}\}'?/, ''));
  CHECKS(strip);
  if (fails.length > bf) breaks++;
  const bf2 = fails.length;
  CHECKS((l) => run(l.replace('"x"', '"z"')));
  if (fails.length > bf2) breaks++;
  fails.length = bf;
}
console.log(fails.join('\n'));
console.log(pass + ' assertions, ' + fails.length + ' failures, ' + breaks + ' breaks caught');
process.exit(fails.length || breaks < 2 ? 1 : 0);
