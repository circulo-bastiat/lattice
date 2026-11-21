#!/usr/bin/env node
// createworldcheck.mjs — #11230: CREATE NEW WORLD screen, driven with REAL clicks and keys in the BUILT dist/mclite.html at file://.
// Singleplayer -> Create New World: every control present with the vanilla label; the typed name/seed/mode/difficulty/cheats reach the
// world that is actually generated (Save.seed64 / Diff / Player.mode / Save.cheats, commands blocked with cheats off); hardcore forces hard +
// cheats off; the Game Rules screen lists the 1.18.2 GameRules registry (names/types/defaults parsed from .decomp); Data Packs opens the pack
// screen; Cancel returns to Select World.
// ANTI-VACUITY: mutated copies of the built page (dispatch, screen, writer, hardcore, cheats gate, seed) must each fail the scenario.
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { open, sleep } from './cdp.mjs';

const DIST = resolve('dist/mclite.html');
const E = (c) => new Function(c);
let pass = 0; const fails = [];

// 1.18.2 GameRules registry from .decomp: name -> [type, default]
function vanillaRules() {
  const f = resolve('.decomp/net/minecraft/world/GameRules.java');
  if (!existsSync(f)) return null;
  const src = readFileSync(f, 'utf8'), out = {};
  const re = /"(\w+)",\s*GameRules\.Category\.\w+,\s*GameRules\.(Boolean|Int)Rule\.create\((\w+)/g; let m;
  while ((m = re.exec(src))) out[m[1]] = [m[2] === 'Boolean' ? 'bool' : 'int', m[3]];
  return out;
}

async function scenario(file, port, quiet) {
  const page = await open(file, { port, width: 900, height: 600 });
  if (!page) { console.log('SKIP  createworldcheck: no Chromium'); process.exit(0); }
  const a = (c, m) => { if (!c) throw new Error(m); if (!quiet) { pass++; console.log('ok    ' + m); } };
  const title = async () => { await sleep(2500); await page.waitFor(() => !!(window.MCL && MCL.Main.titleShown && MCL.Hud.mode === 'title' && MCL.Hud.titleView === 'main'), 60000); };
  const playing = async () => { await sleep(3000); const r = await page.waitFor(() => !!(window.MCL && MCL.Main.ready && MCL.Hud.mode === 'game' && MCL.World.chunks.size > 20), 240000); if (!r) throw new Error('world never came up'); };
  const labels = () => page.evaluate(() => MCL.Hud.hit.map((q) => q.label + (q.disabled ? '|off' : '')));
  const has = async (l) => (await labels()).includes(l);
  const click = async (label) => {
    const r = await page.evaluate(new Function('return (' + `(() => { const h = MCL.Hud.hit.find((q) => q.label === ${JSON.stringify(label)}); return h ? { x: h.x + h.w / 2, y: h.y + h.h / 2 } : null; })()` + ')'));
    if (!r) throw new Error('no "' + label + '" on screen: ' + (await labels()).join(' / '));
    await page.click(r.x, r.y); await sleep(350);
  };
  const view = () => page.evaluate(() => MCL.Hud.titleView);
  const typeKeys = async (s) => { for (const ch of s) await page.key(ch, ch); await sleep(100); };
  try {
    await title();
    await click('Singleplayer'); await sleep(400);
    await click('Create New World');
    a((await view()) === 'create', 'Create New World opens the create screen');
    for (const l of ['Game Mode: Survival', 'Difficulty: Normal', 'Allow Cheats: OFF', 'Data Packs', 'Game Rules', 'More World Options...', 'Create New World', 'Cancel', 'name'])
      a(await has(l), 'main page has "' + l + '"');
    // name field: replace the default with a typed name
    await click('name');
    for (let i = 0; i < 20; i++) await page.key('Backspace');
    await typeKeys('Zed');
    { const nm = await page.evaluate(() => MCL.CreateWorld.st.name); a(nm === 'Zed', 'the typed World Name is held (' + nm + ')'); }
    // More World Options
    await click('More World Options...');
    for (const l of ['Generate Structures: ON', 'World Type: Default', 'Bonus Chest: OFF', 'Done', 'seed'])
      a(await has(l), 'More World Options has "' + l + '"');
    await click('World Type: Default'); a(await has('World Type: Large Biomes'), 'World Type cycles to Large Biomes');
    await click('World Type: Large Biomes'); await click('World Type: AMPLIFIED'); await click('World Type: Superflat'); a(await has('World Type: Single Biome') && await has('Customize'), 'World Type reaches Single Biome (#11327) with a Customize button'); await click('World Type: Single Biome'); a(await has('World Type: Default'), 'World Type cycles back to Default');
    await click('Generate Structures: ON'); a(await has('Generate Structures: OFF'), 'Generate Structures toggles OFF');
    await click('Generate Structures: OFF');
    await click('seed'); await typeKeys('31337');
    a(await page.evaluate(() => MCL.Hud.titleSeed) === '31337', 'the seed field holds what was typed');
    await click('Done'); a(await has('Game Mode: Survival'), 'Done returns to the main page');
    // hardcore rules
    await click('Game Mode: Survival'); a(await has('Game Mode: Hardcore'), 'Game Mode cycles to Hardcore');
    a((await labels()).includes('Difficulty: Hard|off'), 'Hardcore forces Difficulty: Hard and inactive');
    a((await labels()).includes('Allow Cheats: OFF|off'), 'Hardcore forces Allow Cheats: OFF and inactive');
    await click('Game Mode: Hardcore'); a(await has('Game Mode: Creative'), 'Game Mode cycles to Creative');
    a(await has('Allow Cheats: ON'), 'Creative turns cheats ON until touched');
    await click('Game Mode: Creative'); a(await has('Game Mode: Survival'), 'Game Mode cycles back to Survival');
    a(await has('Allow Cheats: OFF'), 'Survival turns cheats back OFF');
    await click('Difficulty: Normal'); a(await has('Difficulty: Hard'), 'Difficulty cycles (Normal -> Hard)');
    await click('Difficulty: Hard'); await click('Difficulty: Peaceful'); await click('Difficulty: Easy'); // -> peaceful, easy, normal
    a(await has('Difficulty: Normal'), 'Difficulty cycles through all four');
    // Game Rules screen vs the 1.18.2 registry
    await click('Game Rules');
    a((await view()) === 'options' && await page.evaluate(() => MCL.Options.screen) === 'gamerules', 'Game Rules opens the Edit Game Rules screen');
    const reg = await page.evaluate(() => { const o = {}; MCL.GameRules.registry().forEach((c) => c.rules.forEach((r) => { o[r.name] = [r.type, String(r.def)]; })); return o; });
    const van = vanillaRules();
    if (van) {
      const miss = Object.keys(van).filter((n) => !reg[n] || reg[n][0] !== van[n][0] || reg[n][1] !== van[n][1]), extra = Object.keys(reg).filter((n) => !van[n]);
      a(!miss.length && !extra.length, 'the rules list matches the 1.18.2 GameRules registry (' + Object.keys(van).length + ' rules; missing/wrong: ' + miss.join(',') + '; extra: ' + extra.join(',') + ')');
    }
    await page.key('Escape'); await sleep(300);
    a((await view()) === 'create' && await has('Game Rules'), 'leaving Game Rules returns to Create New World');
    await click('Data Packs');
    a(await page.evaluate(() => MCL.Options.screen) === 'datapacks', 'Data Packs opens the pack screen');
    await page.key('Escape'); await sleep(300);
    a((await view()) === 'create', 'leaving Data Packs returns to Create New World');
    // Cancel -> Select World
    await click('Cancel'); a((await view()) === 'worlds', 'Cancel returns to Select World');
    await click('Create New World');
    a(await page.evaluate(() => MCL.CreateWorld.st.name) !== 'Zed', 'a fresh screen starts with a fresh state');
    // World 1: seed typed, hardcore -> real boot
    await click('name'); for (let i = 0; i < 20; i++) await page.key('Backspace'); await typeKeys('HC');
    await click('Game Mode: Survival');
    await click('More World Options...'); await click('seed'); await typeKeys('31337'); await click('Done');
    await click('Create New World'); await playing();
    const st = await page.evaluate(E(`var S=MCL.Save;return {seed:String(S.seed64),hard:MCL.Diff.hardcore,diff:MCL.Diff.value,cheats:S.cheats,mode:MCL.Player.mode,
      name:(MCL.Worlds.list?1:0),cmd:MCL.Commands.run('/gamemode creative',MCL.Player)};`));
    a(st.seed === '31337', 'the seed typed is the seed used (' + st.seed + ')');
    a(st.hard === true && st.diff === 'hard', 'hardcore world: Diff.hardcore and difficulty hard (' + st.diff + ')');
    a(st.cheats === false, 'hardcore world: cheats off');
    a(st.cmd && st.cmd.ok === false, 'cheats off: /gamemode creative is refused');
    const wl = await page.evaluate(() => MCL.Worlds.ready.then(() => new Promise((r) => setTimeout(r, 800))).then(() => MCL.Worlds.list().then((l) => l.map((x) => x.name))));
    a(wl.includes('HC'), 'the world record carries the typed name (' + wl.join(',') + ')');
    // World 2: creative with cheats on
    await page.evaluate(() => { setTimeout(() => location.reload(), 10); return 1; }); await title();
    await click('Singleplayer'); await sleep(400); await click('Create New World');
    await click('Game Mode: Survival'); await click('Game Mode: Hardcore'); // -> creative
    await click('More World Options...'); await click('seed'); await typeKeys('555'); await click('Done');
    await click('Create New World'); await playing();
    const s2 = await page.evaluate(E(`var S=MCL.Save;return {seed:String(S.seed64),cheats:S.cheats,mode:MCL.Player.mode,hard:MCL.Diff.hardcore,cmd:MCL.Commands.run('/gamemode survival',MCL.Player)};`));
    a(s2.seed === '555' && s2.mode === 1 && s2.cheats === true && !s2.hard, 'creative world: own seed, creative mode, cheats on, not hardcore (' + JSON.stringify(s2) + ')');
    a(s2.cmd && s2.cmd.ok === true, 'cheats on: /gamemode survival is accepted');
  } catch (e) { await page.close && page.close(); return String(e.message || e); }
  await page.close && page.close();
  return null;
}

const real = await scenario(DIST, 9481, false);
if (real) { console.log('FAIL createworldcheck: ' + real); process.exit(1); }
const html = readFileSync(DIST, 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'cwc-'));
const mutants = [
  ['the create view dispatch removed', "return (NS.CreateWorld && !H.titleHasSave) ? NS.CreateWorld.draw(c, H.w, H.h, s) : H.drawCreateWorld(c);", 'return H.drawCreateWorld(c);'],
  ['the Create New World screen removed', "else if (id === 'create') CW.create();", "else if (id === 'create') {}"],
  ['the setting writer call removed', 'var o = CW.apply();', 'var o = { seed: H().titleSeed };'],
  ['hardcore no longer forces hard', "CW.effDifficulty = function () { return CW.hardcore() ? 'hard' : CW.st.difficulty; };", 'CW.effDifficulty = function () { return CW.st.difficulty; };'],
  ['the cheats gate removed', "if (NS.Save && NS.Save.cheats === false) opts = Object.assign({}, opts, { level: 0 });", ''],
  ['the typed seed dropped', 'return { seed: H().titleSeed };', 'return { seed: "" };'],
];
let caught = 0, n = 0;
for (const [name, from, to] of mutants) {
  if (!html.includes(from)) { fails.push('mutant target missing: ' + name); continue; }
  const f = join(dir, 'm' + n + '.html'); writeFileSync(f, html.split(from).join(to));
  const bad = await scenario(f, 9482 + n++, true);
  if (bad) { caught++; console.log('  ✓ break caught: ' + name + ' (' + bad.slice(0, 120) + ')'); } else fails.push('break NOT caught: ' + name);
}
console.log(`createworldcheck: ${pass} assertions, ${caught} breaks caught`);
if (fails.length) { console.log('FAIL createworldcheck'); fails.forEach((f) => console.log('  x ' + f)); process.exit(1); }
console.log('PASS createworldcheck');
