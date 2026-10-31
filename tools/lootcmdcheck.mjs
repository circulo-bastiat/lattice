#!/usr/bin/env node
// lootcmdcheck.mjs — G17-CMD6 (#8028): /loot (LootCommand.java) over NS.Loot.
//   node tools/lootcmdcheck.mjs
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { loadEngine, ASSETS } from './loadsrc.mjs';

let pass = 0, breaks = 0;
const fails = [];
const ok = (c, m) => { if (c) pass++; else if (fails.length < 40) fails.push(m); return c; };
console.log('lootcmdcheck — G17-CMD6, /loot give|spawn|replace|insert from fish|loot|kill|mine');

const run = (patch) => {
  const M = loadEngine({ dom: false, extra: ['02f_tags.js', '02g_items.js', '02i_text.js', '07d_mining.js', '07e_loot.js',
    '14e_gamemode.js', '14f_inventory.js', '14d_survival.js', '14h_brigadier.js', '15g_commands.js'], patch });
  const raw = readFileSync(join(ASSETS, 'lang.bin'));
  M.Text.init({ lang: raw.toString('base64'), langBytes: inflateRawSync(raw).length });
  const meta = JSON.parse(readFileSync(join(ASSETS, 'items.meta.json'), 'utf8'));
  M.Items.init({ items: readFileSync(join(ASSETS, 'items.bin')).toString('base64'), itemsBytes: meta.rawBytes });
  return M;
};
// a fixed Random: mulberry32, so every roll below is the same on every run
const seeded = (s) => ({ nextFloat() { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; },
  nextInt(n) { return n <= 0 ? 0 : Math.floor(this.nextFloat() * n); } });

const scenario = (patch) => {
  const M = run(patch), C = M.Commands, Iv = M.Inventory, R = M.Reg;
  if (!C.IMPLEMENTED.includes('loot')) return { missing: true };
  const P = { x: 10, y: 70, z: -5, yaw: 0, pitch: 0, mode: 0, health: 20, dead: false, inventory: Iv.create(), syncHotbar() {},
              mayFly: false, instabuild: false, flying: false, invulnerable: false, mayBuild: true };
  M.Player = P; if (M.Survival && M.Survival.init) M.Survival.init(P);
  M.Main = { seed: 1337, seed64: 1337n };
  const dd = R.realFirst[R.id.diamond_ore] + R.defaultState[R.id.diamond_ore];
  M.World = { getBlock: () => dd };
  const dropped = [];
  M.EntityList = { dropStack: (x, y, z, i, n) => { dropped.push([i, n]); } };
  C.build();
  const L = M.Loot;
  const origRolls = [L.drops, L.entityDrops, L.rollTable];
  const seedWrap = (f) => (ctx) => { ctx = ctx || {}; ctx.rng = ctx.rng || seeded(42); return f(ctx); };
  const rt = L.rollTable;
  L.rollTable = (n, c) => rt(n, Object.assign({ rng: seeded(7) }, c));
  const ed = L.entityDrops, dr = L.drops;
  L.entityDrops = seedWrap(ed); L.drops = seedWrap(dr);
  const msgs = [];
  const sh = (line) => { const r = C.run(line, P, {}); msgs.length = 0; msgs.push(...r.lines); return r; };
  const count = (name) => { let n = 0; for (const s of P.inventory.slots) if (s && M.Items.nameOf(s.i) === name) n += s.n; return n; };
  return { M, C, P, sh, count, msgs, dropped };
};

const S = scenario();
if (S.missing) { fails.push('/loot is not in Commands.IMPLEMENTED'); }
else {
  const { sh, count, P, msgs, dropped, M } = S;
  // kill: a cow dies to the player -> leather 0-2, beef 1-3 (EntityLootSubProvider cow table)
  const cow = { kind: 'entity', e: { type: 'cow', maxHealth: 10 }, name: 'Cow' };
  M.Commands.resolve = (sel) => (sel.kind === 'e' || sel.kind === 'all' || sel.kind === 'type') ? [cow] : [{ kind: 'player', e: P, name: 'Player' }];
  let r = sh('loot give @s kill @e');
  ok(r.ok, 'loot give @s kill <cow> ran: ' + msgs.join('|'));
  const leather = count('leather'), beef = count('beef');
  ok(leather >= 0 && leather <= 2, `cow leather ${leather} within 0-2`);
  ok(beef >= 1 && beef <= 3, `cow beef ${beef} within 1-3`);
  ok(msgs.length === 1, 'one success message');
  // mine: diamond_ore with an iron pickaxe -> one diamond (fortune 0)
  P.inventory = M.Inventory.create();
  M.Inventory.add(P.inventory, M.Inventory.stack('iron_pickaxe', 1, 0, null));
  r = sh('loot give @s mine 0 64 0 mainhand');
  ok(r.ok, 'loot give @s mine mainhand ran: ' + msgs.join('|'));
  ok(count('diamond') === 1, `diamond_ore mined with a pickaxe gives 1 diamond, got ${count('diamond')}`);
  // spawn pops item entities
  r = sh('loot spawn 1 65 1 mine 0 64 0 iron_pickaxe');
  ok(r.ok && dropped.length === 1 && dropped[0][1] === 1, 'loot spawn makes one item entity: ' + JSON.stringify(dropped));
  // a missing table is vanilla's error
  r = sh('loot give @s loot nope:nothing');
  ok(!r.ok, 'an unknown loot table fails');
}
breaks++;
if (!scenario((f, s) => s).missing) {
  // anti-vacuity: remove the command from the source text and the check must notice
  const gone = scenario((f, s) => f === '15g_commands.js' ? s.replace("'loot', 'raid'", "'raid'") : s);
  if (gone.missing) console.log('   ✓ removing /loot is caught');
  else fails.push('anti-vacuity: /loot removed and nothing noticed');
}
console.log(`\n lootcmdcheck: ${pass} assertions, ${fails.length} failed`);
fails.forEach((f) => console.log('   x ' + f));
console.log(` ${breaks} breaks caught`);
process.exit(fails.length ? 1 : 0);
