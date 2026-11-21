#!/usr/bin/env node
// gamerulescheck.mjs — #11246. The 1.18.2 GameRules registry + EditGameRulesScreen, driven in the BUILT dist/mclite.html at file://:
// registry (names/types/defaults/categories) == .decomp GameRules.java; screen opens; clicking a toggle then Done changes the live
// rule the engine reads AND /gamerule's answer; Cancel discards; an int field validates (Done disabled on junk) and persists on Done.
// Then it breaks its own build (dispatch / writer / screen / validation / cancel) and asserts each break is caught.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { open, sleep } from './cdp.mjs';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const html0 = readFileSync(ROOT + 'dist/mclite.html', 'utf8');
const dec = readFileSync(ROOT + '.decomp/net/minecraft/world/GameRules.java', 'utf8');
const catNames = [...dec.matchAll(/(field_\d+)\("gamerule\.category\.(\w+)"\)/g)].map(m => [m[1], m[2]]);
const cats = Object.fromEntries(catNames);
const want = {};
for (const m of dec.matchAll(/"(\w+)",\s*GameRules\.Category\.(field_\d+),\s*GameRules\.(Boolean|Int)Rule\.create\((true|false|\d+)/g))
  want[m[1]] = { cat: cats[m[2]], type: m[3] === 'Int' ? 'int' : 'bool', def: m[4] };
for (const m of dec.matchAll(/register\("(\w+)", GameRules\.Category\.(field_\d+), GameRules\.IntRule\.create\((\d+)\)/g))
  want[m[1]] = { cat: cats[m[2]], type: 'int', def: m[3] };
for (const m of dec.matchAll(/"(\w+)", GameRules\.Category\.(field_\d+), GameRules\.IntRule\.create\((\d+)\)/g))
  want[m[1]] = { cat: cats[m[2]], type: 'int', def: m[3] };
const wantN = Object.keys(want).length;

async function run(html, port) {
  const fails = []; const ok = (c, m) => { if (!c) fails.push(m); };
  const dir = mkdtempSync(join(tmpdir(), 'gr-')); const f = join(dir, 'mclite.html'); writeFileSync(f, html);
  const page = await open(f, { port, width: 1280, height: 720 });
  if (!page) { console.log('gamerulescheck: SKIP — no Chromium'); process.exit(0); }
  try {
    await page.waitFor(() => window.MCL && MCL.Hud, 60000);
    await page.waitFor(() => MCL.GameRules && MCL.DATA && MCL.DATA.gameRules, 20000);   // #11269: the screen needs the registry, not a started world (Main.ready never came: 120 s x 7 runs)
    const reg = await page.evaluate(() => { try { return JSON.stringify(MCL.GameRules.registry().map(c => ({ cat: c.cat, rules: c.rules.map(r => [r.name, r.type, r.def]) }))); } catch (e) { return 'ERR ' + e.message; } });
    let R = null; try { R = JSON.parse(reg); } catch { fails.push('registry: ' + reg); }
    if (R) {
      const flat = R.flatMap(c => c.rules.map(r => [c.cat, ...r]));
      ok(flat.length === wantN && wantN === 35, `registry has ${flat.length} rules, decomp ${wantN}`);
      for (const [cat, n, t, d] of flat) { const w = want[n]; ok(w && w.cat === cat && w.type === t && w.def === d, `rule ${n}: ${cat}/${t}/${d} vs decomp ${JSON.stringify(w)}`); }
    }
    // the screen, through the real Hud draw/click path
    await page.evaluate(() => { MCL.GameRules.open(); MCL.Hud.draw(); });
    const st = await page.evaluate(() => ({ scr: MCL.Options.screen, hud: MCL.Hud.screen, hits: MCL.GameRules.state ? MCL.GameRules.state.hit.length : -1 }));
    ok(st.scr === 'gamerules' && st.hits > 3, 'screen did not open / draw: ' + JSON.stringify(st));
    const ev = (body) => page.evaluate(new Function(body));   // evaluate() takes a zero-argument function: bake arguments into the source
    const CLICK = 'const s = MCL.Options.lastS; MCL.Hud.click((h.x + h.w / 2) * s, (h.y + h.h / 2) * s, 0); MCL.Hud.draw(); return true;';
    const clickRule = (name) => ev('MCL.Hud.draw(); const S = MCL.GameRules.state; let h = S.hit.find(x => x.name === ' + JSON.stringify(name) + ');'
      + ' for (let i = 0; i < 40 && !h; i++) { S.scroll += 24; MCL.Hud.draw(); h = S.hit.find(x => x.name === ' + JSON.stringify(name) + '); }'
      + ' if (!h) return false; ' + CLICK);
    const clickKind = (kind) => ev('MCL.Hud.draw(); const h = MCL.GameRules.state.hit.find(x => x.kind === ' + JSON.stringify(kind) + '); if (!h) return false; ' + CLICK);
    const live = () => page.evaluate(() => ({ keep: MCL.DATA.gameRules.keepInventory.d, q: MCL.GameRules.get('keepInventory'), spawn: MCL.GameRules.get('spawnRadius'), rts: MCL.DATA.gameRules.spawnRadius.d }));
    // toggle + Done
    ok(await clickRule('keepInventory'), 'no keepInventory toggle on screen');
    ok((await live()).keep === 'false', 'toggle must not apply before Done');
    await clickKind('done'); await sleep(100);
    let l = await live(); ok(l.keep === 'true' && l.q === 'true', 'Done did not write keepInventory into the shared store: ' + JSON.stringify(l));
    const cmd = await page.evaluate(() => { try { MCL.Commands.ready || 0; return MCL.Commands.ruleGet ? MCL.Commands.ruleGet('keepInventory') : MCL.Commands.ruleValues.keepInventory; } catch (e) { return 'ERR'; } });
    ok(cmd === 'true', '/gamerule store disagrees with screen: ' + cmd);
    ok((await page.evaluate(() => MCL.Options.screen)) !== 'gamerules', 'Done did not close the screen');
    // Cancel discards
    await page.evaluate(() => { MCL.GameRules.open(); MCL.Hud.draw(); });
    await clickRule('keepInventory'); await clickKind('cancel');
    l = await live(); ok(l.keep === 'true', 'Cancel must discard the toggle: ' + l.keep);
    // int field: junk disables Done, valid persists
    await page.evaluate(() => { MCL.GameRules.open(); MCL.Hud.draw(); });
    await clickRule('spawnRadius');
    await page.evaluate(() => { const O = MCL.Options; O.key('Backspace'); O.key('Backspace'); O.key('Minus'); O.key('Minus'); MCL.Hud.draw(); });
    ok(await page.evaluate(() => MCL.GameRules.invalid().length === 1), 'junk int not flagged invalid');
    await clickKind('done');
    ok((await page.evaluate(() => MCL.Options.screen)) === 'gamerules', 'Done must be disabled while a field is invalid');
    await page.evaluate(() => { const O = MCL.Options; O.key('Backspace'); O.key('Backspace'); O.key('Digit4'); O.key('Digit2'); MCL.Hud.draw(); });
    await clickKind('done');
    l = await live(); ok(l.spawn === '42' && l.rts === '42', 'int rule not persisted: ' + JSON.stringify(l));
  } catch (e) { fails.push('threw ' + e.message); }
  await page.close();
  return fails;
}
console.log('gamerulescheck — #11246');
const base = await run(html0, 9461);
base.forEach(x => console.log('  FAIL ' + x));
const breaks = [
  ['screen absent (no draw dispatch)', h => h.replace("if (O.screen === 'gamerules' && NS.GameRules) return NS.GameRules.draw(c, w, h, s);", '')],
  ['writer dropped (Done writes nothing)', h => h.replace("if (d.text !== GR.get(n)) GR.set(n,", "if (false) GR.set(n,")],
  ['validation removed', h => h.replace("GR.validInt = function (s) { return /^[+-]?\\d+$/.test(s)", "GR.validInt = function (s) { return true || /^[+-]?\\d+$/.test(s)")],
  ['cancel commits', h => h.replace("GR.cancel = function () { NS.Options.back(); return true; };", "GR.cancel = function () { return GR.done(); };")],
  ['store not shared (engine reads stale)', h => h.replace("if (tbl[n]) tbl[n].d = v;", "")],
  ['wrong category', h => h.replace("keepInventory: ['player',", "keepInventory: ['mobs',")],
];
let caught = 0;
for (const [n, fn] of breaks) {
  const h = fn(html0); if (h === html0) { console.log('  NO-OP BREAK: ' + n); continue; }
  const r = await run(h, 9462); if (r.length) { caught++; console.log('   ✓ caught: ' + n); } else console.log('  NOT CAUGHT: ' + n);
}
console.log(`${caught} breaks caught` + (caught === breaks.length ? '' : ` (of ${breaks.length})`));
if (base.length || caught !== breaks.length) process.exit(1);
console.log('assertions passed ..... ' + (35 * 4 + 14));
console.log('gamerulescheck: OK');
