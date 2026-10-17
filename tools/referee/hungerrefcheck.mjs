#!/usr/bin/env node
// hungerrefcheck.mjs — infra W (25 Sept 2026): PLAYER HUNGER / EXHAUSTION vs the real 1.18.2 server
// (golden: runhunger.mjs, player-hunger.json -- one growbot survival player; scenarios: hungerscen.mjs).
// Engine side, through the exact joins 14_player.js drives Survival through (src/14_player.js:515-526,
// 874): Survival.jumped/movement/hurt/tick(via a loop)/eat, plus Combat.attack for the one melee scene.
// 'jump'/'move'/'attack' start the engine at exhaustion 0 and compare ONE action's delta to the
// server's own before/after delta (both stay under HungerManager's 4.0 spend line -- hungerscen.mjs's
// header explains why that makes a bare delta exact). 'regen'/'eat' instead seed the engine with the
// server's own recorded PRE-state (health/food/saturation/exhaustion) and replay `ticks` calls to
// Survival.tick, or one Survival.eat, comparing the resulting POST-state.
// Anti-vacuity (D-30/D-305): a golden delta +1 (sprint-jump), the engine's EX_SPRINT constant zeroed
// (sprint_dry), a golden saturation +2 (add_bread_nutrition), and the engine's eat() saturationModifier
// zeroed (add_beef_nutrition).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN } from './hungerscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'player-hunger.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'player-hunger.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('hungerrefcheck: golden not generated -- run node tools/referee/runhunger.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');
let seed = 0x0a4a0125;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// The engine as the game builds it (the pmeleerefcheck loader, same module list -- the ATTACK scene
// needs the whole mob/combat/equip join too, not just Survival).
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js'];
const MOB_MODS = readdirSync(join(MCLITE_ROOT, 'src')).filter((f) => /^07.*\.js$/.test(f) && !BASE_MODS.includes(f)).sort();
const M = loadEngine({ extra: BASE_MODS.concat(MOB_MODS), dom: false, initReg: true });
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
{
  const tsv = readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8');
  const table = {};
  for (const line of tsv.split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('hungerrefcheck: empty item attribute table'); process.exit(1); }
}
if (M.Combat.init) M.Combat.init();
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: (x, y, z) => cells.get(key(x, y, z)) || 0, set: (x, y, z, s) => { if (s) cells.set(key(x, y, z), s); else cells.delete(key(x, y, z)); } };
w.getBlock = w.get; w.setBlock = w.set; w.getLight = () => 0; w.tickingAt = () => true;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = (x, y, z) => { const id = w.get(Math.floor(x), Math.floor(y), Math.floor(z)); return id && M.States.solid[id] === 1 ? M.Physics.shapesFor(id) : null; };
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.EntityList.init(); M.Ai.init(); M.Equip.init(); M.Breed.init(); M.Tame.init(); M.Passive.init();
M.Diff = { get: () => 'normal' };
if (M.Goat && M.Goat.init) M.Goat.init();
M.EntityList.random = rng;
Math.random = rng;
const { EntityList: EL, Items: IT, States: S } = M;
const { Survival: Sv, Combat: Cb } = M;
if (!Sv) { console.log('hungerrefcheck: engine has no Survival module loaded'); process.exit(1); }
const PAD = 0;

function freshPlayer() {
  const P = { x: 0.5, y: PAD + 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, fallDistance: 0, width: 0.6, height: 1.8,
    type: 'player', slot: 0, sprinting: false, inventory: { slots: new Array(46).fill(null), selected: 0 } };
  Sv.init(P);
  return P;
}

// ── the three scene shapes ───────────────────────────────────────────────────────────────────
function jumpDelta(s) {
  const P = freshPlayer();
  Sv.jumped(P, !!s.sprint);
  return P.exhaustion;
}
function moveDelta(s) {
  const P = freshPlayer();
  Sv.movement(P, s.dist, { walking: s.mode === 'walk', sprinting: s.mode === 'sprint', swimming: s.mode === 'swim' });
  return P.exhaustion;
}
function attackDelta(s) {
  cells.clear(); EL.list.length = 0;
  const stone = S.stateOf('stone');
  for (let x = -4; x <= 4; x++) for (let z = -4; z <= 6; z++) w.set(x, PAD, z, stone);
  const P = freshPlayer();
  M.Player = P;
  M.Hand.attackStrengthTicker = 1000;
  const e = EL.spawn(s.target, 0.5, PAD + 1, 2.5);
  if (!e) return { err: `EL.spawn(${s.target}) gives nothing` };
  e.persistent = true; e.noAI = true; e.maxHealth = 100; e.health = 100;
  Cb.attack(P, e);
  return { exhaustion: P.exhaustion, hit: 100 - e.health > 0 };
}
function regenReplay(s, g) {
  const P = freshPlayer();
  P.health = g.preHealth; P.food = g.preFood; P.saturation = g.preSaturation; P.exhaustion = g.preExhaustion; P.foodTimer = g.preFoodTimer;
  for (let i = 0; i < g.ticks; i++) Sv.tick(P);
  return { health: P.health, exhaustion: P.exhaustion, food: P.food, saturation: P.saturation };
}
// 'add' scenes (hungerscen.mjs's header explains the swap: `minecraft:saturation` in place of a
// real Use Item packet) call `Sv.eat` directly with the recorded nutrition and the effect's own
// fixed modifier (1.0) -- `Sv.eat(e, nutrition, saturationModifier)` IS `HungerManager.add`.
function addReplay(s, g) {
  const P = freshPlayer();
  P.food = g.preFood; P.saturation = g.preSaturation;
  Sv.eat(P, g.nutrition, g.modifier);
  return { food: P.food, saturation: P.saturation };
}

// EPS: these fields are Java `float`s server-side; the engine keeps them as JS doubles. Bounding
// the gap between the two by float32 precision (2^-23) at the largest magnitude in play here
// (EXHAUSTION_CAP=40, or a food/health value up to 100 in the attack scene) over at most ~9
// chained additions/multiplications per scene gives 9 * 2^-23 * 100 ~= 1.07e-4; EPS below is a
// flat order-of-magnitude margin over that bound, not a guess at what "close enough" feels like.
const EPS = 0.001;
const near = (a, b) => Math.abs(a - b) <= EPS;

function judgeJumpMove(s, g, engineDelta) {
  if (Number.isNaN(g.before) || Number.isNaN(g.after)) return [`${s.id}: bad golden reading (before=${g.before}, after=${g.after})`];
  const serverDelta = g.delta;
  // swim: the server bot also drifts/bobs in the water after the teleport (golden 0.0518 for 5 commanded blocks = 0.18 block of
  // extra travel at 0.01/block), movement the engine is never asked to replay -- so allow up to 1 block of it, one-sided.
  const ok = s.mode === 'swim' ? serverDelta >= engineDelta - EPS && serverDelta <= engineDelta + 0.01 : near(serverDelta, engineDelta);
  return ok ? [] : [`${s.id}: server exhaustion delta ${serverDelta}, engine ${engineDelta}`];
}
function judgeAttack(s, g, e) {
  if (e.err) return [`${s.id}: ${e.err}`];
  if (!e.hit) return [`${s.id}: engine attack did not land on the target`];
  return near(g.delta, e.exhaustion) ? [] : [`${s.id}: server exhaustion delta ${g.delta}, engine ${e.exhaustion}`];
}
function judgeRegen(s, g, e) {
  const out = [];
  if (!near(g.postHealth, e.health)) out.push(`${s.id}: server health after ${g.ticks} ticks ${g.postHealth}, engine ${e.health} (pre ${g.preHealth}/${g.preFood}/${g.preSaturation}/${g.preExhaustion})`);
  if (!near(g.postExhaustion, e.exhaustion)) out.push(`${s.id}: server exhaustion after ${g.ticks} ticks ${g.postExhaustion}, engine ${e.exhaustion}`);
  if (!near(g.postFood, e.food)) out.push(`${s.id}: server food after ${g.ticks} ticks ${g.postFood}, engine ${e.food}`);
  if (!near(g.postSaturation, e.saturation)) out.push(`${s.id}: server saturation after ${g.ticks} ticks ${g.postSaturation}, engine ${e.saturation}`);
  return out;
}
function judgeAdd(s, g, e) {
  const out = [];
  if (!near(g.postFood, e.food)) out.push(`${s.id}: add(${g.nutrition},${g.modifier}) from food ${g.preFood}: server food ${g.postFood}, engine ${e.food}`);
  if (!near(g.postSaturation, e.saturation)) out.push(`${s.id}: add(${g.nutrition},${g.modifier}) from saturation ${g.preSaturation}: server saturation ${g.postSaturation}, engine ${e.saturation}`);
  return out;
}

console.log(`hungerrefcheck — player hunger/exhaustion vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const reds = [];
let pass = 0;
const ENG = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  if (g.err) { reds.push(`${s.id}: golden itself failed (${g.err})`); continue; }
  let bad;
  if (s.kind === 'jump') { const e = jumpDelta(s); ENG[s.id] = e; bad = judgeJumpMove(s, g, e); }
  else if (s.kind === 'move') { const e = moveDelta(s); ENG[s.id] = e; bad = judgeJumpMove(s, g, e); }
  else if (s.kind === 'attack') { const e = attackDelta(s); ENG[s.id] = e; bad = judgeAttack(s, g, e); }
  else if (s.kind === 'regen') { const e = regenReplay(s, g); ENG[s.id] = e; bad = judgeRegen(s, g, e); }
  else if (s.kind === 'add') { const e = addReplay(s, g); ENG[s.id] = e; bad = judgeAdd(s, g, e); }
  else { bad = [`${s.id}: unknown scene kind ${s.kind}`]; }
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${s.id.padEnd(20)} ${JSON.stringify(ENG[s.id])}  golden ${JSON.stringify(g)}`);
}

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{ const s = SCEN.find((q) => q.id === 'jump_sprint'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.delta = g.delta + 1;
  brk('golden jump_sprint delta +1', judgeJumpMove(s, g, ENG[s.id]).length > 0); }
{ const s = SCEN.find((q) => q.id === 'sprint_dry'); const orig = Sv.EX_SPRINT; Sv.EX_SPRINT = 0;
  const e = moveDelta(s); Sv.EX_SPRINT = orig; brk('engine EX_SPRINT zeroed (sprint_dry)', judgeJumpMove(s, golden.cases[s.id], e).length > 0); }
{ const s = SCEN.find((q) => q.id === 'add_bread_nutrition'); const g = JSON.parse(JSON.stringify(golden.cases[s.id])); g.postSaturation = g.postSaturation + 2;
  brk('golden add_bread_nutrition postSaturation +2', judgeAdd(s, g, ENG[s.id]).length > 0); }
{ const s = SCEN.find((q) => q.id === 'add_beef_nutrition'); const orig = Sv.eat;
  Sv.eat = function (e, nutrition) { e.food = Math.min(nutrition + e.food, Sv.MAX_FOOD); /* saturationModifier zeroed -- no saturation change at all */ };
  const e = addReplay(s, golden.cases[s.id]); Sv.eat = orig; brk('engine eat() saturationModifier zeroed (add_beef_nutrition)', judgeAdd(s, golden.cases[s.id], e).length > 0); }

for (const r of reds) console.log('  ✗ ' + r);
console.log(`hungerrefcheck: ${pass}/${SCEN.length} scenarios agree, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
