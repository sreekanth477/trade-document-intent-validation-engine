'use strict';

const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Centralised Express Error Handler
// Must be registered last: app.use(errorHandler)
// ---------------------------------------------------------------------------

/**
 * Map common error names/codes to HTTP status codes.
 */
function resolveStatusCode(err) {
  if (err.status)  return err.status;
  if (err.statusCode) return err.statusCode;

  switch (err.name) {
    case 'ValidationError':      return 400;
    case 'CastError':            return 400;
    case 'JsonWebTokenError':    return 401;
    case 'TokenExpiredError':    return 401;
    case 'UnauthorizedError':    return 401;
    case 'ForbiddenError':       return 403;
    case 'NotFoundError':        return 404;
    case 'ConflictError':        return 409;
    case 'PayloadTooLargeError': return 413;
    default: break;
  }

  if (err.code === 'LIMIT_FILE_SIZE')  return 413;
  if (err.code === 'LIMIT_FILE_COUNT') return 400;
  if (err.code === 'ENOENT')           return 404;
  if (err.code === '23505')            return 409; // PostgreSQL unique violation
  if (err.code === '23503')            return 400; // PostgreSQL FK violation
  if (err.code === '23502')            return 400; // PostgreSQL not null violation

  return 500;
}

/**
 * Express error handler middleware.
 * Signature MUST be (err, req, res, next) - 4 arguments.
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status  = resolveStatusCode(err);
  const isServer = status >= 500;

  // Log with appropriate level
  if (isServer) {
    logger.error('Unhandled error', {
      status,
      error:   err.message,
      stack:   err.stack,
      path:    req.path,
      method:  req.method,
      userId:  req.user?.id || null,
      ip:      req.ip,
    });
  } else {
    logger.warn('Client error', {
      status,
      error:  err.message,
      path:   req.path,
      method: req.method,
      userId: req.user?.id || null,
    });
  }

  // Build response body
  const body = {
    success: false,
    error:   isServer && process.env.NODE_ENV === 'production'
      ? 'An internal server error occurred. Please contact support.'
      : err.message,
  };

  // Include validation details if available (e.g., from Zod)
  if (err.errors) {
    body.details = Array.isArray(err.errors)
      ? err.errors.map(e => ({ path: e.path?.join('.'), message: e.message }))
      : err.errors;
  }

  // Include multer error details
  if (err.code && err.code.startsWith('LIMIT_')) {
    body.error = err.message;
  }

  // Include PostgreSQL error code in non-production for debugging
  if (err.code && process.env.NODE_ENV !== 'production') {
    body.pgCode = err.code;
  }

  res.status(status).json(body);
}

/**
 * 404 Not Found handler for unmatched routes.
 * Register BEFORE errorHandler, AFTER all routes.
 */
function notFoundHandler(req, res) {
  logger.debug('404 Not Found', { path: req.path, method: req.method });
  res.status(404).json({
    success: false,
    error:   `Route not found: ${req.method} ${req.path}`,
  });
}

/**
 * Async wrapper to catch promise rejections and forward to error handler.
 * Use: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Create a standard HTTP error with a given status code.
 */
function createError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  return err;
}

module.exports = { errorHandler, notFoundHandler, asyncHandler, createError };
