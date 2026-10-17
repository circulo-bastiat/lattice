// growbot.mjs — infra I6 (24 Sept 2026): a minimal 1.18.2 (protocol 758) OFFLINE-MODE play-state
// client, for rungrowth.mjs. `/forceload` keeps a chunk LOADED and driving block entities and
// scheduled ticks (that's all hopperrefcheck/redrefcheck/furnacerefcheck ever needed), but it is
// NOT enough for RANDOM ticks: `ThreadedAnvilChunkStorage.shouldTick(ChunkPos)`
// (.decomp/net/minecraft/server/world/ThreadedAnvilChunkStorage.java:917-923) requires
// `this.playerChunkWatchingManager.getPlayersWatchingChunk(pos)` to be non-empty — a REAL player
// watching that chunk — before `ServerChunkManager.tickChunks()`
// (.decomp/net/minecraft/server/world/ServerChunkManager.java:363) ever calls `world.tickChunk`,
// which is what runs `CropBlock.randomTick` and everyone else's. Confirmed empirically: a
// forceloaded, `randomTickSpeed 5000` field with no player connected grew nothing in 165 real
// ticks; the same field matured a wheat plant to age 7 in 240 ticks once this bot was standing in
// it (see the growth-timing pack's dispatch notes). This is exactly the "AFK farm" folklore —
// vanilla farms without a player nearby (or a mod's fake-player chunk loader) do not grow.
//
// This client does the absolute minimum to be a "player watching a chunk": handshake, offline
// login (no encryption -- online-mode=false), the login-state compression switch, and answering
// every Keep Alive so the server does not time it out. It never parses a chunk, an entity or any
// other play packet's CONTENTS — every packet it does not recognise is skipped WHOLESALE using
// the outer VarInt length prefix (post-decompression), so getting a stray packet ID wrong costs
// nothing; only Login Success (0x02), Set Compression (0x03) and Play Keep Alive (0x21 s2c / 0x0f
// c2s, protocol 758) are read for their own sake.
import net from 'node:net';
import zlib from 'node:zlib';

function writeVarInt(n) {
  const out = [];
  n = n >>> 0;
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return Buffer.from(out);
}
function readVarInt(buf, off) {
  let val = 0, shift = 0, pos = off;
  for (;;) {
    const b = buf[pos++];
    val |= (b & 0x7f) << shift;
    if (!(b & 0x80)) break;
    shift += 7;
  }
  return [val >>> 0, pos];
}
function writeString(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([writeVarInt(b.length), b]);
}
function packet(id, ...parts) {
  const body = Buffer.concat([writeVarInt(id), ...parts]);
  return Buffer.concat([writeVarInt(body.length), body]);
}

// infra W (25 Sept 2026, D-685's own referee pack) -- ADDITIVE: `captureVelocity` makes the
// controller also decode Join Game (0x26 s2c, protocol 758 -- first field is an Int, NOT a VarInt,
// the entity id) for its OWN entity id, and Set Entity Velocity (0x4F s2c: entityId VarInt, vx/vy/vz
// Short each, 1/8000 block/tick, protocol 758) for ANY entity, appending `{id, vx, vy, vz, t}` to
// `controller.velocities` (vx/vy/vz already converted to blocks/tick). Every existing caller keeps
// working: this is dark unless the option is passed, same packets are otherwise skipped wholesale.
function readShortBE(buf, off) { return buf.readInt16BE(off); }

// infra I6 (s143, 25 Sept 2026, the PLAYER HAZARDS pack) -- ADDITIVE: `confirmTeleports` makes the bot answer every
// Player Position And Look (0x38 s2c, protocol 758: X/Y/Z Double, Yaw/Pitch Float, Flags Byte, Teleport ID VarInt, Dismount
// Boolean) with Teleport Confirm (0x00 c2s, the id). Without it ServerPlayNetworkHandler.onPlayerMove DROPS every Player
// Position packet while `requestedTeleportPos != null` (the join teleport never clears), so the server never runs
// player.move -> Entity.checkBlockCollision for the bot: magma, campfires, fire blocks, wither roses and powder snow never
// touch it, and a client-driven fall never registers. `sendPos(x, y, z, onGround)` sends one Player Position with an
// explicit onGround. Dark unless the option is passed.
export function connectFakePlayer({ port, name, captureVelocity, confirmTeleports }) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: '127.0.0.1', port });
    let buf = Buffer.alloc(0);
    let compressed = false, threshold = -1;
    let state = 'handshake'; // handshake -> login -> play
    let closed = false, settled = false;
    let entityId = null;
    let lastSpawnedEntityId = null;
    const velocities = [];
    let lastTeleport = null, teleports = 0;
    const spawnedIds = [];
    // Spawn Living Entity (0x02 s2c, protocol 758): EntityID VarInt, EntityUUID (16 bytes, unread),
    // Type VarInt, ... -- only the id is needed (`bot.attack()` targets it), so nothing past it is
    // parsed. This bot is always alone with at most one extra (the scenario's own mob) in its
    // forceloaded lane, so "the last one spawned" IS the current scenario's target -- runkb.mjs's
    // own contract, not guessed here.
    const JOIN_GAME = 0x26, SET_ENTITY_VELOCITY = 0x4f, INTERACT_ENTITY_C2S = 0x0d, SPAWN_LIVING_ENTITY = 0x02; // protocol 758
    const KEEPALIVE_S2C = 0x21, KEEPALIVE_C2S = 0x0f; // protocol 758 (verified empirically below)

    function send(buffer) { if (!sock.destroyed) sock.write(buffer); }
    function sendPacket(id, ...parts) {
      if (!compressed) { send(packet(id, ...parts)); return; }
      const body = Buffer.concat([writeVarInt(id), ...parts]);
      if (body.length < threshold) {
        const inner = Buffer.concat([writeVarInt(0), body]);
        send(Buffer.concat([writeVarInt(inner.length), inner]));
      } else {
        const comp = zlib.deflateSync(body);
        const inner = Buffer.concat([writeVarInt(body.length), comp]);
        send(Buffer.concat([writeVarInt(inner.length), inner]));
      }
    }

    function handlePacket(id, data) {
      if (state === 'login') {
        if (id === 0x03) { // Set Compression
          const [t] = readVarInt(data, 0);
          threshold = t; compressed = true;
        } else if (id === 0x02) { // Login Success -> switch to play
          state = 'play';
        } else if (id === 0x00) { // Disconnect (login)
          if (!settled) { settled = true; reject(new Error('growbot: login disconnect: ' + data.toString('utf8').slice(0, 300))); }
        }
      } else if (state === 'play') {
        if (id === KEEPALIVE_S2C && data.length >= 8) {
          sendPacket(KEEPALIVE_C2S, data.subarray(0, 8));
        } else if (id === 0x19 && !settled) {
          // Disconnect (play) -- protocol 758's play-state disconnect id; surfaced as a failure
          settled = true; reject(new Error('growbot: play disconnect: ' + data.toString('utf8').slice(0, 300)));
        } else if (confirmTeleports && id === 0x38 && data.length >= 34) {
          const [tid] = readVarInt(data, 33);
          lastTeleport = { x: data.readDoubleBE(0), y: data.readDoubleBE(8), z: data.readDoubleBE(16), flags: data[32], id: tid };
          teleports++;
          sendPacket(0x00, writeVarInt(tid));
        } else if (id === JOIN_GAME && entityId === null) {
          // infra W (25 Sept 2026, PLAYER HUNGER pack) -- ADDITIVE: entity id capture no longer needs
          // `captureVelocity`; `setSprinting()` below needs it too and costs nothing to always parse
          // (four bytes off a packet every caller already receives and, before this, discarded).
          entityId = data.readInt32BE(0); // Join Game's own entity id -- an Int, not a VarInt
        } else if (captureVelocity && id === SET_ENTITY_VELOCITY) {
          const [vid, after] = readVarInt(data, 0);
          const vx = readShortBE(data, after) / 8000, vy = readShortBE(data, after + 2) / 8000, vz = readShortBE(data, after + 4) / 8000;
          velocities.push({ id: vid, vx, vy, vz, t: Date.now() });
        } else if (captureVelocity && id === SPAWN_LIVING_ENTITY) {
          const [sid] = readVarInt(data, 0);
          lastSpawnedEntityId = sid;
          spawnedIds.push(sid);   // infra I6 s143 (PLAYER MELEE): every living spawn in order -- a sweep scene has two targets
        }
      }
    }

    function pump() {
      for (;;) {
        if (buf.length < 1) return;
        let len, afterLen;
        try { [len, afterLen] = readVarInt(buf, 0); } catch { return; }
        if (buf.length < afterLen + len) return;
        let body = buf.subarray(afterLen, afterLen + len);
        buf = buf.subarray(afterLen + len);
        if (compressed) {
          const [dataLen, afterDataLen] = readVarInt(body, 0);
          const rest = body.subarray(afterDataLen);
          body = dataLen === 0 ? rest : zlib.inflateSync(rest);
        }
        const [id, afterId] = readVarInt(body, 0);
        handlePacket(id, body.subarray(afterId));
      }
    }

    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); pump();
      if (state === 'play' && !settled) { settled = true; resolve(controller); }
    });
    sock.on('error', (e) => { if (!settled) { settled = true; reject(e); } });
    sock.on('close', () => { closed = true; });

    sock.on('connect', () => {
      // Handshake: protocol 758, server address/port (unused by the server), next state = 2 (login)
      send(packet(0x00, writeVarInt(758), writeString('127.0.0.1'), Buffer.from([(port >> 8) & 0xff, port & 0xff]), writeVarInt(2)));
      state = 'login';
      send(packet(0x00, writeString(name)));
    });

    const controller = {
      close() { closed = true; try { sock.destroy(); } catch { /* ignore */ } },
      get closed() { return closed; },
      get entityId() { return entityId; },
      get velocities() { return velocities; },
      get lastSpawnedEntityId() { return lastSpawnedEntityId; },
      get lastTeleport() { return lastTeleport; },
      get spawnedIds() { return spawnedIds; },
      get teleports() { return teleports; },
      sendPos(x, y, z, onGround) {
        const b = Buffer.alloc(24);
        b.writeDoubleBE(x, 0); b.writeDoubleBE(y, 8); b.writeDoubleBE(z, 16);
        sendPacket(0x11, b, Buffer.from([onGround ? 1 : 0]));
      },
      // Interact Entity (0x0d c2s, protocol 758), Type=1 (Attack): Entity ID VarInt, Type VarInt,
      // Sneaking Boolean (trailing field since 1.16 for every interact type, not just type 2).
      // infra I6 s143 (TAMING pack) -- Interact Entity Type=0 (Interact): Entity ID, Type, Hand VarInt (0 = main hand),
      // Sneaking -- what a real client's right-click on a mob sends (after its Type=2 interact_at, which a mob ignores).
      interact(targetEntityId, hand = 0) {
        sendPacket(INTERACT_ENTITY_C2S, writeVarInt(targetEntityId), writeVarInt(0), writeVarInt(hand), Buffer.from([0]));
      },
      attack(targetEntityId) {
        sendPacket(INTERACT_ENTITY_C2S, writeVarInt(targetEntityId), writeVarInt(1), Buffer.from([0]));
      },
      // infra I6 (ATTACK COOLDOWN pack): Animation / Hand Swing (0x2c c2s, protocol 758 -- NetworkState's 45th PLAY
      // serverbound registration): Hand VarInt (0 = main). ServerPlayerEntity.swingHand -> resetLastAttackedTicks, so a swing at
      // the air (a real client's miss) empties the server's attack cooldown. Dark unless called.
      swing(hand = 0) {
        sendPacket(0x2c, writeVarInt(hand));
      },
      // Held Item Change (0x25 c2s, protocol 758): Slot Short 0..8. The server only stores the slot; PlayerEntity.tick resets the
      // attack cooldown on the next tick when the main-hand item changed. Dark unless called.
      selectSlot(slot) {
        const b = Buffer.alloc(2); b.writeInt16BE(slot, 0);
        sendPacket(0x25, b);
      },
      // infra W (25 Sept 2026, PLAYER HUNGER pack) -- ADDITIVE, dark unless called. `setSprinting`
      // sends Player Command (0x1B c2s, protocol 758: Entity ID VarInt, Action ID VarInt [3 = start
      // sprinting, 4 = stop], Jump Boost VarInt [unused outside horse actions, sent as 0]) — the SAME
      // packet `ServerPlayNetworkHandler.onClientCommand` reads to flip `PlayerEntity.setSprinting`
      // (.decomp ServerPlayNetworkHandler.java:1211-1214), which is what
      // `PlayerEntity.increaseTravelMotionStats` (:1478 `this.isSprinting()`) actually branches on —
      // NOT the speed of the Player Position packets themselves. Needs `entityId`, always captured now.
      setSprinting(sprinting) {
        if (entityId === null) throw new Error('growbot: setSprinting before the entity id was seen (no Join Game yet)');
        sendPacket(0x1b, writeVarInt(entityId), writeVarInt(sprinting ? 3 : 4), writeVarInt(0));
      },
      // Player Position (0x11 c2s, protocol 758): X/FeetY/Z Double, OnGround Boolean. A REAL client
      // sends this every tick it is connected, even standing still -- a player's own `onGround` is
      // the LATEST REPORTED value of this flag (`ServerPlayerEntity`/`ServerPlayNetworkHandler`,
      // decomp), never server-computed collision the way a mob's is. Without it this bot's own
      // entity free-falls forever (`onGround` stuck at its spawn default `false`) and a hit's
      // vertical knockback clamp (`onGround ? min(0.4, vy/2+s) : vy`, LivingEntity.knockback) never
      // takes its on-ground branch -- discovered empirically running this pack (infra W, D-685).
      reportGround(x, y, z) {
        const d = Buffer.alloc(8);
        const buf3 = Buffer.alloc(24);
        d.writeDoubleBE(x, 0); d.copy(buf3, 0);
        d.writeDoubleBE(y, 0); d.copy(buf3, 8);
        d.writeDoubleBE(z, 0); d.copy(buf3, 16);
        sendPacket(0x11, buf3, Buffer.from([1]));
      },
      // Sends `reportGround` on a fixed interval (default 100ms, ~2 ticks) until `stopGroundLoop()` --
      // a background timer, not a blocking poll (D-436): callers still control their own waits.
      startGroundLoop(x, y, z, ms = 100) {
        const t = setInterval(() => { if (!closed) controller.reportGround(x, y, z); }, ms);
        return () => clearInterval(t);
      },
      // infra W (25 Sept 2026, PLAYER FOOD pack) -- ADDITIVE, dark unless called. `useItem` sends
      // Use Item (0x2f c2s, protocol 758: Hand VarInt, 0 = main hand) -- confirmed EMPIRICALLY
      // against this jar: 0x2e (the previously plausible id, one slot earlier in NetworkState's
      // serverbound PLAY registration) is Player Block Placement and disconnects the bot outright
      // (an out-of-range/garbage block placement -- `ServerPlayNetworkHandler.onPlayerInteractBlock`
      // throws), while 0x2f is read as Use Item and the bot survives, and `foodLevel` measurably
      // rises after it on every food scene this pack ran (runfood.mjs's own smoke check). Eating
      // needs the item held for `ItemStack.getMaxUseTime()` (32 ticks for ordinary food,
      // `LivingEntity.tickActiveItemStack` -- 40 for honey bottles/potions/milk, `UseAction.DRINK`)
      // before the SERVER's own timer finishes the use and calls `Item.finishUsing`; this packet
      // alone does not keep the "using" state open past the next Player Position the server sees
      // with no matching swing, so callers must keep `sendPos`/`reportGround` going (a ground loop
      // or repeated `sendPos`) for the whole hold -- `startGroundLoop`/`sendPos` above, not a new
      // method here.
      useItem(hand = 0) {
        sendPacket(0x2f, writeVarInt(hand));
      },
      // infra I6 (s146, USE-ON-BLOCK pack) -- ADDITIVE, dark unless called. Player Block Placement (0x2e c2s, protocol 758 --
      // the id useItem's own note above found by disconnecting on it): Hand VarInt, Location (Position: x 26 bits | z 26 | y 12,
      // one big-endian long), Face VarInt (0 down, 1 up, 2 north, 3 south, 4 west, 5 east), Cursor X/Y/Z Float (0..1 inside the
      // block), Inside Block Boolean. What a real client sends for a right-click on a block (`ClientPlayerInteractionManager.
      // interactBlock`); the server re-checks reach and runs `ServerPlayerInteractionManager.interactBlock` (block use, then
      // `ItemStack.useOnBlock`).
      useOnBlock(x, y, z, face, cx = 0.5, cy = 0.5, cz = 0.5, hand = 0) {
        const pos = Buffer.alloc(8);
        pos.writeBigUInt64BE(((BigInt(x) & 0x3FFFFFFn) << 38n) | ((BigInt(z) & 0x3FFFFFFn) << 12n) | (BigInt(y) & 0xFFFn));
        const cur = Buffer.alloc(12);
        cur.writeFloatBE(cx, 0); cur.writeFloatBE(cy, 4); cur.writeFloatBE(cz, 8);
        sendPacket(0x2e, writeVarInt(hand), pos, writeVarInt(face), cur, Buffer.from([0]));
      },
      // infra I6 (MINING pack) -- ADDITIVE, dark unless called. Player Digging (0x1a c2s, protocol 758 -- PlayerActionC2SPacket,
      // one slot before Entity Action 0x1b above): Status VarInt (0 START_DESTROY_BLOCK, 1 ABORT, 2 STOP_DESTROY_BLOCK), Location
      // (same packed long as useOnBlock), Face Byte (0 down, 1 up, ...). `ServerPlayerInteractionManager.processBlockBreakingAction`.
      dig(status, x, y, z, face = 1) {
        const pos = Buffer.alloc(8);
        pos.writeBigUInt64BE(((BigInt(x) & 0x3FFFFFFn) << 38n) | ((BigInt(z) & 0x3FFFFFFn) << 12n) | (BigInt(y) & 0xFFFn));
        sendPacket(0x1a, writeVarInt(status), pos, Buffer.from([face]));
      },
    };

    setTimeout(() => { if (!settled) { settled = true; reject(new Error('growbot: timed out reaching play state')); } }, +process.env.MCLITE_GROWBOT_TIMEOUT_MS || 90000);   // #7220: 15 s was too short on a loaded host (lockstep pilot jobs)
  });
}
