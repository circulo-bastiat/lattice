#!/usr/bin/env node
// mobcmdexeccheck.mjs — mob-command joins: `/teleport` (and the `/tp` alias) on MOB targets,
// `/execute as`/`at` against `@e[type=...]`, nested `execute` chains, and entity selectors
// (`type=`, `distance=`, `limit=`, negation) against a MIXED-MOB scene.
//
//   node tools/mobcmdexeccheck.mjs [--verbose]
//
// ⚠⚠ WHY THIS EXISTS. `tools/commandcheck.mjs`'s own `execute as @e` fork test is gated behind
// `if (EL && EL.ready)` and `EL` is `NS.EntityList`, which that check's file list never loads —
// so it silently never ran, and nothing has ever driven `/teleport`, `/tp` or `/execute as`/`at`
// against an actual spawned mob. This check loads the real entity system (`07h_entities.js`,
// `14b_physics.js`, `07i_entitylist.js`) alongside `15g_commands.js` and spawns a small mixed
// scene of real mobs to close that gap.
//
// ⚠⚠ IT FOUND A REAL BUG. `C.resolve`'s `type=` filter compared `ET.names[t.e.type]` to the
// wanted name — but `t.e.type` is ALREADY the bare type string (`EL.spawn` sets it straight off
// `Entities.bare`), and `Ent.names` is a SORTED ARRAY OF NAME STRINGS used elsewhere by numeric
// INDEX (`M.entityType`'s suggestions). Indexing that array with a string key is always
// `undefined`, so `@e[type=zombie]` — and `type=` on any selector, anywhere, against any mob —
// has never matched a single entity. `C.selfTarget` had the identical bug for `@s`'s `name`
// field, and the `@e` wildcard branch set no `name` at all, so a `/teleport @e[type=cow] ...`
// that DID move something still reported "Teleported Player", not the cow. All three are fixed
// in `src/15g_commands.js`; see D-737 there. §1–§4 below assert the fix in both directions —
// each has an anti-vacuity pair that reproduces the exact broken comparison and shows this check
// catches it.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, initRegistry } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');

let pass = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 60) fails.push(m); return c; };
const okAv = (c, m) => { if (c) { pass++; console.log('   ✓ ' + m.replace(/^anti-vacuity: /, '')); } else fails.push('anti-vacuity: ' + m); };
const say = (...a) => { if (VERBOSE) console.log(...a); };

console.log('mobcmdexeccheck — /teleport, /tp and /execute as/at against real mobs, and entity selectors');

// ── boot the real engine: blocks/registry (for the command dispatcher's block-state args),
// entities+physics+entitylist (for real spawned mobs), commands+brigadier ─────────────────────
const M = loadEngine({
  extra: ['02g_items.js', '02i_text.js', '02j_sounds.js', '09b_sky.js', '14e_gamemode.js',
          '14f_inventory.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js',
          '14d_survival.js', '14h_brigadier.js', '15g_commands.js'],
  initReg: true
});
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8'))
});
M.Entities.init();
ok(M.Entities.ready && M.Entities.count > 0, `the entity type table is up (${M.Entities.count} types)`);
{
  const raw = readFileSync(join(ASSETS, 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
}
// a flat floor, so a spawned mob's motion (if it were ticked) would be arithmetic — the
// entlistcheck/combatcheck idiom. Nothing here ticks the entities; positions are set directly,
// exactly as `/teleport` itself sets them.
const FLOOR_Y = 40;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
ok(M.EntityList.ready, 'the entity list is up, so `@e` has something real to resolve');

M.Main = { seed: 1337 };
const WORLD = new Map();
M.World = {
  getBlock: (x, y, z) => WORLD.get(x + ',' + y + ',' + z) || 0,
  setBlock: (x, y, z, id) => { WORLD.set(x + ',' + y + ',' + z, id); }
};
M.DATA.gameRules = (() => {
  const out = {};
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'gamerules-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const c = line.split('\t');
    if (c.length >= 3) out[c[0]] = { t: c[1] === 'integer' ? 'i' : 'b', d: c[2] };
  }
  return out;
})();

const mkPlayer = (x, y, z) => {
  const P = { x, y, z, yaw: 0, pitch: 0, mode: 0, health: 20, dead: false,
              inventory: M.Inventory.create(), syncHotbar() {}, mayFly: false, instabuild: false,
              flying: false, invulnerable: false, mayBuild: true };
  M.Player = P;
  if (M.Survival && M.Survival.init) M.Survival.init(P);
  return P;
};

const C = M.Commands;
C.build();
ok(C.ready, 'the dispatcher builds');
const run = (line, opts) => C.run(line, M.Player, opts || {});
const near = (a, b, t) => Math.abs(a - b) <= (t === undefined ? 1e-6 : t);
const EL = M.EntityList;

// ═══════════════ 1. `/teleport` and the `/tp` REDIRECT, on MOB targets ═══════════════════════
console.log('\n 1. /teleport (and /tp) targeting mobs, not just the player');
{
  const P = mkPlayer(1000, 70, 1000);
  EL.clear();
  const cow = EL.spawn('cow', 1010, 70, 1010);
  const pig = EL.spawn('pig', 1020, 70, 1020);
  ok(cow && pig, 'a cow and a pig spawn');

  // ── a single mob, by selector, to a literal destination ────────────────────────────────
  const r1 = run('/teleport @e[type=cow] 2000 80 2000');
  ok(r1.ok, '/teleport @e[type=cow] 2000 80 2000 runs');
  ok(r1.result === 1, `and moves exactly one target (${r1.result})`);
  ok(near(cow.x, 2000) && near(cow.y, 80) && near(cow.z, 2000), 'the COW landed at the destination');
  ok(!near(pig.x, 2000), 'the pig, untargeted, did not move');
  ok(near(P.x, 1000), 'and the PLAYER did not move — `/teleport <selector> <dest>` is not `/teleport <dest>`');
  ok(r1.lines.some((l) => /cow/.test(l)) && !r1.lines.some((l) => /Player/.test(l)),
     `the feedback names the mob that actually moved, not "Player" (${JSON.stringify(r1.lines)})`);

  // ── the `/tp` alias/redirect does the identical thing ───────────────────────────────────
  const r2 = run('/tp @e[type=pig] 2100 75 2100');
  ok(r2.ok && r2.result === 1, '/tp @e[type=pig] ... redirects and runs');
  ok(near(pig.x, 2100) && near(pig.y, 75) && near(pig.z, 2100), 'and the PIG (not the cow) landed there');
  ok(near(cow.x, 2000), 'the cow, from the PREVIOUS command, is undisturbed by this one');

  // ─── relative coordinates in /tp <targets> <location> resolve against the SOURCE (the
  // command's own executor), exactly as Vec3ArgumentType.getPosArgument($$0x.getSource(),...)
  // does in vanilla's TeleportCommand — NOT against the mob being moved. ~5 ~ ~-5 from the
  // player at (1000,70,1000) lands the cow at (1005,70,995) no matter where the cow started.
  cow.x = 3000; cow.y = 80; cow.z = 3000;
  const r3 = run('/tp @e[type=cow] ~5 ~ ~-5');
  ok(r3.ok, '/tp @e[type=cow] ~5 ~ ~-5 (relative) runs');
  ok(near(cow.x, P.x + 5) && near(cow.z, P.z - 5),
     `~ resolved against the SOURCE's position (cow now ${cow.x},${cow.z}), not the cow's own prior (3000,3000)`);

  // ── a selector matching MULTIPLE mobs moves all of them, and reports the count ─────────
  EL.clear();
  const z1 = EL.spawn('zombie', 1000, 70, 1000);
  const z2 = EL.spawn('zombie', 1100, 70, 1100);
  const skel = EL.spawn('skeleton', 1200, 70, 1200);
  const r4 = run('/teleport @e[type=zombie] 4000 90 4000');
  ok(r4.ok && r4.result === 2, `/teleport @e[type=zombie] moves BOTH zombies and only them (result ${r4.result})`);
  ok(near(z1.x, 4000) && near(z2.x, 4000), 'both zombies landed at the destination');
  ok(!near(skel.x, 4000), 'the skeleton, a different type, is untouched');

  // ── anti-vacuity: the SAME broken comparison this check's `type=` fix repairs, reproduced
  // right here and shown to break this exact assertion ───────────────────────────────────
  {
    const origResolve = C.resolve;
    // the exact pre-fix bug: `t.e.type` indexed into `Ent.names` (a plain array of name
    // strings) instead of compared to it directly — always `undefined`, so `type=` matched
    // nothing at all.
    C.resolve = function (sel, source) {
      const out = origResolve(sel, source);
      if (sel.opts && sel.opts.type) {
        const want = String(sel.opts.type.value).replace(/^minecraft:/, '');
        const ET = M.Entities;
        return out.filter((t) => {
          const n = t.kind === 'player' ? 'player' : (ET.names ? ET.names[t.e.type] : '');
          return sel.opts.type.negated ? (n !== want) : (n === want);
        });
      }
      return out;
    };
    z1.x = 1000; z2.x = 1100;
    const broken = run('/teleport @e[type=zombie] 5000 90 5000');
    okAv(broken.ok && broken.result === 0,
      `anti-vacuity: with the pre-fix array-index comparison restored, /teleport @e[type=zombie] `
      + `matches NOTHING (result ${broken.result}) — proving the assertion above was real`);
    C.resolve = origResolve;
    const fixed = run('/teleport @e[type=zombie] 5000 90 5000');
    okAv(fixed.ok && fixed.result === 2, 'and with the real resolver back, it matches both zombies again');
  }
}

// ═══════════════ 2. `/execute as`/`at` against `@e[type=...]`, a spread of mob types ══════════
console.log('\n 2. /execute as @e[type=<mob>] at @s run <subcommand>, across several mob types');
{
  mkPlayer(500, 70, 500);
  EL.clear();
  // five mobs, four distinct types, at DISTINCT positions so a position-based assertion can
  // tell them apart
  const zombie = EL.spawn('zombie', 600, 64, 500);
  const skeleton = EL.spawn('skeleton', 610, 70, 510);
  const cow = EL.spawn('cow', 620, 65, 520);
  const creeper = EL.spawn('creeper', 630, 71, 530);
  ok([zombie, skeleton, cow, creeper].every(Boolean), 'four distinct mob types spawn');

  const roster = [['zombie', zombie], ['skeleton', skeleton], ['cow', cow], ['creeper', creeper]];
  for (const [type, ent] of roster) {
    // snapshot EVERY mob's position right before this run, so "nothing else moved" is checked
    // against what was actually there a moment ago — not against the scene's original spawn
    // positions, which earlier iterations of this same loop have already changed.
    const snap = new Map(roster.map(([, e]) => [e, { x: e.x, y: e.y, z: e.z }]));
    // `as` rebinds the SOURCE ENTITY to the mob; `at` then reads THAT entity's own position —
    // together they let `run tp @s ~ ~3 ~` move exactly the named mob, three up, in place.
    const r = run(`/execute as @e[type=${type}] at @s run tp @s ~ ~3 ~`);
    ok(r.ok && r.result === 1, `/execute as @e[type=${type}] at @s run tp @s ~ ~3 ~ runs, one source (${r.result})`);
    const before = snap.get(ent);
    ok(near(ent.x, before.x) && near(ent.y, before.y + 3) && near(ent.z, before.z),
       `and the ${type} itself moved up 3, in its own place (now ${ent.x},${ent.y},${ent.z})`);
    for (const [otherType, other] of roster) {
      if (other === ent) continue;
      const b = snap.get(other);
      ok(near(other.x, b.x) && near(other.y, b.y) && near(other.z, b.z),
         `and no OTHER mob moved (checked against ${otherType}, still at ${other.x},${other.y},${other.z})`);
    }
  }

  // ── `as` really rebinds `@s`'s ENTITY, not just borrows the player's position — proven by
  // teleporting `@s` itself from inside the derived source, which only lands on the right
  // mob if `C.derive`'s `entity` patch actually took ──────────────────────────────────────
  {
    const before = { x: cow.x, y: cow.y, z: cow.z };
    const playerBefore = { x: M.Player.x, y: M.Player.y, z: M.Player.z };
    const r = run('/execute as @e[type=cow] run tp @s 9000 90 9000');
    ok(r.ok && r.result === 1, '/execute as @e[type=cow] run tp @s <dest> runs');
    ok(near(cow.x, 9000) && near(cow.y, 90) && near(cow.z, 9000), 'the COW (via its own @s) landed at the destination');
    ok(near(M.Player.x, playerBefore.x) && near(M.Player.y, playerBefore.y),
       'and the PLAYER — the source `as` started from — did not move at all');
    cow.x = before.x; cow.y = before.y; cow.z = before.z;
  }

  // ── `/teleport <location>` and `/kill`, with NO explicit `<targets>` argument, target the
  // SOURCE's own entity (vanilla: `getSource().getEntityOrThrow()`) — so `/execute as <mob>
  // run tp <dest>` (no `@s`, no `<targets>`) must ALSO move the mob, not the player. ────────
  {
    const before = { x: skeleton.x, y: skeleton.y, z: skeleton.z };
    const playerBefore = { x: M.Player.x, y: M.Player.y, z: M.Player.z };
    const r = run('/execute as @e[type=skeleton] run tp 9200 91 9200');
    ok(r.ok && r.result === 1, '/execute as @e[type=skeleton] run tp <dest> (no @s, no targets) runs');
    ok(near(skeleton.x, 9200) && near(skeleton.y, 91) && near(skeleton.z, 9200),
       'the SKELETON, the implicit self of the rebound source, landed at the destination');
    ok(near(M.Player.x, playerBefore.x) && near(M.Player.y, playerBefore.y),
       'and the player did not move — the implicit target is not hardcoded to `NS.Player`');
    skeleton.x = before.x; skeleton.y = before.y; skeleton.z = before.z;

    // anti-vacuity: force `C.selfTarget` back to the pre-fix hardcoded-player answer (what
    // both `/teleport <location>` and `/kill`'s no-`<targets>` branches called before the fix)
    // and show the SAME command then moves the PLAYER instead of the skeleton.
    const origSelfTarget = C.selfTarget;
    C.selfTarget = function (source) {
      return { kind: 'player', e: M.Player, name: source ? source.name : 'Player' };
    };
    const before2 = { x: skeleton.x, y: skeleton.y, z: skeleton.z };
    const playerBefore2 = { x: M.Player.x, y: M.Player.y, z: M.Player.z };
    const broken = run('/execute as @e[type=skeleton] run tp 9300 92 9300');
    C.selfTarget = origSelfTarget;
    okAv(broken.ok
         && near(M.Player.x, 9300) && near(M.Player.y, 92)
         && near(skeleton.x, before2.x) && near(skeleton.y, before2.y),
      `anti-vacuity: with \`selfTarget\` hardcoded to the player, \`execute as <mob> run tp <dest>\` `
      + `(no explicit target) moves the PLAYER (now ${M.Player.x},${M.Player.y}) instead of the `
      + `skeleton (still ${skeleton.x},${skeleton.y}) — proving the assertion above was real`);
    M.Player.x = playerBefore2.x; M.Player.y = playerBefore2.y; M.Player.z = playerBefore2.z;
  }

  // ── anti-vacuity: break `C.derive` so `as`/`at` stop patching the source at all, and show
  // the SAME test above then moves the wrong thing (the player) instead ──────────────────
  {
    const origDerive = C.derive;
    C.derive = function (src) { return src; };  // the patch (entity/x/y/z/...) is silently dropped
    const playerBefore = { x: M.Player.x, y: M.Player.y, z: M.Player.z };
    const cowBefore = { x: cow.x, y: cow.y, z: cow.z };
    const broken = run('/execute as @e[type=cow] run tp @s 9500 90 9500');
    C.derive = origDerive;
    okAv(broken.ok
         && near(M.Player.x, 9500) && near(M.Player.y, 90)
         && near(cow.x, cowBefore.x) && near(cow.y, cowBefore.y),
      `anti-vacuity: with \`derive\` not patching the source, \`execute as <mob> run tp @s ...\` `
      + `moves the PLAYER (now ${M.Player.x},${M.Player.y}) instead of the cow (still `
      + `${cow.x},${cow.y}) — proving the rebind assertion above was real`);
    // restore state for what follows
    M.Player.x = playerBefore.x; M.Player.y = playerBefore.y; M.Player.z = playerBefore.z;
  }
}

// ═══════════════ 3. nested `execute` chains ═══════════════════════════════════════════════
console.log('\n 3. nested execute: as ... at ... run execute at ... run ..., two mobs at once');
{
  mkPlayer(0, 70, 0);
  EL.clear();
  const zA = EL.spawn('zombie', 100, 64, 100);
  const zB = EL.spawn('zombie', 200, 64, 200);
  const villager = EL.spawn('villager', 300, 64, 300);
  const beforeA = zA.y, beforeB = zB.y, beforeV = villager.y;

  // `as` forks over BOTH zombies; each fork's inner `execute at @s run ...` re-reads that
  // SAME (already-rebound) entity's position — a nested `at` on top of an `as`, not a fresh one.
  const r = run('/execute as @e[type=zombie] at @s run execute at @s run tp ~ ~10 ~');
  ok(r.ok, 'the nested execute chain runs');
  ok(r.result === 2, `and forks over both zombies, not more, not fewer (result ${r.result})`);
  ok(near(zA.y, beforeA + 10) && near(zB.y, beforeB + 10),
     `both zombies rose exactly 10 — independently, from their OWN prior height (${zA.y}, ${zB.y})`);
  ok(near(villager.y, beforeV), 'the villager, never selected, did not move at all');

  // ── the same chain, but the OUTER `at` uses one mob's frame and the INNER selects a
  // DIFFERENT single mob by name — proving each `as`/`at` clause binds independently and the
  // inner one is not left over from the outer ─────────────────────────────────────────────
  zA.x = 400; zA.y = 64; zA.z = 400;
  villager.x = 410; villager.y = 64; villager.z = 410;
  const r2 = run('/execute as @e[type=zombie,limit=1] at @s run execute as @e[type=villager] at @s run tp @s ~ ~7 ~');
  ok(r2.ok && r2.result === 1, 'as zombie(limit 1) -> as villager -> tp @s runs, one source through both forks');
  ok(near(villager.y, 71), `the VILLAGER (the inner selector) rose 7 (now y=${villager.y})`);
  ok(near(zA.y, 64), `the zombie (only the OUTER selector, never what the innermost run executed as) did not move (y=${zA.y})`);
}

// ══════════════ 4. entity selectors broadly: type + distance + limit, mixed scene ═══════════
console.log('\n 4. @e[type=...,distance=...,limit=...] against a mixed-mob scene');
{
  mkPlayer(0, 70, 0);
  EL.clear();
  // distances from the player, by construction: zA=3, zB=6, cow=3, skel=12, creeper=20
  const zA = EL.spawn('zombie', 3, 70, 0);
  const zB = EL.spawn('zombie', 6, 70, 0);
  const cow = EL.spawn('cow', 0, 70, 3);
  const skel = EL.spawn('skeleton', 12, 70, 0);
  const creeper = EL.spawn('creeper', 20, 70, 0);
  ok([zA, zB, cow, skel, creeper].every(Boolean), 'a five-mob mixed scene spawns');
  const count = (sel) => { const r = run(`/execute as ${sel} run seed`); ok(r.ok, `${sel} parses and runs`); return r.result; };

  ok(count('@e[type=zombie]') === 2, 'type= alone: exactly the two zombies');
  ok(count('@e[type=cow]') === 1, 'type= alone: exactly the one cow');
  ok(count('@e[type=zombie,distance=5]') === 1, 'type= AND distance=: only the nearer zombie (dist 3), not the farther (dist 6)');
  ok(count('@e[type=zombie,distance=7]') === 2, 'type= AND distance=: both zombies once the radius covers dist 6');
  ok(count('@e[distance=10]') === 4, 'distance= alone: player(0) + zA(3) + cow(3) + zB(6), not skeleton(12) or creeper(20)');
  ok(count('@e[distance=25]') === 6, 'distance= wide enough: all five mobs plus the player');
  const lim = count('@e[distance=25,limit=2]');
  ok(lim === 2, `distance= AND limit=: capped to exactly 2 regardless of how many matched distance alone (got ${lim})`);
  ok(count('@e[type=!zombie]') === 4, 'negated type=: player + cow + skeleton + creeper, the two zombies excluded');
  ok(count('@e[type=zombie,limit=1]') === 1, 'type= AND limit=1: exactly one of the two zombies');

  // ── anti-vacuity: with the mixed scene cleared, every one of these selectors is vacuous —
  // proving the counts above depended on the scene actually being there ──────────────────
  EL.clear();
  const gone = run('/execute as @e[type=zombie] run seed');
  okAv(gone.ok && gone.result === 0, 'anti-vacuity: with the scene cleared, @e[type=zombie] matches nothing');
  const player = run('/execute as @e[distance=1] run seed');
  okAv(player.ok && player.result === 1, 'anti-vacuity: and only the player (distance 0) remains in @e at all');
}

// ═══════════════ report ════════════════════════════════════════════════════════════════════
console.log('\n' + '='.repeat(78));
console.log(` mobcmdexeccheck: ${pass} assertions, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('   x ' + f);
  process.exit(1);
}
console.log(' /teleport, /tp and /execute as/at resolve real mobs, and entity selectors mean what they say.');
