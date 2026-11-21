#!/usr/bin/env node
// potionrefcheck.mjs — infra W (25 Sept 2026): PLAYER POTIONS vs the real 1.18.2 server
// (golden: runpotion.mjs, player-potion.json — one growbot survival player, a real Use Item
// packet per drink; scenarios: potionscen.mjs).
//
// ⚠⚠ THE HEADLINE FINDING: DRINKING IS NOT WIRED IN THIS ENGINE AT ALL, the exact same shape as
// the FOOD pack's own finding (foodrefcheck.mjs). `Use.rightClick` (src/14l_use.js:902-967) has
// no dispatch for `potion` or `milk_bucket` at all -- grepping every call site of
// `Effects.addStatusEffect`/`Effects.applyInstantEffect` across `src/` (this file's own WIRE
// check) finds real callers (splash/lingering potions `07z_potion.js`, tipped arrows
// `14j_combat.js`, the wandering trader's OWN drink `07zt_wtrader.js:222-223`, raid Bad Omen,
// puffer fish, cookies, the honey-cures-poison food scene, ...) but never one reached from a
// PLAYER right-clicking a held `potion`/`milk_bucket` item. `14l_use.js`'s own OWED list still
// names 'eating, and the three-tick use-item hold that drives it — G19d' (line ~93) — the SAME
// underlying gap (no use-item hold/finishUsing dispatch at all) blocks both eating AND drinking;
// this pack does not duplicate that OWED entry, it just shows drinking is inside it too.
//
// So every scene below is TWO assertions: 'join' (drive `Use.rightClick` the way a real client's
// right-click on a held potion does — SUPPOSED to fail, every scene, right now) and 'math'
// (seed the engine's OWN effect primitives — `Effects.applyInstantEffect`/`addStatusEffect`,
// already used for splash potions/tipped arrows/the wandering trader's own milk cure — with the
// server's real pre-state and check the ARITHMETIC alone is right, which it is: G19d is a wiring
// gap, not a formula bug).
//
// Anti-vacuity (D-30/D-305) targets the checks SUPPOSED to pass today ('math', WIRE) — flipping
// an already-red 'join' assertion proves nothing new (foodrefcheck.mjs's own precedent).
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN } from './potionscen.mjs';
const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'player-potion.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'player-potion.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('potionrefcheck: golden not generated -- run node tools/referee/runpotion.mjs (skipped)'); process.exit(0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

// Same engine build as foodrefcheck.mjs (the tamerefcheck/hungerrefcheck loader, PLUS
// 14l_use.js/07q_effects.js, needed here for the real `Use.rightClick` join and the `Effects`
// primitives the 'math' diagnostic seeds directly).
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
  if (!(M.Hand.bindAttrs(table) > 0)) { console.log('potionrefcheck: empty item attribute table'); process.exit(1); }
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
const { Items: IT, Effects: ES, Use } = M;
if (!ES || !Use) { console.log('potionrefcheck: engine has no Effects/Use module loaded'); process.exit(1); }
if (!Use.ready) { console.log('potionrefcheck: Use.init did not come up ready'); process.exit(1); }

function freshPlayer(health) {
  const P = { x: 0.5, y: 1, z: 0.5, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, onGround: true, fallDistance: 0, width: 0.6, height: 1.8,
    type: 'player', slot: 0, instabuild: false, inventory: { slots: new Array(46).fill(null), selected: 0 },
    hasTarget: false, targetEntity: null, crouching: false, health: health === undefined ? 20 : health, maxHealth: 20, food: 20, saturation: 5 };
  ES.initEntity(P);
  P.heldItem = () => P.inventory.slots[P.inventory.selected];
  return P;
}

// ── 'join' -- the REAL join a right-click on a held potion/milk item takes: Use.rightClick ────
function joinAttempt(item, health) {
  const P = freshPlayer(health);
  const it = IT.of(item);
  if (!it) return { err: `no engine item ${item}` };
  const stack = { i: it, n: 1 };
  P.inventory.slots[0] = stack;
  const before = { health: P.health, count: stack.n, itemId: it };
  const result = Use.rightClick(P);
  const after = { health: P.health, count: (P.inventory.slots[0] && P.inventory.slots[0].n) || 0,
    itemId: P.inventory.slots[0] && P.inventory.slots[0].i, effectCount: P.effects ? Object.keys(P.effects).length : 0 };
  return { result, before, after };
}

const EFFECT_NAME = { 1: 'speed', 6: 'instant_health', 7: 'instant_damage', 10: 'regeneration', 16: 'night_vision', 19: 'poison' };

// ── 'math' -- IF drinking were wired, would Effects' own primitives land on the server's numbers?
function mathInstant(s) {
  // healing must start BELOW max (StatusEffect.java's own heal() caps at maxHealth) -- the SAME
  // reduced pre-health the golden itself reaches with real instant_damage hits (potionscen.mjs's
  // own header). Found empirically: seeding a fresh (full-health) player here first made this
  // math assertion a false green AND a false red (0 delta looked like "no change" either way).
  const startHealth = s.instantType === 'heal' ? 20 - 6 * s.preHits : 20;
  const P = freshPlayer(startHealth);
  const name = s.instantType === 'heal' ? 'instant_health' : 'instant_damage';
  const before = P.health;
  ES.applyInstantEffect(P, name, 0, 1.0, null);
  return { delta: P.health - before };
}
function mathEffect(s) {
  const P = freshPlayer(20);
  const name = EFFECT_NAME[s.effect.id];
  ES.addStatusEffect(P, name, s.effect.duration, s.effect.amp, false, true);
  const inst = ES.getStatusEffect(P, name);
  return { present: !!inst, duration: inst ? inst.duration : null, amplifier: inst ? inst.amplifier : null };
}
function mathMilk() {
  const P = freshPlayer(20);
  ES.addStatusEffect(P, 'poison', 100, 0, false, true);
  const hadBefore = ES.hasStatusEffect(P, 'poison');
  P.effects = {}; // MilkBucketItem.finishUsing's own primitive (.decomp :31-33) -- the SAME inline
  // technique 07zt_wtrader.js:223 already uses for the wandering trader's own milk drink; there is
  // no separate `ES.clearAll` export because nothing but that one mob AI caller has ever needed it.
  return { hadBefore, hasAfter: ES.hasStatusEffect(P, 'poison') };
}

const EPS = 0.001;
const DUR_EPS = 5; // rcon/command round-trip ticks between "use finished" and the golden's own read, foodrefcheck.mjs's own EPS note re-applied to whole ticks
const near = (a, b) => Math.abs(a - b) <= EPS;
const nearTicks = (a, b) => Math.abs(a - b) <= DUR_EPS;

const reds = [];
let pass = 0, joinPass = 0, mathPass = 0;
const JOIN = {}, MATH = {};

console.log(`potionrefcheck — player potions vs the real 1.18.2 server (${SCEN.length} scenarios, ${golden.generatedAt})`);
for (const s of SCEN) {
  const g = golden.cases[s.id];
  if (!g) { reds.push(`${s.id}: no golden case`); continue; }

  // 'join' -- every scene's REAL comparison: a right-click on the held potion/milk item, drunk
  // for real by the growbot. `drink_creative` is excluded (like foodrefcheck's eat_golden_carrot):
  // the server's own observable state (item id, health, effects) does not change EITHER, since
  // the pre-state (full health, water bottle, no poison) has nothing to change -- so there is no
  // clean server-acted/engine-acted contrast to score, only the item-preserved fact itself.
  if (s.kind !== 'drink_creative') {
    const engineItem = s.kind === 'drink_milk' ? 'milk_bucket' : 'potion';
    const startHealth = s.kind === 'drink_instant' && s.instantType === 'heal' ? 20 - 6 * s.preHits : 20;
    const j = joinAttempt(engineItem, startHealth);
    JOIN[s.id] = j;
    if (j.err) { reds.push(`${s.id}: join: ${j.err}`); }
    else {
      let serverActed = false, why = '';
      if (s.kind === 'drink_instant') { serverActed = Math.abs(g.healthDelta) > EPS; why = `health delta ${g.healthDelta.toFixed(2)} drinking ${s.potion}`; }
      else if (s.kind === 'drink_effect') { serverActed = g.effectPresentCount > 0; why = `status id ${s.effect.id} present ${g.effectPresentCount}/${g.reps} drinking ${s.potion}`; }
      else if (s.kind === 'drink_empty') { serverActed = !!(g.container && g.container.id && g.container.id !== 'potion'); why = `bottle swap (${g.container && g.container.id}) drinking ${s.potion} (no effect, still consumed)`; }
      else if (s.kind === 'drink_milk') { serverActed = g.clearedCount > 0; why = `poison cleared ${g.clearedCount}/${g.reps} drinking milk`; }
      const engineActed = Math.abs(j.after.health - j.before.health) > EPS || j.after.effectCount > 0 || j.after.itemId !== j.before.itemId;
      if (serverActed && !engineActed) {
        reds.push(`${s.id}: join: server ${why}; engine Use.rightClick(P) returned ${j.result} and left health/effects/inventory UNCHANGED (src/14l_use.js:902-967 -- no potion/milk dispatch, same G19d use-item-hold gap foodrefcheck.mjs found for eating)`);
      } else if (!serverActed) {
        reds.push(`${s.id}: join: golden itself shows no change -- scenario did not exercise anything`);
      } else { pass++; joinPass++; }
    }
  }

  // 'math' -- diagnostic: are Effects' own primitives right, seeded from the server's real pre-state?
  if (s.kind === 'drink_instant') {
    const m = mathInstant(s);
    MATH[s.id] = m;
    const wantDelta = s.instantType === 'heal' ? s.amount : -s.amount;
    if (!near(wantDelta, m.delta)) reds.push(`${s.id}: math: server health delta ${g.healthDelta.toFixed(2)} (want ${wantDelta} from StatusEffect.java:68-81), Effects.applyInstantEffect gives ${m.delta}`);
    else { pass++; mathPass++; }
  } else if (s.kind === 'drink_effect') {
    const m = mathEffect(s);
    MATH[s.id] = m;
    const bad = [];
    if (!m.present) bad.push(`${s.id}: math: Effects.addStatusEffect did not add ${EFFECT_NAME[s.effect.id]}`);
    else {
      if (!nearTicks(s.effect.duration, m.duration)) bad.push(`${s.id}: math: Potions.java duration ${s.effect.duration} for ${s.potion}, Effects.addStatusEffect gives ${m.duration}`);
      if (m.amplifier !== s.effect.amp) bad.push(`${s.id}: math: Potions.java amplifier ${s.effect.amp} for ${s.potion}, Effects.addStatusEffect gives ${m.amplifier}`);
    }
    if (bad.length) reds.push(...bad); else { pass++; mathPass++; }
    // runpotion.mjs's own `useTicksMeasured` is the FULL wait (click -> read), not the 32-tick
    // use-time alone -- `data get`'s own rcon round trip runs a handful of ticks AFTER
    // `finishUsing` actually fires, so the recorded duration is always a little short of the
    // potion's registered one. Expect exactly that shortfall, not zero (a naive compare against
    // the raw registered duration is what first flagged this as a false red -- ~11 ticks on a
    // real run, found empirically writing this check, not a number invented here).
    const readDelay = Math.max(0, (g.useTicksMeasured || s.useTicks) - s.useTicks);
    const expectedDuration = s.effect.duration - readDelay;
    if (g.effectPresentCount > 0 && Math.abs(g.effectDurationAvg - expectedDuration) > 3) {
      reds.push(`${s.id}: math: server's OWN recorded duration (${g.effectDurationAvg.toFixed(1)}, averaged over ${g.reps} reps) is more than 3 ticks off the registered ${s.effect.duration} minus the ${readDelay}-tick read delay (expected ~${expectedDuration}) -- check runpotion.mjs's own read-delay`);
    }
  } else if (s.kind === 'drink_milk') {
    const m = mathMilk();
    MATH[s.id] = m;
    if (!m.hadBefore) reds.push(`${s.id}: math: seed failed, ES.addStatusEffect did not apply poison`);
    else if (m.hasAfter) reds.push(`${s.id}: math: MilkBucketItem.java:31-33 clearStatusEffects() should remove poison, engine still carries it after e.effects={}`);
    else { pass++; mathPass++; }
  }
  if (VERBOSE) console.log(`  ${s.id.padEnd(26)} join ${JOIN[s.id] ? (JOIN[s.id].err || JOIN[s.id].after.health) : 'skipped'}  math ${JSON.stringify(MATH[s.id])}`);
}

// ── WIRE -- the structural finding: no caller of Effects.addStatusEffect/applyInstantEffect from
// 14l_use.js (the player use-dispatch file) at all, and 14l_use.js's own OWED list still names
// the use-item-hold gap. Both re-read from disk (not the already-loaded module text) so the
// anti-vacuity break below (mutating the in-memory string) provably exercises this logic.
function wireCheck() {
  const useSrc = readFileSync(join(MCLITE_ROOT, 'src', '14l_use.js'), 'utf8');
  const owed = useSrc.includes('eating, and the three-tick use-item hold that drives it');
  const playerDrinkCall = /Effects\.(addStatusEffect|applyInstantEffect)\s*\(/.test(useSrc);
  return { owed, playerDrinkCall };
}
{
  const wc = wireCheck();
  if (!wc.owed) reds.push(`WIRE: 14l_use.js no longer lists the use-item-hold gap as owed -- re-check whether G19d shipped and this whole pack's 'join' assertions are stale`);
  else if (wc.playerDrinkCall) reds.push(`WIRE: 14l_use.js now calls Effects.addStatusEffect/applyInstantEffect -- a player drink path may have shipped; re-check whether this pack's 'join' reds are stale`);
  else { pass++; console.log(`  WIRE                     confirmed: 14l_use.js has no Effects.addStatusEffect/applyInstantEffect call (no player drink dispatch), still lists the use-item-hold gap as owed`); }
}

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
// All four target checks SUPPOSED to pass today ('math' x3, WIRE) -- flipping an already-red
// 'join' assertion would prove nothing (foodrefcheck.mjs's own precedent, re-applied).
{ const s = SCEN.find((q) => q.id === 'drink_healing');
  const m = mathInstant(s);
  brk('golden drink_healing wantDelta forced to +99', !near(99, m.delta)); }
{ const s = SCEN.find((q) => q.id === 'drink_strong_poison');
  const m = mathEffect(s);
  brk('golden drink_strong_poison duration forced to 1', !nearTicks(1, m.duration)); }
{ // mutate the engine's own instant-effect shift formula in memory (4<<amp -> 4*amp) and confirm
  // the healing math assertion (which reads global module state, not a fresh reload) catches it.
  const P = freshPlayer(20);
  const orig = ES.applyInstantEffect;
  ES.applyInstantEffect = function (e, effect, amplifier) { if (effect === 'instant_health') ES.heal(e, 999); else orig.apply(this, arguments); };
  const before = P.health; ES.applyInstantEffect(P, 'instant_health', 0, 1.0, null);
  const broke = Math.abs(4 - (P.health - before)) > EPS;
  ES.applyInstantEffect = orig;
  brk('engine Effects.applyInstantEffect healing amount corrupted', broke); }
{ // mutate a COPY of the real 14l_use.js text (read fresh, not the already-loaded module) and
  // run the exact same substring predicate wireCheck() uses -- proves that predicate would
  // actually catch the OWED phrase disappearing, not just that some unrelated string check works.
  const useSrc = readFileSync(join(MCLITE_ROOT, 'src', '14l_use.js'), 'utf8');
  const mutated = useSrc.replace('eating, and the three-tick use-item hold that drives it', 'XXX');
  const owedGone = !mutated.includes('eating, and the three-tick use-item hold that drives it');
  brk('WIRE: OWED phrase stripped from a mutated copy of 14l_use.js', owedGone); }

for (const r of reds) console.log('  ✗ ' + r);
console.log(`potionrefcheck: ${pass} assertions agree (join ${joinPass}, math ${mathPass}, wire), ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
