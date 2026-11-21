// crossbowmoblockstepcheck.mjs -- #8714 (G18b-L41): lockstep scenario 'crossbowmob', 20 salts: pillager and piglin, each holding a crossbow, vs a dummy at 6, 12 and 20 blocks.
// Reference = .decomp CrossbowAttackGoal.tick written as an independent per-tick model (seeing ticker >= 5, 8-block approach, 25-tick use time, chargedTicksLeft 20+nextInt(20), READY fires next tick) plus CrossbowUser.shoot speed 1.6 and divergence 14-4*difficulty.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine, initRegistry, MCLITE_ROOT } from '../loadsrc.mjs';
const ASSETS = join(MCLITE_ROOT, 'assets');
const M = loadEngine({
  extra: ['02f_tags.js', '02g_items.js', '07d_mining.js', '07e_loot.js', '07b_behaviour.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07y_equip.js', '07m_breed.js', '07l_spawn.js', '14j_combat.js'],
  dom: false
});
initRegistry(M);
M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes });
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Ai.init(); M.Equip.init();
const EL = M.EntityList, Cb = M.Combat, Ai = M.Ai;

const IT = M.Items, Eq = M.Equip;
const CELLS = new Map();
M.World = { getBlock: () => 0, setBlock: () => true, get: () => null, heightAt: () => 63, biomeAt: () => 1, chunks: new Map(), tickingAt: () => true };
M.CH = { GENERATED: 2 };
M.Behave.init(M.World);
M.Diff = { value: 'normal', get() { return this.value; } };
let fails = 0, breaks = 0, cells = 0;
const ok = (c, m) => { if (!c) { fails++; console.log('  FAIL ' + m); } };
const brk = (c, m) => { if (c) { breaks++; console.log('   ✓ break caught: ' + m); } else { fails++; console.log('  ✗ break NOT caught: ' + m); } };
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const realPull = Ai.CROSSBOW_PULL_TICKS;
const realFindPath = Ai.findPath;
const STEP = 0.25;   // the scripted approach, blocks per tick, identical in model and engine
function lane(salt) {
  const out = [];
  for (const kind of ['pillager', 'piglin']) for (const dist of [6, 12, 20]) {
    const r = stream(salt * 7 + dist), rolls = Array.from({ length: 40 }, () => r());
    const x = 100 + salt * 8, z = 100 + dist * 3;
    const e = EL.spawn(kind, x, 64, z, {});
    const t = { type: 'dummy', x: x + dist, y: 64, z, height: 1.8, health: 20, dead: false, removed: false };
    Eq.setEquipped(e, IT.MAINHAND, Eq.stackOf('crossbow'));
    e.target = t; e.attacking = true;
    let n = 0;
    EL.random = () => rolls[n++];
    Ai.findPath = () => null;
    const goal = new Ai.CrossbowAttackGoal(e, 1.0, 8.0, { random: EL.random, canSee: () => true, onShoot: null });
    goal.start();
    // independent model
    let cd = 0, mi = 0, ticker = 0, left = 0, stage = 'U', use = 0, ex = e.x, shotTick = -1, wantLeft = 0, wantShot = -1, wantCharged = -1;
    const arrows = [];
    const realSpawn = EL.spawn;
    EL.spawn = function (ty, ...a) { const o = realSpawn.call(EL, ty, ...a); if (ty === 'arrow') arrows.push({ tick: tickNow, e: o }); return o; };
    var tickNow = 0;
    const tag = 'salt ' + salt + ' ' + kind + '@' + dist + ': ';
    let rollN = 0;
    for (let tk = 1; tk <= 140 && shotTick < 0; tk++) {
      tickNow = tk;
      // model of this tick
      ticker++;
      const dsq = (t.x - ex) * (t.x - ex);
      const move = (dsq > 64 || ticker < 5) && left === 0;
      if (move) { cd--; if (cd <= 0) { cd = 20 + Math.floor(rolls[mi++] * 21); } } else cd = 0;
      if (stage === 'U') { if (!move) { stage = 'C'; use = 0; } }
      else if (stage === 'C') { use++; if (use >= 25) { stage = 'H'; left = 20 + Math.floor(rolls[mi++] * 20); wantCharged = tk; } }
      else if (stage === 'H') { left--; if (left === 0) stage = 'R'; }
      else if (stage === 'R') { wantShot = tk; stage = 'U'; }
      if (move) ex += STEP;
      // engine
      e.x += move ? 0 : 0;
      goal.tick();
      if (move) e.x += STEP;
      cells++;
      const eng = e.crossbowCharging ? 'C' : null;
      if (stage === 'C' && !e.crossbowCharging) out.push(tag + 'tick ' + tk + ' not charging');
      if (Math.abs(e.x - ex) > 1e-9) out.push(tag + 'tick ' + tk + ' x ' + e.x + ' want ' + ex);
      if (wantShot === tk) {
        if (arrows.length !== 1 || arrows[0].tick !== tk) out.push(tag + 'arrow tick ' + (arrows[0] && arrows[0].tick) + ' want ' + tk);
        else {
          const a = arrows[0].e, sp = Math.hypot(a.vx, a.vy, a.vz);
          if (Math.abs(sp - 1.6) > 0.5) out.push(tag + 'arrow speed ' + sp);
          if (!(Math.abs(a.vx / sp) > 0)) out.push(tag + 'arrow direction');
        }
        shotTick = tk;
      } else if (arrows.length) { out.push(tag + 'early arrow at ' + tk + ' want ' + wantShot); shotTick = tk; }
    }
    if (shotTick < 0) out.push(tag + 'no shot');
    EL.spawn = realSpawn;
    e.removed = true;
  }
  return out;
}
const pass = () => Array.from({ length: 20 }, (_, i) => i).flatMap(lane);
const base = pass();
ok(base.length === 0, 'lane: ' + base.slice(0, 3).join(' | '));
ok(cells > 0, 'lane covers ' + cells + ' cells');
Ai.CROSSBOW_PULL_TICKS = 20;
brk(pass().length > 0, 'charge time 25 changed to 20 ticks caught');
Ai.CROSSBOW_PULL_TICKS = realPull;
const realMin = Ai.CROSSBOW_CHARGED_MIN;
Ai.CROSSBOW_CHARGED_MIN = 10;
brk(pass().length > 0, 'hold floor 20 changed to 10 caught');
Ai.CROSSBOW_CHARGED_MIN = realMin;
brk(pass().length === 0, 'unfaulted lane passes after restore');
Ai.findPath = realFindPath;
console.log(`crossbowmoblockstepcheck: ${2 + breaks} assertions, ${fails} failures, ${breaks} breaks caught`);
process.exit(fails ? 1 : 0);
