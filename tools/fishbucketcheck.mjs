#!/usr/bin/env node
// fishbucketcheck.mjs — #1277. Pufferfish PuffState / FromBucket / tropical Variant survive (a) a
// save/load round trip (07zw_mobnbt.js row) and (b) a water-bucket capture + release
// (Bucketable.copyDataToStack/copyDataFromNbt; PufferfishEntity.readCustomDataFromNbt min(PuffState, 2)).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from './loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
let pass = 0; const fails = []; let breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };
console.log('fishbucketcheck — #1277');
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07d_mining.js',
               '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js',
               '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '14d_survival.js',
               '14f_inventory.js', '14j_combat.js', '14l_use.js', '07za_explosion.js', '07z_potion.js',
               '07m_breed.js', '07zh_rabbit.js', '07zj_fox.js', '07zj_goat.js', '07zl_panda.js',
               '07q_effects.js', '07zm_axolotl.js', '07zj_fish.js', '16b_save.js', '07zw_mobnbt.js'];
const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const EL = MCL.EntityList, Ai = MCL.Ai, Spawn = MCL.Spawn, Ent = MCL.Entities;
const Fish = MCL.Fish, Breed = MCL.Breed, W = MCL.World, S = MCL.States;
const Cb = MCL.Combat, Use = MCL.Use, Iv = MCL.Inventory, ES = MCL.Effects;
const CH = MCL.CH;

MCL.Entities.init();
Ent.attrs = MCL.DATA.entities.attrs;
W.init(1);
MCL.Behave.init(W);
EL.init();
Ai.init();
Spawn.init();
Breed.init();
if (Cb && Cb.init) Cb.init();
if (ES && ES.init) ES.init();
if (Use && Use.init) Use.init(W);

for (let cx = -1; cx <= 1; cx++) for (let cz = -1; cz <= 1; cz++) {
  const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c);
}


function bucketRound(type, mutate) {
  const e = EL.spawn(type, 1, 64, 0, {});
  mutate(e);
  const inv = Iv.create();
  const stack = { i: MCL.Items.of('water_bucket'), n: 1 };
  Iv.setItem(inv, 0, stack);
  const P = { x: 0, y: 64, z: 0, inventory: inv, slot: 0, instabuild: false };
  Use.entityUse(P, e, stack);
  const slot0 = Iv.getItem(inv, 0);
  W.setBlock(2, 63, 0, S.stateOf('grass_block') | 0);
  W.setBlock(2, 64, 0, 0); W.setBlock(2, 65, 0, 0);
  Object.assign(P, { ex: 2.5, ey: 64.5, ez: 0.5, eyeHeight: 0.5, lookVec: () => [0, -1, 0] });
  Use.bucketUse(P, slot0);
  return { slot0, back: EL.list[EL.list.length - 1] };
}
const pf = bucketRound('pufferfish', (e) => Fish.setPuffState(e, 2));
ok(pf.slot0 && MCL.Items.nameOf(pf.slot0.i) === 'pufferfish_bucket', 'pufferfish captured into pufferfish_bucket');
ok(pf.slot0.puffState === 2, 'bucket stack carries puffState 2');
ok(pf.back.type === 'pufferfish' && pf.back.puffState === 2, 'released pufferfish keeps puffState 2');
ok(pf.back.fromBucket === true, 'released pufferfish has fromBucket (no despawn)');
ok(Math.abs(pf.back.width - pf.back.baseWidth) < 1e-9, 'released puffed fish has the full-size box');
const tf = bucketRound('tropical_fish', (e) => { e.fishVariant = 0x03020101; });
ok(tf.slot0.t && tf.slot0.t.BucketVariantTag === 0x03020101 && tf.slot0.fishVariant === undefined, '#3666: bucket variant lives in t.BucketVariantTag');
ok(tf.back.type === 'tropical_fish' && tf.back.fishVariant === 0x03020101, 'tropical variant survives the bucket');
{ // PuffState clamp: min(PuffState, 2)
  const c = EL.spawn('pufferfish', 5, 64, 5, { puffState: 7 });
  ok(c.puffState === 2, 'puffState > 2 is clamped to 2');
}
{ // save/load
  const store = {};
  globalThis.btoa = globalThis.btoa || ((s) => Buffer.from(s, 'binary').toString('base64'));
  globalThis.atob = globalThis.atob || ((s) => Buffer.from(s, 'base64').toString('binary'));
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  MCL.Player = { toJSON: () => ({ x: 0, y: 64, z: 0 }), fromJSON: () => false };
  MCL.Save.init();
  const run = (breakIt) => {
    EL.clear();
    const e = EL.spawn('pufferfish', 9, 64, 9, {});
    Fish.setPuffState(e, 2); e.fromBucket = true;
    const real = MCL.MobNbt.fieldsFor;
    if (breakIt) MCL.MobNbt.fieldsFor = (t) => real(t).filter((f) => f !== 'puffState');
    MCL.Save.save(false);
    MCL.MobNbt.fieldsFor = real;
    EL.clear(); MCL.Save.load(); MCL.MobNbt.restoreAll(MCL.Save.mobRecords);
    return EL.list.find((x) => x.type === 'pufferfish');
  };
  const g = run(false);
  ok(g && g.puffState === 2 && g.fromBucket === true, 'save/load keeps PuffState + FromBucket');
  const b = run(true);
  okAv(b && b.puffState === 0, 'with puffState dropped from the row the reload loses it');
}
okAv(!(EL.spawn('pufferfish', 5, 64, 5, {}).puffState === 2), 'a plain spawn is not puffed (the assertions above are not vacuous)');
console.log('================ fishbucketcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
fails.forEach((m) => console.log('  FAIL: ' + m));
console.log(` ${breaks} breaks caught`);
console.log('==============================================');
process.exit(fails.length ? 1 : 0);
