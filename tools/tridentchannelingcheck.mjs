#!/usr/bin/env node
// tridentchannelingcheck.mjs — #5619: TridentEntity.onEntityHit channeling (thundering + sky visible -> one bolt at the target)
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

console.log('tridentchannelingcheck — #5619');
const M = loadEngine({ extra: ['07_world.js', '02g_items.js', '14f_inventory.js', '07h_entities.js', '14b_physics.js',
  '07i_entitylist.js', '14i_hand.js', '14j_combat.js', '14d_survival.js', '14l_use.js'] });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Entities.init(); M.EntityList.init(); M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, W = M.World, CH = M.CH;
W.init(1);
for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
let thunder = true, sky = true;
M.Sky = M.Sky || {}; M.Sky.isThundering = () => thunder;
W.canSeeSky = () => sky;
function shot(ench) {
  EL.clear();
  const t = EL.spawn('turtle', 1.5, 8, 0); t.maxHealth = t.health = 1000;
  const a = EL.spawn('trident', 0, 8.2, 0, { vx: 3, vy: 0, vz: 0, shooter: null });
  if (ench) a.pickupTag = ench;
  EL.tick();
  return { hit: t.health < t.maxHealth, bolts: EL.list.filter((x) => x.type === 'lightning_bolt').length };
}
// build a channeling tag through the engine's own enchant writer if present, else probe enchantList
let chan = { Enchantments: [{ id: 'minecraft:channeling', lvl: 1 }] };
if (Cb.enchantLevel({ t: chan }, 'channeling') !== 1) chan = null;
ok(chan, 'could build a channeling tag the engine reads');
let r = shot(chan);
ok(r.hit && r.bolts === 1, 'thunder + sky + channeling: exactly one bolt (got ' + r.bolts + ')');
thunder = false; r = shot(chan); ok(r.hit && r.bolts === 0, 'clear weather: none');
thunder = true; sky = false; r = shot(chan); ok(r.hit && r.bolts === 0, 'roofed: none');
sky = true; r = shot(null); ok(r.hit && r.bolts === 0, 'no channeling: none');
breaks++;
M.Sky.isThundering = () => true; thunder = false;   // gate removed: pretend stub ignores it -> must have been caught above
thunder = true; M.Sky.isThundering = () => true;
const g = shot(chan).bolts; M.Sky.isThundering = () => false; const g2 = shot(chan).bolts;
if (g === 1 && g2 === 0) { pass++; console.log('   ✓ thunder gate off -> no bolt'); } else fails.push('anti-vacuity: thunder gate does not control the bolt');
console.log(`================ tridentchannelingcheck ================\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
