const express = require('express');

module.exports = function createStatusRoutes(sqlite, multi) {
  const router = express.Router();

  router.get('/hosts', (req, res) => {
    try {
      const list = [];
      for (const [id, item] of multi.hosts.entries()) {
        if (item?.connected) list.push({ id, ...(item?.config || {}), connected: true });
      }
      res.json({ success: true, data: list });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.get('/slaves/by-host/:hostId', (req, res) => {
    try {
      const { hostId } = req.params;
      if (!sqlite) return res.json({ success: true, data: [] });
      const rows = sqlite.prepare(`SELECT slave_unit_id as unitId, connected, enabled, type, updated_at as updatedAt FROM slave_status WHERE host_id=?`).all(hostId);
      res.json({ success: true, data: rows });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  return router;
};
