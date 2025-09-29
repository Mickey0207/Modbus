const express = require('express');

module.exports = function createRegistryRoutes(multi, sqlite) {
  const router = express.Router();

  // 列出所有已註冊 host（來源 DB + 目前記憶體）
  router.get('/', async (req, res) => {
    try {
      // 若有 DB，優先以 host_status 為主體來源，合併記憶體中的即時連線狀態；
      // 若無 DB，退回以記憶體（multi.hosts）為主。
  if (sqlite) {
        sqlite.exec?.(`CREATE TABLE IF NOT EXISTS host_status (
          host_id TEXT PRIMARY KEY,
          ip TEXT NOT NULL,
          port INTEGER NOT NULL,
          unit_id INTEGER NOT NULL,
          connected INTEGER,
          last_seen INTEGER,
          created_at INTEGER
        )`);
        const rows = sqlite.prepare?.(`SELECT host_id as id, ip, port, unit_id as unitId, connected FROM host_status ORDER BY host_id`)?.all?.() || [];
        const data = rows.map(r => {
          const mem = multi.hosts.get(r.id);
          return {
            id: r.id,
            ip: r.ip,
            port: r.port,
            unitId: r.unitId,
            // 以記憶體的即時狀態覆蓋 DB 的 connected 欄位（若存在）
            connected: mem ? !!mem.connected : !!r.connected,
          };
        });
        // DB-first: 不再補上僅存在於記憶體的 hosts，避免與 DB 手動修改產生重複
        return res.json({ success: true, data });
      }

      // 無 DB：維持原行為
      const list = [];
      for (const [id, item] of multi.hosts.entries()) {
        list.push({ id, ...(item?.config || {}), connected: !!item?.connected });
      }
      return res.json({ success: true, data: list });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 新增/更新一個 host 設定（儲存到 DB 並更新記憶體）
  router.post('/', async (req, res) => {
    try {
      const { id, ip, port, unitId } = req.body || {};
      if (!id || !ip || !port || !unitId) return res.status(400).json({ success: false, message: '缺少必要參數 id/ip/port/unitId' });
      if (!sqlite) {
        // 無 DB 時以記憶體模式儲存（重啟後不保留）
        const existing = multi.hosts.get(id);
        if (existing?.client) { try { existing.client.close(() => {}); } catch {}
        }
        multi.hosts.set(id, { client: null, config: { ip, port, unitId }, connected: false });
        return res.json({ success: true, message: '已儲存（記憶體）', persisted: false });
      }

      // 有 DB 時持久化到 host_status（作為即時配置＋狀態）
      sqlite.exec?.(`CREATE TABLE IF NOT EXISTS host_status (
        host_id TEXT PRIMARY KEY,
        ip TEXT NOT NULL,
        port INTEGER NOT NULL,
        unit_id INTEGER NOT NULL,
        connected INTEGER,
        last_seen INTEGER,
        created_at INTEGER
      )`);
      const now = Date.now();
      sqlite.prepare?.(`INSERT INTO host_status (host_id, ip, port, unit_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(host_id) DO UPDATE SET ip=excluded.ip, port=excluded.port, unit_id=excluded.unit_id`).run(id, ip, port, unitId, now);

      // 更新記憶體中的清單
      const existing = multi.hosts.get(id);
      if (existing?.client) { try { existing.client.close(() => {}); } catch {}
      }
      multi.hosts.set(id, { client: null, config: { ip, port, unitId }, connected: false });

      res.json({ success: true, message: '已儲存', persisted: true });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 刪除一個 host（從 DB 與記憶體移除）
  router.delete('/:id', async (req, res) => {
    try {
      const { id } = req.params;
      if (!id) return res.status(400).json({ success: false, message: '缺少 id' });
      const record = multi.hosts.get(id);
      if (record?.client) { try { record.client.close(() => {}); } catch {}
      }
      multi.hosts.delete(id);
      if (sqlite) {
        sqlite.prepare?.(`DELETE FROM host_status WHERE host_id = ?`).run(id);
        return res.json({ success: true, message: '已刪除', persisted: true });
      } else {
        return res.json({ success: true, message: '已刪除（記憶體）', persisted: false });
      }
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  return router;
};
