# React + Vite + Electron

此專案提供 React + Vite 前端，並整合 Electron 生成 Windows 桌面應用。

## 需求
- Node.js 18+

## 安裝
```powershell
npm install
```

## 開發
只需啟動 Vite，vite-plugin-electron 會自動啟動 Electron 並連到開發伺服器。
```powershell
npm run dev
```

如果沒有自動開啟視窗，請在第二個終端手動執行：
```powershell
npm run electron
```

## 打包
建置靜態資源與 Electron 主程式後，使用 electron-builder 產生 Windows 安裝檔。
```powershell
# 僅封裝資料夾（便於檢查）
npm run package

# 產出 Windows 安裝檔（NSIS）
npm run package:win
```

## 結構
- `src/` 前端 React 程式
- `electron/` Electron 主進程與 Preload 腳本
- `vite.config.ts` Vite 與 Electron 插件設定

## 注意
- Preload 暴露的 API 位於 `electron/preload.ts`，並以 `window.api` 提供給前端使用。
- 如需 Node 模組，請在主進程使用，避免在 Renderer 直接使用 Node 內建 API。
