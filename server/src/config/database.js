const path = require('path');
const fs = require('fs');

/**
 * 資料庫配置
 * 在 Electron 打包環境下，將 DB 存放到使用者可寫入的 userData 目錄
 */
function resolveDbPath() {
	try {
		// 檢測是否在 Electron 主程序
		const isElectron = !!process.versions.electron;
		if (isElectron) {
			// 動態載入 electron 避免在純 Node 環境報錯
			const { app } = require('electron');
			const userData = app.getPath('userData');
			return path.join(userData, 'data', 'modbus.sqlite');
		}
	} catch {}
	// 一般 Node 環境（開發模式）
	return path.join(__dirname, '..', '..', 'data', 'modbus.sqlite');
}

/**
 * 確保資料庫目錄存在
 */
function ensureDbDirectory(dbPath) {
	const dataDir = path.dirname(dbPath);
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}
}

module.exports = {
	resolveDbPath,
	ensureDbDirectory
};