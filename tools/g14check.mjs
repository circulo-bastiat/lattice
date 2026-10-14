#!/usr/bin/env node
// g14check.mjs — PLAN G14, the half a headless test cannot see: A REAL RELOAD.
//
//   node tools/g14check.mjs [dist/mclite.html]
//   MCLITE_PRESET=medium node tools/g14check.mjs
//
// ⚠ WHY THIS IS A BROWSER STAGE, WHEN `savecheck` HAS 172 ASSERTIONS. Every one of those calls
// `toJSON` and `fromJSON` directly, on objects the check itself built. None of them goes through
// the thing that actually has to work: a player who plays, closes the tab, and comes back. That
// path crosses `localStorage` on a `file://` origin, a real page teardown, a fresh boot, the
// title screen's Continue, and the order in which `Main` calls `Save.load` against `Reg.init` —
// and every one of those is a place a save can be written perfectly and never read.
//
// ⚠ AND IT IS THE FAILURE THIS STAGE EXISTS FOR. G14's bug was not a broken format; it was a
// format that did not contain the game (D-288). `Player.toJSON` wrote nine block states while
// the player owned 41 slots of item stacks, and the pickaxe saved as air. A check that calls
// `toJSON` and reads back what it wrote cannot see that class of thing at all — only playing
// can, so this file plays: it fills the inventory, damages a tool, takes damage, banks
// experience, breaks a block, reloads the browser, and asks whether any of it survived.
//
// Every assertion is a COMPARISON ACROSS THE RELOAD, never a threshold. "The player has some
// items" passes on a fresh world; "the player has exactly the items they had before the reload,
// with the same counts and the same damage" cannot.

import { open, sleep } from './cdp.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = process.argv[2] || join(ROOT, 'dist', 'mclite.html');

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) { pass++; console.log('ok    ' + m); } else { fails.push(m); console.log('FAIL  ' + m); } return c; };
const okAv = (c, m) => { breaks++; if (c) { pass++; console.log('   ✓ ' + m); } else { fails.push('anti-vacuity: ' + m); console.log('   ✗ ' + m); } };

const s = await open(FILE, { width: 1024, height: 640 });
if (!s) {
  console.log('g14check: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}

console.log('g14check — PLAN G14, the save across a real browser reload (D-288, D-289)');

try {
  await sleep(1500);
  await s.evaluate(() => { if (MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play(4242); return 1; });
  const up = await s.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Player
    && MCL.Save && MCL.Inventory) ? 1 : 0, 90000);
  if (!ok(!!up, 'the world came up')) throw new Error('no world');
  await sleep(4000);

  // ── 1. play: fill the inventory, wear a tool down, take damage, earn levels, dig a hole ──
  console.log('\n1. play a little, then save');
  const before = await s.evaluate(() => {
    const M = window.MCL, P = M.Player, Iv = M.Inventory, IT = M.Items, Sv = M.Survival;
    const r = {};
    r.storage = M.Save.backend;

    // ⚠ THE STOCK IS DELIBERATELY NOT ALL BLOCKS. A tool, a food and an armour piece are the
    // three things the old format could not express at all: `Items.stateOf` is −1 for each, and
    // the v3 writer turned that into state 0, which is air.
    const STOCK = [
      [0,  'diamond_pickaxe', 1,  137],
      [1,  'cobblestone',     64, 0],
      [3,  'bread',           5,  0],
      [20, 'golden_apple',    2,  0],     // outside the hotbar entirely
      [35, 'oak_log',         13, 0],     // the last main slot
      [36, 'iron_boots',      1,  9],     // armour
      [40, 'stick',           17, 0],     // the offhand, vanilla's slot 40
    ];
    for (const [slot, name, n, d] of STOCK) Iv.setItem(P.inventory, slot, Iv.stack(name, n, d));
    P.syncHotbar();
    P.selectSlot(1);

    // survival state that a fresh world would never have
    P.mode = M.Gamemode ? M.Gamemode.SURVIVAL : P.mode;
    if (M.Gamemode) M.Gamemode.set(P, M.Gamemode.SURVIVAL);
    Sv.init(P);
    P.health = 11.5; P.food = 8; P.saturation = 1.5; P.exhaustion = 2.25;
    P.xpLevel = 17; P.xpProgress = 0.25; P.xpTotal = 400;

    // and a real edit to the world, so the block half is proved on the same run
    P.pitch = -1.35; P.interpolate(1); P.retarget();
    r.hasTarget = !!P.hasTarget;
    if (P.hasTarget) {
      r.hole = [P.tx, P.ty, P.tz];
      localStorage.setItem('mclite.g14hole', JSON.stringify(r.hole));
      P.breakBlock();
    }

    r.stock = STOCK;
    r.slots = STOCK.map(([slot]) => {
      const st = Iv.getItem(P.inventory, slot);
      return st ? [slot, IT.nameOf(st.i), st.n, st.d] : [slot, null, 0, 0];
    });
    r.sv = { health: P.health, food: P.food, saturation: P.saturation,
             exhaustion: P.exhaustion, xpLevel: P.xpLevel, xpProgress: P.xpProgress,
             xpTotal: P.xpTotal };
    r.pos = [P.x, P.y, P.z];
    r.selected = P.slot;
    r.version = M.Save.VERSION;
    r.dataVersion = M.Save.DATA_VERSION;
    r.saved = M.Save.save(false);
    const raw = localStorage.getItem(M.Save.KEY);
    r.bytes = raw ? raw.length : 0;
    const env = raw ? JSON.parse(raw) : null;
    r.envVersion = env ? env.v : -1;
    r.writesVersion = M.Save.VERSION;
    r.envHasInv = !!(env && env.player && env.player.inv);
    r.envHasSv = !!(env && env.player && env.player.sv);
    // ⚠ the wire form must name ITEMS, not number them
    r.envSlot0 = env && env.player && env.player.inv ? env.player.inv.slots[0] : null;
    return r;
  });
  if (!before) throw new Error('phase 1 returned nothing');

  ok(before.storage === 'localStorage', `storage is ${before.storage}`);
  ok(before.saved === true, 'save() wrote');
  // ⚠ AGAINST `Save.VERSION`, NOT A LITERAL. G16a bumped the envelope to v5 for the sky's clock
  // (D-300) and this line said 4, so a correct save failed a browser stage. A check that
  // hard-codes a number the code owns is a check that has to be edited every time the code is
  // right — the same shape as asserting a remembered constant (D-263).
  ok(before.envVersion === before.writesVersion,
     `the envelope on disk says v${before.envVersion}, and Save.VERSION is v${before.writesVersion}`);
  ok(before.dataVersion === 3, `and the blob still says v${before.dataVersion} — the two versions are separate`);
  ok(before.envHasInv, 'the saved player carries an `inv` block');
  ok(before.envHasSv, 'and an `sv` block');
  ok(before.envSlot0 && before.envSlot0.n === 'diamond_pickaxe',
     `slot 0 is written as the NAME "${before.envSlot0 && before.envSlot0.n}", not a number`);
  ok(before.envSlot0 && before.envSlot0.d === 137,
     `and carries its damage (${before.envSlot0 && before.envSlot0.d})`);
  ok(before.hasTarget && !!before.hole, 'a block was broken, so the world half is under test too');
  console.log(`      saved ${(before.bytes / 1024).toFixed(1)} KB · ${before.slots.length} stocked slots · `
    + `${before.sv.health} hearts-worth, level ${before.sv.xpLevel}`);

  // ── 2. the reload. A real teardown, a real boot, the same button a returning player presses ──
  console.log('\n2. reload the whole page, then Continue');
  await s.send('Page.reload', { ignoreCache: false });
  await sleep(2000);
  // D-543: the single-file page is ~13 MB now; a fixed 2 s was shorter than its parse on the
  // lane, so the page was simply not there yet ('no MCL'). Wait for the namespace to exist.
  await s.waitFor(() => (window.MCL && MCL.Main) ? 1 : 0, 60000);
  const booted = await s.evaluate(() => {
    const M = window.MCL;
    if (!M || !M.Main) return 'no MCL';
    if (M.Main.ready) return 'already running';
    M.Main.play({});
    return 'play() called';
  });
  console.log('      title: ' + booted);
  const up2 = await s.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Player
    && MCL.Main.ready) ? 1 : 0, 90000);
  ok(!!up2, 'it boots again and reaches the game');
  await sleep(3000);

  // ── 3. what came back ───────────────────────────────────────────────────────────────────
  console.log('\n3. what survived');
  const after = await s.evaluate(() => {
    const M = window.MCL, P = M.Player, Iv = M.Inventory, IT = M.Items, W = M.World;
    const hole = JSON.parse(localStorage.getItem('mclite.g14hole') || 'null');
    const r = {};
    r.loaded = !!M.Save.loaded;
    r.loadedVersion = M.Save.loadedVersion;
    r.writesVersion = M.Save.VERSION;
    r.slots = [0, 1, 3, 20, 35, 36, 40].map((slot) => {
      const st = Iv.getItem(P.inventory, slot);
      return st ? [slot, IT.nameOf(st.i), st.n, st.d] : [slot, null, 0, 0];
    });
    r.sv = { health: P.health, food: P.food, saturation: P.saturation,
             exhaustion: P.exhaustion, xpLevel: P.xpLevel, xpProgress: P.xpProgress,
             xpTotal: P.xpTotal };
    r.pos = [P.x, P.y, P.z];
    r.selected = P.slot;
    // ⚠ the hotbar is a VIEW; after a load it must be rebuilt from the inventory or the world
    // shows the blocks the LAST session was holding.
    var held = Iv.getItem(P.inventory, 1);
    var want = held ? IT.stateOf(held.i) : -1;
    r.hotbarSynced = P.hotbar[1] === (want >= 0 ? want : 0);
    r.hotbarState = P.hotbar[1];
    r.editKept = hole ? W.getBlock(hole[0], hole[1], hole[2]) === 0 : null;
    r.fatal = (document.getElementById('fatal') || {}).textContent || '';
    return r;
  });
  if (!after) throw new Error('phase 3 returned nothing');

  ok(after.loaded === true, 'the save file was found and parsed');
  ok(after.loadedVersion === after.writesVersion, `it read v${after.loadedVersion}`);
  ok(after.editKept === true, 'the block that was broken is still broken — the world half survived too');
  ok(!after.fatal, 'no fatal screen after the reload' + (after.fatal ? ': ' + after.fatal : ''));

  // ⚠ THE ASSERTION THIS WHOLE FILE EXISTS FOR: every slot, by name, count AND damage.
  const bySlot = new Map(before.slots.map((r) => [r[0], r]));
  let sameSlots = 0;
  for (const [slot, name, n, d] of after.slots) {
    const was = bySlot.get(slot);
    const same = was && was[1] === name && was[2] === n && was[3] === d;
    if (same) sameSlots++;
    ok(!!same, `slot ${slot}: ${was && was[1]} x${was && was[2]} dmg ${was && was[3]} -> ${name} x${n} dmg ${d}`);
  }
  ok(sameSlots === before.slots.length, `${sameSlots}/${before.slots.length} slots came back identical`);
  ok(after.selected === before.selected, `the selected slot ${before.selected} -> ${after.selected}`);
  ok(after.hotbarSynced, 'and the hotbar VIEW was rebuilt from the inventory, not left stale');

  for (const k of Object.keys(before.sv)) {
    ok(Math.abs(after.sv[k] - before.sv[k]) < 1e-6,
       `${k}: ${before.sv[k]} -> ${after.sv[k]}`);
  }
  ok(Math.abs(after.pos[0] - before.pos[0]) < 2 && Math.abs(after.pos[2] - before.pos[2]) < 2,
     `the player came back to ${after.pos.map((v) => v.toFixed(1)).join(',')}`);

  // ── 4. anti-vacuity: the same comparisons, against a world that never loaded ─────────────
  console.log('\n4. anti-vacuity: break it, and it must be caught');
  const av = await s.evaluate(() => {
    const M = window.MCL, Iv = M.Inventory, IT = M.Items, Sv = M.Survival, P = M.Player;
    const r = {};

    // (a) a FRESH player — what every assertion above would compare against if the load had
    // silently done nothing. If a fresh world happened to hold the same items, §3 proves nothing.
    const fresh = Iv.create();
    const startNames = [];
    for (let i = 0; i < 9; i++) {
      const st = Iv.getItem(fresh, i);
      startNames.push(st ? IT.nameOf(st.i) : null);
    }
    r.freshHasPickaxe = startNames.indexOf('diamond_pickaxe') >= 0;
    r.freshSlot20 = !Iv.getItem(fresh, 20);

    // (b) THE OLD WRITER, reproduced exactly: a tool has no block state, so it saves as air.
    const pick = Iv.stack('diamond_pickaxe', 1, 137);
    const st = IT.stateOf(pick.i);
    r.toolStateIsMinusOne = (st < 0);
    r.oldWriterWouldSaveAir = (st < 0) ? 0 : st;

    // (c) the count and the damage the old format had no field for
    const wire = Iv.stackToJSON(Iv.stack('cobblestone', 64));
    r.wireHasCount = wire && wire.c === 64;
    const wornWire = Iv.stackToJSON(pick);
    r.wireHasDamage = wornWire && wornWire.d === 137;

    // (d) the clamps, in the live engine rather than in a module test
    const e = Sv.init({});
    Sv.fromJSON(e, { health: 1e9, food: NaN });
    r.clampedHealth = e.health;
    r.clampedFoodIsNumber = !Number.isNaN(e.food);

    // (e) a save whose envelope version this build cannot read must be REFUSED, not misread
    const good = localStorage.getItem(M.Save.KEY);
    const bad = JSON.parse(good); bad.v = 99;
    localStorage.setItem(M.Save.KEY, JSON.stringify(bad));
    r.refusedUnknownVersion = (M.Save.load() === false);
    localStorage.setItem(M.Save.KEY, good);
    r.acceptsItBack = (M.Save.load() === true);
    return r;
  });

  okAv(av && av.freshHasPickaxe === false,
       'a fresh inventory has no diamond pickaxe, so §3 could not have passed on a failed load');
  okAv(av && av.freshSlot20 === true,
       '...and slot 20 is empty in a new world, so the main-inventory assertion is real');
  okAv(av && av.toolStateIsMinusOne === true,
       'a diamond pickaxe has NO block state (−1) — which is how the old writer turned it into air');
  okAv(av && av.oldWriterWouldSaveAir === 0,
       '...and the old writer\'s value for it really is 0, the id of air');
  okAv(av && av.wireHasCount === true, 'the wire form carries a count of 64, which v3 had no field for');
  okAv(av && av.wireHasDamage === true, 'and a damage of 137, which v3 had no field for either');
  okAv(av && av.clampedHealth === 20, `a health of 1e9 loads as ${av && av.clampedHealth}, not as invulnerability`);
  okAv(av && av.clampedFoodIsNumber === true, 'and a NaN food level does not survive into the live player');
  okAv(av && av.refusedUnknownVersion === true, 'an envelope version this build does not know is refused');
  okAv(av && av.acceptsItBack === true, '...and putting the real save back loads it again, so the refusal is not a crash');

  const problems = (s.problems || []).filter((p) => !/favicon|ERR_FILE_NOT_FOUND/.test(p));
  ok(problems.length === 0, `the page logged no errors (${problems.slice(0, 2).join(' | ')})`);
} finally {
  if (s.close) await s.close();
}

console.log('');
console.log('================ g14check =================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('===========================================');
process.exit(fails.length ? 1 : 0);
