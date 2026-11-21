# 11496 — client/gui class triage (98 classes)

Cited now (comments in src): DeathScreen, GameMenuScreen, ClientBossBar, furnace/blast/smoker/3x3/stonecutter/cartography screens,
widget classes (as hit-rects in `H.hit`), tooltip components, chat listeners/lines, spectator menu classes, option screens,
WorldGenerationProgressTracker, SaveLevelScreen, StatsListener.

Ruled OUT of scope (single-player, one-file build, no network/server list/realms/narrator): AddServerScreen, ConnectScreen,
DirectConnectScreen, DisconnectedScreen, MultiplayerScreen/ServerListWidget/WarningScreen, SocialInteractions*, OpenToLanScreen,
DemoScreen, DatapackFailureScreen, BackupPromptScreen, FatalErrorScreen, OutOfMemoryScreen, OptimizeWorldScreen, NoticeScreen,
WarningScreen, DialogScreen, Narratable/Narration*, ScreenTexts, ParentElement/AbstractParentElement/EntryListWidget family
(Java widget-tree plumbing, replaced by immediate-mode hit rects), CreativeInventoryListener, BundleTooltipComponent (1.18.2 bundle tooltip only shows via text).

Genuinely not ported (candidate follow-ups, NOT claimed done): BeaconScreen, SmithingScreen/ForgingScreen UI (handler exists in 14g_menu.js),
SignEditScreen, JigsawBlockScreen, StructureBlockScreen, TeamTeleportSpectatorMenu, OnlineOptionsScreen, AdvancementObtainedStatus,
RecipeAlternativesWidget/RecipeBookGhostSlots/AnimatedResultButton details.
