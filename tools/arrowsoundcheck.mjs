#!/usr/bin/env node
// arrowsoundcheck.mjs - #5925: entity.arrow.shoot (BowItem.onStoppedUsing), entity.arrow.hit (block + entity hit),
// entity.arrow.hit_player (player shooter -> other player). Each call is removed in turn and must be noticed.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(ROOT, 'assets');
const VERBOSE = process.argv.includes('--verbose');
const rdj = (f) => JSON.parse(readFileSync(join(ASSETS, f), 'utf8'));
const b64 = (f) => readFileSync(join(ASSETS, f)).toString('base64');



let pass = 0, fails = [], caught = 0, breaks = 0;
const ok = (c, m) => { if (c) pass++; else fails.push(m); return c; };
const EXTRA = ['02f_tags.js', '02g_items.js', '02h_recipes.js', '14f_inventory.js',
               '07b_behaviour.js', '07c_blockentity.js', '07d_mining.js', '07e_loot.js',
               '07f_redstone.js', '07h_entities.js', '07i_entitylist.js',
               '14b_physics.js', '14e_gamemode.js', '14i_hand.js',
               '07q_effects.js', '07z_potion.js', '14j_combat.js', '14l_use.js'];

const MCL = loadEngine({ extra: EXTRA, dom: false });
MCL.Items.init({ items: b64('items.bin'), itemsBytes: rdj('items.meta.json').rawBytes });
MCL.DATA = Object.assign({}, MCL.DATA, { entities: rdj('entities.json') });

const N = 32, MID = 16;
const cells = new Uint16Array(N * N * N);
const idx = (x, y, z) => (((y + MID) * N + (z + MID)) * N + (x + MID));
const inside = (x, y, z) => [x, y, z].every((v) => v + MID >= 0 && v + MID < N);
const W = {
  getBlock: (x, y, z) => (inside(x, y, z) ? cells[idx(x, y, z)] : 0),
  setBlock(x, y, z, id) { if (inside(x, y, z)) cells[idx(x, y, z)] = id; return true; },
  blockLightAt: () => 15,
};
MCL.World = W;
MCL.Behave.init(W);
MCL.BlockEntities.init();
MCL.Behave.clearSchedule();
if (MCL.Redstone && MCL.Redstone.init) MCL.Redstone.init();
if (MCL.Entities && MCL.Entities.init) MCL.Entities.init();
MCL.EntityList.init();
MCL.Combat.init();
MCL.Use.init(W);

const Iv = MCL.Inventory, IT = MCL.Items, Use = MCL.Use, EL = MCL.EntityList, Cb = MCL.Combat, ES = MCL.Effects;

// pinned so a velocity assertion is exact arithmetic instead of a tolerance band that
// occasionally loses to a rare multi-sigma gaussian draw -- the same Math.random override
// pattern combatcheck/aicheck/etc. already use for a seeded roll. Restored at the very end.


let played = [];
const realPlay = (ev, o) => played.push([ev, o]);
MCL.Sound = { play: realPlay };
const mk = (v) => () => v;
function player(opts) {
  const inv = Iv.create();
  const o = opts || {};
  return Object.assign({
    inventory: inv,
    slot: 0,
    instabuild: false,
    usingItem: false, useHand: 0, useTicks: 0,
    ex: 0, ey: 64, ez: 0, EYE: 1.62, vx: 0, vy: 0, vz: 0, onGround: true,
    yaw: 0, pitch: 0,
    heldItem() { return Iv.getItem(this.inventory, this.slot); },
    lookVec() { return [0, 0, -1]; },       // fixed, straight -Z — this engine's own convention
    syncHotbar() {},
  }, o);
}

const bow = () => Iv.stack('bow', 1, 0);
const mob = (x, z) => { const e = EL.spawn('turtle', x, 64, z || 0); e.maxHealth = e.health = 1000; return e; };
const REAL = Math.random;
// Use draws from the player JRandom (pRand, #6447): pin that stream along with Math.random
const PL = MCL.Player || Use;
const pin = (v) => { PL.random = { nextDouble: () => v }; };
const evs = (n) => played.filter((p) => p[0] === n);
function shoot(r, ticks) {
  const P = player();
  Iv.setItem(P.inventory, P.slot, bow()); Iv.setItem(P.inventory, 5, Iv.stack('arrow', 2));
  Use.bowStart(P, bow()); P.useTicks = ticks; played = []; Math.random = mk(r); pin(r);
  Use.bowRelease(P); Math.random = REAL;
  return { P, s: evs('entity.arrow.shoot'), a: EL.list[EL.list.length - 1] };
}
function checks() {
  const out = [];
  for (const r of [0, 0.5, 0.999]) for (const t of [20, 10]) {
    const { s } = shoot(r, t); const pull = Use.bowPullProgress(t);
    const want = Math.fround(1 / (r * 0.4 + 1.2) + pull * 0.5);
    out.push(s.length === 1 && s[0][1].volume === 1 && Math.abs(s[0][1].pitch - want) < 1e-6);
  }
  // block hit
  { const { a } = shoot(0.5, 20); played = []; Math.random = mk(0.25); EL.wr = mk(0.25); Cb.embedArrow(a, { state: 1, cx: 0, cy: 0, cz: 0 }); Math.random = REAL;
    const h = evs('entity.arrow.hit'); out.push(h.length === 1 && h[0][1].volume === 1 && Math.abs(h[0][1].pitch - 1.2 / (0.25 * 0.2 + 0.9)) < 1e-6); }
  // mob hit by a player arrow: hit, not hit_player
  { const { a } = shoot(0.5, 20); const t = mob(10, 10); a.x = t.x; a.y = t.y; a.z = t.z; a.px = a.x; a.py = a.y; a.pz = a.z; a.onGround = false;
    played = []; Math.random = mk(0.75); EL.wr = mk(0.75); Cb.tickArrow(a); Math.random = REAL;
    const h = evs('entity.arrow.hit'); out.push(h.length === 1 && Math.abs(h[0][1].pitch - 1.2 / (0.75 * 0.2 + 0.9)) < 1e-6); out.push(evs('entity.arrow.hit_player').length === 0); }
  // player target, player shooter
  { const { a, P } = shoot(0.5, 20); const T = { type: 'player', x: 30, y: 64, z: 30 };
    P.type = 'player'; a.shooter = P; played = [];
    Cb.arrowHitSound(a); const sh = a.shooter; // direct hit_player path via the shared helper
    Cb.arrowPlayerHit && Cb.arrowPlayerHit(a, T);
    const hp = evs('entity.arrow.hit_player'); out.push(hp.length === 1 && hp[0][1].volume === 0.18 && hp[0][1].pitch === 0.45);
    // a mob shooter never plays it
    played = []; a.shooter = { type: 'skeleton' }; Cb.arrowPlayerHit(a, T); out.push(evs('entity.arrow.hit_player').length === 0);
    // shooter hitting itself never plays it
    played = []; a.shooter = P; Cb.arrowPlayerHit(a, P); out.push(evs('entity.arrow.hit_player').length === 0); }
  return out;
}
const good = checks();
good.forEach((g, i) => ok(g, 'check ' + i));
// breaks: remove each call
const wrap = (obj, key, fn) => { const o = obj[key]; obj[key] = fn(o); return () => { obj[key] = o; }; };
const brk = (name, undo) => { breaks++; const r = checks(); undo(); if (r.some((x) => !x)) { caught++; console.log('  ✓ break caught: ' + name); } else fails.push('not caught: ' + name); };
brk('no shoot', wrap(MCL.Sound, 'play', (o) => (ev, p) => { if (ev !== 'entity.arrow.shoot') o(ev, p); }));
brk('no hit', wrap(MCL.Sound, 'play', (o) => (ev, p) => { if (ev !== 'entity.arrow.hit') o(ev, p); }));
brk('no hit_player', wrap(MCL.Sound, 'play', (o) => (ev, p) => { if (ev !== 'entity.arrow.hit_player') o(ev, p); }));
brk('hit_player always', wrap(Cb, 'arrowPlayerHit', (o) => (a, t) => { a.shooter = { type: 'player' }; o(a, {type:'player'}); }));
console.log(`arrowsoundcheck: ${pass} ok, ${fails.length} failed`);
fails.forEach((f) => console.log('  x ' + f));
console.log(` assertions passed .... ${pass + caught}`);
console.log(` failures ........... ${fails.length}`);
console.log(`${caught} breaks caught`);
process.exit(fails.length ? 1 : 0);
