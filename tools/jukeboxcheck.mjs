#!/usr/bin/env node
// jukeboxcheck.mjs — #189. JukeboxBlock comparator output (MusicDiscItem.getComparatorOutput via Rs.analogOutput) and
// removeRecord on break (onStateReplaced). Anti-vacuity at the bottom.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';

const ASSETS = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js',
  '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07k_goals.js',
  '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07m_breed.js',
  '07n_tame.js', '07q_effects.js', '07t_fly.js', '07f_redstone.js'];

const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
M.World.init(1); M.Behave.init(M.World);
if (M.BlockEntities.init) M.BlockEntities.init();
M.EntityList.init(); M.Use.init(M.World);
if (M.Redstone.init) M.Redstone.init(M.World);
const { Inventory: Iv, EntityList: EL, World: W, States: S, Use, Redstone: Rs, BlockEntities: BE } = M;
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}
const TABLE = ['13', 'cat', 'blocks', 'chirp', 'far', 'mall', 'mellohi', 'stal', 'strad', 'ward', '11', 'wait', 'pigstep', 'otherside'];
const VAN = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];   // Items.java MusicDiscItem(n, ...) in registration order

const run = (disc) => {
  EL.list.length = 0;
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, syncHotbar() {} };
  Iv.setItem(P.inventory, 0, Iv.stack(disc, 1, 0, null));
  W.setBlock(5, 64, 5, S.stateOf('jukebox'));
  const o = [];
  const sig0 = Rs.analogOutput(5, 64, 5, W.getBlock(5, 64, 5));
  Use.blockUse(P, 5, 64, 5, W.getBlock(5, 64, 5), Iv.getItem(P.inventory, 0));
  o.push(sig0 === 0);
  o.push(Rs.analogOutput(5, 64, 5, W.getBlock(5, 64, 5)) === VAN[TABLE.indexOf(disc.slice(11))]);
  // breaking the jukebox ejects the disc as an item entity
  EL.list.length = 0;
  W.setBlock(5, 64, 5, 0); M.Behave.changed(5, 64, 5);
  o.push(EL.list.some((e) => e.type === 'item' && (e.item === disc || (e.item && e.item.name === disc))));
  return o;
};
for (const d of TABLE) run('music_disc_' + d).forEach((v, i) => ok(v, d + ' step #' + i));
ok(Rs.hasAnalogOutput(S.stateOf('jukebox')) && Rs.analogKindOf(S.stateOf('jukebox')) === Rs.ANALOG_RECORD, 'jukebox analog kind is record');

const o = BE.DISC_SIGNAL;
BE.DISC_SIGNAL = {};
breaks++; ok(!run('music_disc_cat').every(Boolean), 'anti-vacuity: zero comparator table'); console.log('   ✓ break caught: zero comparator table');
BE.DISC_SIGNAL = o;
const rr = BE.jukeboxRemoveRecord;
BE.jukeboxRemoveRecord = () => false;
breaks++; ok(!run('music_disc_cat').every(Boolean), 'anti-vacuity: no eject on break'); console.log('   ✓ break caught: no eject on break');
BE.jukeboxRemoveRecord = rr;

console.log('\n================ jukeboxcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('   ✗ ' + f);
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
