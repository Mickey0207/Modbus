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
  // 與 drizzle.config.ts、打包 extraResources 對齊：使用 server/data/modbus.sqlite
  const preferred = path.join(__dirname, '..', '..', 'data', 'modbus.sqlite');
  const legacy = path.join(__dirname, '..', 'data', 'modbus.sqlite'); // 舊路徑：server/src/data
  try {
    // 若舊檔已存在且新路徑不存在，沿用舊檔避免資料遺失
    if (!fs.existsSync(preferred) && fs.existsSync(legacy)) {
      console.warn('[db] 偵測到舊版 DB 路徑 server/src/data/modbus.sqlite，將暫時沿用該檔案。建議將檔案移到 server/data 以統一路徑。');
      return legacy;
    }
  } catch {}
  return preferred;
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
