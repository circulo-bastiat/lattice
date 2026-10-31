#!/usr/bin/env node
// raidrefcheck.mjs — infra W (25 Sept 2026): RAIDS (wave composition per difficulty) vs the
// real 1.18.2 dedicated server (golden: runraid.mjs, raid-waves.json; scenarios: raidscen.mjs).
//
// TWO INDEPENDENT LAYERS, same shape potionrefcheck.mjs/foodrefcheck.mjs already use for a
// module this engine can't fully live-drive yet:
//
//  1. TABLE -- `Rd.MAX_WAVES`, `Rd.MEMBERS`, `Rd.CAN_LEAD`, `Rd.ravagerPassengerType` diffed
//     LINE FOR LINE against reference tables transcribed straight out of `.decomp`
//     (`Raid.java:764-774`'s `getMaxWaves`, `Raid.java:793-797`'s five `Member` enum constants,
//     `RaiderEntity`/`WitchEntity`/`RavagerEntity`'s own `canLead()` overrides, and
//     `Raid.java:504-514`'s ravager-passenger branch) -- this file's own `DECOMP_*` constants
//     cite the exact lines. This is real vs-vanilla-source comparison and needs no live server.
//  2. DISTRIBUTION -- `Rd.getBonusCount` driven through the engine's OWN randInt hook (never a
//     reimplementation) many times per (type, difficulty, waveIdx) case, and the resulting
//     empirical distribution checked against probabilities ANALYTICALLY DERIVED from
//     `Raid.getBonusCount`'s own branch structure (.decomp `Raid.java:702-726`, transcribed in
//     `expectedDist` below with the derivation shown per case) -- a real self-consistency check
//     of the FORMULA (Math.random satisfies the same `nextInt(bound)` uniform contract
//     `Random.nextInt` does, so the SHAPE is comparable without needing bit-exact PRNG parity).
//
// GOLDEN (runraid.mjs, real server, `raid start` trigger -- FINDING: the `/raid` debug command
// turned out to be dead code on the real 1.18.2 dedicated server, never registered by
// `CommandManager.java`; runraid.mjs's own header has the full citation and the real bed +
// villager + Bad Omen trigger it uses instead) is a THIRD, cross-checking layer when present:
// per-wave raider counts (base + bonus, exact and deterministic apart from the bonus draws)
// read off real raids. It is NOT required for this check to find a real engine bug -- layers 1
// and 2 above already do that without it -- so its absence SKIPS only that one layer, not the
// whole check (D-30/D-305's "skip without golden" contract, same as potionrefcheck.mjs).
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { loadEngine, MCLITE_ROOT } from '../loadsrc.mjs';
import { SCEN, RAIDER_TYPES } from './raidscen.mjs';
const VERBOSE = process.argv.includes('--verbose');

const refDir = process.env.MCLITE_REFEREE_DIR || join(homedir(), '.mclite-referee', '1.18.2');
const GOLDEN_CANDIDATES = [join(refDir, 'golden', 'raid-waves.json'), join(MCLITE_ROOT, '..', 'mclite-store', 'golden', 'raid-waves.json')];
const GOLDEN_PATH = GOLDEN_CANDIDATES.find((f) => existsSync(f));
const golden = GOLDEN_PATH ? JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) : null;

const M = loadEngine({ extra: ['07s_raid.js'], dom: false, initReg: true });
const { Raid: Rd } = M;
if (!Rd || !Rd.ready) { console.log('raidrefcheck: engine has no Raid module loaded'); process.exit(1); }

const reds = [];
let pass = 0, tablePass = 0, distPass = 0, goldenPass = 0;

// ── LAYER 1: TABLE — reference values transcribed straight out of .decomp, cited per line ──────
// `Raid.java:764-774` getMaxWaves(Difficulty): switch on field_5805/field_5802/field_5807 (Yarn's
// EASY/NORMAL/HARD) returning 3/5/7, default (PEACEFUL) 0.
const DECOMP_MAX_WAVES = { peaceful: 0, easy: 3, normal: 5, hard: 7 };
// `Raid.java`'s five `Member` enum constants (search text near "static enum Member", each
// `new int[]{...}` is the per-wave base count array, index 0 unused (waves are 1-based)):
//   field_16631 (vindicator, EntityType.field_6117) {0,0,2,0,1,4,2,5}
//   field_16634 (evoker,     EntityType.field_6090) {0,0,0,0,0,1,1,2}
//   field_16633 (pillager,   EntityType.field_6105) {0,4,3,3,4,4,4,2}
//   field_16635 (witch,      EntityType.field_6145) {0,0,0,0,3,0,0,1}
//   field_16630 (ravager,    EntityType.field_6134) {0,0,0,1,0,1,0,2}
const DECOMP_MEMBERS = {
  vindicator: [0, 0, 2, 0, 1, 4, 2, 5],
  evoker: [0, 0, 0, 0, 0, 1, 1, 2],
  pillager: [0, 4, 3, 3, 4, 4, 4, 2],
  witch: [0, 0, 0, 0, 3, 0, 0, 1],
  ravager: [0, 0, 0, 1, 0, 1, 0, 2],
};
// `RaiderEntity.canLead()` base method defaults true; `WitchEntity.canLead()` and
// `RavagerEntity.canLead()` are the only two overrides, both to false (this pack's own read of
// both files, cited in 07s_raid.js's own comment at Rd.CAN_LEAD).
const DECOMP_CAN_LEAD = { vindicator: true, evoker: true, pillager: true, witch: false, ravager: false };
// `Raid.java:504-514` (spawnNextWave's ravager-passenger branch, $$2 = waveIdx, $$7 = ridersPlaced
// this Member): wave == getMaxWaves(NORMAL) (5) -> pillager; wave >= getMaxWaves(HARD) (7) ->
// first ravager this Member carries an evoker, every later one a vindicator; else no rider.
function decompRavagerPassenger(waveIdx, n) {
  if (waveIdx === DECOMP_MAX_WAVES.normal) return 'pillager';
  if (waveIdx >= DECOMP_MAX_WAVES.hard) return n === 0 ? 'evoker' : 'vindicator';
  return null;
}

function deepEq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function runTableChecks(RdMod) {
  let ok = true;
  if (!deepEq(RdMod.MAX_WAVES, DECOMP_MAX_WAVES)) {
    reds.push(`TABLE: Rd.MAX_WAVES ${JSON.stringify(RdMod.MAX_WAVES)} != Raid.getMaxWaves (.decomp Raid.java:764-774) ${JSON.stringify(DECOMP_MAX_WAVES)}`);
    ok = false;
  }
  for (const type of RAIDER_TYPES) {
    if (!deepEq(RdMod.MEMBERS[type], DECOMP_MEMBERS[type])) {
      reds.push(`TABLE: Rd.MEMBERS.${type} ${JSON.stringify(RdMod.MEMBERS[type])} != Raid.Member (.decomp Raid.java, static enum Member) ${JSON.stringify(DECOMP_MEMBERS[type])}`);
      ok = false;
    }
    if (RdMod.CAN_LEAD[type] !== DECOMP_CAN_LEAD[type]) {
      reds.push(`TABLE: Rd.CAN_LEAD.${type} ${RdMod.CAN_LEAD[type]} != RaiderEntity/WitchEntity/RavagerEntity.canLead() ${DECOMP_CAN_LEAD[type]}`);
      ok = false;
    }
  }
  const waveProbe = [1, 2, 3, 4, 5, 6, 7, 8];
  for (const w of waveProbe) for (const n of [0, 1, 2]) {
    const got = RdMod.ravagerPassengerType(w, n);
    const want = decompRavagerPassenger(w, n);
    if (got !== want) {
      reds.push(`TABLE: Rd.ravagerPassengerType(${w},${n}) = ${got} != Raid.java:504-514's own branch ${want}`);
      ok = false;
    }
  }
  return ok;
}

// ── LAYER 2: DISTRIBUTION — Rd.getBonusCount driven with the engine's own randInt hook, checked
// against probabilities derived from Raid.getBonusCount's own branch structure (.decomp
// Raid.java:702-726). Each derivation is shown in the comment beside its case.
const TRIALS = 4000;
function empiricalDist(type, difficulty, waveIdx, isExtra) {
  const counts = {};
  const randInt = (n) => Math.floor(Math.random() * n);
  for (let i = 0; i < TRIALS; i++) {
    const b = Rd.getBonusCount(type, randInt, waveIdx, difficulty, isExtra);
    counts[b] = (counts[b] || 0) + 1;
  }
  const dist = {};
  for (const k of Object.keys(counts)) dist[k] = counts[k] / TRIALS;
  return dist;
}
// pillager/vindicator: easy -> n=randInt(2) in {0,1}, then bonus=randInt(n+1) EITHER WAY (the
// jar's own quirk, 07s_raid.js's comment on Rd.getBonusCount re-cites it): n=0 -> bonus forced 0
// (randInt(1)==0 always); n=1 -> bonus=randInt(2) in {0,1} each 0.5. Combined: P(0)=0.5+0.5*0.5
// =0.75, P(1)=0.5*0.5=0.25. normal -> n=1 always -> bonus=randInt(2): P(0)=P(1)=0.5. hard -> n=2
// always -> bonus=randInt(3): P(0)=P(1)=P(2)=1/3.
// witch: 0 unless (normal/hard difficulty) AND waveIdx in {3,5,6,7,...} (waveIdx>2 && waveIdx!=4)
// -- then n=1 -> bonus=randInt(2): P(0)=P(1)=0.5.
// ravager: isExtra && difficulty!=easy -> n=1 -> bonus=randInt(2): P(0)=P(1)=0.5; else always 0.
function expectedDist(type, difficulty, waveIdx, isExtra) {
  if (type === 'pillager' || type === 'vindicator') {
    if (difficulty === 'easy') return { 0: 0.75, 1: 0.25 };
    if (difficulty === 'normal') return { 0: 0.5, 1: 0.5 };
    return { 0: 1 / 3, 1: 1 / 3, 2: 1 / 3 }; // hard
  }
  if (type === 'witch') {
    if (difficulty === 'easy' || waveIdx <= 2 || waveIdx === 4) return { 0: 1 };
    return { 0: 0.5, 1: 0.5 };
  }
  if (type === 'ravager') {
    if (difficulty !== 'easy' && isExtra) return { 0: 0.5, 1: 0.5 };
    return { 0: 1 };
  }
  return { 0: 1 };
}
const DIST_TOL = 0.06; // 4000 trials, worst-case 3-way split stderr ~0.0075 -- 0.06 is generous, not vacuous (anti-vacuity break below proves it still catches a real shift)
function checkDist(type, difficulty, waveIdx, isExtra) {
  const got = empiricalDist(type, difficulty, waveIdx, isExtra);
  const want = expectedDist(type, difficulty, waveIdx, isExtra);
  const keys = new Set([...Object.keys(got), ...Object.keys(want)]);
  let ok = true;
  for (const k of keys) {
    const g = got[k] || 0, w = want[k] || 0;
    if (Math.abs(g - w) > DIST_TOL) {
      reds.push(`DIST: getBonusCount(${type},${difficulty},wave${waveIdx},extra=${isExtra}) P(bonus=${k})=${g.toFixed(3)} over ${TRIALS} trials, derived from Raid.java:702-726 wants ${w.toFixed(3)}`);
      ok = false;
    }
  }
  return ok;
}

console.log(`raidrefcheck — wave composition per difficulty vs the real 1.18.2 server (golden: ${GOLDEN_PATH || 'ABSENT'})`);

if (runTableChecks(Rd)) { pass++; tablePass++; console.log('  TABLE                    MAX_WAVES/MEMBERS/CAN_LEAD/ravagerPassengerType match .decomp exactly'); }

const distCases = [
  ['pillager', 'easy', 2, false], ['pillager', 'normal', 2, false], ['pillager', 'hard', 2, false],
  ['vindicator', 'easy', 3, false], ['vindicator', 'normal', 3, false], ['vindicator', 'hard', 3, false],
  ['witch', 'normal', 5, false], ['witch', 'normal', 2, false], ['witch', 'normal', 4, false],
  ['ravager', 'normal', 6, true], ['ravager', 'normal', 5, false], ['ravager', 'easy', 4, true],
];
let distOk = true;
for (const [type, diff, w, ext] of distCases) { if (!checkDist(type, diff, w, ext)) distOk = false; }
if (distOk) { pass++; distPass++; console.log(`  DIST                      getBonusCount's empirical distribution (${TRIALS} trials/case, ${distCases.length} cases) matches Raid.java:702-726's own derived probabilities within ${DIST_TOL}`); }

// ── LAYER 3: GOLDEN — real-server per-wave raider counts, when present. SKIP (not fail) when
// absent, same contract potionrefcheck.mjs/foodrefcheck.mjs already use.
if (!golden) {
  console.log('raidrefcheck: golden not generated -- run node tools/referee/runraid.mjs (golden layer skipped)');
} else {
  let anyRealRep = false;
  for (const s of SCEN) {
    const g = golden.cases && golden.cases[s.id];
    if (!g || !g.repsData || !g.repsData.length) continue;
    anyRealRep = true;
    for (const waves of g.repsData) {
      for (const w of waves) {
        // s149: the support is the ENGINE's own, not typed here (rule 3): base = Rd.getCount, bonus range =
        // Rd.getBonusCount driven with its random at both ends, and every ravager's RIDER (Rd.ravagerPassengerType
        // — normal-final-wave pillager, hard-wave evoker/vindicator) counted under its own type, as the server's
        // Wave-tag tally counts it. (The worker's first cut omitted riders and typed the bonus maxima.)
        const lo = {}, hi = {};
        for (const type of RAIDER_TYPES) {
          const base = Rd.getCount(Rd.MEMBERS[type], w.waveIdx, s.waveCount, w.isExtra);
          lo[type] = (lo[type] || 0) + base + Rd.getBonusCount(type, () => 0, w.waveIdx, s.difficulty, w.isExtra);
          hi[type] = (hi[type] || 0) + base + Rd.getBonusCount(type, (n) => Math.max(0, n - 1), w.waveIdx, s.difficulty, w.isExtra);
        }
        const riders = (nRav) => { const o = {}; for (let r = 0; r < nRav; r++) { const t = Rd.ravagerPassengerType(w.waveIdx, r); if (t) o[t] = (o[t] || 0) + 1; } return o; };
        const rLo = riders(lo.ravager), rHi = riders(hi.ravager);
        for (const type of RAIDER_TYPES) {
          const min = lo[type] + (rLo[type] || 0), max = hi[type] + (rHi[type] || 0);
          const observed = w.counts[type];
          if (observed < min || observed > max) {
            reds.push(`GOLDEN: ${s.id} wave${w.waveIdx} ${type}: server observed ${observed}, engine support [${min},${max}] (Rd.getCount + Rd.getBonusCount + ravager riders)`);
          } else { pass++; goldenPass++; }
        }
      }
    }
  }
  if (!anyRealRep) console.log('raidrefcheck: golden present but every scenario\'s repsData is empty (real-server trigger never fired that run) -- golden layer skipped, notes: ' + JSON.stringify(golden.notes || []));
}

// ── anti-vacuity (D-30/D-305): perturb the engine's OWN in-memory values/functions and confirm
// the SUPPOSED-TO-PASS-TODAY checks above (TABLE, DIST) catch it. ────────────────────────────
let breaks = 0, caught = 0;
const brk = (name, fired) => { breaks++; if (fired) caught++; else reds.push(`anti-vacuity: break "${name}" was NOT caught`); };
{
  const orig = Rd.MAX_WAVES.hard;
  Rd.MAX_WAVES.hard = 6; // real value 7
  brk('Rd.MAX_WAVES.hard corrupted (7 -> 6)', !runTableChecksQuiet());
  Rd.MAX_WAVES.hard = orig;
}
{
  const orig = Rd.MEMBERS.pillager.slice();
  Rd.MEMBERS.pillager[2] = 99; // real value 3 (wave 2)
  brk('Rd.MEMBERS.pillager[2] corrupted (3 -> 99)', !runTableChecksQuiet());
  Rd.MEMBERS.pillager = orig;
}
{
  const orig = Rd.ravagerPassengerType;
  Rd.ravagerPassengerType = function (w, n) { return w === 5 ? 'vindicator' : orig(w, n); }; // real wave-5 rider is pillager
  brk('Rd.ravagerPassengerType(5,n) corrupted (pillager -> vindicator)', !runTableChecksQuiet());
  Rd.ravagerPassengerType = orig;
}
{
  const orig = Rd.getBonusCount;
  Rd.getBonusCount = function (type, randInt, waveIdx, difficulty, isExtra) {
    if (type === 'pillager' && difficulty === 'normal') return 1; // real: randInt(2), 50/50 0 or 1 -- always-1 should blow the DIST tolerance
    return orig(type, randInt, waveIdx, difficulty, isExtra);
  };
  brk('Rd.getBonusCount(pillager,normal) corrupted (always 1, real P(0)=0.5)', !checkDistQuiet('pillager', 'normal', 2, false));
  Rd.getBonusCount = orig;
}
function runTableChecksQuiet() {
  const before = reds.length;
  const ok = runTableChecks(Rd);
  reds.length = before; // this helper is for anti-vacuity probing only -- don't double-report the break as a real red
  return ok;
}
function checkDistQuiet(type, difficulty, waveIdx, isExtra) {
  const before = reds.length;
  const ok = checkDist(type, difficulty, waveIdx, isExtra);
  reds.length = before; // anti-vacuity probing only
  return ok;
}

for (const r of reds) console.log('  ✗ ' + r);
console.log(`raidrefcheck: ${pass} assertions agree (table ${tablePass}, dist ${distPass}, golden ${goldenPass}), ${reds.length} red · anti-vacuity ${caught}/${breaks}`);
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${reds.length}`);
console.log(` breaks caught ...... ${caught}`);
process.exit(reds.length ? 1 : 0);
