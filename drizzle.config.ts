import type { Config } from 'drizzle-kit'

export default {
  schema: './server/src/db/schema.ts',
  out: './server/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './server/data/modbus.sqlite'
  }
} satisfies Config
