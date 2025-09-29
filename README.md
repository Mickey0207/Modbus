# Modbus TCP 工具（Electron + Web）

本專案支援兩種開發方式：
- Electron（無前端熱載入）
- Web 開發（Vite Dev Server，支援熱載入）

埠號配置：
- 前端（Vite）: http://localhost:5000
- 後端（Express + API）: <http://localhost:5002>

## 快速指令集（PowerShell）

- 一鍵啟動「前端 + 後端 + Drizzle Studio GUI」：

```powershell
npm run web:dev:all
```

Drizzle Studio GUI

```powershell
npm run drizzle:studio
```

說明：
- 啟動 nodemon 監看後端（預設埠 5002）。
- 啟動 Vite 開發伺服器（埠 5001），並經由代理將 /api 轉發到 5002。
- 啟動 Drizzle Studio GUI（自動讀取 drizzle.config.ts，連 server/data/modbus.sqlite）。

- 僅後端（Express）：

```powershell
npm run server
```

- 僅前端（Vite）：

```powershell
# Modbus TCP 工具（Electron + Web）

本專案支援兩種開發方式：

- Electron（無前端熱載入）
- Web 開發（Vite Dev Server，支援熱載入）

埠號配置：

- 前端（Vite）: <http://localhost:5000>
- 後端（Express + API）: <http://localhost:5002>

## 快速指令集（Windows PowerShell）

- 一鍵啟動「前端 + 後端 + Drizzle Studio GUI」

		```powershell
		npm run web:dev:all
		```

		會同時：
    - 啟動 nodemon 監看後端（預設埠 5002）。
    - 啟動 Vite 開發伺服器（埠 5001），並將 /api 代理到 5002。
		- 啟動 Drizzle Studio GUI（讀 drizzle.config.ts，連 server/data/modbus.sqlite）。

- 僅啟動後端（Express）

		```powershell
		npm run server
		```

# Modbus TCP 工具（Electron + Web）
- 僅啟動前端（Vite）

		```powershell

- 前端建置（輸出到 fronted/dist）

		```

- Electron（同源載入後端，無熱載入）
		```powershell
		npm run electron-dev
		```

- Electron + Vite 畫面（開發用）

		```powershell
		npm run electron-dev:vite
		```


- Vite 代理（`fronted/vite.config.ts`）
    - 將 /api 代理到 <http://localhost:5002>。
- 後端伺服器（`server/src/index.js`）
  - 預設讀取 `modbus.config.json` 的 `server.port`，未設時落到 5002。
- Drizzle 設定（`drizzle.config.ts`）
	- schema: `server/src/models/schema.ts`
	- DB: `server/data/modbus.sqlite`
# Modbus TCP 工具（Electron + Web）

本專案支援兩種開發方式：

- Electron（無前端熱載入）
- Web 開發（Vite Dev Server，支援熱載入）

埠號配置：

- 前端（Vite）：<http://localhost:5000>
- 後端（Express + API）：<http://localhost:5002>

## 快速指令（Windows PowerShell）

- 一鍵啟動「前端 + 後端 + Drizzle Studio GUI」

  ```powershell
  npm run web:dev:all
  ```

  這個指令會同時：

  - 啟動 nodemon 監看後端（5002）。
  - 啟動 Vite 開發伺服器（5001），並將 /api 代理到 5002。
  - 啟動 Drizzle Studio GUI（固定埠 5003；讀 drizzle.config.ts，連線到 server/data/modbus.sqlite）。

- 僅啟動後端（Express）

  ```powershell
  npm run server
  ```

- 僅啟動前端（Vite）

  ```powershell
  npm run fronted
  ```

- 前端建置（輸出到 fronted/dist）

  ```powershell
  npm run fronted:build
  ```

- Electron（同源載入後端，無熱載入）

  ```powershell
  npm run electron-dev
  ```

- Electron + Vite 畫面（開發用；視窗指向 <http://localhost:5000>）

  ```powershell
  npm run electron-dev:vite
  ```

## 開發細節

- Vite 代理（`fronted/vite.config.ts`）
  - 將 `/api` 代理到 <http://localhost:5002>。
- 後端伺服器（`server/src/index.js`）
  - 讀取 `modbus.config.json` 的 `server.port`（預設 5002）。
  - 服務 `fronted/dist` 靜態檔，或退回 `public`。
- Drizzle 設定（`drizzle.config.ts`）
  - `schema`: `server/src/models/schema.ts`
  - `dbCredentials.url`: `server/data/modbus.sqlite`

## 常見問題

- Drizzle Studio 報 subpath/exports 類錯誤或啟動失敗
  - 優先使用最新版啟動：

    ```powershell
    npx drizzle-kit@latest studio
    ```

  - 若仍有問題，刪除 `node_modules` 後重新安裝依賴。

一次全部啟動
```powershell
npm run start:all
```
