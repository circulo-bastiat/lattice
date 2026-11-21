#!/usr/bin/env node
// netport11744check.mjs — #11744: net/minecraft/network (src/02o_net.js). PacketByteBuf, framing handlers, NetworkState,
// loopback ClientConnection, RateLimitedConnection, LegacyQueryHandler, and the real entry (/debug stop frames its report).
// Each behaviour is then cut by patching NS.Net and the scenario must fail.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
function load(patch) {
  const NS = {}; globalThis.MCL = NS;
  for (const f of ['00_ns.js', '01_util.js', '01b_inflate.js', '02i_text.js', '02n_nbt.js', '02o_net.js']) new Function('MCL', readFileSync(join(ROOT, 'src', f), 'utf8'))(NS);
  if (patch) patch(NS.Net);
  return NS;
}
function scenario(patch) { try { return scenario0(patch); } catch (e) { return ['threw: ' + e.message]; } }
function scenario0(patch) {
  const NS = load(patch), Net = NS.Net, PB = Net.PacketByteBuf, f = [];
  const chk = (c, m) => { if (!c) f.push(m); };
  const t = (fn) => { try { return fn(); } catch (e) { return 'ERR ' + e.message; } };
  const b = new PB();
  b.writeVarInt(300).writeVarInt(-1).writeVarLong(-2n).writeString('héllo').writeBlockPos({ x: -5, y: 70, z: 1234 }).writeUuid('123e4567-e89b-12d3-a456-426614174000');
  chk(b.getWrittenBytes().slice(0, 2).join() === '172,2', 'VarInt 300 = AC 02: ' + b.getWrittenBytes().slice(0, 2));
  chk(t(() => b.readVarInt()) === 300 && b.readVarInt() === -1 && b.readVarLong() === -2n, 'varint/varlong round trip');
  chk(b.readString() === 'héllo', 'string round trip');
  const bp = b.readBlockPos(); chk(bp.x === -5 && bp.y === 70 && bp.z === 1234, 'BlockPos long pack: ' + JSON.stringify(bp));
  chk(b.readUuid() === '123e4567-e89b-12d3-a456-426614174000', 'uuid');
  chk(PB.getVarIntLength(127) === 1 && PB.getVarIntLength(128) === 2 && PB.getVarIntLength(-1) === 5, 'getVarIntLength');
  chk(/too big/.test(t(() => new PB(Uint8Array.of(255, 255, 255, 255, 255, 1)).readVarInt())), 'VarInt too big');
  const sb = new PB(); sb.writeVarInt(1000);
  chk(/longer than maximum/.test(t(() => sb.readString(10))), 'string length limit');
  chk(/String too big/.test(t(() => new PB().writeString('abcdef', 3))), 'writeString limit');
  const ab = new PB(); ab.writeIntArray([1, -1, 300]); ab.writeLongArray([5n, -6n]); ab.writeBitSet([0, 3, 70]); ab.writeByteArray(Uint8Array.of(9, 8));
  chk(Array.from(t(() => ab.readIntArray())).join() === '1,-1,300' && ab.readLongArray().join() === '5,-6', 'int/long arrays');
  chk(ab.readBitSet().join() === '0,3,70', 'bitset'); chk(ab.readByteArray().join() === '9,8', 'byte array');
  const nb = new PB(); nb.writeNbt(null); nb.writeNbt(NS.Nbt.parse('{a:1b,s:"x"}'));
  chk(nb.readNbt() === null && NS.Nbt.toSnbt(nb.readNbt()) === '{a:1b,s:"x"}', 'nbt through buffer');
  // framing
  const big = new PB(); for (let i = 0; i < 1000; i++) big.writeByte(i % 7);
  const fr = new Net.SizePrepender().encode(big).toBytes();
  chk(fr.length === 1002 && fr[0] === 0xE8 && fr[1] === 7, 'SizePrepender: VarInt length first');
  const outs = [], cum = new PB(); const sp = new Net.SplitterHandler();
  cum.writeBytes(fr.subarray(0, 500)); sp.decode(cum, outs); chk(outs.length === 0 && cum.readerIndex() === 0, 'Splitter waits on a partial frame');
  cum.writeBytes(fr.subarray(500)); sp.decode(cum, outs); chk(outs.length === 1 && outs[0].readableBytes() === 1000, 'Splitter emits a whole frame');
  chk(/21-bit/.test(t(() => sp.decode(new PB(Uint8Array.of(128, 128, 128, 1)), []))), 'Splitter: length wider than 21-bit');
  const dz = new Net.PacketDeflater(100), iz = new Net.PacketInflater(100, true);
  const z = dz.encode(new PB(big.getWrittenBytes())), zo = []; iz.decode(z, zo);
  chk(zo.length === 1 && zo[0].toBytes().join() === big.getWrittenBytes().join(), 'deflate/inflate round trip');
  const sm = new PB(Uint8Array.of(1, 2, 3)), sz = dz.encode(sm); chk(sz.getWrittenBytes()[0] === 0 && sz.writerIndex() === 4, 'below threshold: VarInt 0 + raw');
  const bad = new PB(); bad.writeVarInt(5); bad.writeBytes(Uint8Array.of(1));
  chk(/below server threshold/.test(t(() => iz.decode(bad, []))), 'inflater refuses undersize claim');
  // NetworkState + connection
  function Ping(n) { this.n = n; } Ping.prototype.write = function (x) { x.writeVarInt(this.n); }; Ping.prototype.apply = function (l) { l.pings.push(this.n); };
  function Pong(n) { this.n = n; } Pong.prototype.write = function (x) { x.writeVarInt(this.n); }; Pong.prototype.apply = function (l) { l.pongs.push(this.n); };
  Net.NetworkState.STATUS.register(Net.NetworkSide.SERVERBOUND, Ping, (x) => new Ping(x.readVarInt()));
  Net.NetworkState.STATUS.register(Net.NetworkSide.CLIENTBOUND, Pong, (x) => new Pong(x.readVarInt()));
  chk(/already registered/.test(t(() => Net.NetworkState.STATUS.register(Net.NetworkSide.SERVERBOUND, Ping, () => null))), 'duplicate registration refused');
  chk(/already assigned/.test(t(() => Net.NetworkState.LOGIN.register(Net.NetworkSide.SERVERBOUND, Ping, () => null))), 'packet in two states refused');
  chk(Net.NetworkState.byId(1) === Net.NetworkState.STATUS && Net.NetworkState.byId(-1) === Net.NetworkState.HANDSHAKING && Net.NetworkState.byId(3) === null, 'NetworkState.byId');
  const pr = Net.ClientConnection.connectLocal(); const L = { pings: [], pongs: [] }, CL = { pings: [], pongs: [] };
  pr.server.setPacketListener(L); pr.client.setPacketListener(CL); pr.client.setState(Net.NetworkState.STATUS); pr.server.setState(Net.NetworkState.STATUS);
  pr.client.send(new Ping(7)); pr.server.send(new Pong(9));
  chk(L.pings.join() === '7' && CL.pongs.join() === '9', 'packets cross the loopback: ' + L.pings + '/' + CL.pongs);
  pr.client.setCompressionThreshold(0, false); pr.server.setCompressionThreshold(0, false); pr.client.send(new Ping(300));
  chk(L.pings.join() === '7,300', 'packets cross with compression on');
  pr.server.disableAutoRead(); pr.client.send(new Ping(1)); chk(L.pings.length === 2, 'auto-read off holds packets back');
  const early = new Net.ClientConnection(Net.NetworkSide.SERVERBOUND); early.send(new Ping(1)); chk(early.queue.length === 1, 'send before open queues');
  const rl = new Net.RateLimitedConnection(5); rl.channelActive(); rl.setState(Net.NetworkState.STATUS); rl.recvCount = 100; rl.tick();
  chk(rl.isOpen() === false && rl.getDisconnectReason() === 'disconnect.exceeded_packet_rate', 'RateLimitedConnection disconnects a flooder');
  const q = new Net.LegacyQueryHandler({ motd: 'hi', version: '1.18.2', players: 1, max: 20 });
  const rep = t(() => q.channelRead(Uint8Array.of(254)));
  chk(rep && rep[0] === 255 && rep[1] === 0 && rep[2] === 7, 'legacy ping <1.3 reply: ' + rep);
  chk(q.channelRead(Uint8Array.of(1, 2)) === null, 'non-legacy bytes pass through');
  const ex = { isOnThread: () => false, executeSync: (fn) => { ex.q = fn; } }; let thrown = null;
  try { Net.forceMainThread({ apply() {} }, { getConnection: () => ({ isOpen: () => true }) }, ex); } catch (e) { thrown = e; }
  chk(thrown === Net.OffThreadException && typeof ex.q === 'function', 'forceMainThread throws OffThreadException and queues');
  chk(Net.MessageType.byId(2).interruptsNarration && !Net.MessageType.byId(0).interruptsNarration && Net.NetworkSide.getOpposite('SERVERBOUND') === 'CLIENTBOUND', 'MessageType/NetworkSide');
  chk(Net.frameText('x'.repeat(3000) + 'é') === 'x'.repeat(3000) + 'é', 'frameText (the /debug stop entry) round trips');
  return f;
}
const base = scenario();
let bad = base.length;
if (base.length) { console.log('FAIL baseline:'); base.forEach((m) => console.log('  ' + m)); }
const cuts = [
  ['varint', (N) => { const o = N.PacketByteBuf.prototype.writeVarInt; N.PacketByteBuf.prototype.writeVarInt = function (v) { return o.call(this, v & 0x3fff); }; }],
  ['splitter', (N) => { N.SplitterHandler.prototype.decode = function () {}; }],
  ['sizer', (N) => { N.SizePrepender.prototype.encode = function (b) { return b; }; }],
  ['inflater', (N) => { N.PacketInflater.prototype.decode = function (b, o) { o.push(b); }; }],
  ['deflater', (N) => { N.PacketDeflater.prototype.encode = function (b) { return b; }; }],
  ['state', (N) => { N.NetworkState.prototype.register = function () { return this; }; }],
  ['ratelimit', (N) => { N.RateLimitedConnection.prototype.updateStats = function () {}; }],
  ['legacy', (N) => { N.LegacyQueryHandler.prototype.channelRead = function () { return null; }; }],
  ['offthread', (N) => { N.forceMainThread = function () {}; }],
  ['blockpos', (N) => { N.posToLong = function () { return 0n; }; }],
  ['frame', (N) => { N.frameText = function () { return null; }; }],
  ['autoread', (N) => { N.ClientConnection.prototype.disableAutoRead = function () {}; }],
];
let caught = 0;
for (const [n, p] of cuts) { const r = scenario(p); if (r.length) caught++; else { console.log('NOT CAUGHT: ' + n); bad++; } }
console.log(bad ? 'netport11744check FAIL' : `netport11744check ok — ${caught} breaks caught`);
process.exit(bad ? 1 : 0);
