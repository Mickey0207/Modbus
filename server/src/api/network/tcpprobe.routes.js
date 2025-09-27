const express = require('express');
const net = require('net');

function parsePayload(payload) {
  if (!payload) return Buffer.alloc(0)
  if (Array.isArray(payload)) return Buffer.from(payload)
  if (typeof payload === 'string') {
    const clean = payload.replace(/[^0-9a-fA-F\s]/g, ' ').replace(/\s+/g, ' ').trim().replace(/\s/g, '')
    if (clean.length % 2 !== 0) throw new Error('Hex 長度必須是偶數')
    const out = Buffer.alloc(clean.length / 2)
    for (let i = 0; i < clean.length; i += 2) out[i/2] = parseInt(clean.slice(i, i+2), 16)
    return out
  }
  throw new Error('不支援的 payload 格式')
}

module.exports = function createTcpProbeRoutes() {
  const router = express.Router();

  // POST /api/tcpprobe/send { host, port, payload: number[] | hexString, timeoutMs }
  router.post('/send', async (req, res) => {
    const { host, port, payload, timeoutMs = 1200 } = req.body || {}
    if (!host || !port) return res.status(400).json({ success: false, message: '缺少 host 或 port' })
    let buf
    try { buf = parsePayload(payload) } catch (e) { return res.status(400).json({ success: false, message: e?.message || String(e) }) }

    const started = Date.now()
    const chunks = []
    let bytesWritten = 0
    let connected = false
    let errorMsg = undefined
    let timedOut = false
    await new Promise((resolve) => {
      const socket = net.createConnection({ host, port }, () => {
        connected = true
        try {
          bytesWritten = socket.write(buf) ? buf.length : 0
        } catch (e) {}
      })
      const to = setTimeout(() => {
        timedOut = true
        try { socket.destroy() } catch {}
      }, timeoutMs)
      socket.on('data', (d) => chunks.push(Buffer.from(d)))
      socket.on('error', (err) => { errorMsg = err?.code || err?.message || String(err) })
      socket.on('end', () => {})
      socket.on('close', () => { clearTimeout(to); resolve() })
    })
    const elapsed = Date.now() - started
    const rx = Buffer.concat(chunks)
    res.json({
      success: !errorMsg,
      message: errorMsg,
      data: { elapsedMs: elapsed, connected, timedOut, bytesWritten, receivedBytes: rx.length, receivedHex: rx.toString('hex') }
    })
  })

  return router;
}
