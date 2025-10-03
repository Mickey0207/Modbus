import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

// Root vite config that points to fronted as source
const projectRoot = path.dirname(fileURLToPath(import.meta.url))
const frontedRoot = path.resolve(projectRoot, 'fronted')

const shared = (() => {
  try {
    const require = createRequire(import.meta.url)
    const { createFrontedViteConfig } = require('./Package/vite.fronted.config.cjs')
    return createFrontedViteConfig(frontedRoot)
  } catch {
    return {}
  }
})()

export default defineConfig({
  ...shared,
  root: frontedRoot,
  plugins: [react(), ...(shared.plugins ?? [])],
  resolve: {
    alias: [
      { find: '@/api', replacement: path.resolve(projectRoot, 'External_mock/api') },
      { find: '@mock', replacement: path.resolve(projectRoot, 'External_mock/api') },
      { find: '@', replacement: path.resolve(frontedRoot, 'src') },
      ...((shared.resolve && shared.resolve.alias) ? shared.resolve.alias : [])
    ]
  },
  server: {
    port: 5001,
    fs: { allow: [path.resolve(projectRoot, 'External_mock')] },
    proxy: { '/api': { target: 'http://localhost:5002', changeOrigin: true } }
  },
  preview: { port: 5001 }
})
