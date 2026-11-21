# 11500 — loot/function class triage (27 classes)

Ported without citation (now cited atop `src/07e_loot.js`): SetCount, ApplyBonus, ExplosionDecay, LimitCount, CopyName, CopyState,
CopyNbt, SetContents, FurnaceSmelt, SetPotion (switch cases in `applyFn`), plus the framework classes ConditionalLootFunction,
LootFunction, LootFunctionType(s), LootFunctionManager, LootFunctionConsumingBuilder (JSON-driven `conditions()`/`applyFn`/`applyAll`; builders are datagen-only).

Genuinely NOT ported (unknown functions currently pass the stack through): EnchantRandomly, ExplorationMap, FillPlayerHead, SetAttributes,
SetBannerPattern, SetEnchantments, SetLootTable, SetLore, SetName, SetNbt, SetStewEffect. They matter for structure chest tables;
follow-up issue filed for porting them.
