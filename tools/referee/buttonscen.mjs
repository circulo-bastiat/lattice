// buttonscen.mjs — BUTTON / ARROW-PRESS scenarios (infra I6, 24 Sept 2026), shared by runbutton.mjs (the real
// 1.18.2 server) and buttonrefcheck.mjs (the engine). Same clock as platescen.mjs: for k = 1..T: events for k ->
// sample -> one world tick. Probes are the button's `powered` (0/1) AND a redstone lamp facing it (0/1), so the
// signal is checked at the SOURCE and one hop downstream in one run.
//
// TWO HONEST LIMITATIONS (D-Button-1/2, see docs/archive/REFEREE.md) -- neither is guessed, both are named:
//
// D-Button-1 -- NO PLAYER. `AbstractButtonBlock.onUse` is the only vanilla entry point that presses a button by
//   hand, and only a real `PlayerEntity` right-click reaches it -- no server command invokes it. Every `press`
//   scenario therefore fakes the click the only honest way available: `setblock ...[powered=true]`, gated on
//   `execute if block ...[powered=false]` so `onUse`'s own re-entry guard ("if POWERED, return CONSUME") is
//   reproduced from the block's OWN state rather than hand-tracked -- a re-press mid-hold is a genuine no-op here
//   too, not simulated.
//
// D-Button-2 -- `PersistentProjectileEntity` NEVER CALLS `Entity.move()`. Traced in `.decomp`
//   (PersistentProjectileEntity.java: every position update is a raw `this.setPosition(...)`, never `this.move`),
//   so `Entity.checkBlockCollision()` -- which only `move()` calls (`Entity.java` `tryCheckBlockCollision()` sits
//   inside `move`'s own tail) -- is never reached for an arrow, and `AbstractButtonBlock.onEntityCollision` is
//   consequently never invoked by a `summon`ed/dispenser-fired arrow in THIS referee rig either (verified live:
//   an arrow shot straight into an oak button's face, real 1.18.2 server, never powers it in 80 ticks). Real
//   play presses wooden buttons with arrows regardless -- through some path this rig could not reproduce inside
//   its budget (most likely `RangedWeaponItem`/an actual bow-draw doing something `summon` does not) -- so
//   `wooden_button_arrow_stuck` does NOT rely on that path: it fakes the press (D-Button-1) at the arrow's
//   arrival tick, then re-derives AbstractButtonBlock.scheduledTick's wooden branch --
//   `tryPowerWithProjectiles`'s own "is a projectile still here?" recheck (AbstractButtonBlock.java:170-180) --
//   HONESTLY OURSELVES at press+30 and press+60 (`getPressTicks()`, wooden=30), each time querying the REAL,
//   GENUINELY FLYING arrow entity's presence rather than a tracked flag. Only the DISPATCH of that recheck is
//   faked; the fact it finds (or doesn't find) the arrow is the real server's own truth every time.
//
// Every OTHER arrow scenario (`stone_button_arrow_ignored`, `oak_plate_arrow`) is 100% genuine end to end: a real
// arrow, real flight, and whatever the real server's own logic decides -- nothing here dispatches for them.
export const T = 80;
const PRESS_TICKS = { wooden: 30, stone: 20 };

const arrow = (t, tag, x, y, z, vx, vy, vz) => ({ t, tag, x, y, z, vx, vy, vz });

export const SCENARIOS = [
  // ── faked player press (setblock + forced release at the decomp constant) ─────────────────
  { id: 'stone_button_press', block: 'stone_button', kind: 'stone', facing: 'north', face: 'wall',
    press: [5] },
  { id: 'wooden_button_press', block: 'oak_button', kind: 'wooden', facing: 'north', face: 'wall',
    press: [5] },
  { id: 'blackstone_button_press', block: 'polished_blackstone_button', kind: 'stone', facing: 'north', face: 'wall',
    press: [5] },
  { id: 'floor_button_press', block: 'oak_button', kind: 'wooden', facing: 'north', face: 'floor',
    press: [5] },
  { id: 'button_repress_no_reset', block: 'stone_button', kind: 'stone', facing: 'north', face: 'wall',
    press: [5, 15] },   // second press at 15, well inside the 20-tick hold -- must NOT push release past 25

  // ── the arrow-hold case (D-Button-2: press faked, the RECHECK queries a real, genuinely
  // flying-then-lodged arrow) -- the arrow arrives ~tick 8, is killed at tick 50; the recheck at
  // 35 must find it (still powered) and the recheck at 65 must not (released by then).
  // cloud relaxed-curie: NOW GENUINE END TO END. The old arrow was summoned at z-1.0 -- INSIDE the lamp -- so
  // it lodged in the lamp and never reached the button; that, not D-Button-2, is why the live test saw no
  // press (PersistentProjectileEntity.tick DOES call checkBlockCollision after its setPosition, .decomp :255).
  // Fired from inside the button's own (collision-free) cell into the wall, it lodges in the outline box.
  { id: 'wooden_button_arrow_stuck', block: 'oak_button', kind: 'wooden', facing: 'north', face: 'wall',
    arrows: [arrow(5, 'a', 0.5, 0.5, 0.1, 0, 0, 0.3)], kills: [[50, 'a']] },
  // ── genuine, entity-driven (real arrow flight; stone ignores projectiles outright, so this
  // needs no press fake at all -- onEntityCollision's own `this.wooden` guard rules it out before
  // D-Button-2 would ever matter) ──────────────────────────────────────────────────────────────
  { id: 'stone_button_arrow_ignored', block: 'stone_button', kind: 'stone', facing: 'north', face: 'wall',
    stat: true, arrows: [arrow(5, 'a', 0.5, 0.5, -1.0, 0, 0, 0.3)], kills: [] },
  { id: 'oak_plate_arrow', plate: 'oak_pressure_plate', facing: null, face: null,
    arrows: [arrow(5, 'a', 0.0, 3.0, 0.0, 0, -1.2, 0)], kills: [] },
];

/** World placement of scenario i: 10 apart along x, floor at y=-61, the button/plate face at z=136..140. */
export const origin = (i) => ({ x: 8 + 10 * i, y: -60, z: 136 });

function blockSpec(sc, powered) {
  if (sc.plate) return `minecraft:${sc.plate}${powered === undefined ? '' : `[powered=${powered}]`}`;
  const props = [`facing=${sc.facing}`, `face=${sc.face}`];
  if (powered !== undefined) props.push(`powered=${powered}`);
  return `minecraft:${sc.block}[${props.join(',')}]`;
}

export function serverPlan() {
  const setup = [], step = [], probes = [];
  const maxX = origin(SCENARIOS.length - 1).x + 10;
  setup.push(`forceload add 0 128 ${maxX} 144`);
  setup.push(`fill 0 -63 128 ${maxX} -50 144 minecraft:air`);
  setup.push(`fill 0 -61 128 ${maxX} -61 144 minecraft:stone`);
  // a wall behind each wall-mounted button (north face -> the wall sits one south, at z+1) and a
  // redstone lamp + wire on the opposite side so the probe sees a real downstream hop.
  setup.push(`kill @e[type=!player,x=0,y=-64,z=128,dx=${maxX},dy=20,dz=16]`);
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const by = sc.plate ? o.y : o.y + 1;
    if (sc.plate) {
      setup.push(`setblock ${o.x} ${o.y} ${o.z} ${blockSpec(sc, false)}`);
    } else {
      setup.push(`setblock ${o.x} ${by} ${o.z + 1} minecraft:stone`);       // the wall it's mounted on
      setup.push(`setblock ${o.x} ${by} ${o.z} ${blockSpec(sc, false)}`);
    }
    // a redstone lamp directly against the button's/plate's pressed face -- adjacent, so weak
    // power alone (AbstractButtonBlock.getWeakRedstonePower / PressurePlateBlock's own emitter)
    // is enough to light it; one hop downstream of the source the button/plate probe already is.
    setup.push(`setblock ${o.x} ${by} ${o.z - 1} minecraft:redstone_lamp`);
  });
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const by = sc.plate ? o.y : o.y + 1;
    const P = `${o.x} ${by} ${o.z}`;
    for (const t of sc.press || []) {
      // AbstractButtonBlock.onUse's own guard, reproduced with the block's own current state
      // rather than a tracked flag: a press while already powered is a genuine no-op here too.
      step.push(`execute if score #t mclr matches ${t} if block ${P} ${blockSpec(sc, false)} run setblock ${P} ${blockSpec(sc, true)}`);
    }
    if (sc.press && sc.press.length && !sc.holdcheck) {
      // the plain (no-projectile) case: AbstractButtonBlock.scheduledTick's stone branch is
      // unconditional, and its wooden branch (tryPowerWithProjectiles) finds no projectile here
      // either -- both collapse to "release at press + getPressTicks()".
      const first = sc.press[0];
      const ticks = PRESS_TICKS[sc.kind];
      const releaseAt = first + ticks;
      step.push(`execute if score #t mclr matches ${releaseAt} run setblock ${P} ${blockSpec(sc, false)}`);
    }
    for (const at of sc.holdcheck || []) {
      // AbstractButtonBlock.scheduledTick's wooden branch, driven by us (D-Button-2): still
      // powered AND no `mrb<i>a`-tagged projectile anywhere near = release; otherwise a no-op
      // (real `tryPowerWithProjectiles` would reschedule -- there's nothing to reschedule here,
      // the next `holdcheck` entry already stands in for that).
      step.push(`execute if score #t mclr matches ${at} if block ${P} ${blockSpec(sc, true)} unless entity @e[tag=mrb${i}a,x=${o.x - 2},y=${by - 2},z=${o.z - 2},dx=4,dy=4,dz=4] run setblock ${P} ${blockSpec(sc, false)}`);
    }
    for (const a of sc.arrows || []) {
      step.push(`execute if score #t mclr matches ${a.t} run summon minecraft:arrow ${o.x + a.x} ${by + a.y} ${o.z + a.z} {Motion:[${a.vx}d,${a.vy}d,${a.vz}d],Tags:["mrb${i}${a.tag}"],pickup:2b}`);
    }
    for (const [t, tag] of sc.kills || []) step.push(`execute if score #t mclr matches ${t} run kill @e[tag=mrb${i}${tag}]`);
  });
  SCENARIOS.forEach((sc, i) => {
    const o = origin(i);
    const by = sc.plate ? o.y : o.y + 1;
    probes.push(`${sc.id}.button`);
    let j = probes.length - 1;
    let P = `${o.x} ${by} ${o.z}`;
    step.push(`data modify storage mcliteref:pl b${j} append value 0`);
    step.push(`execute if block ${P} ${blockSpec(sc, true)} run data modify storage mcliteref:pl b${j}[-1] set value 1`);
    probes.push(`${sc.id}.lamp`);
    j = probes.length - 1;
    P = `${o.x} ${by} ${o.z - 1}`;
    step.push(`data modify storage mcliteref:pl b${j} append value 0`);
    step.push(`execute if block ${P} minecraft:redstone_lamp[lit=true] run data modify storage mcliteref:pl b${j}[-1] set value 1`);
  });
  return { setup, step, probes };
}
