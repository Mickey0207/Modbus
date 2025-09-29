const express = require('express');

function ensureSchema(sqlite) {
  if (!sqlite) return;
  // Core tables
  sqlite.exec?.(`
    PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  CREATE TABLE IF NOT EXISTS site_sw_hosts (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ip TEXT,
      port INTEGER,
      unit_id INTEGER,
      -- connection & config fields (added later via ALTER if missing)
      enabled INTEGER,
      type TEXT,
      serial_path TEXT,
      baud_rate INTEGER,
      data_bits INTEGER,
    parity TEXT,
    stop_bits INTEGER,
      floor TEXT,
      room TEXT,
      note TEXT,
      sort INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(site_id, name),
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS site_sw_slaves (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slave_unit_id INTEGER,
      desired_enabled INTEGER,
      desired_type TEXT,
      sw_mask INTEGER,
      dim_mask INTEGER,
      dim_values TEXT,
      floor TEXT,
      room TEXT,
      note TEXT,
      sort INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(host_id, name),
      UNIQUE(host_id, slave_unit_id),
      FOREIGN KEY(host_id) REFERENCES site_sw_hosts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS site_sw_versions (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      major INTEGER,
      minor INTEGER,
      patch INTEGER,
      version TEXT,
      note TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(site_id, version),
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS site_sw_version_snapshots (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      FOREIGN KEY(version_id) REFERENCES site_sw_versions(id) ON DELETE CASCADE
    );
  -- Global mapping and status tables
    CREATE TABLE IF NOT EXISTS scan_map (
      address INTEGER PRIMARY KEY,
      slave_unit_id INTEGER
    );
    CREATE TABLE IF NOT EXISTS control_map (
      slave_unit_id INTEGER PRIMARY KEY,
      reg_addr INTEGER NOT NULL
    );
    -- host_status 是即時主機（配置＋狀態）的合併表
    CREATE TABLE IF NOT EXISTS host_status (
      host_id TEXT PRIMARY KEY,
      name TEXT,
      ip TEXT NOT NULL,
      port INTEGER NOT NULL,
      unit_id INTEGER NOT NULL,
      connected INTEGER,
      last_seen INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS slave_status (
      host_id TEXT NOT NULL,
      slave_unit_id INTEGER NOT NULL,
      name TEXT,
      connected INTEGER,
      enabled INTEGER,
      type TEXT,
      -- current runtime state for UI aggregation
      sw_mask_current INTEGER,
      sw_on_count INTEGER,
      dim_mask_current INTEGER,
      dim_on_count INTEGER,
      dim_values_current TEXT,
      updated_at INTEGER,
      PRIMARY KEY(host_id, slave_unit_id)
    );
  `);


  // Add missing columns to slave_status safely
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(slave_status)`).all();
    const has = (name) => cols.some(c => c.name === name);
    const addCol = (ddl) => sqlite.prepare(`ALTER TABLE slave_status ADD COLUMN ${ddl}`).run();
    if (!has('name')) addCol(`name TEXT`);
    if (!has('sw_mask_current')) addCol(`sw_mask_current INTEGER`);
    if (!has('sw_on_count')) addCol(`sw_on_count INTEGER`);
    if (!has('dim_mask_current')) addCol(`dim_mask_current INTEGER`);
    if (!has('dim_on_count')) addCol(`dim_on_count INTEGER`);
    if (!has('dim_values_current')) addCol(`dim_values_current TEXT`);
  } catch {}
  // Add missing columns to host_status safely
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(host_status)`).all();
    const has = (name) => cols.some(c => c.name === name);
    const addCol = (ddl) => sqlite.prepare(`ALTER TABLE host_status ADD COLUMN ${ddl}`).run();
    if (!has('name')) addCol(`name TEXT`);
  } catch {}

  // Add missing columns safely for site_sw_versions
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(site_sw_versions)`).all();
    const has = (name) => cols.some(c => c.name === name);
    const addCol = (ddl) => sqlite.prepare(`ALTER TABLE site_sw_versions ADD COLUMN ${ddl}`).run();
    if (!has('note')) addCol(`note TEXT`);
  } catch {}

  // Add missing columns safely for site_sw_hosts (SQLite doesn't support IF NOT EXISTS for ADD COLUMN reliably)
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(site_sw_hosts)`).all();
    const has = (name) => cols.some(c => c.name === name);
    const addCol = (ddl) => sqlite.prepare(`ALTER TABLE site_sw_hosts ADD COLUMN ${ddl}`).run();
    if (!has('enabled')) addCol(`enabled INTEGER NOT NULL DEFAULT 1`);
    if (!has('type')) addCol(`type TEXT`);
    if (!has('serial_path')) addCol(`serial_path TEXT`);
    if (!has('baud_rate')) addCol(`baud_rate INTEGER`);
    if (!has('data_bits')) addCol(`data_bits INTEGER`);
    if (!has('parity')) addCol(`parity TEXT`);
    if (!has('stop_bits')) addCol(`stop_bits INTEGER`);
    // 新增連線狀態欄位
    if (!has('connected')) addCol(`connected INTEGER`);
    if (!has('last_seen')) addCol(`last_seen INTEGER`);
  } catch (e) {
    // best-effort; ignore if migrations are handled elsewhere
  }

  // Add missing columns safely for site_sw_slaves
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(site_sw_slaves)`).all();
    const has = (name) => cols.some(c => c.name === name);
    const addCol = (ddl) => sqlite.prepare(`ALTER TABLE site_sw_slaves ADD COLUMN ${ddl}`).run();
    if (!has('connected')) addCol(`connected INTEGER`);
    if (!has('last_seen')) addCol(`last_seen INTEGER`);
  } catch {}

  // Helpful indexes
  try {
    sqlite.exec?.(`
      CREATE INDEX IF NOT EXISTS idx_site_sw_hosts_site_id ON site_sw_hosts(site_id);
      CREATE INDEX IF NOT EXISTS idx_site_sw_hosts_enabled ON site_sw_hosts(enabled);
      CREATE INDEX IF NOT EXISTS idx_site_sw_slaves_host_id ON site_sw_slaves(host_id);
      CREATE INDEX IF NOT EXISTS idx_site_sw_slaves_unit ON site_sw_slaves(slave_unit_id);
    `);
  } catch {}
}

function rid() { return Math.random().toString(36).slice(2, 10); }
function now() { return Date.now(); }
function nextVersion({ major, minor, patch }) {
  let a = major ?? 0, b = minor ?? 0, c = patch ?? 0;
  c += 1; if (c > 9) { c = 0; b += 1; } if (b > 9) { b = 0; a += 1; }
  return { major: a, minor: b, patch: c, version: `${a}.${b}.${c}` };
}

module.exports = function createSitesRoutes(sqlite, multi) {
  ensureSchema(sqlite);
  const router = express.Router();

  // ---- Sites CRUD ----
  router.get('/', (req, res) => {
    try {
      const sites = sqlite.prepare(`SELECT id, name, description, created_at as createdAt, updated_at as updatedAt FROM sites ORDER BY created_at DESC`).all();
      const hostsStmt = sqlite.prepare(`SELECT * FROM site_sw_hosts WHERE site_id = ? ORDER BY COALESCE(sort, created_at)`);
      const slavesStmt = sqlite.prepare(`SELECT * FROM site_sw_slaves WHERE host_id = ? ORDER BY COALESCE(sort, created_at)`);
  const versStmt = sqlite.prepare(`SELECT id, site_id as siteId, major, minor, patch, version, note, created_at as createdAt, updated_at as updatedAt FROM site_sw_versions WHERE site_id = ? ORDER BY created_at DESC`);
      const result = sites.map(s => {
        const hosts = hostsStmt.all(s.id).map(h => ({
          id: h.id,
          name: h.name,
          connected: h.connected ? 1 : 0,
          lastSeen: h.last_seen,
          enabled: h.enabled == null ? 1 : (h.enabled ? 1 : 0),
          type: h.type || null,
          ip: h.ip,
          port: h.port,
          unitId: h.unit_id,
          serialPath: h.serial_path,
          baudRate: h.baud_rate,
          dataBits: h.data_bits,
          parity: h.parity,
          stopBits: h.stop_bits,
          floor: h.floor,
          room: h.room,
          note: h.note,
          sort: h.sort,
          slaves: slavesStmt.all(h.id).map(sl => {
            let dimVals = [0,0,0,0];
            if (sl.dim_values != null) {
              try {
                const parsed = JSON.parse(sl.dim_values);
                if (Array.isArray(parsed)) {
                  const arr = parsed.slice(0,4).map(v=>Number.isFinite(Number(v))? Math.max(0, Math.min(255, Number(v)|0)) : 0);
                  while (arr.length < 4) arr.push(0);
                  dimVals = arr;
                }
              } catch {}
            }
            return ({
              id: sl.id, name: sl.name, unitId: sl.slave_unit_id, enabled: sl.desired_enabled ? true : false, type: sl.desired_type,
              connected: sl.connected ? 1 : 0,
              lastSeen: sl.last_seen,
              swMask: sl.sw_mask ?? 0, dimMask: sl.dim_mask ?? 0, dimValues: dimVals,
              floor: sl.floor, room: sl.room, note: sl.note, sort: sl.sort
            })
          })
        }));
        let versions = [];
        try { versions = versStmt.all(s.id); } catch { versions = []; }
        const latest = versions.length > 0 ? versions[0].version : undefined;
        return { ...s, version: latest, versions, hosts };
      });
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, message: e?.message || String(e) });
    }
  });

  router.post('/', (req, res) => {
    try {
      const { name, description } = req.body || {};
      if (!name) return res.status(400).json({ success: false, message: '缺少名稱' });
      const id = rid();
      const t = now();
      sqlite.prepare(`INSERT INTO sites (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, name, description || '', t, t);
      res.json({ success: true, data: { id, name, description: description || '', createdAt: t, updatedAt: t } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.patch('/:siteId', (req, res) => {
    try {
      const { siteId } = req.params; const { name, description } = req.body || {};
      const t = now();
      const stmt = sqlite.prepare(`UPDATE sites SET name=COALESCE(?, name), description=COALESCE(?, description), updated_at=? WHERE id=?`);
      stmt.run(name ?? null, description ?? null, t, siteId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.delete('/:siteId', (req, res) => {
    try {
      const { siteId } = req.params;
      // cascade by FK ON DELETE CASCADE (enforced by PRAGMA foreign_keys)
      sqlite.prepare(`DELETE FROM sites WHERE id=?`).run(siteId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Hosts under a Site ----
  router.get('/:siteId/hosts', (req, res) => {
    try {
      const { siteId } = req.params;
      const rows = sqlite.prepare(`SELECT * FROM site_sw_hosts WHERE site_id = ? ORDER BY COALESCE(sort, created_at)`).all(siteId);
      res.json({ success: true, data: rows.map(h => ({
        id: h.id,
        name: h.name,
        connected: h.connected ? 1 : 0,
        lastSeen: h.last_seen,
        enabled: h.enabled == null ? 1 : h.enabled ? 1 : 0,
        type: h.type || null,
        ip: h.ip,
        port: h.port,
        unitId: h.unit_id,
        serialPath: h.serial_path,
        baudRate: h.baud_rate,
        dataBits: h.data_bits,
        parity: h.parity,
        stopBits: h.stop_bits,
        floor: h.floor,
        room: h.room,
        note: h.note,
        sort: h.sort
      })) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post('/:siteId/hosts', (req, res) => {
    try {
      const { siteId } = req.params;
      const { name, enabled, type, ip, port, unitId, serialPath, baudRate, dataBits, parity, stopBits, floor, room, note, sort } = req.body || {};
      if (!name) return res.status(400).json({ success: false, message: '缺少主機名稱' });
      const srow = sqlite.prepare(`SELECT id FROM sites WHERE id=?`).get(siteId);
      if (!srow) return res.status(404).json({ success: false, message: '找不到案場（siteId 無效）' });
      const id = rid(); const t = now();
      try {
        sqlite.prepare(`INSERT INTO site_sw_hosts (id, site_id, name, enabled, type, ip, port, unit_id, serial_path, baud_rate, data_bits, parity, stop_bits, floor, room, note, sort, created_at, updated_at, connected, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, siteId, name, (enabled===undefined?1:(enabled?1:0)), type || null, ip || null, port || null, unitId || null, serialPath || null, baudRate || null, dataBits || null, parity || null, stopBits || null, floor || null, room || null, note || null, sort || null, t, t, 0, null);
      } catch (e) {
        const msg = String(e?.message || e)
        if (msg.includes('UNIQUE') || msg.includes('constraint')) return res.status(409).json({ success: false, message: '主機名稱重複（同案場不可重複）' })
        return res.status(500).json({ success: false, message: msg })
      }
      sqlite.prepare(`UPDATE sites SET updated_at=? WHERE id=?`).run(t, siteId);
      res.json({ success: true, data: { id } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.patch('/:siteId/hosts/:hostId', (req, res) => {
    try {
      const { siteId, hostId } = req.params;
      const { name, enabled, type, ip, port, unitId, serialPath, baudRate, dataBits, parity, stopBits, floor, room, note, sort } = req.body || {};
      const t = now();
      sqlite.prepare(`UPDATE site_sw_hosts SET name=COALESCE(?, name), enabled=COALESCE(?, enabled), type=COALESCE(?, type), ip=COALESCE(?, ip), port=COALESCE(?, port), unit_id=COALESCE(?, unit_id), serial_path=COALESCE(?, serial_path), baud_rate=COALESCE(?, baud_rate), data_bits=COALESCE(?, data_bits), parity=COALESCE(?, parity), stop_bits=COALESCE(?, stop_bits), floor=COALESCE(?, floor), room=COALESCE(?, room), note=COALESCE(?, note), sort=COALESCE(?, sort), updated_at=? WHERE id=? AND site_id=?`)
        .run(name ?? null, (enabled===undefined? null : (enabled?1:0)), type ?? null, ip ?? null, port ?? null, unitId ?? null, serialPath ?? null, baudRate ?? null, dataBits ?? null, parity ?? null, stopBits ?? null, floor ?? null, room ?? null, note ?? null, sort ?? null, t, hostId, siteId);
      sqlite.prepare(`UPDATE sites SET updated_at=? WHERE id=?`).run(t, siteId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.delete('/:siteId/hosts/:hostId', (req, res) => {
    try {
      const { siteId, hostId } = req.params; const t = now();
      sqlite.prepare(`DELETE FROM site_sw_hosts WHERE id=? AND site_id=?`).run(hostId, siteId);
      sqlite.prepare(`UPDATE sites SET updated_at=? WHERE id=?`).run(t, siteId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Slaves under a Host ----
  router.get('/by-host/:hostId/slaves', (req, res) => {
    try {
      const { hostId } = req.params;
      const rows = sqlite.prepare(`SELECT * FROM site_sw_slaves WHERE host_id = ? ORDER BY COALESCE(sort, created_at)`).all(hostId);
      res.json({ success: true, data: rows.map(sl => ({ id: sl.id, name: sl.name, unitId: sl.slave_unit_id, enabled: sl.desired_enabled ? true : false, type: sl.desired_type, connected: sl.connected ? 1 : 0, lastSeen: sl.last_seen, swMask: sl.sw_mask ?? 0, dimMask: sl.dim_mask ?? 0, dimValues: sl.dim_values ? JSON.parse(sl.dim_values) : [0,0,0,0], floor: sl.floor, room: sl.room, note: sl.note, sort: sl.sort })) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post('/by-host/:hostId/slaves', (req, res) => {
    try {
      const { hostId } = req.params; const { name, unitId, enabled, type, swMask, dimMask, dimValues, floor, room, note, sort } = req.body || {};
      if (!name) return res.status(400).json({ success: false, message: '缺少從機名稱' });
      const id = rid(); const t = now();
      sqlite.prepare(`INSERT INTO site_sw_slaves (id, host_id, name, slave_unit_id, desired_enabled, desired_type, sw_mask, dim_mask, dim_values, floor, room, note, sort, created_at, updated_at, connected, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, hostId, name, unitId || null, enabled ? 1 : 0, type || null, swMask ?? 0, dimMask ?? 0, JSON.stringify(Array.isArray(dimValues)? dimValues.slice(0,4) : [0,0,0,0]), floor || null, room || null, note || null, sort || null, t, t, 0, null);
      // touch site
      const row = sqlite.prepare(`SELECT site_id FROM site_sw_hosts WHERE id=?`).get(hostId);
      if (row?.site_id) sqlite.prepare(`UPDATE sites SET updated_at=? WHERE id=?`).run(t, row.site_id);
      res.json({ success: true, data: { id } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.patch('/by-host/:hostId/slaves/:slaveId', (req, res) => {
    try {
      const { hostId, slaveId } = req.params;
      const { name, unitId, enabled, type, swMask, dimMask, dimValues, floor, room, note, sort } = req.body || {};
      const t = now();
      sqlite.prepare(`UPDATE site_sw_slaves SET name=COALESCE(?, name), slave_unit_id=COALESCE(?, slave_unit_id), desired_enabled=COALESCE(?, desired_enabled), desired_type=COALESCE(?, desired_type), sw_mask=COALESCE(?, sw_mask), dim_mask=COALESCE(?, dim_mask), dim_values=COALESCE(?, dim_values), floor=COALESCE(?, floor), room=COALESCE(?, room), note=COALESCE(?, note), sort=COALESCE(?, sort), updated_at=? WHERE id=? AND host_id=?`)
        .run(name ?? null, unitId ?? null, (enabled===undefined? null : (enabled?1:0)), type ?? null, swMask ?? null, dimMask ?? null, (dimValues===undefined? null : JSON.stringify(Array.isArray(dimValues)? dimValues.slice(0,4): [0,0,0,0])), floor ?? null, room ?? null, note ?? null, sort ?? null, t, slaveId, hostId);
      const row = sqlite.prepare(`SELECT site_id FROM site_sw_hosts WHERE id=?`).get(hostId);
      if (row?.site_id) sqlite.prepare(`UPDATE sites SET updated_at=? WHERE id=?`).run(t, row.site_id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.delete('/by-host/:hostId/slaves/:slaveId', (req, res) => {
    try {
      const { hostId, slaveId } = req.params; const t = now();
      sqlite.prepare(`DELETE FROM site_sw_slaves WHERE id=? AND host_id=?`).run(slaveId, hostId);
      const row = sqlite.prepare(`SELECT site_id FROM site_sw_hosts WHERE id=?`).get(hostId);
      if (row?.site_id) sqlite.prepare(`UPDATE sites SET updated_at=? WHERE id=?`).run(t, row.site_id);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Versions ----
  router.get('/:siteId/versions', (req, res) => {
    try {
      const { siteId } = req.params;
      // 分頁/排序參數（若未提供，維持舊有行為，回傳全部陣列）
      const q = req.query || {};
      const hasPaging = (typeof q.limit !== 'undefined') || (q.paged === '1' || q.paged === 'true');
      let limit = parseInt(String(q.limit ?? '0'), 10);
      let offset = parseInt(String(q.offset ?? '0'), 10);
      if (!Number.isFinite(limit) || limit < 0) limit = 0;
      if (!Number.isFinite(offset) || offset < 0) offset = 0;
      const sort = (String(q.sort || 'created_at').toLowerCase());
      const order = (String(q.order || 'desc').toUpperCase() === 'ASC') ? 'ASC' : 'DESC';
      const sortCol = (sort === 'version' ? 'version' : (sort === 'updated_at' ? 'updated_at' : 'created_at'));

      if (!hasPaging) {
        // 舊有行為：一次回傳全部（依建立時間 DESC）
        const rows = sqlite.prepare(`
          SELECT id, site_id as siteId, major, minor, patch, version, note, created_at as createdAt, updated_at as updatedAt
          FROM site_sw_versions
          WHERE site_id=?
          ORDER BY created_at DESC
        `).all(siteId);
        return res.json({ success: true, data: rows });
      }

      // 新行為：分頁/排序
      const total = sqlite.prepare(`SELECT COUNT(1) as c FROM site_sw_versions WHERE site_id = ?`).get(siteId)?.c || 0;
      let sql = `
        SELECT id, site_id as siteId, major, minor, patch, version, note, created_at as createdAt, updated_at as updatedAt
        FROM site_sw_versions
        WHERE site_id=?
        ORDER BY ${sortCol} ${order}
      `;
      const params = [siteId];
      if (limit > 0) {
        sql += ` LIMIT ? OFFSET ?`;
        params.push(limit, offset);
      }
      const rows = sqlite.prepare(sql).all(...params);
      return res.json({ success: true, data: rows, total, limit, offset, sort: sortCol, order });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // 取得最新一筆版本（輕量端點）
  router.get('/:siteId/versions/latest', (req, res) => {
    try {
      const { siteId } = req.params;
      const row = sqlite.prepare(`
        SELECT id, site_id as siteId, major, minor, patch, version, note, created_at as createdAt, updated_at as updatedAt
        FROM site_sw_versions
        WHERE site_id=?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(siteId);
      res.json({ success: true, data: row || null });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post('/:siteId/versions', (req, res) => {
    const { siteId } = req.params; const { note } = req.body || {};
    try {
      // Guard: ensure site exists (avoid FK errors that look like generic failures)
      const siteRow = sqlite.prepare(`SELECT id FROM sites WHERE id=?`).get(siteId);
      if (!siteRow) return res.status(404).json({ success: false, message: '找不到案場（siteId 無效）' });
      // compute next version from highest existing
      const latest = sqlite.prepare(`SELECT major, minor, patch FROM site_sw_versions WHERE site_id=? ORDER BY major DESC, minor DESC, patch DESC LIMIT 1`).get(siteId) || { major: 0, minor: 0, patch: 0 };
      let v = nextVersion(latest || { major: 0, minor: 0, patch: 0 });
      const id = rid(); const t = now();
      const note512 = (typeof note === 'string' ? note.slice(0,512) : null);
      try { sqlite.exec('BEGIN'); } catch {}
      try {
        // In case of rare UNIQUE(site_id, version) conflict, bump at most 3 times
        // 檢查是否存在 note 欄位（舊 DB 可能沒有）
        let hasNoteCol = false;
        try {
          const cols = sqlite.prepare(`PRAGMA table_info(site_sw_versions)`).all();
          hasNoteCol = Array.isArray(cols) && cols.some(c => c.name === 'note');
        } catch {}
        let inserted = false; let attempts = 0;
        while (!inserted && attempts < 3) {
          try {
            if (hasNoteCol) {
              sqlite.prepare(`INSERT INTO site_sw_versions (id, site_id, major, minor, patch, version, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, siteId, v.major, v.minor, v.patch, v.version, note512, t, t);
            } else {
              sqlite.prepare(`INSERT INTO site_sw_versions (id, site_id, major, minor, patch, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, siteId, v.major, v.minor, v.patch, v.version, t, t);
            }
            inserted = true;
          } catch (e) {
            const msg = String(e?.message || e);
            if (msg.includes('UNIQUE') || msg.includes('constraint')) {
              v = nextVersion(v);
              attempts += 1;
              continue;
            }
            if (msg.includes('no column named note')) {
              // 動態偵測失敗，退回不含 note 欄位的 INSERT
              try {
                sqlite.prepare(`INSERT INTO site_sw_versions (id, site_id, major, minor, patch, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, siteId, v.major, v.minor, v.patch, v.version, t, t);
                hasNoteCol = false;
                inserted = true;
                continue;
              } catch (e2) {
                throw e2;
              }
            }
            throw e;
          }
        }
        if (!inserted) throw new Error('無法建立新版本（多次嘗試皆發生唯一鍵衝突）');
        let payloadStr = '';
        try {
          const payload = buildSnapshot(sqlite, siteId);
          payloadStr = JSON.stringify(payload);
        } catch (snapErr) {
          try { console.error('[sites] buildSnapshot failed:', snapErr?.message || snapErr) } catch {}
          // 最小備援：僅寫入站點名稱，避免版本建立完全失敗
          payloadStr = JSON.stringify({ name: getSiteName(sqlite, siteId), description: '', hosts: [] });
        }
        try {
          sqlite.prepare(`INSERT INTO site_sw_version_snapshots (id, version_id, payload) VALUES (?, ?, ?)`).run(rid(), id, payloadStr);
        } catch (se) {
          const smsg = String(se?.message || se)
          if (smsg.includes('no such table') && smsg.includes('site_sw_version_snapshots')) {
            // 動態補建快照表後重試一次
            try {
              sqlite.exec?.(`CREATE TABLE IF NOT EXISTS site_sw_version_snapshots (
                id TEXT PRIMARY KEY,
                version_id TEXT NOT NULL,
                payload TEXT NOT NULL,
                FOREIGN KEY(version_id) REFERENCES site_sw_versions(id) ON DELETE CASCADE
              )`);
              sqlite.prepare(`INSERT INTO site_sw_version_snapshots (id, version_id, payload) VALUES (?, ?, ?)`).run(rid(), id, payloadStr);
            } catch (se2) {
              throw se2;
            }
          } else {
            throw se;
          }
        }
        try { sqlite.exec('COMMIT'); } catch {}
      } catch (err) {
        try { sqlite.exec('ROLLBACK'); } catch {}
        throw err;
      }
      res.json({ success: true, data: { id, version: v.version, createdAt: t, updatedAt: t } });
    } catch (e) {
      try { console.error('[sites] POST /:siteId/versions failed:', e?.message || e, e?.stack || '') } catch {}
      res.status(500).json({ success: false, message: e?.message || String(e) });
    }
  });

  router.post('/:siteId/versions/:versionId/overwrite', (req, res) => {
    try {
      const { siteId, versionId } = req.params;
      const t = now();
      const payload = JSON.stringify(buildSnapshot(sqlite, siteId));
  sqlite.prepare(`UPDATE site_sw_versions SET updated_at=? WHERE id=? AND site_id=?`).run(t, versionId, siteId);
      const exists = sqlite.prepare(`SELECT id FROM site_sw_version_snapshots WHERE version_id=?`).get(versionId);
      if (exists) {
        sqlite.prepare(`UPDATE site_sw_version_snapshots SET payload=? WHERE version_id=?`).run(payload, versionId);
      } else {
        sqlite.prepare(`INSERT INTO site_sw_version_snapshots (id, version_id, payload) VALUES (?, ?, ?)`).run(rid(), versionId, payload);
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.get('/:siteId/versions/:versionId/export', (req, res) => {
    try {
      const { versionId } = req.params;
  const row = sqlite.prepare(`SELECT payload FROM site_sw_version_snapshots WHERE version_id=?`).get(versionId);
      if (!row) return res.status(404).json({ success: false, message: '找不到版本快照' });
      res.json({ success: true, data: JSON.parse(row.payload) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // Update version metadata (e.g., note)
  router.patch('/:siteId/versions/:versionId', (req, res) => {
    try {
      const { siteId, versionId } = req.params;
      const { note } = req.body || {};
      const t = now();
      const note512 = (typeof note === 'string' ? note.slice(0,512) : null);
      const r = sqlite.prepare(`UPDATE site_sw_versions SET note=COALESCE(?, note), updated_at=? WHERE id=? AND site_id=?`).run(note512, t, versionId, siteId);
      if (!r.changes) return res.status(404).json({ success: false, message: '版本不存在' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post('/:siteId/versions/:versionId/import', (req, res) => {
    try {
      const { siteId, versionId } = req.params; const { payload, applyToCurrent, prune } = req.body || {};
      if (!payload) return res.status(400).json({ success: false, message: '缺少 payload' });
  sqlite.prepare(`UPDATE site_sw_versions SET updated_at=? WHERE id=? AND site_id=?`).run(now(), versionId, siteId);
      const jsonStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const exists = sqlite.prepare(`SELECT id FROM site_sw_version_snapshots WHERE version_id=?`).get(versionId);
  if (exists) sqlite.prepare(`UPDATE site_sw_version_snapshots SET payload=? WHERE version_id=?`).run(jsonStr, versionId);
  else sqlite.prepare(`INSERT INTO site_sw_version_snapshots (id, version_id, payload) VALUES (?, ?, ?)`).run(rid(), versionId, jsonStr);
      if (applyToCurrent) {
        applySnapshotToDb(sqlite, siteId, JSON.parse(jsonStr), { prune: !!prune });
      }
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.delete('/:siteId/versions/:versionId', (req, res) => {
    try {
      const { versionId } = req.params;
  sqlite.prepare(`DELETE FROM site_sw_versions WHERE id=?`).run(versionId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // 匯入覆蓋（現用配置）
  router.post('/:siteId/import', (req, res) => {
    try {
      const { siteId } = req.params; const apply = req.query.apply === '1' || req.query.apply === 'true'; const prune = req.query.prune === '1' || req.query.prune === 'true';
      const payload = req.body?.payload || req.body; // 支援直接丟 JSON
      if (!payload) return res.status(400).json({ success: false, message: '缺少 payload' });
      applySnapshotToDb(sqlite, siteId, payload, { prune });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Status (read-only views) ----
  router.get('/status/hosts', (req, res) => {
    try {
      // 只回已連線的主機（以 host_status 為準），附帶名稱（優先 host_status.name，其次 site_sw_hosts.name）
      const rows = sqlite.prepare(`
        SELECT hs.host_id as id, COALESCE(hs.name, sh.name) as name, hs.ip, hs.port, hs.unit_id as unitId, hs.connected, hs.last_seen as lastSeen
        FROM host_status hs
        LEFT JOIN site_sw_hosts sh ON sh.id = hs.host_id
        WHERE hs.connected = 1
        ORDER BY hs.host_id
      `).all();
      res.json({ success: true, data: rows.map(r => ({
        id: r.id, name: r.name, ip: r.ip, port: r.port, unitId: r.unitId,
        connected: !!r.connected, lastSeen: r.lastSeen
      })) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.get('/status/slaves/by-host/:hostId', (req, res) => {
    try {
      const { hostId } = req.params;
      const rows = sqlite.prepare(`
        SELECT ss.slave_unit_id as unitId,
               COALESCE(ss.name, s.name) as name,
               ss.connected, ss.enabled, ss.type,
               ss.sw_mask_current as swMaskCurrent, ss.sw_on_count as swOnCount,
               ss.dim_mask_current as dimMaskCurrent, ss.dim_on_count as dimOnCount,
               ss.dim_values_current as dimValuesCurrent,
               ss.updated_at as updatedAt
        FROM slave_status ss
        LEFT JOIN site_sw_slaves s ON s.host_id = ss.host_id AND s.slave_unit_id = ss.slave_unit_id
        WHERE ss.host_id=?
      `).all(hostId);
      res.json({ success: true, data: rows.map(r => ({
        unitId: r.unitId, name: r.name,
        connected: r.connected ? 1 : 0,
        enabled: r.enabled ? 1 : 0,
        type: r.type,
        swMaskCurrent: r.swMaskCurrent ?? null,
        swOnCount: r.swOnCount ?? null,
        dimMaskCurrent: r.dimMaskCurrent ?? null,
        dimOnCount: r.dimOnCount ?? null,
        dimValuesCurrent: r.dimValuesCurrent ? (function(){ try { return JSON.parse(r.dimValuesCurrent) } catch { return [0,0,0,0] } })() : null,
        updatedAt: r.updatedAt
      })) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // 主動輪詢一次，先更新 DB 再回傳（讀前先寫表）
  router.post('/status/poll', async (req, res) => {
    try {
      const events = [];
      const t = now();
      // 以 multi 當前已註冊 hosts 為掃描來源
      for (const [hostId, item] of multi.hosts.entries()) {
        // 更新 host_status（合併後欄位）
        try {
          // 同步名稱自 site_sw_hosts（若有）
          let hostName = null; try { hostName = sqlite.prepare(`SELECT name FROM site_sw_hosts WHERE id=?`).get(hostId)?.name || null } catch {}
          sqlite.prepare(`UPDATE host_status SET connected=?, last_seen=?, name=COALESCE(?, name) WHERE host_id=?`).run(item?.connected ? 1 : 0, t, hostName, hostId);
          events.push({
            hostId,
            target: 'host',
            action: 'read',
            ok: true,
            db: { table: 'host_status', op: 'update', columns: ['connected','last_seen','name'], values: { connected: item?.connected ? 1 : 0, last_seen: t, name: hostName }, where: `host_id='${hostId}'` }
          });
        } catch {}
  // 同步到 site_sw_hosts（若存在對應 host 紀錄，依名稱或 id 對應可再強化；此處以同 id）
        try {
          sqlite.prepare(`UPDATE site_sw_hosts SET connected=?, last_seen=? WHERE id=?`).run(item?.connected ? 1 : 0, t, hostId);
          events.push({
            hostId,
            target: 'host',
            action: 'read',
            ok: true,
            db: { table: 'site_sw_hosts', op: 'update', columns: ['connected','last_seen'], values: { connected: item?.connected ? 1 : 0, last_seen: t }, where: `id='${hostId}'` }
          });
        } catch {}
        if (!item?.connected) continue;
        // 如果需要，也可讀一些健康資訊（略）
        // 更新每個 slave 的目前狀態（依 control_map/scan_map 與 address_map 決定掃描內容）
        const scanMap = sqlite.prepare(`SELECT address, slave_unit_id as unitId FROM scan_map ORDER BY address`).all();
        for (const m of scanMap) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const data = await multi.readHoldingRegisters(hostId, m.address, 1);
            const detected = Array.isArray(data) ? (Number(data[0]) === 0) : false;
            // 補充：可選擇同時讀取 SW/DIM 對應位址，更新 sw_mask_current/dim_* 等（此處先標記為未知）
            let slName = null; try { slName = sqlite.prepare(`SELECT name FROM site_sw_slaves WHERE host_id=? AND slave_unit_id=?`).get(hostId, m.unitId)?.name || null } catch {}
            sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, name, connected, updated_at) VALUES (?, ?, COALESCE(?, (SELECT name FROM site_sw_slaves WHERE host_id=? AND slave_unit_id=?)), ?, ? )`).run(hostId, m.unitId, slName, hostId, m.unitId, detected ? 1 : 0, t);
            events.push({
              hostId, slaveAddr: m.unitId, target: 'slave', action: 'read', ok: true,
              modbus: { fc: 0x03, address: m.address, quantity: 1, values: Array.isArray(data) ? data : [] },
              db: { table: 'slave_status', op: 'replace', columns: ['name','connected','updated_at'], values: { name: slName, connected: detected ? 1 : 0, updated_at: t }, where: `host_id='${hostId}' AND slave_unit_id=${m.unitId}` }
            });
            // 同步到 site_sw_slaves（以 host_id + unit 對應）
            try {
              sqlite.prepare(`UPDATE site_sw_slaves SET connected=?, last_seen=? WHERE host_id=? AND slave_unit_id=?`).run(detected ? 1 : 0, t, hostId, m.unitId);
              events.push({ hostId, slaveAddr: m.unitId, target: 'slave', action: 'read', ok: true,
                db: { table: 'site_sw_slaves', op: 'update', columns: ['connected','last_seen'], values: { connected: detected ? 1 : 0, last_seen: t }, where: `host_id='${hostId}' AND slave_unit_id=${m.unitId}` } })
            } catch {}
          } catch {}
        }

  // 依配置（site_sw_slaves）之期望型別，分別讀取 SW8CH 與 DIM 的即時值
  const cfgSlaves = sqlite.prepare(`SELECT slave_unit_id as unitId, desired_type as type FROM site_sw_slaves WHERE host_id=?`).all(hostId);
        for (const sl of cfgSlaves) {
          if (sl.type === 'SL-SW8CH') {
            const map = sqlite.prepare(`SELECT address FROM sw8ch_address_map WHERE unit_id=?`).get(sl.unitId);
            if (!map) continue;
            try {
              // 讀取 1 筆遮罩
              // eslint-disable-next-line no-await-in-loop
              const data = await multi.readHoldingRegisters(hostId, map.address, 1);
              const mask = Array.isArray(data) ? (Number(data[0]) & 0xFF) : null;
              if (mask != null) {
                const count = ((x)=>{x&=0xFF; x=(x&0x55)+((x>>1)&0x55); x=(x&0x33)+((x>>2)&0x33); x=(x&0x0F)+((x>>4)&0x0F); return x;})(mask);
                sqlite.prepare(`UPDATE slave_status SET sw_mask_current=?, sw_on_count=?, updated_at=? WHERE host_id=? AND slave_unit_id=?`).run(mask, count, t, hostId, sl.unitId);
                events.push({
                  hostId, slaveAddr: sl.unitId, target: 'slave', action: 'read', ok: true,
                  modbus: { fc: 0x03, address: map.address, quantity: 1, values: Array.isArray(data)? data : [] },
                  db: { table: 'slave_status', op: 'update', columns: ['sw_mask_current','sw_on_count','updated_at'], values: { sw_mask_current: mask, sw_on_count: count, updated_at: t }, where: `host_id='${hostId}' AND slave_unit_id=${sl.unitId}` }
                });
                try {
                  sqlite.prepare(`UPDATE site_sw_slaves SET connected=1, last_seen=? WHERE host_id=? AND slave_unit_id=?`).run(t, hostId, sl.unitId);
                  events.push({ hostId, slaveAddr: sl.unitId, target: 'slave', action: 'read', ok: true,
                    db: { table: 'site_sw_slaves', op: 'update', columns: ['connected','last_seen'], values: { connected: 1, last_seen: t }, where: `host_id='${hostId}' AND slave_unit_id=${sl.unitId}` } })
                } catch {}
              }
            } catch {}
          } else if (sl.type === 'SL-1-10V4CHDIM') {
            const map = sqlite.prepare(`SELECT mask_address, ch1_address, ch2_address, ch3_address, ch4_address FROM dim_address_map WHERE unit_id=?`).get(sl.unitId);
            if (!map) continue;
            try {
              // 讀遮罩
              // eslint-disable-next-line no-await-in-loop
              const mdata = await multi.readHoldingRegisters(hostId, map.mask_address, 1);
              const dmask = Array.isArray(mdata) ? (Number(mdata[0]) & 0x0F) : null;
              // 逐一路讀取 ch1~ch4（依表格位址，不假設連續）
              const regs = [map.ch1_address, map.ch2_address, map.ch3_address, map.ch4_address];
              const values = [0,0,0,0];
              for (let i = 0; i < 4; i++) {
                const addr = Number(regs[i]);
                if (!Number.isFinite(addr)) continue;
                // eslint-disable-next-line no-await-in-loop
                const rd = await multi.readHoldingRegisters(hostId, addr, 1);
                if (Array.isArray(rd) && rd.length > 0) {
                  const v = Number(rd[0]);
                  values[i] = Math.max(0, Math.min(255, v|0));
                  events.push({ hostId, slaveAddr: sl.unitId, target: 'slave', action: 'read', ok: true, modbus: { fc: 0x03, address: addr, quantity: 1, values: rd } });
                }
              }
              const onCount = values.reduce((a,b)=> a + (b>0?1:0), 0);
              sqlite.prepare(`UPDATE slave_status SET dim_mask_current=?, dim_on_count=?, dim_values_current=?, updated_at=? WHERE host_id=? AND slave_unit_id=?`).run(dmask, onCount, JSON.stringify(values), t, hostId, sl.unitId);
              events.push({
                hostId, slaveAddr: sl.unitId, target: 'slave', action: 'read', ok: true,
                modbus: { fc: 0x03, address: map.mask_address, quantity: 1, values: Array.isArray(mdata)? mdata : [] },
                db: { table: 'slave_status', op: 'update', columns: ['dim_mask_current','dim_on_count','dim_values_current','updated_at'], values: { dim_mask_current: dmask, dim_on_count: onCount, dim_values_current: values, updated_at: t }, where: `host_id='${hostId}' AND slave_unit_id=${sl.unitId}` }
              });
              try {
                sqlite.prepare(`UPDATE site_sw_slaves SET connected=1, last_seen=? WHERE host_id=? AND slave_unit_id=?`).run(t, hostId, sl.unitId);
                events.push({ hostId, slaveAddr: sl.unitId, target: 'slave', action: 'read', ok: true,
                  db: { table: 'site_sw_slaves', op: 'update', columns: ['connected','last_seen'], values: { connected: 1, last_seen: t }, where: `host_id='${hostId}' AND slave_unit_id=${sl.unitId}` } })
              } catch {}
            } catch {}
          }
        }
      }
      res.json({ success: true, data: events });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Patch by hostId (no siteId required) ----
  router.patch('/by-host/:hostId', (req, res) => {
    try {
      const { hostId } = req.params;
      const { name, enabled, type, ip, port, unitId, serialPath, baudRate, dataBits, parity, stopBits, floor, room, note, sort } = req.body || {};
      const t = now();
      const r = sqlite.prepare(`UPDATE site_sw_hosts SET name=COALESCE(?, name), enabled=COALESCE(?, enabled), type=COALESCE(?, type), ip=COALESCE(?, ip), port=COALESCE(?, port), unit_id=COALESCE(?, unit_id), serial_path=COALESCE(?, serial_path), baud_rate=COALESCE(?, baud_rate), data_bits=COALESCE(?, data_bits), parity=COALESCE(?, parity), stop_bits=COALESCE(?, stop_bits), floor=COALESCE(?, floor), room=COALESCE(?, room), note=COALESCE(?, note), sort=COALESCE(?, sort), updated_at=? WHERE id=?`).run(
        name ?? null, (enabled===undefined? null : (enabled?1:0)), type ?? null, ip ?? null, port ?? null, unitId ?? null, serialPath ?? null, baudRate ?? null, dataBits ?? null, parity ?? null, stopBits ?? null, floor ?? null, room ?? null, note ?? null, sort ?? null, t, hostId);
      // sync host_status name/ip/port/unit
      try {
        sqlite.prepare(`UPDATE host_status SET name=COALESCE(?, name), ip=COALESCE(?, ip), port=COALESCE(?, port), unit_id=COALESCE(?, unit_id) WHERE host_id=?`).run(name ?? null, ip ?? null, port ?? null, unitId ?? null, hostId);
      } catch {}
      if (!r.changes) return res.status(404).json({ success: false, message: 'Host 不存在' });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Patch slave by (hostId + unitId) ----
  router.patch('/by-host/:hostId/slaves/by-unit/:unitId', (req, res) => {
    try {
      const { hostId } = req.params; let { unitId } = req.params; unitId = Number(unitId);
      const { name, newUnitId, enabled, type, swMask, dimMask, dimValues, floor, room, note, sort } = req.body || {};
      const nextUnit = (req.body && req.body.unitId != null) ? Number(req.body.unitId) : (newUnitId != null ? Number(newUnitId) : undefined);
      const t = now();
      const row = sqlite.prepare(`SELECT id, slave_unit_id FROM site_sw_slaves WHERE host_id=? AND slave_unit_id=?`).get(hostId, unitId);
      if (!row) return res.status(404).json({ success: false, message: '找不到從機（hostId + unitId）' });
      // 防重複 unitId
      if (nextUnit != null && Number.isFinite(nextUnit)) {
        const dup = sqlite.prepare(`SELECT 1 FROM site_sw_slaves WHERE host_id=? AND slave_unit_id=?`).get(hostId, nextUnit);
        if (dup) return res.status(409).json({ success: false, message: '站號重複（同主機內不可重複）' });
      }
      sqlite.prepare(`UPDATE site_sw_slaves SET name=COALESCE(?, name), slave_unit_id=COALESCE(?, slave_unit_id), desired_enabled=COALESCE(?, desired_enabled), desired_type=COALESCE(?, desired_type), sw_mask=COALESCE(?, sw_mask), dim_mask=COALESCE(?, dim_mask), dim_values=COALESCE(?, dim_values), floor=COALESCE(?, floor), room=COALESCE(?, room), note=COALESCE(?, note), sort=COALESCE(?, sort), updated_at=? WHERE id=? AND host_id=?`)
        .run(name ?? null, nextUnit ?? null, (enabled===undefined? null : (enabled?1:0)), type ?? null, swMask ?? null, dimMask ?? null, (dimValues===undefined? null : JSON.stringify(Array.isArray(dimValues)? dimValues.slice(0,4): [0,0,0,0])), floor ?? null, room ?? null, note ?? null, sort ?? null, t, row.id, hostId);
      // 同步 slave_status：更新 name；若變更 unitId，搬移 key
      try {
        if (nextUnit != null && Number.isFinite(nextUnit) && nextUnit !== unitId) {
          // 移動紀錄：先刪舊，再更新新 key（保留狀態欄位）
          const cur = sqlite.prepare(`SELECT * FROM slave_status WHERE host_id=? AND slave_unit_id=?`).get(hostId, unitId);
          if (cur) {
            sqlite.prepare(`DELETE FROM slave_status WHERE host_id=? AND slave_unit_id=?`).run(hostId, unitId);
            // 插入新 key
            sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, name, connected, enabled, type, sw_mask_current, sw_on_count, dim_mask_current, dim_on_count, dim_values_current, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? )`)
              .run(hostId, nextUnit, name ?? cur.name ?? null, cur.connected ?? null, cur.enabled ?? null, cur.type ?? null, cur.sw_mask_current ?? null, cur.sw_on_count ?? null, cur.dim_mask_current ?? null, cur.dim_on_count ?? null, cur.dim_values_current ?? null, t);
          } else {
            sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, name, updated_at) VALUES (?, ?, ?, ? )`).run(hostId, nextUnit, name ?? null, t);
          }
          // 嘗試同步位址對映表（若存在）
          try { sqlite.prepare(`UPDATE sw8ch_address_map SET unit_id=? WHERE unit_id=?`).run(nextUnit, unitId) } catch {}
          try { sqlite.prepare(`UPDATE dim_address_map SET unit_id=? WHERE unit_id=?`).run(nextUnit, unitId) } catch {}
        } else {
          sqlite.prepare(`UPDATE slave_status SET name=COALESCE(?, name), updated_at=COALESCE(?, updated_at) WHERE host_id=? AND slave_unit_id=?`).run(name ?? null, t, hostId, unitId);
        }
      } catch {}
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Global scan & control ----
  router.post('/slaves/scan', async (req, res) => {
    try {
      const scanMap = sqlite.prepare(`SELECT address, slave_unit_id as unitId FROM scan_map ORDER BY address`).all();
      const results = [];
      for (const [id, item] of multi.hosts.entries()) {
        if (!item?.connected) continue;
        for (const m of scanMap) {
          try {
            // 讀 1 筆，值=0 視為偵測到
            // eslint-disable-next-line no-await-in-loop
            const data = await multi.readHoldingRegisters(id, m.address, 1);
            const detected = Array.isArray(data) ? (Number(data[0]) === 0) : false;
            const t = now();
            sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, connected, updated_at) VALUES (?, ?, ?, ? )`).run(id, m.unitId, detected ? 1 : 0, t);
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

  router.post('/slaves/:hostId/:unitId/enabled', async (req, res) => {
    try {
      const { hostId, unitId } = req.params; const { enabled } = req.body || {};
      // 先寫配置（desired_enabled）
  sqlite.prepare(`UPDATE site_sw_slaves SET desired_enabled=? WHERE host_id=? AND slave_unit_id=?`).run(enabled ? 1 : 0, hostId, Number(unitId));
      const map = sqlite.prepare(`SELECT reg_addr FROM control_map WHERE slave_unit_id=?`).get(Number(unitId));
      if (!map) return res.status(404).json({ success: false, message: '找不到控制對映 reg_addr' });
      const cur = getStatus(sqlite, hostId, Number(unitId));
      // 僅在現況不同於 desired 才下 modbus
      if (!!cur.enabled === !!enabled) {
        sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, enabled, type, updated_at) VALUES (?, ?, ?, ?, ? )`).run(hostId, Number(unitId), enabled ? 1 : 0, cur.type, now());
        return res.json({ success: true, message: '狀態未變更，已更新資料表' });
      }
      const high = (enabled ? 0 : 1) & 0xFF;
      const low = cur.type === 'SL-1-10V4CHDIM' ? 2 : 1;
      const value = (high << 8) | low;
      await multi.writeSingleRegister(hostId, map.reg_addr, value);
      sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, enabled, type, updated_at) VALUES (?, ?, ?, ?, ? )`).run(hostId, Number(unitId), enabled ? 1 : 0, cur.type, now());
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  router.post('/slaves/:hostId/:unitId/type', async (req, res) => {
    try {
      const { hostId, unitId } = req.params; const { type } = req.body || {};
      if (type !== 'SL-SW8CH' && type !== 'SL-1-10V4CHDIM') return res.status(400).json({ success: false, message: 'type 不合法' });
      // 先寫配置（desired_type）
  sqlite.prepare(`UPDATE site_sw_slaves SET desired_type=? WHERE host_id=? AND slave_unit_id=?`).run(type, hostId, Number(unitId));
      const map = sqlite.prepare(`SELECT reg_addr FROM control_map WHERE slave_unit_id=?`).get(Number(unitId));
      if (!map) return res.status(404).json({ success: false, message: '找不到控制對映 reg_addr' });
      const cur = getStatus(sqlite, hostId, Number(unitId));
      if (cur.type === type) {
        sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, enabled, type, updated_at) VALUES (?, ?, ?, ?, ? )`).run(hostId, Number(unitId), cur.enabled ? 1 : 0, type, now());
        return res.json({ success: true, message: '型別未變更，已更新資料表' });
      }
      const high = (cur.enabled ? 0 : 1) & 0xFF;
      const low = type === 'SL-1-10V4CHDIM' ? 2 : 1;
      const value = (high << 8) | low;
      await multi.writeSingleRegister(hostId, map.reg_addr, value);
      sqlite.prepare(`REPLACE INTO slave_status (host_id, slave_unit_id, enabled, type, updated_at) VALUES (?, ?, ?, ?, ? )`).run(hostId, Number(unitId), cur.enabled ? 1 : 0, type, now());
      res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // ---- Helpers ----
  function getSiteName(sqlite, siteId) {
    const row = sqlite.prepare(`SELECT name FROM sites WHERE id=?`).get(siteId);
    return row?.name || '';
  }

  function buildSnapshot(sqlite, siteId) {
    const site = sqlite.prepare(`SELECT name, description FROM sites WHERE id=?`).get(siteId) || { name: '', description: '' };
  const hosts = sqlite.prepare(`SELECT * FROM site_sw_hosts WHERE site_id=? ORDER BY COALESCE(sort, created_at)`).all(siteId);
  const slavesStmt = sqlite.prepare(`SELECT * FROM site_sw_slaves WHERE host_id=? ORDER BY COALESCE(sort, created_at)`);
    return {
      name: site.name,
      description: site.description,
      hosts: hosts.map((h, idx) => ({
        name: h.name,
        enabled: (h.enabled==null? true : !!h.enabled),
        type: h.type || null,
        ip: h.ip,
        port: h.port,
        unitId: h.unit_id,
        serialPath: h.serial_path,
        baudRate: h.baud_rate,
        dataBits: h.data_bits,
        parity: h.parity,
        stopBits: h.stop_bits,
        floor: h.floor,
        room: h.room,
        note: h.note,
        sort: idx,
          slaves: slavesStmt.all(h.id).map((sl, j) => {
            let dimVals = [0,0,0,0];
            if (sl.dim_values != null) {
              try {
                const parsed = JSON.parse(sl.dim_values);
                if (Array.isArray(parsed)) {
                  const arr = parsed.slice(0,4).map(v=>Number.isFinite(Number(v))? Math.max(0, Math.min(255, Number(v)|0)) : 0);
                  while (arr.length < 4) arr.push(0);
                  dimVals = arr;
                }
              } catch {}
            }
            return ({
              name: sl.name, unitId: sl.slave_unit_id, type: sl.desired_type, enabled: sl.desired_enabled ? true : false,
              swMask: sl.sw_mask ?? 0, dimMask: sl.dim_mask ?? 0, dimValues: dimVals,
              floor: sl.floor, room: sl.room, note: sl.note, sort: j
            })
          })
      }))
    };
  }

  function applySnapshotToDb(sqlite, siteId, snap, opts) {
    const prune = !!opts?.prune;
    const t = now();
    sqlite.prepare(`UPDATE sites SET name=?, description=?, updated_at=? WHERE id=?`).run(snap.name || getSiteName(sqlite, siteId), snap.description || '', t, siteId);
    // Hosts by name
  const existingHosts = sqlite.prepare(`SELECT * FROM site_sw_hosts WHERE site_id=?`).all(siteId);
    const byName = new Map(existingHosts.map(h => [h.name, h]));
    const keptHostIds = new Set();
    for (const [idx, h] of (snap.hosts || []).entries()) {
      const exists = byName.get(h.name);
      if (exists) {
        sqlite.prepare(`UPDATE site_sw_hosts SET enabled=COALESCE(?, enabled), type=COALESCE(?, type), ip=?, port=?, unit_id=?, serial_path=COALESCE(?, serial_path), baud_rate=COALESCE(?, baud_rate), data_bits=COALESCE(?, data_bits), parity=COALESCE(?, parity), stop_bits=COALESCE(?, stop_bits), floor=COALESCE(?, floor), room=COALESCE(?, room), note=COALESCE(?, note), sort=?, updated_at=? WHERE id=?`).run(
          (h.enabled===undefined? null : (h.enabled?1:0)), h.type ?? null, h.ip || null, h.port || null, h.unitId || null,
          h.serialPath ?? null, h.baudRate ?? null, h.dataBits ?? null, h.parity ?? null, h.stopBits ?? null,
          h.floor ?? null, h.room ?? null, h.note ?? null, idx, t, exists.id);
        keptHostIds.add(exists.id);
        // Slaves by name
        const exSlaves = sqlite.prepare(`SELECT * FROM site_sw_slaves WHERE host_id=?`).all(exists.id);
        const slByName = new Map(exSlaves.map(s => [s.name, s]));
        const keptSlIds = new Set();
        for (const [j, sl] of (h.slaves || []).entries()) {
          const ex = slByName.get(sl.name);
          if (ex) {
            sqlite.prepare(`UPDATE site_sw_slaves SET slave_unit_id=?, desired_enabled=?, desired_type=?, sw_mask=?, dim_mask=?, dim_values=?, floor=COALESCE(?, floor), room=COALESCE(?, room), note=COALESCE(?, note), sort=?, updated_at=? WHERE id=?`)
              .run(sl.unitId || null, (sl.enabled?1:0), sl.type || null, sl.swMask ?? 0, sl.dimMask ?? 0, JSON.stringify(Array.isArray(sl.dimValues)? sl.dimValues.slice(0,4) : [0,0,0,0]), sl.floor ?? null, sl.room ?? null, sl.note ?? null, j, t, ex.id);
            keptSlIds.add(ex.id);
          } else {
            const newId = rid();
            sqlite.prepare(`INSERT INTO site_sw_slaves (id, host_id, name, slave_unit_id, desired_enabled, desired_type, sw_mask, dim_mask, dim_values, floor, room, note, sort, created_at, updated_at, connected, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(newId, exists.id, sl.name, sl.unitId || null, (sl.enabled?1:0), sl.type || null, sl.swMask ?? 0, sl.dimMask ?? 0, JSON.stringify(Array.isArray(sl.dimValues)? sl.dimValues.slice(0,4) : [0,0,0,0]), sl.floor ?? null, sl.room ?? null, sl.note ?? null, j, t, t, 0, null);
            keptSlIds.add(newId);
          }
        }
        if (prune) {
          for (const s of exSlaves) { if (!keptSlIds.has(s.id)) sqlite.prepare(`DELETE FROM site_sw_slaves WHERE id=?`).run(s.id); }
        }
      } else {
        const newH = { id: rid() };
        sqlite.prepare(`INSERT INTO site_sw_hosts (id, site_id, name, enabled, type, ip, port, unit_id, serial_path, baud_rate, data_bits, parity, stop_bits, floor, room, note, sort, created_at, updated_at, connected, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(newH.id, siteId, h.name, (h.enabled===undefined?1:(h.enabled?1:0)), h.type || null, h.ip || null, h.port || null, h.unitId || null, h.serialPath ?? null, h.baudRate ?? null, h.dataBits ?? null, h.parity ?? null, h.stopBits ?? null, h.floor ?? null, h.room ?? null, h.note ?? null, idx, t, t, 0, null);
        keptHostIds.add(newH.id);
        for (const [j, sl] of (h.slaves || []).entries()) {
          sqlite.prepare(`INSERT INTO site_sw_slaves (id, host_id, name, slave_unit_id, desired_enabled, desired_type, sw_mask, dim_mask, dim_values, floor, room, note, sort, created_at, updated_at, connected, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(rid(), newH.id, sl.name, sl.unitId || null, (sl.enabled?1:0), sl.type || null, sl.swMask ?? 0, sl.dimMask ?? 0, JSON.stringify(Array.isArray(sl.dimValues)? sl.dimValues.slice(0,4): [0,0,0,0]), sl.floor ?? null, sl.room ?? null, sl.note ?? null, j, t, t, 0, null);
        }
      }
    }
    if (prune) {
      for (const h of existingHosts) { if (!keptHostIds.has(h.id)) sqlite.prepare(`DELETE FROM site_sw_hosts WHERE id=?`).run(h.id); }
    }
  }

  return router;
};
