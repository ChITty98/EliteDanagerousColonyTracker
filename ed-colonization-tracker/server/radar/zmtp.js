// server/radar/zmtp.js
//
// Minimal ZMTP 3.0 SUB client over a plain TCP socket — just enough protocol to drink the EDDN
// firehose, hand-rolled on purpose:
//   • the native `zeromq` package is a .node addon and cannot be embedded in the SEA exe;
//   • `jszmq` (pure JS) turned out to be WebSocket-transport only — no tcp:// (verified by test).
// Spike-proven against tcp://eddn.edcd.io:9500 (476 messages in 30s): greeting → NULL-mechanism
// READY handshake → 0x01 subscribe-all frame → framed single-part messages.
//
// Production hardening over the spike: exponential-backoff reconnect and a silence watchdog —
// EDDN never goes quiet for long, so a dead-quiet socket is a dead socket.

import net from 'node:net';

const SILENCE_TIMEOUT_MS = 90_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/**
 * @param {string} host
 * @param {number} port
 * @param {(body: Buffer) => void} onMessage  raw message frame body (zlib-compressed for EDDN)
 * @param {(status: string) => void} [onStatus]
 * @returns {{ stop: () => void, isUp: () => boolean }}
 */
export function connectSub(host, port, onMessage, onStatus) {
  let sock = null;
  let stopped = false;
  let up = false;
  let backoff = BACKOFF_MIN_MS;
  let watchdog = null;
  const status = (s) => { try { onStatus && onStatus(s); } catch { /* observer only */ } };

  const GREETING = Buffer.concat([
    Buffer.from([0xff, 0, 0, 0, 0, 0, 0, 0, 1, 0x7f]),
    Buffer.from([3, 0]),
    Buffer.from('NULL'.padEnd(20, '\0'), 'latin1'),
    Buffer.from([0]),
    Buffer.alloc(31),
  ]);

  const meta = (props) => {
    const parts = [];
    for (const [k, v] of Object.entries(props)) {
      const kb = Buffer.from(k, 'latin1');
      const vb = Buffer.from(v, 'latin1');
      const vlen = Buffer.alloc(4); vlen.writeUInt32BE(vb.length);
      parts.push(Buffer.from([kb.length]), kb, vlen, vb);
    }
    return Buffer.concat(parts);
  };
  const command = (name, body) => {
    const nb = Buffer.from(name, 'latin1');
    const payload = Buffer.concat([Buffer.from([nb.length]), nb, body]);
    if (payload.length < 256) return Buffer.concat([Buffer.from([0x04, payload.length]), payload]);
    const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(payload.length));
    return Buffer.concat([Buffer.from([0x06]), size, payload]);
  };
  const messageFrame = (body) => {
    if (body.length < 256) return Buffer.concat([Buffer.from([0x00, body.length]), body]);
    const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(body.length));
    return Buffer.concat([Buffer.from([0x02]), size, body]);
  };

  function armWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      status('silence timeout — recycling connection');
      try { sock && sock.destroy(); } catch { /* already down */ }
    }, SILENCE_TIMEOUT_MS);
    if (watchdog.unref) watchdog.unref();
  }

  function open() {
    if (stopped) return;
    let buf = Buffer.alloc(0);
    let stage = 'greeting';
    sock = net.connect(port, host);
    sock.setNoDelay(true);

    sock.on('connect', () => { status('connected'); sock.write(GREETING); armWatchdog(); });

    sock.on('data', (d) => {
      armWatchdog();
      buf = Buffer.concat([buf, d]);
      if (stage === 'greeting') {
        if (buf.length < 64) return;
        buf = buf.subarray(64);
        stage = 'handshake';
        sock.write(command('READY', meta({ 'Socket-Type': 'SUB' })));
      }
      for (;;) {
        if (buf.length < 2) return;
        const flags = buf[0];
        const long = (flags & 0x02) !== 0;
        const isCommand = (flags & 0x04) !== 0;
        let size, headerLen;
        if (long) {
          if (buf.length < 9) return;
          size = Number(buf.readBigUInt64BE(1));
          headerLen = 9;
        } else {
          size = buf[1];
          headerLen = 2;
        }
        if (buf.length < headerLen + size) return;
        const body = buf.subarray(headerLen, headerLen + size);
        buf = buf.subarray(headerLen + size);
        if (isCommand) {
          const nameLen = body[0];
          const name = body.subarray(1, 1 + nameLen).toString('latin1');
          if (name === 'READY' && stage === 'handshake') {
            stage = 'stream';
            up = true;
            backoff = BACKOFF_MIN_MS;
            sock.write(messageFrame(Buffer.from([0x01]))); // subscribe to everything
            status('subscribed');
          }
        } else if (stage === 'stream') {
          try { onMessage(body); } catch { /* one bad message must not kill the stream */ }
        }
      }
    });

    const recycle = (why) => {
      up = false;
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (stopped) return;
      status(`${why} — reconnecting in ${Math.round(backoff / 1000)}s`);
      const t = setTimeout(open, backoff);
      if (t.unref) t.unref();
      backoff = Math.min(BACKOFF_MAX_MS, backoff * 2);
    };
    sock.on('error', (e) => { status('error: ' + e.message); });
    sock.on('close', () => recycle('closed'));
  }

  open();
  return {
    stop: () => { stopped = true; if (watchdog) clearTimeout(watchdog); try { sock && sock.destroy(); } catch { /* done */ } },
    isUp: () => up,
  };
}
