import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

export const hosts = sqliteTable('hosts', {
  id: text('id').primaryKey(),
  ip: text('ip').notNull(),
  port: integer('port').notNull(),
  unitId: integer('unit_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).$defaultFn(() => Date.now())
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  text: text('text').notNull(),
  ts: integer('ts', { mode: 'timestamp_ms' }).notNull()
})
