// NS.Net: net/minecraft/network, ported (#11744). Cited classes (Yarn names, all in this file):
//  PacketByteBuf (growable byte buffer: VarInt/VarLong, strings, arrays, BlockPos, UUID, enum, NBT, BitSet, collections),
//  Packet, NetworkSide, NetworkState (+ PacketHandler/Initializer), MessageType, OffThreadException, NetworkThreadUtils,
//  PacketEncoderException, the pipeline handlers SplitterHandler SizePrepender PacketInflater PacketDeflater DecoderHandler
//  PacketEncoder LegacyQueryHandler, and ClientConnection / RateLimitedConnection over an in-process loopback channel.
// There is no socket on file:// : the "channel" is a pipeline of handlers over byte arrays, which is exactly the part of
// ClientConnection that is not Netty. Longs are BigInt. Deflater writes zlib STORED blocks (valid zlib, no compression).
// Reached from /debug stop (15g_commands.js): the profile text is framed through a connection pair before it is kept.
(function (NS) {
  'use strict';
  var Net = NS.Net = {};
  var te = new TextEncoder(), td = new TextDecoder();
  function DecoderException(m) { var e = new Error(m); e.name = 'DecoderException'; return e; }
  function EncoderException(m) { var e = new Error(m); e.name = 'EncoderException'; return e; }
  Net.DecoderException = DecoderException; Net.EncoderException = EncoderException;
  /** PacketEncoderException: an EncoderException that the connection may skip. */
  Net.PacketEncoderException = function (cause) { var e = EncoderException(cause && cause.message || String(cause)); e.name = 'PacketEncoderException'; e.cause = cause; return e; };

  // ── PacketByteBuf ──────────────────────────────────────────────────────────────────────────────────────────────────────
  var PB = Net.PacketByteBuf = function (bytes) {
    this.a = bytes ? new Uint8Array(bytes) : new Uint8Array(64); this.r = 0; this.w = bytes ? bytes.length : 0;
    this.dv = new DataView(this.a.buffer);
  };
  PB.MAX_STRING = 32767; PB.MAX_TEXT = 262144; PB.MAX_NBT = 2097152;
  PB.getVarIntLength = function (v) { for (var i = 1; i < 5; i++) if ((v & (-1 << (i * 7))) === 0) return i; return 5; };
  PB.getVarLongLength = function (v) { v = BigInt.asUintN(64, BigInt(v)); for (var i = 1; i < 10; i++) if ((v >> BigInt(i * 7)) === 0n) return i; return 10; };
  PB.getMaxValidator = function (f, max) { return function (n) { if (n > max) throw DecoderException('Value ' + n + ' is larger than limit ' + max); return f(n); }; };
  var P = PB.prototype;
  P.readableBytes = function () { return this.w - this.r; };
  P.isReadable = function (n) { return this.w - this.r >= (n === undefined ? 1 : n); };
  P.writerIndex = function () { return this.w; };
  P.readerIndex = function (i) { if (i === undefined) return this.r; this.r = i; return this; };
  P.ensureWritable = function (n) {
    if (this.w + n <= this.a.length) return this;
    var b = new Uint8Array(Math.max(this.a.length * 2, this.w + n)); b.set(this.a.subarray(0, this.w)); this.a = b; this.dv = new DataView(b.buffer); return this;
  };
  P.need = function (n) { if (this.w - this.r < n) throw new RangeError('readerIndex(' + this.r + ') + length(' + n + ') exceeds writerIndex(' + this.w + ')'); };
  P.writeByte = function (v) { this.ensureWritable(1); this.a[this.w++] = v & 255; return this; };
  P.readByte = function () { this.need(1); return (this.a[this.r++] << 24) >> 24; };
  P.readUnsignedByte = function () { this.need(1); return this.a[this.r++]; };
  P.writeBoolean = function (v) { return this.writeByte(v ? 1 : 0); };
  P.readBoolean = function () { return this.readByte() !== 0; };
  P.writeShort = function (v) { this.ensureWritable(2); this.dv.setInt16(this.w, v); this.w += 2; return this; };
  P.readShort = function () { this.need(2); var v = this.dv.getInt16(this.r); this.r += 2; return v; };
  P.readUnsignedShort = function () { this.need(2); var v = this.dv.getUint16(this.r); this.r += 2; return v; };
  P.writeInt = function (v) { this.ensureWritable(4); this.dv.setInt32(this.w, v); this.w += 4; return this; };
  P.readInt = function () { this.need(4); var v = this.dv.getInt32(this.r); this.r += 4; return v; };
  P.writeLong = function (v) { this.ensureWritable(8); this.dv.setBigInt64(this.w, BigInt.asIntN(64, BigInt(v))); this.w += 8; return this; };
  P.readLong = function () { this.need(8); var v = this.dv.getBigInt64(this.r); this.r += 8; return v; };
  P.writeFloat = function (v) { this.ensureWritable(4); this.dv.setFloat32(this.w, v); this.w += 4; return this; };
  P.readFloat = function () { this.need(4); var v = this.dv.getFloat32(this.r); this.r += 4; return v; };
  P.writeDouble = function (v) { this.ensureWritable(8); this.dv.setFloat64(this.w, v); this.w += 8; return this; };
  P.readDouble = function () { this.need(8); var v = this.dv.getFloat64(this.r); this.r += 8; return v; };
  P.writeBytes = function (u8, off, len) {
    if (u8 instanceof PB) { len = u8.readableBytes(); var s = u8.a.subarray(u8.r, u8.w); u8.r = u8.w; u8 = s; off = 0; }
    off = off || 0; if (len === undefined) len = u8.length - off;
    this.ensureWritable(len); this.a.set(u8.subarray(off, off + len), this.w); this.w += len; return this;
  };
  P.readBytes = function (n) { this.need(n); var s = this.a.slice(this.r, this.r + n); this.r += n; return s; };
  P.getWrittenBytes = function () { return this.a.slice(0, this.w); };
  P.toBytes = function () { return this.a.slice(this.r, this.w); };
  P.readVarInt = function () {
    var v = 0, i = 0, b;
    do { b = this.readByte(); v |= (b & 127) << (i++ * 7); if (i > 5) throw new Error('VarInt too big'); } while ((b & 128) === 128);
    return v;
  };
  P.writeVarInt = function (v) { v |= 0; while ((v & -128) !== 0) { this.writeByte((v & 127) | 128); v >>>= 7; } this.writeByte(v); return this; };
  P.readVarLong = function () {
    var v = 0n, i = 0, b;
    do { b = this.readByte(); v |= BigInt(b & 127) << BigInt(i++ * 7); if (i > 10) throw new Error('VarLong too big'); } while ((b & 128) === 128);
    return BigInt.asIntN(64, v);
  };
  P.writeVarLong = function (v) {
    v = BigInt.asUintN(64, BigInt(v));
    while ((v & ~127n) !== 0n) { this.writeByte(Number(v & 127n) | 128); v >>= 7n; }
    this.writeByte(Number(v)); return this;
  };
  P.readString = function (max) {
    max = max || PB.MAX_STRING; var n = this.readVarInt();
    if (n > max * 4) throw DecoderException('The received encoded string buffer length is longer than maximum allowed (' + n + ' > ' + max * 4 + ')');
    if (n < 0) throw DecoderException('The received encoded string buffer length is less than zero! Weird string!');
    var s = td.decode(this.readBytes(n));
    if (s.length > max) throw DecoderException('The received string length is longer than maximum allowed (' + n + ' > ' + max + ')');
    return s;
  };
  P.writeString = function (s, max) {
    max = max || PB.MAX_STRING; var b = te.encode(s);
    if (b.length > max) throw EncoderException('String too big (was ' + b.length + ' bytes encoded, max ' + max + ')');
    this.writeVarInt(b.length); return this.writeBytes(b);
  };
  P.readIdentifier = function () { return this.readString(PB.MAX_STRING); };
  P.writeIdentifier = function (id) { return this.writeString(String(id)); };
  P.readText = function () { return JSON.parse(this.readString(PB.MAX_TEXT)); };
  P.writeText = function (t) { return this.writeString(typeof t === 'string' ? JSON.stringify({ text: t }) : JSON.stringify(t), PB.MAX_TEXT); };
  P.readByteArray = function (max) {
    var n = this.readVarInt(), m = max === undefined ? this.readableBytes() : max;
    if (n > m) throw DecoderException('ByteArray with size ' + n + ' is bigger than allowed ' + m); return this.readBytes(n);
  };
  P.writeByteArray = function (u8) { this.writeVarInt(u8.length); return this.writeBytes(u8); };
  P.readIntArray = function (max) {
    var n = this.readVarInt(), m = max === undefined ? this.readableBytes() : max;
    if (n > m) throw DecoderException('VarIntArray with size ' + n + ' is bigger than allowed ' + m);
    var o = new Int32Array(n); for (var i = 0; i < n; i++) o[i] = this.readVarInt(); return o;
  };
  P.writeIntArray = function (a) { this.writeVarInt(a.length); for (var i = 0; i < a.length; i++) this.writeVarInt(a[i]); return this; };
  P.readLongArray = function (max) {
    var n = this.readVarInt(), m = max === undefined ? (this.readableBytes() / 8) | 0 : max;
    if (n > m) throw DecoderException('LongArray with size ' + n + ' is bigger than allowed ' + m);
    var o = []; for (var i = 0; i < n; i++) o.push(this.readLong()); return o;
  };
  P.writeLongArray = function (a) { this.writeVarInt(a.length); for (var i = 0; i < a.length; i++) this.writeLong(a[i]); return this; };
  /** BlockPos.asLong / fromLong: x 26 bits << 38, z 26 bits << 12, y 12 bits. */
  Net.posToLong = function (p) {
    return BigInt.asIntN(64, ((BigInt(p.x) & 0x3FFFFFFn) << 38n) | ((BigInt(p.z) & 0x3FFFFFFn) << 12n) | (BigInt(p.y) & 0xFFFn));
  };
  Net.posFromLong = function (l) { return { x: Number(l >> 38n), y: Number(BigInt.asIntN(12, l)), z: Number(BigInt.asIntN(26, l >> 12n)) }; };
  P.writeBlockPos = function (p) { return this.writeLong(Net.posToLong(p)); };
  P.readBlockPos = function () { return Net.posFromLong(this.readLong()); };
  P.writeChunkPos = function (p) { return this.writeLong((BigInt.asUintN(32, BigInt(p.x))) | (BigInt.asUintN(32, BigInt(p.z)) << 32n)); };
  P.readChunkPos = function () { var l = this.readLong(); return { x: Number(BigInt.asIntN(32, l)), z: Number(l >> 32n) }; };
  P.writeUuid = function (u) { var h = String(u).replace(/-/g, ''); this.writeLong(BigInt('0x' + h.slice(0, 16))); return this.writeLong(BigInt('0x' + h.slice(16))); };
  P.readUuid = function () {
    var h = BigInt.asUintN(64, this.readLong()).toString(16).padStart(16, '0') + BigInt.asUintN(64, this.readLong()).toString(16).padStart(16, '0');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };
  P.writeEnumConstant = function (values, v) { return this.writeVarInt(values.indexOf(v)); };
  P.readEnumConstant = function (values) { return values[this.readVarInt()]; };
  P.writeDate = function (d) { return this.writeLong(BigInt(d.getTime())); };
  P.readDate = function () { return new Date(Number(this.readLong())); };
  P.writeBitSet = function (bits) {   // bits: array of set indices or a BigInt; written as a long array
    var n = 0n; if (typeof bits === 'bigint') n = bits; else bits.forEach(function (i) { n |= 1n << BigInt(i); });
    var longs = []; while (n > 0n) { longs.push(BigInt.asIntN(64, n)); n >>= 64n; } return this.writeLongArray(longs);
  };
  P.readBitSet = function () {
    var ls = this.readLongArray(), set = []; ls.forEach(function (l, k) { for (var b = 0; b < 64; b++) if ((BigInt.asUintN(64, l) >> BigInt(b)) & 1n) set.push(k * 64 + b); }); return set;
  };
  P.readCollection = function (f) { var n = this.readVarInt(), o = []; for (var i = 0; i < n; i++) o.push(f(this)); return o; };
  P.writeCollection = function (c, f) { this.writeVarInt(c.length); for (var i = 0; i < c.length; i++) f(this, c[i]); return this; };
  P.readList = P.readCollection;
  P.readIntList = function () { return this.readCollection(function (b) { return b.readVarInt(); }); };
  P.writeIntList = function (l) { return this.writeCollection(l, function (b, v) { b.writeVarInt(v); }); };
  P.readMap = function (fk, fv) { var n = this.readVarInt(), m = new Map(); for (var i = 0; i < n; i++) m.set(fk(this), fv(this)); return m; };
  P.writeMap = function (m, fk, fv) { this.writeVarInt(m.size); var self = this; m.forEach(function (v, k) { fk(self, k); fv(self, v); }); return this; };
  P.writeOptional = function (o, f) { if (o !== null && o !== undefined) { this.writeBoolean(true); f(this, o); } else this.writeBoolean(false); return this; };
  P.readOptional = function (f) { return this.readBoolean() ? f(this) : null; };
  P.forEachInCollection = function (f) { var n = this.readVarInt(); for (var i = 0; i < n; i++) f(this); };
  /** writeNbt(null) is one 0 byte; a compound is the NbtIo binary form (02n_nbt.js). */
  P.writeNbt = function (t) { if (!t) return this.writeByte(0); return this.writeBytes(NS.Nbt.write(t)); };
  P.readNbt = function (tracker) {
    if (this.readableBytes() < 1) this.need(1);
    if (this.a[this.r] === 0) { this.r++; return null; }
    var N = NS.Nbt, sub = this.a.subarray(this.r, this.w), In = N.read(sub, tracker || new N.NbtTagSizeTracker(PB.MAX_NBT));
    this.r += N.write(In).length; return In;
  };
  P.readUnlimitedNbt = function () { return this.readNbt(NS.Nbt.NbtTagSizeTracker.EMPTY); };

  // ── Enums ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
  var Side = Net.NetworkSide = { SERVERBOUND: 'SERVERBOUND', CLIENTBOUND: 'CLIENTBOUND', getOpposite: function (s) { return s === 'SERVERBOUND' ? 'CLIENTBOUND' : 'SERVERBOUND'; } };
  /** MessageType: CHAT(0) SYSTEM(1, interrupts narration) GAME_INFO(2, interrupts narration). */
  var MT = Net.MessageType = { CHAT: { id: 0, interruptsNarration: false }, SYSTEM: { id: 1, interruptsNarration: true }, GAME_INFO: { id: 2, interruptsNarration: true } };
  MT.byId = function (id) { return id === 1 ? MT.SYSTEM : id === 2 ? MT.GAME_INFO : MT.CHAT; };

  // ── Packet / NetworkState ──────────────────────────────────────────────────────────────────────────────────────────────
  /** Packet: a constructor with prototype.write(buf) and prototype.apply(listener); optional isWritingErrorSkippable(). */
  Net.Packet = { isWritingErrorSkippable: function (p) { return !!(p.isWritingErrorSkippable && p.isWritingErrorSkippable()); } };
  var STATES = [], BY_CLASS = new Map();
  function PacketHandler() { this.ids = new Map(); this.factories = []; }
  PacketHandler.prototype.register = function (cls, factory) {
    if (this.ids.has(cls)) throw new Error('Packet ' + cls.name + ' is already registered to ID ' + this.ids.get(cls));
    this.ids.set(cls, this.factories.length); this.factories.push(factory); return this;
  };
  PacketHandler.prototype.getId = function (cls) { return this.ids.has(cls) ? this.ids.get(cls) : null; };
  PacketHandler.prototype.createPacket = function (id, buf) { var f = this.factories[id]; return f ? f(buf) : null; };
  var NS_ = Net.NetworkState = function (name, id) {
    this.name = name; this.stateId = id; this.handlers = {};
    this.handlers[Side.SERVERBOUND] = new PacketHandler(); this.handlers[Side.CLIENTBOUND] = new PacketHandler();
  };
  NS_.HANDSHAKING = new NS_('HANDSHAKING', -1); NS_.PLAY = new NS_('PLAY', 0); NS_.STATUS = new NS_('STATUS', 1); NS_.LOGIN = new NS_('LOGIN', 2);
  [NS_.HANDSHAKING, NS_.PLAY, NS_.STATUS, NS_.LOGIN].forEach(function (s) { STATES[s.stateId + 1] = s; });
  /** setup(side).register(cls, factory): also records class -> state (NetworkState.HANDLER_STATE_MAP), refusing a second state. */
  NS_.prototype.register = function (side, cls, factory) {
    var prev = BY_CLASS.get(cls);
    if (prev && prev !== this) throw new Error('Packet ' + cls.name + ' is already assigned to protocol ' + prev.name + " - can't reassign to " + this.name);
    this.handlers[side].register(cls, factory); BY_CLASS.set(cls, this); return this;
  };
  NS_.prototype.getPacketId = function (side, p) { return this.handlers[side].getId(p.constructor); };
  NS_.prototype.getPacketHandler = function (side, id, buf) { return this.handlers[side].createPacket(id, buf); };
  NS_.prototype.getId = function () { return this.stateId; };
  NS_.byId = function (id) { return id >= -1 && id <= 2 ? STATES[id + 1] : null; };
  NS_.getPacketHandlerState = function (p) { return BY_CLASS.get(p.constructor); };
  NS_.prototype.toString = function () { return this.name; };

  // ── Pipeline handlers (bytes in -> bytes/objects out) ──────────────────────────────────────────────────────────────────
  /** SplitterHandler.decode(PacketByteBuf cumulation, out[]): one length-prefixed frame (VarInt up to 3 bytes) or nothing yet. */
  var Splitter = Net.SplitterHandler = function () {};
  Splitter.prototype.decode = function (buf, out) {
    var mark = buf.r, hdr = [];
    for (var i = 0; i < 3; i++) {
      if (!buf.isReadable()) { buf.r = mark; return; }
      hdr[i] = buf.readByte();
      if (hdr[i] >= 0) {
        var len = new PB(Uint8Array.from(hdr.map(function (b) { return b & 255; }))).readVarInt();
        if (buf.readableBytes() >= len) { out.push(new PB(buf.readBytes(len))); return; }
        buf.r = mark; return;
      }
    }
    var e = new Error('length wider than 21-bit'); e.name = 'CorruptedFrameException'; throw e;
  };
  /** SizePrepender.encode(PacketByteBuf in) -> PacketByteBuf with the VarInt length in front (at most 3 bytes). */
  var Sizer = Net.SizePrepender = function () {};
  Sizer.prototype.encode = function (inb) {
    var n = inb.readableBytes(), l = PB.getVarIntLength(n);
    if (l > 3) throw new Error('unable to fit ' + n + ' into 3');
    var o = new PB(); o.ensureWritable(l + n); o.writeVarInt(n); o.writeBytes(inb.getWrittenBytes ? inb.toBytes() : inb); return o;
  };
  function adler32(u8) { var a = 1, b = 0; for (var i = 0; i < u8.length; i++) { a = (a + u8[i]) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
  /** zlib stream of STORED blocks: 78 01, blocks <= 65535, adler32. */
  Net.zlibStore = function (u8) {
    var blocks = Math.max(1, Math.ceil(u8.length / 65535)), o = new Uint8Array(2 + u8.length + blocks * 5 + 4), p = 0;
    o[p++] = 0x78; o[p++] = 0x01;
    for (var i = 0; i < blocks; i++) {
      var s = i * 65535, n = Math.min(65535, u8.length - s);
      o[p++] = i === blocks - 1 ? 1 : 0; o[p++] = n & 255; o[p++] = n >> 8; o[p++] = ~n & 255; o[p++] = (~n >> 8) & 255;
      o.set(u8.subarray(s, s + n), p); p += n;
    }
    var ad = adler32(u8); o[p++] = ad >>> 24; o[p++] = (ad >>> 16) & 255; o[p++] = (ad >>> 8) & 255; o[p++] = ad & 255; return o;
  };
  Net.zlibInflate = function (u8, size) {
    if (((u8[0] << 8) | u8[1]) % 31 !== 0 || (u8[0] & 15) !== 8) throw new Error('incorrect header check');
    var out = NS.Z.inflateRaw(u8.subarray(2), size), ad = u8.length >= 6 ? ((u8[u8.length - 4] << 24) | (u8[u8.length - 3] << 16) | (u8[u8.length - 2] << 8) | u8[u8.length - 1]) >>> 0 : null;
    if (ad !== null && ad !== adler32(out)) throw new Error('incorrect data check');
    return out;
  };
  /** PacketDeflater: below the threshold -> VarInt 0 + raw; else VarInt(uncompressed length) + zlib. */
  var Deflater = Net.PacketDeflater = function (threshold) { this.compressionThreshold = threshold; };
  Deflater.prototype.encode = function (inb) {
    var n = inb.readableBytes(), o = new PB();
    if (n < this.compressionThreshold) { o.writeVarInt(0); o.writeBytes(inb.toBytes()); }
    else { var raw = inb.toBytes(); o.writeVarInt(raw.length); o.writeBytes(Net.zlibStore(raw)); }
    return o;
  };
  Deflater.prototype.getCompressionThreshold = function () { return this.compressionThreshold; };
  Deflater.prototype.setCompressionThreshold = function (t) { this.compressionThreshold = t; };
  var Inflater = Net.PacketInflater = function (threshold, rejectsBad) { this.compressionThreshold = threshold; this.rejectsBadPackets = rejectsBad; };
  Inflater.MAX_PACKET = 8388608;
  Inflater.prototype.decode = function (inb, out) {
    if (inb.readableBytes() === 0) return;
    var n = inb.readVarInt();
    if (n === 0) { out.push(new PB(inb.readBytes(inb.readableBytes()))); return; }
    if (this.rejectsBadPackets) {
      if (n < this.compressionThreshold) throw DecoderException('Badly compressed packet - size of ' + n + ' is below server threshold of ' + this.compressionThreshold);
      if (n > Inflater.MAX_PACKET) throw DecoderException('Badly compressed packet - size of ' + n + ' is larger than protocol maximum of ' + Inflater.MAX_PACKET);
    }
    out.push(new PB(Net.zlibInflate(inb.readBytes(inb.readableBytes()), n)));
  };
  Inflater.prototype.setCompressionThreshold = function (t, r) { this.compressionThreshold = t; this.rejectsBadPackets = r; };
  /** PacketEncoder: Packet -> VarInt id + body (limit 8388608). */
  var Encoder = Net.PacketEncoder = function (side) { this.side = side; };
  Encoder.prototype.encode = function (conn, p) {
    var st = conn.state;
    if (!st) throw new Error('ConnectionProtocol unknown: ' + p);
    var id = st.getPacketId(this.side, p);
    if (id === null) throw new Error("Can't serialize unregistered packet");
    var b = new PB(); b.writeVarInt(id);
    try {
      var s = b.writerIndex(); p.write(b); var n = b.writerIndex() - s;
      if (n > 8388608) throw new Error('Packet too big (is ' + n + ', should be less than 8388608): ' + p);
    } catch (e) { if (Net.Packet.isWritingErrorSkippable(p)) throw Net.PacketEncoderException(e); throw e; }
    return b;
  };
  /** DecoderHandler: VarInt id -> Packet via the state's factory; unread bytes left over are an error. */
  var Decoder = Net.DecoderHandler = function (side) { this.side = side; };
  Decoder.prototype.decode = function (conn, buf, out) {
    var n = buf.readableBytes(); if (n === 0) return;
    var id = buf.readVarInt(), p = conn.state.getPacketHandler(this.side, id, buf);
    if (p === null || p === undefined) throw new Error('Bad packet id ' + id);
    if (buf.readableBytes() > 0) throw new Error('Packet ' + conn.state.getId() + '/' + id + ' (' + (p.constructor.name || '?') + ') was larger than I expected, found ' + buf.readableBytes() + ' bytes extra whilst reading packet ' + id);
    out.push(p);
  };
  /** LegacyQueryHandler.channelRead(bytes, server{motd,version,players,max}) -> reply bytes (0xFF, UTF-16BE) or null = not a legacy ping. */
  Net.LegacyQueryHandler = function (server) { this.server = server; };
  Net.LegacyQueryHandler.prototype.channelRead = function (bytes) {
    var b = new PB(bytes), s = this.server;
    var reply = function (str) { var o = new PB(); o.writeByte(255); o.writeShort(str.length); for (var i = 0; i < str.length; i++) o.writeShort(str.charCodeAt(i)); return o.getWrittenBytes(); };
    var v = ['§1', 127, s.version, s.motd, s.players, s.max].join('\u0000');
    try {
      if (b.readUnsignedByte() !== 254) return null;
      var n = b.readableBytes();
      if (n === 0) return reply([s.motd, s.players, s.max].join('§'));
      if (n === 1) return b.readUnsignedByte() === 1 ? reply(v) : null;
      var ok = b.readUnsignedByte() === 1; ok = ok && b.readUnsignedByte() === 250;
      var nm = b.readShort() * 2, name = td.decode(new Uint8Array(0)); name = ''; var raw = b.readBytes(nm);
      for (var i = 0; i < raw.length; i += 2) name += String.fromCharCode((raw[i] << 8) | raw[i + 1]);
      ok = ok && name === 'MC|PingHost';
      var rest = b.readUnsignedShort(); ok = ok && b.readUnsignedByte() >= 73;
      var hl = b.readShort() * 2; b.readBytes(hl); ok = ok && 3 + hl + 4 === rest; ok = ok && b.readInt() <= 65535; ok = ok && b.readableBytes() === 0;
      return ok ? reply(v) : null;
    } catch (e) { return null; }
  };

  // ── OffThreadException / NetworkThreadUtils ────────────────────────────────────────────────────────────────────────────
  var OTE = Net.OffThreadException = new Error('off thread'); OTE.name = 'OffThreadException'; OTE.stack = '';
  /** forceMainThread(packet, listener, executor{isOnThread, executeSync}): off-thread -> queue the apply and throw INSTANCE. */
  Net.forceMainThread = function (packet, listener, exec) {
    if (!exec.isOnThread()) {
      exec.executeSync(function () {
        if (listener.getConnection().isOpen()) {
          try { packet.apply(listener); } catch (e) { if (listener.shouldCrashOnException()) throw e; }
        }
      });
      throw OTE;
    }
  };

  // ── ClientConnection / RateLimitedConnection (loopback channel) ────────────────────────────────────────────────────────
  var CC = Net.ClientConnection = function (side) {
    this.side = side; this.state = null; this.listener = null; this.queue = []; this.open = false; this.autoRead = true; this.disconnected = false;
    this.disconnectReason = null; this.sentCount = 0; this.recvCount = 0; this.avgSent = 0; this.avgRecv = 0; this.ticks = 0; this.wire = []; this.peer = null;
    this.encoder = new Encoder(side); this.decoder = new Decoder(Side.getOpposite(side)); this.splitter = new Splitter(); this.sizer = new Sizer();
    this.compress = null; this.decompress = null; this.cum = new PB(); this.cum.w = 0;
  };
  CC.CURRENT_PACKET_COUNTER_WEIGHT = 0.75;
  CC.prototype.channelActive = function () { this.open = true; this.setState(NS_.HANDSHAKING); };
  CC.prototype.setState = function (s) { this.state = s; this.autoRead = true; };
  CC.prototype.setPacketListener = function (l) { if (l === null || l === undefined) throw new Error('packetListener'); this.listener = l; };
  CC.prototype.getPacketListener = function () { return this.listener; };
  CC.prototype.isOpen = function () { return this.open; };
  CC.prototype.getSide = function () { return this.side; };
  CC.prototype.getOppositeSide = function () { return Side.getOpposite(this.side); };
  CC.prototype.isLocal = function () { return true; };
  CC.prototype.isEncrypted = function () { return false; };
  CC.prototype.getDisconnectReason = function () { return this.disconnectReason; };
  CC.prototype.disableAutoRead = function () { this.autoRead = false; };
  CC.prototype.getAveragePacketsReceived = function () { return this.avgRecv; };
  CC.prototype.getAveragePacketsSent = function () { return this.avgSent; };
  CC.prototype.send = function (p, cb) { if (this.open) { this.sendQueuedPackets(); this.sendImmediately(p, cb); } else this.queue.push({ packet: p, callback: cb }); };
  CC.prototype.sendImmediately = function (p, cb) {
    var ps = NS_.getPacketHandlerState(p), cur = this.state; this.sentCount++;
    if (cur !== ps && ps) { this.autoRead = false; this.setState(ps); }
    var b = this.encoder.encode(this, p);
    if (this.compress) b = this.compress.encode(b);
    var framed = this.sizer.encode(b).toBytes(); this.wire.push(framed);
    if (this.peer) this.peer.receive(framed);
    if (cb) cb(null);
  };
  CC.prototype.sendQueuedPackets = function () { if (!this.open) return; var q; while ((q = this.queue.shift())) this.sendImmediately(q.packet, q.callback); };
  /** channelRead path: bytes -> Splitter -> (Inflater) -> Decoder -> listener.apply; frames stop when auto-read is off. */
  CC.prototype.receive = function (bytes) {
    this.cum.writeBytes(bytes);
    for (;;) {
      if (!this.open || !this.autoRead) return;
      var frames = []; this.splitter.decode(this.cum, frames);
      if (!frames.length) { if (this.cum.r === this.cum.w) { this.cum = new PB(); } return; }
      var f = frames[0];
      if (this.decompress) { var o = []; this.decompress.decode(f, o); if (!o.length) continue; f = o[0]; }
      var out = []; this.decoder.decode(this, f, out);
      this.recvCount++;
      if (this.open && out.length) out[0].apply(this.listener);
    }
  };
  CC.prototype.setCompressionThreshold = function (t, reject) {
    if (t >= 0) {
      if (this.decompress) this.decompress.setCompressionThreshold(t, reject); else this.decompress = new Inflater(t, reject);
      if (this.compress) this.compress.setCompressionThreshold(t); else this.compress = new Deflater(t);
    } else { this.decompress = null; this.compress = null; }
  };
  CC.prototype.updateStats = function () {
    var w = CC.CURRENT_PACKET_COUNTER_WEIGHT;
    this.avgSent = Math.fround(w * this.sentCount + (1 - w) * this.avgSent); this.avgRecv = Math.fround(w * this.recvCount + (1 - w) * this.avgRecv);
    this.sentCount = 0; this.recvCount = 0;
  };
  CC.prototype.tick = function () {
    this.sendQueuedPackets();
    if (!this.open && !this.disconnected) this.handleDisconnection();
    if (this.ticks++ % 20 === 0) this.updateStats();
  };
  CC.prototype.disconnect = function (reason) { if (this.open) { this.open = false; this.disconnectReason = reason; } };
  CC.prototype.handleDisconnection = function () {
    if (this.open) return;
    if (this.disconnected) return;
    this.disconnected = true;
    if (this.listener) this.listener.onDisconnected(this.disconnectReason || 'multiplayer.disconnect.generic');
  };
  /** connectLocal(): a connected client/server pair whose bytes go straight into each other's pipeline. */
  CC.connectLocal = function (serverFactory) {
    var c = new CC(Side.CLIENTBOUND), s = serverFactory ? serverFactory() : new CC(Side.SERVERBOUND);
    // a connection's `side` is the side it receives: the encoder writes the opposite side's packets
    c.encoder = new Encoder(Side.SERVERBOUND); c.decoder = new Decoder(Side.CLIENTBOUND);
    s.encoder = new Encoder(Side.CLIENTBOUND); s.decoder = new Decoder(Side.SERVERBOUND);
    c.peer = s; s.peer = c; c.channelActive(); s.channelActive(); return { client: c, server: s };
  };
  /** RateLimitedConnection: a server-side connection that disconnects past `rateLimit` average packets/second. */
  Net.RateLimitedConnection = function (rateLimit) { CC.call(this, Side.SERVERBOUND); this.rateLimit = rateLimit; this.onRateExceeded = null; };
  Net.RateLimitedConnection.prototype = Object.create(CC.prototype);
  Net.RateLimitedConnection.prototype.constructor = Net.RateLimitedConnection;
  Net.RateLimitedConnection.prototype.updateStats = function () {
    CC.prototype.updateStats.call(this);
    var a = this.getAveragePacketsReceived();
    if (a > this.rateLimit) { this.exceeded = true; this.disconnect('disconnect.exceeded_packet_rate'); this.disableAutoRead(); }
  };

  /** One-shot framing used by /debug stop: text -> String packet over a compressed local pair -> text. */
  function TextPacket(s) { this.s = s; }
  TextPacket.prototype.write = function (b) { b.writeString(this.s, PB.MAX_TEXT); };
  TextPacket.prototype.apply = function (l) { l.got = this.s; };
  var inited = false;
  Net.frameText = function (text) {
    if (!inited) {
      NS_.PLAY.register(Side.SERVERBOUND, TextPacket, function (b) { return new TextPacket(b.readString(PB.MAX_TEXT)); });
      NS_.PLAY.register(Side.CLIENTBOUND, TextPacket, function (b) { return new TextPacket(b.readString(PB.MAX_TEXT)); }); inited = true;
    }
    var pr = CC.connectLocal(); pr.client.setState(NS_.PLAY); pr.server.setState(NS_.PLAY);
    pr.client.setCompressionThreshold(256, false); pr.server.setCompressionThreshold(256, false);
    var l = { got: null }; pr.server.setPacketListener(l); pr.client.setPacketListener({});
    pr.client.send(new TextPacket(text)); return l.got;
  };
})(typeof MCL !== 'undefined' ? MCL : (globalThis.MCL = globalThis.MCL || {}));
