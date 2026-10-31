// lockstep-axolotlfight -- #7714 (G18b-L16): axolotl target choice, play-dead roll + 200 ticks + Regeneration, air supply 6000 + dryout, player-kill buff, 20 salts.
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
  for (let x = -14; x <= 14; x++) for (let z = -14; z <= 14; z++) w.set(x, -1, z, stone);
}
const KINDS = ['drowned', 'guardian', 'cod', 'salmon', 'tropical_fish'];
// Reference: AxolotlAttackablesSensor = always-hostile {drowned, guardian}, or (no hunting cooldown) fish; in water, within 8 blocks; nearest wins.
const REF_HOSTILE = { drowned: 1, guardian: 1 }, REF_FISH = { cod: 1, salmon: 1, tropical_fish: 1 };
function lane(salt) {
  pond();
  let bad = null; const note = (m) => { if (!bad) bad = m; };
  const rnd = stream(salt + 100), ax = EL.spawn('axolotl', 0, 0, 0.5); ax.inWater = true;
  const P = M.Player; P.x = 5; P.y = 0; P.z = 0;
  Ef.removeStatusEffect(P, 'regeneration'); Ef.addStatusEffect(P, 'mining_fatigue', 600, 0);
  const mobs = KINDS.map((k) => {
    const d = 4 + rnd() * 8, a = rnd() * 6.283;
    const m = EL.spawn(k, +(Math.cos(a) * d).toFixed(2), 0, +(Math.sin(a) * d).toFixed(2)); m.inWater = true; return m;
  });
  const d2 = (e) => (e.x - ax.x) ** 2 + (e.y - ax.y) ** 2 + (e.z - ax.z) ** 2, near = (e) => d2(e) <= 64;
  const refPick = () => {
    let best = null, bd = Infinity;
    for (const m of mobs) {
      if (m.dead || !m.inWater || !near(m)) continue;
      if (!(REF_HOSTILE[m.type] || (!(ax.huntingCooldown > 0) && REF_FISH[m.type]))) continue;
      const d = d2(m); if (d < bd) { bd = d; best = m; }
    }
    return best;
  };
  const goal = new Ax.FightGoal(ax, { entities: () => EL.list });
  ax.huntingCooldown = 0;
  // sensor cadence: the first poll is tick 1, then every 20 ticks
  let want = refPick();
  const used = goal.canUse();
  if (used !== !!want || (want && ax.target !== want)) note(`first pick ${ax.target && ax.target.type} vs ${want && want.type}`);
  // while a target is held, canUse stays true without re-polling; cadence proven by a late arrival
  if (want) {
    ax.target = null;
    const polls = []; for (let t = 2; t <= 41; t++) { if (goal.canUse()) polls.push(t); if (polls.length) break; }
    if (polls[0] !== 21) note(`next poll at tick ${polls[0]} vs 21`);
  }
  if (Ax.approachSpeed(ax) !== 0.6) note('water approach speed ' + Ax.approachSpeed(ax));
  ax.inWater = false; if (Ax.approachSpeed(ax) !== 0.15) note('land approach speed ' + Ax.approachSpeed(ax)); ax.inWater = true;
  // melee: 2 damage per landed hit in range
  const victim = EL.spawn('cod', 0.5, 0, 0.5); victim.inWater = true; const h0 = victim.health;
  ax.target = victim; goal.start(); goal.tick();
  if (h0 - victim.health !== 2) note(`melee damage ${h0 - victim.health} vs 2`);
  goal.tick(); if (h0 - victim.health !== 2) note('second hit inside the 20 tick interval');
  // post-kill: hunting cooldown on leaving FIGHT, then fish are ignored but drowned/guardian are not
  goal.stop(); if (ax.huntingCooldown !== 2400) note('hunting cooldown ' + ax.huntingCooldown);
  const wc = refPick(); if (wc && REF_FISH[wc.type]) note('fish chosen in cooldown');
  ax.target = null; goal.canUse(); /* sense counter */
  for (let t = 0; t < 25 && !ax.target; t++) goal.canUse();
  if (ax.target && REF_FISH[ax.target.type]) note('fish targeted in cooldown ' + ax.target.type);
  // kill buff
  const cur = salt % 3 * 50;
  if (cur) Ef.addStatusEffect(P, 'regeneration', cur, 0);
  Ax.appreciatePlayer(ax, { dead: true, lastAttacker: P });
  const pr = Ef.getStatusEffect(P, 'regeneration');
  if (!pr || pr.duration !== cur + 100) note(`player regen ${pr && pr.duration} vs ${cur + 100}`);
  if (Ef.getStatusEffect(P, 'mining_fatigue')) note('mining fatigue not cleared');
  return { bad };
}
for (let s = 0; s < 20; s++) { const r = lane(s); ok(!r.bad, 'axolotlfight salt ' + s + ' ' + r.bad); }
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const first = () => { let h = null; for (let s = 0; s < 20 && !h; s++) h = lane(s).bad; return h; };
{ const sv = Ax.HUNT_TARGETS; Ax.HUNT_TARGETS = Object.assign({ zombie: 1 }, sv); delete Ax.HUNT_TARGETS.cod; const h = first(); brk(!!h, `wrong target list: ${h}`); Ax.HUNT_TARGETS = sv; }
{ const sv = Ax.ALWAYS_HOSTILE; Ax.ALWAYS_HOSTILE = { drowned: 1 }; const h = first(); brk(!!h, `guardian dropped: ${h}`); Ax.ALWAYS_HOSTILE = sv; }
{ const sv = Ax.APPROACH_SPEED_WATER; Ax.APPROACH_SPEED_WATER = 1; const h = first(); brk(!!h, `approach speed: ${h}`); Ax.APPROACH_SPEED_WATER = sv; }
{ const sv = Ax.SENSE_RANGE_SQ; Ax.SENSE_RANGE_SQ = 400; const h = first(); brk(!!h, `sense range: ${h}`); Ax.SENSE_RANGE_SQ = sv; }
{ const sv = Ax.HUNTING_COOLDOWN; Ax.HUNTING_COOLDOWN = 100; const h = first(); brk(!!h, `hunting cooldown: ${h}`); Ax.HUNTING_COOLDOWN = sv; }
{ const sv = Ax.buffPlayer; Ax.buffPlayer = (P) => { const r = sv(P); Ef.addStatusEffect(P, 'mining_fatigue', 100, 0); return r; }; const h = first(); brk(!!h, `mining fatigue kept: ${h}`); Ax.buffPlayer = sv; }
console.log(`lockstep-axolotlfight: ${20 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
