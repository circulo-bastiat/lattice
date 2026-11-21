// NS.Profiling: net/minecraft/util/profiling/jfr ports (#11765), from .decomp. Finishable FlightProfiler(NoopProfiler) InstanceType,
//  the event records (ChunkGeneration NetworkSummary(+Recorder) PacketEvent/Received/Sent ServerTickTime WorldLoadFinished)
//  and the sample records/statistics. Durations are nanosecond numbers, instants epoch-ms numbers.
// JFR itself (jdk.jfr) has no browser meaning: FlightProfiler.INSTANCE is the NoopProfiler, exactly what vanilla uses without jdk.jfr.
(function (NS) {
  'use strict';
  var P = NS.Profiling = {};
  P.InstanceType = { CLIENT: { name: 'client', getName: function () { return 'client'; } }, SERVER: { name: 'server', getName: function () { return 'server'; } } };
  P.InstanceType.get = function (server) { return server.isDedicated() ? P.InstanceType.SERVER : P.InstanceType.CLIENT; };
  var NOOP = function () {}; // Finishable: a function whose call is finish()
  P.Finishable = { NOOP: NOOP, finish: function (f) { f(); } };
  P.NoopProfiler = {
    start: function () { return false; },
    stop: function () { throw new Error('Attempted to stop Flight Recorder, but it\'s not supported on this JVM'); },
    isProfiling: function () { return false; }, isAvailable: function () { return false; },
    onPacketReceived: function () {}, onPacketSent: function () {}, onTick: function () {},
    startWorldLoadProfiling: function () { return NOOP; }, startChunkGenerationProfiling: function () { return NOOP; }
  };
  P.FlightProfiler = { INSTANCE: P.NoopProfiler };
  var E = P.Event = {};
  E.ChunkGenerationEvent = function (chunkX, chunkZ, level, status) {
    return { chunkPosX: chunkX, chunkPosZ: chunkZ, worldPosX: chunkX << 4, worldPosZ: chunkZ << 4, status: status, level: level };
  };
  E.ChunkGenerationEvent.EVENT_NAME = 'minecraft.ChunkGeneration';
  E.PacketEvent = function (protocolId, packetId, addr, bytes) { return { protocolId: protocolId, packetId: packetId, remoteAddress: String(addr), bytes: bytes }; };
  E.PacketReceivedEvent = function (a, b, c, d) { var e = E.PacketEvent(a, b, c, d); e.eventName = 'minecraft.PacketReceived'; return e; };
  E.PacketReceivedEvent.NAME = 'minecraft.PacketReceived';
  E.PacketSentEvent = function (a, b, c, d) { var e = E.PacketEvent(a, b, c, d); e.eventName = 'minecraft.PacketSent'; return e; };
  E.PacketSentEvent.NAME = 'minecraft.PacketSent';
  E.ServerTickTimeEvent = function (ms) { return { averageTickDuration: Math.trunc(1000000 * ms) }; };
  E.ServerTickTimeEvent.EVENT_NAME = 'minecraft.ServerTickTime';
  E.WorldLoadFinishedEvent = function () { return {}; };
  E.WorldLoadFinishedEvent.EVENT_NAME = 'minecraft.LoadWorld';
  E.NetworkSummaryEvent = function (addr) { return { remoteAddress: addr, sentBytes: 0, sentPackets: 0, receivedBytes: 0, receivedPackets: 0 }; };
  E.NetworkSummaryEvent.EVENT_NAME = 'minecraft.NetworkSummary';
  E.NetworkSummaryEvent.Recorder = function (addr) {
    var sb = 0, sp = 0, rb = 0, rp = 0, ev = E.NetworkSummaryEvent(addr), committed = null;
    return {
      addSentPacket: function (n) { sp++; sb += n; }, addReceivedPacket: function (n) { rp++; rb += n; },
      commit: function () { ev.sentBytes = sb; ev.sentPackets = sp; ev.receivedBytes = rb; ev.receivedPackets = rp; committed = ev; return ev; }
    };
  };
  var S = P.Sample = {};
  // Guava Quantiles.scale(100).indexes(50,75,90,99) (net.minecraft.util.math.Quantiles.create): linear interpolation, keys descending.
  P.quantiles = function (vals) {
    var out = new Map(); if (!vals.length) return out;
    var a = vals.slice().sort(function (x, y) { return x - y; }), n = a.length;
    [99, 90, 75, 50].forEach(function (q) {
      var num = q * (n - 1), lo = Math.floor(num / 100), rem = num % 100;
      out.set(q, rem === 0 ? a[lo] : a[lo] + (a[lo + 1] - a[lo]) * rem / 100);
    });
    return out;
  };
  S.ChunkGenerationSample = function (duration, chunkPos, centerPos, chunkStatus, worldKey) {
    return { duration: duration, chunkPos: chunkPos, centerPos: centerPos, chunkStatus: chunkStatus, worldKey: worldKey };
  };
  // fromEvent keeps the decomp's chunkPosX read for both chunk coordinates (a vanilla bug).
  S.ChunkGenerationSample.fromEvent = function (ev) {
    return S.ChunkGenerationSample(ev.duration, { x: ev.chunkPosX, z: ev.chunkPosX }, { x: ev.worldPosX, z: ev.worldPosZ }, ev.status, ev.level);
  };
  S.CpuLoadSample = function (jvm, userJvm, system) { return { jvm: jvm, userJvm: userJvm, system: system }; };
  S.CpuLoadSample.fromEvent = function (ev) { return S.CpuLoadSample(ev.jvmSystem, ev.jvmUser, ev.machineTotal); };
  S.FileIoSample = function (duration, path, bytes) { return { duration: duration, path: path, bytes: bytes }; };
  S.FileIoSample.toStatistics = function (durationSec, samples) {
    var total = 0, dur = 0, by = new Map();
    samples.forEach(function (s) { total += s.bytes; dur += s.duration; if (s.path != null) by.set(s.path, (by.get(s.path) || 0) + s.bytes); });
    var top = Array.from(by.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 10);
    return { totalBytes: total, bytesPerSecond: total / durationSec, count: samples.length, countPerSecond: samples.length / durationSec, totalDuration: dur, topContributors: top };
  };
  var BEFORE = 'BEFORE_GC', AFTER = 'AFTER_GC';
  S.GcHeapSummarySample = function (time, heapUsed, summaryType) { return { time: time, heapUsed: heapUsed, summaryType: summaryType }; };
  S.GcHeapSummarySample.SummaryType = { BEFORE_GC: BEFORE, AFTER_GC: AFTER };
  S.GcHeapSummarySample.fromEvent = function (ev) {
    return S.GcHeapSummarySample(ev.startTime, ev.heapUsed, String(ev.when).toLowerCase() === 'before gc' ? BEFORE : AFTER);
  };
  S.GcHeapSummarySample.toStatistics = function (durationSec, samples, gcDuration, count) {
    var before = samples.filter(function (s) { return s.summaryType === BEFORE; }), after = samples.filter(function (s) { return s.summaryType === AFTER; }), sum = 0;
    for (var i = 1; i < before.length; i++) sum += before[i].heapUsed - after[i - 1].heapUsed;
    var secs = Math.trunc((samples[samples.length - 1].time - samples[1].time) / 1000);
    return { duration: durationSec, gcDuration: gcDuration, count: count, allocatedBytesPerSecond: sum / secs,
      getGcDurationRatio: function () { return Math.fround(gcDuration) / Math.fround(durationSec); } };
  };
  S.LongRunningSample = { duration: function (s) { return s.duration; } };
  S.LongRunningSampleStatistics = {
    fromSamples: function (samples) {
      if (!samples.length) throw new Error('No values');
      var s = samples.slice().sort(function (a, b) { return a.duration - b.duration; }), n = s.length, tot = 0;
      s.forEach(function (x) { tot += x.duration; });
      return { fastestSample: s[0], slowestSample: s[n - 1], secondSlowestSample: n > 1 ? s[n - 2] : null, count: n,
        quantiles: P.quantiles(s.map(function (x) { return x.duration; })), totalDuration: tot };
    }
  };
  S.ServerTickTimeSample = function (time, averageTickMs) { return { time: time, averageTickMs: averageTickMs }; };
  S.ServerTickTimeSample.fromEvent = function (ev) { return S.ServerTickTimeSample(ev.startTime, ev.averageTickDuration); };
  S.ThreadAllocationStatisticsSample = function (time, threadName, allocated) { return { time: time, threadName: threadName, allocated: allocated }; };
  S.ThreadAllocationStatisticsSample.fromEvent = function (ev) {
    return S.ThreadAllocationStatisticsSample(ev.startTime, ev.thread == null ? 'unknown' : (ev.thread || 'unknown'), ev.allocated);
  };
  S.ThreadAllocationStatisticsSample.toAllocationMap = function (samples) {
    var g = new Map(), out = new Map();
    samples.forEach(function (s) { if (!g.has(s.threadName)) g.set(s.threadName, []); g.get(s.threadName).push(s); });
    Array.from(g.keys()).sort().forEach(function (k) {
      var l = g.get(k); if (l.length < 2) return;
      out.set(k, (l[l.length - 1].allocated - l[0].allocated) / Math.trunc((l[l.length - 1].time - l[0].time) / 1000));
    });
    return { allocations: out };
  };
  S.TimedSample = { getTime: function (s) { return s.time; } };
  // NetworkIoStatistics: top ten (bytes desc, then count desc) of [packetKey, {count, bytes}] pairs.
  S.NetworkIoStatistics = function (durationSec, pairs) {
    var comb = { count: 0, bytes: 0 };
    pairs.forEach(function (p) { comb.count += p[1].count; comb.bytes += p[1].bytes; });
    var top = pairs.slice().sort(function (a, b) { return (b[1].bytes - a[1].bytes) || (b[1].count - a[1].count); }).slice(0, 10);
    return { getCountPerSecond: function () { return comb.count / durationSec; }, getBytesPerSecond: function () { return comb.bytes / durationSec; },
      getTotalCount: function () { return comb.count; }, getTotalSize: function () { return comb.bytes; }, getTopContributors: function () { return top; } };
  };
  S.NetworkIoStatistics.Packet = function (side, protocolId, packetId) { return { side: side, protocolId: protocolId, packetId: packetId }; };
  S.NetworkIoStatistics.Packet.fromEvent = function (ev) {
    return S.NetworkIoStatistics.Packet(ev.eventName === 'minecraft.PacketSent' ? 'CLIENTBOUND' : 'SERVERBOUND', ev.protocolId, ev.packetId);
  };
})(MCL);
