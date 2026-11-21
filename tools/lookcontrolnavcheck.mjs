// lookcontrolnavcheck.mjs -- #6419: Ai.LookControl clamps the head to the body only while the mob's navigation
// has a path (vanilla !navigation.isDone()). Bee/parrot (BirdNavigation via Fl.MoveControl), dolphin and cow (stepToward).
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const okAv = (c, m) => { breaks++; if (c) pass++; else fails.push('anti-vacuity: ' + m); };

const MODS = []; for (const m of readFileSync(join(ROOT, 'build.mjs'), 'utf8').matchAll(/'(07[0-9a-z_]+\.js)'/g)) if (!MODS.includes(m[1])) MODS.push(m[1]);
const M = loadEngine({ extra: ['02g_items.js', '14f_inventory.js', '14b_physics.js', '14j_combat.js', '07_world.js'].concat(MODS.filter((f) => f !== '07_world.js')) });
M.DATA = Object.assign({}, M.DATA, {
  entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8'))
});
M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.World.init(1); M.Behave.init(M.World); M.Ai.init();
M.Combat.init();
M.Items.init({ items: readFileSync(join(ROOT, 'assets', 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ROOT, 'assets', 'items.meta.json'), 'utf8')).rawBytes }); M.Equip.init(); M.Dolphin.init();
const EL = M.EntityList, Ai = M.Ai;
M.Player = null;

const OFF = 2.4;   // head ~137 degrees off the body: still past every maxHeadYaw after one idle 10-degree ease
function headOff(e) { return Math.abs(Ai.wrapRad((e.yHeadRot || 0) - Ai.bodyYawOf(e))); }
/** one tick the way EL.tickMob orders it: reset, goal issues its move, head. */
function tick(e, steer) {
  e.navigating = false;
  if (steer) steer(e);
  Ai.tickHead(e);
}
const steers = {
  cow: e => Ai.stepToward(e, { x: 5, y: 30, z: 5 }, 1.0),
  dolphin: e => Ai.stepToward(e, { x: 5, y: 30, z: 5 }, 1.0),
  bee: e => e.flyMove.setWantedPosition(5, 31, 5, 0.35),
  parrot: e => e.flyMove.setWantedPosition(5, 31, 5, 0.35),
};
function run(type, steer) {
  const e = EL.spawn(type, 0.5, 30, 0.5);
  Ai.tickHead(e);
  e.yBodyRot = 0; e.yaw = 0;
  e.yHeadRot = OFF;
  const wasNav = [];
  for (let i = 0; i < 4; i++) { tick(e, steer); wasNav.push(e.navigating); }
  return { e, nav: wasNav.every(Boolean), off: headOff(e) };
}
for (const t of ['cow', 'bee', 'parrot', 'dolphin']) {
  const { e, nav, off } = run(t, steers[t]);
  ok(nav, t + ' reports navigating on every path tick');
  if (t !== 'dolphin') ok(off <= Ai.maxHeadYaw(e) + 1e-9, t + ' head clamped within maxHeadYaw while pathing, off=' + off);
  const idle = EL.spawn(t, 0.5, 30, 0.5);
  Ai.tickHead(idle); idle.yBodyRot = 0; idle.yaw = 0; idle.yHeadRot = OFF;
  tick(idle, null);
  ok(!idle.navigating, t + ' not navigating on idle ticks');
  if (t !== 'dolphin') ok(headOff(idle) > Ai.maxHeadYaw(idle), t + ' head NOT clamped on an idle tick');
}
// anti-vacuity: a bee whose steering never asserts navigating must fail the clamp assertion
{
  const { e, off } = run('bee', e => { e.flyMove.setWantedPosition(5, 31, 5, 0.35); e.navigating = false; });
  okAv(off > Ai.maxHeadYaw(e), 'bee with navigating stubbed false is not clamped (check would fail)');
}
console.log(`lookcontrolnavcheck: ${pass} pass, ${breaks} breaks caught` + (fails.length ? ', FAIL:\n' + fails.join('\n') : ''));
process.exit(fails.length ? 1 : 0);
