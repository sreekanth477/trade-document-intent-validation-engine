'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * Attach a correlationId to every request.
 * Honours X-Correlation-ID header if provided by upstream proxy.
 * Adds it to res header so clients can trace requests.
 */
module.exports = function correlationId(req, res, next) {
  req.correlationId = req.headers['x-correlation-id'] || uuidv4();
  res.setHeader('X-Correlation-ID', req.correlationId);
  next();
};
