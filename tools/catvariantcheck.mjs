#!/usr/bin/env node
// catvariantcheck.mjs — #1319: CatEntity.initialize's swamp-hut tail (setCatType(10)+setPersistent inside a
// swamp_hut piece) and setCatType's out-of-range reroll (<0 or >=11 -> nextInt(10)).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEngine } from './loadsrc.mjs';
import { fileURLToPath } from 'node:url';
const ASSETS = join(fileURLToPath(new URL('..', import.meta.url)), 'assets');

const fails = []; let pass = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '07b_behaviour.js', '07_world.js', '07h_entities.js', '14b_physics.js', '07i_entitylist.js', '07k_goals.js', '07l_spawn.js', '07m_breed.js', '07n_tame.js', '07zw_mobnbt.js', '14j_combat.js'], dom: false });
M.Gen.init(1337, Object.assign(M.Gen.defaults(), { climate: 'vanilla' }));
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init(); M.EntityList.init(); M.Tame.init();
const ST = M.Structures, EL = M.EntityList;
let hut = null;
for (let cz = -610; cz <= -580 && !hut; cz += 2) for (let cx = -130; cx <= -100 && !hut; cx += 2) {
  for (const s of ST.startsNear(cx, cz)) if (s.def.name === 'swamp_hut' && s.pieces) hut = s;
}
ok(hut, 'no real swamp_hut start found');
const p = hut.pieces[0];
const inside = [(p.x0 + p.x1) / 2, (p.y0 + p.y1) / 2, (p.z0 + p.z1) / 2];
const outside = [hut.x1 + 40, inside[1], inside[2]];

function run(containsAt) {
  const real = ST.containsAt; ST.containsAt = containsAt;
  let bad = 0;
  try {
    for (let i = 0; i < 20; i++) {
      const c = EL.spawn('cat', inside[0], inside[1], inside[2]);
      if (!c || c.catVariant !== 10 || c.persistent !== true) bad++;
      const o = EL.spawn('cat', outside[0], outside[1], outside[2]);
      if (!o || o.persistent === true) bad++;
    }
    for (const v of [-1, 11, 99]) {
      const c = EL.spawn('cat', outside[0], outside[1], outside[2], { catVariant: v });
      if (!c || !(c.catVariant >= 0 && c.catVariant <= 9)) bad++;
    }
    for (const v of [0, 5, 10]) {
      const c = EL.spawn('cat', outside[0], outside[1], outside[2], { catVariant: v });
      if (!c || c.catVariant !== v) bad++;
    }
  } finally { ST.containsAt = real; }
  return bad;
}
const real = ST.containsAt;
ok(run(real) === 0, 'real: swamp-hut cat must be variant 10 + persistent, outside not persistent, NBT range reroll');
let caught = 0;
const breaks = {
  'never in hut': () => false,
  'always in hut': () => true,
  'wrong structure': (x, y, z) => real('desert_pyramid', x, y, z)
};
for (const [n, f] of Object.entries(breaks)) {
  if (run(f) > 0) { caught++; void n; } else fails.push('break not caught: ' + n);
}
// eye height = height*0.5; crouch pose bypasses stepping effects (cat only)
const Cb = M.Combat;
const eyeRun = (f) => { const c = EL.spawn('cat', outside[0], outside[1], outside[2]); return c && f(c) === Math.fround(c.height * 0.5) && c.height > 0; };
const stepRun = (f) => { const c = EL.spawn('cat', outside[0], outside[1], outside[2]); const o = { type: 'wolf', crouching: true };
  c.crouching = true; const a = f(c); c.crouching = false; return a === true && f(c) === false && f(o) === false; };
ok(eyeRun(Cb.eyeHeightOf), 'cat eye height must be height*0.5');
const ocRun = (f) => { const o = { type: 'ocelot', crouching: true }; const a = f(o); o.crouching = false; return a === true && f(o) === false; };
ok(ocRun(Cb.bypassesSteppingEffects), 'ocelot crouch must bypass stepping effects (#1616)');
ok(stepRun(Cb.bypassesSteppingEffects), 'cat crouch must bypass stepping effects, standing/other must not');
for (const [n, r, f] of [['eye 0.85', eyeRun, (e) => Math.fround(e.height * 0.85)], ['ocelot step never', ocRun, () => false], ['step always', stepRun, () => true], ['step never', stepRun, () => false]]) {
  if (!r(f)) { caught++; void n; } else fails.push('break not caught: ' + n);
}
if (fails.length) { console.log(fails.join('\n')); process.exit(1); }
console.log('catvariantcheck: ' + pass + ` ok, ${caught} breaks caught`);
