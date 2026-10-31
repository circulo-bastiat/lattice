// lockstep-breedspecies -- #6287 (G17-L39): lockstep scenario 'breed', 20 salts: two adult cows in a pen, wheat (Animal.lovePlayer) at tick 5, then the real BreedGoal.
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
function floor() { cells.clear(); EL.list.length = 0; const stone = M.States.stateOf('stone'); for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, -1, z, stone); }
const orbs = () => { let v = 0, n = 0; for (const x of EL.list) if (x.type === 'experience_orb') { n++; v += x.value | 0; } return { n, v }; };
// One mated pair per species: love tick, breed(), then compare the baby / parents / orb against the decomp rules.
function pair(salt, ta, tb, setup) {
  floor();
  EL.random = stream(salt + 1000); Math.random = EL.random;
  const a = EL.spawn(ta, 0.5, 0, 0.5), b = EL.spawn(tb, 1.5, 0, 0.5);
  a.persistent = b.persistent = true; if (setup) setup(a, b, salt);
  const r = stream(salt), probe = stream(salt);
  M.Breed.setInLove(a, null); M.Breed.setInLove(b, null);
  const loveOk = a.inLove === 600 && b.inLove === 600;
  const kid = M.Breed.canMate(a, b) ? M.Breed.breed(a, b, { random: r }) : null;
  return { a, b, kid, probe, loveOk, o: orbs() };
}
const bad = [];
const note = (m) => bad.push(m);
const ORB = (o) => o.n === 1 && o.v >= 1 && o.v <= 7;
function common(tag, p, wantType, opt = {}) {
  if (!p.loveOk) note(tag + ' love ticks not 600');
  if (!p.kid) { note(tag + ' no baby'); return false; }
  if (p.kid.type !== wantType) note(tag + ' baby type ' + p.kid.type + ' vs ' + wantType);
  if (p.kid.growAge !== -24000) note(tag + ' baby age ' + p.kid.growAge);
  for (const q of [p.a, p.b]) { if (q.growAge !== 6000) note(tag + ' cooldown ' + q.growAge); if (q.inLove !== 0) note(tag + ' still in love'); }
  if (!ORB(p.o)) note(tag + ' orb ' + JSON.stringify(p.o) + ' not 1-7');
  return true;
}
function runAll(salt) {
  bad.length = 0;
  for (const t of ['fox', 'bee', 'hoglin', 'ocelot']) { if (M.Breed.canBreed(t)) { const p = pair(salt, t, t); common(t + ' s' + salt, p, t); } }
  { // wolf: tamed pair, owner passed on
    const p = pair(salt, 'wolf', 'wolf', (a, b) => { a.tamed = b.tamed = true; a.owner = 'u1'; b.owner = 'u2'; });
    if (common('wolf s' + salt, p, 'wolf') && (p.kid.owner !== 'u1' || !p.kid.tamed)) note('wolf owner ' + p.kid.owner);
    const q = pair(salt, 'wolf', 'wolf'); if (q.kid) note('untamed wolves bred');
  }
  { // cat: variant coin flip, tamed -> owner + collar coin flip
    const p = pair(salt, 'cat', 'cat', (a, b) => { a.tamed = b.tamed = true; a.owner = 'u1'; a.catVariant = 1; b.catVariant = 2; a.collarColor = 3; b.collarColor = 4; });
    if (common('cat s' + salt, p, 'cat')) { const v = probe(p) ; if (p.kid.catVariant !== (v() < 0.5 ? 1 : 2)) note('cat variant'); else if (p.kid.collarColor !== (v() < 0.5 ? 3 : 4) || p.kid.owner !== 'u1') note('cat collar/owner'); }
  }
  { // panda: PandaEntity.initGenes, two 1/32 mutation rolls
    const p = pair(salt, 'panda', 'panda', (a, b, s) => { a.mainGene = s % 7; a.hiddenGene = (s + 2) % 7; b.mainGene = (s + 3) % 7; b.hiddenGene = (s + 5) % 7; });
    if (common('panda s' + salt, p, 'panda')) {
      const v = probe(p), a = p.a, b = p.b; let mg, hg;
      const pick = (q) => (v() < 0.5 ? q.mainGene : q.hiddenGene);
      const rg = () => { const n = Math.floor(v() * 16); return n === 0 ? 1 : n === 1 ? 2 : n === 2 ? 3 : n === 4 ? 6 : n < 9 ? 5 : n < 11 ? 4 : 0; };
      if (v() < 0.5) { mg = pick(a); hg = pick(b); } else { mg = pick(b); hg = pick(a); }
      if (v() < 1 / 32) mg = rg(); if (v() < 1 / 32) hg = rg();
      if (p.kid.mainGene !== mg || p.kid.hiddenGene !== hg) note(`panda genes ${p.kid.mainGene}/${p.kid.hiddenGene} vs ${mg}/${hg}`);
    }
  }
  { // axolotl: 1/1200 blue else coin flip
    const p = pair(salt, 'axolotl', 'axolotl', (a, b) => { a.axolotlVariant = 0; b.axolotlVariant = 2; });
    if (common('axolotl s' + salt, p, 'axolotl')) { const v = probe(p); const want = v() < 1 / 1200 ? 4 : (v() < 0.5 ? 0 : 2); if (p.kid.axolotlVariant !== want) note(`axolotl variant ${p.kid.axolotlVariant} vs ${want}`); }
  }
  { // horse x donkey -> mule (either order); mule is infertile
    for (const [x, y] of [['horse', 'donkey'], ['donkey', 'horse']]) {
      const p = pair(salt, x, y, (a, b) => { for (const q of [a, b]) { q.tamed = true; q.health = q.maxHealth; } });
      common(x + 'x' + y + ' s' + salt, p, 'mule');
    }
    const p = pair(salt, 'mule', 'mule', (a, b) => { a.tamed = b.tamed = true; }); if (p.kid) note('mule bred');
  }
  { // turtle: no generic baby -- lays an egg instead (MateGoal)
    floor(); EL.random = stream(salt + 1000);   // generic path never runs for turtles; MateGoal lays an egg instead
    const a = EL.spawn('turtle', 0.5, 0, 0.5), b = EL.spawn('turtle', 1.5, 0, 0.5); a.persistent = b.persistent = true; for (const q of [a, b]) { q.inLove = 600; q.hasEgg = false; }
    const before = EL.list.filter((x) => x.type === 'turtle').length;
    const g = new M.Turtle.MateGoal(a, 1, { random: stream(salt), animals: () => [a, b] });
    if (!g.canUse()) note('turtle goal cannot use'); else { g.start(); for (let i = 0; i < 200 && a.inLove; i++) g.tick(); }
    if (!a.hasEgg) note('turtle did not get egg');
    if (EL.list.filter((x) => x.type === 'turtle' && x.isBaby).length) note('turtle baby spawned');
    if (EL.list.filter((x) => x.type === 'turtle').length !== before) note('turtle count changed');
    if (a.inLove || b.inLove) note('turtle still in love');
    if ((a.growAge | 0) !== 0 || (b.growAge | 0) !== 0) note('turtle cooldown set (vanilla MateGoal.breed sets none) ' + a.growAge);
    if (!ORB(orbs())) note('turtle orb ' + JSON.stringify(orbs()));
  }
  return bad.slice();
}
function probe(p) { return p.probe; }
let total = 0;
for (const s of salts) { const r = runAll(s); total++; if (r.length) { fails++; console.log('  FAIL salt ' + s + ': ' + r.join('; ')); } }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const caught = () => salts.some((s) => runAll(s).length);
{ const m0 = M.Breed.MATE.mule; M.Breed.MATE.mule = () => true; brk(caught(), 'mule fertility flipped on'); M.Breed.MATE.mule = m0; }
{ const g0 = M.Panda.initGenes; M.Panda.initGenes = (c, a, b, rnd) => { rnd = rnd || (() => 0.5); c.mainGene = a.mainGene; c.hiddenGene = a.hiddenGene; rnd(); rnd(); rnd(); rnd(); rnd(); }; brk(caught(), 'panda gene mix swapped'); M.Panda.initGenes = g0; }
{ const x0 = M.Breed.C.xpBound; M.Breed.C.xpBound = 8; brk(caught(), 'XP roll range 1-8'); M.Breed.C.xpBound = x0; }
console.log(`lockstep-breedspecies: ${total + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
