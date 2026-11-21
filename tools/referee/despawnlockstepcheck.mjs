#!/usr/bin/env node
// despawnlockstepcheck.mjs -- #6269 (G17-L37): lockstep scenario 'despawn': a hostile (zombie) and a passive (cow) at 200, 130, 100, 40, 20 blocks
// from a fixed player, 20 salts of a java.util.Random feeding the world stream, TICKS ticks. Compared per mob: the removal tick, and at the end
// despawnCounter and persistence (name-tagged mob = persistent, never removed, counter held at 0). The oracle is an independent transcription of
// MobEntity.checkDespawn (.decomp MobEntity.java:655-683): >128 away removed at once, else counter > 600 && nextInt(800) == 0 && >32 away; <32 resets
// the counter; the counter is +1 a tick (tickNewAi), draws taken in entity-list order. Shares only the entity list with the engine.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
{ const w = { get: () => 0, set: () => {}, tickingAt: () => true, getLight: () => 0 }; w.getBlock = w.get; w.setBlock = w.set; M.World = Object.assign(M.World || {}, w); if (M.Behave && M.Behave.init) M.Behave.init(w); }
M.EntityList.init(); M.Ai.init();
if (M.Passive && M.Passive.init) M.Passive.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
M.Spawn.init(); M.Spawn.ready = false;
if (M.Sky) M.Sky.darknessNow = () => 0;
const { EntityList: EL, Spawn: Sp } = M;
const P = M.Player; P.x = 0.5; P.y = 64; P.z = 0.5;
const TICKS = 2400, SALTS = 20;
class JRandom {
  constructor(seed) { this.s = (BigInt(seed) ^ 0x5DEECE66Dn) & ((1n << 48n) - 1n); }
  next(bits) { this.s = (this.s * 0x5DEECE66Dn + 0xBn) & ((1n << 48n) - 1n); return Number(this.s >> BigInt(48 - bits)) | 0; }
  nextInt(b) {
    if ((b & -b) === b) return Number((BigInt(b) * BigInt(this.next(31))) >> 31n);
    let bits, v; do { bits = this.next(31); v = bits % b; } while (bits - v + (b - 1) < 0 || bits - v + (b - 1) > 2147483647);
    return v;
  }
}
const DIST = [200, 130, 100, 40, 20];
const CASES = [];
for (const mob of ['zombie', 'cow']) for (const d of DIST) for (const persist of [false, true]) CASES.push({ mob, d, persist });
function engine(salt) {
  const rng = new JRandom(salt);
  EL.wr = () => rng.nextInt(800) / 800;
  EL.list.length = 0;
  const mobs = CASES.map((c) => { const e = EL.spawn(c.mob, c.d + 0.5, 64, 0.5); e.persistent = c.persist; e.despawnCounter = 0; return e; });
  const gone = CASES.map(() => -1);
  for (let t = 1; t <= TICKS; t++) {
    for (const e of EL.list.slice()) Sp.despawnOne(e);   // EL.tickMob's own call, one entity at a time
    mobs.forEach((e, i) => { if (gone[i] < 0 && (e.removed || !EL.list.includes(e))) gone[i] = t; });
  }
  return { gone, ctr: mobs.map((e) => e.despawnCounter | 0) };
}
function oracle(salt) {
  const rng = new JRandom(salt);
  const st = CASES.map((c) => ({ c, ctr: 0, gone: -1 }));
  for (let t = 1; t <= TICKS; t++) for (const s of st) {
    if (s.gone >= 0) continue;
    if (s.c.persist) { s.ctr = 0; }
    else {
      const imm = s.c.mob !== 'cow';   // AnimalEntity.canImmediatelyDespawn is false: a cow draws its roll but is never removed
      if (s.c.d > 128 && imm) { s.gone = t; continue; }
      if (s.ctr > 600 && rng.nextInt(800) === 0 && s.c.d > 32 && imm) { s.gone = t; continue; }
      if (s.c.d < 32) s.ctr = 0;
    }
    s.ctr++;
  }
  return { gone: st.map((s) => s.gone), ctr: st.map((s) => (s.gone >= 0 ? null : s.ctr)) };
}
function divergences() {
  let bad = 0, first = '';
  for (let salt = 1; salt <= SALTS; salt++) {
    const a = engine(salt), b = oracle(salt);
    CASES.forEach((c, i) => {
      const gc = a.gone[i] !== b.gone[i], cc = b.ctr[i] !== null && a.ctr[i] !== b.ctr[i];
      if (gc || cc) { bad++; if (!first) first = `salt ${salt} ${c.mob}@${c.d}${c.persist ? ' persistent' : ''}: removal tick engine ${a.gone[i]} oracle ${b.gone[i]}, counter ${a.ctr[i]} vs ${b.ctr[i]}`; }
    });
  }
  return { bad, first };
}
let fails = 0, breaks = 0;
const base = divergences();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
const removed = (() => { const o = oracle(1); return o.gone.filter((g) => g >= 0).length; })();
if (removed < 3 || removed >= CASES.length) { fails++; console.log(`  FAIL scenario vacuous: ${removed}/${CASES.length} removed`); }
{ const k = Sp.DESPAWN_ROLL_ODDS; Sp.DESPAWN_ROLL_ODDS = 1 / 400; const d = divergences(); Sp.DESPAWN_ROLL_ODDS = k;
  if (d.bad) { breaks++; } else { fails++; console.log('  FAIL 800->400 not caught'); } }
{ const k = Sp.DESPAWN_IDLE_TICKS; Sp.DESPAWN_IDLE_TICKS = 300; const d = divergences(); Sp.DESPAWN_IDLE_TICKS = k;
  if (d.bad) breaks++; else { fails++; console.log('  FAIL idle gate 600->300 not caught'); } }
console.log(`${3 - fails + breaks} assertions, ${fails} failures, ${breaks} breaks caught (${CASES.length} mobs x ${SALTS} salts x ${TICKS} ticks, ${base.bad} divergences)`);
process.exit(fails ? 1 : 0);
