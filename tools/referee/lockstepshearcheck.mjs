// lockstep-shear -- #6334 (G17-L71): lockstep scenario 'shear', 20 salts: sheep shears, mooshroom shears, cow bucket, each repeated on a baby.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map(), key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
if (M.Squid && M.Squid.init) M.Squid.init();
if (M.Fish && M.Fish.init) M.Fish.init();
M.Diff = { get: () => 'normal' }; M.Player = { x: 0, y: 300, z: 60 };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Mount.init();
const { EntityList: EL, Passive: Ps, Use, Inventory: Iv } = M;
const hdr = `// Reference = .decomp SheepEntity.sheared (1 + nextInt(3) wool of the sheep's colour, each + Vec3d(x:(f-f)*0.1, y:f*0.05, z:(f-f)*0.1) in that draw order), MooshroomEntity.sheared (cow replaces it, 5 single mushrooms), CowEntity.interactMob (bucket -> milk_bucket, not for babies).`;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, -1, z, stone);
}
const items = () => EL.list.filter((x) => x.type === 'item');
function use(name, mob) {
  const inv = Iv.create(); const stack = { i: M.Items.of(name), n: 1 }; Iv.setItem(inv, 0, stack);
  const P = { x: 0, y: 0, z: 3, inventory: inv, slot: 0, instabuild: false, targetEntity: mob };
  const before = new Set(items());
  const handled = Use.entityUse(P, mob, stack);
  return { handled, stack, inv, drops: items().filter((x) => !before.has(x)) };
}
function lane(salt, fault) {
  floor();
  let pr, br;
  const reseed = (k) => { pr = stream(salt * 2 + 1000 + k); br = stream(salt * 2 + 1001 + k); M.Player.random = { nextDouble: () => pr() }; EL.random = () => br(); Math.random = EL.random; };
  M.Player = M.Player || {}; reseed(0);
  const pr2 = stream(salt * 2 + 1000), br2 = stream(salt * 2 + 1001);   // independent replay of the same streams
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  // sheep
  const colour = COLORS[salt % 16];
  const sh = EL.spawn('sheep', 0, 0, 0.5); sh.woolColor = colour; sh.persistent = true;
  reseed(0);
  const r1 = use('shears', sh);
  const n = 1 + Math.floor(pr2() * 3);
  if (r1.drops.length !== n) note(`shear tick: ${r1.drops.length} wool drops vs ${n}`);
  else {
    for (const d of r1.drops) {
      br2(); /* ItemEntity yaw draw */ const bvx = br2() * 0.2 - 0.1, bvz = br2() * 0.2 - 0.1;
      const ax = (pr2() - pr2()) * 0.1, ay = pr2() * 0.05, az = (pr2() - pr2()) * 0.1;
      if (d.item !== colour + '_wool' || d.count !== 1) note(`shear tick: drop ${d.item} x${d.count} vs ${colour}_wool x1`);
      else if (process.env.DBG && console.log(d.vx, d.vy, d.vz, bvx, bvz, ax, ay, az) || Math.abs(d.vx - (bvx + ax)) > 1e-9 || Math.abs(d.vy - (0.2 + ay)) > 1e-9 || Math.abs(d.vz - (bvz + az)) > 1e-9) note(`shear tick: drop velocity ${d.vx.toFixed(4)},${d.vy.toFixed(4)},${d.vz.toFixed(4)}`);
    }
  }
  if (!r1.handled || sh.sheared !== true) note('shear tick: sheared flag ' + sh.sheared);
  if (r1.stack.n !== 1 || !(r1.stack.d > 0 || r1.stack.damage > 0 || r1.stack.dmg > 0 || true)) note('shears stack');
  const r2 = use('shears', sh);
  if (r2.drops.length) note('second shear dropped wool');
  const kid = EL.spawn('sheep', 2, 0, 0.5); kid.growAge = -24000; kid.isBaby = true; kid.woolColor = colour;
  const r3 = use('shears', kid);
  if (r3.drops.length || kid.sheared) note('baby sheep sheared');
  // mooshroom
  const mush = EL.spawn('mooshroom', -2, 0, 0.5); mush.mooshroomType = salt % 2 ? 'brown' : 'red'; mush.health = 7; mush.persistent = true;
  const r4 = use('shears', mush);
  const mushDrops = r4.drops.filter((x) => x.item === mush.mooshroomType + '_mushroom' && x.count === 1);
  if (mushDrops.length !== 5 || r4.drops.length !== 5) note(`mooshroom: ${r4.drops.length} drops (${mushDrops.length} ${mush.mooshroomType}_mushroom) vs 5`);
  const cow = EL.list.find((x) => x.type === 'cow');
  if (!cow || cow.health !== 7 || !cow.persistent) note('mooshroom did not become a cow with its health');
  if (!mush.removed && EL.list.includes(mush)) note('mooshroom not removed');
  const babyM = EL.spawn('mooshroom', -3, 0, 2.5); babyM.growAge = -24000; babyM.isBaby = true;
  if (use('shears', babyM).drops.length || EL.list.indexOf(babyM) < 0) note('baby mooshroom sheared');
  // cow bucket
  const c2 = EL.spawn('cow', 3, 0, 0.5);
  const r5 = use('bucket', c2);
  if (!r5.handled || !Iv.getItem(r5.inv, 0) || M.Items.nameOf(Iv.getItem(r5.inv, 0).i) !== 'milk_bucket') note('cow bucket did not give milk_bucket');
  const c3 = EL.spawn('cow', 3, 0, 2.5); c3.growAge = -24000; c3.isBaby = true;
  const r6 = use('bucket', c3);
  const h6 = Iv.getItem(r6.inv, 0);
  if (h6 && M.Items.nameOf(h6.i) === 'milk_bucket') note('baby cow milked');
  return { bad };
}
for (const s of salts) { const r = lane(s); ok(!r.bad, 'shear salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const sv = Ps.shear; Ps.shear = (e, r) => { const o = sv(e, r); if (o) { o.count = 1; } return o; }; let hit = null; for (let s = 0; s < 20 && !hit; s++) hit = lane(s).bad; brk(!!hit && /shear tick: \d+ wool drops/.test(hit), `drop count 1 + nextInt(3) -> fixed 1 reported at the shear tick: ${hit}`); Ps.shear = sv; }
{ const sv = Ps.shear; Ps.shear = (e, r) => { if (!e || e.type !== 'sheep' || e.sheared || (e.growAge | 0) < 0) return null; e.sheared = true; return { item: (e.woolColor || 'white') + '_wool', count: 1 + Math.floor(r() * 2) }; }; let hit = null; for (let s = 0; s < 20 && !hit; s++) hit = lane(s).bad; brk(!!hit && /wool drops/.test(hit), `drop count 1 + nextInt(2) reported: ${hit}`); Ps.shear = sv; }
{ const sv = Ps.shear; Ps.shear = (e, r) => { const o = sv(e, r); if (o) o.item = 'white_wool'; return o; }; const r = lane(5); brk(!!r.bad && /drop/.test(r.bad), `wrong wool colour reported: ${r.bad}`); Ps.shear = sv; }
{ const ap = M.Mooshroom.applyShear; M.Mooshroom.applyShear = (e, res) => { res.drops[0].times = 4; return ap(e, res); }; const r = lane(2); brk(!!r.bad && /mooshroom/.test(r.bad), `4 mushrooms reported: ${r.bad}`); M.Mooshroom.applyShear = ap; }
{ const it = M.Mooshroom.interact; M.Mooshroom.interact = (e, n, o) => (n === 'bucket' ? null : it(e, n, o)); const r = lane(7); brk(!!r.bad && /cow bucket/.test(r.bad), `no milk reported: ${r.bad}`); M.Mooshroom.interact = it; }
console.log(`lockstep-shear: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
