# Modbus TCP 工具

一個基於網頁的 Modbus TCP 客戶端工具。

## Electron

- 開發預設採同源單埠；如需前端 HMR，可改用 Vite 模式。
- 打包後維持同源單埠，後端掛載於 /api。

## 指令速查（Windows PowerShell）

預設開發流程（瀏覽器開啟）

```powershell
# 同時啟動後端與前端
npm run web:dev
```

Electron 開發（同源，單一埠，推薦）

```powershell
npm run electron-dev
# 如需改埠：
npm run electron-dev:5001
```

Electron 開發（前端 HMR）

```powershell
# 先啟前端（Vite HMR，預設 5000）
npm run client
# 再啟 Electron（載入前端，後端由 Electron 內嵌啟動）
npm run electron-dev:vite
```

打包應用程式（Electron）

```powershell
npm run build-win   # Windows
npm run build-mac   # macOS
npm run build-linux # Linux
```

修復 better-sqlite3 原生模組（版本不相容時）

```powershell
# 給 web:dev（Node 環境）
npm run rebuild:node

# 給 Electron（針對目前安裝的 Electron 版本重建原生模組）
npm run rebuild:electron
```
