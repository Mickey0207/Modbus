// Migration/upgrade script to align DB with current runtime schema
// - host_status (canonical runtime table)
// - sw8ch_address_map (unit_id PK)
// - dim_address_map (unit_id PK, mask + ch1..ch4)
// - sites/site_sw_hosts/site_sw_slaves/site_sw_versions/site_sw_version_snapshots and column backfills
// Safe to run multiple times.

const Database = require('better-sqlite3')
const path = require('path')
const { resolveDbPath, ensureDbDirectory } = require('../src/db/config')

function ensureHostStatus(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS host_status (
    host_id TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    unit_id INTEGER NOT NULL,
    connected INTEGER,
    last_seen INTEGER,
    created_at INTEGER
  )`)

  // Backfill missing columns safely (older DBs may lack some columns)
  try {
    const cols = db.prepare(`PRAGMA table_info(host_status)`).all()
    const has = (n)=> cols.some(c=>c.name===n)
    const add = (name, type)=> db.prepare(`ALTER TABLE host_status ADD COLUMN ${name} ${type}`).run()
    if (!has('ip')) add('ip','TEXT')
    if (!has('port')) add('port','INTEGER')
    if (!has('unit_id')) add('unit_id','INTEGER')
    if (!has('connected')) add('connected','INTEGER')
    if (!has('last_seen')) add('last_seen','INTEGER')
    if (!has('created_at')) add('created_at','INTEGER')
  } catch {}

  // migrate legacy hosts -> host_status (best-effort)
  try {
    const hasHosts = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='hosts'`).get()
    if (hasHosts) {
      const rows = db.prepare(`SELECT id, ip, port, unit_id, connected, last_seen, created_at FROM hosts`).all()
      const upsert = db.prepare(`INSERT INTO host_status (host_id, ip, port, unit_id, connected, last_seen, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(host_id) DO UPDATE SET ip=excluded.ip, port=excluded.port, unit_id=excluded.unit_id, connected=excluded.connected, last_seen=excluded.last_seen`)
      const tx = db.transaction((arr)=>{ for (const r of arr) upsert.run(r.id, r.ip, r.port, r.unit_id, r.connected ?? 0, r.last_seen ?? null, r.created_at ?? Date.now()) })
      tx(rows)
    }
  } catch {}
}

function ensureMappingTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS sw8ch_address_map (
    unit_id INTEGER PRIMARY KEY,
    address INTEGER NOT NULL,
    created_at INTEGER
  )`)
  db.exec(`CREATE TABLE IF NOT EXISTS dim_address_map (
    unit_id INTEGER PRIMARY KEY,
    mask_address INTEGER NOT NULL,
    ch1_address INTEGER NOT NULL,
    ch2_address INTEGER NOT NULL,
    ch3_address INTEGER NOT NULL,
    ch4_address INTEGER NOT NULL,
    created_at INTEGER
  )`)

  // Attempt to migrate from earlier host_id+slave_unit_id schema if present
  try {
    const legacySw = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='sw8ch_address_map'`).get()
    if (legacySw) {
      // if table has host_id/slave_unit_id columns, try to consolidate to unit-based map (keeping smallest address per unit)
      const pragma = db.prepare(`PRAGMA table_info(sw8ch_address_map)`).all()
      const hasHostId = pragma.some(c=>c.name==='host_id')
      const hasSlaveUnitId = pragma.some(c=>c.name==='slave_unit_id')
      if (hasHostId && hasSlaveUnitId) {
        const rows = db.prepare(`SELECT slave_unit_id as unit_id, MIN(address) as address FROM sw8ch_address_map GROUP BY slave_unit_id`).all()
        const upsert = db.prepare(`INSERT INTO sw8ch_address_map (unit_id, address, created_at) VALUES (?, ?, ?)
          ON CONFLICT(unit_id) DO UPDATE SET address=excluded.address`)
        const tx = db.transaction((arr)=>{ for (const r of arr) upsert.run(r.unit_id, r.address, Date.now()) })
        tx(rows)
      }
    }
  } catch {}

  try {
    const legacyDim = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='dim_address_map'`).get()
    if (legacyDim) {
      const pragma = db.prepare(`PRAGMA table_info(dim_address_map)`).all()
      const hasHostId = pragma.some(c=>c.name==='host_id')
      const hasSlaveUnitId = pragma.some(c=>c.name==='slave_unit_id')
      const hasCh1 = pragma.some(c=>c.name==='ch1')
      if (hasHostId && hasSlaveUnitId) {
        const rows = db.prepare(`SELECT slave_unit_id as unit_id,
          MIN(mask_address) as mask_address,
          MIN(COALESCE(ch1, ch1_address)) as ch1_address,
          MIN(COALESCE(ch2, ch2_address)) as ch2_address,
          MIN(COALESCE(ch3, ch3_address)) as ch3_address,
          MIN(COALESCE(ch4, ch4_address)) as ch4_address
          FROM dim_address_map GROUP BY slave_unit_id`).all()
        const upsert = db.prepare(`INSERT INTO dim_address_map (unit_id, mask_address, ch1_address, ch2_address, ch3_address, ch4_address, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(unit_id) DO UPDATE SET mask_address=excluded.mask_address, ch1_address=excluded.ch1_address, ch2_address=excluded.ch2_address, ch3_address=excluded.ch3_address, ch4_address=excluded.ch4_address`)
        const tx = db.transaction((arr)=>{ for (const r of arr) upsert.run(r.unit_id, r.mask_address, r.ch1_address, r.ch2_address, r.ch3_address, r.ch4_address, Date.now()) })
        tx(rows)
      }
    }
  } catch {}
}

function ensureSitesAndConfigs(db) {
  // Create core tables if missing
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS site_sw_hosts (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ip TEXT,
      port INTEGER,
      unit_id INTEGER,
      enabled INTEGER,
      type TEXT,
      serial_path TEXT,
      baud_rate INTEGER,
      data_bits INTEGER,
      parity TEXT,
      stop_bits INTEGER,
      floor TEXT,
      room TEXT,
      note TEXT,
      sort INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(site_id, name),
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS site_sw_slaves (
      id TEXT PRIMARY KEY,
      host_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slave_unit_id INTEGER,
      desired_enabled INTEGER,
      desired_type TEXT,
      sw_mask INTEGER,
      dim_mask INTEGER,
      dim_values TEXT,
      floor TEXT,
      room TEXT,
      note TEXT,
      sort INTEGER,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(host_id, name),
      UNIQUE(host_id, slave_unit_id),
      FOREIGN KEY(host_id) REFERENCES site_sw_hosts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS site_sw_versions (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL,
      major INTEGER,
      minor INTEGER,
      patch INTEGER,
      version TEXT,
      note TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      UNIQUE(site_id, version),
      FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS site_sw_version_snapshots (
      id TEXT PRIMARY KEY,
      version_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      FOREIGN KEY(version_id) REFERENCES site_sw_versions(id) ON DELETE CASCADE
    );
  `)

  // 移除針對拼字錯誤 site_sw_visions 的自動修復，改由固定 schema 運作

  // Backfill missing columns for site_sw_hosts
  try {
    const cols = db.prepare(`PRAGMA table_info(site_sw_hosts)`).all()
    const has = (n)=> cols.some(c=>c.name===n)
    const add = (ddl)=> db.prepare(`ALTER TABLE site_sw_hosts ADD COLUMN ${ddl}`).run()
    if (!has('enabled')) add(`enabled INTEGER NOT NULL DEFAULT 1`)
    if (!has('type')) add(`type TEXT`)
    if (!has('serial_path')) add(`serial_path TEXT`)
    if (!has('baud_rate')) add(`baud_rate INTEGER`)
    if (!has('data_bits')) add(`data_bits INTEGER`)
    if (!has('parity')) add(`parity TEXT`)
    if (!has('stop_bits')) add(`stop_bits INTEGER`)
    if (!has('floor')) add(`floor TEXT`)
    if (!has('room')) add(`room TEXT`)
    if (!has('note')) add(`note TEXT`)
    if (!has('sort')) add(`sort INTEGER`)
    if (!has('created_at')) add(`created_at INTEGER`)
    if (!has('updated_at')) add(`updated_at INTEGER`)
    if (!has('connected')) add(`connected INTEGER`)
    if (!has('last_seen')) add(`last_seen INTEGER`)
  } catch {}

  // Backfill missing columns for site_sw_slaves
  try {
    const cols = db.prepare(`PRAGMA table_info(site_sw_slaves)`).all()
    const has = (n)=> cols.some(c=>c.name===n)
    const add = (ddl)=> db.prepare(`ALTER TABLE site_sw_slaves ADD COLUMN ${ddl}`).run()
    if (!has('desired_enabled')) add(`desired_enabled INTEGER`)
    if (!has('desired_type')) add(`desired_type TEXT`)
    if (!has('sw_mask')) add(`sw_mask INTEGER`)
    if (!has('dim_mask')) add(`dim_mask INTEGER`)
    if (!has('dim_values')) add(`dim_values TEXT`)
    if (!has('floor')) add(`floor TEXT`)
    if (!has('room')) add(`room TEXT`)
    if (!has('note')) add(`note TEXT`)
    if (!has('sort')) add(`sort INTEGER`)
    if (!has('created_at')) add(`created_at INTEGER`)
    if (!has('updated_at')) add(`updated_at INTEGER`)
    if (!has('connected')) add(`connected INTEGER`)
    if (!has('last_seen')) add(`last_seen INTEGER`)
  } catch {}

  // Helpful indexes
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_site_sw_hosts_site_id ON site_sw_hosts(site_id);
      CREATE INDEX IF NOT EXISTS idx_site_sw_hosts_enabled ON site_sw_hosts(enabled);
      CREATE INDEX IF NOT EXISTS idx_site_sw_slaves_host_id ON site_sw_slaves(host_id);
      CREATE INDEX IF NOT EXISTS idx_site_sw_slaves_unit ON site_sw_slaves(slave_unit_id);
    `)
  } catch {}

  // Data migration from legacy tables if they exist and new tables are empty
  try {
    const hasOldHosts = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='site_hosts'`).get();
    const hasOldSlaves = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='site_slaves'`).get();
    const hasOldVersions = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='site_versions'`).get();
    const hasOldSnapshots = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='site_version_snapshots'`).get();
    const newHostsCount = db.prepare(`SELECT COUNT(1) as c FROM site_sw_hosts`).get().c;
    const newSlavesCount = db.prepare(`SELECT COUNT(1) as c FROM site_sw_slaves`).get().c;
  const newVisionsCount = db.prepare(`SELECT COUNT(1) as c FROM site_sw_versions`).get().c;
    if (hasOldHosts && newHostsCount === 0) {
      const rows = db.prepare(`SELECT * FROM site_hosts`).all();
      const ins = db.prepare(`INSERT INTO site_sw_hosts (id, site_id, name, ip, port, unit_id, enabled, type, serial_path, baud_rate, data_bits, parity, stop_bits, floor, room, note, sort, created_at, updated_at, connected, last_seen)
        VALUES (@id, @site_id, @name, @ip, @port, @unit_id, @enabled, @type, @serial_path, @baud_rate, @data_bits, @parity, @stop_bits, @floor, @room, @note, @sort, @created_at, @updated_at, COALESCE(@connected,0), @last_seen)`);
      const tx = db.transaction((arr)=>{ for (const r of arr) ins.run(r) })
      tx(rows)
    }
    if (hasOldSlaves && newSlavesCount === 0) {
      const rows = db.prepare(`SELECT * FROM site_slaves`).all();
      const ins = db.prepare(`INSERT INTO site_sw_slaves (id, host_id, name, slave_unit_id, desired_enabled, desired_type, sw_mask, dim_mask, dim_values, floor, room, note, sort, created_at, updated_at, connected, last_seen)
        VALUES (@id, @host_id, @name, @slave_unit_id, @desired_enabled, @desired_type, @sw_mask, @dim_mask, @dim_values, @floor, @room, @note, @sort, @created_at, @updated_at, COALESCE(@connected,0), @last_seen)`);
      const tx = db.transaction((arr)=>{ for (const r of arr) ins.run(r) })
      tx(rows)
    }
    if (hasOldVersions && newVisionsCount === 0) {
      const rows = db.prepare(`SELECT * FROM site_versions`).all();
      const ins = db.prepare(`INSERT INTO site_sw_versions (id, site_id, major, minor, patch, version, created_at, updated_at)
        VALUES (@id, @site_id, @major, @minor, @patch, @version, @created_at, @updated_at)`);
      const tx = db.transaction((arr)=>{ for (const r of arr) ins.run(r) })
      tx(rows)
      if (hasOldSnapshots) {
        const snaps = db.prepare(`SELECT * FROM site_version_snapshots`).all();
        const ins2 = db.prepare(`INSERT INTO site_sw_version_snapshots (id, version_id, payload) VALUES (@id, @version_id, @payload)`);
        const tx2 = db.transaction((arr)=>{ for (const r of arr) ins2.run(r) })
        tx2(snaps)
      }
    }
  } catch {}
}

function main() {
  const dbPath = resolveDbPath()
  ensureDbDirectory(dbPath)
  const db = new Database(dbPath)
  ensureHostStatus(db)
  ensureMappingTables(db)
  ensureSitesAndConfigs(db)

  // Drop legacy tables as requested, best-effort
  try { db.exec(`DROP TABLE IF EXISTS site_hosts;`)} catch {}
  try { db.exec(`DROP TABLE IF EXISTS site_slaves;`)} catch {}
  try { db.exec(`DROP TABLE IF EXISTS site_versions;`)} catch {}
  try { db.exec(`DROP TABLE IF EXISTS site_version_snapshots;`)} catch {}

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r=>r.name)
  console.log('[migrate-db] Done. DB:', dbPath)
  console.log('[migrate-db] Tables:', tables)
}

if (require.main === module) {
  try { main() } catch (e) { console.error('[migrate-db] Failed:', e?.message || e) ; process.exit(1) }
}

module.exports = { }
