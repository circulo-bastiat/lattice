// NS.NetListener: net/minecraft/network/listener (#11745). Cited (Yarn): PacketListener ServerPacketListener
//  ClientLoginPacketListener ClientPlayPacketListener ClientQueryPacketListener ServerHandshakePacketListener
//  ServerLoginPacketListener ServerPlayPacketListener ServerQueryPacketListener.
// A Java interface becomes a table {name, parent, methods:{onX:'PacketClass'}}; PacketListener's default
// shouldCrashOnException (true; ServerPacketListener overrides to false) is inherited through `parent`.
// implement() refuses a listener missing any handler (what the Java compiler enforces); dispatch() is Packet.apply(listener).
// Reached from NS.NetListener.loopback, the in-process connection used by the single-player server side.
(function (NS) {
  'use strict';
  var L = NS.NetListener = {}, I = L.interfaces = {};
  function iface(name, parent, list) {
    var methods = {};
    for (var i = 0; i < list.length; i++) { var p = list[i].split(':'); methods[p[0]] = p[1]; }
    return { name: name, parent: parent, methods: methods };
  }
  I.PacketListener = { name: 'PacketListener', parent: null, methods: {}, abstract: ['onDisconnected', 'getConnection'], shouldCrashOnException: true };
  I.ServerPacketListener = { name: 'ServerPacketListener', parent: 'PacketListener', methods: {}, shouldCrashOnException: false };
  I.ClientLoginPacketListener = iface('ClientLoginPacketListener', 'PacketListener', [
    'onHello:LoginHelloS2CPacket',
    'onSuccess:LoginSuccessS2CPacket',
    'onDisconnect:LoginDisconnectS2CPacket',
    'onCompression:LoginCompressionS2CPacket',
    'onQueryRequest:LoginQueryRequestS2CPacket'
  ]);
  I.ClientPlayPacketListener = iface('ClientPlayPacketListener', 'PacketListener', [
    'onEntitySpawn:EntitySpawnS2CPacket',
    'onExperienceOrbSpawn:ExperienceOrbSpawnS2CPacket',
    'onVibration:VibrationS2CPacket',
    'onMobSpawn:MobSpawnS2CPacket',
    'onScoreboardObjectiveUpdate:ScoreboardObjectiveUpdateS2CPacket',
    'onPaintingSpawn:PaintingSpawnS2CPacket',
    'onPlayerSpawn:PlayerSpawnS2CPacket',
    'onEntityAnimation:EntityAnimationS2CPacket',
    'onStatistics:StatisticsS2CPacket',
    'onUnlockRecipes:UnlockRecipesS2CPacket',
    'onBlockBreakingProgress:BlockBreakingProgressS2CPacket',
    'onSignEditorOpen:SignEditorOpenS2CPacket',
    'onBlockEntityUpdate:BlockEntityUpdateS2CPacket',
    'onBlockEvent:BlockEventS2CPacket',
    'onBlockUpdate:BlockUpdateS2CPacket',
    'onGameMessage:GameMessageS2CPacket',
    'onChunkDeltaUpdate:ChunkDeltaUpdateS2CPacket',
    'onMapUpdate:MapUpdateS2CPacket',
    'onCloseScreen:CloseScreenS2CPacket',
    'onInventory:InventoryS2CPacket',
    'onOpenHorseScreen:OpenHorseScreenS2CPacket',
    'onScreenHandlerPropertyUpdate:ScreenHandlerPropertyUpdateS2CPacket',
    'onScreenHandlerSlotUpdate:ScreenHandlerSlotUpdateS2CPacket',
    'onCustomPayload:CustomPayloadS2CPacket',
    'onDisconnect:DisconnectS2CPacket',
    'onEntityStatus:EntityStatusS2CPacket',
    'onEntityAttach:EntityAttachS2CPacket',
    'onEntityPassengersSet:EntityPassengersSetS2CPacket',
    'onExplosion:ExplosionS2CPacket',
    'onGameStateChange:GameStateChangeS2CPacket',
    'onKeepAlive:KeepAliveS2CPacket',
    'onChunkData:ChunkDataS2CPacket',
    'onUnloadChunk:UnloadChunkS2CPacket',
    'onWorldEvent:WorldEventS2CPacket',
    'onGameJoin:GameJoinS2CPacket',
    'onEntity:EntityS2CPacket',
    'onPlayerPositionLook:PlayerPositionLookS2CPacket',
    'onParticle:ParticleS2CPacket',
    'onPing:PlayPingS2CPacket',
    'onPlayerAbilities:PlayerAbilitiesS2CPacket',
    'onPlayerList:PlayerListS2CPacket',
    'onEntitiesDestroy:EntitiesDestroyS2CPacket',
    'onRemoveEntityStatusEffect:RemoveEntityStatusEffectS2CPacket',
    'onPlayerRespawn:PlayerRespawnS2CPacket',
    'onEntitySetHeadYaw:EntitySetHeadYawS2CPacket',
    'onUpdateSelectedSlot:UpdateSelectedSlotS2CPacket',
    'onScoreboardDisplay:ScoreboardDisplayS2CPacket',
    'onEntityTrackerUpdate:EntityTrackerUpdateS2CPacket',
    'onEntityVelocityUpdate:EntityVelocityUpdateS2CPacket',
    'onEntityEquipmentUpdate:EntityEquipmentUpdateS2CPacket',
    'onExperienceBarUpdate:ExperienceBarUpdateS2CPacket',
    'onHealthUpdate:HealthUpdateS2CPacket',
    'onTeam:TeamS2CPacket',
    'onScoreboardPlayerUpdate:ScoreboardPlayerUpdateS2CPacket',
    'onPlayerSpawnPosition:PlayerSpawnPositionS2CPacket',
    'onWorldTimeUpdate:WorldTimeUpdateS2CPacket',
    'onPlaySound:PlaySoundS2CPacket',
    'onPlaySoundFromEntity:PlaySoundFromEntityS2CPacket',
    'onPlaySoundId:PlaySoundIdS2CPacket',
    'onItemPickupAnimation:ItemPickupAnimationS2CPacket',
    'onEntityPosition:EntityPositionS2CPacket',
    'onEntityAttributes:EntityAttributesS2CPacket',
    'onEntityStatusEffect:EntityStatusEffectS2CPacket',
    'onSynchronizeTags:SynchronizeTagsS2CPacket',
    'onEndCombat:EndCombatS2CPacket',
    'onEnterCombat:EnterCombatS2CPacket',
    'onDeathMessage:DeathMessageS2CPacket',
    'onDifficulty:DifficultyS2CPacket',
    'onSetCameraEntity:SetCameraEntityS2CPacket',
    'onWorldBorderInitialize:WorldBorderInitializeS2CPacket',
    'onWorldBorderInterpolateSize:WorldBorderInterpolateSizeS2CPacket',
    'onWorldBorderSizeChanged:WorldBorderSizeChangedS2CPacket',
    'onWorldBorderWarningTimeChanged:WorldBorderWarningTimeChangedS2CPacket',
    'onWorldBorderWarningBlocksChanged:WorldBorderWarningBlocksChangedS2CPacket',
    'onWorldBorderCenterChanged:WorldBorderCenterChangedS2CPacket',
    'onPlayerListHeader:PlayerListHeaderS2CPacket',
    'onResourcePackSend:ResourcePackSendS2CPacket',
    'onBossBar:BossBarS2CPacket',
    'onCooldownUpdate:CooldownUpdateS2CPacket',
    'onVehicleMove:VehicleMoveS2CPacket',
    'onAdvancements:AdvancementUpdateS2CPacket',
    'onSelectAdvancementTab:SelectAdvancementTabS2CPacket',
    'onCraftFailedResponse:CraftFailedResponseS2CPacket',
    'onCommandTree:CommandTreeS2CPacket',
    'onStopSound:StopSoundS2CPacket',
    'onCommandSuggestions:CommandSuggestionsS2CPacket',
    'onSynchronizeRecipes:SynchronizeRecipesS2CPacket',
    'onLookAt:LookAtS2CPacket',
    'onNbtQueryResponse:NbtQueryResponseS2CPacket',
    'onLightUpdate:LightUpdateS2CPacket',
    'onOpenWrittenBook:OpenWrittenBookS2CPacket',
    'onOpenScreen:OpenScreenS2CPacket',
    'onSetTradeOffers:SetTradeOffersS2CPacket',
    'onChunkLoadDistance:ChunkLoadDistanceS2CPacket',
    'onSimulationDistance:SimulationDistanceS2CPacket',
    'onChunkRenderDistanceCenter:ChunkRenderDistanceCenterS2CPacket',
    'onPlayerActionResponse:PlayerActionResponseS2CPacket',
    'onOverlayMessage:OverlayMessageS2CPacket',
    'onSubtitle:SubtitleS2CPacket',
    'onTitle:TitleS2CPacket',
    'onTitleFade:TitleFadeS2CPacket',
    'onTitleClear:ClearTitleS2CPacket'
  ]);
  I.ClientQueryPacketListener = iface('ClientQueryPacketListener', 'PacketListener', [
    'onResponse:QueryResponseS2CPacket',
    'onPong:QueryPongS2CPacket'
  ]);
  I.ServerHandshakePacketListener = iface('ServerHandshakePacketListener', 'ServerPacketListener', [
    'onHandshake:HandshakeC2SPacket'
  ]);
  I.ServerLoginPacketListener = iface('ServerLoginPacketListener', 'ServerPacketListener', [
    'onHello:LoginHelloC2SPacket',
    'onKey:LoginKeyC2SPacket',
    'onQueryResponse:LoginQueryResponseC2SPacket'
  ]);
  I.ServerPlayPacketListener = iface('ServerPlayPacketListener', 'ServerPacketListener', [
    'onHandSwing:HandSwingC2SPacket',
    'onChatMessage:ChatMessageC2SPacket',
    'onClientStatus:ClientStatusC2SPacket',
    'onClientSettings:ClientSettingsC2SPacket',
    'onButtonClick:ButtonClickC2SPacket',
    'onClickSlot:ClickSlotC2SPacket',
    'onCraftRequest:CraftRequestC2SPacket',
    'onCloseHandledScreen:CloseHandledScreenC2SPacket',
    'onCustomPayload:CustomPayloadC2SPacket',
    'onPlayerInteractEntity:PlayerInteractEntityC2SPacket',
    'onKeepAlive:KeepAliveC2SPacket',
    'onPlayerMove:PlayerMoveC2SPacket',
    'onPong:PlayPongC2SPacket',
    'onUpdatePlayerAbilities:UpdatePlayerAbilitiesC2SPacket',
    'onPlayerAction:PlayerActionC2SPacket',
    'onClientCommand:ClientCommandC2SPacket',
    'onPlayerInput:PlayerInputC2SPacket',
    'onUpdateSelectedSlot:UpdateSelectedSlotC2SPacket',
    'onCreativeInventoryAction:CreativeInventoryActionC2SPacket',
    'onUpdateSign:UpdateSignC2SPacket',
    'onPlayerInteractBlock:PlayerInteractBlockC2SPacket',
    'onPlayerInteractItem:PlayerInteractItemC2SPacket',
    'onSpectatorTeleport:SpectatorTeleportC2SPacket',
    'onResourcePackStatus:ResourcePackStatusC2SPacket',
    'onBoatPaddleState:BoatPaddleStateC2SPacket',
    'onVehicleMove:VehicleMoveC2SPacket',
    'onTeleportConfirm:TeleportConfirmC2SPacket',
    'onRecipeBookData:RecipeBookDataC2SPacket',
    'onRecipeCategoryOptions:RecipeCategoryOptionsC2SPacket',
    'onAdvancementTab:AdvancementTabC2SPacket',
    'onRequestCommandCompletions:RequestCommandCompletionsC2SPacket',
    'onUpdateCommandBlock:UpdateCommandBlockC2SPacket',
    'onUpdateCommandBlockMinecart:UpdateCommandBlockMinecartC2SPacket',
    'onPickFromInventory:PickFromInventoryC2SPacket',
    'onRenameItem:RenameItemC2SPacket',
    'onUpdateBeacon:UpdateBeaconC2SPacket',
    'onUpdateStructureBlock:UpdateStructureBlockC2SPacket',
    'onSelectMerchantTrade:SelectMerchantTradeC2SPacket',
    'onBookUpdate:BookUpdateC2SPacket',
    'onQueryEntityNbt:QueryEntityNbtC2SPacket',
    'onQueryBlockNbt:QueryBlockNbtC2SPacket',
    'onUpdateJigsaw:UpdateJigsawC2SPacket',
    'onJigsawGenerating:JigsawGeneratingC2SPacket',
    'onUpdateDifficulty:UpdateDifficultyC2SPacket',
    'onUpdateDifficultyLock:UpdateDifficultyLockC2SPacket'
  ]);
  I.ServerQueryPacketListener = iface('ServerQueryPacketListener', 'ServerPacketListener', [
    'onPing:QueryPingC2SPacket',
    'onRequest:QueryRequestC2SPacket'
  ]);
  /** Walks parents; PacketListener.shouldCrashOnException default, ServerPacketListener override. */
  L.shouldCrashOnException = function (name) {
    for (var n = name; n; n = I[n].parent) if (I[n].shouldCrashOnException !== undefined) return I[n].shouldCrashOnException;
    return true;
  };
  L.isServerSide = function (name) { for (var n = name; n; n = I[n].parent) if (n === 'ServerPacketListener') return true; return false; };
  L.missing = function (name, impl) {
    var out = [], n, k;
    for (n = name; n; n = I[n].parent) {
      for (k in I[n].methods) if (typeof impl[k] !== 'function') out.push(k);
      (I[n].abstract || []).forEach(function (a) { if (typeof impl[a] !== 'function') out.push(a); });
    }
    return out;
  };
  /** Tags impl as an implementation of `name`; throws listing missing handlers. Adds the default shouldCrashOnException. */
  L.implement = function (name, impl) {
    var m = L.missing(name, impl);
    if (m.length) throw new Error(name + ' not implemented: ' + m.join(','));
    if (typeof impl.shouldCrashOnException !== 'function') impl.shouldCrashOnException = function () { return L.shouldCrashOnException(name); };
    impl.listenerType = name;
    return impl;
  };
  /** Packet.apply(listener): packet = {type:'onX', ...}. Wrong-direction/unknown handlers throw. */
  L.dispatch = function (impl, handler, packet) {
    var def = I[impl.listenerType];
    if (!def) throw new Error('not a PacketListener');
    var ok = false;
    for (var n = impl.listenerType; n; n = I[n].parent) if (I[n].methods[handler]) ok = true;
    if (!ok) throw new Error(impl.listenerType + ' has no handler ' + handler);
    return impl[handler](packet);
  };
  /** In-process connection: server-side listener on one end; send() applies the packet to it. */
  L.loopback = function (serverImpl) {
    return { getConnection: function () { return this; }, send: function (handler, packet) { return L.dispatch(serverImpl, handler, packet); } };
  };

})(MCL);
