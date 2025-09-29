const path = require('path');
const express = require('express');
const cors = require('cors');
const { MultiHostModbusManager } = require('./core/modbus/manager');
const { resolveDbPath } = require('./db/config');
const createHostsRoutes = require('./api/hosts/routes');
const createRegistryRoutes = require('./api/hosts/registry.routes');
const createPortScanRoutes = require('./api/network/portscan.routes');
const createSerialSpyRoutes = require('./api/serial/serialspy.routes');
const createTcpProbeRoutes = require('./api/network/tcpprobe.routes');
const createMappingRoutes = require('./api/modbus/mapping.routes');
const createSitesRoutes = require('./api/sites/sites.routes');
const createSlavesRoutes = require('./api/slaves/slaves.routes');
// DB（可透過環境變數關閉）
let sqlite = null;
if (process.env.DISABLE_DB === '1') {
    console.warn('已停用 DB（DISABLE_DB=1），將以記憶體模式運作');
} else {
    try {
    ({ sqlite } = require('./db'));
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
// API 伺服器預設埠：5002（可由環境變數 PORT 或 modbus.config.json 覆蓋）
const PORT = process.env.PORT || cfg?.server?.port || 5002;

function createServer() {
    const app = express();

    app.use(cors());
    app.use(express.json());
    // 服務前端靜態檔（預設 fronted/dist，若不存在則退回 public）
    const frontedDist = path.join(__dirname, '..', '..', 'fronted', 'dist');
    const legacyPublic = path.join(__dirname, '..', '..', 'public');
    if (require('fs').existsSync(frontedDist)) {
        app.use(express.static(frontedDist));
    } else {
        app.use(express.static(legacyPublic));
    }

    const multi = new MultiHostModbusManager();
    // 若啟用 DB，僅從 DB 載入 hosts，避免與檔案配置或記憶體殘留造成重複
    if (sqlite) {
        try {
            // Runtime registry: host_status is the canonical table (config + status)
            sqlite.exec?.(`CREATE TABLE IF NOT EXISTS host_status (
                host_id TEXT PRIMARY KEY,
                ip TEXT NOT NULL,
                port INTEGER NOT NULL,
                unit_id INTEGER NOT NULL,
                connected INTEGER,
                last_seen INTEGER,
                created_at INTEGER
            )`);
            // 啟動時清除從機狀態資料並重置連線欄位（保留 host_status 作為註冊清單）
            try { sqlite.exec?.(`DELETE FROM slave_status;`); } catch {}
            try { sqlite.exec?.(`UPDATE host_status SET connected=0, last_seen=NULL;`); } catch {}
            try { sqlite.exec?.(`UPDATE site_sw_hosts SET connected=0, last_seen=NULL;`); } catch {}
            try { sqlite.exec?.(`UPDATE site_sw_slaves SET connected=0, last_seen=NULL;`); } catch {}
            // One-time migration: if legacy hosts exists, upsert into host_status; if legacy host_status exists without ip/port/unit_id, try best-effort merge
            try {
                const hasTable = (name) => !!sqlite.prepare?.(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
                if (hasTable('hosts')) {
                    const rows = sqlite.prepare(`SELECT id, ip, port, unit_id, connected, last_seen, created_at FROM hosts`).all();
                    const upsert = sqlite.prepare(`INSERT INTO host_status (host_id, ip, port, unit_id, connected, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
                        ON CONFLICT(host_id) DO UPDATE SET ip=excluded.ip, port=excluded.port, unit_id=excluded.unit_id, connected=excluded.connected, last_seen=excluded.last_seen`);
                    const tx = sqlite.transaction((arr)=>{ for (const r of arr) upsert.run(r.id, r.ip, r.port, r.unit_id, r.connected ?? 0, r.last_seen ?? null, r.created_at ?? Date.now()) });
                    tx(rows);
                }
            } catch {}
            const stmt = sqlite.prepare?.(`SELECT host_id as id, ip, port, unit_id as unitId FROM host_status`);
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
    } else {
        // 無 DB 模式下可選擇從檔案預載
        if (Array.isArray(cfg.hosts)) {
            for (const h of cfg.hosts) {
                multi.hosts.set(h.id, { client: null, config: { ip: h.ip, port: h.port, unitId: h.unitId }, connected: false });
            }
        }
    }
    app.use('/api/hosts', createHostsRoutes(multi, sqlite));
    app.use('/api/registry', createRegistryRoutes(multi, sqlite));
    app.use('/api/portscan', createPortScanRoutes());
    app.use('/api/serialspy', createSerialSpyRoutes());
    app.use('/api/tcpprobe', createTcpProbeRoutes());
    // Modbus 位址對照表（SW8CH / DIM）
    if (sqlite) {
        app.use('/api/modbus/mapping', createMappingRoutes(sqlite));
        app.use('/api/sites', createSitesRoutes(sqlite, multi));
    }
    // read-only 的即時狀態改由 /api/sites/status 提供（需 DB）；
    // 若需無 DB 模式下的簡易狀態，可再行補掛對應端點。
    app.use('/api/slaves', createSlavesRoutes(sqlite, multi));

    // 清理：關閉伺服器前自動清空主/從機狀態資料
    let cleaned = false;
    const cleanup = () => {
        if (cleaned) return; cleaned = true;
        if (!sqlite) return;
        try {
            sqlite.exec?.(`PRAGMA foreign_keys = ON;`);
            // 清空從機狀態，並將連線欄位重置
            try { sqlite.exec?.(`DELETE FROM slave_status;`); } catch {}
            try { sqlite.exec?.(`UPDATE host_status SET connected=0, last_seen=NULL;`); } catch {}
            // 將站點的即時狀態欄位重置
            try { sqlite.exec?.(`UPDATE site_sw_hosts SET connected=0, last_seen=NULL;`); } catch {}
            try { sqlite.exec?.(`UPDATE site_sw_slaves SET connected=0, last_seen=NULL;`); } catch {}
        } catch (e) {
            console.warn('cleanup failed:', e?.message || e);
        }
    };
    process.on('SIGINT', () => { cleanup(); process.exit(0); });
    process.on('SIGTERM', () => { cleanup(); process.exit(0); });
    process.on('exit', () => { cleanup(); });

    // 健康檢查與 DB 狀態
    app.get('/api/health', (req, res) => {
        const dbPath = resolveDbPath();
        const dbExists = require('fs').existsSync(dbPath);
        res.json({
            ok: true,
            port: PORT,
            db: {
                enabled: !!sqlite,
                path: dbPath,
                exists: dbExists
            },
            hostsCount: multi.hosts.size
        });
    });

    app.get('*', (req, res) => {
        if (require('fs').existsSync(frontedDist)) {
            res.sendFile(path.join(frontedDist, 'index.html'));
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
