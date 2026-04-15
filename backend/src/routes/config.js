'use strict';

const express = require('express');
const { z }   = require('zod');

const { authenticate, authorize }   = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');
const { query }                     = require('../db/connection');
const logger = require('../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const RuleSchema = z.object({
  ruleName:    z.string().min(3, 'Rule name must be at least 3 characters'),
  ruleType:    z.string().min(1, 'Rule type is required'),
  corridor:    z.string().optional().nullable(),
  commodity:   z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  ruleConfig:  z.record(z.unknown()).default({}),
  isActive:    z.boolean().default(true),
});

const TypologySchema = z.object({
  name:        z.string().min(3),
  description: z.string().min(10),
  indicators:  z.array(z.object({
    indicator: z.string(),
    weight:    z.number().min(0).max(1),
  })),
  riskLevel:   z.enum(['critical', 'moderate', 'informational']),
});

// ---------------------------------------------------------------------------
// GET /api/config/rules
// List all custom rules (with optional filtering)
// ---------------------------------------------------------------------------
router.get(
  '/rules',
  authenticate,
  asyncHandler(async (req, res) => {
    const { ruleType, corridor, commodity, isActive } = req.query;

    let whereClause = 'WHERE 1=1';
    const params    = [];
    let paramIdx    = 1;

    if (ruleType) {
      whereClause += ` AND rule_type = $${paramIdx++}`;
      params.push(ruleType);
    }
    if (corridor) {
      whereClause += ` AND corridor ILIKE $${paramIdx++}`;
      params.push(`%${corridor}%`);
    }
    if (commodity) {
      whereClause += ` AND commodity ILIKE $${paramIdx++}`;
      params.push(`%${commodity}%`);
    }
    if (isActive !== undefined) {
      whereClause += ` AND is_active = $${paramIdx++}`;
      params.push(isActive === 'true' || isActive === true);
    }

    const result = await query(
      `SELECT
         id, rule_name, rule_type, corridor, commodity, description,
         rule_config, is_active, created_by, created_at, updated_at, version
       FROM custom_rules
       ${whereClause}
       ORDER BY rule_name ASC`,
      params
    );

    res.json({
      success: true,
      count:   result.rows.length,
      rules:   result.rows,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/config/rules/:id
// Get a single rule by ID
// ---------------------------------------------------------------------------
router.get(
  '/rules/:id',
  authenticate,
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT * FROM custom_rules WHERE id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      throw createError(`Rule ${req.params.id} not found.`, 404);
    }

    res.json({ success: true, rule: result.rows[0] });
  })
);

// ---------------------------------------------------------------------------
// POST /api/config/rules
// Create a new custom rule
// ---------------------------------------------------------------------------
router.post(
  '/rules',
  authenticate,
  authorize('supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const parsed = RuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const { ruleName, ruleType, corridor, commodity, description, ruleConfig, isActive } = parsed.data;

    // Check for name conflicts at this version
    const existing = await query(
      `SELECT id FROM custom_rules WHERE rule_name = $1 AND version = 1`,
      [ruleName]
    );
    if (existing.rows.length > 0) {
      throw createError(`A rule named "${ruleName}" already exists.`, 409);
    }

    const result = await query(
      `INSERT INTO custom_rules
         (rule_name, rule_type, corridor, commodity, description, rule_config, is_active, created_by, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)
       RETURNING *`,
      [ruleName, ruleType, corridor || null, commodity || null, description || null,
       JSON.stringify(ruleConfig), isActive, req.user.id]
    );

    logger.info('Custom rule created', { ruleId: result.rows[0].id, createdBy: req.user.id });

    res.status(201).json({ success: true, rule: result.rows[0] });
  })
);

// ---------------------------------------------------------------------------
// PUT /api/config/rules/:id
// Update an existing custom rule (creates new version)
// ---------------------------------------------------------------------------
router.put(
  '/rules/:id',
  authenticate,
  authorize('supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await query(
      `SELECT * FROM custom_rules WHERE id = $1`,
      [id]
    );

    if (existing.rows.length === 0) {
      throw createError(`Rule ${id} not found.`, 404);
    }

    const parsed = RuleSchema.safeParse({ ...existing.rows[0], ...req.body });
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const { ruleName, ruleType, corridor, commodity, description, ruleConfig, isActive } = parsed.data;
    const currentVersion = existing.rows[0].version || 1;

    // Deactivate the old version and insert a new one
    await query(`UPDATE custom_rules SET is_active = false WHERE id = $1`, [id]);

    const result = await query(
      `INSERT INTO custom_rules
         (rule_name, rule_type, corridor, commodity, description, rule_config, is_active, created_by, version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [ruleName, ruleType, corridor || null, commodity || null, description || null,
       JSON.stringify(ruleConfig), isActive, req.user.id, currentVersion + 1]
    );

    logger.info('Custom rule updated', { oldId: id, newId: result.rows[0].id, updatedBy: req.user.id });

    res.json({ success: true, rule: result.rows[0] });
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/config/rules/:id/toggle
// Toggle rule active/inactive
// ---------------------------------------------------------------------------
router.patch(
  '/rules/:id/toggle',
  authenticate,
  authorize('supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const result = await query(
      `UPDATE custom_rules
       SET is_active = NOT is_active, updated_at = NOW()
       WHERE id = $1
       RETURNING id, rule_name, is_active`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      throw createError(`Rule ${req.params.id} not found.`, 404);
    }

    res.json({ success: true, rule: result.rows[0] });
  })
);

// ---------------------------------------------------------------------------
// GET /api/config/typologies
// List fraud typologies
// ---------------------------------------------------------------------------
router.get(
  '/typologies',
  authenticate,
  asyncHandler(async (req, res) => {
    const { riskLevel } = req.query;

    let whereClause = '';
    const params    = [];

    if (riskLevel) {
      const valid = ['critical', 'moderate', 'informational'];
      if (!valid.includes(riskLevel)) {
        throw createError(`Invalid riskLevel. Use: ${valid.join(', ')}`, 400);
      }
      whereClause = 'WHERE risk_level = $1';
      params.push(riskLevel);
    }

    const result = await query(
      `SELECT id, name, description, indicators, risk_level, created_at, updated_at
       FROM fraud_typologies
       ${whereClause}
       ORDER BY
         CASE risk_level WHEN 'critical' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
         name ASC`,
      params
    );

    res.json({ success: true, count: result.rows.length, typologies: result.rows });
  })
);

// ---------------------------------------------------------------------------
// POST /api/config/typologies  (compliance/admin only)
// ---------------------------------------------------------------------------
router.post(
  '/typologies',
  authenticate,
  authorize('compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const parsed = TypologySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const { name, description, indicators, riskLevel } = parsed.data;

    const result = await query(
      `INSERT INTO fraud_typologies (name, description, indicators, risk_level)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [name, description, JSON.stringify(indicators), riskLevel]
    );

    logger.info('Fraud typology created', { typologyId: result.rows[0].id, createdBy: req.user.id });

    res.status(201).json({ success: true, typology: result.rows[0] });
  })
);

// ---------------------------------------------------------------------------
// PUT /api/config/typologies/:id  (compliance/admin only)
// ---------------------------------------------------------------------------
router.put(
  '/typologies/:id',
  authenticate,
  authorize('compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;

    const existing = await query(`SELECT id FROM fraud_typologies WHERE id = $1`, [id]);
    if (existing.rows.length === 0) {
      throw createError(`Typology ${id} not found.`, 404);
    }

    const parsed = TypologySchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const updates = [];
    const params  = [];
    let paramIdx  = 1;

    if (parsed.data.name !== undefined)        { updates.push(`name = $${paramIdx++}`);        params.push(parsed.data.name); }
    if (parsed.data.description !== undefined) { updates.push(`description = $${paramIdx++}`); params.push(parsed.data.description); }
    if (parsed.data.indicators !== undefined)  { updates.push(`indicators = $${paramIdx++}`);  params.push(JSON.stringify(parsed.data.indicators)); }
    if (parsed.data.riskLevel !== undefined)   { updates.push(`risk_level = $${paramIdx++}`);  params.push(parsed.data.riskLevel); }

    if (updates.length === 0) {
      throw createError('No update fields provided.', 400);
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await query(
      `UPDATE fraud_typologies SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );

    res.json({ success: true, typology: result.rows[0] });
  })
);

module.exports = router;
