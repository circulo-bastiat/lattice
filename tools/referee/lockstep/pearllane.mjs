// lockstep/pearllane.mjs -- #6312 (G17-L61): the ENGINE side of the pearl lane. Drives NS with pearlscen's script through playerlane.driveEngine,
// throwing at the ticks the server run observed (`uses`; the Use Item packet is not tick-exact). The server's launch velocity (the 1.0
// inaccuracy gaussians, java.util.Random) is taken from its first row, and the 5% endermite roll is forced to the server's outcome per throw.
import { harness, buildLane } from './zombielane.mjs';
import { pearlScript, T, AT, WALL_X, COW } from '../pearlscen.mjs';
import { driveEngine, compareLane } from './playerlane.mjs';

export function engineSnapshotApi(h, server, opts = {}) {
  const { M } = h, EL = M.EntityList, P = M.Player, stone = M.States.stateOf('stone');
  h.cells.clear();
  for (let x = -12; x <= 12; x++) for (let z = -12; z <= 12; z++) h.w.set(x, -61, z, stone);
  for (let y = -60; y <= -52; y++) for (let z = -6; z <= 6; z++) h.w.set(WALL_X, y, z, stone);
  EL.list.length = 0; EL.nextId = 1; EL.spawnCounter = 0; EL.ticks = 0;
  if (M.Particle && M.Particle.clear) M.Particle.clear();
  M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  P.init(); if (M.Diff && M.Diff.set) M.Diff.set('normal');
  M.Gamemode.set(P, M.Gamemode.SURVIVAL);
  if (!P.type) P.type = 'player';   // the game's Player has it (Sv.tick / EL.suffocate branch on it); the stub harness's does not
  const cow = EL.spawn('cow', COW[0], COW[1], COW[2]); cow.persistent = true; cow.aiDisabled = true;
  const uses = server.uses, window = (n) => [uses[n], n + 1 < uses.length ? uses[n + 1] : T];
  const mite = uses.map((_, n) => { const [a, b] = window(n); return server.rows.slice(a, b).some((r) => r.entities.some((e) => e.type === 'endermite')); });
  let throwN = 0, tick = 0;
  const roll = () => (mite[throwN - 1] ? 0.0 : 0.99);
  EL.random = roll; Math.random = roll;
  const place = () => { P.height = h.playerInit.height; P.eyeHeight = h.playerInit.eyeHeight;  P.x = P.ex = P.px = AT[0]; P.y = P.ey = P.py = AT[1]; P.z = P.ez = P.pz = AT[2]; P.vx = P.vy = P.vz = 0; P.onGround = true; };
  place();
  return {
    look(yawMc, pitchMc) { place(); P.yaw = (yawMc + 180) * Math.PI / 180; P.pitch = -pitchMc * Math.PI / 180; P.pearlCooldown = 0; },   // MC yaw 0 = +z, pitch + = down; the engine's yaw 0 = -z, pitch + = up
    give(item, n) { M.Inventory.setItem(P.inventory, 0, { i: M.Items.of(item), n }); P.slot = 0; },
    use() {
      const k = uses.indexOf(tick); if (k < 0) return;   // the server's throw ticks, not the script's
      throwN = k + 1;
      const st = M.Inventory.getItem(P.inventory, 0);
      if (!M.Throw.use(P, st)) throw new Error('Throw.use refused at tick ' + tick);
      const e = EL.list.filter((x) => x.type === 'ender_pearl').pop();
      const v = server.rows[tick].entities.find((x) => x.type === 'ender_pearl').vel;
      e.vx = v[0]; e.vy = v[1]; e.vz = v[2];
      if (opts.gravity != null) e.gravity = opts.gravity;   // fault injection (the check proves the lane can fail)
      if (opts.drag != null) e.drag = opts.drag;
    },
    step() { if (P.invulnerable > 0) P.invulnerable--; EL.suffocate(P); EL.tick(); tick++; },   // the player ticks BEFORE the pearl (vanilla's server shows the in-wall hit 10 ticks after the fall)
    snapshot() {
      return { player: { x: P.x, y: P.y, z: P.z, health: P.health },
        entities: EL.list.filter((e) => (e.type === 'ender_pearl' || e.type === 'endermite') && !e.removed).sort((a, b) => (a.type < b.type ? -1 : 1)).map((e) => ({ type: e.type, x: e.x, y: e.y, z: e.z, vx: e.vx, vy: e.vy, vz: e.vz })) };
    },
  };
}
// `use` ops are replayed at the server's observed throw ticks: the engine script moves each use step to uses[i]
export function engineRows(server, opts) {
  const h = harness(), api = engineSnapshotApi(h, server, opts);
  const script = pearlScript().map((s) => s);
  server.uses.forEach((t) => script.push({ tick: t, op: 'use' }));
  return driveEngine(script.filter((s, i) => s.op !== 'use' || i >= pearlScript().length), T, api);
}
export const comparePearl = (server, engine) => compareLane(server.rows, engine);
