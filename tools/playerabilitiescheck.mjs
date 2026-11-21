#!/usr/bin/env node
// playerabilitiescheck.mjs — proves PlayerAbilities (14e_gamemode.js Gamemode.abilities, the port of
// GameType.updatePlayerAbilities) through the REAL /gamemode command, and that cutting it fails.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEngine } from './loadsrc.mjs';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const M = loadEngine({ extra: ['02f_tags.js', '02g_items.js', '02i_text.js', '02n_nbt.js', '02j_sounds.js', '09b_sky.js',
  '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'] });
{
  const meta = JSON.parse(readFileSync(join(ROOT, 'assets/items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ROOT, 'assets/items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  const { inflateRawSync } = await import('node:zlib');
  const raw = readFileSync(join(ROOT, 'assets/lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
}
M.DATA = M.DATA || {}; M.DATA.gameRules = {};
const Gm = M.Gamemode, C = M.Commands;
C.build();
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
// vanilla GameType.updatePlayerAbilities: [mayFly, instabuild, invulnerable, flying, mayBuild]
const WANT = { survival: [0,0,0,0,1], creative: [1,1,1,0,1], adventure: [0,0,0,0,0], spectator: [1,0,1,1,0] };
function drive() {
  const out = {};
  const P = { type: 'player', x: 0, y: 70, z: 0, width: .6, height: 1.8, dead: false, inventory: M.Inventory.create(), slot: 0, syncHotbar() {} };
  M.Survival.init(P); Gm.set(P, Gm.SURVIVAL); M.Player = P;
  for (const n of Object.keys(WANT)) {
    const r = C.run('/gamemode ' + n, P, { level: 4 });
    out[n] = [r && r.ok, P.mayFly, P.instabuild, P.invulnerableGamemode, P.flying, P.mayBuild].map(Number);
  }
  return out;
}
function verify(tag) {
  const bad = [];
  const got = drive();
  for (const n of Object.keys(WANT)) {
    const g = got[n];
    if (!g[0] || g.slice(1).join() !== WANT[n].join()) bad.push(`${tag}${n}: got ${g}`);
  }
  return bad;
}
fails.push(...verify(''));
// leaving spectator must drop flight only when mayFly goes false
{ const P = { type:'player', inventory: M.Inventory.create(), slot:0, syncHotbar(){} }; Gm.set(P, Gm.SPECTATOR); Gm.set(P, Gm.SURVIVAL);
  ok(P.flying === false && P.mayFly === false, 'spectator->survival must clear flying'); }
let caught = 0;
const orig = Gm.abilities;
const cuts = [
  a => { a.mayFly = false; }, a => { a.instabuild = false; }, a => { a.invulnerable = false; },
  a => { a.flying = false; }, a => { a.mayBuild = true; }
];
for (const cut of cuts) {
  Gm.abilities = m => { const a = orig(m); cut(a); return a; };
  if (verify('cut:').length) caught++; else fails.push('anti-vacuity: a cut went unnoticed');
}
Gm.abilities = orig;
if (fails.length) { console.log('FAIL\n' + fails.join('\n')); process.exit(1); }
console.log(`playerabilitiescheck: ok, ${caught} breaks caught`);
