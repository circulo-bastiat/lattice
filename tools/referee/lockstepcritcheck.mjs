// lockstep-crit -- #6721: Player.attack crit (1.5x) / sprint knockback / exclusions vs independent reference over 20 salts.
// lockstep-turtle -- #6671 (G17-L100): lockstep scenario 'turtle', 20 salts: a pregnant turtle at its home beach.
// Reference = .decomp TurtleEntity.LayEggGoal (counter<1 -> digging, counter=1; counter>200 -> lay, then counter++ while digging; EGGS=nextInt(4)+1; love 600)
// and TurtleEggBlock.randomTick (progress on nextInt(500)==0 or skyAngle in (0.65,0.69); hatch 0->1->2, then break + one baby per egg, baby age -24000) and TurtleEntity.onGrowUp (one scute).
// The egg must appear exactly 200 ticks after the dig starts, with 1..4 eggs, hasEgg cleared, love 600; the hatch roll is replayed against an independent stream.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '14i_hand.js', '07w_passive.js', '07d_mining.js', '07e_loot.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json'), monsterTypes: JSON.parse(/monsterTypes:\s*(\[[^\]]*\])/.exec(readFileSync(join(MCLITE_ROOT, 'src', '19_data.gen.js'), 'utf8'))[1]) });
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

let fails = 0, breaks = 0;
const ok = (c, m) => { if (!c) { fails++; if (fails < 25) console.log("  FAIL " + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const { EntityList: EL, Combat: Cb, Hand: H, Effects: ES } = M;
const grass = M.States.stateOf('grass_block');
for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) w.set(x, -1, z, grass);
let blind = false;
ES.hasStatusEffect = (e, n) => n === 'blindness' && blind && e.type === 'player';
const sounds = [];
M.Sound = { play: (ev) => sounds.push(ev) };
const f32 = Math.fround;
// independent reference of Player.attack's numbers (fist, base 1.0, delay 5 ticks)
function ref(c) {
  const h = Math.min(1, (c.ticker + 0.5) / 5), full = h > 0.9;
  let dmg = 1.0 * (0.2 + h * h * 0.8);
  const spk = c.sprint && full;
  const crit = full && c.fall > 0 && !c.ground && !c.ladder && !c.water && !c.blind && !c.riding && !c.sprint;
  if (crit) dmg *= CRIT;
  const kb = spk ? 1 : 0;
  return { dmg, crit, kb, spk, sound: spk ? ['knockback', crit ? 'crit' : (full ? 'strong' : 'weak')] : [crit ? 'crit' : (full ? 'strong' : 'weak')] };
}
let CRIT = 1.5;
function trial(c, type) {
  cells.size; EL.list.length = 0;
  const P = { type: 'player', x: 0, y: 0, z: 0, yaw: c.yaw, vx: 0.3, vy: 0, vz: -0.2, sprinting: c.sprint, fallDistance: c.fall,
    onGround: c.ground, onClimbable: c.ladder, inWater: c.water, inventory: null, slot: 0 };
  blind = c.blind; M.Player = P;
  const t = EL.spawn(type, 0, 0, -1.5); t.persistent = true; t.noAi = true; t.health = t.maxHealth = 1000; t.onGround = true; t.vx = t.vz = t.vy = 0;
  t.invulnerableTime = 0; t.hurtTime = 0;
  H.attackStrengthTicker = c.ticker; sounds.length = 0;
  const vz0 = t.vz; const res = Cb.attack(P, t); if (process.env.DBG) console.log(type, c.ticker, vz0, t.vz, t.vx);
  const r = ref(c), bad = [];
  if (!res) return 'null result';
  if (Math.abs(res.damage - r.dmg) > 1e-5) bad.push(`damage ${res.damage} vs ${r.dmg}`);
  if (!!res.crit !== r.crit) bad.push(`crit ${res.crit} vs ${r.crit}`);
  if ((res.knockback || 0) !== r.kb) bad.push(`kb ${res.knockback} vs ${r.kb}`);
  const exp = ('entity.player.attack.' + r.sound.join(',entity.player.attack.')).split(',');
  if (res.sounds.slice().sort().join() !== exp.slice().sort().join()) bad.push(`sounds ${res.sounds} vs ${exp}`);
  if (r.kb) {
    const s = r.kb * 0.5 * (1 - (t.knockbackResistance || 0)), dx = Math.sin(c.yaw), dz = -Math.cos(c.yaw);
    const b0 = 0.4 * (1 - (t.knockbackResistance || 0)), ex = 0 / 2 - dx * s, ez = -b0 / 2 - dz * s;   // base 0.4 away from the attacker (LivingEntity.damage), then the bonus
    if (Math.abs(t.vx - ex) > 1e-6 || Math.abs(t.vz - ez) > 1e-6) bad.push(`kbvec ${t.vx},${t.vz} vs ${ex},${ez}`);
    if (Math.abs(P.vx - 0.18) > 1e-9 || Math.abs(P.vz + 0.12) > 1e-9 || P.sprinting) bad.push(`player slow ${P.vx},${P.vz},${P.sprinting}`);
    } else if (Math.abs(t.vz + 0.4 * (1 - (t.knockbackResistance || 0))) > 1e-6) bad.push('base kb ' + t.vz);
  if (!r.kb && (P.vx !== 0.3 || c.sprint !== P.sprinting)) bad.push('player changed without kb');
  return bad.join('; ') || null;
}
function run() {
  let n = 0, bad = null;
  for (let s = 0; s < 20 && !bad; s++) {
    const r = stream(s);
    for (const type of ['zombie', 'cow']) for (const mode of ['stand', 'sprint', 'fall', 'water', 'ladder', 'blind', 'fallsprint']) for (const ticker of [0, 2, 4, 5, 9]) {
      const c = { yaw: r() * 6.28, ticker, fall: 0, ground: true, sprint: false, water: false, ladder: false, blind: false, riding: false };
      if (mode === 'sprint') c.sprint = true;
      if (mode === 'fall' || mode === 'fallsprint') { c.fall = 0.5 + r() * 3; c.ground = false; c.sprint = mode === 'fallsprint'; }
      if (mode === 'water') { c.fall = 2; c.ground = false; c.water = true; }
      if (mode === 'ladder') { c.fall = 2; c.ground = false; c.ladder = true; }
      if (mode === 'blind') { c.fall = 2; c.ground = false; c.blind = true; }
      const b = trial(c, type); n++;
      if (b) { bad = `salt ${s} ${type} ${mode} ticker ${ticker}: ${b}`; break; }
    }
  }
  return { bad, n };
}
const base = run(); ok(!base.bad, base.bad); ok(base.n === 20 * 70, 'trials ' + base.n);
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
{ const o = Cb.CRIT_MULTIPLIER; Cb.CRIT_MULTIPLIER = 1.6; brk(!!run().bad, 'crit 1.5 -> 1.6'); Cb.CRIT_MULTIPLIER = o; }
{ const o = ES.suppressesCrit; ES.suppressesCrit = () => false; brk(!!run().bad, 'blindness exclusion removed'); ES.suppressesCrit = o; }
{ const o = Cb.KNOCKBACK_PER_LEVEL; Cb.KNOCKBACK_PER_LEVEL = 0.6; brk(!!run().bad, 'knockback 0.5 -> 0.6'); Cb.KNOCKBACK_PER_LEVEL = o; }
{ const o = Cb.FULL_STRENGTH; Cb.FULL_STRENGTH = 0.5; brk(!!run().bad, 'full threshold 0.9 -> 0.5'); Cb.FULL_STRENGTH = o; }
{ const o = Cb.ATTACKER_SLOWDOWN; Cb.ATTACKER_SLOWDOWN = 0.7; brk(!!run().bad, 'attacker slowdown changed'); Cb.ATTACKER_SLOWDOWN = o; }
console.log(`lockstep-crit: ${base.n} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
