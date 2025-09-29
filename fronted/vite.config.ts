import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    // 前端（Vite）開發伺服器埠
    port: 5001,
    proxy: {
      '/api': {
        // 開發時將 API 代理到後端（Express）埠
        target: 'http://localhost:5002',
        changeOrigin: true
      }
    }
  },
  // 前端預覽模式埠
  preview: { port: 5001 }
})
