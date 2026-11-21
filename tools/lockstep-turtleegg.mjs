#!/usr/bin/env node
// lockstep-turtleegg -- #6930 (G17-L190): turtle egg block lifecycle, 20 salts. A 4-egg stack on sand is trampled by a cow (onSteppedOn 1-in-100),
// landed on by a cow (1-in-3) and a zombie (never), then random-ticked to hatch (1-in-500, stages 0-2, then break + 4 babies age -24000).
// Reference = .decomp TurtleEggBlock.tryBreakEgg/onSteppedOn/onLandedUpon/randomTick/breakEgg. Per tick: block state (hatch, eggs), sounds (event, pitch), baby spawns.
// NOT covered (owed): ZombieAttackTurtleEggGoal does not exist in src/ yet.
import { loadEngine } from './loadsrc.mjs';

const SALTS = 20, TICKS = 3000;
const stream = (salt) => { let s = (salt * 2654435761 + 12345) >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };
const fr = Math.fround;

function engine(salt, patch) {
  const M = loadEngine({ patch, extra: ['02f_tags.js', '07b_behaviour.js', '07zp_turtle.js'], dom: false, initReg: true });
  M.Behave.init({ getBlock: () => 0, setBlock() {}, getLight: () => 0 });
  const cells = new Map(), k = (x, y, z) => x + ',' + y + ',' + z;
  const sand = M.States.stateOf('sand');
  let egg;
  cells.set(k(0, -1, 0), sand);
  egg = M.Behave.setProp(M.States.stateOf('turtle_egg'), 'eggs', 4);
  cells.set(k(0, 0, 0), egg);
  M.World = Object.assign(M.World || {}, {
    getBlock: (x, y, z) => cells.get(k(x, y, z)) || 0,
    tagBelow: (tag, b) => b === sand,
    setBlock: (x, y, z, s) => { if (s) cells.set(k(x, y, z), s); else cells.delete(k(x, y, z)); },
  });
  const babies = [];
  M.EntityList = { spawn: (t, x, y, z, o) => { const e = { type: t, x, y, z, growAge: o.growAge }; babies.push(e); return e; } };
  M.Breed = null;
  const Tu = M.Turtle, r = stream(salt), rows = [];
  const cow = { type: 'cow', living: true, maxHealth: 10 }, zom = { type: 'zombie', living: true, maxHealth: 20 };
  M.Commands = { ruleGet: () => 'true' };
  for (let t = 0; t < TICKS; t++) {
    Tu.eggSounds.length = 0; const nb = babies.length;
    if (!M.World.getBlock(0, 0, 0)) M.World.setBlock(0, 0, 0, egg);   // a fresh stack whenever the last one is gone
    if (t < 1500) {
      Tu.eggSteppedOn(cow, 0, 0, 0, r);
      if (t % 5 === 0) Tu.eggLandedUpon(cow, 0, 0, 0, r);
      if (t % 3 === 0) Tu.eggLandedUpon(zom, 0, 0, 0, r);
    }
    const cur = M.World.getBlock(0, 0, 0);
    if (cur && t >= 1500) Tu.eggRandomTick(0, 0, 0, cur, r, 0);
    const s = M.World.getBlock(0, 0, 0);
    rows.push([s ? Tu.eggHatch(s) + '/' + Tu.eggCount(s) : 'air', Tu.eggSounds.map((q) => q.ev + ':' + q.pitch).join(';'),
      babies.slice(nb).map((b) => b.growAge).join(',')].join('|'));
  }
  return rows;
}

function reference(salt) {
  const r = stream(salt), rows = [];
  let eggs = 4, hatch = 0, alive = true;
  for (let t = 0; t < TICKS; t++) {
    const snd = [], bab = [];
    const breakEgg = () => { snd.push('entity.turtle.egg_break:' + (0.9 + r() * 0.2)); if (eggs <= 1) alive = false; else eggs--; };
    if (!alive) { alive = true; eggs = 4; hatch = 0; }
    if (t < 1500) {
      if (alive && ((r() * 100) | 0) === 0) breakEgg();
      if (alive && t % 5 === 0 && ((r() * 3) | 0) === 0) breakEgg();   // zombie landing (t % 3): no-op
    }
    if (alive && t >= 1500 && ((r() * 500) | 0) === 0) {
      if (hatch < 2) { snd.push('entity.turtle.egg_crack:' + (0.9 + r() * 0.2)); hatch++; }
      else { snd.push('entity.turtle.egg_hatch:' + (0.9 + r() * 0.2)); alive = false; for (let i = 0; i < eggs; i++) bab.push(-24000); }
    }
    rows.push([alive ? hatch + '/' + eggs : 'air', snd.join(';'), bab.join(',')].join('|'));
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
const P = (a, b) => (n, s) => { if (n === '07zp_turtle.js' && !s.includes(a)) throw new Error('break text missing: ' + a); return n === '07zp_turtle.js' ? s.replace(a, b) : s; };
const breaks = [
  ['trample bound 3 -> 4', P('tryBreakEgg(e, x, y, z, 3, rnd)', 'tryBreakEgg(e, x, y, z, 4, rnd)')],
  ['hatch stage threshold off by one', P('if (hatch < 2) {', 'if (hatch < 1) {')],
  ['step-on bound 100 -> 101', P('tryBreakEgg(e, x, y, z, 100, rnd)', 'tryBreakEgg(e, x, y, z, 101, rnd)')],
  ['zombies trample on landing', P('/^(zombie|husk|drowned|zombie_villager|zombified_piglin)$/', '/^(husk)$/')],
];
for (const [name, p] of breaks) {
  const x = run(p);
  if (x.bad > 0) caught++; else { ok = false; console.log('NOT CAUGHT: ' + name); }
}
console.log(`turtleegg: ${caught} breaks caught, ${base.bad} divergences${base.first ? ' ' + base.first : ''}`);
process.exit(ok && caught === breaks.length ? 0 : 1);
