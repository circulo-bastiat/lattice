#!/usr/bin/env node
// dolphinlootcheck.mjs — #4061: Dolphin.loot honours canEquip (MAINHAND only) and keeps tag/damage through spit-out.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(MCLITE_ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '14b_physics.js', '14c_raycast.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
if (M.Combat && M.Combat.init) M.Combat.init();
M.Dolphin.init(); if (M.Use && M.Use.init) M.Use.init(M.World);
const EL = M.EntityList, W = M.World, S = M.States, Dol = M.Dolphin;
for (let cx = -1; cx <= 2; cx++) for (let cz = -1; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const stone = S.stateOf('stone') | 0, water = S.stateOf('water') | 0;
// a pool: water y 1..10 inside stone walls, air above (y 11..14), open roof
for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) for (let y = 0; y <= 14; y++) {
  const wall = Math.abs(x) === 12 || Math.abs(z) === 12 || y === 0;
  W.setBlock(x, y, z, wall ? stone : (y <= 10 ? water : 0));
}
M.Player = { x: 100, y: 100, z: 100, EYE: 1.62 };
let seed = 777;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
EL.random = () => 0.5;
const IT = M.Items, fresh = () => { EL.list.length = 0; const e = EL.spawn('dolphin', 0.5, 5, 0.5); e.inWater = true; return e; };
const drop = (name, extra) => EL.dropStack(0.5, 5, 0.5, IT.of(name), 1, extra);
console.log('dolphinlootcheck — #4061');
for (const n of ['diamond_helmet', 'shield', 'elytra', 'diamond_boots']) {
  const e = fresh(), it = drop(n);
  ok(!Dol.loot(e, it) && !M.Equip.getEquipped(e, 0) && !it.removed, n + ' is not picked up');
}
{ const e = fresh(), it = drop('diamond_sword', { tag: { Enchantments: [1] }, d: 7 });
  okAv(Dol.loot(e, it) && !!M.Equip.getEquipped(e, 0), 'sword is picked up');
  ok((h => h.t && h.t.Enchantments && h.d)(e.equip[0]) === 7, 'tag+damage kept on the held stack');
  EL.list.length = 0; const g = new Dol.PlayWithItemsGoal(e); g.stop();
  const out = EL.list.find((o) => o.type === 'item');
  okAv(out && out.tag && out.tag.Enchantments && out.d === 7, 'spat-out item keeps tag+damage'); }
{ const e = fresh(); Dol.loot(e, drop('diamond_sword'));
  ok(!Dol.loot(e, drop('apple')), 'full main hand refuses a second item'); breaks++; }
console.log('================ dolphinlootcheck ================');
console.log(` assertions passed .. ${pass}\n failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('======================================================');
process.exit(fails.length ? 1 : 0);
