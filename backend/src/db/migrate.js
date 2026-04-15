'use strict';

/**
 * Simple migration runner.
 * Reads src/db/schema.sql and executes it against the configured database.
 * Safe to run multiple times - all DDL uses IF NOT EXISTS / DO $$ ... $$ guards.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const fs   = require('fs');
const path = require('path');
const { Pool } = require('pg');

const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

async function migrate() {
  console.log('[migrate] Starting database migration...');
  console.log(`[migrate] Database URL: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:\/\/.*@/, '://***@') : 'NOT SET'}`);

  if (!process.env.DATABASE_URL) {
    console.error('[migrate] ERROR: DATABASE_URL environment variable is not set.');
    process.exit(1);
  }

  if (!fs.existsSync(SCHEMA_FILE)) {
    console.error(`[migrate] ERROR: Schema file not found at ${SCHEMA_FILE}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  console.log(`[migrate] Read schema file (${sql.length} bytes)`);

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  const client = await pool.connect();

  try {
    console.log('[migrate] Connected to database. Executing schema...');

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    console.log('[migrate] Schema executed successfully.');
    console.log('[migrate] Migration complete.');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[migrate] ERROR during migration:', err.message);
    if (err.position) {
      // Show the problematic part of the SQL
      const pos = parseInt(err.position, 10);
      const snippet = sql.substring(Math.max(0, pos - 100), pos + 100);
      console.error('[migrate] Near SQL:', snippet);
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
