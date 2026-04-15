'use strict';

const jwt    = require('jsonwebtoken');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// JWT Authentication Middleware
// ---------------------------------------------------------------------------

const JWT_SECRET = process.env.JWT_SECRET || 'change_me';
const JWT_EXPIRY = process.env.JWT_EXPIRY  || '8h';

/**
 * Generate a signed JWT for a user.
 * @param {object} payload - { id, email, role, fullName }
 * @returns {string} JWT string
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}

/**
 * Express middleware that validates the Bearer token in Authorization header.
 * Attaches the decoded payload to req.user on success.
 * Returns 401 on missing/invalid token.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error:   'Authentication required. Provide a Bearer token in the Authorization header.',
    });
  }

  const token = authHeader.slice(7); // Strip "Bearer "

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    logger.debug('authenticate: token verified', { userId: decoded.id, role: decoded.role });
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token has expired. Please log in again.' });
    }
    logger.warn('authenticate: invalid token', { error: err.message, ip: req.ip });
    return res.status(401).json({ success: false, error: 'Invalid authentication token.' });
  }
}

/**
 * Middleware factory that restricts access to users with specific roles.
 * Must be used AFTER authenticate().
 * @param {...string} roles - Allowed roles, e.g. 'admin', 'supervisor', 'compliance', 'checker'
 * @returns Express middleware
 */
function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Authentication required.' });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('authorize: access denied', {
        userId:        req.user.id,
        userRole:      req.user.role,
        requiredRoles: roles,
        path:          req.path,
      });
      return res.status(403).json({
        success: false,
        error:   `Access denied. Required role: ${roles.join(' or ')}. Your role: ${req.user.role}.`,
      });
    }

    next();
  };
}

/**
 * Optional authentication - sets req.user if token is valid, does not fail if absent.
 * Useful for endpoints that are publicly readable but show more data when authenticated.
 */
function optionalAuthenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  const token = authHeader.slice(7);

  try {
    req.user = jwt.verify(token, JWT_SECRET);
  } catch {
    req.user = null;
  }

  next();
}

module.exports = { authenticate, authorize, optionalAuthenticate, generateToken, JWT_SECRET };
