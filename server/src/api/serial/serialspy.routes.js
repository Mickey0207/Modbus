const express = require('express');
let SerialPort;
try { SerialPort = require('serialport').SerialPort || require('serialport'); } catch {}

module.exports = function createSerialSpyRoutes() {
  const router = express.Router();

  // GET /api/serialspy/list -> list available serial ports
  router.get('/list', async (req, res) => {
    if (!SerialPort?.list) return res.status(500).json({ success: false, message: 'serialport 模組未安裝' });
    try {
      const ports = await SerialPort.list();
      res.json({ success: true, data: ports });
    } catch (e) { res.status(500).json({ success: false, message: e?.message || String(e) }); }
  });

  // POST /api/serialspy/capture { path, baudRate, dataBits, stopBits, parity, durationMs }
  router.post('/capture', async (req, res) => {
    if (!SerialPort) return res.status(500).json({ success: false, message: 'serialport 模組未安裝' });
    const { path, baudRate = 9600, dataBits = 8, stopBits = 1, parity = 'none', durationMs = 300 } = req.body || {};
    if (!path) return res.status(400).json({ success: false, message: '缺少 path' });
    const chunks = [];
    try {
      const port = new SerialPort({ path, baudRate, dataBits, stopBits, parity, autoOpen: true });
      await new Promise((resolve, reject) => {
        port.once('open', resolve);
        port.once('error', reject);
      });
      port.on('data', (d) => chunks.push(Buffer.from(d)));
      await new Promise(r => setTimeout(r, durationMs));
      port.removeAllListeners('data');
      port.close();
      const buf = Buffer.concat(chunks);
      res.json({ success: true, data: { bytes: buf.length, hex: buf.toString('hex') } });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) });
    }
  });

  // GET /api/serialspy/stream?path=COM3&baudRate=9600&dataBits=8&stopBits=1&parity=none
  router.get('/stream', async (req, res) => {
    if (!SerialPort) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'serialport 模組未安裝' })}\n\n`);
      return res.end();
    }
    const path = req.query?.path;
    const baudRate = Number(req.query?.baudRate ?? 9600);
    const dataBits = Number(req.query?.dataBits ?? 8);
    const stopBits = Number(req.query?.stopBits ?? 1);
    const parity = String(req.query?.parity ?? 'none');
    if (!path) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'error', message: '缺少 path' })}\n\n`);
      return res.end();
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const write = (obj) => { try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {} };
    const heartbeat = setInterval(() => write({ type: 'ping', ts: Date.now() }), 15000);

    let port;
    try {
      port = new SerialPort({ path, baudRate, dataBits, stopBits, parity, autoOpen: true });
      await new Promise((resolve, reject) => {
        port.once('open', resolve);
        port.once('error', reject);
      });
      write({ type: 'start', path, baudRate, dataBits, stopBits, parity, ts: Date.now() });
    } catch (e) {
      clearInterval(heartbeat);
      write({ type: 'error', message: e?.message || String(e) });
      return res.end();
    }

    const onData = (d) => {
      const buf = Buffer.from(d);
      write({ type: 'data', ts: Date.now(), bytes: buf.length, hex: buf.toString('hex') });
    };
    const onError = (err) => write({ type: 'error', message: err?.message || String(err) });
    port.on('data', onData);
    port.on('error', onError);

    req.on('close', () => {
      clearInterval(heartbeat);
      try { port.removeListener('data', onData); } catch {}
      try { port.removeListener('error', onError); } catch {}
      try { port.close(); } catch {}
      try { write({ type: 'end', ts: Date.now() }); } catch {}
      try { res.end(); } catch {}
    });
  });

  return router;
};
