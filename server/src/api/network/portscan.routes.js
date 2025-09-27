const express = require('express');
const net = require('net');

function tryConnect(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = (ok, info = {}) => { if (done) return; done = true; socket.destroy(); resolve({ port, ok, ...info }); };
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false, { error: 'timeout' }));
    socket.on('error', (err) => finish(false, { error: err?.code || err?.message || 'error' }));
  });
}

async function runScan({ host, ports, timeoutMs = 500, concurrency = 100 }) {
  const results = [];
  let i = 0;
  const tasks = new Array(concurrency).fill(0).map(async () => {
    while (i < ports.length) {
      const p = ports[i++];
      // eslint-disable-next-line no-await-in-loop
      const r = await tryConnect(host, p, timeoutMs);
      results.push(r);
    }
  });
  await Promise.all(tasks);
  results.sort((a, b) => a.port - b.port);
  return results;
}

async function runScanStream({ host, ports, timeoutMs = 500, concurrency = 100, onResult, isCancelled }) {
  let i = 0;
  const tasks = new Array(concurrency).fill(0).map(async () => {
    while (i < ports.length) {
      if (isCancelled?.()) return;
      const p = ports[i++];
      // eslint-disable-next-line no-await-in-loop
      const r = await tryConnect(host, p, timeoutMs);
      onResult?.(r);
    }
  });
  await Promise.all(tasks);
}

module.exports = function createPortScanRoutes() {
  const router = express.Router();

  // POST /api/portscan/run { ip, start?, end?, ports?, timeoutMs?, concurrency? }
  router.post('/run', async (req, res) => {
    const host = req.body?.ip;
    const start = Number(req.body?.start ?? 1);
    const end = Number(req.body?.end ?? 65535);
    const list = Array.isArray(req.body?.ports) ? req.body.ports.map(Number).filter(n => Number.isFinite(n) && n > 0 && n < 65536) : null;
    const timeoutMs = Math.min(Math.max(Number(req.body?.timeoutMs ?? 500), 50), 5000);
    const concurrency = Math.min(Math.max(Number(req.body?.concurrency ?? 128), 1), 512);
    if (!host) return res.status(400).json({ success: false, message: '請提供 ip' });
    let ports = list;
    if (!ports) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end > 65535 || start > end) {
        return res.status(400).json({ success: false, message: 'start/end 無效' });
      }
      ports = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
    }
    try {
      const started = Date.now();
      const results = await runScan({ host, ports, timeoutMs, concurrency });
      const open = results.filter(r => r.ok).map(r => r.port);
      res.json({ success: true, data: { open, count: results.length, elapsed: Date.now() - started } });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) });
    }
  });

  // GET /api/portscan/stream?ip=...&start=1&end=65535&timeoutMs=300&concurrency=128
  router.get('/stream', async (req, res) => {
    const host = req.query?.ip;
    const start = Number(req.query?.start ?? 1);
    const end = Number(req.query?.end ?? 65535);
    const list = typeof req.query?.ports === 'string'
      ? String(req.query.ports).split(',').map(s => Number(s.trim())).filter(n => Number.isFinite(n) && n > 0 && n < 65536)
      : null;
    const timeoutMs = Math.min(Math.max(Number(req.query?.timeoutMs ?? 500), 50), 5000);
    const concurrency = Math.min(Math.max(Number(req.query?.concurrency ?? 128), 1), 512);
    if (!host) {
      res.status(400).end('missing ip');
      return;
    }
    let ports = list;
    if (!ports) {
      if (!Number.isFinite(start) || !Number.isFinite(end) || start <= 0 || end > 65535 || start > end) {
        res.status(400).end('bad start/end');
        return;
      }
      ports = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const total = ports.length;
    let scanned = 0;
    let openCount = 0;
    let cancelled = false;
    const isCancelled = () => cancelled;
    const write = (obj) => {
      try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
    };

    const heartbeat = setInterval(() => { write({ type: 'ping', ts: Date.now() }); }, 15000);
    req.on('close', () => { cancelled = true; clearInterval(heartbeat); });

    write({ type: 'start', total });

    try {
      await runScanStream({ host, ports, timeoutMs, concurrency, isCancelled, onResult: (r) => {
        scanned += 1;
        if (r.ok) openCount += 1;
        write({ type: 'progress', port: r.port, ok: r.ok, error: r.error, scanned, total, openCount });
      }});
      write({ type: 'done', scanned, total, openCount });
    } catch (e) {
      write({ type: 'error', message: e?.message || String(e) });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });

  return router;
};
