#!/usr/bin/env node
// dupcheck.mjs — the structural check that keeps a redefinition from winning silently (D-276).
//
//   node tools/dupcheck.mjs [--quiet]
//
// ⚠ THIS FILE EXISTS BECAUSE A 404-LINE BLOCK OF `15_hud.js` WAS DUPLICATED AND NOBODY NOTICED.
// G11 wrote a new `H.drawSurvival` out of vanilla's `icons.png`, and the whole projection /
// G10 / hotbar region it sat in was pasted in twice. The stale copy came SECOND, so it won:
// every screenshot of the "new" HUD was the old placeholder's coloured rectangles, and the build
// was green throughout, because a duplicate definition is perfectly legal JavaScript.
//
// The same scan found a second, worse one in `14_player.js`: G3's placeholder `P.heldItem = ''`
// and D-275's `P.heldItem = function ()` are 280 lines apart in one file. The function won, so
// `miningContext().item` — which `Mining.itemSpeed` and `Mining.canHarvest` both read as a NAME
// — was a function object. Both take a miss quietly. Every pickaxe mined at bare-hand speed.
//
// So the class is: **a later top-level assignment silently replacing an earlier one in the same
// file**. It is invisible in review (the two are never on screen together), invisible to the
// build, and invisible to every behavioural check that happens not to exercise the shadowed
// path. It is visible to a parser in forty milliseconds, which is what this is.
//
// ⚠⚠ AND §5 IS THE SAME CLASS FROM THE OTHER SIDE (session 9, D-290). A name defined twice is
// one failure mode; a name READ THAT NOTHING EVER DEFINES is the other, and JavaScript is just
// as quiet about it — the value is `undefined`, `!!undefined` is a serviceable `false`, and
// `undefined | 0` is a serviceable `0`. Three shipped for months:
//
//     P.eyesInWater   read in 14_player.js and 15_hud.js; physics writes `eyeInWater`
//                     -> the underwater mining penalty NEVER applied, and the bubble row
//                        never drew — while line 509 of the SAME HUD file spells it correctly
//     P.armour        read in 15_hud.js; survival writes `armor`, vanilla's own spelling
//                     -> the armour row has never been drawn once
//
// Neither is a typo you can see: both files are internally consistent, and the two spellings are
// hundreds of lines or a whole module apart.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

// A top-level assignment inside the module IIFE: exactly two spaces of indent, `Thing.member =`.
// Two spaces is the whole trick — it is the module body's own level, so a re-assignment inside a
// function (`P.slot = 3`, legitimately done a hundred times) is not a redefinition and is skipped.
const ASSIGN = /^ {2}([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\s*=\s*(?!=)/;

/** Every `  X.y = ...` in one file, as key -> [line numbers]. */
function scan(text) {
  const seen = new Map();
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = ASSIGN.exec(lines[i]);
    if (!m) continue;
    const key = m[1] + '.' + m[2];
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(i + 1);
  }
  return seen;
}

console.log('dupcheck — one definition per name, per module');

// ═══════════ 1. no module defines the same name twice ═════════════════════════════════════
say('\n1. the source tree');
const files = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
ok(files.length > 20, `${files.length} modules scanned`);
let names = 0, dups = 0;
for (const f of files) {
  const seen = scan(readFileSync(join(SRC, f), 'utf8'));
  names += seen.size;
  for (const [key, at] of seen) {
    if (at.length > 1) {
      dups++;
      ok(false, `${f}: \`${key}\` is assigned ${at.length} times at top level — lines ${at.join(', ')}. `
        + 'The LAST one wins; every caller of the others is calling something else.');
    }
  }
}
say(`   ${names} top-level names across ${files.length} modules`);
ok(dups === 0, `${dups} names are defined more than once`);

// ═══════════ 2. the two that this check was written for, by name ══════════════════════════
// ⚠ Named explicitly so the specific regressions cannot come back under a green §1 — §1 would
// catch them, but only as one line in a list, and these two cost a session between them.
say('\n2. the two known regressions, by name');
{
  const hud = scan(readFileSync(join(SRC, '15_hud.js'), 'utf8'));
  // ⚠ `H.drawHand` WAS ON THIS LIST AND IS GONE FROM THE FILE (D-359): the 2D hand is deleted,
  // not disabled, so a "defined exactly once" assertion over it now asserts that a deleted
  // function still exists. A watch-list entry for something that has been removed is a stale
  // promise in the other direction, and leaving it here would have made the deletion fail the
  // suite for being complete.
  // ⚠ `H.drawParticles` went the same way (D-659): the HUD's 2D particle dots were DELETED when
  // block dust moved into the particle array, so asserting it is still defined failed the suite
  // for a completed replacement (D-139). Struck D-664.
  for (const k of ['H.drawSurvival', 'H.drawCrumbling', 'H.hotbarRect', 'H.drawSelection']) {
    ok((hud.get(k) || []).length === 1, `15_hud.js defines ${k} exactly once`);
  }
  const ply = scan(readFileSync(join(SRC, '14_player.js'), 'utf8'));
  ok((ply.get('P.heldItem') || []).length === 1, '14_player.js defines P.heldItem exactly once');
  const src = readFileSync(join(SRC, '14_player.js'), 'utf8');
  // ⚠ and it must be the STACK function, with the name derived from it — not the '' placeholder
  ok(/P\.heldItem = function/.test(src), 'P.heldItem is the stack accessor, not a placeholder string');
  ok(/item: P\.heldItemName\(\)/.test(src), 'miningContext passes a NAME, derived from the held stack');
  ok(!/P\.heldItem = '';/.test(src), "and G3's placeholder `P.heldItem = ''` is deleted (D-139)");
}

// ═══════════ 3. the duplicated block would have been caught by its own shape ═══════════════
// A repeated run of identical non-trivial lines is the other signature of a pasted block, and it
// is worth naming separately: the HUD's copy differed only in one function, so 390 of its 404
// lines were byte-identical to lines already in the file.
say('\n3. no long identical run appears twice in one module');
const MIN_RUN = 40;
for (const f of files) {
  const lines = readFileSync(join(SRC, f), 'utf8').split('\n')
    .map((l) => l.trim()).filter(() => true);
  const first = new Map();
  let worst = 0, worstAt = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.length < 8) continue;
    if (!first.has(l)) { first.set(l, i); continue; }
    // measure how far the run from `first.get(l)` and from `i` stay identical
    let a = first.get(l), b = i, run = 0;
    while (b + run < lines.length && lines[a + run] === lines[b + run]) run++;
    if (run > worst) { worst = run; worstAt = i + 1; }
  }
  if (!ok(worst < MIN_RUN, `${f}: ${worst} consecutive identical lines reappear at line ${worstAt} — a pasted block`)) {
    // keep going; the list is the report
  } else if (worst > 12 && !QUIET) {
    say(`   . ${f}: longest repeated run ${worst} lines (under the ${MIN_RUN} threshold)`);
  }
}

// ═══════════ 4. anti-vacuity ══════════════════════════════════════════════════════════════
// ═══════════ 5. a property READ that nothing anywhere assigns (D-290) ═════════════════════
//
// ⚠ SCOPED ON PURPOSE, BECAUSE THE UNSCOPED VERSION IS NOISE. A first pass over every `x.y` in
// the tree flagged 101 names and almost all of them were fine: `e` is an event in the input
// module, a JSON entry in the worldgen data, a block-state object in the behaviour module, and
// `preventDefault`, `grass_color` and `facing` are all perfectly real. A check that cries wolf a
// hundred times is a check nobody reads.
//
// So this asks one narrow question with a precise answer: **on the PLAYER, is every property the
// engine reads a property the engine also writes?** The player is the right object to ask it of —
// it is the one long-lived mutable thing that five modules all reach into, which is exactly the
// shape that grows a second spelling. The alias `P` is this codebase's settled name for it, and
// the file list below says where that is true.
say('\n5. every property read on the player is a property something writes');
{
  // ⚠ the modules where `P` IS the player. `07b_behaviour.js` also uses `P` — for a block's
  // PROPERTY table — which is why this is a list and not a pattern.
  const PLAYER_FILES = ['14_player.js', '14d_survival.js', '14e_gamemode.js', '14i_hand.js',
                        '15_hud.js', '15b_gui.js', '07d_mining.js', '16b_save.js', '17_main.js'];
  // Writes are collected from EVERY module, at any indent, on any receiver: `Sv.init` sets the
  // survival fields on an entity called `e`, and physics sets the fluid flags on an entity called
  // `e`, and both of those entities ARE the player. The question is whether the NAME is ever
  // written, not whether it is written through this alias.
  // ⚠ COMMENTS ARE STRIPPED FIRST, AND THE FIRST VERSION OF THIS SECTION DID NOT DO IT — it
  // reported `P.creative` as a dead read, and `P.creative` appears exactly once in the tree: in
  // the SENTENCE explaining that the field was deleted (D-139). A check whose first finding is
  // its own prose is a check that will be switched off.
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  // ⚠ AND A WRITE IS AN ASSIGNMENT, NOT AN OBJECT-LITERAL KEY. Counting keys was the first
  // version's other mistake: `miningContext` RETURNS `{ efficiency: P.efficiency | 0, ... }`, so
  // the very line that reads the dead property also "defines" it, and the check exonerates the
  // bug it is looking for. The player is built by assignment, so assignment is what counts.
  const written = new Set();
  for (const f of files) {
    const t = strip(readFileSync(join(SRC, f), 'utf8'));
    for (const m of t.matchAll(/\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\*=|\/=|\|=|&=|\+\+|--)/g)) written.add(m[1]);
    for (const m of t.matchAll(/\[['"]([A-Za-z_$][\w$]*)['"]\]\s*=/g)) written.add(m[1]);  // computed writes
  }
  // ⚠ PLUS the keys of the literal that CREATES the player, and only those. `P.PMAX` and
  // `P.PLIFE` are declared there and assigned nowhere, which is perfectly correct; counting
  // object-literal keys from the whole tree instead was the first version's other mistake,
  // because `miningContext` RETURNS `{ efficiency: P.efficiency | 0 }` — the very line that
  // reads a dead property would then have defined it. One literal, found by its own opening line.
  // and the things an object legitimately borrows from elsewhere
  const BUILTIN = new Set(['length', 'name', 'toString', 'constructor', 'prototype', 'call',
                           'apply', 'bind', 'hasOwnProperty']);
  {
    const t = strip(readFileSync(join(SRC, '14_player.js'), 'utf8'));
    const at = t.indexOf('NS.Player = {');
    const body = at >= 0 ? t.slice(at, t.indexOf('\n  };', at)) : '';
    // ⚠ the sentinel is a key READ FROM THE LITERAL, not from `written` (which assignments also
    // fill, so a missing literal could hide behind them). It was `PMAX`, deleted with the 2D
    // particles in D-659 — the literal was found fine, the sentinel was gone (D-664).
    const lit = new Set();
    for (const m of body.matchAll(/^ {4}([A-Za-z_$][\w$]*)\s*:/gm)) { written.add(m[1]); lit.add(m[1]); }
    for (const m of body.matchAll(/[,{]\s*([A-Za-z_$][\w$]*)\s*:/g)) { written.add(m[1]); lit.add(m[1]); }
    ok(body.length > 200 && lit.has('onGround') && lit.has('flying'),
       'the player literal was found and its keys read — otherwise §5 flags every declared field');
  }

  const readOnly = new Map();
  for (const f of PLAYER_FILES) {
    const t = strip(readFileSync(join(SRC, f), 'utf8'));
    for (const m of t.matchAll(/\bP\.([A-Za-z_$][\w$]*)\b/g)) {
      const k = m[1];
      if (written.has(k) || BUILTIN.has(k)) continue;
      if (!readOnly.has(k)) readOnly.set(k, new Set());
      readOnly.get(k).add(f);
    }
  }
  // ── and the same question of EVERY namespace, not only the player (D-293) ───────────────
  // ⚠ THE PLAYER WAS WHERE THE BUG WAS FOUND; IT IS NOT WHERE THE CLASS LIVES. Every `NS.Xxx`
  // in this engine is a long-lived object several modules reach into, which is the shape that
  // grows a second spelling or a hook nobody keeps. Asking the question of all 57 of them cost
  // nothing and immediately turned up `NS.Hud.onDeath`, called by `14_player.js` twenty ticks
  // after death and defined nowhere — guarded, so it never fired and never threw.
  // ⚠ This one needs NO allow-list, because a namespace method is either defined or it is a lie;
  // the player's owed-list exists only because a FIELD can legitimately await a stage.
  {
    const nsNames = new Set();
    const texts = new Map();
    for (const f of files) {
      const t = strip(readFileSync(join(SRC, f), 'utf8'));
      texts.set(f, t);
      for (const m of t.matchAll(/NS\.([A-Z]\w*)\s*=/g)) nsNames.add(m[1]);
    }
    // ⚠ `19_data.gen.js` IS EXCLUDED FROM THE SCAN AND MUST NOT BE EXCLUDED FROM THE ANSWER.
    // It is six megabytes of generated blob and nobody reads it, but it is real code that runs,
    // and it is where `NS.DATA`'s members are defined. Leaving it out reported seven of them —
    // `runtimeBytes`, `itemTile`, `colormapsBytes` — as calls into nothing. A structural check
    // that skips a file for being machine-written has to skip it for READING, not for EXISTING.
    const genPath = join(SRC, '19_data.gen.js');
    const genDefined = new Set();
    if (existsSync(genPath)) {
      // ⚠ SHORT LINES ONLY, and the first version's 4 MB window is why. The blob is a handful of
      // multi-megabyte base64 strings with the keys scattered between them, so a window from
      // `NS.DATA` ran out inside one string and found 10 of them. The keys all live on short
      // lines; the payloads are single enormous ones. Filtering by length is exact here and
      // turns a 6.89 MB regex into a fast one.
      const g = readFileSync(genPath, 'utf8');
      const keyLines = g.split('\n').filter((l) => l.length < 500).join('\n');
      for (const m of keyLines.matchAll(/(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:/gm)) genDefined.add(m[1]);
      for (const m of keyLines.matchAll(/\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) genDefined.add(m[1]);
      for (const m of keyLines.matchAll(/NS\.([A-Z]\w*)\s*=/g)) nsNames.add(m[1]);
    }
    ok(genDefined.size > 20, `the generated blob defines ${genDefined.size} names — if this is 0 it was not read`);
    // object-literal keys count here ONLY inside a namespace's own constructing literal
    const nsWritten = new Set(written);
    for (const t of texts.values()) {
      for (const m of t.matchAll(/NS\.[A-Z]\w*\s*=\s*\{([\s\S]*?)\n\s*\};/g)) {
        for (const k of m[1].matchAll(/(?:^|[,{])\s*([A-Za-z_$][\w$]*)\s*:/g)) nsWritten.add(k[1]);
      }
    }
    const dead = new Map();
    for (const [f, t] of texts) {
      for (const m of t.matchAll(/\bNS\.([A-Z]\w*)\.([A-Za-z_$][\w$]*)\b/g)) {
        const [, ns, prop] = m;
        if (!nsNames.has(ns) || nsWritten.has(prop) || genDefined.has(prop) || BUILTIN.has(prop)) continue;
        const k = 'NS.' + ns + '.' + prop;
        if (!dead.has(k)) dead.set(k, new Set());
        dead.get(k).add(f);
      }
    }
    for (const [k, where] of dead) ok(false, `${k} is called in ${[...where].join(', ')} and nothing defines it`);
    ok(dead.size === 0, `${dead.size} namespace members are used and never defined`);
    say(`   ${nsNames.size} namespaces, every member used is a member defined`);
  }

  // ⚠ THE ALLOW-LIST IS NAMED, NOT SILENT. Each of these is read by code that is waiting on a
  // stage that has not run, and each says which. An entry here is a promise with an owner; an
  // entry that has no owner is a bug, which is the whole point of the list being short.
  const OWED = {
    aquaAffinity: 'enchantments — 07d_mining.js has the branch, nothing grants the enchantment',
    efficiency:   'enchantments — same',
    haste:        'status effects — G11 named the effect icons as still open',
    fatigue:      'status effects — same',
  };
  const surprises = [...readOnly.keys()].filter((k) => !(k in OWED)).sort();
  for (const k of surprises) {
    ok(false, `P.${k} is read in ${[...readOnly.get(k)].join(', ')} and NOTHING in src/ ever assigns it`);
  }
  ok(surprises.length === 0, `${surprises.length} player properties are read but never written`);
  say(`   ${readOnly.size} properties read on the player and never written, ${surprises.length} of them unexplained`);
  for (const k of [...readOnly.keys()].sort()) say(`   . P.${k} — ${OWED[k] || 'UNOWNED'}`);
  // and the list must not rot: an allow-list entry for something that IS written now is a stale
  // promise, and a reader who trusts it will not look again.
  const stale = Object.keys(OWED).filter((k) => written.has(k));
  ok(stale.length === 0, `the owed-list still names ${stale.join(', ')}, which the engine now writes — delete the entry`);
}
say(`   ${pass} ok`);

// ═══════════ 6. A FIELD COMPARED AS A NUMBER MUST BE DECLARED AS ONE (D-357) ══════════════
//
// ⚠⚠ **THE BUG THIS EXISTS FOR MADE THE GAME UNPLAYABLE FOR TWO SESSIONS AND NO CHECK COULD
// SEE IT.** `P.act` gates the click-swing, the attack and the ENTIRE mining branch on
// `P.missTime <= 0`, and `missTime` was declared nowhere. `undefined <= 0` is **false** — not
// NaN, not a throw, just `false` — so both gates were false for ever: you could not punch, you
// could not attack, and you could not break a block. A real browser proved it on the shipped
// build: `typeof P.missTime` was `"undefined"`, a `mousedown` at the sky produced **0 swings**,
// and 2.5 s of holding the button on a block produced **breakProgress 0**.
//
// ⚠ §5 CANNOT SEE IT, AND THAT IS THE POINT. `missTime` IS assigned — `P.missTime = P.MISS_TIME`
// on the miss path — so "read but never written" exonerates it. **The assignment is inside the
// branch the comparison guards**, so it can never run: a field whose only writer is dominated by
// the reader that gates it is a field that is `undefined` for the life of the process.
//
// ⚠ THE RULE IS THE NARROWEST ONE THAT CATCHES IT: a property compared or incremented as a
// NUMBER must appear in the object's own constructing literal. Not "must be assigned somewhere"
// — that is the test that passed. Declaring a field costs one line and is the only way to make
// `undefined` impossible, so the rule is a rule and not a heuristic, and there is no allow-list.
say('\n6. every player field compared as a number is DECLARED in the player literal');
{
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const PLAYER_FILES = ['14_player.js', '14d_survival.js', '14e_gamemode.js', '14i_hand.js',
                        '15_hud.js', '15b_gui.js', '07d_mining.js', '16b_save.js', '17_main.js'];
  // ⚠ "DECLARED" MEANS A STATEMENT THAT CANNOT BE SKIPPED, and there are exactly three shapes
  // of those. Anything else — an assignment inside an `if`, inside a branch, inside a handler —
  // is a promise that the field will exist by the time it is read, and `missTime` is what that
  // promise is worth.
  const declared = new Set();
  const playerSrc = strip(readFileSync(join(SRC, '14_player.js'), 'utf8'));
  {
    //   (a) a key of the constructing literal
    const at = playerSrc.indexOf('NS.Player = {');
    const body = at >= 0 ? playerSrc.slice(at, playerSrc.indexOf('\n  };', at)) : '';
    for (const m of body.matchAll(/^ {4}([A-Za-z_$][\w$]*)\s*:/gm)) declared.add(m[1]);
    for (const m of body.matchAll(/[,{]\s*([A-Za-z_$][\w$]*)\s*:/g)) declared.add(m[1]);
    ok(declared.has('missTime'),
       'the player literal declares missTime — the field whose absence is why this section exists');
    //   (b) a top-level statement of the module: `  P.SEA_LEVEL = 63;` at exactly two spaces,
    //       which is the same indent rule §1 uses to tell a definition from a re-assignment.
    //       It runs when the file is evaluated, so it cannot be skipped.
    for (const m of playerSrc.matchAll(/^ {2}P\.([A-Za-z_$][\w$]*)\s*=(?!=)/gm)) declared.add(m[1]);
    ok(declared.has('SEA_LEVEL') && declared.has('lostDrops'),
       'a top-level `P.x = …` counts as a declaration — it runs when the module is evaluated');
  }
  //   (c) NAMED, because another module\'s init fills it on the entity. An entry must say WHERE,
  //       and the check reads that file and asserts the assignment really is unconditional —
  //       otherwise this list is the hole the rule was written to close.
  const INIT_ELSEWHERE = {
    health: ['14d_survival.js', 'Sv.init'],
    food:   ['14d_survival.js', 'Sv.init'],
    saturation: ['14d_survival.js', 'Sv.init'],
    air:    ['14d_survival.js', 'Sv.init'],
  };
  for (const [field, [file, fn]] of Object.entries(INIT_ELSEWHERE)) {
    const t = strip(readFileSync(join(SRC, file), 'utf8'));
    const at = t.indexOf(fn + ' = function');
    const body = at >= 0 ? t.slice(at, t.indexOf('\n  };', at)) : '';
    // unconditional means indent 4 inside the init, on the entity parameter, not inside a branch
    const re = new RegExp('^ {4}(?:e|p|P)\\.' + field + '\\s*=(?!=)', 'm');
    if (ok(re.test(body), `${field} is unconditionally assigned by ${file}'s ${fn} — the entry is true`)) {
      declared.add(field);
    }
  }
  // ⚠ A READ WITH ITS OWN FALLBACK IS NOT A NUMERIC READ OF THE FIELD: `(P.x || 0) + 1` and
  // `P.x | 0` cannot see `undefined`. Counting them would make the rule noise, and the rule only
  // has teeth because every hit is real.
  const numericReads = (t) => {
    const out = new Map();
    const add = (k, i) => { if (!out.has(k)) out.set(k, i); };
    // `P.foo <= …`, `P.foo > …`, `P.foo -= …`, `P.foo++`
    for (const m of t.matchAll(/\bP\.([A-Za-z_$][\w$]*)\s*(<=|>=|<(?![=<])|>(?![=>])|-=|\+=|\*=|\/=|\+\+|--)/g)) {
      add(m[1], m.index);
    }
    // `… <= P.foo`, and NOT when the very next thing is `||` or `|` (a fallback read)
    for (const m of t.matchAll(/(?:<=|>=|<(?![=<])|>(?![=>]))\s*P\.([A-Za-z_$][\w$]*)\s*(?![|&])/g)) {
      add(m[1], m.index);
    }
    return out;
  };
  const undeclared = new Map();
  for (const f of PLAYER_FILES) {
    const t = strip(readFileSync(join(SRC, f), 'utf8'));
    for (const [k] of numericReads(t)) {
      if (declared.has(k)) continue;
      if (!undeclared.has(k)) undeclared.set(k, new Set());
      undeclared.get(k).add(f);
    }
  }
  for (const [k, where] of undeclared) {
    ok(false, `P.${k} is compared as a number in ${[...where].join(', ')} and the player literal `
            + 'does not declare it — `undefined <= 0` is false, silently (D-357)');
  }
  ok(undeclared.size === 0,
     `${undeclared.size} player fields are compared as numbers without being declared`);
  say(`   ${declared.size} declared fields; every numeric comparison in ${PLAYER_FILES.length} modules lands on one`);

  // ── the break, and it is the REAL regression replayed, not a fake ────────────────────────
  // ⚠ `D-30`: the break must be able to fire. This plants the exact shape — a gate whose only
  // writer is inside itself — and asserts BOTH halves: that the scanner sees the read, and that
  // JavaScript really is silent about it.
  {
    const fakeSrc = 'if (I.mousePressed[0] && P.missTime <= 0) { P.missTime = P.MISS_TIME; }';
    const seen = numericReads(fakeSrc);
    okAv(seen.has('missTime'), 'the planted gate is seen as a numeric read of missTime');
    const nobody = { MISS_TIME: 10 };
    okAv((nobody.missTime <= 0) === false,
         'and `undefined <= 0` really is false — which is the whole mechanism (D-357)');
    okAv(numericReads('var v = (P.attackTicks || 0) + 1;').size === 0,
         'a read with its own fallback is NOT counted — otherwise the rule is noise');
  }
}
say(`   ${pass} ok`);

say('\n4. anti-vacuity: break it, and it must be caught');
{
  const fake = [
    '(function (NS) {',
    "  var H = NS.X = {};",
    '  H.thing = function () { return 1; };',
    '  H.other = 2;',
    '  H.thing = function () { return 2; };',
    '})(MCL);',
  ].join('\n');
  const seen = scan(fake);
  okAv((seen.get('H.thing') || []).length === 2, 'a planted duplicate definition is seen as two');
  okAv((seen.get('H.other') || []).length === 1, 'and a name defined once is seen as one');

  // the two-space rule must be load-bearing: a re-assignment INSIDE a function is not a redefinition
  const inner = [
    '(function (NS) {',
    '  var P = NS.P = {};',
    '  P.slot = 0;',
    '  P.pick = function (i) {',
    '    P.slot = i;',
    '    P.slot = i + 1;',
    '  };',
    '})(MCL);',
  ].join('\n');
  okAv((scan(inner).get('P.slot') || []).length === 1,
    'assignments inside a function body are NOT counted — the indent rule is what separates them');

  // §3 must really measure a run, not merely spot a repeated line
  const pasted = ['(function (NS) {'];
  for (let i = 0; i < 50; i++) pasted.push(`  var unique_${i} = ${i} + someCall(${i});`);
  const twice = pasted.concat(pasted.slice(1)).join('\n').split('\n').map((l) => l.trim());
  let runMax = 0; const fm = new Map();
  for (let i = 0; i < twice.length; i++) {
    const l = twice[i]; if (l.length < 8) continue;
    if (!fm.has(l)) { fm.set(l, i); continue; }
    let a = fm.get(l), b = i, run = 0;
    while (b + run < twice.length && twice[a + run] === twice[b + run]) run++;
    if (run > runMax) runMax = run;
  }
  okAv(runMax >= MIN_RUN, `a planted 50-line paste measures ${runMax} identical lines, over the ${MIN_RUN} threshold`);

  // ── §5's breaks: a read that nothing defines (D-290) ──────────────────────────────────
  {
    const strip5 = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const writesIn = (t) => {
      const w = new Set();
      for (const m of strip5(t).matchAll(/\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=)/g)) w.add(m[1]);
      return w;
    };
    const readsP = (t) => {
      const r = new Set();
      for (const m of strip5(t).matchAll(/\bP\.([A-Za-z_$][\w$]*)\b/g)) r.add(m[1]);
      return r;
    };
    // the exact shape of the real bug: one module writes `eyeInWater`, another reads `eyesInWater`
    const good = '  e.eyeInWater = true;\n  var a = P.eyeInWater;';
    const bad  = '  e.eyeInWater = true;\n  var a = P.eyesInWater;';
    const dead = (src) => [...readsP(src)].filter((k) => !writesIn(src).has(k));
    okAv(dead(good).length === 0 && dead(bad).join() === 'eyesInWater',
      'a one-letter misspelling of a written field is seen as a read nothing defines — the real D-290 bug');

    // ⚠ and the two ways this section could be vacuous: comments, and object-literal keys
    const commented = '  // P.somethingEntirelyMadeUp is explained here\n  var a = 1;';
    okAv(dead(commented).length === 0,
      'a property named only in a COMMENT is not a read — §5\'s own first false positive');
    const asKey = '  var o = { madeUpKey: 1 };\n  var a = P.madeUpKey;';
    okAv(dead(asKey).join() === 'madeUpKey',
      'an object-literal key does NOT count as writing the player — the line that reads a dead field often names it');

    // ⚠ and the namespace half: a hook CALLED and never defined. This is the exact shape of
    // `NS.Hud.onDeath` (D-293), including the `&&` guard that made it silent for months.
    const nsSrc = '  NS.Hud = {};\n  NS.Hud.draw = function () {};\n'
                + '  if (NS.Hud && NS.Hud.onDeath) NS.Hud.onDeath(p);';
    const nsDefined = new Set();
    for (const m of nsSrc.matchAll(/\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)) nsDefined.add(m[1]);
    const nsUsed = [...nsSrc.matchAll(/\bNS\.[A-Z]\w*\.([A-Za-z_$][\w$]*)\b/g)].map((m) => m[1]);
    const nsDead = [...new Set(nsUsed.filter((k) => !nsDefined.has(k)))];
    okAv(nsDead.join() === 'onDeath',
      'a guarded call to an undefined namespace member is seen — the guard is what kept it quiet');
  }

  // and the real regression, replayed: the LAST definition is the one that runs
  const NSx = {};
  new Function('MCL', "(function(NS){var H=NS.X={};H.f=function(){return 'new';};H.f=function(){return 'stale';};})(MCL);")(NSx);
  okAv(NSx.X.f() === 'stale', 'JavaScript really does let the stale copy win — that is why this check exists');
}

console.log('');
console.log('================= dupcheck =================');
console.log(` modules scanned .... ${files.length}`);
console.log(` top-level names .... ${names}`);
console.log(` duplicate names .... ${dups}`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
