const path = require('node:path')

function createFrontedViteConfig(projectRoot) {
  return {
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
  }
}

module.exports = { createFrontedViteConfig }
