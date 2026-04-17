'use strict';

const logger = require('../utils/logger');

/**
 * Attach a child logger to every request with correlation ID and user context.
 * Use req.log instead of the global logger inside route handlers.
 */
module.exports = function requestLogger(req, res, next) {
  req.log = logger.child({
    correlationId: req.correlationId,
    userId:        req.user?.id,
    method:        req.method,
    path:          req.path,
  });

  const start = Date.now();
  res.on('finish', () => {
    req.log.info('HTTP request completed', {
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  });

  next();
};
