// 15b_gui.js — PLAN G11. Vanilla's GUI sheets, its bitmap font, and the screens they draw.
//
// MAIN THREAD, and it uses canvas — this is the one part of the game that IS 2D drawing.
//
// ⚠ THE SHEETS ARE VANILLA'S OWN PIXELS (D-274). `tools/build-gui.mjs` lifts seven PNGs out of
// the 1.13.2 jar — widgets, icons, the inventory/crafting/furnace/chest backgrounds and the
// legacy font — and ships them as 38 KB of deflated RGBA. Nothing here is drawn with rectangles
// and gradients: the charter's "absolute full parity" covers the GUI explicitly, and a hand-drawn
// heart is exactly the kind of thing that reads as "not quite Minecraft" from across a room.
//
// ⚠ THE SHEET COORDINATES ARE THE ONE THING HERE THAT IS NOT DERIVED, and `guicheck` treats them
// accordingly: every rectangle this file names is ASSERTED AGAINST THE TEXTURE — the full heart
// is red, the empty container is dark, the hunger icon is brown, the XP bar's two rows differ.
// A blit coordinate that drifted would otherwise draw a plausible-looking wrong icon for ever.

(function (NS) {
  'use strict';

  var G = NS.Gui = {
    ready: false,
    sheets: null,         // name -> { w, h, canvas }
    widths: null,         // Uint8Array(256): the measured glyph advance
    cell: 8,
    // ── vanilla's sheet rectangles, all asserted against the pixels by `guicheck` ──────────
    ICON: {
      heartBg:      [16, 0, 9, 9],
      heartBgBlink: [25, 0, 9, 9],
      heartFull:    [52, 0, 9, 9],
      heartHalf:    [61, 0, 9, 9],
      armourEmpty:  [16, 9, 9, 9],
      armourHalf:   [25, 9, 9, 9],
      armourFull:   [34, 9, 9, 9],
      bubbleFull:   [16, 18, 9, 9],
      bubblePop:    [25, 18, 9, 9],
      hungerBg:     [16, 27, 9, 9],
      hungerFull:   [52, 27, 9, 9],
      hungerHalf:   [61, 27, 9, 9],
      xpBarBg:      [0, 64, 182, 5],
      xpBarFg:      [0, 69, 182, 5],
      // QUEUE 0.2 (G18e remainder) -- `InGameHud.renderMountJumpBar` (.decomp, javap'd):
      // same sheet, same x/y as the XP bar the jump bar REPLACES while riding a jumping mount,
      // one row lower (84/89 instead of 64/69). `15_hud.js` (jump-bar scope only) is the caller.
      jumpBarBg:    [0, 84, 182, 5],
      jumpBarFg:    [0, 89, 182, 5]
    },
    WIDGET: {
      hotbar:    [0, 0, 182, 22],
      // ⚠ 24 WIDE, 22 TALL — out of the bytecode, not out of a guess. `Gui.renderHotbar` blits
      // `(0, 22, 24, 22)`; reading the source height as 24 pulled two rows of the NEXT sprite in
      // `widgets.png` down under the selected slot, which is half of why Dan said the selected
      // slot "does not look correct at all".
      selector:  [0, 22, 24, 22]
    },
    // The player's own screen: 176x166, and the slot origins are vanilla's `InventoryMenu`.
    INV: {
      w: 176, h: 166,
      // D-650 — `InventoryScreen` (.decomp): title "container.crafting" at `titleX = 97`, the
      // default `titleY = 6`; its OWN `drawForeground` draws ONLY the title — no "Inventory" label.
      title: { x: 97, y: 6 },
      result: [154, 28],
      grid: [98, 18],                  // 2x2, 18 apart
      armour: [8, 8],                  // 4 down, 18 apart
      offhand: [77, 62],
      main: [8, 84],                   // 9 x 3, 18 apart
      hotbar: [8, 142]
    },
    // The chest screen — PASS 17 JOB 1 (G19b). `w`/`row0`/`invY`/`hotbarY`/`h` are vanilla's
    // own `ChestMenu`/`ChestScreen` numbers (see `Menu.chestMenu`'s own caveat: transcribed from
    // public mapped decompiles, not yet re-walked against this project's bytecode). `rows` is 3
    // for the plain chest this session wires up; the formulas already generalise to 6 (a double
    // chest) for whichever future session builds that merged container.
    CHEST: {
      w: 176,
      row0: [8, 18],                    // first of the rows*9 container slots, 18 apart
      // D-652 — `GenericContainerScreenHandler` (.decomp:57-72): `103 + row*18 + (rows-4)*18` and
      // `161 + (rows-4)*18`. Were 104/162 — one pixel low, hidden by a bottom-band blit from source
      // y=125 (vanilla 126) that was one pixel low the same way.
      invY: function (rows) { return 103 + (rows - 4) * 18; },   // the player's own 3 rows
      hotbarY: function (rows) { return 161 + (rows - 4) * 18; },
      h: function (rows) { return rows * 18 + 114; },            // 3 -> 168, 6 -> 222 (=texture h)
      // D-650 — `GenericContainerScreen` (.decomp): default title (8, 6); the "Inventory" label at
      // `playerInventoryTitleY = backgroundHeight - 94` = rows*18 + 20 (3 -> 74, 6 -> 128).
      title: { x: 8, y: 6 },
      invLabelY: function (rows) { return rows * 18 + 114 - 94; }
    },
    // The crafting table screen — PASS 17 JOB 1 (G19b), session 44. Vanilla's own
    // `CraftingMenu`/`CraftingScreen` numbers, same transcribed-not-yet-bytecode-walked standing
    // as `CHEST` above. 176x166 — the SAME footprint as `INV`, and `main`/`hotbar` below are
    // `INV.main`/`INV.hotbar`'s own numbers, because it is the same player-inventory footer
    // every survival screen shares.
    // The shulker box screen — PASS 17 JOB 1 (G19b), D-406. UNLIKE the chest/barrel/ender chest
    // (which all crop different-`rows` windows out of the SAME 176x222 `generic_54.png`, always
    // reading its fixed bottom player-inventory band from source y=125), `shulker_box.png` is
    // vanilla's own SEPARATE, dedicated, single-size (27-slot only) texture — measured directly
    // (its real opaque pixels: 166 rows, not 222), confirmed row-for-row identical to
    // `generic_54.png` for its top 71 rows (the border + 3 rows of slots) and for its own bottom
    // 95 rows against `generic_54.png`'s OWN bottom 95 rows (127..221) — see `guicheck` §4e.
    // Because it is a whole, self-contained image rather than a crop of a bigger multi-size
    // sheet, `Hud.drawChest` draws it as a plain two-piece 1:1 blit off ITS OWN rows (0..70 then
    // 71..165), with no generic_54-style fixed-offset trick needed at all.
    // D-650 — `ShulkerBoxScreen` does `backgroundHeight++` AFTER `super()`, which had already set
    // `playerInventoryTitleY = 166 - 94` — so the label stays at 72, not 73.
    // D-652 — `ShulkerBoxScreenHandler` (.decomp:29-40): its OWN footer, (8, 84) and (8, 142), not the
    // chest's rows=3 formula (which drew every backpack/hotbar stack 2px low on shulker_box.png).
    SHULKER: { w: 176, h: 166, title: { x: 8, y: 6 }, inventoryLabel: { x: 8, y: 72 },
               main: [8, 84], hotbar: [8, 142] },
    // The villager trading screen (row 0 item 5 / G18f GUI polish, D-48x/D-483).
    // `clq` (GuiMerchant, 1.13.2 jar) never overrides `cky`'s (GuiContainer) default
    // xSize/ySize (176/166, read off `cky`'s own constructor) — the pre-1.14 trading screen is
    // vanilla's ordinary container size, not 1.14's widened 276x166 `villager2.png` redesign.
    MERCHANT: { w: 176, h: 166 },
    // G22e -- GrindstoneScreenHandler slots (.decomp): inputs (49,19)/(49,40), result (129,34); panel 176x166.
    GRINDSTONE: { w: 176, h: 166 },
    GRINDSTONE_SLOT: { in1: [49, 19], in2: [49, 40], out: [129, 34] },
    // D-483 — THE REAL SLOTS AND WIDGETS, javap'd off `aqo` (`ContainerMerchant`, jar-verified
    // via `clq`'s own constructor: `new aqo(aof, axd, axy)` fed straight to `cky`'s super-ctor,
    // so `aqo` — not `aof` — is the real `Container`). `aqo`'s own ctor: `new aqx(f,0,36,53)`,
    // `new aqx(f,1,62,53)`, `new aqp(...,f,2,120,53)` — slots 0/1 the two payment inputs, slot 2
    // (a `SlotMerchantResult`-shaped subclass, `aqp`) the result. Player inventory/hotbar follow
    // at their ordinary (8+18i, 84+18row) / (8+18i, 142) — the same table every other screen uses.
    MERCHANT_SLOT: { in1: [36, 53], in2: [62, 53], out: [120, 53] },
    // D-483 — THE TWO ARROW WIDGETS, javap'd off `clq`'s own `c()` (init): `clq$1` (id 1, the
    // "next" arrow, `o`=true) at `guiLeft+147,guiTop+23`; `clq$2` (id 2, "previous", `o`=false)
    // at `guiLeft+17,guiTop+23`. Both are `clq$a` (a 12x19 `cgu`/Button), whose own render reads
    // `b(x,y,u,v,w,h)` off ITS jar-verified constants: u=176 normal, +12 hovered, +24 disabled
    // (`l`==false); v=0 for `o`==true (next), +19 (=19) for `o`==false (previous). Clicking
    // moves `clq`'s own trade index (`B`) by one, clamped to `[0, offers.length-1]` — one offer
    // shown at a time, not vanilla's later (1.14+) scrollable list, matching this pre-1.14 GUI.
    MERCHANT_ARROW: {
      w: 12, h: 19, u: 176,
      hoverDu: 12, disabledDu: 24,
      next: { x: 147, y: 23, v: 0 },
      prev: { x: 17, y: 23, v: 19 }
    },
    // The horse inventory screen (QUEUE 0.2 G18e remainder). `efp` (HorseScreen, Yarn name,
    // .decomp) never overrides `HandledScreen`'s own default backgroundWidth/backgroundHeight
    // (176x166, read off `HandledScreen.java` field initialisers) -- the pre-1.14 panel size
    // again. `HorseScreenHandler` (.decomp) puts the saddle slot at (8,18), the armour slot at
    // (8,36), then the SAME player main(8,102)/hotbar(8,142) footer every
    // survival screen here shares (`addSlot(new Slot($$1, i+row*9+9, 8+i*18, 102+row*18))`,
    // `addSlot(new Slot($$1, i, 8+i*18, 142))`). `title` is `HandledScreen`'s own default
    // (8,6), unoverridden. The chest-slot GRID geometry (`80+col*18, 18+row*18`, from
    // `HorseScreenHandler`'s `hasChest` branch) is now LIVE (loop/donkey-s96, QUEUE 0.2 G18e
    // remainder close) -- donkey/mule exist and `e.hasChest` reads true once one is attached;
    // `G.horseSlotXY`/`G.horseSlotAt` take a `chest` flag (`Mnt.isChestable(e) && e.hasChest`)
    // that shifts the player-inventory bands down by 15 slots and inserts the grid ahead of
    // them.
    HORSE: {
      w: 176, h: 166,
      saddle: [8, 18],
      armour: [8, 36],
      // D-550: `102 + row*18 + -18` (HorseScreenHandler, .decomp line 60) is y = 84 at row 0 --
      // the standard backpack row of every 166-high screen. It was 102 (the `-18` dropped), which
      // drew every backpack/hotbar-adjacent stack one row low on the real horse.png.
      main: [8, 84],
      hotbar: [8, 142],
      title: { x: 8, y: 6 },
      // `HorseScreen.drawBackground` (.decomp), the two equip-slot ICON blits, verbatim:
      // `drawTexture($$4+7, $$5+35-18, 18, backgroundHeight+54, 18, 18)` (saddle, at slot0's
      // own (8,18) minus the 1px slot border) and `drawTexture($$4+7, $$5+35, 0,
      // backgroundHeight+54, 18, 18)` (armour, non-llama `u`=0 -- the llama `u`=36 branch is
      // moot, no llama in this engine). `backgroundHeight`=166, so the source row is 166+54=220.
      saddleIcon: { u: 18, v: 220, w: 18, h: 18 },
      armourIcon: { u: 0, v: 220, w: 18, h: 18 },
      // D-550: `HorseScreen.drawBackground`'s llama branch -- the carpet slot's icon is u=36.
      llamaDecorIcon: { u: 36, v: 220, w: 18, h: 18 },
      // The chest grid's own source rect (`drawTexture($$4+79, $$5+17, 0, backgroundHeight,
      // cols*18, 54)`) and screen position -- named for parity, unreached (see the header above).
      // `cols` is donkey/mule's flat 5; a llama's is its strength 1..5 (D-550: callers pass it).
      chest: { u: 0, v: 166, x: 79, y: 17, rowH: 18, cellW: 18, cols: 5, rows: 3 }
    },
    CRAFTING: {
      w: 176, h: 166,
      result: [124, 35],
      grid: [30, 17],                  // 3x3, 18 apart — row-major, matching Recipes.craft
      // D-650 — `CraftingScreen.init` sets `titleX = 29`; the rest is `HandledScreen`'s default.
      title: { x: 29, y: 6 }, inventoryLabel: { x: 8, y: 72 },
      main: [8, 84],
      hotbar: [8, 142]
    },
    // The furnace / blast furnace / smoker screen — PASS 17 JOB 1 (G19b), D-414. Vanilla's
    // `AbstractFurnaceMenu` slot origins (transcribed, not bytecode-walked — see
    // `Menu.furnaceMenu`) on a 176x166 sheet that is the player-inventory footer again. `flame`
    // and `arrow` are BOTH the on-screen position AND the source rect on the sheet's right-hand
    // margin (x=176): the flame is 14 wide, drawn from the bottom up as the fuel burns down; the
    // arrow is 24 wide and 16 tall, drawn left to right. `guicheck` §4f asserts both against pixels.
    FURNACE: {
      w: 176, h: 166,
      input: [56, 17], fuel: [56, 53], result: [116, 35],
      main: [8, 84], hotbar: [8, 142],
      flame: { x: 56, y: 36, sx: 176, sy: 0, w: 14, h: 14 },
      arrow: { x: 79, y: 34, sx: 176, sy: 14, h: 16 },
      title: { y: 6 }, inventoryLabel: { x: 8, y: 72 }
    },
    // The enchanting table screen — PLAN G22. `EnchantmentScreenHandler`'s two slot origins and
    // `EnchantmentScreen`'s button strip: three 108x19 buttons at (60, 14 + 19i), drawn from the sheet's own
    // margin below the panel — disabled (0,185), enabled (0,166), hovered (0,204) — with the 16x16 level
    // icon at (+1, +1) from (16i, 223) lit or (16i, 239) grey. Nothing overrides the title/label positions.
    ENCHANT: {
      w: 176, h: 166,
      item: [15, 47], lapis: [35, 47],
      main: [8, 84], hotbar: [8, 142],
      button: { x: 60, y: 14, pitch: 19, w: 108, h: 19, disabled: [0, 185], enabled: [0, 166], hover: [0, 204] },
      icon: { on: [0, 223], off: [0, 239], size: 16 },
      title: { x: 8, y: 6 }, inventoryLabel: { x: 8, y: 72 }
    },
    // The hopper screen — PASS 17 JOB 1 (G19b), D-419. 176 x 133: five slots in a row and the
    // player-inventory footer, with nothing else on it, which is why it borrows no other sheet.
    // ⚠ THE TITLE IS LEFT-ALIGNED HERE, at `titleLabelX = 8` — `AbstractContainerScreen`'s own
    // default — and NOT centred the way the furnace's is. The furnace centres it because
    // `AbstractFurnaceScreen` overrides `titleLabelX`; the hopper does not override anything, so
    // copying the furnace's own line would have drawn the one screen in the wrong place.
    // `inventoryLabel.y` is `imageHeight - 94` = 39, the same formula that gives the furnace 72.
    // ⚠ Every origin below is ASSERTED AGAINST `hopper.png`'s pixels by `guicheck` §4g.
    HOPPER: {
      w: 176, h: 133,
      slots: [44, 20],                 // five, 18 apart
      main: [8, 51], hotbar: [8, 109],
      title: { x: 8, y: 6 }, inventoryLabel: { x: 8, y: 39 }
    },
    // The dispenser screen — PASS 17 JOB 1 (G19b), D-420 — which the DROPPER shares. 176 x 166,
    // a 3x3 grid and the player-inventory footer. ⚠ There is no `dropper.png` in the jar: a
    // dropper is this screen with a different title, and `guicheck` §4h asserts the absence.
    // ⚠ Every origin is asserted against `dispenser.png`'s pixels by `guicheck` §4h.
    // The anvil screen (G22d) — `AnvilScreen`/`ForgingScreenHandler`: inputs (27,47) and (76,47),
    // output (134,47), name field at (62,24) 103x12, title at x=60 (`titleX`), footer as the furnace's.
    ANVIL: {
      w: 176, h: 166,
      inputs: [[27, 47], [76, 47]], output: [134, 47],
      main: [8, 84], hotbar: [8, 142],
      field: [62, 24, 103, 12],
      title: { x: 60, y: 6 }, inventoryLabel: { x: 8, y: 72 }
    },
    DISPENSER: {
      w: 176, h: 166,
      grid: [62, 17],                  // 3x3, 18 apart, row-major
      main: [8, 84], hotbar: [8, 142],
      title: { x: 8, y: 6 }, inventoryLabel: { x: 8, y: 72 }
    },
    // The brewing-stand screen — PASS 17 JOB 1 (G19b). 176 x 166. Slot origins are
    // `BrewingStandScreenHandler`'s (.decomp): three bottles in a shallow V, the ingredient above
    // the middle one, the blaze-powder slot top-left. The three sprites are BOTH the on-screen
    // position and the source rect on the sheet's right-hand margin, as `BrewingStandScreen` blits
    // them. `title` is centred (`init` sets `titleX = (backgroundWidth - width(title)) / 2`).
    // ⚠ Every origin is asserted against `brewing_stand.png`'s pixels by `guicheck` §4k.
    BREWING: {
      w: 176, h: 166,
      bottles: [[56, 51], [79, 58], [102, 51]],
      ingredient: [79, 17], fuel: [17, 17],
      main: [8, 84], hotbar: [8, 142],
      fuelBar: { x: 60, y: 44, sx: 176, sy: 29, h: 4 },      // width = clamp((18*fuel+19)/20, 0, 18)
      arrow:   { x: 97, y: 16, sx: 176, sy: 0, w: 9 },       // height = floor(28 * (1 - brewTime/400))
      bubbles: { x: 63, y: 14, sx: 185, w: 12, max: 29 },    // drawn from the bottom up
      bubbleProgress: [29, 24, 20, 16, 11, 6, 0],
      title: { y: 6 }, inventoryLabel: { x: 8, y: 72 }
    },
    SLOT: 18,
    // ── the default skin, front-on (D-278) ───────────────────────────────────────────────
    // ⚠ THE BLACK WINDOW IN `inventory.png` IS VANILLA'S OWN TEXTURE, not a blit gone wrong:
    // the game renders the player into it. `PREVIEW` is where, in vanilla's own numbers —
    // `InventoryScreen` calls `renderEntityInInventory(x + 51, y + 75, 30)`, so the figure is
    // centred on GUI x+51 with its FEET on y+75, at 30 pixels per block, and a 32-unit-tall
    // model is 16 units to the block: 1.875 GUI pixels per skin texel.
    PREVIEW: { cx: 51, feet: 75, unit: 30 / 16, box: [26, 8, 50, 70] },
    /**
     * ⚠ THE SURVIVAL HUD'S LAYOUT, AS DATA, so `guicheck` can assert it instead of trusting it.
     * Every number is vanilla's own, in GUI pixels, and every one is relative to a SCREEN edge
     * rather than to another widget (D-277) — `left` is `width/2 - 91`, `right` is `width/2 + 91`,
     * and the hotbar happens to span exactly between them.
     *
     * ⚠⚠ AND THE TWO ROWS GROW IN OPPOSITE DIRECTIONS. The hearts run rightward from `left`; the
     * hunger row runs LEFTWARD from `right`, which is why its icons are the mirrored halves
     * (D-274). This was `left + (91 - 9 - i * 8)` — an arithmetic slip that reads plausibly and
     * puts the drumsticks straight on top of the hearts, ten pixels left of centre. It survived a
     * screenshot because a red heart under a brown drumstick still looks like a row of hearts
     * (D-279).
     */
    HUD: {
      barW: 182,                       // the hotbar's width; `left` is half of it either side of centre
      rowY: -39,                       // hearts and hunger, from the bottom of the screen
      armourDY: -10,                   // armour, and the air bubbles, ten above that row
      xpY: -32 + 3,                    // the experience bar
      xpLevelY: -31 - 4,               // and its level, which sits in the gap BETWEEN the two rows
      nameY: -59,                      // the held item's name (D-277)
      nameNoHurtDY: 14,                // ...which drops by 14 when there is no heart row to clear
      icon: 9, pitch: 8, count: 10,
      heartX: function (i) { return i * 8; },              // rightward from `left`
      hungerX: function (i) { return 182 - 9 - i * 8; }    // LEFTWARD from `left + 182` == right
    },
    // Each part is [sx, sy, sw, sh] in the 64x64 skin and [x, y] in the 16x32 figure, measured
    // from its top-left. The figure: 4 arm + 8 body + 4 arm across, 8 head + 12 body + 12 leg down.
    // ⚠ RIGHT AND LEFT ARE THE PLAYER'S, so the right arm is on the VIEWER'S left.
    SKIN: [
      { n: 'rightLeg',  t: [4, 20, 4, 12], p: [4, 20] },
      { n: 'leftLeg',   t: [20, 52, 4, 12], p: [8, 20] },
      { n: 'rightArm',  t: [44, 20, 4, 12], p: [0, 8] },
      { n: 'leftArm',   t: [36, 52, 4, 12], p: [12, 8] },
      { n: 'body',      t: [20, 20, 8, 12], p: [4, 8] },
      { n: 'head',      t: [8, 8, 8, 8], p: [4, 0] },
      // the second layer, drawn over its own base in the same order
      { n: 'pantsR',    t: [4, 36, 4, 12], p: [4, 20], o: 1 },
      { n: 'pantsL',    t: [4, 52, 4, 12], p: [8, 20], o: 1 },
      { n: 'sleeveR',   t: [44, 36, 4, 12], p: [0, 8], o: 1 },
      { n: 'sleeveL',   t: [52, 52, 4, 12], p: [12, 8], o: 1 },
      { n: 'jacket',    t: [20, 36, 8, 12], p: [4, 8], o: 1 },
      { n: 'hat',       t: [40, 8, 8, 8], p: [4, 0], o: 1 }
    ]
  };

  // ── decode ────────────────────────────────────────────────────────────────────────────────
  G.init = function (data) {
    if (!data || !data.gui) { G.ready = false; return G; }
    var bytes = NS.Z.unpack(data.gui, data.guiBytes);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    var hlen = dv.getUint32(0, true);
    var CH = 8192, parts = [];
    for (var i = 0; i < hlen; i += CH) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(4 + i, 4 + Math.min(i + CH, hlen))));
    }
    var head = JSON.parse(parts.join(''));
    var base = 4 + hlen;
    G.widths = new Uint8Array(head.widths);
    G.widthsSga = head.widthsSga ? new Uint8Array(head.widthsSga) : null;
    G.cell = head.cell;
    G.sheets = Object.create(null);
    for (var s = 0; s < head.sheets.length; s++) {
      var sh = head.sheets[s];
      G.sheets[sh.n] = { w: sh.w, h: sh.h, canvas: makeCanvas(bytes, base + sh.o, sh.w, sh.h) };
    }
    G.ready = true;
    return G;
  };

  function makeCanvas(bytes, off, w, h) {
    var cv = (typeof document !== 'undefined')
      ? document.createElement('canvas')
      : { width: 0, height: 0, getContext: function () { return null; } };
    cv.width = w; cv.height = h;
    var cx = cv.getContext ? cv.getContext('2d') : null;
    if (!cx) return cv;
    var img = cx.createImageData(w, h);
    var n = w * h * 4;
    for (var i = 0; i < n; i++) img.data[i] = bytes[off + i];
    cx.putImageData(img, 0, 0);
    return cv;
  }

  /** One texel of a sheet, as 0xAARRGGBB — what `guicheck` asserts the rectangles against. */
  G.texel = function (name, x, y) {
    var sh = G.sheets && G.sheets[name];
    if (!sh || !sh.canvas.getContext) return 0;
    var d = sh.canvas.getContext('2d').getImageData(x, y, 1, 1).data;
    return (d[3] << 24 >>> 0) | (d[0] << 16) | (d[1] << 8) | d[2];
  };

  // ── drawing ───────────────────────────────────────────────────────────────────────────────
  /** blit(c, sheet, [sx,sy,sw,sh], dx, dy, scale) — nearest-neighbour, like the real thing. */
  G.blit = function (c, name, r, dx, dy, scale) {
    var sh = G.sheets && G.sheets[name];
    if (!sh) return;
    var k = scale || 1;
    c.drawImage(sh.canvas, r[0], r[1], r[2], r[3], dx, dy, r[2] * k, r[3] * k);
  };

  /** Vanilla's `(int)(progress * 183.0F)` for the XP and jump bars (InGameHud), not round(182p). */
  G.barFill = function (frac) { return Math.max(0, Math.floor(frac * 183)); };

  /** The level number's black outline: vanilla draws four copies, (±1,0) and (0,±1), no diagonals. */
  G.XP_OUTLINE = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  /** A partial blit, for a bar that fills: the same rect clipped to `frac` of its width. */
  G.blitPart = function (c, name, r, dx, dy, scale, frac) {
    var sh = G.sheets && G.sheets[name];
    if (!sh) return;
    var k = scale || 1;
    var w = Math.min(r[2], G.barFill(frac));
    if (!w) return;
    c.drawImage(sh.canvas, r[0], r[1], w, r[3], dx, dy, w * k, r[3] * k);
  };

  // ── the legacy font ───────────────────────────────────────────────────────────────────────
  /**
   * ⚠ THE WIDTHS ARE MEASURED, NOT TABLED (D-274). `tools/build-gui.mjs` scans each 8x8 cell of
   * `ascii.png` for its rightmost inked column, which is exactly what vanilla's own
   * `FontTexture` does, and ships 256 bytes. So the text this draws is spaced like the game's,
   * including the one-pixel `i` and the four-pixel space.
   */
  G.textWidth = function (str) {
    if (!G.widths) return str.length * 6;
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      w += (ch < 256 ? G.widths[ch] : 6);
    }
    return w;
  };

  var tintCache = {};
  /**
   * The font sheet recoloured. The glyphs are white with an alpha mask, so a colour is a
   * `source-in` fill over a copy — done once per colour and cached, because doing it per string
   * is what makes a text-heavy screen crawl. `sheet` is `ascii` or the enchanting table's `ascii_sga`.
   */
  function tintedFont(rgb, sheet) {
    var hit = tintCache[sheet];
    if (hit && hit.key === rgb) return hit.cv;
    var sh = G.sheets[sheet];
    var cv = document.createElement('canvas');
    cv.width = sh.w; cv.height = sh.h;
    var cx = cv.getContext('2d');
    cx.drawImage(sh.canvas, 0, 0);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = '#' + ('000000' + (rgb >>> 0).toString(16)).slice(-6);
    cx.fillRect(0, 0, sh.w, sh.h);
    tintCache[sheet] = { key: rgb, cv: cv };
    return cv;
  }

  /**
   * text(c, str, x, y, scale, rgb, shadow) — vanilla's own glyphs at `scale` pixels per texel.
   * ⚠ The shadow is drawn at +1 texel in BOTH axes and at a quarter of the colour, which is
   * vanilla's `(colour & 0xFCFCFC) >> 2`. It is not decoration: white text on snow is unreadable
   * without it, and every screenshot of the game has it.
   */
  G.text = function (c, str, x, y, scale, rgb, shadow) {
    if (!G.ready) return 0;
    var k = scale || 1;
    if (rgb === undefined || rgb === null) rgb = 0xFFFFFF;
    if (shadow !== false) {
      drawRun(c, str, x + k, y + k, k, (rgb & 0xFCFCFC) >> 2, false);
    }
    return drawRun(c, str, x, y, k, rgb, false);
  };

  /** The `minecraft:alt` font — Standard Galactic — width of `str`, in texels (PLAN G22). */
  G.textWidthSga = function (str) {
    if (!G.widthsSga) return str.length * 6;
    var w = 0;
    for (var i = 0; i < str.length; i++) w += G.widthsSga[str.charCodeAt(i) & 255];
    return w;
  };
  /** Draw `str` in Standard Galactic, no shadow (`EnchantmentScreen` draws it with `drawTrimmed`). */
  G.textSga = function (c, str, x, y, scale, rgb) {
    if (!G.ready || !G.sheets.ascii_sga) return 0;
    return drawRun(c, str, x, y, scale || 1, rgb, true);
  };

  function drawRun(c, str, x, y, k, rgb, sga) {
    var font = tintedFont(rgb, sga ? 'ascii_sga' : 'ascii'), cell = G.cell, wt = sga ? G.widthsSga : G.widths;
    var dx = x;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      if (ch > 255) ch = 63;                      // '?', the same fallback vanilla uses
      var sx = (ch % 16) * cell, sy = ((ch / 16) | 0) * cell;
      c.drawImage(font, sx, sy, cell, cell, dx, y, cell * k, cell * k);
      dx += wt[ch] * k;
    }
    return dx - x;
  }

  // ── the player preview ────────────────────────────────────────────────────────────────────
  /**
   * The player, front-on, into `inventory.png`'s black window.
   *
   * ⚠ THIS IS A DECLARED DEVIATION AND D-278 OWNS IT. Vanilla renders a real 3D humanoid there,
   * lit, and turns its head and body toward the pointer. MC-Lite has no entity renderer until
   * G17, so this draws the skin's twelve front faces flat — the right pixels in the right places,
   * without the rotation or the perspective. The alternative was leaving a black rectangle in the
   * middle of the player's own screen, which is the single most visible thing in this GUI.
   *
   * `ox`, `oy` are the panel's top-left in device pixels and `s` the GUI scale.
   */
  G.drawPlayer = function (c, ox, oy, s, view) {
    var sh = G.sheets && G.sheets.steve;
    if (!sh) return false;
    var V = view || G.PREVIEW, u = V.unit * s;
    var left = ox + (V.cx * s) - 8 * u;          // the 16-unit-wide figure, centred on cx
    var top = oy + (V.feet * s) - 32 * u;        // 32 units tall, standing on `feet`
    c.save();
    c.beginPath();
    c.rect(ox + V.box[0] * s, oy + V.box[1] * s, V.box[2] * s, V.box[3] * s);
    c.clip();
    for (var i = 0; i < G.SKIN.length; i++) {
      var part = G.SKIN[i], t = part.t, p = part.p;
      c.drawImage(sh.canvas, t[0], t[1], t[2], t[3],
        Math.round(left + p[0] * u), Math.round(top + p[1] * u),
        Math.ceil(t[2] * u), Math.ceil(t[3] * u));
    }
    c.restore();
    return true;
  };

  /**
   * ⚠ VANILLA'S OWN MENU BACKGROUND, WHICH IS A GRADIENT AND NOT A FLAT WASH.
   * `Screen.renderBackground` in a running world calls
   * `fillGradient(0, 0, width, height, -1072689136, -804253680)` — two ARGB constants that are
   * `0xC0101010` and `0xD0101010`: near-black at 75% alpha at the top, 82% at the bottom, and
   * NOT pure black. A flat `rgba(0,0,0,0.6)` is the single most common way a clone's menus read
   * as "nearly right": the world behind stays too colourful and the panel edges lose their
   * separation. Every modal screen in this game goes through here so there is one answer.
   */
  G.TOP = 0xC0101010;
  G.BOTTOM = 0xD0101010;
  G.dim = function (c, w, h) {
    var g = c.createLinearGradient(0, 0, 0, h);
    var css = function (argb) {
      return 'rgba(' + ((argb >>> 16) & 255) + ',' + ((argb >>> 8) & 255) + ',' + (argb & 255)
           + ',' + (((argb >>> 24) & 255) / 255).toFixed(4) + ')';
    };
    g.addColorStop(0, css(G.TOP));
    g.addColorStop(1, css(G.BOTTOM));
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  };

  // ── sleeping client view ──────────────────────────────────────────────────────────────────
  /** InGameHud.render's sleep block (.decomp InGameHud.java:235-249): a = t/100, and past 100 the wake ramp
   *  1 - (t-100)/10; the fill is `(int)(220*a) << 24 | 0x101020`. Returns {a, argb}; null when t <= 0. */
  G.sleepOverlay = function (t) {
    if (!(t > 0)) return null;
    var a = t / 100;
    if (a > 1) a = 1 - (t - 100) / 10;
    return { a: a, argb: (((Math.floor(220 * a)) << 24) | 0x101020) >>> 0 };
  };
  G.LANG_STOP_SLEEPING = 'Leave Bed';   // lang key multiplayer.stopSleeping
  /** SleepingChatScreen.init's button: (w/2-100, h-40, 200x20). */
  G.sleepScreen = function (w, h) {
    return { key: 'multiplayer.stopSleeping', label: G.LANG_STOP_SLEEPING, x: (w >> 1) - 100, y: h - 40, w: 200, h: 20 };
  };
  /** SleepingChatScreen.stopSleeping (button, Esc, close): the leave-bed action -> Sleep.wake with timer reset. */
  G.sleepLeave = function (P) { NS.Sleep.wake(P, true); };

  // ── slot geometry ─────────────────────────────────────────────────────────────────────────
  /**
   * Where menu slot `i` sits inside the 176x166 inventory screen, in GUI pixels.
   * ⚠ The bands are `Menu.playerMenu`'s: 0 result · 1..4 the 2x2 grid · 5..8 armour ·
   * 9..35 the backpack · 36..44 the hotbar · 45 the offhand. Getting this table and the click
   * machine's band boundaries out of step is how a clone ends up putting a helmet in a chest.
   */
  G.slotXY = function (i) {
    var V = G.INV, S = G.SLOT;
    if (i === 0) return [V.result[0], V.result[1]];
    if (i < 5) { var g = i - 1; return [V.grid[0] + (g % 2) * S, V.grid[1] + ((g / 2) | 0) * S]; }
    if (i < 9) return [V.armour[0], V.armour[1] + (i - 5) * S];
    if (i < 36) { var m = i - 9; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    if (i < 45) return [V.hotbar[0] + (i - 36) * S, V.hotbar[1]];
    return [V.offhand[0], V.offhand[1]];
  };

  /** Which slot a GUI-pixel point is inside, or -1. The inverse of `slotXY`, by search. */
  G.slotAt = function (px, py) {
    for (var i = 0; i < 46; i++) {
      var p = G.slotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside a `rows`-row chest screen, in GUI pixels.
   * ⚠ THE BANDS ARE `Menu.chestMenu`'s: 0..rows*9-1 the chest's own slots, rows*9..+26 the
   * backpack, the last 9 the hotbar — same ordering `G.slotXY` uses for `Menu.playerMenu`,
   * because it is the same underlying inventory object.
   */
  G.chestSlotXY = function (i, rows, shulker) {
    var V = G.CHEST, S = G.SLOT, n = rows * 9;
    if (i < n) return [V.row0[0] + (i % 9) * S, V.row0[1] + ((i / 9) | 0) * S];
    var iy = shulker ? G.SHULKER.main[1] : V.invY(rows), hy = shulker ? G.SHULKER.hotbar[1] : V.hotbarY(rows);
    if (i < n + 27) { var m = i - n; return [8 + (m % 9) * S, iy + ((m / 9) | 0) * S]; }
    return [8 + (i - n - 27) * S, hy];
  };

  /** Which chest-screen slot a GUI-pixel point is inside, or -1. The inverse, by search. */
  G.chestSlotAt = function (px, py, rows, shulker) {
    var total = rows * 9 + 36;
    for (var i = 0; i < total; i++) {
      var p = G.chestSlotXY(i, rows, shulker);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside the crafting-table screen, in GUI pixels — PASS 17 JOB 1,
   * session 44. ⚠ THE BANDS ARE `Menu.craftingMenu`'s: 0 the result · 1..9 the 3x3 grid ·
   * 10..36 the backpack · 37..45 the hotbar. NO armour, NO offhand — this screen has neither.
   */
  G.craftSlotXY = function (i) {
    var V = G.CRAFTING, S = G.SLOT;
    if (i === 0) return [V.result[0], V.result[1]];
    if (i < 10) { var g = i - 1; return [V.grid[0] + (g % 3) * S, V.grid[1] + ((g / 3) | 0) * S]; }
    if (i < 37) { var m = i - 10; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    return [V.hotbar[0] + (i - 37) * S, V.hotbar[1]];
  };

  /** Which crafting-screen slot a GUI-pixel point is inside, or -1. The inverse, by search. */
  G.craftSlotAt = function (px, py) {
    for (var i = 0; i < 46; i++) {
      var p = G.craftSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside the horse screen, in GUI pixels -- QUEUE 0.2 (G18e
   * remainder; the `chest` band, loop/donkey-s96). THE BANDS ARE `Mount.menu`'s
   * (`07r_mount.js`): 0 the saddle · 1 the armour · [chest: 2..16 the 3x5 grid] · the player's
   * 27-slot backpack · the hotbar -- `chest` (truthy = `Mnt.isChestable(e) && e.hasChest`,
   * `H.drawHorse`/`H.horseClick`'s own call sites compute it) shifts the backpack/hotbar bands
   * down by 15 slots to make room, exactly the way `Mount.menu` itself resizes `bank`.
   */
  // D-550: `chest` is the chest's COLUMN COUNT (`AbstractDonkeyEntity.getInventoryColumns()` --
  // 5 for donkey/mule, a llama's strength 1..5), 0/false for none; `true` still means 5.
  var chestCols = function (chest) { return chest === true ? G.HORSE.chest.cols : (chest | 0); };
  G.horseSlotXY = function (i, chest) {
    var V = G.HORSE, S = G.SLOT, cols = chestCols(chest);
    if (i === 0) return V.saddle;
    if (i === 1) return V.armour;
    var base = cols > 0 ? 2 + 3 * cols : 2;
    if (cols > 0 && i >= 2 && i < base) {
      var ci = i - 2;
      var col = ci % cols, row = (ci / cols) | 0;
      return [V.chest.x + 1 + col * V.chest.cellW, V.chest.y + 1 + row * V.chest.rowH];
    }
    if (i < base + 27) { var m = i - base; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    return [V.hotbar[0] + (i - base - 27) * S, V.hotbar[1]];
  };

  /** Which horse-screen slot a GUI-pixel point is inside, or -1. The inverse, by search. */
  G.horseSlotAt = function (px, py, chest) {
    var cols = chestCols(chest);
    var total = (cols > 0 ? 2 + 3 * cols : 2) + 27 + 9;
    for (var i = 0; i < total; i++) {
      var p = G.horseSlotXY(i, chest);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside a furnace-family screen, in GUI pixels — D-414. ⚠ THE BANDS ARE
   * `Menu.furnaceMenu`'s: 0 the ingredient · 1 the fuel · 2 the result · 3..29 the backpack ·
   * 30..38 the hotbar. NO armour, NO offhand.
   */
  G.furnaceSlotXY = function (i) {
    var V = G.FURNACE, S = G.SLOT;
    if (i === 0) return [V.input[0], V.input[1]];
    if (i === 1) return [V.fuel[0], V.fuel[1]];
    if (i === 2) return [V.result[0], V.result[1]];
    if (i < 30) { var m = i - 3; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    return [V.hotbar[0] + (i - 30) * S, V.hotbar[1]];
  };

  /** Which furnace-screen slot a GUI-pixel point is inside, or -1. The inverse, by search. */
  G.furnaceSlotAt = function (px, py) {
    for (var i = 0; i < 39; i++) {
      var p = G.furnaceSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /** Where menu slot `i` sits inside the anvil screen: 0,1 inputs · 2 output · 3..29 backpack · 30..38 hotbar. */
  G.ANVIL_SLOTS = 39;
  G.anvilSlotXY = function (i) {
    var V = G.ANVIL;
    if (i < 2) return V.inputs[i];
    if (i === 2) return V.output;
    if (i < 30) { var m = i - 3; return [V.main[0] + (m % 9) * G.SLOT, V.main[1] + ((m / 9) | 0) * G.SLOT]; }
    return [V.hotbar[0] + (i - 30) * G.SLOT, V.hotbar[1]];
  };
  G.anvilSlotAt = function (px, py) {
    for (var i = 0; i < G.ANVIL_SLOTS; i++) {
      var p = G.anvilSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside the enchanting table — PLAN G22. ⚠ THE BANDS ARE
   * `Menu.enchantMenu`'s: 0 the item · 1 the lapis · 2..28 the backpack · 29..37 the hotbar.
   */
  G.enchantSlotXY = function (i) {
    var V = G.ENCHANT, S = G.SLOT;
    if (i === 0) return [V.item[0], V.item[1]];
    if (i === 1) return [V.lapis[0], V.lapis[1]];
    if (i < 29) { var m = i - 2; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    return [V.hotbar[0] + (i - 29) * S, V.hotbar[1]];
  };
  G.enchantSlotAt = function (px, py) {
    for (var i = 0; i < 38; i++) {
      var p = G.enchantSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };
  /** Which of the three buttons a GUI-pixel point is inside (`EnchantmentScreen.mouseClicked`), or -1. */
  G.enchantButtonAt = function (px, py) {
    var B = G.ENCHANT.button;
    for (var i = 0; i < 3; i++) {
      var dx = px - B.x, dy = py - (B.y + B.pitch * i);
      if (dx >= 0 && dy >= 0 && dx < B.w && dy < B.h) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside the hopper screen, in GUI pixels — D-419. ⚠ THE BANDS ARE
   * `Menu.hopperMenu`'s: 0..4 the hopper · 5..31 the backpack · 32..40 the hotbar.
   * NO armour, NO offhand, and no result slot.
   */
  G.HOPPER_SLOTS = 41;
  G.hopperSlotXY = function (i) {
    var V = G.HOPPER, S = G.SLOT;
    if (i < 5) return [V.slots[0] + i * S, V.slots[1]];
    if (i < 32) { var m = i - 5; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    return [V.hotbar[0] + (i - 32) * S, V.hotbar[1]];
  };

  /** Which hopper-screen slot a GUI-pixel point is inside, or -1. The inverse, by search. */
  G.hopperSlotAt = function (px, py) {
    for (var i = 0; i < G.HOPPER_SLOTS; i++) {
      var p = G.hopperSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside the brewing-stand screen, in GUI pixels. ⚠ THE BANDS ARE
   * `Menu.brewingMenu`'s: 0..2 the bottles · 3 the ingredient · 4 the fuel · 5..31 the backpack ·
   * 32..40 the hotbar.
   */
  G.BREWING_SLOTS = 41;
  G.brewingSlotXY = function (i) {
    var V = G.BREWING, S = G.SLOT;
    if (i < 3) return [V.bottles[i][0], V.bottles[i][1]];
    if (i === 3) return [V.ingredient[0], V.ingredient[1]];
    if (i === 4) return [V.fuel[0], V.fuel[1]];
    if (i < 32) { var m = i - 5; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    return [V.hotbar[0] + (i - 32) * S, V.hotbar[1]];
  };

  /** Which brewing-screen slot a GUI-pixel point is inside, or -1. The inverse, by search. */
  G.brewingSlotAt = function (px, py) {
    for (var i = 0; i < G.BREWING_SLOTS; i++) {
      var p = G.brewingSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /** Where menu slot `i` sits inside the grindstone screen — `Menu.grindMenu`'s bands: 0,1 inputs · 2 result · 3..29 backpack · 30..38 hotbar. */
  G.GRINDSTONE_SLOTS = 39;
  G.grindstoneSlotXY = function (i) {
    var V = G.GRINDSTONE_SLOT, S = G.SLOT;
    if (i === 0) return V.in1;
    if (i === 1) return V.in2;
    if (i === 2) return V.out;
    if (i < 30) { var m = i - 3; return [8 + (m % 9) * S, 84 + ((m / 9) | 0) * S]; }
    return [8 + (i - 30) * S, 142];
  };
  G.grindstoneSlotAt = function (px, py) {
    for (var i = 0; i < G.GRINDSTONE_SLOTS; i++) {
      var p = G.grindstoneSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };

  /**
   * Where menu slot `i` sits inside the dispenser/dropper screen, in GUI pixels — D-420.
   * ⚠ THE BANDS ARE `Menu.dispenserMenu`'s: 0..8 the 3x3 · 9..35 the backpack · 36..44 the hotbar.
   */
  G.DISPENSER_SLOTS = 45;
  G.dispenserSlotXY = function (i) {
    var V = G.DISPENSER, S = G.SLOT;
    if (i < 9) return [V.grid[0] + (i % 3) * S, V.grid[1] + ((i / 3) | 0) * S];
    if (i < 36) { var m = i - 9; return [V.main[0] + (m % 9) * S, V.main[1] + ((m / 9) | 0) * S]; }
    return [V.hotbar[0] + (i - 36) * S, V.hotbar[1]];
  };

  /** Which dispenser-screen slot a GUI-pixel point is inside, or -1. The inverse, by search. */
  G.dispenserSlotAt = function (px, py) {
    for (var i = 0; i < G.DISPENSER_SLOTS; i++) {
      var p = G.dispenserSlotXY(i);
      if (px >= p[0] && px < p[0] + 16 && py >= p[1] && py < p[1] + 16) return i;
    }
    return -1;
  };
})(MCL);
