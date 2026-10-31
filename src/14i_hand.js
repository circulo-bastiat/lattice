// 14i_hand.js — PLAN G10. The swing, the attack cooldown, and the ten crack stages.
//
// MAIN THREAD ONLY, and no DOM: everything here is arithmetic over ticks, so a whole mining
// session runs inside `handcheck` without a browser. The DRAWING of the hand and of the breaking
// overlay is the renderer's; what the renderer asks this file for is three numbers — how far
// through the swing we are, how charged the attack is, and which crack stage to put on the block.
//
// ⚠ EVERY CONSTANT BELOW IS VANILLA'S, AND TWO OF THEM ARE NOT THE OBVIOUS ONES:
//
//   the swing is SIX ticks — `LivingEntity.getCurrentSwingDuration()` — and haste makes it
//   SHORTER by `1 + amplifier` while fatigue makes it LONGER by `(1 + amplifier) * 2`. The two
//   are not symmetric and a clone that writes `6 / (1 + haste)` is wrong in both directions.
//
//   ⚠ `swing()` RESTARTS THE ANIMATION ONLY PAST THE HALFWAY POINT. Vanilla:
//       if (!swinging || swingTime >= duration / 2 || swingTime < 0) { swingTime = -1; ... }
//   so clicking twice quickly does NOT produce two half-swings — the second click is swallowed
//   until the first is half done. Every clone that resets unconditionally makes the hand stutter
//   under fast clicking, and it is the kind of thing that only ever shows up in play.
//
//   ⚠ AND `swingTime` IS SET TO **-1**, not 0. The next `tick()` increments it to 0, so the
//   animation's first drawn frame is 0/duration. Setting it to 0 drops the first frame of every
//   swing — one frame out of six, which is a visible hitch nobody can name.

(function (NS) {
  'use strict';

  var H = NS.Hand = {
    // ── swing ────────────────────────────────────────────────────────────────────────────
    swinging: false,
    swingTime: 0,
    swingArm: 0,          // 0 main hand, 1 offhand
    attackAnim: 0,        // 0..1, what the renderer interpolates the hand along
    prevAttackAnim: 0,

    // ── attack cooldown ──────────────────────────────────────────────────────────────────
    attackStrengthTicker: 0,

    // ── breaking ─────────────────────────────────────────────────────────────────────────
    STAGES: 10,
    crackStage: -1,       // -1 = nothing is being broken
    crackKey: -1,         // the packed block key the stage belongs to

    // ⚠⚠ **D-271 IS PAID** (D-335). These are `Attributes.ATTACK_SPEED`'s and
    // `ATTACK_DAMAGE`'s defaults — what an EMPTY HAND is worth — and the thirty items that carry
    // a modifier are in `DATA.itemAttrs`, read out of the tool constructors in `Items.<clinit>`
    // by `tools/extract-itemattrs.mjs`. For fourteen sessions this table was null and every item
    // in the game swung at 4.0, so a diamond sword and a feather were the same weapon.
    // ⚠ THE TABLE HOLDS FINAL VALUES, NOT MODIFIERS, and D-139 applies: the `attackSpeedTable`
    // field that used to hold modifiers is DELETED rather than left beside it, so there is no
    // second place for a second answer to live.
    BASE_ATTACK_SPEED: 4.0,
    BASE_ATTACK_DAMAGE: 1.0,
    attrs: null
  };

  /**
   * Bind the attribute table. ⚠ IT IS AN EXCEPTION TABLE: an item that is not in it carries no
   * modifier at all, which is most of the 1,100. Asserting its SIZE rather than its presence is
   * what stops a truncated or missing payload from quietly reading as "no item has a modifier".
   */
  H.bindAttrs = function (table) {
    H.attrs = table || null;
    H.attrCount = H.attrs ? Object.keys(H.attrs).length : 0;
    return H.attrCount;
  };
  H.init = function () {
    var D = NS.DATA;
    return H.bindAttrs(D && D.itemAttrs ? D.itemAttrs : null);
  };

  /** `LivingEntity.getCurrentSwingDuration()` — six ticks, bent by haste and fatigue. */
  H.swingDuration = function (e) {
    // #296 — read the effect store through `StatusEffectUtil` (07q_effects.js): the old reads
    // coerced the effect OBJECT to a number (always 0) and named a key that does not exist.
    var ES = NS.Effects;
    if (!e || !ES) return 6;
    if (ES.hasHaste(e)) return 6 - (1 + ES.getHasteAmplifier(e));
    return ES.hasStatusEffect(e, 'mining_fatigue') ? 6 + (1 + e.effects.mining_fatigue.amplifier) * 2 : 6;
  };

  /**
   * `LivingEntity.swing(hand)`. ⚠ The guard is the whole behaviour: a second click before the
   * halfway point is SWALLOWED, and the restart value is -1 rather than 0.
   */
  /**
   * ⚠ A MONOTONIC COUNT OF SWINGS THAT ACTUALLY STARTED (D-339). A swing is six ticks long and a
   * headless renderer draws about four frames a second with the loop catching up twenty ticks a
   * frame, so by the time anything outside the page can look, the swing is over. **A check
   * outside the loop cannot see a momentary state**, which is D-321's lesson; it CAN see a
   * counter. `inputcheck` dispatches a real `mousedown` and asserts this number moved.
   */
  H.swings = 0;

  H.swing = function (e, arm) {
    var d = H.swingDuration(e);
    if (!H.swinging || H.swingTime >= (d / 2 | 0) || H.swingTime < 0) {
      H.swingTime = -1;
      H.swinging = true;
      H.swingArm = arm | 0;
      H.swings++;
      return true;
    }
    return false;
  };

  /** `LivingEntity.updateSwingTime()`, once a tick. */
  H.tickSwing = function (e) {
    var d = H.swingDuration(e);
    if (H.swinging) {
      H.swingTime++;
      if (H.swingTime >= d) { H.swingTime = 0; H.swinging = false; }
    } else {
      H.swingTime = 0;
    }
    H.prevAttackAnim = H.attackAnim;
    H.attackAnim = H.swingTime / d;
  };

  /** The swing progress the renderer draws at, interpolated inside the tick (`partialTick`). */
  H.swingProgress = function (partial) {
    var d = H.attackAnim - H.prevAttackAnim;
    if (d < 0) d += 1;
    return H.prevAttackAnim + d * (partial === undefined ? 1 : partial);
  };

  // ── attack cooldown ────────────────────────────────────────────────────────────────────
  /** The row for a held stack, or null when the item carries no attribute modifier. */
  H.attrsFor = function (stack) {
    var I = NS.Inventory;
    if (!H.attrs || !I || I.isEmpty(stack) || !NS.Items) return null;
    var name = NS.Items.nameOf(stack.i);
    // TridentItem (.decomp): ATTACK_DAMAGE +8.0, ATTACK_SPEED -2.9 -> final 9.0 / 1.1, not a sword. Not a
    // tool-constructor item, so it is not one of the thirty extracted rows (those counts stay 30).
    if (name === 'trident') return H.TRIDENT_ATTRS;
    return H.attrs[name] || null;
  };
  H.TRIDENT_ATTRS = [9, 1.1, 0];

  /**
   * `Player.getCurrentItemAttackStrengthDelay()` = `1 / attackSpeed * 20` ticks.
   * ⚠ A sword is 1.6 attacks a second (12.5 ticks) and an empty hand is 4.0 (5 ticks), so the
   * cooldown bar over the crosshair is three times longer with a sword in your hand. That is the
   * single most visible consequence of D-271 having been unpaid.
   */
  H.attackSpeedFor = function (stack) {
    var a = H.attrsFor(stack);
    return a ? a[1] : H.BASE_ATTACK_SPEED;
  };

  /**
   * Is the held item a SWORD? ⚠ IT IS A REAL BRANCH IN THE DAMAGE FORMULA, not a label: only a
   * sword sweeps. The flag is the third column of the attribute table and comes out of the jar's
   * own class hierarchy — four tool classes extend `DiggerItem` and one does not (D-338).
   */
  H.isSword = function (stack) {
    var a = H.attrsFor(stack);
    return !!(a && a[2]);
  };

  /**
   * `Player.getAttributeValue(ATTACK_DAMAGE)` for the held item — the damage BEFORE the cooldown
   * ramp, the crit and enchantments. An empty hand is 1.0; a netherite sword is 8.
   */
  H.attackDamageFor = function (stack) {
    var a = H.attrsFor(stack);
    return a ? a[0] : H.BASE_ATTACK_DAMAGE;
  };

  /**
   * `StatusEffects.HASTE` / `MINING_FATIGUE` are `generic.attack_speed` modifiers (+0.1 / -0.1,
   * MULTIPLY_TOTAL, times amplifier+1; .decomp StatusEffects) -- the same effects that bend the
   * swing and the break speed also bend the attack cooldown. Plain `haste` only (conduit power adds none).
   */
  H.attackSpeedWithEffects = function (sp, e) {
    var ES = NS.Effects;
    if (!e || !ES || !e.effects) return sp;
    sp = ES.attrValue(e, 'generic.attack_speed', sp);
    return sp;
  };

  H.attackStrengthDelay = function (stack, e) {
    var sp = H.attackSpeedWithEffects(H.attackSpeedFor(stack), e === undefined ? NS.Player : e);
    if (!(sp > 0)) return 1;
    return (1 / sp) * 20;
  };

  /** `Player.getAttackStrengthScale(partial)` — 0 just after a swing, 1 when fully charged. */
  H.attackStrengthScale = function (stack, partial) {
    var d = H.attackStrengthDelay(stack);
    var t = (H.attackStrengthTicker + (partial === undefined ? 0 : partial)) / d;
    return t < 0 ? 0 : (t > 1 ? 1 : t);
  };

  H.resetAttackStrength = function () { H.attackStrengthTicker = 0; };
  H.tickAttackStrength = function () { H.attackStrengthTicker++; };

  // ── the breaking overlay ───────────────────────────────────────────────────────────────
  /**
   * `(int)(destroyProgress * 10)` — the stage index, 0..9, or -1 for "nothing".
   * ⚠ CLAMPED AT 9, not at 10. Progress reaches 1.0 on the tick the block breaks, and `10` would
   * index past the last texture for exactly one frame — which is a flash of nothing, once, at the
   * end of every single block you mine.
   */
  H.stageFor = function (progress) {
    if (!(progress > 0)) return -1;
    var s = (progress * H.STAGES) | 0;
    return s > H.STAGES - 1 ? H.STAGES - 1 : s;
  };

  /** The atlas tile name for a stage. The ten are forced into the atlas by name (D-270). */
  H.stageTile = function (stage) {
    if (stage < 0 || stage >= H.STAGES) return null;
    // ⚠ BARE, like every other atlas key (D-280). It was prefixed, alone among 801 names.
    return 'block/destroy_stage_' + stage;
  };

  /**
   * Call once a tick with the player's break state. Returns true when the overlay changed, which
   * is what the renderer watches — the overlay is one quad set and rebuilding it every frame for
   * a number that changes ten times per block would be silly.
   */
  H.tickBreaking = function (key, progress) {
    var stage = H.stageFor(progress);
    if (key !== H.crackKey || stage !== H.crackStage) {
      H.crackKey = key;
      H.crackStage = stage;
      return true;
    }
    return false;
  };

  H.stopBreaking = function () {
    var changed = H.crackStage !== -1;
    H.crackStage = -1; H.crackKey = -1;
    return changed;
  };


  // ── the equip animation (D-359) ────────────────────────────────────────────────────────────
  /**
   * `ItemInHandRenderer.tick()`. ⚠⚠ **THIS IS THE DIP, AND IT IS THE SECOND HALF OF "THERE IS NO
   * SWAY".** A new item does not appear in your hand: the old one drops out of frame, is swapped
   * at the bottom, and the new one rises. The height moves by at most **0.4 a tick** toward its
   * target and the swap happens **below 0.1**, so the whole exchange is about five ticks.
   *
   * ⚠ **AND THE TARGET IS THE ATTACK COOLDOWN, CUBED** — `f * f * f` of
   * `getAttackStrengthScale(1)`, not a constant 1. That is why a sword in vanilla dips after
   * every swing and climbs back as the cooldown bar fills, and it is a thing this engine has
   * never done: the cube is what makes the recovery start slow and finish fast.
   */
  H.EQUIP_STEP = 0.4;
  H.EQUIP_SWAP_BELOW = 0.1;
  H.mainHandHeight = 1;
  H.oMainHandHeight = 1;
  H.mainHandItem = -1;       // the item index currently BEING DRAWN, which lags the held one
  H.mainHandStack = undefined; // vanilla's `mainHand` reference (undefined = untracked, adopt the held stack)
  // #10747 the OFFHAND half of `HeldItemRenderer`: equipProgressOffHand / prevEquipProgressOffHand / offHand
  H.offHandHeight = 1;
  H.oOffHandHeight = 1;
  H.offHandItem = -1;
  H.offHandStack = undefined;

  /** `getOffHandStack()`: inventory slot 40, or null. */
  H.offHandStackOf = function (p) {
    var Iv = NS.Inventory;
    return p && p.inventory && Iv && Iv.getItem ? Iv.getItem(p.inventory, Iv.OFFHAND) : null;
  };
  H.indexOfStack = function (st) {
    var Iv = NS.Inventory;
    return !st || (Iv && Iv.isEmpty(st)) ? -1 : (st.i | 0);
  };

  /** `ItemStack.areEqual`: count, item and tags (empty equals empty). */
  H.stacksEqual = function (a, b) {
    var Iv = NS.Inventory;
    var ea = !a || (Iv && Iv.isEmpty(a)), eb = !b || (Iv && Iv.isEmpty(b));
    if (ea || eb) return ea && eb;
    return a.n === b.n && Iv.isSameItemSameTags(a, b);
  };

  /** The held item's index, or -1 for an empty hand. One place, so the two comparisons agree. */
  H.heldIndexOf = function (p) {
    var Iv = NS.Inventory;
    var st = p && p.heldItem ? p.heldItem() : null;
    if (!st || (Iv && Iv.isEmpty(st))) return -1;
    return st.i | 0;
  };

  /** PlayerEntity.tick's `selectedItem` check: a different ITEM (or to/from an empty hand) empties the cooldown (#396).
   *  The first call only records. */
  H.noteSelected = function (p) {
    var now = H.heldIndexOf(p);
    p.attrStack = p.heldItem ? p.heldItem() : null;   // LivingEntity.tick refreshes the mainhand attribute modifiers here, not at the slot packet
    if (now !== p.selectedItemIdx) { if (p.selectedItemIdx !== undefined) H.resetAttackStrength(); p.selectedItemIdx = now; }
  };

  H.tickEquip = function (p) {
    var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
    H.oMainHandHeight = H.mainHandHeight;
    var held = H.heldIndexOf(p);
    // vanilla `HeldItemRenderer.updateHeldItems` sinks the hands only on `isRiding()` (paddling a boat), NOT on
    // eating/drinking/drawing a bow (`handsBusy`): those keep the item up for the use-action transform
    if (p && p.paddling) {
      H.mainHandHeight = clamp(H.mainHandHeight - H.EQUIP_STEP, 0, 1);
    } else {
      var f = H.attackStrengthScale(p && p.heldItem ? p.heldItem() : null, 1);
      // vanilla: adopt the reference when areEqual; the target is the cooldown only when it is the SAME reference
      var cur = p && p.heldItem ? p.heldItem() : null;
      if (H.mainHandItem === held && (H.mainHandStack === undefined || H.stacksEqual(H.mainHandStack, cur))) H.mainHandStack = cur;
      var target = (H.mainHandItem === held && H.mainHandStack === cur) ? f * f * f : 0;
      H.mainHandHeight += clamp(target - H.mainHandHeight, -H.EQUIP_STEP, H.EQUIP_STEP);
    }
    if (H.mainHandHeight < H.EQUIP_SWAP_BELOW) {
      H.mainHandItem = held;
      H.mainHandStack = p && p.heldItem ? p.heldItem() : null;
    }
    // the offhand: same shape, target is 1 when the drawn reference IS the held one, else 0 (no cooldown cube)
    H.oOffHandHeight = H.offHandHeight;
    var off = H.offHandStackOf(p);
    if (H.offHandStack !== undefined && H.stacksEqual(H.offHandStack, off)) H.offHandStack = off;
    if (p && p.paddling) {
      H.offHandHeight = clamp(H.offHandHeight - H.EQUIP_STEP, 0, 1);
    } else {
      H.offHandHeight += clamp((H.offHandStack === off ? 1 : 0) - H.offHandHeight, -H.EQUIP_STEP, H.EQUIP_STEP);
    }
    if (H.offHandHeight < H.EQUIP_SWAP_BELOW) {
      H.offHandStack = off;
      H.offHandItem = H.indexOfStack(off);
    }
    return H.mainHandHeight;
  };

  /** `HeldItemRenderer.resetEquipProgress`: snap the held item down; `tickEquip` raises it 0.4/tick. */
  H.resetEquipProgress = function (hand) { if (hand === 1) H.offHandHeight = 0; else H.mainHandHeight = 0; };

  /** Reset everything — a world change, a death, a gamemode switch. */
  H.reset = function () {
    H.mainHandHeight = 1; H.oMainHandHeight = 1; H.mainHandItem = -1; H.mainHandStack = undefined;
    H.offHandHeight = 1; H.oOffHandHeight = 1; H.offHandItem = -1; H.offHandStack = undefined;
    H.swinging = false; H.swingTime = 0; H.swingArm = 0;
    H.attackAnim = 0; H.prevAttackAnim = 0;
    H.attackStrengthTicker = 0;
    H.crackStage = -1; H.crackKey = -1;
  };
})(MCL);
