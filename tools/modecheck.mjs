#!/usr/bin/env node
// modecheck.mjs — PLAN G6. The four gamemodes, and the boolean that used to stand in for them.
//
//   node tools/modecheck.mjs [--verbose]
//
// ⚠ HALF OF THIS CHECK READS THE SOURCE, ON PURPOSE. D-139's rule is that a stage which REPLACES
// something is not done until the something is DELETED, and that the acceptance test must compare
// against a world with the old system OFF — "a count of what the new system produced cannot tell
// you the old one is still running". G6 replaced `Player.creative`, a boolean that meant three
// unrelated things at once. The way to prove it is gone is to look for it, so §6 does exactly
// that, and §7 asserts that the three places that used to read it now read the right ABILITY.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MCLITE_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = MCLITE_ROOT + 'src';
const VERBOSE = process.argv.includes('--verbose');
const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '14d_survival.js', '14e_gamemode.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const Gm = NS.Gamemode, Sv = NS.Survival;

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); };
// ⚠ THE SUITE COUNTS THE TICKS, so an anti-vacuity case that passes silently is a deliberate
// break the summary cannot see (D-30's rule, and `suite.mjs` counts a literal ✓ per break).
const okAv = (c, m) => { ok(c, m); if (c) console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); };
const say = (s) => { if (VERBOSE) console.log('   ' + s); };

console.log('modecheck — PLAN G6, the four gamemodes (D-253)');

// ═══════════════ 1. the ability table is `GameType.updatePlayerAbilities` ═══════════════════
{
  // written here from the bytecode, independently of the engine's own copy:
  //   CREATIVE  -> mayFly, instabuild, invulnerable          (flying untouched)
  //   SPECTATOR -> mayFly, invulnerable, flying; instabuild false
  //   otherwise -> all four false
  //   mayBuild = !isBlockPlacingRestricted()  (adventure and spectator are restricted)
  const table = {
    survival:  { invulnerable: false, flying: false, mayFly: false, instabuild: false, mayBuild: true },
    creative:  { invulnerable: true,  flying: false, mayFly: true,  instabuild: true,  mayBuild: true },
    adventure: { invulnerable: false, flying: false, mayFly: false, instabuild: false, mayBuild: false },
    spectator: { invulnerable: true,  flying: true,  mayFly: true,  instabuild: false, mayBuild: false },
  };
  for (const name of Object.keys(table)) {
    const mode = Gm.byName(name), got = Gm.abilities(mode), want = table[name];
    for (const k of Object.keys(want)) {
      ok(got[k] === want[k], `${name}.${k} should be ${want[k]}, the engine says ${got[k]}`);
    }
  }
  ok(Gm.NAMES.length === 4 && Gm.byName('spectator') === 3, 'the four modes must be in vanilla\'s order');
  ok(Gm.byName('nonsense') === Gm.SURVIVAL, 'an unknown mode name must fall back to survival');
  say('ability table: 20 flags across four modes');
}

// ═══════════════ 2. what each mode may do ══════════════════════════════════════════════════
{
  const e = {};
  Gm.set(e, Gm.SURVIVAL);
  ok(Gm.mayBreak(e) && e.mayBuild && !Gm.instantBreak(e) && Gm.dropsFor(e), 'survival: builds, breaks slowly, gets drops');
  Gm.set(e, Gm.CREATIVE);
  ok(Gm.mayBreak(e) && e.mayBuild && Gm.instantBreak(e) && !Gm.dropsFor(e), 'creative: instant break and NO drops');
  Gm.set(e, Gm.ADVENTURE);
  ok(!e.mayBuild && !Gm.instantBreak(e), 'adventure: may not build');
  ok(Gm.mayBreak(e) === false, 'adventure: mayBreak follows mayBuild');
  Gm.set(e, Gm.SPECTATOR);
  ok(!e.mayBuild && !Gm.mayBreak(e) && e.noclip === true, 'spectator: no building, no breaking, no clipping');
  say('restrictions: adventure cannot build, spectator cannot touch anything');
}

// ═══════════════ 3. reach ══════════════════════════════════════════════════════════════════
{
  const e = {};
  Gm.set(e, Gm.CREATIVE);
  ok(e.reach === 5.0, `creative reach should be 5.0, it is ${e.reach}`);
  Gm.set(e, Gm.SURVIVAL);
  ok(e.reach === 4.5, `survival reach should be 4.5, it is ${e.reach}`);
  Gm.set(e, Gm.ADVENTURE);
  ok(e.reach === 4.5, `adventure reach should be 4.5, it is ${e.reach}`);
  Gm.set(e, Gm.SPECTATOR);
  ok(e.reach === 4.5 && Gm.reach(e) === 4.5, `spectator reach should be 4.5, it is ${e.reach}`);
  ok(Gm.REACH_CREATIVE !== Gm.REACH_SURVIVAL, 'the two reaches must differ or §3 proves nothing');
}

// ═══════════════ 4. LEAVING a mode has to undo it ══════════════════════════════════════════
{
  const e = {};
  Gm.set(e, Gm.CREATIVE);
  e.flying = true;
  Gm.set(e, Gm.SURVIVAL);
  ok(e.flying === false, 'dropping to survival must end flight — otherwise you fly for free');
  ok(e.noclip === false, 'and it must end noclip');
  Gm.set(e, Gm.SPECTATOR);
  ok(e.flying === true && e.noclip === true, 'spectator must start flying and clipping through');
  Gm.set(e, Gm.ADVENTURE);
  ok(e.flying === false && e.noclip === false,
     'leaving spectator must stop the noclip in the same tick, or the first thing the new player does is fall through the floor');
  const rid = { rider: 'player' };
  const r = { vehicle: rid, dismountVehicle() { this.vehicle = null; rid.rider = null; } };
  Gm.set(r, Gm.CREATIVE);
  ok(r.vehicle === rid, 'creative keeps the ride');
  Gm.set(r, Gm.SPECTATOR);
  ok(r.vehicle === null && rid.rider === null, 'entering spectator must stop riding (changeGameMode -> stopRiding)');
  say('transitions: flight and noclip are undone on the way out');
}

// ═══════════════ 5. the survival loop is inert in creative and spectator ═══════════════════
{
  for (const [name, live] of [['survival', true], ['adventure', true], ['creative', false], ['spectator', false]]) {
    const e = Sv.init({});
    Gm.set(e, Gm.byName(name));
    e.food = 0; e.saturation = 0; e.health = 20;
    for (let i = 0; i < 400; i++) { Sv.movement(e, 1, { sprinting: true }); Sv.tick(e); }
    if (live) {
      ok(e.health < 20, `${name}: an empty bar must starve you, health is still ${e.health}`);
    } else {
      ok(e.health === 20 && e.exhaustion === 0,
         `${name}: the survival loop must be inert — health ${e.health}, exhaustion ${e.exhaustion}`);
    }
  }
  say('the loop runs in survival and adventure, and is inert in creative and spectator');
}

// ═══════════════ 6. THE BOOLEAN IS GONE (D-139) ════════════════════════════════════════════
{
  // Every `.creative` in src/, with the two legitimate ones named. If this list grows, either a
  // new legitimate use arrived and belongs here by name, or the boolean is creeping back.
  const allowed = [
    // the pre-G6 save translation, which reads the old field once and converts it
    /typeof o\.creative === 'boolean'/,
    /o\.creative \? NS\.Gamemode\.CREATIVE/,
  ];
  const offenders = [];
  for (const f of readdirSync(SRC).filter((n) => n.endsWith('.js') && !n.startsWith('19_data'))) {
    const text = readFileSync(join(SRC, f), 'utf8');
    text.split('\n').forEach((line, i) => {
      if (!/\.creative\b/.test(line)) return;
      if (/^\s*(\/\/|\*)/.test(line)) return;                 // a comment about the old boolean
      if (allowed.some((re) => re.test(line))) return;
      offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 90)}`);
    });
  }
  ok(offenders.length === 0,
     `the creative boolean is still being read in ${offenders.length} place(s): ${offenders.slice(0, 4).join(' | ')}`);
  say(`the boolean is gone from ${readdirSync(SRC).filter((n) => n.endsWith('.js')).length} source files`);
}

// ═══════════════ 7. and the places that used to read it read the right ability now ═════════
{
  const player = readFileSync(join(SRC, '14_player.js'), 'utf8');
  const survival = readFileSync(join(SRC, '14d_survival.js'), 'utf8');
  const main = readFileSync(join(SRC, '17_main.js'), 'utf8');
  ok(/if \(P\.instabuild\)/.test(player), 'instant break must be gated on instabuild, not on a mode name');
  ok(/!P\.instabuild/.test(player), 'drops must be gated on instabuild');
  ok(/P\.mayBuild === false/.test(player), 'placing must be gated on mayBuild');
  ok(/Gamemode\.mayBreak\(P\)/.test(player), 'breaking must ask the gamemode');
  ok(/!P\.invulnerableGamemode/.test(player), 'the survival loop must be gated on invulnerableGamemode');
  ok(/e\.invulnerableGamemode/.test(survival), 'and the survival module must read the same flag');
  ok(/!P\.mayFly/.test(main), 'the fly key must ask mayFly, not the mode');
  ok(/mode: P\.mode/.test(player), 'the save must persist the mode, not a boolean');
  say('the five call sites read abilities, not a mode name');
}

// ═══════════════ 8. ANTI-VACUITY ═══════════════════════════════════════════════════════════
{
  // 1. the four modes must actually differ from each other — a table where they agreed would
  //    pass §1 while making the whole feature a no-op
  const sig = (m) => JSON.stringify(Gm.abilities(m));
  const sigs = new Set([sig(0), sig(1), sig(2), sig(3)]);
  okAv(sigs.size === 4, `the four modes must have four different ability sets, they have ${sigs.size}`);

  // 2. §6's scanner must be able to find the thing it is looking for
  {
    const fake = 'if (P.creative) doSomething();';
    okAv(/\.creative\b/.test(fake) && !/^\s*(\/\/|\*)/.test(fake),
       'anti-vacuity: the scanner must match a real read of the old boolean');
    const comment = '  // P.creative used to mean three things';
    okAv(/^\s*(\/\/|\*)/.test(comment), 'anti-vacuity: and must not match a comment about it');
  }

  // 3. §5 must be able to see the difference: an inert loop and a live one, same input
  {
    const a = Sv.init({}); Gm.set(a, Gm.SURVIVAL); a.food = 0;
    const b = Sv.init({}); Gm.set(b, Gm.CREATIVE); b.food = 0;
    for (let i = 0; i < 200; i++) { Sv.tick(a); Sv.tick(b); }
    okAv(a.health !== b.health, 'anti-vacuity: survival and creative must diverge under the same ticks');
  }

  // 4. mayBuild and instabuild must be independent flags — which is the whole reason the boolean
  //    could not express adventure
  {
    const adv = Gm.abilities(Gm.ADVENTURE), cre = Gm.abilities(Gm.CREATIVE), spec = Gm.abilities(Gm.SPECTATOR);
    okAv(adv.mayBuild === false && adv.instabuild === false && cre.mayBuild === true && cre.instabuild === true,
       'anti-vacuity: adventure and creative must differ in both flags');
    okAv(spec.mayFly === true && spec.instabuild === false,
       'anti-vacuity: spectator may fly and may NOT build — the combination the boolean could not hold');
  }
}

console.log('');
console.log('1. the ability table, against GameType.updatePlayerAbilities');
console.log('2. what each mode may build, break and pick up');
console.log('3. reach: 5.0 creative, 4.5 otherwise');
console.log('4. leaving a mode undoes it — flight and noclip both');
console.log('5. the survival loop is live in survival and adventure, inert in the other two');
console.log('6. the `creative` boolean is GONE from src/ (D-139)');
console.log('7. and the five call sites read the right ability instead');
console.log('8. anti-vacuity — four modes that must differ, and a scanner that must find things');
console.log('');
for (const f of fails) console.log('FAIL  ' + f);
// ⚠ THE SHAPE `suite.mjs` PARSES. It reads "assertions passed .. N" and "failures ... N" out of
// each stage's output; a check that prints its totals in its own shape is counted as zero and
// the suite's headline number quietly loses them (the note at suite.mjs:198 is the same bug).
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
