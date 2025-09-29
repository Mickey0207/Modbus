const express = require('express')

module.exports = function createMappingRoutes(sqlite) {
  const router = express.Router()

  // Ensure tables exist
  if (sqlite?.exec) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS sw8ch_address_map (
      unit_id INTEGER PRIMARY KEY,
      address INTEGER NOT NULL,
      created_at INTEGER
    )`)
    sqlite.exec(`CREATE TABLE IF NOT EXISTS dim_address_map (
      unit_id INTEGER PRIMARY KEY,
      mask_address INTEGER NOT NULL,
      ch1_address INTEGER NOT NULL,
      ch2_address INTEGER NOT NULL,
      ch3_address INTEGER NOT NULL,
      ch4_address INTEGER NOT NULL,
      created_at INTEGER
    )`)
  }

  // -------- SW8CH --------
  router.get('/sw8ch', (req, res) => {
    try {
      const rows = sqlite?.prepare?.('SELECT unit_id as unitId, address FROM sw8ch_address_map ORDER BY unit_id')?.all?.() || []
      res.json({ success: true, data: rows })
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) })
    }
  })

  router.post('/sw8ch', (req, res) => {
    try {
      const unitId = Number(req?.body?.unitId)
      const address = Number(req?.body?.address)
      if (!Number.isFinite(unitId) || unitId < 1) return res.status(400).json({ success: false, message: 'unitId 必須為 >=1 的整數' })
      if (!Number.isFinite(address) || address < 0) return res.status(400).json({ success: false, message: 'address 必須為 >=0 的整數' })
      const now = Date.now()
      sqlite?.prepare?.(`INSERT INTO sw8ch_address_map (unit_id, address, created_at) VALUES (?, ?, ?)
        ON CONFLICT(unit_id) DO UPDATE SET address=excluded.address`).run(unitId, address, now)
      res.json({ success: true, message: 'ok' })
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) })
    }
  })

  router.delete('/sw8ch/:unitId', (req, res) => {
    try {
      const unitId = Number(req?.params?.unitId)
      if (!Number.isFinite(unitId)) return res.status(400).json({ success: false, message: 'unitId 不合法' })
      sqlite?.prepare?.('DELETE FROM sw8ch_address_map WHERE unit_id = ?').run(unitId)
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) })
    }
  })

  // -------- DIM --------
  router.get('/dim', (req, res) => {
    try {
      const rows = sqlite?.prepare?.(`SELECT unit_id as unitId, mask_address as maskAddress, ch1_address as ch1, ch2_address as ch2, ch3_address as ch3, ch4_address as ch4
        FROM dim_address_map ORDER BY unit_id`)?.all?.() || []
      res.json({ success: true, data: rows })
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) })
    }
  })

  router.post('/dim', (req, res) => {
    try {
      const unitId = Number(req?.body?.unitId)
      const maskAddress = Number(req?.body?.maskAddress)
      const ch1 = Number(req?.body?.ch1)
      const ch2 = Number(req?.body?.ch2)
      const ch3 = Number(req?.body?.ch3)
      const ch4 = Number(req?.body?.ch4)
      if (!Number.isFinite(unitId) || unitId < 1) return res.status(400).json({ success: false, message: 'unitId 必須為 >=1 的整數' })
      const all = [maskAddress, ch1, ch2, ch3, ch4]
      if (all.some(v => !Number.isFinite(v) || v < 0)) return res.status(400).json({ success: false, message: 'address 必須為 >=0 的整數' })
      const now = Date.now()
      sqlite?.prepare?.(`INSERT INTO dim_address_map (unit_id, mask_address, ch1_address, ch2_address, ch3_address, ch4_address, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(unit_id) DO UPDATE SET mask_address=excluded.mask_address, ch1_address=excluded.ch1_address, ch2_address=excluded.ch2_address, ch3_address=excluded.ch3_address, ch4_address=excluded.ch4_address`).run(unitId, maskAddress, ch1, ch2, ch3, ch4, now)
      res.json({ success: true, message: 'ok' })
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) })
    }
  })

  router.delete('/dim/:unitId', (req, res) => {
    try {
      const unitId = Number(req?.params?.unitId)
      if (!Number.isFinite(unitId)) return res.status(400).json({ success: false, message: 'unitId 不合法' })
      sqlite?.prepare?.('DELETE FROM dim_address_map WHERE unit_id = ?').run(unitId)
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) })
    }
  })

  return router
}
