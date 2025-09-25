const express = require('express');

module.exports = function createMultiHostRoutes(multiHostManager) {
    const router = express.Router();

    router.post('/connect', async (req, res) => {
        try {
            const { id, ip, port, unitId } = req.body || {};
            const result = await multiHostManager.connectHost({ id, ip, port, unitId });
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/disconnect', async (req, res) => {
        try {
            const { id } = req.body || {};
            const result = await multiHostManager.disconnectHost(id);
            res.json(result);
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.get('/status', (req, res) => {
        res.json({ success: true, data: multiHostManager.getStatuses() });
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

    router.post('/:id/read/holding-registers', async (req, res) => {
        try {
            const { id } = req.params;
            const { address, length } = req.body || {};
            const data = await multiHostManager.readHoldingRegisters(id, address, length);
            res.json({ success: true, data });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    router.post('/:id/write/single-register', async (req, res) => {
        try {
            const { id } = req.params;
            const { address, value } = req.body || {};
            await multiHostManager.writeSingleRegister(id, address, value);
            res.json({ success: true, message: '寫入成功' });
        } catch (error) {
            res.status(500).json({ success: false, message: error.message });
        }
    });

    return router;
};
