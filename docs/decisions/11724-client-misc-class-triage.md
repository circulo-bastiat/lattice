# 11724 — client misc class triage (30 classes)

Cited and mapped to real code: GrassColors, BiomeColorCache (06b_tintmap), ChestAnimationProgress (07c lid controller),
KeyboardInput (13_input), ModelPredicateProvider/UnclampedModelPredicateProvider (14l_use `angle`),
ModelPartData/ModelCuboidData/TextureDimensions (07j box-part tables), ToastManager, TooltipData (15_hud).
Proof links: tintcheck, advtoastcheck, inputcheck now name their classes.

Ruled OUT (single-player one-file build): ClientChunkManager, ClientEntityManager (World owns chunks/entities),
ClientBrandRetriever, ClientGameSession, MinecraftClientGame, RunArgs, WindowSettings, WindowEventHandler (launcher/window plumbing),
BlockColorProvider/ItemColorProvider (lambda interfaces; colours are table lookups).

Genuinely NOT ported (follow-ups, not claimed done): RecipeToast, SystemToast, TutorialToast, BundleTooltipData,
Searchable/SearchableContainer/IdentifierSearchableContainer/TextSearchableContainer/SuffixArray (creative search is a plain substring match).
