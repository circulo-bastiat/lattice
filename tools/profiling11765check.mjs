#!/usr/bin/env node
// profiling11765check.mjs — #11765: src/02q_profiling.js (net/minecraft/util/profiling/jfr ports).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(ROOT + 'src/02q_profiling.js', 'utf8');
function load(code) { const M = {}; new Function('MCL', code)(M); return M.Profiling; }
function scenario(P) {
  const f = [], chk = (c, m) => { if (!c) f.push(m); };
  const N = P.FlightProfiler.INSTANCE;
  chk(N.start() === false && !N.isProfiling() && !N.isAvailable(), 'noop flags');
  let th = false; try { N.stop(); } catch (x) { th = true; } chk(th, 'noop stop throws');
  let fin = 0; const w = N.startWorldLoadProfiling(); w(); chk(typeof N.startChunkGenerationProfiling() === 'function', 'noop finishable'); chk(fin === 0, 'x');
  chk(P.InstanceType.get({ isDedicated: () => true }).getName() === 'server' && P.InstanceType.get({ isDedicated: () => false }).getName() === 'client', 'instance type');
  const E = P.Event, c = E.ChunkGenerationEvent(-3, 5, 'minecraft:overworld', 'full');
  chk(c.worldPosX === -48 && c.worldPosZ === 80 && c.chunkPosX === -3 && E.ChunkGenerationEvent.EVENT_NAME === 'minecraft.ChunkGeneration', 'chunk event');
  const pe = E.PacketSentEvent(1, 2, '/1.2.3.4:5', 99);
  chk(pe.remoteAddress === '/1.2.3.4:5' && pe.bytes === 99 && E.PacketSentEvent.NAME === 'minecraft.PacketSent' && E.PacketReceivedEvent.NAME === 'minecraft.PacketReceived', 'packet event');
  chk(E.ServerTickTimeEvent(2.5).averageTickDuration === 2500000 && E.ServerTickTimeEvent.EVENT_NAME === 'minecraft.ServerTickTime' && E.WorldLoadFinishedEvent.EVENT_NAME === 'minecraft.LoadWorld', 'tick/world events');
  const r = E.NetworkSummaryEvent.Recorder('a'); r.addSentPacket(10); r.addSentPacket(5); r.addReceivedPacket(7); const ev = r.commit();
  chk(ev.sentBytes === 15 && ev.sentPackets === 2 && ev.receivedBytes === 7 && ev.receivedPackets === 1, 'recorder');
  const S = P.Sample;
  const q = P.quantiles([1, 2, 3, 4, 5]); chk(Array.from(q.keys()).join() === '99,90,75,50' && q.get(50) === 3 && q.get(75) === 4 && Math.abs(q.get(90) - 4.6) < 1e-9 && Math.abs(q.get(99) - 4.96) < 1e-9, 'quantiles ' + JSON.stringify([...q]));
  chk(P.quantiles([]).size === 0, 'quantiles empty');
  const st = S.LongRunningSampleStatistics.fromSamples([{ duration: 5 }, { duration: 1 }, { duration: 3 }]);
  chk(st.fastestSample.duration === 1 && st.slowestSample.duration === 5 && st.secondSlowestSample.duration === 3 && st.count === 3 && st.totalDuration === 9, 'lrs stats');
  chk(S.LongRunningSampleStatistics.fromSamples([{ duration: 2 }]).secondSlowestSample === null, 'lrs single');
  th = false; try { S.LongRunningSampleStatistics.fromSamples([]); } catch (x) { th = true; } chk(th, 'lrs empty');
  const cg = S.ChunkGenerationSample.fromEvent({ duration: 7, chunkPosX: 4, chunkPosZ: 9, worldPosX: 64, worldPosZ: 144, status: 'full', level: 'L' });
  chk(cg.chunkPos.x === 4 && cg.chunkPos.z === 4 && cg.centerPos.z === 144, 'chunk sample keeps vanilla X/X');
  const cpu = S.CpuLoadSample.fromEvent({ jvmSystem: 0.1, jvmUser: 0.2, machineTotal: 0.3 }); chk(cpu.jvm === 0.1 && cpu.userJvm === 0.2 && cpu.system === 0.3, 'cpu');
  const fs = S.FileIoSample.toStatistics(2, [S.FileIoSample(1, 'a', 10), S.FileIoSample(2, 'b', 30), S.FileIoSample(3, 'a', 25), S.FileIoSample(4, null, 5)]);
  chk(fs.totalBytes === 70 && fs.bytesPerSecond === 35 && fs.count === 4 && fs.countPerSecond === 2 && fs.totalDuration === 10 && fs.topContributors.join('|') === 'a,35|b,30', 'file io');
  const fm = []; for (let i = 0; i < 12; i++) fm.push(S.FileIoSample(1, 'p' + i, i)); chk(S.FileIoSample.toStatistics(1, fm).topContributors.length === 10, 'file io top ten');
  const G = S.GcHeapSummarySample, T = G.SummaryType;
  chk(G.fromEvent({ startTime: 0, heapUsed: 1, when: 'Before GC' }).summaryType === T.BEFORE_GC && G.fromEvent({ startTime: 0, heapUsed: 1, when: 'After GC' }).summaryType === T.AFTER_GC, 'gc type');
  const gs = [G(0, 0, T.BEFORE_GC), G(1000, 100, T.BEFORE_GC), G(2000, 50, T.AFTER_GC), G(3000, 300, T.BEFORE_GC), G(4000, 80, T.AFTER_GC)];
  const gst = G.toStatistics(10, gs, 2, 5);
  // before=[0,100,300] after=[50,80]; sum=(100-50)+(300-80)=270; secs=(4000-1000)/1000=3
  chk(gst.allocatedBytesPerSecond === 90 && gst.getGcDurationRatio() === 0.2, 'gc stats ' + gst.allocatedBytesPerSecond);
  const ta = S.ThreadAllocationStatisticsSample, am = ta.toAllocationMap([ta(0, 'm', 100), ta(5000, 'm', 600), ta(0, 'solo', 1), ta(1000, 'b', 0), ta(3000, 'b', 10)]).allocations;
  chk(Array.from(am.keys()).join() === 'b,m' && am.get('m') === 100 && am.get('b') === 5, 'alloc map');
  chk(ta.fromEvent({ startTime: 0, thread: null, allocated: 1 }).threadName === 'unknown', 'thread unknown');
  chk(S.ServerTickTimeSample.fromEvent({ startTime: 3, averageTickDuration: 9 }).averageTickMs === 9 && S.TimedSample.getTime({ time: 4 }) === 4, 'tick sample');
  const io = S.NetworkIoStatistics(2, [['p1', { count: 1, bytes: 10 }], ['p2', { count: 5, bytes: 10 }], ['p3', { count: 1, bytes: 50 }]]);
  chk(io.getTotalCount() === 7 && io.getTotalSize() === 70 && io.getBytesPerSecond() === 35 && io.getCountPerSecond() === 3.5 && io.getTopContributors().map((p) => p[0]).join() === 'p3,p2,p1', 'network io');
  const many = []; for (let i = 0; i < 15; i++) many.push(['k' + i, { count: 1, bytes: i }]);
  chk(S.NetworkIoStatistics(1, many).getTopContributors().length === 10, 'top ten');
  chk(S.NetworkIoStatistics.Packet.fromEvent({ eventName: 'minecraft.PacketSent', protocolId: 1, packetId: 2 }).side === 'CLIENTBOUND', 'packet side');
  return f;
}
const base = scenario(load(src));
if (base.length) { console.log('FAIL baseline: ' + base.join('; ')); process.exit(1); }
const cuts = [
  (s) => s.replace("startWorldLoadProfiling: function () { return NOOP; }", "startWorldLoadProfiling: function () { return null; }"),
  (s) => s.replace("isAvailable: function () { return false; }", "isAvailable: function () { return true; }"),
  (s) => s.replace("chunkX << 4", "chunkX << 3"),
  (s) => s.replace("Math.trunc(1000000 * ms)", "Math.trunc(100000 * ms)"),
  (s) => s.replace("sp++; sb += n;", "sp++;"),
  (s) => s.replace("[99, 90, 75, 50]", "[50, 75, 90, 99]"),
  (s) => s.replace("* rem / 100", "* rem / 50"),
  (s) => s.replace("n > 1 ? s[n - 2] : null", "s[n - 2]"),
  (s) => s.replace("chunkPosX, z: ev.chunkPosX", "chunkPosX, z: ev.chunkPosZ"),
  (s) => s.replace(".slice(0, 10);\n    return { totalBytes", ".slice(0, 9);\n    return { totalBytes"),
  (s) => s.replace("'before gc'", "'after gc'"),
  (s) => s.replace("before[i].heapUsed - after[i - 1].heapUsed", "before[i].heapUsed - after[i].heapUsed"),
  (s) => s.replace("if (l.length < 2) return;", ""),
  (s) => s.replace("(b[1].bytes - a[1].bytes) || (b[1].count - a[1].count)", "(b[1].bytes - a[1].bytes)"),
  (s) => s.replace("ev.thread == null ? 'unknown'", "ev.thread == null ? 'x'"),
  (s) => s.replace("server.isDedicated() ? P.InstanceType.SERVER : P.InstanceType.CLIENT", "server.isDedicated() ? P.InstanceType.CLIENT : P.InstanceType.SERVER"),
  (s) => s.replace("'minecraft.PacketSent' ? 'CLIENTBOUND'", "'minecraft.PacketSent' ? 'SERVERBOUND'"),
  (s) => s.replace("totalDuration: tot", "totalDuration: 0"),
];
let caught = 0;
cuts.forEach((cut, i) => {
  const mut = cut(src);
  if (mut === src) { console.log('FAIL cut ' + i + ' did not change the source'); process.exit(1); }
  let bad; try { bad = scenario(load(mut)).length > 0; } catch (e) { bad = true; }
  if (bad) caught++; else { console.log('FAIL cut ' + i + ' not caught'); process.exit(1); }
});
console.log("PASS profiling11765check — " + caught + " breaks caught");
