'use strict';

// Load environment variables as early as possible
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express     = require('express');
const helmet      = require('helmet');
const cors        = require('cors');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const path        = require('path');
const fs          = require('fs');

const logger                          = require('./utils/logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { healthCheck: dbHealthCheck }  = require('./db/connection');
const correlationId   = require('./middleware/correlationId');
const requestLogger   = require('./middleware/requestLogger');

// Route modules
const authRoutes       = require('./routes/auth');
const documentRoutes   = require('./routes/documents');
const validationRoutes = require('./routes/validations');
const auditRoutes      = require('./routes/audit');
const configRoutes     = require('./routes/config');

const app  = express();
const PORT = parseInt(process.env.PORT, 10) || 4000;

// ---------------------------------------------------------------------------
// Ensure upload directory exists
// ---------------------------------------------------------------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  logger.info(`Created upload directory: ${UPLOAD_DIR}`);
}

// ---------------------------------------------------------------------------
// Security middleware
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", 'data:'],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    logger.warn('CORS blocked origin', { origin });
    callback(new Error(`CORS: origin "${origin}" not allowed`));
  },
  methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders:   ['X-Request-ID'],
  credentials:      true,
  maxAge:           86400, // 24h preflight cache
}));

// ---------------------------------------------------------------------------
// Compression
// ---------------------------------------------------------------------------
app.use(compression({ level: 6, threshold: 1024 }));

// ---------------------------------------------------------------------------
// Correlation ID (must be before requestLogger and routes)
// ---------------------------------------------------------------------------
app.use(correlationId);

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000; // 15 min
const maxReqs  = parseInt(process.env.RATE_LIMIT_MAX,       10) || 200;

const limiter = rateLimit({
  windowMs,
  max:     maxReqs,
  standardHeaders: true,
  legacyHeaders:   false,
  handler: (req, res) => {
    logger.warn('Rate limit exceeded', { ip: req.ip, path: req.path });
    res.status(429).json({
      success: false,
      error:   'Too many requests. Please slow down and try again later.',
    });
  },
});
app.use(limiter);

// Stricter rate limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max:      20,
  message: { success: false, error: 'Too many authentication attempts. Try again in 15 minutes.' },
});
app.use('/api/auth/login', authLimiter);

// ---------------------------------------------------------------------------
// Body parsers (JSON and URL-encoded)
// Note: multer handles multipart/form-data; don't use bodyParser for uploads.
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ---------------------------------------------------------------------------
// Request logger (child logger per-request; registered after correlationId)
// ---------------------------------------------------------------------------
app.use(requestLogger);

// ---------------------------------------------------------------------------
// Request logging middleware
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  req.requestId   = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    const duration = Date.now() - start;
    const level    = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'http';
    logger[level]('HTTP', {
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      duration_ms: duration,
      ip:         req.ip,
      requestId,
      userId:     req.user?.id || null,
    });
  });

  next();
});

// ---------------------------------------------------------------------------
// Health check endpoint (no auth required)
// ---------------------------------------------------------------------------
app.get('/health', async (req, res) => {
  const health = {
    status:    'ok',
    timestamp: new Date().toISOString(),
    version:   process.env.npm_package_version || '1.0.0',
    env:       process.env.NODE_ENV || 'development',
    services:  {},
  };

  // Database check
  try {
    await dbHealthCheck();
    health.services.database = 'ok';
  } catch (err) {
    health.services.database = 'error';
    health.status = 'degraded';
    logger.error('Health check: DB failed', { error: err.message });
  }

  // Queue health check
  try {
    const { getQueueHealth } = require('./services/queueService');
    health.services.queues = await getQueueHealth();
  } catch {
    health.services.queues = 'unavailable';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(health);
});

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------
app.use('/api/auth',        authRoutes);
app.use('/api/documents',   documentRoutes);
app.use('/api/validations', validationRoutes);
app.use('/api/audit',       auditRoutes);
app.use('/api/config',      configRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name:    'Trade Document Intent Validation Engine API',
    version: '1.0.0',
    status:  'running',
    docs:    '/health',
  });
});

// ---------------------------------------------------------------------------
// 404 and error handlers (must be last)
// ---------------------------------------------------------------------------
app.use(notFoundHandler);
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Queue initialisation
// ---------------------------------------------------------------------------
function initQueues() {
  try {
    const { getDocumentExtractionQueue, getIntentAnalysisQueue } = require('./services/queueService');
    getDocumentExtractionQueue();
    getIntentAnalysisQueue();
    logger.info('Bull queues initialised');
  } catch (err) {
    logger.error('Failed to initialise Bull queues - Redis may be unavailable', {
      error: err.message,
    });
    // Do not crash - the app can still serve API requests; queue processing will fail gracefully
  }
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
async function gracefulShutdown(signal) {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    // Close queues
    try {
      const { shutdown: shutdownQueues } = require('./services/queueService');
      await shutdownQueues();
    } catch (err) {
      logger.error('Error closing queues', { error: err.message });
    }

    // Close DB pool
    try {
      const { pool } = require('./db/connection');
      await pool.end();
      logger.info('Database pool closed');
    } catch (err) {
      logger.error('Error closing DB pool', { error: err.message });
    }

    logger.info('Graceful shutdown complete');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception - shutting down', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', { reason: String(reason) });
  // Don't exit - log and continue
});

// ---------------------------------------------------------------------------
// Start server (only when run directly, not when require()'d by tests)
// ---------------------------------------------------------------------------
let server;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Trade Document Intent Validation Engine API started`, {
      port:        PORT,
      environment: process.env.NODE_ENV || 'development',
      uploadDir:   UPLOAD_DIR,
      corsOrigins: allowedOrigins,
      mockLLM:     process.env.USE_MOCK_LLM === 'true',
    });
    initQueues();
  });

  // Keep-alive and timeout settings
  server.keepAliveTimeout  = 65000;
  server.headersTimeout    = 66000;
  server.timeout           = 120000; // 2 min for LLM calls
}

// Export the raw express app so Supertest can bind its own ephemeral port
module.exports = app;
module.exports.server = server;
