const express = require('express');

module.exports = function createHostsRoutes(multiHostManager, sqlite) {
    const router = express.Router();

    router.post('/connect', async (req, res) => {
        try {
            const { id, ip, port, unitId } = req.body || {};
            const result = await multiHostManager.connectHost({ id, ip, port, unitId });
            // persist runtime status to DB if available
            if (sqlite) {
                try {
                    const t = Date.now();
                    sqlite.exec?.(`CREATE TABLE IF NOT EXISTS host_status (
                        host_id TEXT PRIMARY KEY,
                        ip TEXT NOT NULL,
                        port INTEGER NOT NULL,
                        unit_id INTEGER NOT NULL,
                        connected INTEGER,
                        last_seen INTEGER,
                        created_at INTEGER
                    )`);
                    // 若該 host 尚未存在於 host_status，插入一筆（使用目前參數作為 config）
                    sqlite.prepare(`INSERT INTO host_status (host_id, ip, port, unit_id, connected, last_seen, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(host_id) DO UPDATE SET ip=excluded.ip, port=excluded.port, unit_id=excluded.unit_id, connected=excluded.connected, last_seen=excluded.last_seen`).run(
                        id, ip, port, unitId, 1, t, Date.now()
                    );
                    // 同步寫回站點主機表（若存在該主機 id）
                    try { sqlite.prepare(`UPDATE site_sw_hosts SET connected=1, last_seen=? WHERE id=?`).run(t, id); } catch {}
                } catch {}
            }
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/disconnect', async (req, res) => {
        try {
            const { id } = req.body || {};
            const result = await multiHostManager.disconnectHost(id);
            if (sqlite) {
                try {
                    const t = Date.now();
                    sqlite.exec?.(`CREATE TABLE IF NOT EXISTS host_status (
                        host_id TEXT PRIMARY KEY,
                        ip TEXT NOT NULL,
                        port INTEGER NOT NULL,
                        unit_id INTEGER NOT NULL,
                        connected INTEGER,
                        last_seen INTEGER,
                        created_at INTEGER
                    )`);
                    sqlite.prepare(`UPDATE host_status SET connected=0, last_seen=? WHERE host_id=?`).run(t, id);
                    // 同步寫回站點主機表（若存在該主機 id）
                    try { sqlite.prepare(`UPDATE site_sw_hosts SET connected=0, last_seen=? WHERE id=?`).run(t, id); } catch {}
                } catch {}
            }
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.get('/status', (req, res) => {
        try {
            const live = multiHostManager.getStatuses?.() || []
            const byId = new Map()
            for (const h of live) byId.set(h.id, { ...h })
            if (sqlite) {
                try {
                    const rows = sqlite.prepare?.(`SELECT host_id as id, ip, port, unit_id as unitId, connected FROM host_status`)?.all?.() || []
                    for (const r of rows) {
                        const cur = byId.get(r.id) || { id: r.id, ip: r.ip, port: r.port, unitId: r.unitId, connected: !!r.connected }
                        // 以 live 為優先，但若 live 沒有該 host，使用 DB 狀態
                        if (!byId.has(r.id)) byId.set(r.id, { ...cur })
                        else byId.set(r.id, { ...cur, ...byId.get(r.id) })
                    }
                } catch {}
            }
            res.json({ success: true, data: Array.from(byId.values()) })
        } catch (e) {
            res.json({ success: true, data: multiHostManager.getStatuses() })
        }
    });

    // 一鍵連線所有已註冊的 hosts（依記憶體中的 config）
    router.post('/connect-all', async (req, res) => {
        const results = [];
        for (const [id, item] of multiHostManager.hosts.entries()) {
            const cfg = item?.config;
            if (!cfg) { results.push({ id, success: false, message: '缺少 config' }); continue; }
            // 逐一連線（依序）
            // 可視需求改為 Promise.all 以併發
            // eslint-disable-next-line no-await-in-loop
            const r = await multiHostManager.connectHost({ id, ip: cfg.ip, port: cfg.port, unitId: cfg.unitId });
            results.push({ id, ...r });
        }
        res.json({ success: true, data: results });
    });

    // 一鍵斷線所有 hosts
    router.post('/disconnect-all', async (req, res) => {
        const results = [];
        for (const [id] of multiHostManager.hosts.entries()) {
            // eslint-disable-next-line no-await-in-loop
            const r = await multiHostManager.disconnectHost(id);
            results.push({ id, ...r });
        }
        res.json({ success: true, data: results });
    });

    // Helper: classify errors into friendly buckets for better diagnostics
    function classifyError(error) {
        const msg = String(error?.message || '').toLowerCase();
        const code = error?.code || error?.errno || '';
        const has = (s) => msg.includes(String(s).toLowerCase());

        if (has('未連線') || has('not connected')) return { http: 409, code: 'NOT_CONNECTED' };
        if (code === 'ETIMEDOUT' || has('timeout') || has('timed out')) return { http: 504, code: 'TIMEOUT' };
        // Common Modbus / device anomalies
        if (has('modbus') || has('exception code') || has('illegal') || has('crc') || has('data length')) {
            return { http: 502, code: 'DEVICE_ERROR' };
        }
        if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH') {
            return { http: 502, code: 'NETWORK_ERROR' };
        }
        return { http: 500, code: 'UNKNOWN_ERROR' };
    }

    router.post('/:id/read/holding-registers', async (req, res) => {
        const { id } = req.params;
        // Parse and validate params early
        const address = Number(req?.body?.address);
        const length = Number(req?.body?.length);

        // Basic validations (Modbus holding registers: 1..125 per spec; address >= 0)
        if (!Number.isFinite(address) || !Number.isFinite(length) || address < 0 || length < 1 || length > 125) {
            return res.status(400).json({
                success: false,
                message: '參數錯誤：address 必須 >= 0，length 必須介於 1..125',
                error: { code: 'INVALID_PARAMS', details: { id, address, length } },
            });
        }

        // Fast-path check for connection state to give clearer error than generic 500
        const item = multiHostManager.hosts?.get?.(id);
        if (!item || !item.connected || !item.client) {
            const cfg = item?.config;
            return res.status(409).json({
                success: false,
                message: `主機未連線: ${id}${cfg ? ` (${cfg.ip}:${cfg.port})` : ''}`,
                error: { code: 'NOT_CONNECTED', details: { id } },
            });
        }

        try {
            const data = await multiHostManager.readHoldingRegisters(id, address, length);
            return res.json({ success: true, data });
        } catch (error) {
            const kind = classifyError(error);
            return res.status(kind.http).json({
                success: false,
                message: error?.message || '讀取失敗',
                error: { code: kind.code, details: { id, address, length } },
            });
        }
    });

    // 已移除 0x04 輸入暫存器端點，僅保留 0x03

    router.post('/:id/write/single-register', async (req, res) => {
        const { id } = req.params;
        const address = Number(req?.body?.address);
        const value = Number(req?.body?.value);

        if (!Number.isFinite(address) || address < 0) {
            return res.status(400).json({ success: false, message: '參數錯誤：address 必須 >= 0', error: { code: 'INVALID_PARAMS', details: { id, address, value } } });
        }
        if (!Number.isFinite(value) || value < 0 || value > 0xFFFF) {
            return res.status(400).json({ success: false, message: '參數錯誤：value 必須為 0..65535 的整數', error: { code: 'INVALID_PARAMS', details: { id, address, value } } });
        }

        const item = multiHostManager.hosts?.get?.(id);
        if (!item || !item.connected || !item.client) {
            const cfg = item?.config;
            return res.status(409).json({ success: false, message: `主機未連線: ${id}${cfg ? ` (${cfg.ip}:${cfg.port})` : ''}`, error: { code: 'NOT_CONNECTED', details: { id } } });
        }

        try {
            await multiHostManager.writeSingleRegister(id, address, value);
            return res.json({ success: true, message: '寫入成功' });
        } catch (error) {
            const kind = classifyError(error);
            return res.status(kind.http).json({ success: false, message: error?.message || '寫入失敗', error: { code: kind.code, details: { id, address, value } } });
        }
    });

    return router;
};
