// 注意：此檔案僅供相容性使用。實際的後端已整合在 server/src/index.js，
// 並由 Electron main.js 於同一連接埠啟動，API 掛載於 /api。
// 建議使用 `npm run start` 或 `npm run electron-dev` 啟動整合版應用程式。
const express = require('express');
const cors = require('cors');
const path = require('path');
const ModbusRTU = require('modbus-serial');
const WebSocket = require('ws');

const app = express();
const PORT = 5000;

// 中間件
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 單主機功能已移除，僅保留多主機功能

// 多主機連線管理
class MultiHostModbusManager {
    constructor() {
        this.hosts = new Map(); // id -> { client, config, connected }
    }

    _attachClientHandlers(id, client) {
        client.on('error', (error) => {
            console.error(`[${id}] Modbus 客戶端錯誤:`, error.message);
            const item = this.hosts.get(id);
            if (item) {
                item.connected = false;
                item.client = null;
            }
        });
        client.on('close', () => {
            console.log(`[${id}] Modbus 連線已關閉`);
            const item = this.hosts.get(id);
            if (item) {
                item.connected = false;
                item.client = null;
            }
        });
    }

    async connectHost({ id, ip, port, unitId, timeout = 5000 }) {
        if (!id || !ip || !port || !unitId) {
            return { success: false, message: '缺少必要參數 id/ip/port/unitId' };
        }

        // 若已存在舊連線，先關閉
        const existing = this.hosts.get(id);
        if (existing && existing.client) {
            try { existing.client.close(() => {}); } catch {}
        }

        const client = new ModbusRTU();
        try {
            await client.connectTCP(ip, { port });
            client.setID(unitId);
            client.setTimeout(timeout);
            this._attachClientHandlers(id, client);

            this.hosts.set(id, {
                client,
                config: { ip, port, unitId },
                connected: true,
            });

            console.log(`[${id}] 已連線 ${ip}:${port} (ID:${unitId})`);
            return { success: true, message: '連線成功' };
        } catch (error) {
            this.hosts.set(id, {
                client: null,
                config: { ip, port, unitId },
                connected: false,
            });
            console.error(`[${id}] 連線失敗:`, error.message);
            return { success: false, message: `連線失敗: ${error.message}` };
        }
    }

    async disconnectHost(id) {
        const item = this.hosts.get(id);
        if (!item) return { success: true, message: '目標不存在或已斷線' };
        try {
            if (item.client) {
                item.client.close(() => {});
            }
            item.client = null;
            item.connected = false;
            return { success: true, message: '已中斷連線' };
        } catch (error) {
            console.error(`[${id}] 中斷連線錯誤:`, error.message);
            return { success: false, message: error.message };
        }
    }

    getStatuses() {
        const list = [];
        for (const [id, item] of this.hosts.entries()) {
            list.push({ id, connected: !!item?.connected, ...(item?.config || {}) });
        }
        return list;
    }

    _ensureClient(id) {
        const item = this.hosts.get(id);
        if (!item || !item.connected || !item.client) {
            const cfg = item?.config;
            throw new Error(`主機未連線: ${id}${cfg ? ` (${cfg.ip}:${cfg.port})` : ''}`);
        }
        return item.client;
    }

    async readHoldingRegisters(id, address, length) {
        const client = this._ensureClient(id);
        const result = await client.readHoldingRegisters(address, length);
        return result.data;
    }

    async writeSingleRegister(id, address, value) {
        const client = this._ensureClient(id);
        await client.writeRegister(address, value);
        return true;
    }

    async disconnectAll() {
        const tasks = [];
        for (const [id, item] of this.hosts.entries()) {
            try { if (item.client) item.client.close(() => {}); } catch {}
            item.client = null; item.connected = false;
            tasks.push(Promise.resolve());
        }
        await Promise.all(tasks);
    }
}

const multiHostManager = new MultiHostModbusManager();

// API 路由（僅多主機）

// 靜態檔案服務
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// === 多主機 API ===
app.post('/api/hosts/connect', async (req, res) => {
    try {
        const { id, ip, port, unitId } = req.body || {};
        const result = await multiHostManager.connectHost({ id, ip, port, unitId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/hosts/disconnect', async (req, res) => {
    try {
        const { id } = req.body || {};
        const result = await multiHostManager.disconnectHost(id);
        res.json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.get('/api/hosts/status', (req, res) => {
    res.json({ success: true, data: multiHostManager.getStatuses() });
});

// 指定主機的讀取/寫入
app.post('/api/hosts/:id/read/holding-registers', async (req, res) => {
    try {
        const { id } = req.params;
        const { address, length } = req.body || {};
        const data = await multiHostManager.readHoldingRegisters(id, address, length);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

app.post('/api/hosts/:id/write/single-register', async (req, res) => {
    try {
        const { id } = req.params;
        const { address, value } = req.body || {};
        await multiHostManager.writeSingleRegister(id, address, value);
        res.json({ success: true, message: '寫入成功' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 啟動伺服器
app.listen(PORT, () => {
    console.log(`Modbus TCP 工具伺服器運行於 http://localhost:${PORT}`);
});

// 全域錯誤處理
process.on('uncaughtException', (error) => {
    console.error('未捕獲的例外:', error);
    // 保持伺服器運行，必要時在日後擴充集中化告警
    if (error && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
        console.log('Modbus 連線錯誤，但伺服器會繼續運行');
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未處理的 Promise 拒絕:', reason);
    // 不要因為 Modbus 連線問題而崩潰
    if (reason && (reason.code === 'ECONNRESET' || reason.code === 'ETIMEDOUT')) {
        console.log('Modbus Promise 錯誤，但伺服器會繼續運行');
        return;
    }
});

// 優雅關閉
process.on('SIGINT', async () => {
    console.log('\n正在關閉伺服器...');
    await multiHostManager.disconnectAll();
    process.exit(0);
});