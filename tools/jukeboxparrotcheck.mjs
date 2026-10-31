#!/usr/bin/env node
// jukeboxparrotcheck.mjs — #4482. Drives Use.blockUse on a jukebox: insert/eject a disc -> Fly.setNearbySongPlaying
// (WorldRenderer.playSong, 3-block box). Anti-vacuity at the bottom.
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
  '07n_tame.js', '07q_effects.js', '07t_fly.js'];

const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs;
M.World.init(1); M.Behave.init(M.World);
if (M.BlockEntities.init) M.BlockEntities.init();
M.EntityList.init(); M.Use.init(M.World);
const { Inventory: Iv, EntityList: EL, World: W, States: S, Use } = M;
for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = M.CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}

const run = (disc) => {
  EL.list.length = 0;
  const P = { inventory: Iv.create(), slot: 0, instabuild: false, syncHotbar() {} };
  Iv.setItem(P.inventory, 0, Iv.stack(disc, 1, 0, null));
  W.setBlock(5, 64, 5, S.stateOf('jukebox'));
  const near = EL.spawn('parrot', 6.5, 65, 5.5), far = EL.spawn('parrot', 12.5, 65, 5.5);
  const h = () => Iv.getItem(P.inventory, 0);
  const o = [];
  o.push(Use.blockUse(P, 5, 64, 5, W.getBlock(5, 64, 5), h()) === true);
  o.push(!!near.songPlaying && !far.songPlaying);
  o.push(M.BlockEntities.get(5, 64, 5).record === disc && Iv.isEmpty(h()));
  o.push(Use.blockUse(P, 5, 64, 5, W.getBlock(5, 64, 5), h()) === true);   // eject
  o.push(!near.songPlaying && M.BlockEntities.get(5, 64, 5).record === null);
  return o;
};
run('music_disc_cat').forEach((v, i) => ok(v, 'step #' + i));
ok(run('stick')[0] === false, 'a non-disc is not inserted');

const o = M.Fly.setNearbySongPlaying;
M.Fly.setNearbySongPlaying = () => {};
breaks++; ok(!run('music_disc_cat').every(Boolean), 'anti-vacuity: no parrot notification is noticed'); console.log('   ✓ break caught: no parrot notification is noticed');
M.Fly.setNearbySongPlaying = o;
const bu = Use.blockUse;
Use.blockUse = () => false;
breaks++; ok(!run('music_disc_cat').every(Boolean), 'anti-vacuity: a dead jukebox is noticed'); console.log('   ✓ break caught: a dead jukebox is noticed');
Use.blockUse = bu;

console.log('\n================ jukeboxparrotcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
for (const f of fails) console.log('  ✗ ' + f);
process.exit(fails.length ? 1 : 0);
