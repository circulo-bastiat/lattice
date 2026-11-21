#!/usr/bin/env node
// tridentsweepcheck.mjs — #4721: Cb.tickTrident sweeps the tick's segment (box inflated 0.3), not a point test.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

console.log('tridentsweepcheck — #4721: drowned trident segment sweep');
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
const Y = 8;
// a thin target (0.1 wide) 1.5 blocks away; the trident moves 3 b/t, so tick 1 steps clean over it
function shot(offZ, thin) {
  EL.clear();
  const t = EL.spawn('turtle', 1.5, Y, offZ); t.maxHealth = t.health = 1000; if (thin) t.width = 0.1;
  const a = EL.spawn('trident', 0, Y + 0.2, 0, { vx: 3, vy: 0, vz: 0, shooter: null });
  EL.tick();
  return { t, a, hit: t.health < t.maxHealth };
}
let r = shot(0, true);
ok(r.hit && r.a.dealtDamage, 'a 3 b/t trident hits a target thinner than its tick step');
r = shot(1.0, true);
ok(!r.hit, 'a target 1 block off the line is not hit');
// anti-vacuity: break the inflate (0 -> 0.3 box gone) and the sweep must stop catching the 0.3-off shot
r = shot(0.3 + 0.05 + 0.05 - 0.05, true);   // 0.3 off the line: inside the 0.3+0.05 box only because of the inflate
ok(r.hit, 'the 0.3 inflate counts (a target 0.3 off the line is hit)');
breaks++;
const keep = Cb.ARROW_ENTITY_INFLATE; Cb.ARROW_ENTITY_INFLATE = 0;
r = shot(0.3, true); Cb.ARROW_ENTITY_INFLATE = keep;
if (!r.hit) { pass++; console.log("   ✓ inflate=0 loses the 0.3-off hit"); } else fails.push("anti-vacuity: inflate=0 still hit");
console.log(`================ tridentsweepcheck ================\n assertions passed .. ${pass}\n failures ........... ${fails.length}\n breaks caught ...... ${breaks}`);
if (fails.length) { fails.forEach((f) => console.log('  ✗ ' + f)); process.exit(1); }
