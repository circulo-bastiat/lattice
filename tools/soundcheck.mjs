#!/usr/bin/env node
// soundcheck.mjs — PLAN G13. The sound tables, the weighted roll, and the coverage number.
//
//   node tools/soundcheck.mjs [--quiet]
//
// ⚠ THE TRANSPORT IS COMPLETE AND THE COVERAGE IS NOW EXACT. The `.ogg` files live on Dan's
// machine and crossed fifty at a time over several sessions, so this file used to fence the
// coverage against going DOWN rather than assert a number. All 1,214 clips are across; the hedge
// is gone (D-139 — the provisional floor is DELETED, not left beside the real one). What is
// asserted now is the strong form: every selected event is voiced EXCEPT the ones vanilla itself
// ships empty, named in tools/golden/silent-events-1.18.2.tsv, and that set is asserted in both
// directions (D-287). A clip that fails to cross turns this red. A sound Mojang never recorded
// does not. The provisional floor it replaces is DELETED rather than left beside it (D-286).
//
// ⚠ AND THE WEIGHTED ROLL IS THE PART THAT IS EASY TO GET WRONG. `sounds.json` gives entries a
// `weight`, and vanilla rolls `nextInt(totalWeight)`; a uniform roll over four entries weighted
// 1,1,1,4 plays the common one 25% of the time instead of 57%. That is audible as "the wrong
// variant far too often" and is invisible in any other kind of test.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ASSETS = join(ROOT, 'assets');
const GOLDEN = join(ROOT, 'tools', 'golden', 'block-soundtype-1.18.2.tsv');
const QUIET = process.argv.includes('--quiet');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; if (!QUIET) console.log('   ✓ ' + m); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (!QUIET) console.log(...a); };

const NS = {};
globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02j_sounds.js']) {
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
}
const S = NS.Sound;
const meta = JSON.parse(readFileSync(join(ASSETS, 'sounds.meta.json'), 'utf8'));
S.init({ sounds: readFileSync(join(ASSETS, 'sounds.bin')).toString('base64'), soundsBytes: meta.rawBytes });
// ⚠ the header is deflated and the body is not (D-284): `S.base` is past BOTH length words and
// the deflated header, and §1 asserts the clips fill exactly the rest.

console.log('soundcheck — PLAN G13, the sound tables (D-284, D-285)');

// ═══════════ 1. the payload ═══════════════════════════════════════════════════════════════
say('\n1. the payload');
ok(S.ready, 'the tables decoded');
ok(S.bitrate === meta.bitrate, `the payload says ${S.bitrate} kbps, the report says ${meta.bitrate}`);
ok(S.files.length === meta.filesPresent, `${S.files.length} clips, report says ${meta.filesPresent}`);
ok(Object.keys(S.events).length === meta.eventsSelected,
  `${Object.keys(S.events).length} events, report says ${meta.eventsSelected}`);
ok(S.roles.join(',') === 'break,step,place,hit,fall',
  `the five roles are in the DERIVED order, got ${S.roles.join(',')}`);
// the blobs must exactly fill the payload — an off-by-one in an offset is silence, not a crash
let last = null, gaps = 0;
for (const f of S.files) { if (last !== null && f.o !== last) gaps++; last = f.o + f.l; }
ok(gaps === 0, `${gaps} clips do not start where the previous one ended`);
ok(S.base + (last || 0) === S.bytes.length,
  `the clips end at ${S.base + (last || 0)} and the payload is ${S.bytes.length} bytes`);
// every clip must look like an Ogg page — "OggS" at byte 0
let oggs = 0;
for (const f of S.files) {
  const p = S.base + f.o;
  if (S.bytes[p] === 0x4F && S.bytes[p + 1] === 0x67 && S.bytes[p + 2] === 0x67 && S.bytes[p + 3] === 0x53) oggs++;
}
say(`   ${oggs}/${S.files.length} clips begin with the Ogg magic`);
ok(oggs === S.files.length, `${S.files.length - oggs} clips are not Ogg streams — the offsets are wrong`);

// ═══════════ 2. the block table, against the bytecode's own answer ════════════════════════
say('\n2. block -> sound type, against tools/golden/block-soundtype-1.18.2.tsv');
{
  ok(existsSync(GOLDEN), 'the golden table exists');
  const rows = readFileSync(GOLDEN, 'utf8').split('\n').filter((l) => l && l[0] !== '#');
  const golden = new Map();
  for (const r of rows) { const c = r.split('\t'); if (c.length >= 9) golden.set(c[0], c.slice(4, 9)); }
  say(`   ${golden.size} blocks in the golden table, ${Object.keys(S.blockType).length} packed`);
  ok(golden.size === 898, `${golden.size} blocks in the golden table, expected 898`);
  ok(Object.keys(S.blockType).length === golden.size, 'every golden block is packed');
  let agree = 0; const bad = [];
  for (const [b, ev] of golden) {
    const t = S.types[S.blockType[b]];
    if (t && t.join('|') === ev.join('|')) agree++; else bad.push(b);
  }
  ok(agree === golden.size, `the packed table agrees with the bytecode for every block — ${bad.slice(0, 4).join(', ')}`);
  say(`   ${S.types.length} distinct sound types`);
  ok(S.types.length >= 70 && S.types.length <= 80, `${S.types.length} distinct sound types, expected about 76`);

  // ⚠ the anchors: blocks whose sound cannot be in doubt, and PAIRS that must differ
  const evOf = (b, role) => { const t = S.types[S.blockType[b]]; return t ? t[S.roles.indexOf(role)] : null; };
  for (const [b, role, want] of [
    ['stone', 'break', 'block.stone.break'], ['oak_planks', 'step', 'block.wood.step'],
    ['glass', 'break', 'block.glass.break'], ['white_wool', 'step', 'block.wool.step'],
    ['sand', 'step', 'block.sand.step'], ['grass_block', 'step', 'block.grass.step'],
    ['iron_block', 'step', 'block.metal.step'], ['deepslate', 'step', 'block.deepslate.step'],
    ['ladder', 'step', 'block.ladder.step'], ['honey_block', 'step', 'block.honey_block.step'],
  ]) ok(evOf(b, role) === want, `${b}.${role} is ${evOf(b, role)}, expected ${want}`);
  // ⚠ per-type volume/pitch from the SoundType constructor (#369): METAL 1/1.5, ANVIL 0.3/1
  const vpOf = (b) => S.typeVP && S.typeVP[S.blockType[b]];
  for (const [b, v, p] of [['iron_block', 1, 1.5], ['rail', 1, 1.5], ['anvil', 0.3, 1], ['stone', 1, 1]]) {
    const g = vpOf(b);
    ok(g && g[0] === v && g[1] === p, `${b} sound type is (volume ${v}, pitch ${p}), got ${JSON.stringify(g)}`);
  }
  okAv(!(vpOf('stone') && vpOf('stone')[1] === 1.5) && vpOf('iron_block') !== vpOf('stone'), 'a metal block is not read as the default (1, 1)');
  for (const [a, b] of [['stone', 'oak_planks'], ['glass', 'white_wool'], ['sand', 'gravel'], ['grass_block', 'stone']]) {
    ok(S.blockType[a] !== S.blockType[b], `${a} and ${b} must not share a sound type`);
  }
  // and a role that is NOT the one asked for must give a different event
  ok(evOf('stone', 'break') !== evOf('stone', 'step'),
    'break and step are different events — a role index off by one would collapse them');
}

// ═══════════ 3. the weighted roll ═════════════════════════════════════════════════════════
say('\n3. picking a variant');
{
  // a synthetic event built from real clip indices, so the roll is tested rather than the data
  S.events.__test_uniform = { s: [{ i: 0, w: 1, v: 1, p: 1 }, { i: 1, w: 1, v: 1, p: 1 }, { i: 2, w: 1, v: 1, p: 1 }, { i: 3, w: 1, v: 1, p: 1 }] };
  S.events.__test_weighted = { s: [{ i: 0, w: 1, v: 1, p: 1 }, { i: 1, w: 1, v: 1, p: 1 }, { i: 2, w: 1, v: 1, p: 1 }, { i: 3, w: 4, v: 1, p: 1 }] };
  const hist = (ev, n) => {
    const h = [0, 0, 0, 0];
    for (let k = 0; k < n; k++) { const c = S.pick(ev, (k + 0.5) / n); if (c) h[c.i]++; }
    return h;
  };
  const u = hist('__test_uniform', 4000), w = hist('__test_weighted', 4000);
  say('   uniform  1,1,1,1 -> ' + u.join(' '));
  say('   weighted 1,1,1,4 -> ' + w.join(' '));
  ok(u.every((x) => Math.abs(x - 1000) <= 2), `equal weights give equal shares: ${u.join(' ')}`);
  // ⚠ 4/7 of the rolls, not 1/4. This is the assertion a uniform implementation fails.
  ok(Math.abs(w[3] - 4000 * 4 / 7) <= 3, `the weight-4 entry takes 4/7 of the rolls, got ${w[3]} of 4000`);
  ok(Math.abs(w[0] - 4000 / 7) <= 3, `and each weight-1 entry takes 1/7, got ${w[0]}`);
  ok(w[3] > w[0] * 3.5, 'the heavy entry really is much more likely');
  ok(S.pick('__no_such_event') === null, 'an unknown event picks nothing');
  ok(S.pick('__test_uniform', 0).i === 0 && S.pick('__test_uniform', 0.999).i === 3,
    'the roll spans the whole range — 0 gives the first entry and ~1 the last');
  delete S.events.__test_uniform; delete S.events.__test_weighted;

  // per-entry volume and pitch ride along
  S.events.__test_vp = { s: [{ i: 0, w: 1, v: 0.5, p: 2 }] };
  const c = S.pick('__test_vp', 0);
  ok(c.v === 0.5 && c.p === 2, 'an entry\'s own volume and pitch come back with the choice');
  delete S.events.__test_vp;
}

// ═══════════ 4. what is voiced, and it may not go DOWN ════════════════════════════════════
say('\n4. coverage');
{
  const evs = Object.keys(S.events);
  let voiced = 0;
  for (const e of evs) if (S.voiced(e)) voiced++;
  say(`   ${voiced} of ${evs.length} selected events have audio  (${(voiced / evs.length * 100).toFixed(1)}%)`);
  say(`   ${meta.filesPresent} of ${meta.filesWanted} clips staged, ${(meta.audioBytes / 1024 / 1024).toFixed(2)} MB opus`);
  ok(voiced === meta.voiced + meta.partial, `${voiced} voiced events, report says ${meta.voiced} + ${meta.partial}`);

  // ⚠ THE FLOOR. These are the events a player hears in the first minute; they are not optional,
  // and every one of them is in `dig/`, `step/`, `random/` or `damage/` — the first batches to
  // cross. If the transport regressed, this is where it shows.
  const FLOOR = [
    'block.stone.break', 'block.stone.step', 'block.stone.place', 'block.stone.hit',
    'block.wood.break', 'block.wood.step', 'block.gravel.step', 'block.sand.step',
    'block.grass.step', 'block.wool.step', 'block.snow.step', 'block.metal.step',
    'entity.player.hurt', 'entity.item.pickup', 'entity.experience_orb.pickup',
    'ui.button.click', 'block.water.ambient', 'ambient.cave',
  ];
  const unvoiced = FLOOR.filter((e) => !S.voiced(e));
  say(`   floor: ${FLOOR.length - unvoiced.length}/${FLOOR.length} of the first-minute events voiced`);
  ok(unvoiced.length === 0, `these must have audio and do not: ${unvoiced.join(', ')}`);

  // ⚠ THE TRANSPORT IS DONE (D-286). Every clip the selection asks for is present — not "most",
  // not "at least the floor". This is the assertion the 150-clip floor was standing in for, and
  // that floor is gone rather than demoted: two thresholds for one fact is two truths.
  ok(meta.filesMissing === 0, `${meta.filesMissing} clips never crossed the bridge`
    + (meta.filesNoEncoder ? ` (${meta.filesNoEncoder} of them are raw .ogg that this host could not encode: install ffmpeg, or copy .mcsnd/opus${meta.bitrate} from a host that has it)` : ''));
  ok(meta.filesPresent === meta.filesWanted,
    `${meta.filesPresent} of ${meta.filesWanted} clips staged — the transport is complete or it is not`);
  ok(meta.filesMissing === meta.filesWanted - meta.filesPresent, 'the missing count is the arithmetic complement');

  // ⚠ AND THE ONLY SILENT EVENTS ARE THE ONES VANILLA LEAVES SILENT (D-287). Read the golden and
  // assert BOTH directions: nothing unexpectedly quiet, and nothing on the list unexpectedly loud.
  // Without this, "5 silent" in the pack report is an unexplained residue that could equally be
  // five missing files; with it, the residue is a proven property of the source data.
  const GOLD_SILENT = readFileSync(join(ROOT, 'tools', 'golden', 'silent-events-1.18.2.tsv'), 'utf8')
    .split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t')[0]);
  ok(GOLD_SILENT.length === 11, `the golden list has ${GOLD_SILENT.length} rows, vanilla 1.18.2 has 11`);
  const expectSilent = GOLD_SILENT.filter((e) => S.events[e] !== undefined);
  const actualSilent = evs.filter((e) => !S.voiced(e));
  const surprising = actualSilent.filter((e) => !GOLD_SILENT.includes(e));
  const missingSilence = expectSilent.filter((e) => S.voiced(e));
  say(`   silent: ${actualSilent.length} events, all of them empty in vanilla too`);
  ok(surprising.length === 0, `silent here but NOT empty in vanilla — these clips are missing: ${surprising.join(', ')}`);
  ok(missingSilence.length === 0, `empty in vanilla but voiced here — audio was invented: ${missingSilence.join(', ')}`);
  ok(actualSilent.length === expectSilent.length && expectSilent.length === 5,
    `${expectSilent.length} of the 11 vanilla-empty events survive the mob/music exclusion, expected 5`);
  ok(meta.silent === actualSilent.length, `the report says ${meta.silent} silent, the payload says ${actualSilent.length}`);
  const b64 = meta.base64Bytes / 1024 / 1024;
  say(`   payload ${(meta.rawBytes / 1024 / 1024).toFixed(2)} MB -> ${b64.toFixed(2)} MB base64`);
  // ⚠ D-12's ceiling, with base64 already applied — PLAN's acceptance criterion for this stage.
  ok(b64 < 11, `the sound payload is ${b64.toFixed(2)} MB base64 and must leave room under D-12's 15 MB`);
  // PASS 16: a session whose raw .ogg cache was never staged here re-uses a PRIOR encode from
  // `.mcsnd/opus<bitrate>` by content hash (tools/pack-sounds.mjs's own fallback, added this
  // pass — see git 2a8efe1:docs/passes/PASS-16-HISTORY.md). The ratio is only MEASURABLE when at least
  // one raw source was actually read this run; with none, `meta.filesFromRawSource` says so
  // honestly rather than this assertion dividing by a number nothing here produced.
  if (meta.filesFromRawSource > 0 && !meta.filesFromCacheOnly) {
    ok(meta.vorbisBytes / meta.audioBytes > 3, `the re-encode is ${(meta.vorbisBytes / meta.audioBytes).toFixed(2)}x smaller, which is why it fits`);
  } else {
    say(`   ratio not measured this run (${meta.filesFromCacheOnly} clips reused from a prior encode, 0 raw sources staged here)`);
  }
}

// ═══════════ 5. the block hooks ═══════════════════════════════════════════════════════════
say('\n5. the block hooks');
{
  // ⚠ they are driven by STATE, not by block name, so this needs the state table — which the
  // check does not load. What can be asserted here is the arithmetic around them.
  const near = (m, v, p) => Math.abs(m.volume - v) < 1e-9 && Math.abs(m.pitch - p) < 1e-9;
  for (const [v, p] of [[1, 1], [0.5, 1.2], [0.3, 0.7]]) {
    ok(near(S.blockMix('break', v, p), (v + 1) / 2, p * 0.8) && near(S.blockMix('place', v, p), (v + 1) / 2, p * 0.8), `break/place at (${v},${p}) are ((v+1)/2, p*0.8)`);
    ok(near(S.blockMix('hit', v, p), (v + 1) / 8, p * 0.5), `hit at (${v},${p}) is ((v+1)/8, p*0.5)`);
    ok(near(S.blockMix('step', v, p), v * 0.15, p), `step at (${v},${p}) is (v*0.15, p)`);
    ok(near(S.blockMix('fall', v, p), v * 0.5, p * 0.75), `fall at (${v},${p}) is (v*0.5, p*0.75)`);
  }
  ok(S.PITCH_JITTER === undefined && S.BREAK_VOLUME === undefined, 'no pitch jitter and no fixed 0.8 break volume exist');
  {
    const a = S.blockMix('break', 1, 1), b = S.blockMix('break', 1, 1);
    okAv(a.volume === 1 && a.pitch === 0.8 && a.pitch === b.pitch, 'a volume-1 break plays at (1.0, 0.8), identically every time');
    okAv(!near(S.blockMix('break', 1, 1), 0.8, 1), 'the old swapped (0.8, 1.0) is rejected');
    okAv(near(S.blockMix('hit', 1, 1), 0.25, 0.5) && !near(S.blockMix('hit', 1, 1), 0.25, 1), 'a volume-1 hit plays at (0.25, 0.5)');
  }
  ok(S.STEP_VOLUME === 0.15, 'and a footstep at 0.15 — the quietest thing in the game');
  ok(S.MAX_DISTANCE === 16, 'a normal-volume sound carries 16 blocks');
  ok(typeof S.blockBreak === 'function' && typeof S.blockStep === 'function'
    && typeof S.blockPlace === 'function' && typeof S.blockHit === 'function'
    && typeof S.blockFall === 'function', 'all five hooks exist');
  ok(S.blockEvent(0, 'break') === null || typeof S.blockEvent(0, 'break') === 'string',
    'blockEvent returns a name or null, never undefined');
  // ⚠ THE CONTEXT IS BLOCKED UNTIL A GESTURE, and `play` must refuse rather than throw
  ok(S.blocked === true, 'the context starts blocked — no AudioContext exists in node');
  ok(S.play('block.stone.break', {}) === false, 'and playing before the gesture refuses, quietly');
  ok(S.played === 0, 'nothing was played');

  // ── the footstep counter, and this section was WRONG ABOUT VANILLA FOR THREE SESSIONS ───
  // ⚠⚠ **IT RE-IMPLEMENTED THE RULE INSTEAD OF DRIVING THE ENGINE'S**, and then reasoned its way
  // to the wrong answer and wrote the reasoning down (D-362). Vanilla's `Entity.move` accumulates
  // **`sqrt(dx^2+dy^2+dz^2) * 0.6`** and `Entity.nextStep()` is **`(int)moveDist + 1`** — an
  // integer truncation, read off the bytecode as `f2i; iconst_1; iadd`. This file asserted the
  // opposite (that the overshoot carries), the engine agreed with the file, and both were wrong:
  // a step landed every 1.0 blocks walked instead of every ~1.67, which is **67% too many
  // footsteps**, audible, and exactly the machine-gun cadence §5's own header warns about.
  // ⚠ So the rule is now driven through the PLAYER, not restated here.
  // ⚠ THE PLAYER IS NOT LOADED HERE — it would drag in physics, survival and the registry for a
  // counter. So the two numbers are read OUT OF THE ENGINE'S SOURCE and the arithmetic below
  // uses them: a change in `14_player.js` that is not mirrored here fails on the first line
  // rather than silently leaving this section describing a rule the game no longer has.
  const playerSrc = readFileSync(join(SRC, '14_player.js'), 'utf8');
  ok(/P\.moveDist \+= Math\.sqrt\(mdx \* mdx \+ vy \* vy \+ mdz \* mdz\) \* 0\.6/.test(playerSrc),
     'the engine accumulates moveDist as vanilla does: the 3D distance times 0.6, dy only when climbable');
  ok(/if \(!riding && !\(P\.flying \|\| \(P\.onGround && cmd\.sneak\)\)\)/.test(playerSrc),
     'and flying or sneaking on the ground accumulates nothing (#371)');
  ok(!/!S\.ready \|\| !P\.onGround/.test(playerSrc), 'and footsteps are not gated on onGround (#371)');
  ok(/P\.nextStep = \(P\.moveDist \| 0\) \+ 1/.test(playerSrc),
     'and the threshold truncates: `(int)moveDist + 1`, not `moveDist + 1`');
  ok(/if \(!\(P\.moveDist > P\.nextStep\)\)/.test(playerSrc),
     'and the comparison is strictly greater, as `fcmpl; ifle` is');
  // #461: sneak/fly silence, swim splash, above-block group, fence landing, amethyst chime
  ok(/P\.flying \|\| \(P\.onGround && P\.crouching\)/.test(playerSrc), 'flying, or sneaking on the ground, makes no step sound');
  ok(/entity\.player\.swim/.test(playerSrc) && /Math\.sqrt\(vx \* vx \* 0\.2 \+ vy \* vy \+ vz \* vz \* 0\.2\) \* 0\.35/.test(playerSrc), 'a wet step is the swim splash at vanilla volume');
  ok(/inside_step_sound_blocks/.test(playerSrc) && /'fences'/.test(playerSrc) && /crystal_sound_blocks/.test(playerSrc), 'above-block group, fence landing and amethyst chime are present');
  ok(!/!P\.onGround \|\| P\.mode === 3/.test(playerSrc), 'steps do not require onGround');
  const steps = (perTick, ticks) => {
    let moveDist = 0, nextStep = 1, n = 0;
    for (let i = 0; i < ticks; i++) {
      moveDist += perTick * 0.6;
      if (moveDist > nextStep) { nextStep = (moveDist | 0) + 1; n++; }
    }
    return n;
  };
  const walk = steps(0.215, 100);
  const dist = 0.215 * 100;
  say(`   100 ticks at 0.215 blocks/tick (a walk) = ${dist.toFixed(1)} blocks, ${walk} steps`);
  // 21.5 blocks walked is 12.9 units of `moveDist`, so twelve steps — not twenty-one.
  ok(walk === 12, `a 21.5-block walk gives 12 steps, got ${walk}`);
  ok(walk < Math.floor(dist) / 1.5,
     'and it is far fewer than one per whole block, because vanilla scales the distance by 0.6');
  const sprint = steps(0.28, 100);
  ok(sprint > walk, `a sprint (0.28/tick) steps more often — ${sprint} against ${walk} — without any timer`);
}

// ═══════════ 6. anti-vacuity ══════════════════════════════════════════════════════════════
say('\n6. anti-vacuity: break it, and it must be caught');
{
  // the weighted roll must differ from a uniform one
  S.events.__av = { s: [{ i: 0, w: 1 }, { i: 1, w: 1 }, { i: 2, w: 1 }, { i: 3, w: 4 }] };
  const N = 7000;
  let heavy = 0;
  for (let k = 0; k < N; k++) if (S.pick('__av', (k + 0.5) / N).i === 3) heavy++;
  const uniformShare = N / 4;
  okAv(Math.abs(heavy - N * 4 / 7) < Math.abs(heavy - uniformShare),
    `the weighted roll gives ${heavy} of ${N} where a uniform one would give ${uniformShare} — §3 tells them apart`);
  delete S.events.__av;

  // §2 must fail when a role index drifts
  const t = S.types[S.blockType.stone];
  okAv(t[0] !== t[1] && t[1] !== t[2], 'stone\'s break, step and place are three different events, so a role shift is visible');

  // #461: the sneak gate must be a real test — a source without it must not match
  okAv(!/P\.flying \|\| \(P\.onGround && P\.crouching\)/.test(readFileSync(join(SRC, '14_player.js'), 'utf8').replace('P.crouching', 'P.crouchX')), 'renaming the sneak gate breaks the assertion');
  // §1's Ogg magic must be a real test: a wrong offset must fail it
  const p0 = S.base + S.files[0].o + 1;
  okAv(!(S.bytes[p0] === 0x4F && S.bytes[p0 + 1] === 0x67 && S.bytes[p0 + 2] === 0x67),
    'one byte off the start of a clip is NOT an Ogg header, so §1 is checking the offsets');

  // #371: the pre-fix engine source (dy always counted, onGround gate) must fail the §5 regexes
  {
    const old = readFileSync(join(SRC, '14_player.js'), 'utf8').replace(/(?<![.\w])vy \* vy/g, 'mdy * mdy')
      .replace('!S.ready || P.mode', '!S.ready || !P.onGround || P.mode');
    okAv(!/vy \* vy/.test(old) && /!S\.ready \|\| !P\.onGround/.test(old),
      'the pre-#371 source (dy always counted, on-ground gate) is distinguishable from the fixed one');
  }

  // the floor must be a real subset: an event not in the payload must fail `voiced`
  okAv(!S.voiced('entity.zombie.ambient'), 'a mob event is not voiced — the exclusion rule really excluded it');
  okAv(S.voiced('block.stone.step'), '...while a first-minute event is');

  // ⚠ §4's silent-set assertion (D-287), broken in BOTH directions. These are the two ways the
  // transport can lie: a clip that never arrived looks exactly like a sound Mojang never recorded, and a
  // fallback that invented audio for an empty event looks exactly like success.
  const GOLD = readFileSync(join(ROOT, 'tools', 'golden', 'silent-events-1.18.2.tsv'), 'utf8')
    .split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split('\t')[0]);
  const evsAv = Object.keys(S.events);
  const silentSet = () => evsAv.filter((e) => !S.voiced(e));
  const surprise = () => silentSet().filter((e) => !GOLD.includes(e));

  // (a) lose a clip: a voiced event that is NOT on the golden list goes quiet
  const victim = 'block.gravel.step';
  const savedS = S.events[victim].s;
  S.events[victim].s = [];
  okAv(surprise().includes(victim) && surprise().length === 1,
    `emptying ${victim} makes it the one unexplained silence — §4 would be red`);
  S.events[victim].s = savedS;
  okAv(surprise().length === 0, '...and putting it back clears it, so the check is not stuck red');

  // (b) invent audio: an event vanilla ships empty gets a clip
  const quiet = 'block.roots.step';
  okAv(!S.voiced(quiet), `${quiet} is empty in vanilla and empty here`);
  S.events[quiet].s = [{ i: 0, w: 1 }];
  const invented = GOLD.filter((e) => S.events[e] !== undefined).filter((e) => S.voiced(e));
  okAv(invented.length === 1 && invented[0] === quiet,
    `giving ${quiet} a clip is caught as invented audio — the golden list is read, not decorative`);
  S.events[quiet].s = [];

  // the block table must be load-bearing: a block with no entry must give null, not stone
  const saved = S.byBlockId;
  S.byBlockId = new Int16Array([-1]);
  okAv(S.blockEvent(0, 'break') === null || S.blockEvent(0, 'break') === undefined,
    'a block with no sound type gives nothing rather than falling back to stone');
  S.byBlockId = saved;

  // (c) #456: the five hooks pass vanilla's exact volume/pitch, no jitter. S.play is captured, the
  // event lookup stubbed; METAL/ANVIL/twisting-vine types carry their non-1 volume/pitch.
  {
    const realPlay = S.play, realEv = S.blockEvent;
    let ev = 'block.stone.break', got = null;
    S.blockEvent = () => ev;
    const realVP = S.blockVP; // the (v,p) per type is asserted from the data in section 2; here it follows the stubbed event
    S.blockVP = () => ev === 'block.metal.break' ? [1, 1.5] : ev === 'block.anvil.break' ? [0.3, 1] : [1, 1];
    S.play = (e, o) => { got = o; return true; };
    const want = { break: [1, 0.8], place: [1, 0.8], step: [0.15, 1], hit: [0.25, 0.5], fall: [0.5, 0.75] };
    const fn = { break: 'blockBreak', place: 'blockPlace', step: 'blockStep', hit: 'blockHit', fall: 'blockFall' };
    let exact = true;
    for (const r of Object.keys(want)) for (let k = 0; k < 20; k++) {
      got = null; S[fn[r]](0, 0, 0, 0, null);
      if (!got || Math.abs(got.volume - want[r][0]) > 1e-9 || Math.abs(got.pitch - want[r][1]) > 1e-9) exact = false;
    }
    okAv(exact, 'break/place/step/hit/fall pass (v+1)/2 @ p*0.8, v*0.15 @ p, v*0.25 @ p*0.5, v*0.5 @ p*0.75 - constant, no jitter');
    ev = 'block.metal.break'; got = null; S.blockPlace(0, 0, 0, 0, null);
    okAv(got && got.volume === 1 && Math.abs(got.pitch - 1.2) < 1e-9, 'metal place is pitch 1.5*0.8 = 1.2');
    ev = 'block.anvil.break'; got = null; S.blockBreak(0, 0, 0, 0, null);
    okAv(got && Math.abs(got.volume - 0.65) < 1e-9, 'anvil break is volume (0.3+1)/2 = 0.65');
    S.play = realPlay; S.blockEvent = realEv; S.blockVP = realVP;
  }

  // and the distance attenuation must actually attenuate
  okAv(S.MAX_DISTANCE > 0 && (1 - 8 / S.MAX_DISTANCE) === 0.5,
    'a sound eight blocks away is at half volume — the rolloff is linear to 16');
}


// ═══════════ 7. G13 (#373): attenuation against the camera, per-entry distance, 3D ═════════════
say('\n7. attenuation, attenuation_distance and panning');
{
  ok(Math.abs(S.attenuate(3, 24, 0, 0, 16) - 0.5) < 1e-9, 'volume 3 at 24 blocks (reach 48) is 0.5: clamp THEN rolloff');
  ok(S.attenuate(3, 48, 0, 0, 16) === 0 && S.attenuate(1, 8, 0, 0, 8) === 0, 'and it is silent at the reach');
  const cand = S.events['block.candle.extinguish'];
  ok(cand && cand.s.some((e) => e.a === 8), 'block.candle.extinguish carries attenuation_distance 8 in the packed header');
  ok(S.attenuate(1, 12, 0, 0, 8) === 0, 'so a candle 12 blocks away is silent');
  // a fake context: a positional sound with NO listener must be attenuated against NS.Player
  const made = { panner: 0 };
  const node = () => ({ connect() {}, gain: { value: 1 }, playbackRate: { value: 1 }, start() {}, positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 } });
  const savedCtx = S.ctx, savedBlocked = S.blocked, savedDec = S.decoded[0];
  S.ctx = { createBufferSource: node, createGain: node, createPanner: () => { made.panner++; return node(); } };
  S.blocked = false; S.decoded[0] = {};
  const savedPick = S.pick; S.pick = () => ({ i: 0, v: 1, p: 1 });
  NS.Player = { x: 0, y: 64, z: 0, yaw: 0 };
  const before = S.played;
  ok(S.play('x', { x: 40, y: 64, z: 0, volume: 1 }) === false && S.played === before, 'no listener, 40 blocks away: silent');
  ok(S.play('x', { x: 8, y: 64, z: 0, volume: 1 }) === true && Math.abs(S.lastGain - 0.5) < 1e-9, 'no listener, 8 blocks: gain 0.5');
  ok(S.play('x', { x: 8, y: 64, z: 0, volume: 1, listener: null }) === true, 'a null listener is the player too');
  ok(made.panner === 2, 'a positioned source gets a PannerNode (' + made.panner + ')');
  const cnt = made.panner;
  S.play('x', { volume: 1 });
  ok(made.panner === cnt, 'a sound with no position is not panned');
  okAv(S.attenuate(3, 24, 0, 0, 16) !== 1, 'clamping after the rolloff would give 1, not 0.5');
  okAv(S.attenuate(1, 12, 0, 0, 16) > 0 && S.attenuate(1, 12, 0, 0, 8) === 0, 'the distance is read per entry, not a global 16');
  okAv(made.panner < 10, 'the panner counter is real');
  S.pick = savedPick; S.ctx = savedCtx; S.blocked = savedBlocked; S.decoded[0] = savedDec; delete NS.Player;
}

console.log('');
console.log('================ soundcheck ================');
console.log(` sound events ....... ${Object.keys(S.events).length} selected of ${meta.eventsTotal}`);
console.log(` clips .............. ${meta.filesPresent} of ${meta.filesWanted} staged, ${S.bitrate} kbps mono opus`);
console.log(` events voiced ...... ${meta.voiced} fully, ${meta.partial} partly, ${meta.silent} silent`);
console.log(` block sound types .. ${S.types.length} over ${Object.keys(S.blockType).length} blocks, from the bytecode`);
console.log(` payload ............ ${(meta.rawBytes / 1024 / 1024).toFixed(2)} MB -> ${(meta.base64Bytes / 1024 / 1024).toFixed(2)} MB base64`);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
// G13 #374 — every literal `Sound.play` source in src/ names a real gain node.
{
  const { readdirSync } = await import('node:fs');
  const S = NS.Sound;
  const bad = (srcs) => srcs.filter((x) => !S.SOURCES.includes(x));
  const found = [];
  for (const f of readdirSync(SRC).filter((n) => n.endsWith('.js'))) {
    const t = readFileSync(join(SRC, f), 'utf8');
    for (const m of t.matchAll(/(?:Sound|S)\.play\([^\n]*?source:\s*'([a-z_]+)'/g)) found.push(m[1]);
  }
  ok(found.length > 5 && bad(found).length === 0, 'play() callers name real sources; bad: ' + bad(found).join(','));
  okAv(bad(found.concat(['blocks'])).length === 1, 'a "blocks" source is caught');
  okAv(bad(found.concat(['records'])).length === 1, 'a "records" source is caught');
}
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
for (const f of fails) console.log('FAIL  ' + f);
process.exit(fails.length ? 1 : 0);
