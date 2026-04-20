'use strict';

const express = require('express');

const { authenticate, authorize }   = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');
const { AuditService }              = require('../services/auditService');
const { query }                     = require('../db/connection');

const router = express.Router();

// ---------------------------------------------------------------------------
// GET /api/audit/system/recent  (admin / compliance only)
// Recent system-wide audit events for the admin dashboard.
// IMPORTANT: registered BEFORE /:presentationId to prevent route shadowing.
// ---------------------------------------------------------------------------
router.get(
  '/system/recent',
  authenticate,
  authorize('admin', 'compliance'),
  asyncHandler(async (req, res) => {
    const { limit = 50, offset = 0 } = req.query;

    const events = await AuditService.getRecentEvents(
      parseInt(limit, 10),
      parseInt(offset, 10)
    );

    res.json({
      success: true,
      count:   events.length,
      events,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/audit/:presentationId
// Get full audit trail for a presentation.
// Restricted to supervisor, compliance, and admin — audit trails contain
// user IP addresses, override justifications, and PII-adjacent metadata.
// ---------------------------------------------------------------------------
router.get(
  '/:presentationId',
  authenticate,
  authorize('supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;
    const { limit = 500, offset = 0, eventType } = req.query;

    // Verify presentation exists
    const presResult = await query(
      `SELECT id, lc_number, status FROM lc_presentations WHERE id = $1`,
      [presentationId]
    );
    if (presResult.rows.length === 0) {
      throw createError(`Presentation ${presentationId} not found.`, 404);
    }

    let trail;
    if (eventType) {
      trail = await AuditService.getEventsByType(presentationId, eventType);
    } else {
      trail = await AuditService.getTrail(presentationId);
    }

    // Paginate
    const total      = trail.length;
    const paginated  = trail.slice(parseInt(offset, 10), parseInt(offset, 10) + parseInt(limit, 10));

    res.json({
      success:        true,
      presentationId,
      presentation:   presResult.rows[0],
      total,
      limit:          parseInt(limit, 10),
      offset:         parseInt(offset, 10),
      events:         paginated,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/audit/:presentationId/export
// Export full audit trail as structured JSON (regulatory-grade artefact).
// Restricted to supervisor, compliance, and admin — export contains IP
// addresses, user names, and full decision justifications.
// ---------------------------------------------------------------------------
router.get(
  '/:presentationId/export',
  authenticate,
  authorize('supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;

    const exported = await AuditService.exportTrailAsJSON(presentationId);

    if (!exported.presentation) {
      throw createError(`Presentation ${presentationId} not found.`, 404);
    }

    // Log the export event itself
    await AuditService.logEvent(
      presentationId,
      'EXPORT_REQUESTED',
      { format: 'json', requestedBy: req.user.id },
      req.user.id,
      req.user.fullName || req.user.email,
      req.ip
    );

    res.json({
      success: true,
      export:  exported,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/audit/:presentationId/statistics
// Statistics breakdown by event type.
// Restricted to supervisor, compliance, and admin (same as trail).
// ---------------------------------------------------------------------------
router.get(
  '/:presentationId/statistics',
  authenticate,
  authorize('supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;

    const stats = await AuditService.getStatistics(presentationId);

    res.json({
      success:    true,
      statistics: stats,
    });
  })
);

module.exports = router;
