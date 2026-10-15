#!/usr/bin/env node
// hurtwinrefcheck.mjs — infra I6 (s149): the HURT WINDOW (LivingEntity.damage's half-second
// grace, .decomp LivingEntity.java:1059-1069) vs the real 1.18.2 server (golden: runhurtwin.mjs,
// hurt-window.json; scenes: hurtwinscen.mjs). Two engine paths, same hits:
//   player — Effects.addStatusEffect(P,'instant_damage',1,amp) then the engine's own Survival.tick
//            (14d_survival.js: invulnerable countdown, then Effects.tick → magicDamage → Survival.hurt)
//   golem  — the same effect on an EL.spawn'd iron_golem, ticked by Combat.tickEntity (14j_combat.js
//            countdown + Effects.tick → Combat.hurt).
// Nothing here owns a damage number: the hits are the scene's, the arithmetic the engine's.
// Anti-vacuity (D-30/D-305): shrink each path's window in memory and assert a row that matches
// today stops matching.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCENES, SETTLE } from './hurtwinscen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'hurt-window.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'hurt-window.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('hurtwinrefcheck: golden not generated -- run node tools/referee/runhurtwin.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
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
const cells = new Map();
const w = { get: (x, y, z) => cells.get(x + ',' + y + ',' + z) || 0, set: () => {} };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Player.init();
M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
if (M.Diff && M.Diff.set) M.Diff.set('normal');
const { EntityList: EL, Effects: ES, Survival: Sv, Combat: Cb } = M;
const P = M.Player;

function runPlayer(hits) {
  P.health = P.maxHealth || 20; P.dead = false; P.invulnerable = 0; P.lastHurt = 0; P.effects = {}; P.absorption = 0; P.armor = 0;
  // the server runs naturalRegeneration=false; the engine has no gamerule, so the food bar sits below
  // the 18 regen threshold (HungerManager.update) with no saturation — no heal can hide a hit.
  if (typeof P.food === 'number') { P.food = 17; P.saturation = 0; P.exhaustion = 0; }
  const h0 = P.health, last = hits[hits.length - 1][0];
  for (let t = 0; t <= last + SETTLE; t++) {
    for (const [ht, amp] of hits) if (ht === t) ES.addStatusEffect(P, 'instant_damage', 1, amp, false, false);
    Sv.tick(P);
  }
  return Math.round((h0 - P.health) * 1000) / 1000;
}
function runGolem(hits) {
  const g = EL.spawn('iron_golem', 0.5, 0, 0.5);
  if (!g) return NaN;
  const h0 = g.health, last = hits[hits.length - 1][0];
  for (let t = 0; t <= last + SETTLE; t++) {
    for (const [ht, amp] of hits) if (ht === t) ES.addStatusEffect(g, 'instant_damage', 1, amp, false, false);
    Cb.tickEntity(g);
  }
  if (EL.remove) EL.remove(g); else g.dead = true;
  return Math.round((h0 - g.health) * 1000) / 1000;
}
const mode = (a) => { const c = {}; for (const v of a) c[v] = (c[v] || 0) + 1; return +Object.entries(c).sort((x, y) => y[1] - x[1])[0][0]; };

function evaluate() {
  const rows = [];
  for (const s of SCENES) {
    const g = golden.cases[s.id];
    if (!g) { rows.push({ id: s.id, who: '-', ok: false, msg: 'no golden row' }); continue; }
    const stable = (a) => a.every((v) => v === a[0]);
    const sp = mode(g.player), sg = mode(g.golem);
    const ep = runPlayer(s.hits), eg = runGolem(s.hits);
    rows.push({ id: s.id, who: 'player', ok: ep === sp, msg: `server ${sp}${stable(g.player) ? '' : ' (reps ' + g.player.join('/') + ')'} engine ${ep}` });
    rows.push({ id: s.id, who: 'golem', ok: eg === sg, msg: `server ${sg}${stable(g.golem) ? '' : ' (reps ' + g.golem.join('/') + ')'} engine ${eg}` });
  }
  return rows;
}

let failed = 0;
const rows = evaluate();
for (const r of rows) {
  if (!r.ok) failed++;
  if (!r.ok || VERBOSE) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(8)} ${r.who.padEnd(6)} ${r.msg}`);
}
const okPlayer = rows.filter((r) => r.ok && r.who === 'player').map((r) => r.id);
const okGolem = rows.filter((r) => r.ok && r.who === 'golem').map((r) => r.id);

// anti-vacuity: each path's window shrunk to nothing must break at least one row that matches today.
let av = 0, avPass = 0;
function breakAndCatch(label, set, restore, who, okIds) {
  av++;
  set();
  const broke = evaluate().filter((r) => r.who === who && okIds.includes(r.id) && !r.ok).length;
  restore();
  if (broke > 0) avPass++; else { failed++; console.log(`  FAIL anti-vacuity ${label}: no ${who} row that matched caught it`); }
}
{ const k = Sv.INVULNERABLE_TICKS; breakAndCatch('Survival.INVULNERABLE_TICKS=0', () => { Sv.INVULNERABLE_TICKS = 0; }, () => { Sv.INVULNERABLE_TICKS = k; }, 'player', okPlayer); }
{ const k = Cb.INVULNERABLE_TICKS; breakAndCatch('Combat.INVULNERABLE_TICKS=0', () => { Cb.INVULNERABLE_TICKS = 0; }, () => { Cb.INVULNERABLE_TICKS = k; }, 'golem', okGolem); }
if (golden.notes && golden.notes.length) console.log('  golden notes: ' + golden.notes.slice(0, 4).join(' | '));
console.log(`hurtwinrefcheck: ${rows.length - rows.filter((r) => !r.ok).length}/${rows.length} rows match the server, anti-vacuity ${avPass}/${av} -- ${failed} failed`);
console.log(` assertions passed .... ${rows.filter((r) => r.ok).length + avPass}`);
console.log(` failures ........... ${failed}`);
console.log(` breaks caught ...... ${avPass}`);
process.exit(failed ? 1 : 0);
