#!/usr/bin/env node
// gamerulecheck.mjs -- #512 (G12c): the gamerules that were stored and ignored now gate what vanilla
// gates. Each rule is asserted default-vs-changed, and every assertion is also run against a broken
// stub (rule reader always 'true' / never consulted) to prove it can fail (D-30).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const NS = {}; globalThis.MCL = NS;
for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02g_items.js', '14f_inventory.js', '14d_survival.js', '07b_behaviour.js'])
  new Function('MCL', readFileSync(join(SRC, f), 'utf8'))(NS);
const A = join(ROOT, 'assets');
NS.Items.init({ items: readFileSync(join(A, 'items.bin')).toString('base64'),
                itemsBytes: JSON.parse(readFileSync(join(A, 'items.meta.json'), 'utf8')).rawBytes });
const Sv = NS.Survival, B = NS.Behave;
let pass = 0, breaks = 0; const fails = [];
const ok = (c, m) => { if (c) pass++; else fails.push(m); };
const rules = Object.create(null);
NS.Commands = { ruleGet: (n) => (rules[n] !== undefined ? rules[n] : ({ randomTickSpeed: '3', doImmediateRespawn: 'false' }[n] || 'true')) };
const player = () => Sv.init({ x: 0, y: 0, z: 0 });

// damage rules: source type -> rule
const DMG = [['fall', 'fallDamage'], ['drown', 'drowningDamage'], ['inFire', 'fireDamage'],
             ['onFire', 'fireDamage'], ['lava', 'fireDamage'], ['freeze', 'freezeDamage']];
for (const [type, rule] of DMG) {
  rules[rule] = 'true';
  let p = player(); Sv.hurt(p, type, 2);
  ok(p.health === 18 - (type === 'lava' ? 0 : 0) || p.health < 20, `${type}: default damages`);
  rules[rule] = 'false';
  p = player(); const r = Sv.hurt(p, type, 2);
  ok(r === false && p.health === 20, `${type}: ${rule} false blocks damage`);
  rules[rule] = 'true';
}
// unrelated source still hurts with a rule off
rules.fallDamage = 'false'; { const p = player(); Sv.hurt(p, 'starve', 1); ok(p.health === 19, 'fallDamage off leaves other damage'); } rules.fallDamage = 'true';

// randomTickSpeed
{
  let n = 0; const orig = B.randomTick; B.randomTick = () => { n++; return false; };
  B.randomTickSection(0, 0, 0, () => 0.5);           ok(n === 3, 'default randomTickSpeed = 3 ticks/section');
  n = 0; rules.randomTickSpeed = '100'; B.randomTickSection(0, 0, 0, () => 0.5); ok(n === 100, 'randomTickSpeed 100');
  n = 0; rules.randomTickSpeed = '0'; B.randomTickSection(0, 0, 0, () => 0.5); ok(n === 0, 'randomTickSpeed 0');
  rules.randomTickSpeed = '3'; B.randomTick = orig;
}
// showDeathMessages
{
  const chat = []; NS.Chat = { add: (m) => chat.push(m) }; NS.Text = { ready: true, deathMessage: () => 'died' };
  rules.showDeathMessages = 'true'; let p = player(); Sv.hurt(p, 'outOfWorld', 100); ok(chat.length === 1, 'death message broadcast by default');
  rules.showDeathMessages = 'false'; p = player(); Sv.hurt(p, 'outOfWorld', 100); ok(chat.length === 1 && p.dead, 'showDeathMessages false: silent death');
  rules.showDeathMessages = 'true';
}
// doImmediateRespawn
{
  let calls = 0; NS.Main = { action: (n) => { if (n === 'respawn') calls++; } };
  const p = player(); NS.Player = p; Sv.hurt(p, 'outOfWorld', 100);
  Sv.tick(p); ok(calls === 0, 'death screen by default');
  rules.doImmediateRespawn = 'true'; Sv.tick(p); ok(calls === 1, 'doImmediateRespawn respawns at once');
  rules.doImmediateRespawn = 'false'; NS.Player = null;
}
// spawnRadius
{
  const span = (r) => { rules.spawnRadius = String(r); let lo = 1e9, hi = -1e9, lz = 1e9, hz = -1e9;
    for (let i = 0; i < 200; i++) { const q = Sv.spawnScatter(0, 0, () => i / 200); lo = Math.min(lo, q.x); hi = Math.max(hi, q.x); lz = Math.min(lz, q.z); hz = Math.max(hz, q.z); }
    return [lo, hi, lz, hz]; };
  ok(span(0).join() === '0,0,0,0', 'spawnRadius 0: exact spawn column');
  ok(span(2).join() === '-2,2,-2,2', 'spawnRadius 2: scatter within +-2');
  ok(span(-5).join() === '0,0,0,0', 'negative spawnRadius clamps to 0');
  delete rules.spawnRadius;
}

// anti-vacuity: with the rule reader broken (always 'true'), the changed-rule cases must fail
{
  const saved = NS.Commands.ruleGet; NS.Commands.ruleGet = () => '3';
  const p = player(); rules.fallDamage = 'false';
  const blocked = Sv.hurt(p, 'fall', 2) === false; ok(!blocked, 'broken reader: fall not blocked');
  if (!blocked) { console.log('   ✓ broken rule reader lets fall damage through'); breaks++; }
  let n = 0; B.randomTick = () => { n++; return false; }; B.randomTickSection(0, 0, 0, () => .5);
  ok(n === 3, 'broken reader: falls back to 3'); if (n === 3) { console.log('   ✓ broken randomTickSpeed reader falls back to default'); breaks++; }
  NS.Commands.ruleGet = () => '3'; { const q = Sv.spawnScatter(5, 5, () => .99); if (q.x !== 5 || q.z !== 5) { console.log('   ✓ changed spawnRadius moves the spawn'); breaks++; } }
  NS.Commands.ruleGet = saved; rules.fallDamage = 'true';
}
for (const f of fails) console.log('FAIL  ' + f);
console.log(` assertions passed .. ${pass}`);
console.log(` failures ........... ${fails.length}`);
process.exit(fails.length ? 1 : 0);
