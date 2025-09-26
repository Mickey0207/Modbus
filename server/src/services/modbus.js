const ModbusRTU = require('modbus-serial');
const net = require('net');

class MultiHostModbusManager {
    constructor() {
        this.hosts = new Map();
        this._tid = 1;
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
            const err = new Error(`主機未連線: ${id}${cfg ? ` (${cfg.ip}:${cfg.port})` : ''}`);
            err.code = 'NOT_CONNECTED';
            throw err;
        }
        return item.client;
    }


    async readHoldingRegisters(id, address, length) {
        const client = this._ensureClient(id);
        try {
            const result = await client.readHoldingRegisters(address, length);
            return result.data;
        } catch (error) {
            const msg = String(error?.message || '').toLowerCase();
            const isDataLen = msg.includes('data length');
            if (isDataLen) {
                try {
                    return await this._rawTcpReadHoldingRegisters(id, address, length, 5000);
                } catch (fallbackErr) {
                    error.message = `readHoldingRegisters 失敗 (id=${id}, address=${address}, length=${length}): ${error.message}；原生TCP後援也失敗：${fallbackErr?.message || fallbackErr}`;
                }
            } else {
                error.message = `readHoldingRegisters 失敗 (id=${id}, address=${address}, length=${length}): ${error.message}`;
            }
            throw error;
        }
    }

    async writeSingleRegister(id, address, value) {
        const client = this._ensureClient(id);
        try {
            await client.writeRegister(address, value);
            return true;
        } catch (error) {
            error.message = `writeSingleRegister 失敗 (id=${id}, address=${address}, value=${value}): ${error.message}`;
            throw error;
        }
    }

    async _rawTcpReadHoldingRegisters(id, address, length, timeoutMs = 5000) {
        const item = this.hosts.get(id);
        if (!item?.config?.ip || !item?.config?.port || !item?.config?.unitId) {
            const err = new Error(`原生TCP後援缺少目標資訊: ${id}`);
            err.code = 'RAW_TCP_CONFIG_MISSING';
            throw err;
        }
        const { ip, port, unitId } = item.config;
        const tid = (this._tid = (this._tid + 1) & 0xFFFF) || 1;
        const qty = length & 0xFFFF;
        const addr = address & 0xFFFF;

        const req = Buffer.alloc(12);
        req.writeUInt16BE(tid, 0);        // Transaction ID
        req.writeUInt16BE(0x0000, 2);     // Protocol ID
        req.writeUInt16BE(0x0006, 4);     // Length (UnitId + PDU length)
        req.writeUInt8(unitId & 0xFF, 6); // Unit ID
        req.writeUInt8(0x03, 7);          // Function
        req.writeUInt16BE(addr, 8);       // Starting address
        req.writeUInt16BE(qty, 10);       // Quantity

        return await new Promise((resolve, reject) => {
            const socket = new net.Socket();
            let timer = null;
            const cleanup = () => { if (timer) clearTimeout(timer); try { socket.destroy(); } catch {} };

            timer = setTimeout(() => { cleanup(); reject(new Error('RAW_TCP_TIMEOUT')); }, Math.max(1, timeoutMs));

            let buf = Buffer.alloc(0);
            socket.on('data', (chunk) => {
                buf = Buffer.concat([buf, chunk]);
                if (buf.length >= 9) {
                    try {
                        const rxTid = buf.readUInt16BE(0);
                        const unit = buf.readUInt8(6);
                        const func = buf.readUInt8(7);
                        if (func === 0x83) {
                            // Exception
                            const ex = buf[8];
                            throw new Error(`Modbus exception code: ${ex}`);
                        }
                        if (func !== 0x03) return; // wait more
                        const byteCount = buf.readUInt8(8);
                        const totalNeeded = 9 + byteCount;
                        if (buf.length < totalNeeded) return; // wait more
                        // 驗證 TID/UnitId（寬鬆驗證：TID 相同，UnitId 匹配）
                        if (rxTid !== tid || unit !== (unitId & 0xFF)) {
                            throw new Error(`RAW_TCP_UNEXPECTED_HEADER (tid=${rxTid}, unit=${unit})`);
                        }
                        // 解析資料
                        const dataBytes = buf.subarray(9, 9 + byteCount);
                        if (dataBytes.length % 2 !== 0) throw new Error('RAW_TCP_ODD_BYTECOUNT');
                        const out = [];
                        for (let i = 0; i < dataBytes.length; i += 2) {
                            out.push(dataBytes.readUInt16BE(i));
                        }
                        cleanup();
                        resolve(out);
                    } catch (e) {
                        cleanup();
                        reject(e);
                    }
                }
            });

            socket.on('error', (e) => { cleanup(); reject(e); });
            socket.on('close', () => {});
            socket.connect({ host: ip, port }, () => {
                socket.write(req);
            });
        });
    }

}

module.exports = { MultiHostModbusManager };
