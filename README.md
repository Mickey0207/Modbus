# Modbus TCP 工具

一個基於網頁的 Modbus TCP 客戶端工具，提供直觀的操作介面來與 Modbus TCP 設備通訊。

## 重構中的新結構（React + SCSS）

- server/: 模組化 Express API（single/multi-host）。
- client/: React + Vite 前端（單一全域 SCSS）。
- public/: 既有的舊版網頁（仍可使用）。

### 快速開始（Web 開發）

1. 安裝 client 依賴
  npm install --prefix ./client
2. 啟動後端
  npm run server:dev
3. 啟動前端
  npm run client
或一次啟動（同時開啟前後端）
  npm run web:dev

預設連接埠：前端 5173，後端 5000。

### 設定檔（根目錄 modbus.config.json）

示例：

{
  "server": { "port": 5000 },
  "client": { "devUrl": "http://localhost:5173" },
  "hosts": [
    { "id": "PLC-A", "ip": "192.168.1.10", "port": 502, "unitId": 1 },
    { "id": "PLC-B", "ip": "192.168.1.11", "port": 502, "unitId": 1 }
  ]
}

說明：
- server.port：後端 Express 監聽埠（server/src/index.js 與 Electron main.js 均會讀取）
- client.devUrl：開發時若要讓 Electron 直接載入 Vite 前端，可改 main.js 對應行（已標註）
- hosts：預載入的主機清單（只建立於記憶體，不會自動連線）

### 舊版 Electron

- 開發模式
  npm run electron-dev
- 一般模式
  npm run electron

### 打包應用程式（Electron）

  npm run build-win    # Windows
  npm run build-mac    # macOS
  npm run build-linux  # Linux
