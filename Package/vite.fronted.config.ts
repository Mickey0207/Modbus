import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// This shared config is imported by fronted/vite.config.ts to keep a single source of truth
export const createFrontedViteConfig = (projectRootUrl: string) => {
  const projectRoot = path.dirname(fileURLToPath(projectRootUrl))
  return defineConfig({
    plugins: [react()],
    resolve: {
      alias: [
        { find: '@/api', replacement: path.resolve(projectRoot, '../External_mock/api') },
        { find: '@mock', replacement: path.resolve(projectRoot, '../External_mock/api') },
        { find: '@', replacement: path.resolve(projectRoot, 'src') }
      ]
    },
    server: {
      port: 5001,
      fs: { allow: [path.resolve(projectRoot, '..', 'External_mock')] },
      proxy: {
        '/api': { target: 'http://localhost:5002', changeOrigin: true }
      }
    },
    preview: { port: 5001 }
  })
}
