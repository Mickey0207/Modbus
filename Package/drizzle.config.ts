import type { Config } from 'drizzle-kit'
import path from 'node:path'

const root = path.resolve(__dirname, '..')

export default {
  schema: path.resolve(root, 'server/src/models/schema.ts'),
  out: path.resolve(root, 'server/migrations'),
  dialect: 'sqlite',
  dbCredentials: {
    url: path.resolve(root, 'server/data/modbus.sqlite')
  }
} satisfies Config
