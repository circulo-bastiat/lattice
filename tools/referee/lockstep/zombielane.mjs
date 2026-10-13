// lockstep/zombielane.mjs -- #6953 (G17-L4a): the ENGINE side of chasescen's zombie lane, one engineRow per tick, to be handed to
// compareTraces against the real-server rep0 log (run.mjs runLane). Same lane as chaserefcheck.mjs (stone corridor, a still survival
// player DIST blocks along, zombie summoned at START, AI on). Row t = the state after t world ticks (row 0 = the summon tick),
// so it lines up with runchase's log[t]. Fields (yaw/pitch are the engine's radians; target 'player' for the survival player): pos, yaw, pitch, target, attackTicks (MeleeAttackGoal cooldown), health.
//   engineZombieTrace(salt, opts) -> engineRow[] (T rows); opts.mob overrides 'zombie' (any chasescen LIVE mob)
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, MCLITE_ROOT } from '../../loadsrc.mjs';
import { T, startX, playerX } from '../chasescen.mjs';
import { engineRow } from './trace.mjs';

const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'];
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
const PAD = 0;
let H = null;
function harness() {
  if (H) return H;
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
  if (M.Goat && M.Goat.init) M.Goat.init();
  M.Player.init();
  M.Gamemode.set(M.Player, M.Gamemode.SURVIVAL);
  if (M.Diff && M.Diff.set) M.Diff.set('normal');
  return (H = { M, w, cells });
}
function buildLane({ w, cells, M }) {
  cells.clear();
  const stone = M.States.stateOf('stone');
  for (let x = -4; x <= 26; x++) {
    for (let z = -1; z <= 1; z++) w.set(x, PAD - 1, z, stone);
    for (let y = PAD; y <= PAD + 1; y++) { w.set(x, y, -2, stone); w.set(x, y, 2, stone); }
  }
  for (let z = -1; z <= 1; z++) for (let y = PAD; y <= PAD + 1; y++) { w.set(-4, y, z, stone); w.set(26, y, z, stone); }
}
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

export function attackTicksOf(Ai, e) {
  const gs = e && e.ai;
  for (const en of (gs && gs.entries) || []) if (en.goal && typeof en.goal.getCooldown === 'function' && en.running) return en.goal.getCooldown();
  return 0;
}
let ran = false;
export function engineZombieTrace(salt, opts = {}) {
  const h = harness(), { M } = h, EL = M.EntityList, P = M.Player, mob = opts.mob || 'zombie';
  if (ran) { P.init(); if (M.Diff && M.Diff.set) M.Diff.set('normal'); }   // a second run starts from a fresh player (hurt/regen timers leaked: tick-120 pos differed)
  ran = true;
  const r = stream(salt);
  EL.random = r; Math.random = r;
  buildLane(h); EL.list.length = 0; EL.spawnCounter = 0;   // #6978: the per-entity JRandom seed folds in the process-wide spawn counter
  M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  const still = () => { P.x = playerX(); P.y = PAD; P.z = 0.5; P.vx = P.vy = P.vz = 0; P.dead = false; P.health = P.maxHealth || 20; };
  still(); P.invulnerable = 0; P.lastHurt = 0; P.exhaustion = 0;   // #6978: the shared player carried the last run's hurt state into the next
  const e = EL.spawn(mob, startX(), PAD, 0.5);
  if (!e) throw new Error('EL.spawn gives nothing');
  e.persistent = true; e.vx = e.vy = e.vz = 0;
  const rows = [];
  for (let t = 0; t < T; t++) {
    rows.push(Object.assign(engineRow(t, e), { pitch: e.pitch || 0, target: e.target ? (e.target === P ? 'player' : String(e.target.id)) : null, attackTicks: attackTicksOf(M.Ai, e) }));
    still();
    EL.tick();
    if (opts.onTick) opts.onTick(t + 1, EL);
  }
  return rows;
}
