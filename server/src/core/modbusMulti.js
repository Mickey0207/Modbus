const ModbusRTU = require('modbus-serial');

class MultiHostModbusManager {
    constructor() {
        this.hosts = new Map();
    }

    _attachClientHandlers(id, client) {
        client.on('error', () => {
            const item = this.hosts.get(id);
            if (item) { item.connected = false; item.client = null; }
        });
        client.on('close', () => {
            const item = this.hosts.get(id);
            if (item) { item.connected = false; item.client = null; }
        });
    }

    async connectHost({ id, ip, port, unitId, timeout = 5000 }) {
        if (!id || !ip || !port || !unitId) return { success: false, message: '缺少必要參數 id/ip/port/unitId' };
        const existing = this.hosts.get(id);
        if (existing?.client) { try { existing.client.close(() => {}); } catch {}
        }
        const client = new ModbusRTU();
        try {
            await client.connectTCP(ip, { port });
            client.setID(unitId);
            client.setTimeout(timeout);
            this._attachClientHandlers(id, client);
            this.hosts.set(id, { client, config: { ip, port, unitId }, connected: true });
            return { success: true, message: '連線成功' };
        } catch (error) {
            this.hosts.set(id, { client: null, config: { ip, port, unitId }, connected: false });
            return { success: false, message: `連線失敗: ${error.message}` };
        }
    }

    async disconnectHost(id) {
        const item = this.hosts.get(id);
        if (!item) return { success: true, message: '目標不存在或已斷線' };
        try {
            if (item.client) item.client.close(() => {});
            item.client = null; item.connected = false;
            return { success: true, message: '已中斷連線' };
        } catch (error) {
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
}

module.exports = { MultiHostModbusManager };
