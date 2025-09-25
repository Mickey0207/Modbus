const path = require('path');
const express = require('express');
const cors = require('cors');
const { MultiHostModbusManager } = require('./core/modbusMulti');
const createMultiHostRoutes = require('./api/multiHostRoutes');
const createHostRegistryRoutes = require('./api/hostRegistryRoutes');
// DB（可透過環境變數關閉）
let sqlite = null;
if (process.env.DISABLE_DB === '1') {
    console.warn('已停用 DB（DISABLE_DB=1），將以記憶體模式運作');
} else {
    try {
        ({ sqlite } = require('./db/client'));
    } catch (e) {
        console.warn('DB 初始化尚未完成，將以記憶體模式運作:', e?.message || e);
    }
}

const fs = require('fs');
const root = path.join(__dirname, '..', '..');
let cfg = { server: { port: 5000 }, hosts: [] };
try {
    const raw = fs.readFileSync(path.join(root, 'modbus.config.json'), 'utf-8');
    cfg = JSON.parse(raw);
} catch {}
const PORT = process.env.PORT || cfg?.server?.port || 5001;

function createServer() {
    const app = express();

    app.use(cors());
    app.use(express.json());
    const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
    const legacyPublic = path.join(__dirname, '..', '..', 'public');
    if (require('fs').existsSync(clientDist)) {
        app.use(express.static(clientDist));
    } else {
        app.use(express.static(legacyPublic));
    }

    const multi = new MultiHostModbusManager();
    // Optional: 預載 hosts
    if (Array.isArray(cfg.hosts)) {
        for (const h of cfg.hosts) {
            multi.hosts.set(h.id, { client: null, config: { ip: h.ip, port: h.port, unitId: h.unitId }, connected: false });
        }
    }
    // 從資料庫載入 hosts（若有 DB）
    if (sqlite) {
        try {
            sqlite.exec?.(`CREATE TABLE IF NOT EXISTS hosts (
                id TEXT PRIMARY KEY,
                ip TEXT NOT NULL,
                port INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                created_at INTEGER
            )`);
            const stmt = sqlite.prepare?.(`SELECT id, ip, port, unit_id as unitId FROM hosts`);
            const rows = stmt?.all?.() || [];
            if (Array.isArray(rows)) {
                for (const h of rows) {
                    if (!multi.hosts.has(h.id)) {
                        multi.hosts.set(h.id, { client: null, config: { ip: h.ip, port: h.port, unitId: h.unitId }, connected: false });
                    }
                }
            }
        } catch (e) {
            console.warn('讀取 DB hosts 失敗:', e?.message || e);
        }
    }
    app.use('/api/hosts', createMultiHostRoutes(multi));
    app.use('/api/registry', createHostRegistryRoutes(multi, sqlite));

    app.get('*', (req, res) => {
        if (require('fs').existsSync(clientDist)) {
            res.sendFile(path.join(clientDist, 'index.html'));
        } else {
            res.sendFile(path.join(legacyPublic, 'index.html'));
        }
    });

    const server = app.listen(PORT, () => {
        console.log(`Server listening on http://localhost:${PORT}`);
    });

    return { app, server };
}

if (require.main === module) {
    createServer();
}

module.exports = { createServer };
