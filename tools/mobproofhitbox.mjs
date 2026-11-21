// #9186: mobproof HITBOX dimension producer. node tools/mobproofhitbox.mjs [outdir]  -> <outdir>/hitbox.json
// Per roster mob: engine EntityType box vs the jar table (golden/entity-types), default eye height (0.85 * height),
// boxAt spawn AABB and after a move. #9196 covers eye height, baby scale and pose boxes from golden/entity-hitbox-extras. NOT yet covered (notCovered, pass stays false): real-server AABB (Probe walk), F3+B (hitboxcheck covers 4 shapes only).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probes, origin, MOVE, first } from './referee/hitboxscen.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const F = Math.fround;
const ALIAS = { fish: 'cod', llama_decor: 'llama', player_slim: 'player' };   // roster rows that are not their own EntityType
export const NOT_COVERED = ['real-server AABB (Probe walk)', 'F3+B render per mob'];
const SERVER_QUIRK = { leash_knot: ['spawn', 'moved'], pufferfish: ['spawn', 'moved'], slime: ['spawn', 'moved'], magma_cube: ['spawn', 'moved'], shulker: ['moved'], ender_dragon: ['moved'], evoker_fangs: ['moved'] };   // #9205: knot snaps to its block, slimes/pufferfish summon at a size the jar row does not describe, shulker re-attaches after tp; #9197: the real server moves the dragon's parts itself / fangs expire after ~22 ticks
/** #9197: engine verdict for each runhitbox probe: does boxAt(name at c) intersect the 1-block cube at p.at */
export function engineProbes(engine, name, c, dims) {
  const b = engine.boxAt(name, c.x, c.y, c.z);
  return probes(c.x, c.y, c.z, dims[0], dims[1]).map((p) => !!b && [0, 1, 2].every((a) => b[a + 3] > p.at[a] && b[a] < p.at[a] + 1));
}
function proveServer(m, name, sv, engine, j, no) {
  if (!no(!!sv, 'no real-server row')) return;
  for (const [k, mv] of [['spawn', { x: 0, y: 0, z: 0 }], ['moved', MOVE]]) {
    if ((SERVER_QUIRK[m] || []).includes(k)) continue;
    const o = origin(Math.max(0, SERVER_ORDER.indexOf(m))), c = { x: o.x + 0.5 + mv.x, y: o.y + mv.y, z: o.z + 0.5 + mv.z };
    const eng = engineProbes(engine, name, c, j);
    no(JSON.stringify(eng) === JSON.stringify(sv[k]), `real-server AABB ${k}: engine ${eng.map(Number).join('')} vs server ${(sv[k] || []).map(Number).join('')}`);
  }
}
let SERVER_ORDER = [];
export function jarTable(tsv) {
  const t = {};
  for (const l of tsv.split('\n')) { if (!l || l[0] === '#') continue; const c = l.split('\t'); t[c[0]] = [+c[1], +c[2]]; }
  return t;
}
/** #9196: golden/entity-hitbox-extras tsv -> { mob: {living, eye, eyeBaby, scale, sleep, swim, crouch, sit, longJump} } (boxes as [w,h]) */
export function extrasTable(tsv) {
  const t = {}, num = (v) => (v === '-' ? null : +v), bx = (v) => (v === '-' ? null : v.split('x').map(Number));
  for (const l of tsv.split('\n')) {
    if (!l || l[0] === '#') continue; const c = l.split('\t');
    t[c[0]] = { living: c[1] === '1', eye: num(c[2]), eyeBaby: num(c[3]), scale: num(c[4]), sleep: bx(c[5]), swim: bx(c[6]), crouch: bx(c[7]), sit: bx(c[8]), longJump: bx(c[9]), eyeSleep: num(c[10]) };
  }
  return t;
}
const same = (a, b) => a != null && b != null && Math.abs(a - b) <= 1e-5 * Math.max(1, Math.abs(b));
const boxIs = (b, w, h) => !!b && same(b[0], w) && same(b[1], h);
/** engine: (optional) eyeHeight(name, baby, height), babyScale(name) */
function proveExtras(m, x, j, engine, no) {
  if (!no(!!x, 'no extras row') || !x) return;
  const std = [j[0], j[1]];
  no(x.eye != null && x.eye > 0 && x.eye <= j[1] * 1.001 + 1e-6 || m === 'giant' || m === 'ghast' || m === 'enderman' || m === 'shulker' || m === 'boat', `eye ${x.eye} outside height ${j[1]}`);
  if (x.living) {
    no(boxIs(x.sleep, 0.2, 0.2), `sleeping box ${x.sleep} != 0.2x0.2`);
    no(same(x.eyeSleep, 0.2), `sleeping eye ${x.eyeSleep} != 0.2`);
    const pl = m === 'player' || m === 'player_slim';
    no(boxIs(x.swim, pl ? 0.6 : std[0], pl ? 0.6 : std[1]), `swim box ${x.swim}`);
    no(boxIs(x.crouch, pl ? 0.6 : std[0], pl ? 1.5 : std[1]), `crouch box ${x.crouch}`);
    no(boxIs(x.sit, std[0], std[1]), `sit box ${x.sit} (1.18.2 has no sitting pose)`);
    no(m === 'goat' ? boxIs(x.longJump, 0.9 * 0.7, 1.3 * 0.7) : x.longJump == null, `longJump box ${x.longJump}`);
    no(x.scale == null || x.scale === (m === 'turtle' ? 0.3 : 0.5), `baby scale ${x.scale}`);
    no((x.scale == null) === (x.eyeBaby == null), 'baby scale / baby eye disagree');
  }
  if (engine.eyeHeight) {
    const e = engine.eyeHeight(m, false, j[1]);
    no(e != null && same(e, x.eye), `engine eye ${e} != table ${x.eye}`);
    if (x.scale != null) { const eb = engine.eyeHeight(m, true, F(j[1] * x.scale)); no(eb != null && same(eb, x.eyeBaby), `engine baby eye ${eb} != table ${x.eyeBaby}`); }
  }
  if (engine.babyScale) { const s = engine.babyScale(m); no((s || null) === ((x.scale) || null) || s === 1 && x.scale == null, `engine baby scale ${s} != table ${x.scale}`); }
}
/** engine: { dimensions(name), boxAt(name,x,y,z) } -> { mob: {pass, checked, notCovered, failed} } */
export function prove(roster, jar, engine, extras, server) {
  const out = {};
  SERVER_ORDER = server ? first(roster) : [];
  for (const m of roster) {
    const failed = []; let checked = 0; const no = (c, s) => { checked++; if (!c) failed.push(s); return !!c; };
    const j = jar[ALIAS[m] || m], d = engine.dimensions(ALIAS[m] || m);
    no(!!j, 'no jar row'); no(!!d, 'engine has no dimensions');
    if (j && d) {
      no(F(d.width) === F(j[0]), `width ${d.width} != jar ${j[0]}`);
      no(F(d.height) === F(j[1]), `height ${d.height} != jar ${j[1]}`);
      for (const [x, y, z] of [[0, 64, 0], [10.5, 70.25, -3.75]]) {
        const b = engine.boxAt(ALIAS[m] || m, x, y, z), w = F(j[0]) / 2;
        const want = [x - w, y, z - w, x + w, y + F(j[1]), z + w];
        no(!!b && want.every((v, i) => Math.abs(b[i] - v) < 1e-6), `boxAt ${x},${y},${z} ${b}`);
      }
    }
    if (extras) proveExtras(m, extras[m], j || [0, 0], engine, no);
    const inSrv = server && SERVER_ORDER.includes(m);
    if (inSrv && j) proveServer(m, ALIAS[m] || m, server[m], engine, j, no);
    out[m] = { pass: false, checked, notCovered: inSrv ? NOT_COVERED.slice(1) : NOT_COVERED.slice(), failed };
  }
  return out;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { loadEngine, initRegistry } = await import('./loadsrc.mjs');
  const M = loadEngine({ extra: ['07h_entities.js', '07m_breed.js', '14j_combat.js'], dom: false }); initRegistry(M);
  M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(HERE, '..', 'assets', 'entities.json'), 'utf8')) });
  const E = M.Entities; E.init();
  const NSx = M, Cb = NSx.Combat, Br = NSx.Breed;   // #9196: engine eye height / baby scale per mob
  if (Cb && Cb.eyeHeightOf) {
    const prev = Br && Br.isBaby;
    E.eyeHeight = (n, baby, h) => { n = ALIAS[n] || n; if (Br) Br.isBaby = () => baby; try { return Cb.eyeHeightOf({ type: n, height: h, baby }); } finally { if (Br) Br.isBaby = prev; } };
  }
  const roster = Object.keys(JSON.parse(readFileSync(join(HERE, 'mobl3-mobs.json'), 'utf8')).mobs);
  const jar = jarTable(readFileSync(join(HERE, 'golden/entity-types-1.18.2.tsv'), 'utf8'));
  const extras = extrasTable(readFileSync(join(HERE, 'golden/entity-hitbox-extras-1.18.2.tsv'), 'utf8'));
  const gl = process.env.MOBHITBOX_GOLDEN || (await import('node:child_process')).execSync('ls -t ' + process.env.HOME + '/.mclite-referee/*/runs/*/golden/mob-hitbox.json 2>/dev/null | head -1', { encoding: 'utf8' }).trim();
  const server = gl ? JSON.parse(readFileSync(gl, 'utf8')).cases : null;
  if (!server) console.log('mobproofhitbox: no mob-hitbox golden (node tools/referee/runhitbox.mjs): real-server AABB not compared');
  const res = prove(roster, jar, E, extras, server);
  const dir = process.argv[2] || join(HERE, 'mobproof', 'out'); mkdirSync(dir, { recursive: true });
  res.__sha = process.env.MCLITE_SHA || 'local';
  writeFileSync(join(dir, 'hitbox.json'), JSON.stringify(res, null, 1));
  const bad = roster.filter((m) => res[m].failed.length);
  for (const m of bad) console.log('FAIL ' + m + ': ' + res[m].failed.join('; '));
  console.log(`mobproofhitbox: ${roster.length} mobs, ${bad.length} with mismatches (real server / F3+B owed)`);
  process.exit(bad.length ? 1 : 0);
}
