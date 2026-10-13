// rcon.mjs — minimal Source RCON client (node:net), just enough for the referee: auth,
// exec a command, read a (possibly multi-packet) response. No deps, no framework.
//
// Protocol: https://developer.valvesoftware.com/wiki/Source_RCON_Protocol
//   int32 size (LE, excludes itself) | int32 id (LE) | int32 type (LE) | body\0 | \0
import net from 'node:net';

const T_AUTH = 3, T_AUTH_RESPONSE = 2, T_EXEC = 2, T_RESPONSE = 0;

function encode(id, type, body) {
  const b = Buffer.from(body + '\0\0', 'ascii');
  const size = 4 + 4 + b.length;
  const out = Buffer.alloc(4 + size);
  out.writeInt32LE(size, 0);
  out.writeInt32LE(id, 4);
  out.writeInt32LE(type, 8);
  b.copy(out, 12);
  return out;
}

export function connectRcon({ host = '127.0.0.1', port, password, timeoutMs = 15000 }) {
  let sock;
  return new Promise((resolve, reject) => {
    sock = net.createConnection({ host, port });
    let buf = Buffer.alloc(0);
    let nextId = 1;
    const pending = new Map(); // id -> {resolve, chunks}
    const timer = setTimeout(() => { sock.destroy(); reject(new Error('rcon: connect/auth timed out')); }, timeoutMs);

    function drain() {
      while (buf.length >= 4) {
        const size = buf.readInt32LE(0);
        if (buf.length < 4 + size) return;
        const id = buf.readInt32LE(4);
        const type = buf.readInt32LE(8);
        const body = buf.slice(12, 4 + size - 2).toString('utf8');
        buf = buf.slice(4 + size);
        if (type === T_AUTH_RESPONSE) {
          const p = pending.get('auth');
          if (p) { pending.delete('auth'); id === -1 ? p.reject(new Error('rcon: bad password')) : p.resolve(); }
          continue;
        }
        const p = pending.get(id);
        if (p) {
          p.chunks.push(body);
          // A real response packet is followed almost immediately by any further fragments;
          // resolve on next tick if nothing else has arrived (handles multi-packet bodies).
          clearTimeout(p.settle);
          p.settle = setTimeout(() => { pending.delete(id); p.resolve(p.chunks.join('')); }, 40);
        }
      }
    }

    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); drain(); });
    sock.on('error', (e) => reject(e));
    sock.once('connect', () => {
      clearTimeout(timer);
      pending.set('auth', { resolve, reject });
      sock.write(encode(0, T_AUTH, password));
    });

    sock._mclite = {
      // 60 s: the shared runner hosts reach load 240 on 6 cores and a server tick can stall past the old 10 s (#6832); MCLITE_RCON_CMD_MS overrides
      command(cmd, cmdTimeoutMs = +process.env.MCLITE_RCON_CMD_MS || 60000) {
        return new Promise((res, rej) => {
          const id = nextId++;
          const to = setTimeout(() => { pending.delete(id); rej(new Error('rcon: command timed out: ' + cmd)); }, cmdTimeoutMs);
          pending.set(id, { resolve: (v) => { clearTimeout(to); res(v); }, chunks: [], settle: null });
          sock.write(encode(id, T_EXEC, cmd));
        });
      },
      close() { try { sock.end(); } catch { /* ignore */ } },
    };
  }).then(() => sock._mclite);
}
