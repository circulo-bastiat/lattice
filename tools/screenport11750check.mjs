#!/usr/bin/env node
// screenport11750check.mjs — #11750: src/02q_screen.js against .decomp/net/minecraft/screen, and its reach into Menu.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const D = join(ROOT, '.decomp/net/minecraft/screen/');
const rd = f => readFileSync(D + f, 'utf8');
const src = readFileSync(join(ROOT, 'src/02q_screen.js'), 'utf8');
const menuSrc = readFileSync(join(ROOT, 'src/14g_menu.js'), 'utf8');
function load(code, menuCode) {
  const NS = {}; new Function('MCL', code)(NS);
  const calls = [];
  const Menu = { furnaceMenu: () => ({}), craftingMenu: () => ({}), dispenserMenu: () => ({}), beaconMenu: () => ({}),
    doClick: (...a) => { calls.push(a); return 'ok'; } };
  NS.Screen.attach(Menu);
  return { S: NS.Screen, Menu, calls, wired: /NS\.Screen\.attach\(Menu\)/.test(menuCode) };
}
const truthTypes = [...rd('ScreenHandlerType.java').matchAll(/register\("(\w+)"/g)].map(m => m[1]);
const truthEnum = rd('slot/SlotActionType.java').match(/enum SlotActionType \{([^}]*)\}/)[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
function scenario(code, menuCode) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  let L; try { L = load(code, menuCode); } catch (e) { return ['load: ' + e.message]; }
  const { S, Menu, calls } = L;
  chk(JSON.stringify(S.typeIds) === JSON.stringify(truthTypes), 'type registry differs from ScreenHandlerType.java');
  chk(JSON.stringify(S.SlotActionType) === JSON.stringify(truthEnum), 'SlotActionType differs from the enum');
  chk(L.wired, '14g_menu does not attach Screen');
  // fixed-literal slots from the Java, checked against the layouts
  const lits = { furnace: ['AbstractFurnaceScreenHandler.java', /new (?:Slot|FurnaceFuelSlot|FurnaceOutputSlot)\((?:this, )?(?:\$\$4\.player, )?\$\$5, (\d), (\d+), (\d+)\)/g, 3],
    crafting: ['CraftingScreenHandler.java', /CraftingResultSlot\(\$\$1\.player, this\.input, this\.result, (0), (\d+), (\d+)\)/g, 1],
    beacon: ['BeaconScreenHandler.java', /PaymentSlot\(this\.payment, (0), (\d+), (\d+)\)/g, 1],
    player: ['PlayerScreenHandler.java', /CraftingResultSlot\([^)]*?, (0), (\d+), (\d+)\)/g, 1] };
  for (const [h, [file, re, n]] of Object.entries(lits)) {
    const got = [...rd(file).matchAll(re)].map(m => [+m[1], +m[2], +m[3]]);
    chk(got.length === n, h + ' java literal parse ' + got.length);
    got.forEach(([i, x, y]) => { const s = S.handlers[h].slots.find(s => s[1] === i && s[0] !== 'inv' && s[0] !== 'grid');
      chk(s && s[2] === x && s[3] === y, h + ' slot ' + i + ' at ' + (s && s[2] + ',' + s[3]) + ' != ' + x + ',' + y); });
  }
  chk(/this\.addSlot\(new Slot\(\$\$5, 0, 56, 17\)\)/.test(rd('AbstractFurnaceScreenHandler.java')), 'java ingredient slot moved');
  chk(S.handlers.furnace.slots[0].join() === 'input,0,56,17', 'furnace ingredient slot');
  chk(S.handlers.player.slots.length === 46, 'player menu has 46 slots, got ' + S.handlers.player.slots.length);
  chk(S.handlers.furnace.slots.length === 39 && S.handlers.crafting.slots.length === 46 && S.handlers.generic_3x3.slots.length === 45 && S.handlers.beacon.slots.length === 37, 'slot counts');
  chk(S.handlers.furnace.data === 4 && S.handlers.beacon.data === 3, 'property counts');
  chk(S.handlers.blast_furnace.recipeType === 'blasting' && S.handlers.smoker.recipeType === 'smoking', 'cooking types');
  const pd = new S.ArrayPropertyDelegate(4); pd.set(2, 7);
  chk(pd.get(2) === 7 && pd.size() === 4, 'ArrayPropertyDelegate');
  let t = false; try { S.checkDataCount(new S.ArrayPropertyDelegate(2), 3); } catch (e) { t = true; } chk(t, 'checkDataCount must refuse a short delegate');
  chk(S.ScreenHandlerContext.EMPTY.getOr(() => 1, 9) === 9 && S.ScreenHandlerContext.create('w', 'p').getOr((w, p) => w + p, 0) === 'wp', 'context');
  t = false; try { S.implement('ScreenHandlerListener', { onSlotUpdate() {} }); } catch (e) { t = true; } chk(t, 'incomplete listener refused');
  chk(S.SimpleNamedScreenHandlerFactory((a, b, c) => a + b + c, 'N').getDisplayName() === 'N' && S.SimpleNamedScreenHandlerFactory((a, b, c) => a + b + c, 'N').createMenu(1, 2, 3) === 6, 'named factory');
  chk(Menu.furnaceMenu({ type: 'smoker' }).handlerType === S.types.smoker && Menu.furnaceMenu({ type: 'furnace' }).handlerType === S.types.furnace, 'furnace menu type');
  chk(Menu.beaconMenu().handlerType === S.types.beacon && Menu.craftingMenu().handlerType.id === 'crafting' && Menu.dispenserMenu().handlerType.id === 'generic_3x3', 'menu types');
  S.click({}, 3, 0, 'QUICK_CRAFT', {}); chk(calls[0] && calls[0][3] === 5, 'click maps QUICK_CRAFT to ordinal 5');
  return f;
}
const bad = scenario(src, menuSrc);
if (bad.length) { console.log('FAIL: ' + bad.join('; ')); process.exit(1); }
const breaks = [
  [s => s.replace("'generic_3x3', 'anvil'", "'anvil', 'generic_3x3'"), 'type order'],
  [s => s.replace("'QUICK_MOVE', 'SWAP'", "'SWAP', 'QUICK_MOVE'"), 'enum order'],
  [s => s.replace("'fuel', 1, 56, 53", "'fuel', 1, 56, 54"), 'furnace layout (not literal-checked, count)'],
  [s => s.replace("['result', 0, 124, 35]", "['result', 0, 124, 36]"), 'crafting result pos'],
  [s => s.replace("['payment', 0, 136, 110]", "['payment', 0, 136, 111]"), 'beacon payment pos'],
  [s => s.replace("['result', 0, 154, 28]", "['result', 0, 154, 29]"), 'player result pos'],
  [s => s.replace("pd.size() < expected", "false"), 'checkDataCount'],
  [s => s.replace("if (m) m.handlerType", "if (false) m.handlerType"), 'menu stamp'],
  [s => s.replace("S.ordinal(action) : action", "0 : action"), 'click mapping'],
  [s => s.replace("for (c = 0; c < 9; c++) o.push(['inv', c, 8 + c * 18, 142]);\n      o.push", "o.push"), 'player hotbar']
];
let caught = 0;
for (const [fn, why] of breaks) {
  const b = fn(src); if (b === src) { console.log('break did not apply: ' + why); process.exit(1); }
  if (scenario(b, menuSrc).length) caught++; else console.log('NOT caught: ' + why);
}
caught += scenario(src, menuSrc.replace('NS.Screen.attach(Menu)', 'void 0')).length ? 1 : 0;
if (caught !== breaks.length + 1) { console.log('FAIL: only ' + caught + ' breaks caught'); process.exit(1); }
console.log('PASS screenport11750check — ' + caught + ' breaks caught; 18 screen classes ported');
