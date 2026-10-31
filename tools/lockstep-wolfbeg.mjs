#!/usr/bin/env node
// lockstep-wolfbeg -- #7100 (G18b-L9): lockstep scenario 'wolfbeg', 20 salts. A tamed wolf and a scripted owner who holds a bone, then raw beef,
// then a stick, at 6 and 12 blocks (and 9, just outside the range), switching at salt-dependent ticks. The engine's WolfBegGoal (priority 9, driven like GoalSelector: canUse -> start,
// canContinueToUse -> tick/stop) is compared per tick with WolfBegGoal.java + WolfEntity.tick against an independent reference: begging flag,
// the 40 + nextInt(40) timer (seen as the begging run length), the look target (x, eye y, z), begAnimationProgress (+= (target - p) * 0.4) and wolf pos.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALTS = 20, TICKS = 500, PLAT_Y = 8;
const stream = (salt) => { let s = (salt * 2654435761 + 777) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const ITEMS = ['bone', 'beef', 'stick', 'bone'];
// owner script: [item, distance] at tick t
function script(salt, t) {
  const a = 30 + salt * 3, b = a + 120, c = b + 90;
  const item = t < 10 ? null : t < a ? 'bone' : t < b ? 'beef' : t < c ? 'stick' : ITEMS[3];
  const dist = [6, 12, 6, 9][Math.floor(t / (45 + salt)) % 4];   // 9 sits just outside the 8-block range
  return [item, dist];
}
const fmt = (...a) => a.join('|');

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07j_entityrender.js',
    '07k_goals.js', '07zj_fox.js', '07l_spawn.js', '07m_breed.js', '07r_mount.js', '07w_passive.js', '14i_hand.js', '14j_combat.js', '14d_survival.js'] });
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ROOT, 'assets', 'entities.json'), 'utf8')) });
  M.Entities.init(); M.EntityList.init(); M.Breed.init && M.Breed.init(); M.Mount.init(); M.Ai.init(); M.Combat.init();
  const EL = M.EntityList, Ai = M.Ai;
  M.World.init(1);
  M.Player = { x: 6, y: PLAT_Y + 1, z: 0, yaw: 0, pitch: 0, heldItem: null, onGround: true };
  let cur = stream(0); EL.random = () => cur();   // the goal captures EL.random when built; spawn's own draws must not count
  const wolf = EL.spawn('wolf', 0, PLAT_Y + 1, 0);
  wolf.tamed = true;
  const en = wolf.ai.entries.find((x) => x.priority === 9 && x.flags === Ai.LOOK), g = en.goal;
  let look = null;
  wolf.look = { setLookAt: (x, y, z) => { look = [x, y, z]; } };
  cur = stream(salt);
  const rows = []; let active = false;
  for (let t = 0; t < TICKS; t++) {
    const [item, dist] = script(salt, t);
    M.Player.heldItem = item; M.Player.x = dist; look = null;
    if (!active) { if (g.canUse()) { g.start(); active = true; } }
    else if (!g.canContinueToUse()) { g.stop(); active = false; }
    if (active) g.tick();
    wolf.age = t + 1; M.EntityRender.wolfBegTick(wolf);
    rows.push(fmt(!!wolf.begging, look ? look.join(',') : '-', wolf.beg, wolf.x, wolf.y, wolf.z));
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), rows = [];
  let beg = false, timer = 0, prog = 0, active = false;
  const eye = PLAT_Y + 1 + Math.fround(1.62); // vanilla getEyeY = y + (double)eyeHeight, a float
  for (let t = 0; t < TICKS; t++) {
    const [item, dist] = script(salt, t);
    const attractive = item === 'bone' || item === 'beef';       // tamed + bone, or isBreedingItem(raw beef); a stick is neither
    const inRange = dist <= 8;
    let look = null;
    if (!active) { if (inRange && attractive) { active = true; beg = true; timer = 40 + Math.floor(r() * 40); } }
    else if (!(inRange && timer > 0 && attractive)) { active = false; beg = false; }
    if (active) { look = [dist, eye, 0]; timer--; }
    prog += ((beg ? 1 : 0) - prog) * 0.4;
    rows.push(fmt(beg, look ? look.join(',') : '-', prog, 0, PLAT_Y + 1, 0));
  }
  return rows;
}

function run(patch) {
  let bad = 0, first = '';
  for (let s = 1; s <= SALTS; s++) {
    const a = engine(s, patch), b = reference(s);
    for (let i = 0; i < TICKS; i++) if (a[i] !== b[i]) { bad++; if (!first) first = `salt ${s} tick ${i}: engine ${a[i]} ref ${b[i]}`; break; }
  }
  return { bad, first };
}

const base = run();
let ok = base.bad === 0, caught = 0;
const P = (a, b) => (n, s) => { if (n !== '07k_goals.js') return s; if (!s.includes(a)) throw new Error('patch missed: ' + a); return s.replace(a, b); };
const breaks = [
  ['range 8 -> 10', P('new Ai.WolfBegGoal(e, ctx, 8.0)', 'new Ai.WolfBegGoal(e, ctx, 10.0)')],
  ['timer window 40 -> 30', P('timer = 40 + Math.floor(rand() * 40);', 'timer = 30 + Math.floor(rand() * 40);')],
  ['timer span 40 -> 20', P('timer = 40 + Math.floor(rand() * 40);', 'timer = 40 + Math.floor(rand() * 20);')],
  ['bone no longer attractive', P("=== 'bone') return true;", "=== 'bonez') return true;")],
  ['look at feet not eyes', P('begFrom.y + Ai.eyeOf(begFrom), begFrom.z', 'begFrom.y, begFrom.z')],
];
for (const [name, p] of breaks) {
  let x; try { x = run(p); } catch (e) { console.log('PATCH ERROR ' + name + ': ' + e.message); ok = false; continue; }
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`wolfbeg: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
