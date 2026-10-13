#!/usr/bin/env node
// sweep lockstep check -- #6616 (G17-L90): player sword sweep vs a Player.attack reference (.decomp flag3: cooldown > 0.9, !crit,
// !sprint-knockback, onGround; box inflate(1,0.25,1); distanceToSqr < 9.0; ratio = 1 - 1/(lvl+1); 1.0 + ratio*damage; knockback 0.4).
// Sword tier damage comes from tools/golden/item-attributes-1.18.2.tsv. Prints "<n> breaks caught".
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT as ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(ROOT, 'assets', f)).toString('base64');
const tsv = (f) => readFileSync(join(ROOT, 'tools', 'golden', f), 'utf8').split(/\r?\n/).filter((l) => l && l[0] !== '#').map((l) => l.split('\t'));
const SWORD = {};
for (const c of tsv('item-attributes-1.18.2.tsv')) if (/_sword$/.test(c[0]) && c.length >= 9) SWORD[c[0]] = { dmg: +c[6], spd: +c[7] };
// ── the engine as the game builds it (lootingrefcheck's loader) ────────────────────────────────
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js'];
const MOB_MODS = readdirSync(join(ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
{
  const table = {};
  const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
  for (const c of tsv('item-attributes-1.18.2.tsv')) if (c[0] !== 'item' && c.length >= 9) table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  M.Hand.bindAttrs(table);
}
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init(); M.Combat.init();
M.Diff = { get: () => 'normal' };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init(); M.Combat.init();
M.Diff = { get: () => 'normal' };
if (M.Goat && M.Goat.init) M.Goat.init();
const { EntityList: EL, Items: IT, Survival: Sv, Inventory: Iv, Combat: Cb, Hand: H, States: S } = M;
const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, width: 0.6, height: 1.8, yaw: 0, pitch: 0, type: 'player', slot: 0,
  onGround: true, fallDistance: 0, sprinting: false, inventory: { slots: new Array(Iv.SIZE || 46).fill(null), selected: 0 } };
Sv.init(P); M.Player = P;
for (let x = -3; x <= 6; x++) for (let z = -3; z <= 3; z++) w.set(x, 0, z, S.stateOf('stone'));
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const salts = Array.from({ length: 20 }, (_, i) => i);
const f32 = Math.fround;
let fails = 0, breaks = 0, cases = 0;
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };

// swept kb: sweep sets vz=+0.4 (yaw 0), then Cb.hurt's own 0.4 knockback halves it where it lands: 0.2..0.4
// neighbours of the struck cow at x=2.5 (player at 0.5, so feet distance 2): [dx from player, dz, type]
const NB = [[3.2, 0, 'cow'], [3.4, 0, 'pig'], [3.6, 0, 'cow'], [2.6, 3.0, 'cow']];   // 3.1 is in the box but past 3 blocks; z=3.0 is out of the box
function lane(salt) {
  const r = stream(salt), out = [];
  const swords = Object.keys(SWORD);
  const sword = swords[Math.floor(r() * swords.length)], lvl = Math.floor(r() * 4);
  const mode = ['ground', 'crit', 'sprint'][salt % 3];
  const delay = 20 / SWORD[sword].spd;
  const ticks = Math.floor(r() * (delay + 4));
  P.inventory.slots.fill(null);
  const st = { i: IT.of(sword), n: 1 }; if (lvl) st.t = { Enchantments: [{ id: 'minecraft:sweeping', lvl }] };
  P.inventory.slots[0] = st;
  H.reset(); for (let i = 0; i < ticks; i++) H.tickAttackStrength();
  P.onGround = mode !== 'crit'; P.fallDistance = mode === 'crit' ? 2 : 0; P.sprinting = mode === 'sprint'; P.walkDist = P.walkDistO = 0;
  EL.list.length = 0;
  const t = EL.spawn('cow', 2.5, 1, 0.5), ns = NB.map(([x, z, ty]) => EL.spawn(ty, x - 0 + 0.5 - 0.5, 1, 0.5 + z));
  for (const e of [t].concat(ns)) { e.equip = e.equip || {}; e.maxHealth = e.health = 1000; e.invulnerableTime = 0; e.vx = e.vy = e.vz = 0; }
  ns.forEach((e, i) => { e.x = NB[i][0]; });
  // reference
  const h = Math.min(1, ticks + 0.5 > 0 ? (ticks + 0.5) / delay : 0);
  const f0 = SWORD[sword].dmg * (0.2 + h * h * 0.8);
  const full = h > 0.9, crit = full && P.fallDistance > 0 && !P.onGround && !P.sprinting;
  const f = crit ? f0 * 1.5 : f0, kbMain = P.sprinting && full;
  const sweep = full && !crit && !kbMain && P.onGround;
  const f3 = 1 + (lvl ? 1 - 1 / (lvl + 1) : 0) * f;
  Cb.attack(P, t);
  const hurt = (e) => 1000 - e.health;
  const bad = [];
  const chk = (c, m) => { cases++; if (!c) bad.push(m); };
  chk(Math.abs(hurt(t) - f) < 1e-3, `target ${hurt(t)} vs ${f}`);
  ns.forEach((e, i) => {
    const near = NB[i][1] === 0 && NB[i][0] - 0.5 < 3;   // feet-to-feet distance < 3 (squared < 9.0)
    const want = sweep && near;
    chk(want ? Math.abs(hurt(e) - f3) < 1e-3 : hurt(e) === 0, `nb${i} ${NB[i][2]} hurt ${hurt(e)} want ${want ? f3 : 0}`);
    if (want) chk(e.vz > 0.19 && e.vz < f32(0.4) + 1e-6, `nb${i} kb vz ${e.vz}`);
    else chk(e.vx === 0 && e.vz === 0, `nb${i} moved without sweep`);
  });
  chk(H.attackStrengthTicker === 0, 'cooldown reset');
  return bad.map((b) => `${salt} ${sword} L${lvl} ${mode} t=${ticks}: ${b}`);
}
const run = () => salts.flatMap(lane);
const bad = run();
if (bad.length) { fails++; console.log('  FAIL ' + bad.length + ' divergences, first: ' + bad[0]); }
const c0 = Cb.SWEEP_RANGE_SQ; Cb.SWEEP_RANGE_SQ = 81.0;
brk(run().length > 0, 'sweep range 9.0 -> 81.0 (D-461) caught'); Cb.SWEEP_RANGE_SQ = c0;
const atk = Cb.attack;
Cb.attack = (p, e, o) => { const g = p.fallDistance; p.fallDistance = 0; const saveG = p.onGround; p.onGround = true; const res = atk(p, e, o); p.fallDistance = g; p.onGround = saveG; return res; };
brk(run().length > 0, 'crit exemption removed caught'); Cb.attack = atk;
const sr = Cb.sweepRatio; Cb.sweepRatio = () => 0;
brk(run().length > 0, 'sweeping ratio zeroed caught'); Cb.sweepRatio = sr;
console.log(`sweeplockstepcheck: ${cases} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
