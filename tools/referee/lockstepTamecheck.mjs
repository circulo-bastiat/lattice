// lockstep-tame -- #6288 (G17-L40): lockstep scenario 'tame', 20 salts: two adult cows in a pen, wheat (Animal.lovePlayer) at tick 5, then the real BreedGoal.
// Reference = .decomp WolfEntity.interactMob (bone, nextInt(3)==0 -> setOwner, setSitting(true)), TameableEntity sit toggle, SitGoal (a sitting wolf never moves), FollowOwnerGoal (unsat owner > 10 blocks away -> approach).
// Per tick: tamed/owner/sitting/pos are compared with the reference model; the roll is the FIRST draw of the entity stream in the feed call (floor(d*3)==0).
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
  for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) w.set(x, -1, z, stone);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function lane(salt, denom) {
  floor();
  const r = stream(salt); EL.random = r; Math.random = r;
  M.Player = { x: 0, y: 0, z: 18 };
  const c0 = M.Tame.CHANCE_DENOM; if (denom) M.Tame.CHANCE_DENOM = denom;
  const wolf = EL.spawn('wolf', 0.5, 0, 0.5); wolf.persistent = true;
  let bad = null, tamedAt = 0, pos = null, stood = 0, d0 = 0;
  const note = (m) => { if (!bad) bad = m; };
  for (let t = 1; t <= 120 && !bad; t++) {
    if (t >= 3 && !tamedAt) {
      let first = null;
      const tap = () => { const v = r(); if (first === null) first = v; return v; };
      const res = M.Tame.feed(wolf, 'bone', { random: tap });
      const want = Math.floor(first * 3) === 0;   // reference: nextInt(3) == 0
      if (!res) note(`tick ${t} feed refused`);
      else if (!!wolf.tamed !== want) note(`tick ${t} roll: tamed ${!!wolf.tamed} vs reference ${want}`);
      else if (want) { tamedAt = t; if (wolf.owner !== 'player' || wolf.sitting !== true) note(`tick ${t} owner ${wolf.owner} sitting ${wolf.sitting}`); }
      else if (wolf.tamed || wolf.owner) note(`tick ${t} failed roll left an owner`);
    }
    EL.tick();
    if (!tamedAt) continue;
    if (t < tamedAt + 30) {   // SitGoal: sitting wolf holds its place
      if (!wolf.sitting || !wolf.tamed) note(`tick ${t} sit state lost`);
      if (t < tamedAt + 8) continue;   // residual horizontal velocity decays (friction) before the wolf rests
      if (!pos) pos = [wolf.x, wolf.z]; else if (Math.abs(wolf.x - pos[0]) > 0.01 || Math.abs(wolf.z - pos[1]) > 0.01) note(`tick ${t} sitting wolf moved`);
    } else if (t === tamedAt + 30) {
      M.Tame.toggleSit(wolf); d0 = dist(wolf, M.Player);
      if (wolf.sitting) note(`tick ${t} sit toggle left sitting`);
    } else {   // FollowOwnerGoal: owner 18 blocks away > 10, so the wolf closes in
      if (dist(wolf, M.Player) < d0 - 3) stood = 1;
      if (dist(wolf, M.Player) > d0 + 1e-6) note(`tick ${t} wolf moved away from owner`);
      if (stood) break;
    }
  }
  M.Tame.CHANCE_DENOM = c0;
  if (!bad && !tamedAt) note('never tamed');
  if (!bad && !stood) note('wolf did not follow owner');
  return { bad, tamedAt };
}
for (const s of salts) { const r = lane(s); ok(!r.bad, 'tame salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ let hit = null; for (const s of salts) { const r = lane(s, 4); if (r.bad && /roll/.test(r.bad)) { hit = r.bad; break; } } brk(!!hit, `1/4 roll reported at the roll tick: ${hit}`); }
{ const t0 = M.Tame.toggleSit; M.Tame.toggleSit = () => true; const r = lane(2); brk(!!r.bad, `sit toggle ignored: ${r.bad}`); M.Tame.toggleSit = t0; }
console.log(`lockstep-tame: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
