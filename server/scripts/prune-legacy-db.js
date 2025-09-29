// Prune legacy tables safely. Use flags like --drop-hosts
const Database = require('better-sqlite3');
const { resolveDbPath, ensureDbDirectory } = require('../src/db/config');

function hasTable(db, name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function main() {
  const args = process.argv.slice(2);
  const dropHosts = args.includes('--drop-hosts');
  const dropDrizzle = args.includes('--drop-drizzle'); // __drizzle_migrations

  const dbPath = resolveDbPath();
  ensureDbDirectory(dbPath);
  const db = new Database(dbPath);

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r=>r.name);
  console.log('[prune-legacy] DB:', dbPath);
  console.log('[prune-legacy] Existing tables:', tables);

  const dropped = [];

  if (dropHosts && hasTable(db, 'hosts')) {
    db.exec('DROP TABLE IF EXISTS hosts');
    dropped.push('hosts');
  }
  if (dropDrizzle && hasTable(db, '__drizzle_migrations')) {
    db.exec('DROP TABLE IF EXISTS __drizzle_migrations');
    dropped.push('__drizzle_migrations');
  }

  // Removed: drop-typo-versions (site_sw_visions)

  const after = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`).all().map(r=>r.name);
  console.log('[prune-legacy] Dropped:', dropped.length ? dropped : '(none)');
  console.log('[prune-legacy] Tables now:', after);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('[prune-legacy] Failed:', e?.message || e); process.exit(1); }
}

module.exports = {};
