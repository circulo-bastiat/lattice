// lockstep-golem -- #6326 (G17-L70): lockstep scenario 'golem', 20 salts: an iron_golem, a villager and a zombie 10 blocks away in a walled pen.
// Reference = .decomp IronGolem.doHurtTarget (damage = attackDamage/2 + nextInt(attackDamage) = 7.5 + nextInt(15), target vy += 0.4F), NearestAttackableTargetGoal(Enemy, priority 3).
// Per tick: until the first hit the golem must be approaching or targeting the zombie; at the first hit tick the zombie's health loss is in 7.5..21.5 (step .5) and its upward knock is vy 0.4F.
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
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const TICKS = 1500;
function lane(salt, fault) {
  floor();
  const r = stream(salt); EL.random = r; Math.random = r;
  const g = EL.spawn('iron_golem', -5, 0, 0.5), v = EL.spawn('villager', -3, 0, 2.5), z = EL.spawn('zombie', 5, 0, 0.5);
  g.persistent = v.persistent = z.persistent = true;
  z.fireImmune = true; z.noAi = true;
  const d0 = dist(g, z);
  let bad = null, hit = 0, raw = null, tgt = null, sets = [], vyv = 0;
  const note = (m) => { if (!bad) bad = m; };
  Object.defineProperty(z, 'vy', { get: () => vyv, set: (n) => { sets.push([vyv, n]); vyv = n; }, configurable: true });
  const hurt0 = M.Combat.hurt;
  M.Combat.hurt = function (tg, dmg, a, b, o) { if (tg === z && o && o.attacker === g && raw === null) { raw = dmg; tgt = g.target; sets.length = 0; } return hurt0.apply(this, arguments); };
  const kb0 = M.Combat.IRON_GOLEM_THROW_VY;
  if (fault) M.Combat.IRON_GOLEM_THROW_VY = Math.fround(0.3);
  for (let t = 1; t <= TICKS && !bad && !hit; t++) {
    z.health = z.maxHealth || 20;   // daylight burning is not under test
    EL.tick();
    if (raw !== null) {
      hit = t;
      const st = (raw - 7.5) * 2;
      if (raw < 7.5 || raw > 21.5 || Math.abs(st - Math.round(st)) > 1e-9) note(`tick ${t} damage ${raw} outside 7.5..21.5`);
      if (tgt !== z) note(`tick ${t} golem target at the strike is not the zombie (${tgt && tgt.type})`);
      const up = sets.find((q) => Math.abs(q[1] - q[0] - Math.fround(0.4)) < 1e-6);
      if (!up) note(`tick ${t} knock-up vy +${sets.map((q) => q[1] - q[0]).join(',')} vs +0.4`);
    } else if (!g.target && t > 60 && dist(g, z) > d0 + 1e-9) note(`tick ${t} golem moved away ${dist(g, z).toFixed(2)}`);
  }
  M.Combat.hurt = hurt0;
  M.Combat.IRON_GOLEM_THROW_VY = kb0;
  if (!bad && !hit) note('no hit in ' + TICKS + ' ticks');
  return { bad, hit };
}
for (const s of salts) { const r = lane(s); ok(!r.bad, 'golem salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const r = lane(3, true); brk(!!r.bad && /knock-up/.test(r.bad), `knock 0.3 reported at the first hit tick: ${r.bad}`); }
{ const k = M.Combat.IRON_GOLEM_THROW_VY; const r = lane(4, true); brk(!!r.bad, `second fault run reported: ${r.bad}`); M.Combat.IRON_GOLEM_THROW_VY = k; }
console.log(`lockstep-golem: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
