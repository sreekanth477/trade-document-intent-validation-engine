'use strict';

const { Pool } = require('pg');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// PostgreSQL connection pool
// ---------------------------------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,                  // maximum pool size
  idleTimeoutMillis: 30000, // close idle clients after 30 s
  connectionTimeoutMillis: 5000, // error if connection not acquired in 5 s
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
});

// Log pool errors so they don't crash the process silently
pool.on('error', (err, client) => {
  logger.error('Unexpected PostgreSQL pool error', { error: err.message, stack: err.stack });
});

pool.on('connect', () => {
  logger.debug('New PostgreSQL client connected');
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a parameterised query against the pool.
 * @param {string} text - SQL statement with $1, $2 … placeholders
 * @param {Array}  params - bound parameter values
 * @returns {Promise<import('pg').QueryResult>}
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    logger.debug('Executed query', { duration_ms: duration, rows: result.rowCount });
    return result;
  } catch (err) {
    logger.error('Database query error', {
      error: err.message,
      query: text,
      params,
    });
    throw err;
  }
}

/**
 * Acquire a dedicated client for transaction use.
 * Caller MUST call client.release() in a finally block.
 * @returns {Promise<import('pg').PoolClient>}
 */
async function getClient() {
  const client = await pool.connect();
  const originalRelease = client.release.bind(client);

  // Override release to log long-running checkouts
  const timeout = setTimeout(() => {
    logger.warn('A pool client has been checked out for more than 30 seconds');
  }, 30000);

  client.release = (...args) => {
    clearTimeout(timeout);
    client.release = originalRelease;
    return originalRelease(...args);
  };

  return client;
}

/**
 * Run multiple statements inside a single transaction.
 * @param {function(import('pg').PoolClient): Promise<*>} fn - receives a client; throw to rollback
 * @returns {Promise<*>}
 */
async function withTransaction(fn) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Test pool connectivity - used by health-check endpoint.
 * @returns {Promise<void>}
 */
async function healthCheck() {
  const result = await query('SELECT 1 AS ok');
  if (!result.rows[0] || result.rows[0].ok !== 1) {
    throw new Error('Database health check returned unexpected result');
  }
}

module.exports = { pool, query, getClient, withTransaction, healthCheck };
