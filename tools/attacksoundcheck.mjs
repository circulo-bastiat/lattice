#!/usr/bin/env node
// attacksoundcheck.mjs — G17d-a: the six `entity.player.attack.*` sounds of `Player.attack`
// (.decomp PlayerEntity.attack: knockback before the blow; nodamage on a refused hit; then
// sweep, crit, and strong/weak when neither). Proves it can fail: each break corrupts the
// engine or the expectation and the comparison must notice.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'assets');
const M = loadEngine({
  extra: ['02g_items.js', '14f_inventory.js', '14i_hand.js', '07h_entities.js',
          '14b_physics.js', '07i_entitylist.js', '14e_gamemode.js', '07q_effects.js',
          '14j_combat.js', '14d_survival.js', '07zx_particle.js'],
  initReg: false
});
M.DATA = Object.assign({}, M.DATA, { entities: JSON.parse(readFileSync(join(ASSETS, 'entities.json'), 'utf8')) });
M.Entities.init();
M.Items.init({
  items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'),
  itemsBytes: JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8')).rawBytes
});
{
  const table = {};
  for (const line of readFileSync(join(ROOT, 'tools', 'golden', 'item-attributes-1.18.2.tsv'), 'utf8').split(/\r?\n/)) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t');
    if (c[0] === 'item' || c.length < 9) continue;
    const r = (v) => Math.round(parseFloat(v) * 10000) / 10000;
    table[c[0]] = [r(c[6]), r(c[7]), +c[8]];
  }
  M.Hand.bindAttrs(table);
}
const FLOOR_Y = 64;
M.Physics.shapeAt = (x, y, z) => (y < FLOOR_Y ? M.Physics.FULL_CUBE : null);
M.Physics.solidAt = (x, y, z) => M.Physics.shapeAt(x, y, z) !== null;
M.Physics.grounded = (x, y, z, d) => y - d < FLOOR_Y;
M.EntityList.init();
M.Combat.init();
const EL = M.EntityList, Cb = M.Combat, H = M.Hand, Inv = M.Inventory;

// every event must exist in the game's own sounds.json
const evs = JSON.parse(readFileSync(join(ROOT, '.mcsnd', 'sounds.json'), 'utf8'));
let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };

const played = [];
M.Sound = Object.assign(M.Sound || {}, { play: (ev, o) => { played.push([ev, o]); } });

function swing(item, over, ticks, invulnerable) {
  EL.clear();
  const P = Object.assign({ x: 0, y: FLOOR_Y, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, slot: 0,
    inventory: Inv.create(), sprinting: false, onGround: true, fallDistance: 0, onClimbable: false,
    inWater: false, walkDist: 0, walkDistO: 0, speed: 0.1 }, over || {});
  Inv.setItem(P.inventory, P.slot, Inv.stack(item, 1, 0, null));
  H.reset(); for (let i = 0; i < ticks; i++) H.tickAttackStrength();
  const e = EL.spawn('zombie', 2, FLOOR_Y, 0); e.maxHealth = e.health = 1000;
  if (invulnerable) { e.invulnerableTime = 40; e.lastHurt = 1000; }
  played.length = 0;
  const r = Cb.attack(P, e);
  return { r, names: played.map((p) => p[0].replace('entity.player.attack.', '')), calls: played.slice() };
}
const CASES = [
  ['weak',      () => swing('diamond_sword', {}, 0),                                        ['weak']],
  ['strong',    () => swing('diamond_axe', {}, 60),                                         ['strong']],
  ['crit',      () => swing('diamond_axe', { onGround: false, fallDistance: 1.5 }, 60),      ['crit']],
  ['sweep',     () => swing('diamond_sword', {}, 40),                                       ['sweep']],
  ['knockback', () => swing('diamond_axe', { sprinting: true }, 60),                        ['knockback', 'strong']],
  ['nodamage',  () => swing('diamond_sword', {}, 40, true),                                 ['nodamage']]
];
const evaluate = () => CASES.map(([n, run, want]) => {
  const g = run(); return { n, got: g.names.join(','), want: want.join(','), g };
});

for (const c of evaluate()) {
  ok(c.got === c.want, `${c.n}: played [${c.got}], vanilla plays [${c.want}]`);
  console.log(`   ${c.n.padEnd(10)} ${c.got}`);
  for (const [ev, o] of c.g.calls) {
    ok(evs[ev], `${ev} is not in sounds.json`);
    ok(o.source === 'player' && o.volume === 1 && o.pitch === 1, `${ev}: source/volume/pitch differ from vanilla's PLAYERS 1.0/1.0`);
    ok(o.x === 0 && o.y === FLOOR_Y && o.z === 0, `${ev}: played away from the attacker`);
  }
}
ok(Array.isArray(Cb.OWED) && Cb.OWED.every((t) => !/attack sounds/.test(t)), 'Cb.OWED still lists the attack sounds');

// anti-vacuity: break the engine / the wiring, the comparison must fail each time
const caught = (label, fn) => {
  const save = { s: Cb.attackSound, p: M.Sound.play };
  fn();
  const bad = evaluate().some((c) => c.got !== c.want);
  Cb.attackSound = save.s; M.Sound.play = save.p;
  breaks += bad ? 1 : 0;
  if (bad) console.log(`   ✓ break caught: ${label}`); else fails.push('anti-vacuity: ' + label + ' went unnoticed');
};
caught('strong renamed to weak', () => { const o = Cb.attackSound; Cb.attackSound = (P, n) => o(P, n === 'strong' ? 'weak' : n); });
caught('crit silenced', () => { const o = Cb.attackSound; Cb.attackSound = (P, n) => n === 'crit' ? 'entity.player.attack.crit' : o(P, n); M.Sound.play = (ev) => { if (!/crit/.test(ev)) played.push([ev, {}]); }; });
caught('sound layer removed', () => { M.Sound.play = () => {}; });
caught('nodamage made sweep', () => { const o = Cb.attackSound; Cb.attackSound = (P, n) => o(P, n === 'nodamage' ? 'sweep' : n); });
caught('knockback dropped', () => { const o = Cb.attackSound; Cb.attackSound = (P, n) => n === 'knockback' ? 'x' : o(P, n); });
caught('sweep dropped', () => { const o = Cb.attackSound; Cb.attackSound = (P, n) => n === 'sweep' ? 'x' : o(P, n); });

console.log('\n================ attacksoundcheck ================');
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
for (const f of fails) console.log('  ✗ ' + f);
console.log(` breaks caught ...... ${breaks}`);
process.exit(fails.length ? 1 : 0);
