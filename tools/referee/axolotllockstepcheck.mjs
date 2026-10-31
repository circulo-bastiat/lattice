// lockstep-axolotl -- #6677 (G17-L106): axolotl target choice, play-dead roll + 200 ticks + Regeneration, air supply 6000 + dryout, player-kill buff, 20 salts.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02h_recipes.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14l_use.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
M.Recipes.init({ recipes: b64('recipes.bin'), recipesBytes: rdj('recipes.meta.json').jsonBytes });
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
const { EntityList: EL, Effects: Ef, Axolotl: Ax } = M;
let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
function pond() {
  cells.clear(); EL.list.length = 0;
  const stone = M.States.stateOf('stone');
  for (let x = -5; x <= 5; x++) for (let z = -5; z <= 5; z++) w.set(x, -1, z, stone);
}
// Reference = AxolotlEntity.damage first half: nextInt(3)==0, then (nextInt(3) < amount || health/max < 0.5), amount < health, wet.
function refDamage(rand, amount, health, max, wet) {
  if (!wet || !(amount < health)) return false;
  if (Math.floor(rand() * 3) !== 0) return false;
  return Math.floor(rand() * 3) < amount || health / max < 0.5;
}
function lane(salt) {
  pond();
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const ax = EL.spawn('axolotl', 0, 0, 0.5), cod = EL.spawn('cod', 1, 0, 0.5), dr = EL.spawn('drowned', 2, 0, 0.5);
  ax.inWater = cod.inWater = dr.inWater = true;
  // target choice: aquatic mobs only
  ax.huntingCooldown = 0;
  if (!Ax.canTarget(ax, cod)) note('cod not a target');
  if (!Ax.canTarget(ax, dr)) note('drowned not a target');
  const zb = EL.spawn('zombie', 1, 0, 1.5); zb.inWater = true;
  if (Ax.canTarget(ax, zb)) note('zombie targeted');
  cod.inWater = false; if (Ax.canTarget(ax, cod)) note('dry cod targeted'); cod.inWater = true;
  ax.huntingCooldown = 5;
  if (Ax.canTarget(ax, cod)) note('cod targeted during hunting cooldown');
  if (!Ax.canTarget(ax, dr)) note('drowned must ignore cooldown');
  ax.huntingCooldown = 0;
  // play dead roll
  const amount = 1 + (salt % 4), a = EL.spawn('axolotl', -2, 0, 0.5); a.inWater = true; a.health = 10 + (salt % 5);
  const r1 = stream(salt), r2 = stream(salt);
  const want = refDamage(r2, amount, a.health, a.maxHealth || 14, true), got = Ax.onDamaged(a, amount, r1);
  if (got !== want) note(`play dead roll ${got} vs ${want}`);
  if (r1() !== r2()) note('play dead draw count');
  // force it
  const b = EL.spawn('axolotl', -3, 0, 0.5); b.inWater = true; b.health = 8;
  if (!Ax.onDamaged(b, 3, () => 0)) note('forced play dead refused');
  else {
    const rg = Ef.getStatusEffect(b, 'regeneration');
    if (!rg || rg.duration !== 200 || rg.amplifier !== 0) note('regeneration ' + (rg && rg.duration) + ' vs 200');
    let n = 0; while (b.playingDead && n < 500) { Ax.tickPlayDead(b); n++; }
    if (n !== 200) note(`play dead lasted ${n} vs 200`);
  }
  // air supply
  const d = EL.spawn('axolotl', 3, 0, 0.5); d.inWater = false; d.air = undefined; d.health = 14;
  Ax.tickAir(d); if (d.air !== 5999) note('air after 1 dry tick ' + d.air + ' vs 5999');
  let t = 1; while (d.health === 14 && t < 7000) { Ax.tickAir(d); t++; }
  if (t !== 6020 || d.health !== 12) note(`dryout at tick ${t}, health ${d.health} vs 6020 / 12`);
  d.inWater = true; Ax.tickAir(d); if (d.air !== 6000) note('air not restored');
  // player kill: regeneration +100, mining fatigue cleared
  const P = M.Player; P.x = 0; P.y = 0; P.z = 0;
  const cur = salt % 3 * 50;
  Ef.removeStatusEffect(P, 'regeneration');
  if (cur) Ef.addStatusEffect(P, 'regeneration', cur, 0);
  Ef.addStatusEffect(P, 'mining_fatigue', 600, 0);
  const dead = { dead: true, lastAttacker: P };
  Ax.appreciatePlayer(ax, dead);
  const pr = Ef.getStatusEffect(P, 'regeneration');
  if (!pr || pr.duration !== cur + 100) note(`player regen ${pr && pr.duration} vs ${cur + 100}`);
  if (Ef.getStatusEffect(P, 'mining_fatigue')) note('mining fatigue not cleared');
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'axolotl salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = () => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return h; };
{ const sv = Ax.PLAY_DEAD_TICKS; Ax.PLAY_DEAD_TICKS = 100; const h = first(); brk(!!h, `play dead ticks 200 -> 100: ${h}`); Ax.PLAY_DEAD_TICKS = sv; }
{ const sv = Ax.HUNT_TARGETS; Ax.HUNT_TARGETS = Object.assign({ zombie: 1 }, sv); const h = first(); brk(!!h, `zombie hunt target: ${h}`); Ax.HUNT_TARGETS = sv; }
{ const sv = Ax.MAX_AIR; Ax.MAX_AIR = 4000; const h = first(); brk(!!h, `max air 4000: ${h}`); Ax.MAX_AIR = sv; }
{ const sv = Ax.buffPlayer; Ax.buffPlayer = (P) => { const r = sv(P); Ef.addStatusEffect(P, 'mining_fatigue', 100, 0); return r; }; const h = first(); brk(!!h, `mining fatigue kept: ${h}`); Ax.buffPlayer = sv; }
console.log(`lockstep-axolotl: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
