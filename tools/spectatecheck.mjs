#!/usr/bin/env node
// spectatecheck.mjs -- #7926: spectator left-click makes an entity the camera entity (Minecraft.setCameraEntity), headless.
// Anti-vacuity: engines with the release-on-sneak / release-on-death / spectator-gate source edited must fail.
import { loadEngine } from './loadsrc.mjs';


function scenarios(patch) {
  const fails = []; let n = 0;
  const ok = (c, m) => { n++; if (!c) fails.push(m); };
  const M = loadEngine({ extra: ['14e_gamemode.js', '14_player.js'], dom: false, patch });
  const P = M.Player, Gm = M.Gamemode;
  const cow = () => ({ type: 'cow', x: 10, y: 64, z: 10, yaw: 0.3, pitch: 0.1, height: 1.4, removed: false, dead: false });
  const cmd = (o) => Object.assign({ fwd: 0, strafe: 0, jump: false, sneak: false }, o);
  const eye = (e) => e.y + P.cameraEyeHeight(e);

  P.mode = Gm.SURVIVAL;
  ok(P.spectate(cow()) === false && !P.cameraEntity, 'survival player must not spectate');
  P.mode = Gm.SPECTATOR;
  const c = cow();
  ok(P.spectate(c) === true && P.cameraEntity === c, 'spectator click sets camera entity');
  for (let t = 0; t < 40; t++) {
    c.x += 0.1; c.yaw += 0.05; c.pitch -= 0.002; c.y = 64 + (t % 3) * 0.1;
    P.tickSpectate(cmd());
    ok(P.cameraEntity === c && P.x === c.x && P.y === c.y && P.z === c.z && eye(P.cameraEntity) === c.y + 1.4 * 0.85, 'tick ' + t + ' follows eye');
  }
  P.tickSpectate(cmd({ sneak: true }));
  ok(!P.cameraEntity, 'sneak releases');
  P.spectate(c); c.dead = true; P.tickSpectate(cmd());
  ok(!P.cameraEntity, 'dead target releases');
  const d = cow(); P.spectate(d); d.removed = true; P.tickSpectate(cmd());
  ok(!P.cameraEntity, 'removed target releases');
  return { fails, n };
}

const base = scenarios(null);
const nA = base.n;
if (base.fails.length) { for (const f of base.fails.slice(0, 8)) console.log('  FAIL ' + f); process.exit(1); }
const breaks = [
  ['sneak', (s) => s.replace('c.sneak || c.fwd', 'c.fwd')],
  ['dead', (s) => s.replace('e.removed || e.dead || c.sneak', 'e.removed || c.sneak')],
  ['gate', (s) => s.replace('!(Gm && Gm.isSpectator && Gm.isSpectator(P))) return false', 'false) return false')],
];
let caught = 0;
for (const [name, fn] of breaks) {
  const r = scenarios((file, src) => file === '14_player.js' ? fn(src) : src);
  if (r.fails.length) caught++; else console.log('  NOT CAUGHT ' + name);
}
console.log(nA + ' assertions, 0 failures, ' + caught + ' breaks caught');
process.exit(caught === breaks.length ? 0 : 1);
