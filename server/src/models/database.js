const Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3');
const { resolveDbPath, ensureDbDirectory } = require('../config/database');

const dbPath = resolveDbPath();
ensureDbDirectory(dbPath);

const sqlite = new Database(dbPath);
const db = drizzle(sqlite);

module.exports = { db, sqlite, dbPath };
