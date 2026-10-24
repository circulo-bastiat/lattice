import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');
console.log('eyeofendercheck — #5083: EyeOfEnderEntity');
const MCL = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js', '07h_entities.js', '07i_entitylist.js',
  '14b_physics.js', '14e_gamemode.js', '14d_survival.js', '14j_combat.js', '07zzd_throw.js', '07zw_mobnbt.js'], dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });
MCL.Gen.init(1337, Object.assign(MCL.Gen.defaults(), { climate: 'vanilla' }));
MCL.Entities.init(); MCL.EntityList.init();
const EL = MCL.EntityList, Th = MCL.Throw, ST = MCL.Structures, Iv = MCL.Inventory;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; ok(c, 'anti-vacuity: ' + m); if (c) console.log('   ✓ ' + m); };

ok(!('eye_of_ender' in EL.OWED_STAGE) && EL.canSpawn('eye_of_ender'), 'eye_of_ender spawns');
const O = { x: 100.5, z: -200.5 };
const tgt = ST.locateStructure('eye_of_ender_located', Math.floor(O.x), Math.floor(O.z), 100);
ok(tgt && tgt.name === 'stronghold', 'a stronghold is located');
function fly(target, n, rnd) {
  EL.clear(); EL.random = rnd || (() => 0.5);
  const e = EL.spawn('eye_of_ender', O.x, 70, O.z, { item: 1 });
  Th.eyeInit(e, target.x, target.y, target.z);
  for (let i = 0; i < n; i++) Th.tickEye(e);
  return e;
}
const bearing = (e) => Math.atan2(e.z - O.z, e.x - O.x);
const want = (t) => Math.atan2(t.z - O.z, t.x - O.x);
const dAng = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
let e = fly(tgt, 30);
ok(dAng(bearing(e), want(tgt)) < 0.05, `heads to the nearest stronghold (err ${dAng(bearing(e), want(tgt)).toFixed(3)} rad)`);
ok(e.y > 70, 'rises when far (clamp target y+8)');
// clamp: target set 12 away at y+8
EL.clear(); const c = EL.spawn('eye_of_ender', 0, 70, 0, { item: 1 });
Th.eyeInit(c, 300, 30, 400);
ok(Math.abs(c.tx - 7.2) < 1e-9 && Math.abs(c.tz - 9.6) < 1e-9 && c.ty === 78, `far target clamps to 12 blocks at y+8 (${c.tx},${c.ty},${c.tz})`);
Th.eyeInit(c, 3, 30, 4); ok(c.tx === 3 && c.ty === 30 && c.tz === 4, 'near target is used as is');
// drop vs break
function split(rule) {
  let seed = 12345, drop = 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x80000000; };
  for (let i = 0; i < 1000; i++) {
    EL.clear(); EL.random = rnd;
    const k = EL.spawn('eye_of_ender', 0, 70, 0, { item: 1 });
    Th.eyeInit(k, 5, 70, 5); if (rule) k.dropsItem = rule(k);
    for (let t = 0; t < 81; t++) Th.tickEye(k);
    if (k.removed && EL.list.some((x) => x.type === 'item')) drop++;
  }
  return drop;
}
const d = split();
ok(d > 760 && d < 840, `drop count ${d}/1000 ~ 80%`);
// no stronghold in range / no ender_eye: useEye refuses
{ const real = ST.locateStructure; ST.locateStructure = () => null;
  const P = { x: 0, y: 64, z: 0, inventory: Iv.create(), slot: 0, instabuild: false };
  Iv.setItem(P.inventory, 0, Iv.stack('ender_eye', 2, 0));
  ok(Th.useEye(P, Iv.getItem(P.inventory, 0)) === false && Iv.getItem(P.inventory, 0).n === 2, 'no stronghold -> PASS, nothing spent');
  ST.locateStructure = real;
  const SO = MCL.Sound || (MCL.Sound = {}), realSnd = SO.entitySound, got = [];
  SO.entitySound = (...a) => { got.push(a); };
  P.instabuild = true; Th.useEye(P, Iv.getItem(P.inventory, 0)); P.instabuild = false;
  const L = got.filter((a) => a[0] === 'entity.ender_eye.launch');
  ok(L.length === 1 && L[0][4] === 0.5 && L[0][5] >= 0.4 / 1.2 - 1e-9 && L[0][5] <= 0.5 + 1e-9, 'launch sound once, vol 0.5, pitch 0.4/(r*0.4+0.8)');
  okAv(L.length === 1, 'a missing launch emit is caught');
  got.length = 0; ST.locateStructure = () => null; Th.useEye(P, Iv.getItem(P.inventory, 0)); ST.locateStructure = real;
  ok(got.length === 0, 'failed locate plays no launch sound');
  SO.entitySound = realSnd;
  const ok2 = Th.useEye(P, Iv.getItem(P.inventory, 0));
  ok(ok2 && Iv.getItem(P.inventory, 0).n === 1 && EL.list.some((x) => x.type === 'eye_of_ender'), 'use spawns the eye and spends one'); }
// #5776: save/load mid-flight continues like a never-saved twin
function twin(saveAt) {
  EL.clear(); EL.random = () => 0.5;
  const a = EL.spawn('eye_of_ender', 0.5, 70, 0.5, { item: 7 }); Th.eyeInit(a, 40, 30, 50);
  for (let t = 0; t < 20; t++) Th.tickEye(a);
  let b = a;
  if (saveAt) { const recs = JSON.parse(JSON.stringify(MCL.MobNbt.serializeAll())); EL.clear(); MCL.MobNbt.restoreAll(recs); b = EL.list.find((x) => x.type === 'eye_of_ender'); }
  if (!b) return null;
  let n = 0; while (!b.removed && n < 200) { Th.tickEye(b); n++; }
  return [b.tx, b.ty, b.tz, b.item, b.dropsItem, n, b.x.toFixed(6), b.z.toFixed(6)].join();
}
{ const ref = twin(false), got = twin(true);
  ok(ref && ref === got, `eye survives save/load (${ref} vs ${got})`);
  const real = MCL.MobNbt.fieldsFor; MCL.MobNbt.fieldsFor = () => [];
  okAv(twin(true) !== ref, 'dropping the eye_of_ender row is caught'); MCL.MobNbt.fieldsFor = real; }
// anti-vacuity
{ const second = { x: tgt.x + (O.x > tgt.x ? 5000 : -5000), z: tgt.z + 3000, y: 32 };
  const w = fly(second, 30); okAv(dAng(bearing(w), want(tgt)) >= 0.05, 'pointing at another stronghold is caught'); }
okAv(split(() => true) === 1000 && split(() => true) > 840, 'always dropping is caught by the 80% window');
console.log(`\n${pass} checks passed, ${fails.length} failed`);
fails.forEach((f) => console.log('FAIL ' + f));
console.log(`${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
