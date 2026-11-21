# 11501 - client/sound triage (26 classes)
Cited in src/02j_sounds.js header. Table/Web Audio equivalents: SoundManager, SoundEntry(+Deserializer), SoundContainer, WeightedSoundSet, SoundEngine, SoundListener, SoundInstance, AbstractSoundInstance.
Ruled out (OpenAL/Ogg streaming plumbing, the browser decodes and mixes): AlUtil, Channel, StaticSound, AudioStream, OggAudioStream, RepeatingAudioStream, SoundExecutor, SoundInstanceListener.
Genuinely NOT ported (cited as owed, not claimed): tickable/entity-tracking loops - Elytra, bee (aggressive/passive), guardian attack, ambient loops/player, bubble column. Parity work for a follow-up issue.

Update #11728: ElytraSoundInstance (Sound.elytraTick) and BubbleColumnSoundPlayer (Sound.bubbleColumnTick) are ported and wired from Player.tick (clientsoundloopcheck). Bee loops are ported (07zo_bee, beeloopcheck); GuardianAttackSoundInstance is a one-shot in 07zzr_guardian. Still owed: AmbientSoundPlayer/AmbientSoundLoops (biome mood/additions/underwater loops).
