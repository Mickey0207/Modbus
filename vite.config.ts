// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: ['serialport'],
              output: { entryFileNames: 'index.js' },
            },
          },
        },
        onstart({ startup }) {
          // 啟動 Electron 並連到 Vite Dev Server
          startup()
        },
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              output: { entryFileNames: 'index.js' },
            },
          },
        },
      },
    ]),
  ],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    port: 5173,
    open: false
  },
}))
