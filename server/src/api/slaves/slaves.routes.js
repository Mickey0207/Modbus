const express = require('express');

function now() { return Date.now(); }

module.exports = function createSlavesRoutes(sqlite, multi) {
  const router = express.Router();

  router.post('/scan', async (req, res) => {
    try {
      if (!sqlite) return res.json({ success: true, data: [] });
      const scanMap = sqlite.prepare(`SELECT address, slave_unit_id as unitId FROM scan_map ORDER BY address`).all();
      const results = [];
      for (const [id, item] of multi.hosts.entries()) {
        if (!item?.connected) continue;
        for (const m of scanMap) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const data = await multi.readHoldingRegisters(id, m.address, 1);
            const detected = Array.isArray(data) ? (Number(data[0]) === 0) : false;
            sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, connected, updated_at) VALUES (?, ?, ?, ? )`).run(id, m.unitId, detected ? 1 : 0, now());
            results.push({ hostId: id, unitId: m.unitId, detected });
          } catch (e) {
            results.push({ hostId: id, error: e?.message || String(e) });
          }
        }
      }
      res.json({ success: true, data: results });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  function getStatus(sqlite, hostId, unitId) {
    const row = sqlite.prepare(`SELECT enabled, type FROM slave_status WHERE host_id=? AND slave_unit_id=?`).get(hostId, unitId);
    return { enabled: row ? !!row.enabled : true, type: row?.type || 'SL-SW8CH' };
  }

  router.post('/:hostId/:unitId/enabled', async (req, res) => {
    try {
      if (!sqlite) return res.status(503).json({ success: false, message: 'DB 未啟用，無法查 control_map' });
      const { hostId, unitId } = req.params; const { enabled } = req.body || {};
      const map = sqlite.prepare(`SELECT reg_addr FROM control_map WHERE slave_unit_id=?`).get(Number(unitId));
      if (!map) return res.status(404).json({ success: false, message: '找不到控制對映 reg_addr' });
      const cur = getStatus(sqlite, hostId, Number(unitId));
      const high = (enabled ? 0 : 1) & 0xFF;
      const low = cur.type === 'SL-1-10V4CHDIM' ? 2 : 1;
      const value = (high << 8) | low;
      await multi.writeSingleRegister(hostId, map.reg_addr, value);
      sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, enabled, type, updated_at) VALUES (?, ?, ?, ?, ? )`).run(hostId, Number(unitId), enabled ? 1 : 0, cur.type, now());
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post('/:hostId/:unitId/type', async (req, res) => {
    try {
      if (!sqlite) return res.status(503).json({ success: false, message: 'DB 未啟用，無法查 control_map' });
      const { hostId, unitId } = req.params; const { type } = req.body || {};
      if (type !== 'SL-SW8CH' && type !== 'SL-1-10V4CHDIM') return res.status(400).json({ success: false, message: 'type 不合法' });
      const map = sqlite.prepare(`SELECT reg_addr FROM control_map WHERE slave_unit_id=?`).get(Number(unitId));
      if (!map) return res.status(404).json({ success: false, message: '找不到控制對映 reg_addr' });
      const cur = getStatus(sqlite, hostId, Number(unitId));
      const high = (cur.enabled ? 0 : 1) & 0xFF;
      const low = type === 'SL-1-10V4CHDIM' ? 2 : 1;
      const value = (high << 8) | low;
      await multi.writeSingleRegister(hostId, map.reg_addr, value);
      sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, enabled, type, updated_at) VALUES (?, ?, ?, ?, ? )`).run(hostId, Number(unitId), cur.enabled ? 1 : 0, type, now());
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  return router;
};
