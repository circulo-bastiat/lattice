#!/usr/bin/env node
// lavaburnsoundcheck.mjs - #8729: Entity.setOnFireFromLava plays entity.generic.burn (0.4, 2.0+r*0.4) for mob/item/player; fire-immune silent. (template #5925: entity.arrow.shoot (BowItem.onStoppedUsing), entity.arrow.hit (block + entity hit),
// entity.arrow.hit_player (player shooter -> other player). Each call is removed in turn and must be noticed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');



let pass = 0, fails = [], caught = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
               '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
  blockLightAt: () => 15,
};
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
if (MCL.Entities && MCL.Entities.init) MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Use.init(W);


const EL = MCL.EntityList, R = MCL.Reg;
const LAVA = MCL.States.stateOf('lava');
for (let x = -8; x < 8; x++) for (let y = -4; y < 4; y++) for (let z = -8; z < 8; z++) cells[idx(x, y, z)] = LAVA;
let played = [];
MCL.Sound = { play: (ev, o) => played.push([ev, o]) };
MCL.Survival = Object.assign(MCL.Survival || {}, { hurt() { return true; } });
const burns = () => played.filter((p) => p[0] === 'entity.generic.burn');
function run(e, n, mark) {
  played = [];
  if (e.type !== 'item') { e.inLava = true; EL.tickHazards(e); }   // #10363: the first lava tick only primes lavaTicked (server lag of one tick)
  played = [];
  for (let i = 0; i < n; i++) { e.inLava = true; EL.tickHazards(e); }
  return burns();
}
function good(b, n, who) {
  ok(b.length === n, who + ': ' + n + ' burns, got ' + b.length);
  for (const [, o] of b) ok(o.volume === 0.4 && o.pitch >= 2.0 && o.pitch < 2.4, who + ' vol/pitch ' + o.volume + '/' + o.pitch);
}
const zom = EL.spawn('zombie', 0, 0, 0); zom.maxHealth = zom.health = 1000;
good(run(zom, 3, 'zombie'), 3, 'zombie');
const itm = EL.spawn('item', 0, 0, 0);
if (itm) { itm.item = itm.item || { name: 'dirt', count: 1 }; itm.lavaPrev = true; good(run(itm, 2, 'item'), 2, 'item'); }
const pl = { type: 'player', x: 0, y: 0, z: 0, maxHealth: 20, health: 20, dead: false };
good(run(pl, 2, 'player'), 2, 'player');
for (const n of ['zombified_piglin', 'strider']) {
  const m = EL.spawn(n, 0, 0, 0); if (!m) { ok(false, n + ' spawn'); continue; }
  m.maxHealth = m.health = 1000; good(run(m, 3, n), 0, n);
}
// anti-vacuity: with the emit removed the same assertions must fail
const real = EL.lavaBurnSound; EL.lavaBurnSound = () => {};
const before = fails.length; good(run(zom, 3, 'zombie'), 3, 'broken');
if (fails.length > before) { caught++; } breaks++;
fails.length = before; EL.lavaBurnSound = real;
console.log(fails.length ? 'FAIL ' + fails.join('; ') : 'lavaburnsoundcheck: ' + pass + ' passed, ' + caught + ' breaks caught');
process.exit(fails.length ? 1 : 0);
