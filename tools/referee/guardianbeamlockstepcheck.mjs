#!/usr/bin/env node
// guardianbeamlockstepcheck.mjs -- #6320 (G17-L66): lockstep scenario 'guardianbeam': a guardian and an elder_guardian with a scripted player 8 blocks
// away, 20 salts (salt = entity id offset + difficulty easy/normal/hard), TICKS ticks. Per tick compared: FireBeamGoal attack timer, whether the
// target field is set, the beam target id, player health, and the mining_fatigue effect (elder: every 1200 ticks of age+id, amp 2, 6000 ticks).
// The oracle is an independent transcription of GuardianEntity.FireBeamGoal (.decomp GuardianEntity.java:365-440: start -10, ++ per tick, beam at 0,
// getWarmupTime 80 / elder 60, damage 1 (+2 hard) (+2 elder) magic then mob attack damage, target cleared) and ElderGuardianEntity.mobTick (:62-79).
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
const { EntityList: EL } = M;

const Gd = M.Guardian, Eg = M.ElderGuardian, ES = M.Effects;
const P = M.Player; P.x = 0.5; P.y = 64; P.z = 8.5;
const TICKS = 2500, SALTS = 20, DIFFS = ['easy', 'normal', 'hard'];
const ATTACK = { guardian: 6, elder_guardian: 8 };
function setup(salt) {
  M.Diff.set(DIFFS[salt % 3]);
  P.health = 100000; P.maxHealth = 100000; P.armor = 0; P.armorToughness = 0; P.absorption = 0; P.invulnerable = 0; P.lastHurt = 0; P.dead = false; P.mode = 0;
  ES.clearStatusEffects(P);
  EL.list.length = 0;
}
function engine(salt) {
  setup(salt);
  const out = [];
  for (const type of ['guardian', 'elder_guardian']) {
    const e = EL.spawn(type, 0.5, 64, 0.5); e.id = 100 + salt * 7; e.inWater = true; e.persistent = true;
    P.health = 100000; P.dead = false; P.invulnerable = 0; P.lastHurt = 0; ES.clearStatusEffects(P);
    const g = new Gd.FireBeamGoal(e), rows = [];
    let running = false;
    for (let t = 1; t <= TICKS; t++) {
      e.age = t;
      if (!e.target) { if (running) { g.stop(); running = false; } e.target = P; }
      if (!running) { g.start(); running = true; }
      g.tick();
      if (!e.target) { g.stop(); running = false; }
      if (Eg.mobTick) Eg.mobTick(e);
      const fx = ES.getStatusEffect(P, 'mining_fatigue');
      rows.push([g.beamTicks(), e.target ? 1 : 0, e.beamTargetId | 0, P.health, fx ? fx.amplifier + ':' + fx.duration : '-'].join(','));
      if (P.invulnerable > 0) P.invulnerable--;
      ES.tick(P);
    }
    out.push(rows);
  }
  return out;
}
function oracle(salt) {
  const diff = DIFFS[salt % 3], out = [];
  for (const type of ['guardian', 'elder_guardian']) {
    const elder = type === 'elder_guardian', warm = elder ? 60 : 80, id = 100 + salt * 7;
    let hp = 100000, inv = 0, last = 0, fx = null, bt = 0, target = false, beamId = 0, running = false;
    const hit = (amt, scaled) => {
      if (scaled) amt = diff === 'easy' ? Math.min(amt / 2 + 1, amt) : diff === 'hard' ? amt * 3 / 2 : amt;
      let fresh = true, full = amt;
      if (inv > 10) { if (amt <= last) return; amt -= last; fresh = false; }
      hp = Math.max(0, hp - amt); if (fresh) inv = 20; last = full;
    };
    const rows = [];
    for (let t = 1; t <= TICKS; t++) {
      if (!target) { running = false; target = true; }
      if (!running) { bt = -10; running = true; }
      bt++;
      if (bt === 0) beamId = 1;
      else if (bt >= warm) {
        hit(1 + (diff === 'hard' ? 2 : 0) + (elder ? 2 : 0), false);
        hit(ATTACK[type], true);
        target = false;
      }
      if (!target) { beamId = 0; running = false; }
      if (elder && (t + id) % 1200 === 0 && !(fx && fx.a >= 2 && fx.d >= 1200)) fx = { a: 2, d: 6000 };
      rows.push([bt, target ? 1 : 0, beamId, hp, fx ? fx.a + ':' + fx.d : '-'].join(','));
      if (inv > 0) inv--;
      if (fx && --fx.d <= 0) fx = null;
    }
    out.push(rows);
  }
  return out;
}
function divergences() {
  let bad = 0, first = '';
  for (let salt = 1; salt <= SALTS; salt++) {
    const a = engine(salt), b = oracle(salt);
    a.forEach((rows, k) => rows.forEach((r, i) => {
      if (r !== b[k][i]) { bad++; if (!first) first = `salt ${salt} ${k ? 'elder' : 'guardian'} tick ${i + 1}: engine [${r}] oracle [${b[k][i]}] (timer,target,beamId,health,fatigue)`; }
    }));
  }
  return { bad, first };
}
let fails = 0, breaks = 0, faultNote = '';
const base = divergences();
if (base.bad) { fails++; console.log(`  FAIL ${base.bad} divergences; first: ${base.first}`); }
{ const o = oracle(1); if (!o[0].some((r) => r.split(',')[3] < 100000) || !o[1].some((r) => r.endsWith('2:6000'))) { fails++; console.log('  FAIL scenario vacuous: no beam damage / no mining fatigue'); } }
{ const k = Gd.WARMUP_GUARDIAN; Gd.WARMUP_GUARDIAN = 60; const d = divergences(); Gd.WARMUP_GUARDIAN = k;
  if (d.bad) { breaks++; faultNote = d.first; } else { fails++; console.log('  FAIL attack duration 80->60 not caught'); } }
{ const k = Eg.DURATION; Eg.DURATION = 3000; const d = divergences(); Eg.DURATION = k;
  if (d.bad) breaks++; else { fails++; console.log('  FAIL fatigue 6000->3000 not caught'); } }
console.log(`${3 - fails + breaks} assertions, ${fails} failures, ${breaks} breaks caught (guardian+elder x ${SALTS} salts x ${TICKS} ticks, ${base.bad} divergences)`);
if (faultNote) console.log("  attack duration 80->60 first reported: " + faultNote);
process.exit(fails ? 1 : 0);
