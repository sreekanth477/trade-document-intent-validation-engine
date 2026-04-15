'use strict';

const express    = require('express');
const bcrypt     = require('bcryptjs');
const { z }      = require('zod');

const { authenticate }              = require('../middleware/auth');
const { generateToken }             = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');
const { query }                     = require('../db/connection');
const logger = require('../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const LoginSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

const RegisterSchema = z.object({
  email:    z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  fullName: z.string().min(2, 'Full name must be at least 2 characters'),
  role:     z.enum(['checker', 'supervisor', 'compliance', 'admin']).default('checker'),
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(8, 'New password must be at least 8 characters'),
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = LoginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const { email, password } = parsed.data;

    const result = await query(
      `SELECT id, email, password_hash, full_name, role, is_active
       FROM users
       WHERE email = $1`,
      [email.toLowerCase().trim()]
    );

    if (result.rows.length === 0) {
      // Use the same error message for missing user and wrong password (security)
      logger.warn('Login attempt for unknown email', { email, ip: req.ip });
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      logger.warn('Login attempt for disabled account', { email, ip: req.ip });
      return res.status(401).json({ success: false, error: 'Account is disabled. Contact your administrator.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      logger.warn('Failed login - wrong password', { email, ip: req.ip });
      return res.status(401).json({ success: false, error: 'Invalid email or password.' });
    }

    const token = generateToken({
      id:       user.id,
      email:    user.email,
      role:     user.role,
      fullName: user.full_name,
    });

    logger.info('User logged in', { userId: user.id, email: user.email, role: user.role });

    res.json({
      success: true,
      token,
      user: {
        id:       user.id,
        email:    user.email,
        fullName: user.full_name,
        role:     user.role,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT id, email, full_name, role, is_active, created_at
       FROM users
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      throw createError('User account not found.', 404);
    }

    const user = result.rows[0];

    res.json({
      success: true,
      user: {
        id:        user.id,
        email:     user.email,
        fullName:  user.full_name,
        role:      user.role,
        isActive:  user.is_active,
        createdAt: user.created_at,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /api/auth/register  (admin only)
// ---------------------------------------------------------------------------
router.post(
  '/register',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
      throw createError('Only administrators may create user accounts.', 403);
    }

    const parsed = RegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const { email, password, fullName, role } = parsed.data;
    const normalEmail = email.toLowerCase().trim();

    // Check if email already in use
    const existing = await query(`SELECT id FROM users WHERE email = $1`, [normalEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ success: false, error: 'A user with this email already exists.' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = await query(
      `INSERT INTO users (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, full_name, role, created_at`,
      [normalEmail, passwordHash, fullName, role]
    );

    const newUser = result.rows[0];
    logger.info('User created', { newUserId: newUser.id, createdBy: req.user.id });

    res.status(201).json({
      success: true,
      user: {
        id:        newUser.id,
        email:     newUser.email,
        fullName:  newUser.full_name,
        role:      newUser.role,
        createdAt: newUser.created_at,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// POST /api/auth/change-password
// ---------------------------------------------------------------------------
router.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const parsed = ChangePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const { currentPassword, newPassword } = parsed.data;

    const result = await query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      throw createError('User not found.', 404);
    }

    const match = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!match) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect.' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newHash, req.user.id]
    );

    logger.info('Password changed', { userId: req.user.id });
    res.json({ success: true, message: 'Password updated successfully.' });
  })
);

// ---------------------------------------------------------------------------
// GET /api/auth/users  (admin only)
// ---------------------------------------------------------------------------
router.get(
  '/users',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
      throw createError('Only administrators may list users.', 403);
    }

    const result = await query(
      `SELECT id, email, full_name, role, is_active, created_at
       FROM users
       ORDER BY created_at DESC`
    );

    res.json({
      success: true,
      users:   result.rows.map(u => ({
        id:        u.id,
        email:     u.email,
        fullName:  u.full_name,
        role:      u.role,
        isActive:  u.is_active,
        createdAt: u.created_at,
      })),
    });
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/auth/users/:userId/deactivate  (admin only)
// ---------------------------------------------------------------------------
router.patch(
  '/users/:userId/deactivate',
  authenticate,
  asyncHandler(async (req, res) => {
    if (req.user.role !== 'admin') {
      throw createError('Only administrators may deactivate accounts.', 403);
    }

    const { userId } = req.params;

    if (userId === req.user.id) {
      throw createError('You cannot deactivate your own account.', 400);
    }

    const result = await query(
      `UPDATE users SET is_active = false WHERE id = $1 RETURNING id, email`,
      [userId]
    );

    if (result.rows.length === 0) {
      throw createError(`User ${userId} not found.`, 404);
    }

    logger.info('User deactivated', { targetUserId: userId, byUserId: req.user.id });
    res.json({ success: true, message: `User ${result.rows[0].email} deactivated.` });
  })
);

module.exports = router;
