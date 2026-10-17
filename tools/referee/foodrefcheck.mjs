#!/usr/bin/env node
// foodrefcheck.mjs — infra W (25 Sept 2026): PLAYER FOOD + STARVATION vs the real 1.18.2 server
// (golden: runfood.mjs, player-food.json — one growbot survival player, a real Use Item packet per
// eat; scenarios: foodscen.mjs).
//
// ⚠⚠ THE HEADLINE FINDING: EATING IS NOT WIRED IN THIS ENGINE AT ALL. `14l_use.js`'s own OWED list
// (grep -n, this file's own line ~93) names it in full: "eating, and the three-tick use-item hold
// that drives it — G19d". `Use.rightClick` (src/14l_use.js:902-967) never once branches on a food
// item — no UseAction dispatch, nothing spends `P.food`/`P.saturation` from a held item at all.
// `Survival.eat` (src/14d_survival.js:187) — the exact primitive `HungerManager.add` is — EXISTS
// and its formula is correct (checked below, its own 'math' assertions), but grepping every call
// site across `src/` (this file's own WIRE check) finds exactly ONE caller: `07q_effects.js:177`,
// the `minecraft:saturation` STATUS EFFECT (the hunger pack's own stand-in for a real eat, its own
// header explains why) — never a player right-clicking a held food item. So every scene below is
// TWO assertions: 'join' (drive `Use.rightClick` the way a real client's right-click does — this is
// the scene that is SUPPOSED to fail, right now, on every single food item) and 'math' (seed
// `Survival.eat` with the server's own recorded pre-state and check the ARITHMETIC alone is right,
// which it is — G19d is a wiring gap, not a formula bug).
//
// Anti-vacuity (D-30/D-305) targets the checks that are SUPPOSED to pass today (starvation, and the
// 'math' diagnostic) — flipping an already-red 'join' assertion proves nothing new.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN } from './foodscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'player-food.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'player-food.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('foodrefcheck: golden not generated -- run node tools/referee/runfood.mjs (skipped)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

// The engine as the game builds it (the tamerefcheck/hungerrefcheck loader — same module list,
// PLUS 14l_use.js, needed here for the real `Use.rightClick` join).
const BASE_MODS = ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07_world.js', '07h_entities.js',
  '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07q_effects.js',
  '07y_equip.js', '10_gfx.js', '15h_bemodel.js', '07j_entityrender.js', '14d_survival.js', '14j_combat.js', '07zw_mobnbt.js',
  '07w_passive.js', '07d_mining.js', '07e_loot.js', '14i_hand.js', '14l_use.js'];
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
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('foodrefcheck: empty item attribute table'); process.exit(1); }
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
let curDiff = 'normal';
M.Diff = { get: () => curDiff };
if (M.Goat && M.Goat.init) M.Goat.init();
M.Use.init(w);
const { Items: IT } = M;
const { Survival: Sv, Use } = M;
if (!Sv || !Use) { console.log('foodrefcheck: engine has no Survival/Use module loaded'); process.exit(1); }
if (!Use.ready) { console.log('foodrefcheck: Use.init did not come up ready'); process.exit(1); }

function freshPlayer() {
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, fallDistance: 0, width: 0.6, height: 1.8,
    type: 'player', slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 },
    hasTarget: false, targetEntity: null, crouching: false };
  Sv.init(P);
  P.heldItem = () => P.inventory.slots[P.inventory.selected];
  return P;
}

// ── 'join' -- the REAL join a right-click on a held food item takes: Use.rightClick, nothing wired ──
function joinAttempt(item, g) {
  const P = freshPlayer();
  P.food = g.preFood; P.saturation = g.preSaturation;
  const it = IT.of(item);
  if (!it) return { err: `no engine item ${item}` };
  const stack = { i: it, n: 1 };
  P.inventory.slots[0] = stack;
  const before = { food: P.food, saturation: P.saturation, count: stack.n, itemId: it };
  const result = Use.rightClick(P);
  if (P.usingItem) { P.useTicks = Use.drinkMaxTicks(P); Use.drinkFinish(P); }   // hold the button to the end
  const after = { food: P.food, saturation: P.saturation, count: (P.inventory.slots[0] && P.inventory.slots[0].n) || 0,
    itemId: P.inventory.slots[0] && P.inventory.slots[0].i, hasPoison: !!(P.effects && P.effects[M.Effects.NAMES[19]]),
    hasHunger: !!(P.effects && P.effects[M.Effects.NAMES[17]]), hasRegen: !!(P.effects && P.effects[M.Effects.NAMES[10]]), hasAbsorb: !!(P.effects && P.effects[M.Effects.NAMES[22]]), effects: P.effects };
  return { result, before, after };
}
// ── 'math' -- IF eating were wired, would Survival.eat's own formula land on the server's numbers? ──
function mathAttempt(s, g) {
  const P = freshPlayer();
  P.food = g.preFood; P.saturation = g.preSaturation;
  Sv.eat(P, s.nutrition, s.saturationModifier);
  return { food: P.food, saturation: P.saturation };
}
function starveReplay(s, g) {
  const P = freshPlayer();
  P.health = g.preHealth; P.food = g.preFood; P.saturation = g.preSaturation; P.exhaustion = g.preExhaustion; P.foodTimer = g.preFoodTimer;
  P.dead = false;
  const savedDiff = curDiff; curDiff = s.difficulty;
  for (let i = 0; i < g.ticks; i++) Sv.tick(P);
  curDiff = savedDiff;
  return { health: P.health, dead: !!P.dead };
}

const EPS = 0.001; // hungerrefcheck's own bound (float32 vs double, ~9 chained ops at magnitude <=40)
const near = (a, b) => Math.abs(a - b) <= EPS;
const pct = (a, n) => (n ? (100 * a / n).toFixed(1) + '%' : 'n/a');
function zOf(a, n, b, m) { const p = (a + b) / (n + m); if (p <= 0 || p >= 1) return a / n === b / m ? 0 : Infinity; return (a / n - b / m) / Math.sqrt(p * (1 - p) * (1 / n + 1 / m)); }

const reds = [];
let pass = 0, joinPass = 0, mathPass = 0, starvePass = 0;
// A saturation confound runfood.mjs's own header flags: eat_honey_bottle's recorded postSaturation
// (0.2, not the formula's 1.2) carries ONE stray exhaustion-spend crossing from exhaustion left over
// BETWEEN scenes (/effect clear never resets it, and this file's own predecessor scene's sprint burn
// does) -- a measurement confound in the GOLDEN, not an engine bug, so 'math' is skipped for it
// (still judged for 'join', which this confound cannot touch: it is a food/saturation comparison
// against an engine that changes neither, whatever the exact target number is).
// eat_golden_carrot's own golden is ALSO excluded from 'math': the recorded pre-state (food already
// 20) means the real server never actually ate it either (`Sv.canEat`'s own gate, food < 20 unless
// alwaysEdible -- golden_carrot is not) -- Sv.eat has no such gate (it is the raw HungerManager.add
// arithmetic, called only once the caller already decided eating is allowed), so feeding it a
// pre-state the real game would have REFUSED to eat at gives a number that answers a different
// question, not a formula bug.
const MATH_SKIP = new Set(['eat_honey_bottle', 'eat_golden_carrot']);

console.log(`foodrefcheck — player food + starvation vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
const JOIN = {}, MATH = {};
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }
  if (s.kind === 'starve') {
    const e = starveReplay(s, g);
    const bad = [];
    if (!near(g.postHealth, e.health)) bad.push(`${s.id}: server health after ${g.ticks} ticks (from ${g.preHealth}, ${s.difficulty}) ${g.postHealth}, engine ${e.health} (Sv.tick, src/14d_survival.js:369-425)`);
    if (!!g.dead !== e.dead) bad.push(`${s.id}: server dead=${g.dead}, engine dead=${e.dead}`);
    if (bad.length) reds.push(...bad); else { pass++; starvePass++; }
    if (VERBOSE) console.log(`  ${s.id.padEnd(22)} server ${g.preHealth}->${g.postHealth} (${s.difficulty}, ${g.ticks}t)  engine ${e.health}`);
    continue;
  }
  // 'join' -- every food scene's REAL comparison: a right-click on the held item.
  const j = joinAttempt(s.item, g);
  JOIN[s.id] = j;
  if (j.err) { reds.push(`${s.id}: join: ${j.err}`); }
  else {
    const serverAte = Math.abs(g.postFood - g.preFood) > EPS || Math.abs(g.postSaturation - g.preSaturation) > EPS
      || (s.kind === 'eat_container' && j.before.itemId !== null); // container swap is itself an ate-signal
    const eng = { food: j.after.food, saturation: j.after.saturation };
    const engineAte = Math.abs(j.after.food - j.before.food) > EPS || Math.abs(j.after.saturation - j.before.saturation) > EPS
      || j.after.itemId !== j.before.itemId;
    if (serverAte && !engineAte) {
      reds.push(`${s.id}: join: server food ${g.preFood}->${g.postFood}, saturation ${g.preSaturation.toFixed(2)}->${g.postSaturation.toFixed(2)} eating ${s.item}; engine Use.rightClick + full hold returned ${j.result} and left food/saturation/inventory UNCHANGED`);
    } else if (!serverAte) {
      if (!engineAte) { pass++; joinPass++; } // server refused (food full, not alwaysEdible): so must the engine
      else reds.push(`${s.id}: join: server refused to eat ${s.item} at food ${g.preFood}, engine ate`);
    } else { pass++; joinPass++; }
  }
  if (s.kind === 'eat_stat') {
    // Sv.eat has NO probabilistic branch at all -- 2000 engine "trials" (free: no server round-trip)
    // all give 0 hits, boosting the z-test's power far past what the real server's own N could
    // (foodscen.mjs's own header: N=15 real reps is enough only because the engine side costs nothing).
    const N_ENG = 2000;
    let hits = 0;
    for (let t = 0; t < N_ENG; t++) { const q = joinAttempt(s.item, g); if (q.after.hasHunger) hits++; }
    const z = zOf(g.effectHits, g.reps, hits, N_ENG);
    if (Math.abs(z) > 4.5) reds.push(`${s.id}: join: server applied the id-${s.effectId} effect ${pct(g.effectHits, g.reps)} of the time (${g.effectHits}/${g.reps}), engine ${pct(hits, N_ENG)} (z=${z.toFixed(1)})`);
  }
  if (s.kind === 'eat_effects') {
    for (const ef of g.effects) {
      if (ef.present && !(j.after.effects && j.after.effects[M.Effects.NAMES[ef.id]])) reds.push(`${s.id}: join: server gave status id ${ef.id} (duration ${ef.duration}) eating ${s.item}, engine gives none`);
    }
  }
  if (s.kind === 'eat_container') {
    const held = j.after.itemId;
    if (g.container && g.container.id && g.container.id !== s.item && IT.nameOf(held) !== g.container.id) reds.push(`${s.id}: join: server returned a ${g.container.id} (x${g.container.count}) after eating ${s.item}, engine holds ${held ? IT.nameOf(held) : 'nothing'}`);
  }
  // 'math' -- diagnostic: is Survival.eat's OWN formula right, seeded from the server's real pre-state?
  if (!MATH_SKIP.has(s.id)) {
    const m = mathAttempt(s, g);
    MATH[s.id] = m;
    const bad = [];
    if (!near(g.postFood, m.food)) bad.push(`${s.id}: math: server food ${g.preFood}->${g.postFood} (nutrition ${s.nutrition}), Sv.eat gives ${m.food}`);
    if (!near(g.postSaturation, m.saturation)) bad.push(`${s.id}: math: server saturation ${g.preSaturation.toFixed(2)}->${g.postSaturation.toFixed(2)} (mod ${s.saturationModifier}), Sv.eat gives ${m.saturation.toFixed(2)}`);
    if (bad.length) reds.push(...bad); else { pass++; mathPass++; }
  }
  if (VERBOSE) console.log(`  ${s.id.padEnd(22)} server ${g.preFood}/${g.preSaturation.toFixed(1)} -> ${g.postFood}/${g.postSaturation.toFixed(1)}  |  join engine ${j.err ? j.err : j.after.food + '/' + j.after.saturation.toFixed(1)}  math ${MATH[s.id] ? MATH[s.id].food + '/' + MATH[s.id].saturation.toFixed(1) : 'skipped'}`);
}

// ── WIRE -- the structural finding: exactly one Sv.eat call site (07q_effects.js), and 14l_use.js's
// own OWED list still names eating. Both re-read from disk (not the already-loaded module text) so
// the anti-vacuity break below (mutating the in-memory string) provably exercises this logic. ──
function wireCheck() {
  const useSrc = readFileSync(join(MCLITE_ROOT, 'src', '14l_use.js'), 'utf8');
  const owed = !useSrc.includes('eating, and the three-tick use-item hold that drives it —');
  const callers = [];
  for (const f of readdirSync(join(MCLITE_ROOT, 'src')).filter((n) => n.endsWith('.js'))) {
    const t = readFileSync(join(MCLITE_ROOT, 'src', f), 'utf8');
    if (/\bSv\.eat\s*\(/.test(t) || /\.eat\s*=\s*function/.test(t)) { if (/\bSv\.eat\s*\(/.test(t) && f !== '14d_survival.js') callers.push(f); }
  }
  return { owed, callers };
}
{
  const wc = wireCheck();
  if (!wc.owed) reds.push(`WIRE: 14l_use.js still lists eating as owed`);
  else if (!wc.callers.includes('14l_use.js')) reds.push(`WIRE: Sv.eat has no caller in 14l_use.js (callers ${JSON.stringify(wc.callers)})`);
  else { pass++; console.log(`  WIRE                   confirmed: 14l_use.js calls Sv.eat (callers ${wc.callers.join(', ')})`); }
}

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
// All four target checks that are SUPPOSED to pass today (starvation, 'math', WIRE) -- flipping an
// already-red 'join' assertion would prove nothing (hungerrefcheck's own anti-vacuity note applies
// here too: the reds above ARE the finding, not something to also break).
{ const s = SCEN.find((q) => q.id === 'starve_cadence'); const g = Object.assign({}, golden.cases[s.id], { postHealth: golden.cases[s.id].postHealth + 5 });
  const e = starveReplay(s, golden.cases[s.id]);
  brk('golden starve_cadence postHealth +5', !near(g.postHealth, e.health)); }
{ const s = SCEN.find((q) => q.id === 'starve_cadence'); const g = golden.cases[s.id];
  // 'starve_cadence' never reaches ANY difficulty floor (3 real cycles from 15.2 stays at 12.2,
  // nowhere near 1) -- the one starvation scene an accelerated timer can actually be caught on;
  // 'starve_normal_floor'/'starve_easy_floor' both plateau at the same floor value however fast the
  // timer runs, so a break there proves nothing (found empirically writing this anti-vacuity block).
  const orig = Sv.STARVE_TICKS; Sv.STARVE_TICKS = 4; // starves 20x faster
  const e = starveReplay(s, g); Sv.STARVE_TICKS = orig;
  brk('engine STARVE_TICKS set to 4 (starve_cadence)', !near(g.postHealth, e.health)); }
{ const s = SCEN.find((q) => q.id === 'eat_cooked_beef'); const g = golden.cases[s.id];
  const gm = Object.assign({}, g, { postSaturation: g.postSaturation + 3 });
  const e = mathAttempt(s, g);
  brk('golden eat_cooked_beef postSaturation +3', !near(gm.postSaturation, e.saturation)); }
{ const s = SCEN.find((q) => q.id === 'eat_bread'); const g = golden.cases[s.id];
  const P = freshPlayer(); P.food = g.preFood; P.saturation = g.preSaturation;
  Sv.eat(P, s.nutrition, 0); // saturationModifier zeroed -- no saturation change at all
  brk('engine Sv.eat saturationModifier zeroed (eat_bread)', !near(g.postSaturation, P.saturation)); }

for (const r of reds) console.log('  ✗ ' + r);
console.log(`foodrefcheck: ${pass} assertions agree (join ${joinPass}, math ${mathPass}, starve ${starvePass}, wire), ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
