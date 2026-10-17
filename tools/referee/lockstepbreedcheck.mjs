// lockstep-breed -- #6287 (G17-L39): lockstep scenario 'breed', 20 salts: two adult cows in a pen, wheat (Animal.lovePlayer) at tick 5, then the real BreedGoal.
// Reference = .decomp AnimalEntity.lovePlayer (inLove = 600) / tickMovement (inLove-- each tick) / breed (parents age 6000 + out of love, baby age -24000, orb nextInt(7)+1), AnimalMateGoal.tick (breed only after 60 goal ticks and squaredDistance < 9).
// Per tick: inLove must be 600-(t-5) until the birth tick; before the birth the cows' distance never grows beyond the start (approach); at the birth tick the baby, parents' cooldown and orb value (1..7) are checked, and the baby then ages +1 per tick.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js'];
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
const { EntityList: EL, Mount: Mn, Passive: Ps } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
function floor() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, -1, z, stone);
  for (let i = -5; i <= 5; i++) for (const [x, z] of [[i, -5], [i, 5], [-5, i], [5, i]]) for (let y = 0; y < 2; y++) w.set(x, y, z, stone);
}
const FEED_TICK = 5, TICKS = 400;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const orbValue = () => { let v = 0, n = 0; for (const x of EL.list) if (x.type === 'experience_orb') { n++; v += x.value | 0; } return { n, v }; };
function lane(salt, fault) {
  floor();
  const r = stream(salt); EL.random = r; Math.random = r;
  const a = EL.spawn('cow', -2.5, 0, 0.5), b = EL.spawn('cow', 2.5, 0, 0.5);
  a.persistent = b.persistent = true;
  const d0 = dist(a, b);
  let bad = null, born = 0, kid = null, goalTicks = 0;
  const note = (m) => { if (!bad) bad = m; };
  for (let t = 1; t <= TICKS && !bad; t++) {
    if (t === FEED_TICK) { M.Breed.lovePlayer(a, null, r); M.Breed.lovePlayer(b, null, r); if (fault) { a.inLove = 599; b.inLove = 599; } }
    EL.tick();
    const babies = EL.list.filter((x) => x.type === 'cow' && x !== a && x !== b);
    if (!born) {
      if (t >= FEED_TICK) {
        const want = 599 - (t - FEED_TICK);   // lovePlayer sets 600 before the tick; that same tick decrements
        if (babies.length === 0 && (a.inLove !== want || b.inLove !== want)) note(`tick ${t} inLove ${a.inLove}/${b.inLove} vs ${want}`);
      }
      if (t >= FEED_TICK && babies.length === 0 && dist(a, b) > d0 + 1e-9) note(`tick ${t} cows moved apart ${dist(a, b).toFixed(3)} > ${d0}`);
      if (babies.length) {
        born = t; kid = babies[0];
        if (babies.length !== 1) note(`tick ${t} ${babies.length} babies`);
        if (t - FEED_TICK + 1 < 60) note(`tick ${t} birth before 60 goal ticks`);
        if (!M.Breed.isBaby(kid) || kid.growAge !== -24000 + 0 && kid.growAge !== -23999) note(`tick ${t} baby age ${kid.growAge}`);
        for (const p of [a, b]) {
          if (p.growAge < 5990 || p.growAge > 6000) note(`tick ${t} parent age ${p.growAge} vs 6000`);
          if (p.inLove !== 0) note(`tick ${t} parent still in love ${p.inLove}`);
        }
        const o = orbValue();
        if (o.v < 1 || o.v > 7) note(`tick ${t} orb value ${o.v} outside 1..7`);
        if (dist(a, b) >= 3.0001) note(`tick ${t} born at distance ${dist(a, b).toFixed(2)} >= 3`);
      }
    } else if (t > born && kid && kid.growAge !== -24000 + (t - born) && kid.growAge !== -23999 + (t - born)) note(`tick ${t} baby age ${kid.growAge}`);
    if (born && t > born + 30) break;
  }
  if (!bad && !born) note('no baby in ' + TICKS + ' ticks');
  return { bad, born };
}
for (const s of salts) { const r = lane(s); ok(!r.bad, 'breed salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const r = lane(3, true); brk(!!r.bad && /tick 5 inLove/.test(r.bad), `inLove 599 reported at the first diverging tick: ${r.bad}`); }
{ const br = M.Breed.breed; M.Breed.breed = () => null; const r = lane(4); brk(!!r.bad, `no baby reported: ${r.bad}`); M.Breed.breed = br; }
{ const c0 = M.Breed.C.breedCooldownAge; M.Breed.C.breedCooldownAge = 0; const r = lane(5); brk(!!r.bad, `parent cooldown 0 reported: ${r.bad}`); M.Breed.C.breedCooldownAge = c0; }
{ const xs = M.Breed.spawnXp; M.Breed.spawnXp = () => null; const r = lane(6); brk(!!r.bad, `missing orb reported: ${r.bad}`); M.Breed.spawnXp = xs; }
console.log(`lockstep-breed: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
