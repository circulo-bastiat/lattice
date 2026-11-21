#!/usr/bin/env node
// meleerefcheck.mjs — infra W (25 Sept 2026): MOB MELEE (mob-hits-player) damage vs the real 1.18.2
// server (golden: runmelee.mjs, mob-melee.json; scenarios: meleescen.mjs). Per scenario the engine
// spawns the mob (`EL.spawn`, which already runs `EL.DEFAULTS[type]` -- the wither_skeleton/hoglin/slime
// per-instance `attackDamage` overrides), equips the PLAYER's armour into the real inventory slots
// (`Sv.updateArmor`, the same function `15_hud.js` reads), and calls `Cb.mobAttack(mob, M.Player)` --
// the engine's own mob-strikes-a-player entry point (src/14j_combat.js:819), never a hand-rolled
// re-derivation of the damage formula (D-331). Health lost and the tracked status effect are compared
// against the server's own (constant -- exact; a few noisy cases get a 1-point tolerance, named per
// case). No golden -> SKIP. Anti-vacuity (D-30/D-305): 3+ named breaks, each asserted caught.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { MOBS, ARMOR, ARMOR_TIERS, EFFECT_RAWID } from './meleescen.mjs';

const VERBOSE = process.argv.includes('--verbose');
const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN = [join(refDir, 'golden', 'mob-melee.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'mob-melee.json')].find((f) => existsSync(f));
if (!GOLDEN) { console.log('meleerefcheck: SKIP (golden not generated -- run node tools/referee/runmelee.mjs)'); process.exit(process.env.MCLITE_REQUIRE_REFEREE ? 1 : 0); }
const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'));
const rdj = (f) => JSON.parse(readFileSync(join(MCLITE_ROOT, 'assets', f), 'utf8'));
const b64 = (f) => readFileSync(join(MCLITE_ROOT, 'assets', f)).toString('base64');

const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '14f_inventory.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js',
    '07d_mining.js', '07e_loot.js', '07i_entitylist.js', '07y_equip.js', '07m_breed.js', '07w_passive.js',
    '07q_effects.js', '14d_survival.js', '14j_combat.js', '07zk_undead.js', '07zs_spawner.js', '07zzf_piglin.js',
    '07zzg_hoglin.js', '07zd_slime.js', '07l_spawn.js', '14e_gamemode.js', '14i_hand.js', '14_player.js'],
  initReg: true,
});
M.DATA = Object.assign({}, M.DATA, { entities: rdj('entities.json') });
M.Entities.init();
M.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
M.Loot.init({ loot: b64('loot.bin'), lootBytes: rdj('loot.meta.json').jsonBytes });
const cells = new Map();
const key = (x, y, z) => x + ',' + y + ',' + z;
const w = { get: () => 0, set: () => {}, getLight: () => 0, tickingAt: () => true };
w.getBlock = w.get; w.setBlock = w.set;
M.World = Object.assign(M.World || {}, w);
if (M.Behave && M.Behave.init) M.Behave.init(w);
M.Physics.shapeAt = () => null;
M.Physics.solidAt = () => false;
M.EntityList.init(); M.Equip.init(); M.Breed.init(); M.Passive.init();
// The held-weapon ATTACK_DAMAGE table (`Hand.attackDamageFor`, read by `Cb.mobAttack` for a
// mob's main hand): the SAME golden TSV gen-data inlines as DATA.itemAttrs -- loadEngine never
// runs gen-data, so read it off disk exactly as mobpickupcheck/handcheck do (never a typed copy).
{
  const table = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r16 = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r16(c[6]), r16(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
M.Player.init();
{ // the held weapon's ATTACK_DAMAGE: `DATA.itemAttrs` in the game; loadEngine never runs gen-data, so read the same
  // golden TSV off disk (combatcheck/handcheck/mobpickupcheck's convention, D-305: never a typed copy)
  const table = {};
  for (const line of readFileSync(join(MCLITE_ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
const { EntityList: EL, Items: IT, Equip: Eq, Survival: Sv, Inventory: Iv, Combat: Cb, Effects: ES, Diff, Gamemode: Gm } = M;
const P = M.Player;
// ⚠ THE DEFAULT PLAYER IS CREATIVE (14_player.js: `mode: 1`), WHICH IS `invulnerableGamemode` --
// `Sv.hurt`'s very first line (`if (e.dead || e.invulnerableGamemode) return false`) makes every
// mob hit a silent no-op until the player is put into SURVIVAL, same as the real server's bot
// (`gamemode survival`, runmelee.mjs).
Gm.set(P, Gm.SURVIVAL);

function equipPlayer(tier) {
  const pieces = ARMOR[tier];
  const slotOf = (it) => it.endsWith('boots') ? 0 : it.endsWith('leggings') ? 1 : it.endsWith('chestplate') ? 2 : 3;
  for (let i = 0; i < 4; i++) Iv.setItem(P.inventory, Iv.ARMOR_START + i, Iv.EMPTY);
  for (const it of pieces) {
    const st = { i: IT.of(it), n: 1 };
    // the engine's stack NBT (`stack.t`, the same `Enchantments` list Cb.enchantList reads for every stack): the old
    // `st.ench` field was read by nothing, so Protection IV was inert and diamond_prot4 came back identical to diamond.
    if (tier === 'diamond_prot4') st.t = { Enchantments: [{ id: 'minecraft:protection', lvl: 4 }] };
    Iv.setItem(P.inventory, Iv.ARMOR_START + slotOf(it), st);
  }
  Sv.updateArmor(P, P.inventory);
}

function engineHit(scenario, mobId, diffOverride) {
  EL.list.length = 0;
  if (diffOverride) Diff.set(diffOverride); else Diff.set('normal');
  Sv.init(P);
  P.effects = {};   // `Sv.init` does not own status effects (07q_effects.js's own store) -- clear the
                     // previous scenario's Poison/Hunger/Wither so `ES.hasStatusEffect` below only ever
                     // reflects THIS hit, never a stale one from an earlier case in the same process.
  P.x = 0; P.y = 64; P.z = 0;
  const m = MOBS.find((q) => q.id === mobId);
  const e = EL.spawn(m.mob, 1, 64, 0);
  if (!e) return { err: `EL.spawn gives nothing for ${m.mob}` };
  e.persistent = true;
  // ⚠ THE SERVER'S SUMMON CARRIES NBT (Tags, PersistenceRequired -- runmelee.mjs), and SummonCommand only runs
  // `MobEntity.initialize` for a summon WITHOUT NBT: no initEquipment, so its vindicator/brute/wither skeleton held
  // NOTHING (the golden's vindicator hits 5 = the bare attribute, not 13 with an iron axe). Mirror it: empty hands
  // and armour, then the scenario's own HandItems.
  for (const slot of [IT.MAINHAND, IT.OFFHAND, IT.FEET, IT.LEGS, IT.CHEST, IT.HEAD]) Eq.setEquipped(e, slot, null);
  if (m.hand) Eq.setEquipped(e, IT.MAINHAND, { i: IT.of(m.hand), n: 1 });
  const before = Math.round(P.health * 100);
  const hit = Cb.mobAttack(e, P);
  const after = Math.round(P.health * 100);
  const effect = m.effect ? !!(ES && ES.hasStatusEffect && ES.hasStatusEffect(P, m.effect)) : null;
  const effDur = effect && P.effects && P.effects[m.effect] ? P.effects[m.effect].duration : 0;
  // One Poison tick on THIS armour (StatusEffect.applyUpdateEffect: DamageSource.MAGIC, 1.0 --
  // not unblockable, so Protection reduces it), through the engine's own Sv.hurt 'magic' source.
  let poisonTick = 0;
  if (m.effect === 'poison') {
    Sv.init(P); P.invulnerable = 0; P.lastHurt = 0;
    const h0 = Math.round(P.health * 100); Sv.hurt(P, 'magic', 1); poisonTick = h0 - Math.round(P.health * 100);
  }
  return { hit, before, after, effect, effDur, poisonTick, err: null };
}

const reds = [];
let pass = 0;
const lost = (b, a) => ((b - a) / 100).toFixed(2).replace(/\.?0+$/, '') || '0';
// A hit landed inside a poll gap ("first hit" from the REAL server) sometimes reads 1 tick of
// natural variance the server's own combat RNG (a crit roll never fires here -- no sprint, no fall --
// but `Sv.hurt`'s invulnerability-window arithmetic can shave a fixed point off a repeat read); the
// golden itself is asserted CONSTANT over reps below, so any looseness here is the CHECK's own, named,
// never silently widened per D-30.
const TOL = 5; // 0.05 health, x100 fixed point
const DUR_TOL = 25; // ticks: poll gap (3) + RCON round-trips; measured lag up to 19 on a loaded 2-core container (cave_spider 140 read as 121)
function compareCase(key, g, e) {
  if (e.err) return [`${key}: ${e.err}`];
  // ⚠ "BEFORE" IS NOT ALWAYS A CLEAN 20.0: the runner heals+repositions the bot at the TOP of every
  // rep, but a previous rep's attacker that missed its own recorded window (a NO-HIT rep) can still
  // be mid-swing when this rep's heal lands, landing an extra hit before this rep's own attacker even
  // spawns -- runmelee.mjs's own per-lane kill-on-detect closes most of this, not all of it. Rather
  // than trust "before" at all, use each rep's OWN (before-after) delta and take the modal positive
  // one -- the single most common actual first-hit magnitude across reps, exactly what a rep with a
  // contaminated "before" would NOT match twice running.
  const all = g.before.map((b, i) => (b == null || g.after[i] == null) ? null : { b, d: b - g.after[i] }).filter((v) => v && v.d > 0);
  // ...and a rep that STARTED AT FULL HEALTH cannot have been contaminated: when there is one, only such reps vote.
  // cave_spider@iron's golden is 19.12->18.12, 19.12->18.12, 20->19.12: the two contaminated reps read a POISON
  // tick (1.0, magic, past the armour) after an earlier hit, outvoting the one clean 0.88 hit.
  const clean = all.filter((v) => v.b === 2000);
  const deltas = (clean.length ? clean : all).map((v) => v.d);
  if (!deltas.length) return null; // server itself never landed a clean hit -- SKIP, not a red (still_owed, named below)
  const counts = new Map();
  for (const d of deltas) counts.set(d, (counts.get(d) || 0) + 1);
  let gLost = deltas[0], best = 0;
  for (const [d, c] of counts) if (c > best) { best = c; gLost = d; }
  const landed = deltas;
  const eLost = e.before - e.after;
  // POISON-TICK REPS (cave_spider, named): the bot's Health read can land after the bite itself, so a
  // rep's delta is then only Poison ticks (golden cave_spider@iron [100,100,88], @diamond_prot4
  // [16,16,36]: 36 = one MAGIC tick through Protection IV). Such a case is green iff some rep IS the
  // engine's hit and every other rep is the hit or whole Poison ticks on top of it -- never a free pass.
  if (e.poisonTick > 0 && Math.abs(gLost - eLost) > TOL) {
    const isTicks = (d) => [0, eLost].some((b) => { const k = Math.round((d - b) / e.poisonTick); return k >= 1 && Math.abs(d - b - k * e.poisonTick) <= TOL; });
    if (deltas.some((d) => Math.abs(d - eLost) <= TOL) && deltas.every((d) => Math.abs(d - eLost) <= TOL || isTicks(d))) gLost = eLost;
  }
  if (Math.abs(gLost - eLost) > TOL) return [`${key}: server loses ${lost(2000, 2000 - gLost)} health, engine ${lost(e.before, e.after)}`];
  const wantEffect = MOBS.find((m) => key.startsWith(m.id + '@')).effect;
  if (wantEffect) {
    const serverHitRate = (g.effectHits && g.effectHits[wantEffect] || 0) / landed.length;
    const serverExpects = serverHitRate >= 0.5;
    if (serverExpects !== !!e.effect) return [`${key}: server applies ${wantEffect} ${(serverHitRate * 100).toFixed(0)}% of hits, engine ${e.effect ? 'does' : 'does not'}`];
    // s148: the effect's DURATION. The server's read lands <= ~6 ticks after the hit (poll gap + one RCON
    // round-trip), so the engine's at-hit duration must sit in [server max, server max + DUR_TOL].
    const durs = (g.effDur || []).filter((v) => v != null && v > 0);
    if (serverExpects && durs.length) {
      const sMax = Math.max(...durs), ed = e.effDur || 0;
      if (ed < sMax || ed - sMax > DUR_TOL) return [`${key}: ${wantEffect} lasts ~${sMax}-${sMax + DUR_TOL} ticks on the server, engine ${ed}`];
    }
  }
  return [];
}

console.log(`meleerefcheck — mob melee vs the real 1.18.2 server (${Object.keys(golden.cases).length} cases, ${golden.generatedAt})`);
const ENG = {};
const skipped = [];
for (const [key, g] of Object.entries(golden.cases)) {
  const [mobId, tier, diff] = key.split('@');
  // HARNESS (orchestrator, 25 Sept): runmelee summons WITH NBT (Tags, PersistenceRequired), and SummonCommand only runs
  // MobEntity.initialize for an NBT-less summon (.decomp SummonCommand.java:90) -- WitherSkeletonEntity.initialize is what
  // sets attack_damage 4.0 (.decomp WitherSkeletonEntity.java:80-82; field_23721 IS generic.attack_damage). Every natural
  // or spawn-egg wither skeleton gets 4; the golden's 2 is the un-initialized mob. Not compared until runmelee summons it bare.
  if (mobId === 'wither_skeleton') { skipped.push(key + ' (harness: NBT summon skips initialize)'); continue; }
  if (tier && ARMOR_TIERS.indexOf(tier) >= 0 && !diff) equipPlayer(tier); else equipPlayer('none');
  const e = engineHit(key, mobId, diff);
  ENG[key] = e;
  const bad = compareCase(key, g, e);
  if (bad === null) { skipped.push(key); continue; }
  if (bad.length) reds.push(...bad); else pass++;
  if (VERBOSE) console.log(`  ${key.padEnd(28)} server ${e.err || '?'} engine ${e.err || lost(e.before, e.after)}`);
}
for (const r of reds) console.log('  ✗ ' + r);
if (skipped.length) console.log(`  (server itself never landed a hit, not compared: ${skipped.join(', ')})`);

let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{ // break 1: shift a golden damage by 1 full point (100 x100-units) -- must flip a green to red
  const key = 'zombie@none'; const g = JSON.parse(JSON.stringify(golden.cases[key]));
  g.after = g.after.map((v) => v + 100);
  const before = compareCase(key, golden.cases[key], ENG[key]);
  const after = compareCase(key, g, ENG[key]);
  brk('golden zombie@none damage -1', (before || []).join() !== (after || []).join());
}
{ // break 2: strip the golden's own Protection IV reduction (copy the plain diamond numbers over diamond_prot4's)
  // -- the engine now applies Protection (Sv.protectionOf), so its green verdict must turn red.
  const key = 'zombie@diamond_prot4'; const g = JSON.parse(JSON.stringify(golden.cases[key]));
  g.after = golden.cases['zombie@diamond'].after.slice(); g.before = golden.cases['zombie@diamond'].before.slice();
  const before = compareCase(key, golden.cases[key], ENG[key]);
  const after = compareCase(key, g, ENG[key]);
  brk('golden diamond_prot4 -> diamond (Protection IV silently removed)', (before || []).join() !== (after || []).join());
}
{ // break 2b (cloud, keen-johnson-xickva) -- the sword out of the zombie's hand: the held-weapon
  // damage bonus (14j_combat.js's own `!hog && !golem`-guarded held-item block) must be what
  // turns this case green.
  const key = 'zombie_sword@none'; const m = MOBS.find((q) => q.id === 'zombie_sword'); const hand = m.hand;
  equipPlayer('none'); m.hand = null; const bare = engineHit(key, 'zombie_sword'); m.hand = hand;
  brk('zombie_sword with the sword removed', (compareCase(key, golden.cases[key], ENG[key]) || []).join() !== (compareCase(key, golden.cases[key], bare) || []).join());
}
{ // break 3: force the engine's own health down by an extra full point after the real hit -- must
  // turn a currently-green comparison red.
  const key = 'spider@none';
  const bumped = { before: ENG[key].before, after: ENG[key].after - 100, err: null, effect: ENG[key].effect };
  const before = compareCase(key, golden.cases[key], ENG[key]);
  const after = compareCase(key, golden.cases[key], bumped);
  brk('engine spider@none health forced -1 extra', (before || []).join() !== (after || []).join());
}
{ // break 4b: the Poison-tick allowance must not green a WRONG bite -- engine cave_spider@iron hit +0.5.
  const key = 'cave_spider@iron'; const E = ENG[key];
  const bad = compareCase(key, golden.cases[key], Object.assign({}, E, { after: E.after - 50 }));
  brk('engine cave_spider@iron bite +0.5 under the Poison-tick rule', (bad || []).length > 0);
}
{ // break 4 (s148): stretch the golden husk Hunger duration by 70 ticks (140 -> 210, the floor(140*1.5) vs
  // 140*(int)1.5 difference) -- a green duration comparison must turn red, or an already-red one change.
  const key = 'husk@none'; const g0 = JSON.parse(JSON.stringify(golden.cases[key] || {}));
  // an older golden has no effDur (rerun runmelee.mjs for the real one); seed it from the engine so the comparator is still proven able to fail
  if (!g0.effDur) g0.effDur = [ENG[key].effDur];
  const g = JSON.parse(JSON.stringify(g0)); g.effDur = g.effDur.map((v) => (v == null ? v : v + 70));
  const before = compareCase(key, g0, ENG[key]);
  const after = compareCase(key, g, ENG[key]);
  brk('golden husk@none Hunger duration +70 ticks', (before || []).join() !== (after || []).join());
}
for (const r of reds) if (r.startsWith('anti-vacuity')) console.log('  ✗ ' + r);   // pushed after the scenario reds printed
console.log(`meleerefcheck: ${pass}/${Object.keys(golden.cases).length - skipped.length} scenarios match, ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
