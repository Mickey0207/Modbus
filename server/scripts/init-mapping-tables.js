const Database = require('better-sqlite3');
const { resolveDbPath, ensureDbDirectory } = require('../src/db/config');

const dbPath = resolveDbPath();
ensureDbDirectory(dbPath);
const db = new Database(dbPath);

// Note: align schema with API routes (unit-centric). If you need host-specific mapping later
// you can extend with host_id columns and composite PKs, but current routes use unit_id only.
db.exec(`
CREATE TABLE IF NOT EXISTS sw8ch_address_map (
  unit_id INTEGER PRIMARY KEY,
  address INTEGER NOT NULL,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS dim_address_map (
  unit_id INTEGER PRIMARY KEY,
  mask_address INTEGER NOT NULL,
  ch1_address INTEGER NOT NULL,
  ch2_address INTEGER NOT NULL,
  ch3_address INTEGER NOT NULL,
  ch4_address INTEGER NOT NULL,
  created_at INTEGER
);
`);

console.log('[init] Initialized tables: sw8ch_address_map, dim_address_map, scan_map, control_map at', dbPath);
