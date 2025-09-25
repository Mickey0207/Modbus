const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// 開發模式下啟用熱重載
if (process.env.NODE_ENV === 'development') {
    try {
        require('electron-reload')(__dirname, {
            electron: require.resolve('electron'),
            hardResetMethod: 'exit',
            ignore: [
                /node_modules|[\/\\]\./,
                /dist/
            ]
        });
        console.log('熱重載已啟用');
    } catch (error) {
        console.log('熱重載啟用失敗，但不影響正常運行:', error.message);
    }
}

// 使用既有的後端（server/src/index.js）在同一個連接埠提供前端與 /api
let server; // 將在 app.whenReady() 後啟動

// Electron 應用程式設定
function createWindow() {
    // 建立瀏覽器視窗
    const mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'assets/icon.png'), // 如果有圖示的話
        title: 'Modbus TCP 工具'
    });

    // 移除預設選單
    Menu.setApplicationMenu(null);

    // 載入應用程式
    // 若你想讓 Electron 在開發時直接開 Vite 前端，可改為下列：
    // mainWindow.loadURL(cfg?.client?.devUrl || 'http://localhost:5173')
    // 目前維持載入本地 Express 提供的頁面（單一連接埠，API 於 /api）
    if (server) {
        const addressInfo = server.address();
        const port = typeof addressInfo === 'object' ? addressInfo.port : 0;
        mainWindow.loadURL(`http://localhost:${port}`);
    } else {
        // 後端尚未啟動，退回載入本地靜態頁（若存在）
        const fallback = path.join(__dirname, 'public', 'index.html');
        if (fs.existsSync(fallback)) {
            mainWindow.loadFile(fallback);
        }
    }

    // 開發模式下開啟開發者工具
    if (process.env.NODE_ENV === 'development') {
        mainWindow.webContents.openDevTools();
    }

    // 當視窗關閉時的處理
    mainWindow.on('closed', () => {
        app.quit();
    });
}

// Electron 應用程式就緒時
app.whenReady().then(() => {
    // 如需停用 DB，請在啟動前設定環境變數 DISABLE_DB=1（見 package.json scripts: electron-dev:mem）
    // 啟動既有後端（同一連接埠，API 掛載於 /api）
    try {
        const { createServer } = require('./server/src/index.js');
        const started = createServer();
        server = started.server;
        console.log('後端服務已啟動');
        if (server.listening) {
            createWindow();
        } else {
            server.once('listening', () => createWindow());
        }
    } catch (e) {
        console.error('啟動內嵌後端失敗：', e?.message || e);
        // 即使後端失敗也讓應用啟動（載入本地檔案）
        createWindow();
    }

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

// 當所有視窗都關閉時
app.on('window-all-closed', () => {
    // 關閉內嵌 Express 伺服器
    if (server) {
        server.close();
    }

    // 在 macOS 上，除非使用者按 Cmd + Q，否則應用程式通常會保持作用中
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// 全域錯誤處理
process.on('uncaughtException', (error) => {
    console.error('未捕獲的例外:', error);
    if (error && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
        console.log('Modbus 連線錯誤，但應用程式會繼續運行');
        return;
    }
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未處理的 Promise 拒絕:', reason);
    if (reason && (reason.code === 'ECONNRESET' || reason.code === 'ETIMEDOUT')) {
        console.log('Modbus Promise 錯誤，但應用程式會繼續運行');
        return;
    }
});

// 當應用程式即將退出時
app.on('before-quit', async () => {
    console.log('正在關閉應用程式...');
    // 讓後端自行管理連線釋放
});