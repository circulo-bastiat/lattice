#!/usr/bin/env node
// worldcheck.mjs — the world TICKING, in a real browser, in the real game.
//
//   node tools/worldcheck.mjs [dist/mclite.html]
//   MCLITE_PRESET=medium node tools/worldcheck.mjs
//
// ⚠⚠ WHY THIS IS A BROWSER STAGE, AND WHY IT IS THE MOST IMPORTANT ONE WRITTEN IN SESSION 9.
// `Behave.tick` — which drains the scheduled-tick queue — was **never called by any build**
// (D-301). Water never spread past its first update, fire never burnt out, no furnace ever
// smelted, and G15's torches and pistons would have started and frozen. Every one of those
// systems has a check with hundreds of honest assertions, and **every one of those checks drives
// the tick itself** — `redcheck.runTicks`, `pistoncheck.ticks`, `behavcheck`'s own loop. Each
// proves the RULE. Not one proves the GAME runs it.
//
// `tickcheck` asks the question structurally, of the shipped bundle. This file asks it the only
// other way there is: **play**. It boots the real page, puts things in the real world, lets the
// real loop run, and looks at what happened. Every assertion here is a BEFORE/AFTER across real
// elapsed time — never "the water is there", always "the water is somewhere it was not".
//
// ⚠ AND THE FIX MADE SOMETHING POSSIBLE THAT WAS NOT POSSIBLE BEFORE: a runaway. A queue nothing
// drains cannot overflow. §6 watches for one.

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
  console.log('worldcheck: SKIP — no Chromium on this machine (cdp.mjs found none)');
  process.exit(0);
}

console.log('worldcheck — does the WORLD tick, in the game? (D-301)');

try {
  await sleep(1500);
  await s.evaluate(() => { if (MCL && MCL.Main && !MCL.Main.ready) MCL.Main.play(9161); return 1; });
  const up = await s.waitFor(() => (MCL.Hud && MCL.Hud.mode === 'game' && MCL.Player
    && MCL.Behave && MCL.Behave.ready) ? 1 : 0, 90000);
  if (!ok(!!up, 'the world came up')) throw new Error('no world');
  await sleep(4000);

  // A flat working platform well above the terrain, so nothing generated interferes.
  const setup = await s.evaluate(() => {
    window.__wc = {};
    const M = window.MCL, W = M.World, P = M.Player, S = M.States;
    const y = Math.floor(P.y) + 30;
    const x0 = Math.floor(P.x), z0 = Math.floor(P.z);
    const put = (dx, dy, dz, name) => {
      W.setBlock(x0 + dx, y + dy, z0 + dz, name === null ? 0 : S.stateOf(name));
    };
    // a 24 x 12 stone floor
    for (let dx = -4; dx < 20; dx++) for (let dz = -6; dz < 6; dz++) put(dx, -1, dz, 'stone');
    for (let dx = -4; dx < 20; dx++) for (let dz = -6; dz < 6; dz++) put(dx, 0, dz, null);
    window.__wc.o = { x0, y, z0 };
    return { x0, y, z0, gameTime: M.Behave.gameTime, scheduled: M.Behave.scheduled() };
  });
  ok(setup.y > 0, `a stone platform at y=${setup.y}`);

  // ── 1. water spreads ────────────────────────────────────────────────────────────────────
  console.log('\n1. water spreads — the thing a dead scheduler stopped');
  {
    const start = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States, B = M.Behave;
      W.setBlock(o.x0, o.y, o.z0, S.stateOf('water'));
      B.changed(o.x0, o.y, o.z0);
      const wet = (r) => {
        let n = 0;
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
          const st = W.getBlock(o.x0 + dx, o.y, o.z0 + dz);
          if (st !== 0 && M.Reg.names[S.block[st]].indexOf('water') >= 0) n++;
        }
        return n;
      };
      return { wet1: wet(4), scheduled: B.scheduled(), gameTime: B.gameTime };
    });
    ok(start.wet1 >= 1, `the source is placed (${start.wet1} water cells)`);
    // ⚠ TIME IS THE WHOLE POINT. Vanilla's water schedules itself five ticks out and spreads one
    // ring at a time; a single `Behave.changed` cannot produce more than the source.
    await sleep(6000);
    const after = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States;
      let n = 0, maxR = 0;
      for (let dx = -6; dx <= 6; dx++) for (let dz = -6; dz <= 6; dz++) {
        const st = W.getBlock(o.x0 + dx, o.y, o.z0 + dz);
        if (st !== 0 && M.Reg.names[S.block[st]].indexOf('water') >= 0) {
          n++;
          maxR = Math.max(maxR, Math.abs(dx) + Math.abs(dz));
        }
      }
      return { n, maxR, gameTime: M.Behave.gameTime, scheduled: M.Behave.scheduled() };
    });
    ok(after.gameTime > start.gameTime + 50,
       `the world clock advanced ${start.gameTime} -> ${after.gameTime} while we waited`);
    ok(after.n > start.wet1,
       `the water SPREAD: ${start.wet1} cell(s) became ${after.n} — this could not happen before today`);
    ok(after.maxR >= 2, `and it reached ${after.maxR} blocks from the source`);
  }

  // ── 2. fire goes out ────────────────────────────────────────────────────────────────────
  console.log('\n2. fire on bare stone burns out');
  {
    const lit = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States, B = M.Behave;
      W.setBlock(o.x0 + 10, o.y, o.z0 + 3, S.stateOf('fire'));
      B.changed(o.x0 + 10, o.y, o.z0 + 3);
      return { present: W.getBlock(o.x0 + 10, o.y, o.z0 + 3) !== 0, scheduled: B.scheduled() };
    });
    ok(lit.present, 'a fire is lit on stone with nothing burnable near it');
    ok(lit.scheduled > 0, `and it scheduled itself (${lit.scheduled} ticks queued)`);
    // ⚠ FIRE RE-SCHEDULES ITSELF EVERY 30..39 TICKS AND AGES ONE STEP AT A TIME, so this needs
    // real seconds. A dead scheduler leaves it burning for ever, which is what every build did.
    await sleep(20000);
    const later = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States;
      const st = W.getBlock(o.x0 + 10, o.y, o.z0 + 3);
      return { gone: st === 0, name: st === 0 ? 'air' : M.Reg.names[S.block[st]],
               age: st === 0 ? -1 : (M.Behave.propName(st, 'age') | 0) };
    });
    ok(later.gone || later.age > 0,
       `twenty seconds later the fire is ${later.gone ? 'out' : 'aged to ' + later.age} — it is being ticked`);
  }

  // ── 3. a redstone torch inverts, in the game ────────────────────────────────────────────
  console.log('\n3. a redstone torch flips — G15a, in the real loop');
  {
    const built = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States, B = M.Behave, Rs = M.Redstone;
      const X = o.x0 + 14, Y = o.y, Z = o.z0 - 3;
      const put = (dx, dy, dz, name, props) => {
        let st = S.stateOf(name);
        for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]);
        W.setBlock(X + dx, Y + dy, Z + dz, st);
        B.changed(X + dx, Y + dy, Z + dz);
      };
      for (let dx = -2; dx <= 4; dx++) put(dx, -1, 0, 'stone');
      put(0, 0, 0, 'stone');
      put(1, 0, 0, 'redstone_wall_torch', { facing: 'east' });
      put(2, 0, 0, 'redstone_wire');
      put(3, 0, 0, 'redstone_lamp');
      const lit = Rs.boolProp(W.getBlock(X + 1, Y, Z), 'lit');
      window.__wc.t = { X, Y, Z };
      return { X, Y, Z, lit, power: Rs.powerOf(W.getBlock(X + 2, Y, Z)),
               lamp: Rs.boolProp(W.getBlock(X + 3, Y, Z), 'lit') };
    });
    ok(built.lit === true, 'the torch is lit with no input');
    ok(built.power === 15, `its wire reads ${built.power}`);
    ok(built.lamp === true, 'and the lamp beyond it is on');

    // power the torch's block, and it must go OUT — two ticks later, by the scheduler
    const off = await s.evaluate(() => {
      const b = window.__wc.t;
      const M = window.MCL, W = M.World, S = M.States, B = M.Behave;
      W.setBlock(b.X - 1, b.Y, b.Z, S.stateOf('redstone_block'));
      B.changed(b.X - 1, b.Y, b.Z);
      return { immediately: M.Redstone.boolProp(W.getBlock(b.X + 1, b.Y, b.Z), 'lit'),
               scheduled: B.scheduled() };
    });
    ok(off.immediately === true, 'the torch is STILL lit in the tick its input arrives — it scheduled');
    await sleep(2000);
    const settled = await s.evaluate(() => {
      const b = window.__wc.t;
      const M = window.MCL, W = M.World;
      return { lit: M.Redstone.boolProp(W.getBlock(b.X + 1, b.Y, b.Z), 'lit'),
               power: M.Redstone.powerOf(W.getBlock(b.X + 2, b.Y, b.Z)),
               lamp: M.Redstone.boolProp(W.getBlock(b.X + 3, b.Y, b.Z), 'lit') };
    });
    ok(settled.lit === false, 'and two seconds later the GAME flipped it out');
    ok(settled.power === 0 && settled.lamp === false, 'the wire died and the lamp went dark with it');
  }

  // ── 4. a piston finishes moving ─────────────────────────────────────────────────────────
  console.log('\n4. a piston completes its move — G15c, in the real loop');
  {
    const fired = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States, B = M.Behave;
      const X = o.x0 + 14, Y = o.y, Z = o.z0 + 3;
      const put = (dx, dy, dz, name, props) => {
        let st = S.stateOf(name);
        for (const k of Object.keys(props || {})) st = B.setProp(st, k, props[k]);
        W.setBlock(X + dx, Y + dy, Z + dz, st);
        B.changed(X + dx, Y + dy, Z + dz);
      };
      for (let dx = -2; dx <= 4; dx++) put(dx, -1, 0, 'stone');
      put(0, 0, 0, 'piston', { facing: 'east' });
      put(1, 0, 0, 'stone');
      put(-1, 0, 0, 'redstone_block');
      const nameAt = (dx) => {
        const st = W.getBlock(X + dx, Y, Z);
        return st === 0 ? 'air' : M.Reg.names[S.block[st]];
      };
      window.__wc.p = { X, Y, Z };
      return { X, Y, Z, row: [nameAt(0), nameAt(1), nameAt(2)].join(' '),
               extended: B.propName(W.getBlock(X, Y, Z), 'extended') };
    });
    ok(fired.extended === 'true', 'the piston fired the moment the redstone block appeared');
    ok(fired.row.indexOf('moving_piston') >= 0,
       `and the cells hold the placeholder mid-flight: ${fired.row}`);
    // ⚠ AND THE BLOCK HAS TO LAND. `PistonMovingBlockEntity` advances by 0.5 a tick from the
    // BLOCK-ENTITY loop, so a build that never ticked block entities would leave this frozen as
    // `moving_piston` for ever — a visible, permanent wound in the world.
    await sleep(2000);
    const landed = await s.evaluate(() => {
      const b = window.__wc.p;
      const M = window.MCL, W = M.World, S = M.States;
      const nameAt = (dx) => {
        const st = W.getBlock(b.X + dx, b.Y, b.Z);
        return st === 0 ? 'air' : M.Reg.names[S.block[st]];
      };
      return [nameAt(0), nameAt(1), nameAt(2)].join(' ');
    });
    ok(landed === 'piston piston_head stone',
       `two seconds later the block has LANDED: ${landed}`);
  }

  // ── 5. a furnace smelts, for the first time in this project's life ──────────────────────
  console.log('\n5. a furnace smelts — D-289 finally proven in the GAME');
  {
    const started = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States, B = M.Behave, BE = M.BlockEntities;
      const X = o.x0 + 18, Y = o.y, Z = o.z0;
      W.setBlock(X, Y - 1, Z, S.stateOf('stone'));
      W.setBlock(X, Y, Z, B.setProp(S.stateOf('furnace'), 'facing', 'north'));
      B.changed(X, Y, Z);
      const e = BE.get(X, Y, Z);
      if (!e) { window.__wc.f = { X, Y, Z }; return { X, Y, Z, made: false }; }
      e.items[0] = M.Inventory.stack('raw_iron', 8);
      e.items[1] = M.Inventory.stack('coal', 4);
      window.__wc.f = { X, Y, Z };
      return { X, Y, Z, made: true, burn: e.burnTime | 0, cook: e.cookTime | 0,
               out: e.items[2] ? e.items[2].n : 0 };
    });
    ok(started.made === true, 'the furnace has a block entity, created by `Behave.changed`');
    ok(started.burn === 0 && started.out === 0, 'and it starts cold and empty');

    // ⚠⚠ **THIS USED TO BE `await sleep(14000)` AND IT MEASURED THE BOX, NOT THE GAME.** Smelting
    // one item is 200 TICKS. At a clean 20 Hz that is ten seconds and fourteen is a comfortable
    // margin — but the tick loop is frame-driven, and on a loaded two-core machine the page can
    // sit at twelve or thirteen ticks a second, which turns fourteen seconds into a hundred and
    // seventy ticks and reports **"it has eaten 0 of the eight raw iron"**. That is a correct
    // furnace failing a stopwatch. A check that can go red because the host is busy is a check
    // that will be ignored the third time it does it.
    //
    // ⚠ SO IT WAITS ON `Main.ticks`, WHICH IS THE THING THE FURNACE ACTUALLY RUNS ON, and the
    // wall-clock cap is still there — but when the cap is what ends the wait, the failure says
    // the HOST was too slow instead of blaming the smelter.
    const NEED = 240;                         // 200 to smelt + a margin for the first fuel tick
    const t0 = await s.evaluate(() => window.MCL.Main.ticks | 0);
    const started_ms = Date.now();
    let ran = 0;
    while (ran < NEED && Date.now() - started_ms < 60000) {
      await sleep(1000);
      ran = (await s.evaluate(() => window.MCL.Main.ticks | 0)) - t0;
    }
    const secs = ((Date.now() - started_ms) / 1000).toFixed(1);
    console.log(`   the world ran ${ran} ticks in ${secs} s (${(ran / secs).toFixed(1)} Hz)`);
    ok(ran >= NEED, `the world ran the ${NEED} ticks a smelt needs (got ${ran} in ${secs} s) — ` +
       'if this is the only failure here, the HOST was too slow, not the furnace');
    const cooked = await s.evaluate(() => {
      const f = window.__wc.f;
      const M = window.MCL, BE = M.BlockEntities;
      const e = BE.get(f.X, f.Y, f.Z);
      return e ? { burn: e.burnTime | 0, cook: e.cookTime | 0,
                   out: e.items[2] ? e.items[2].n : 0,
                   input: e.items[0] ? e.items[0].n : 0 } : null;
    });
    ok(cooked !== null, 'the entity survived');
    ok(cooked && cooked.burn > 0, `the fuel is burning (${cooked && cooked.burn} ticks left)`);
    ok(cooked && cooked.input < 8, `it has eaten ${cooked ? 8 - cooked.input : 0} of the eight raw iron`);
    ok(cooked && cooked.out > 0,
       `and there are ${cooked && cooked.out} ingots in the output slot — no build before today could produce one`);
  }

  // ── 5b. an ENTITY falls, in the running game ────────────────────────────────────────────
  // ⚠ WHY THIS IS HERE AND NOT IN `entlistcheck`. That file drives `EntityList.tick()` ITSELF,
  // which is honest about the ARITHMETIC and proves nothing about the GAME — it is the exact
  // shape of D-301, where `redcheck` and `behavcheck` were green across a world that never
  // ticked because each one drove the tick by hand. `tickcheck` proves `Main.worldTick` can
  // reach `EntityList.tick`; only this proves an entity actually moves when nobody pushes it.
  console.log('\n5b. an entity falls because the GAME ticked it (D-308)');
  {
    const spawned = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States, EL = M.EntityList;
      if (!EL || !EL.ready) return { ready: false };
      const X = o.x0 + 24, Y = o.y, Z = o.z0;
      // a floor to land on, and clear air above it
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        W.setBlock(X + dx, Y - 1, Z + dz, S.stateOf('stone'));
        for (let dy = 0; dy < 12; dy++) W.setBlock(X + dx, Y + dy, Z + dz, 0);
      }
      const e = EL.spawn('falling_block', X + 0.5, Y + 10, Z + 0.5);
      if (!e) return { ready: true, spawned: false };
      window.__wc.e = e.id;
      return { ready: true, spawned: true, y0: e.y, count: EL.count(),
               canSpawn: EL.spawnable().length, owed: EL.owed().length };
    });
    ok(spawned.ready === true, 'EntityList is ready in the running game');
    ok(spawned.spawned === true, 'a falling_block spawned');
    if (spawned.spawned) {
      console.log(`   spawned at y ${spawned.y0}; ${spawned.canSpawn} types spawnable, ${spawned.owed} owed`);
      // ⚠ NOBODY TOUCHES IT. The only thing that moves it is `Main.worldTick`.
      await sleep(3000);
      const after = await s.evaluate(() => {
        const M = window.MCL, EL = M.EntityList;
        const e = EL.byId(window.__wc.e);
        return e ? { y: e.y, onGround: e.onGround, age: e.age, vy: e.vy } : null;
      });
      ok(after !== null, 'the entity is still in the list');
      ok(after && after.age > 30, `it was ticked ${after && after.age} times by the game loop`);
      ok(after && after.y < spawned.y0 - 5, `it fell from ${spawned.y0} to ${after && after.y.toFixed(3)}`);
      ok(after && after.onGround === true, 'and it is standing on the floor');
      // ⚠ THE DECISIVE ONE. Take `EntityList.tick` out of the world tick and a NEW entity must
      // sit still — the same experiment §7 runs for the water, at the scale of the new stage.
      const experiment = await s.evaluate(() => {
        const o = window.__wc.o;
        const M = window.MCL, EL = M.EntityList;
        const X = o.x0 + 24, Y = o.y, Z = o.z0;
        M.__realEL = EL.tick;
        EL.tick = function () { return 0; };
        const e = EL.spawn('falling_block', X + 0.5, Y + 10, Z + 0.5);
        window.__wc.e2 = e ? e.id : 0;
        return e ? e.y : null;
      });
      await sleep(2500);
      const still = await s.evaluate(() => {
        const e = MCL.EntityList.byId(window.__wc.e2);
        return e ? { y: e.y, age: e.age } : null;
      });
      await s.evaluate(() => { MCL.EntityList.tick = MCL.__realEL; return 1; });
      await sleep(2500);
      const moving = await s.evaluate(() => {
        const e = MCL.EntityList.byId(window.__wc.e2);
        return e ? { y: e.y, age: e.age } : null;
      });
      okAv(still && still.age === 0 && still.y === experiment,
        `with EntityList.tick removed the block sat at y ${still && still.y} for 50 ticks, age ${still && still.age}`);
      okAv(moving && moving.age > 20 && moving.y < experiment - 1,
        `...and it fell to ${moving && moving.y.toFixed(3)} when the tick was put back`);
    }
  }

  // ── 6. nothing ran away ─────────────────────────────────────────────────────────────────
  console.log('\n6. and none of it ran away');
  {
    const st = await s.evaluate(() => ({
      scheduled: MCL.Behave.scheduled(),
      gameTime: MCL.Behave.gameTime,
      ticks: MCL.Main.ticks,
      entities: MCL.BlockEntities.count(),
      dayTime: MCL.Sky.dayTime
    }));
    // ⚠ A QUEUE NOTHING DRAINS CANNOT OVERFLOW. Making the world tick is what made a runaway
    // possible at all, so this is the first build in which the question is worth asking.
    ok(st.scheduled < 20000, `the scheduled-tick queue holds ${st.scheduled} entries, which is bounded`);
    ok(st.gameTime > 500, `the world clock reached ${st.gameTime}`);
    ok(Math.abs(st.gameTime - st.ticks) < st.ticks * 0.05,
       `and it kept step with the loop (${st.gameTime} world, ${st.ticks} loop)`);
    ok(st.dayTime > 1000, `the sky clock reached ${st.dayTime}`);
    ok(st.entities >= 1 && st.entities < 500, `${st.entities} block entities exist, which is plausible`);
  }

  // ── 7. anti-vacuity ─────────────────────────────────────────────────────────────────────
  console.log('\n7. anti-vacuity');
  {
    // ⚠ THE DECISIVE ONE: freeze the world clock and the same water does NOT spread. That is
    // the experiment that separates "the rule works" from "the game runs the rule", and it is
    // the whole reason this file exists.
    const frozen = await s.evaluate(() => {
      const o = window.__wc.o;
      const M = window.MCL, W = M.World, S = M.States, B = M.Behave;
      const X = o.x0 + 6, Y = o.y, Z = o.z0 + 4;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        W.setBlock(X + dx, Y - 1, Z + dz, S.stateOf('stone'));
        W.setBlock(X + dx, Y, Z + dz, 0);
      }
      // ⚠ stop the WORLD tick only — the loop, the renderer and the player keep running, so
      // this is the same page in the same frame loop with one call removed.
      M.__realWorldTick = M.Main.worldTick;
      M.Main.worldTick = function () {};
      W.setBlock(X, Y, Z, S.stateOf('water'));
      B.changed(X, Y, Z);
      let n = 0;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const st = W.getBlock(X + dx, Y, Z + dz);
        if (st !== 0 && M.Reg.names[S.block[st]].indexOf('water') >= 0) n++;
      }
      window.__wc.z = { X, Y, Z };
      return { X, Y, Z, n0: n, gameTime: B.gameTime };
    });
    await sleep(5000);
    const still = await s.evaluate(() => {
      const f = window.__wc.z;
      const M = window.MCL, W = M.World, S = M.States;
      let n = 0;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const st = W.getBlock(f.X + dx, f.Y, f.Z + dz);
        if (st !== 0 && M.Reg.names[S.block[st]].indexOf('water') >= 0) n++;
      }
      // put it back, so nothing after this runs in a frozen world
      M.Main.worldTick = M.__realWorldTick;
      return { n, gameTime: M.Behave.gameTime, frames: M.Main.frame };
    });
    okAv(still.gameTime === frozen.gameTime && still.n === frozen.n0,
      `with the world tick removed the clock stayed at ${still.gameTime} and the water stayed at `
      + `${still.n} cell(s) for five seconds — which is what every build before today did`);
    await sleep(3000);
    const thawed = await s.evaluate(() => {
      const f = window.__wc.z;
      const M = window.MCL, W = M.World, S = M.States;
      let n = 0;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const st = W.getBlock(f.X + dx, f.Y, f.Z + dz);
        if (st !== 0 && M.Reg.names[S.block[st]].indexOf('water') >= 0) n++;
      }
      return { n, gameTime: M.Behave.gameTime };
    });
    okAv(thawed.gameTime > still.gameTime && thawed.n > still.n,
      `and putting it back made the SAME water spread to ${thawed.n} cells — the difference is one call`);
  }

  const errs = s.problems || [];
  ok(errs.length === 0, 'the page logged no errors (' + errs.slice(0, 3).join(' | ') + ')');
} finally {
  await s.close();
}

console.log('');
console.log('================ worldcheck ===============');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails.slice(0, 20)) console.log('   ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
console.log('==========================================');
process.exit(fails.length ? 1 : 0);
