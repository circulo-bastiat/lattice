// villagerbreedlockstepcheck.mjs -- #6866 (G17-L165): lockstep scenario 'villagerbreed', 20 salts: two villagers with beds, food stacks (bread 4, carrot/potato/beetroot 1 each) given to them at random ticks (a farmer's share). Per tick: both inventories, the willing-to-breed flag (foodLevel + available food >= 12, adult, breeding age 0), the courting state, and at the courting end: food eaten (slot order, one item at a time, then depleteFood(12)), the baby (growAge -24000, isBaby), parents' cooldown 6000, heart particles on the child, and the new child's bed claim (vbHome). Reference = .decomp VillagerEntity.isReadyToBreed/consumeAvailableFood/eatForBreeding/getAvailableFood + VillagerBreedTask (written independently below; VB.rand pinned to 0.5 so the 275+nextInt(50) window is 300 and no courting heart rolls fire).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const A = join(MCLITE_ROOT, 'assets');
const rdj = (f) => JSON.parse(readFileSync(join(A, f), 'utf8'));
const EXTRA = ['02f_tags.js', '02g_items.js', '07_world.js', '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js', '07h_entities.js', '07y_equip.js', '14b_physics.js', '14c_raycast.js', '07i_entitylist.js', '07l_spawn.js', '14d_survival.js', '14f_inventory.js', '14j_combat.js', '07za_explosion.js', '07m_breed.js', '07q_effects.js', '07zu_poi.js', '07o_profession.js', '07k_goals.js', '07zv_villagerbrain.js', '07zv3_vbpanic.js', '07zv4_vbidle.js', '07zv5_vbbreed.js'];
const M = loadEngine({ extra: EXTRA, dom: false });
M.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'), itemsBytes: rdj('items.meta.json').rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init(); M.Entities.attrs = M.DATA.entities.attrs; M.Effects.ready = true;
const { World: W, CH, Reg: R, States: SR, Poi, Ai, VB, EntityList: EL, Profession: Prof, Breed: Br } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
W.init(1); M.Behave.init(W);
if (M.BlockEntities && M.BlockEntities.init) M.BlockEntities.init();
EL.init(); Ai.init(); Prof.init(); Br.init(); if (M.Combat && M.Combat.init) M.Combat.init();
for (let cx = -3; cx <= 3; cx++) for (let cz = -3; cz <= 3; cz++) { const c = W.makeChunk(cx, cz); c.state = CH.GENERATED; W.chunks.set(W.key(cx, cz), c); }
const Y = 63;
for (let x = -24; x <= 24; x++) for (let z = -24; z <= 24; z++) W.setBlock(x, Y, z, SR.stateOf('stone'));
const bedState = () => { const b = R.id.red_bed; for (let s = R.realFirst[b]; s < R.realFirst[b + 1]; s++) if (SR.propValue(s, R.PROP.part) === R.PVAL.head && SR.propValue(s, R.PROP.occupied) === R.PVAL['false']) return s; };
const BED = bedState();
const FOODS = { bread: 4, carrot: 1, potato: 1, beetroot: 1 }, NAMES = Object.keys(FOODS);
const idOf = (n) => { for (let i = 0; i < 2000; i++) if (M.Items.nameOf(i) === n) return i; throw new Error('no item ' + n); };
const NEED = 12; // VillagerEntity.isReadyToBreed: foodLevel + getAvailableFood() >= 12
const particles = [];
M.Particle = { spawnMerchantParticles: (k, x, y, z) => { particles.push(k); } };
function lane(salt, need) {
  const r = stream(salt);
  EL.clear(); Prof.claimed = {}; particles.length = 0;
  VB.rand = () => 0.5;
  for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) W.setBlock(x, Y + 1, z, 0);
  for (const b of [[3, 0], [-3, 0], [0, 3]]) W.setBlock(b[0], Y + 1, b[1], BED); // 3 beds
  for (let i = 0; i < Poi.RESCAN_INTERVAL; i++) Poi.tick();
  const a = EL.spawn('villager', 0.5, Y + 1, 0.5), b = EL.spawn('villager', 1.5, Y + 1, 0.5);
  a.ai = new Ai.GoalSelector(); b.ai = new Ai.GoalSelector();
  const vs = [a, b], model = [[], []]; // model inventory: [{name,n}]
  const give = (k, name, n) => { const inv = VB.ensureVillagerInventory(vs[k]); const slot = inv.findIndex((s) => !s); inv[slot] = { i: idOf(name), n }; model[k].push({ name, n }); };
  for (let k = 0; k < 2; k++) give(k, k === 0 && salt % 2 ? 'carrot' : NAMES[Math.floor(r() * 4)], 1 + Math.floor(r() * 3));
  const shareAt = 20 + Math.floor(r() * 200), shareName = NAMES[Math.floor(r() * 4)], shareN = shareName === 'bread' ? 3 + Math.floor(r() * 3) : 12 + Math.floor(r() * 10);
  const food = [0, 0], age = [0, 0], cool = [0, 0]; let end = null, child = null, bred = false;
  const avail = (k) => model[k].reduce((s, x) => s + FOODS[x.name] * x.n, 0);
  const ready = (k) => age[k] === 0 && food[k] + avail(k) >= need;
  const eat = (k) => {
    if (food[k] < NEED && avail(k) !== 0) for (const s of model[k]) { while (s.n > 0 && food[k] < NEED) { food[k] += FOODS[s.name]; s.n--; } }
    food[k] -= NEED;
  };
  for (let t = 0; t < 700; t++) {
    if (t === shareAt) { give(1, shareName, shareN); give(0, 'carrot', salt % 2 ? 11 - avail(0) : 12); }
    if (t === shareAt + 60 && salt % 2) give(0, 'carrot', 1); // 11 food: not willing until the 12th
    // FindEntityTask: both ready -> BREED_TARGET
    if (!end && ready(0) && ready(1) && !child) { a.vbBreedTarget = b; b.vbBreedTarget = a; }
    const refStart = !end && ready(0) && ready(1) && !child;
    if (refStart) end = t + 275 + 25; // a's run draws it; b runs the same tick but only a's window matters
    M.Sky = { dayTime: 1000 + t };
    M.VBBreed.tick(a, t, t); M.VBBreed.tick(b, t, t);
    if (end !== null && t >= end && !child) {
      // reference courting end: both eat, then goHome
      eat(0); eat(1); age[0] = age[1] = 6000; child = true; end = null;
    }
    // compare
    for (let k = 0; k < 2; k++) {
      const inv = VB.ensureVillagerInventory(vs[k]).filter((s) => s && s.n > 0).map((s) => M.Items.nameOf(s.i) + 'x' + s.n).join();
      const ref = model[k].filter((s) => s.n > 0).map((s) => s.name + 'x' + s.n).join();
      if (inv !== ref) return 'salt ' + salt + ' tick ' + t + ' villager ' + k + ' inv ' + inv + ' ref ' + ref;
      if ((vs[k].vbFoodLevel | 0) !== food[k]) return 'salt ' + salt + ' tick ' + t + ' villager ' + k + ' foodLevel ' + vs[k].vbFoodLevel + ' ref ' + food[k];
      if (!!VB.villagerReadyToBreed(vs[k]) !== (age[k] === 0 && food[k] + avail(k) >= NEED)) return 'salt ' + salt + ' tick ' + t + ' villager ' + k + ' willing flag ' + VB.villagerReadyToBreed(vs[k]);
    }
    if (child && !bred) {
      bred = true;
      const kids = EL.list ? EL.list.filter((e) => e.type === 'villager' && e !== a && e !== b) : [];
      const kid = kids[0];
      if (!kid) return 'salt ' + salt + ' tick ' + t + ' no baby';
      if (Br.getAge(kid) !== -24000 || !kid.isBaby) return 'salt ' + salt + ' tick ' + t + ' baby age ' + Br.getAge(kid);
      if (Br.getAge(a) !== 6000 || Br.getAge(b) !== 6000) return 'salt ' + salt + ' tick ' + t + ' parent cooldown ' + Br.getAge(a);
      if (!kid.vbHome) return 'salt ' + salt + ' tick ' + t + ' no new bed claim';
      if (particles.filter((p) => p === 'heart').length < 1) return 'salt ' + salt + ' tick ' + t + ' no heart particles';
    }
  }
  if (need === NEED && !bred) {
    const total = [0, 1].reduce((s, k) => s + avail(k), 0);
    return 'salt ' + salt + ' never bred (food left ' + total + ')';
  }
  return null;
}
const pass = (need) => salts.map((s) => lane(s, need)).filter(Boolean);
const base = pass(NEED);
ok(base.length === 0, 'lane: ' + base.slice(0, 2).join(' | '));
brk(pass(11).length > 0, 'food requirement 12 -> 11 caught');
const saveFood = VB.BREED_FOOD_VALUES.bread; VB.BREED_FOOD_VALUES.bread = 3;
brk(pass(NEED).length > 0, 'bread value 4 -> 3 caught'); VB.BREED_FOOD_VALUES.bread = saveFood;
const saveMin = VB.BREED_FOOD_MIN; VB.BREED_FOOD_MIN = 11;
brk(pass(NEED).length > 0, 'engine BREED_FOOD_MIN 12 -> 11 caught'); VB.BREED_FOOD_MIN = saveMin;
brk(pass(NEED).length === 0, 'unfaulted lane passes after restore');
console.log(`villagerbreedlockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
