// pearlscen.mjs -- #6312 (G17-L61): the 'pearl' lockstep lane SCENARIO (data only; the server runner and engine driver build on it).
// A scripted survival player throws an ender pearl three times, 60 ticks apart (the pearl's own 20-tick cooldown has long run out):
// onto stone (pitch 60, down), into a wall (pitch -10, yaw 90, the +x wall), and at a cow (yaw -90, the cow stands 4 blocks off).
// Compared per tick via lockstep/playerlane.mjs: entity pos+vel, player pos after the teleport, health (5.0 fall damage), the
// endermite's appearance (nEnt). Vanilla: ThrownEnderpearl.onHit (teleport, nextFloat() < 0.05 endermite, hurt 5.0 fall),
// ThrowableProjectile gravity 0.03 / drag 0.99, Item.use -> shootFromRotation(inaccuracy 1.0 in 1.18.2's EnderpearlItem, speed 1.5).
import { validateScript } from './lockstep/playerlane.mjs';
export const T = 200;
export const SALTS = 20;
export const TYPES = ['ender_pearl', 'endermite'];
export const THROWS = [
  { id: 'stone', yaw: 0, pitch: 60 },
  { id: 'wall', yaw: 90, pitch: -10 },
  { id: 'cow', yaw: -90, pitch: 0 },
];
export const STEP = 60;
export function pearlScript() {
  const s = [{ tick: 0, op: 'give', item: 'ender_pearl', count: THROWS.length }];
  THROWS.forEach((t, i) => { s.push({ tick: 1 + i * STEP, op: 'look', yaw: t.yaw, pitch: t.pitch }, { tick: 2 + i * STEP, op: 'use' }); });
  return s;
}
export const scriptErrors = () => validateScript(pearlScript(), T);
