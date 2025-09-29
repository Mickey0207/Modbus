import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// 注意：目前應用程式執行時不使用 Drizzle 寫入 DB，
// 此檔僅提供 drizzle-kit 觀察/檢視用途，避免誤建 legacy 資料表。

// 使用中：以 host_status 為即時狀態表（host_id 為主鍵）
export const hostStatus = sqliteTable('host_status', {
  hostId: text('host_id').primaryKey(),
  ip: text('ip').notNull(),
  port: integer('port').notNull(),
  unitId: integer('unit_id').notNull(),
  connected: integer('connected'),
  lastSeen: integer('last_seen'),
  createdAt: integer('created_at')
})
