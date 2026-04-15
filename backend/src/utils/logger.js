'use strict';

const winston = require('winston');
const path    = require('path');
const fs      = require('fs');

const { combine, timestamp, printf, colorize, errors, json, splat } = winston.format;

// ---------------------------------------------------------------------------
// Ensure log directory exists
// ---------------------------------------------------------------------------
const LOG_DIR = process.env.LOG_DIR || path.join(process.cwd(), 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// ---------------------------------------------------------------------------
// Custom formats
// ---------------------------------------------------------------------------

// Human-readable format for development console
const devConsoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  splat(),
  printf(({ level, message, timestamp: ts, stack, ...meta }) => {
    let line = `${ts} [${level}] ${message}`;
    if (stack) line += `\n${stack}`;
    const extras = Object.keys(meta).filter(k => k !== 'service');
    if (extras.length > 0) {
      line += `  ${JSON.stringify(meta, null, 0)}`;
    }
    return line;
  })
);

// Structured JSON format for production / file transports
const structuredFormat = combine(
  timestamp(),
  errors({ stack: true }),
  splat(),
  json()
);

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------
const transports = [];

if (process.env.NODE_ENV === 'production') {
  // Production: structured JSON to stdout (captured by log aggregator)
  transports.push(
    new winston.transports.Console({ format: structuredFormat })
  );
} else {
  // Development: colourised human-readable console
  transports.push(
    new winston.transports.Console({ format: devConsoleFormat })
  );
}

// Always write to rotating files (simple daily files)
transports.push(
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'error.log'),
    level: 'error',
    format: structuredFormat,
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 10,
    tailable: true,
  }),
  new winston.transports.File({
    filename: path.join(LOG_DIR, 'combined.log'),
    format: structuredFormat,
    maxsize: 20 * 1024 * 1024, // 20 MB
    maxFiles: 14,
    tailable: true,
  })
);

// ---------------------------------------------------------------------------
// Logger instance
// ---------------------------------------------------------------------------
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  defaultMeta: { service: 'trade-doc-validation' },
  transports,
  exitOnError: false,
});

// ---------------------------------------------------------------------------
// HTTP request logging helper (used by Morgan-style middleware if needed)
// ---------------------------------------------------------------------------
logger.httpStream = {
  write: (message) => logger.http(message.trim()),
};

module.exports = logger;
