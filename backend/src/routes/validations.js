'use strict';

const express = require('express');
const { z }   = require('zod');

const { authenticate, authorize }   = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');
const { query, withTransaction }    = require('../db/connection');
const { enqueueIntentAnalysis }     = require('../services/queueService');
const { AuditService, EVENT_TYPES } = require('../services/auditService');
const logger = require('../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const OverrideSchema = z.object({
  action:          z.enum(['accept', 'override', 'escalate']),
  justification:   z.string().min(10, 'Justification must be at least 10 characters'),
  overrideReason:  z.string().optional(),
});

// ---------------------------------------------------------------------------
// POST /api/validations/:presentationId/start
// Manually trigger intent analysis (useful for re-runs)
// ---------------------------------------------------------------------------
router.post(
  '/:presentationId/start',
  authenticate,
  authorize('checker', 'supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;

    // Verify presentation exists
    const presResult = await query(
      `SELECT id, status FROM lc_presentations WHERE id = $1`,
      [presentationId]
    );
    if (presResult.rows.length === 0) {
      throw createError(`Presentation ${presentationId} not found.`, 404);
    }

    const presentation = presResult.rows[0];

    // Ensure at least one completed document exists
    const docResult = await query(
      `SELECT COUNT(*) AS cnt FROM documents
       WHERE presentation_id = $1 AND extraction_status = 'completed'`,
      [presentationId]
    );
    if (parseInt(docResult.rows[0].cnt, 10) === 0) {
      throw createError('No extracted documents available. Upload and extract documents first.', 400);
    }

    // Reset status to pending if re-running
    await query(
      `UPDATE lc_presentations SET status = 'pending', updated_at = NOW() WHERE id = $1`,
      [presentationId]
    );

    const job = await enqueueIntentAnalysis(presentationId);

    await AuditService.logEvent(
      presentationId,
      EVENT_TYPES.ANALYSIS_STARTED,
      { triggeredBy: req.user.id, jobId: job.id },
      req.user.id,
      req.user.fullName || req.user.email,
      req.ip
    );

    res.status(202).json({
      success:        true,
      message:        'Intent analysis queued.',
      presentationId,
      jobId:          job.id,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/validations/:presentationId
// Get full validation result for a presentation
// ---------------------------------------------------------------------------
router.get(
  '/:presentationId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;

    const presResult = await query(
      `SELECT
         id, lc_number, client_name, applicant, beneficiary,
         status, overall_risk_score, stp_candidate, created_at, updated_at
       FROM lc_presentations
       WHERE id = $1`,
      [presentationId]
    );

    if (presResult.rows.length === 0) {
      throw createError(`Presentation ${presentationId} not found.`, 404);
    }

    const presentation = presResult.rows[0];

    // Get finding summary
    const summaryResult = await query(
      `SELECT
         severity,
         COUNT(*) AS count
       FROM findings
       WHERE presentation_id = $1
       GROUP BY severity`,
      [presentationId]
    );

    const summary = { critical: 0, moderate: 0, informational: 0 };
    for (const row of summaryResult.rows) {
      summary[row.severity] = parseInt(row.count, 10);
    }

    // Get documents summary
    const docsResult = await query(
      `SELECT document_type, extraction_status, COUNT(*) AS count
       FROM documents
       WHERE presentation_id = $1
       GROUP BY document_type, extraction_status`,
      [presentationId]
    );

    res.json({
      success: true,
      presentation: {
        ...presentation,
        findingSummary: summary,
        documents:      docsResult.rows,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/validations/:presentationId/findings
// Get detailed findings list for a presentation
// ---------------------------------------------------------------------------
router.get(
  '/:presentationId/findings',
  authenticate,
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;
    const { severity, status, limit = 100, offset = 0 } = req.query;

    let whereClause = 'WHERE f.presentation_id = $1';
    const params    = [presentationId];
    let paramIdx    = 2;

    if (severity) {
      const validSeverities = ['critical', 'moderate', 'informational'];
      if (!validSeverities.includes(severity)) {
        throw createError(`Invalid severity filter. Use: ${validSeverities.join(', ')}`, 400);
      }
      whereClause += ` AND f.severity = $${paramIdx}`;
      params.push(severity);
      paramIdx++;
    }

    if (status) {
      const validStatuses = ['open', 'accepted', 'overridden', 'escalated'];
      if (!validStatuses.includes(status)) {
        throw createError(`Invalid status filter. Use: ${validStatuses.join(', ')}`, 400);
      }
      whereClause += ` AND f.status = $${paramIdx}`;
      params.push(status);
      paramIdx++;
    }

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM findings f ${whereClause}`,
      params
    );

    const result = await query(
      `SELECT
         f.id, f.finding_type, f.severity, f.title, f.description,
         f.affected_documents, f.affected_fields, f.verbatim_quotes,
         f.reasoning, f.confidence_score, f.ucp_articles,
         f.recommended_action, f.status, f.created_at,
         o.action AS override_action,
         o.user_name AS override_by,
         o.justification AS override_justification,
         o.created_at AS override_at
       FROM findings f
       LEFT JOIN LATERAL (
         SELECT action, user_name, justification, created_at
         FROM overrides
         WHERE finding_id = f.id
         ORDER BY created_at DESC
         LIMIT 1
       ) o ON true
       ${whereClause}
       ORDER BY
         CASE f.severity
           WHEN 'critical'      THEN 1
           WHEN 'moderate'      THEN 2
           WHEN 'informational' THEN 3
         END,
         f.confidence_score DESC,
         f.created_at ASC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, parseInt(limit, 10), parseInt(offset, 10)]
    );

    res.json({
      success:  true,
      total:    parseInt(countResult.rows[0].total, 10),
      limit:    parseInt(limit, 10),
      offset:   parseInt(offset, 10),
      findings: result.rows,
    });
  })
);

// ---------------------------------------------------------------------------
// POST /api/validations/findings/:findingId/override
// Checker records an accept/override/escalate decision
// ---------------------------------------------------------------------------
router.post(
  '/findings/:findingId/override',
  authenticate,
  authorize('checker', 'supervisor', 'compliance', 'admin'),
  asyncHandler(async (req, res) => {
    const { findingId } = req.params;

    // Validate body
    const parsed = OverrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error:   'Invalid request body',
        details: parsed.error.errors.map(e => ({ path: e.path.join('.'), message: e.message })),
      });
    }

    const { action, justification, overrideReason } = parsed.data;
    const userId   = req.user.id;
    const userName = req.user.fullName || req.user.email;

    // Get the finding
    const findingResult = await query(
      `SELECT id, presentation_id, severity, title, status FROM findings WHERE id = $1`,
      [findingId]
    );
    if (findingResult.rows.length === 0) {
      throw createError(`Finding ${findingId} not found.`, 404);
    }

    const finding = findingResult.rows[0];

    // Escalation requires supervisor role
    if (action === 'escalate' && !['supervisor', 'compliance', 'admin'].includes(req.user.role)) {
      throw createError('Only supervisors and compliance officers may escalate findings.', 403);
    }

    // Map action to finding status
    const statusMap = { accept: 'accepted', override: 'overridden', escalate: 'escalated' };
    const newStatus = statusMap[action];

    await withTransaction(async (client) => {
      // Insert override record
      await client.query(
        `INSERT INTO overrides (finding_id, user_id, user_name, action, override_reason, justification)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [findingId, userId, userName, action, overrideReason || null, justification]
      );

      // Update finding status
      await client.query(
        `UPDATE findings SET status = $1 WHERE id = $2`,
        [newStatus, findingId]
      );
    });

    // Audit log
    await AuditService.logEvent(
      finding.presentation_id,
      EVENT_TYPES.OVERRIDE_RECORDED,
      {
        findingId,
        findingTitle:  finding.title,
        severity:      finding.severity,
        action,
        justification,
        overrideReason,
      },
      userId,
      userName,
      req.ip
    );

    logger.info('Checker action recorded', { findingId, action, userId });

    res.json({
      success:   true,
      message:   `Finding ${action}ed successfully.`,
      findingId,
      newStatus,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/validations/queue
// Get review queue ordered by risk score descending
// ---------------------------------------------------------------------------
router.get(
  '/queue',
  authenticate,
  asyncHandler(async (req, res) => {
    const { status = 'completed', limit = 50, offset = 0 } = req.query;

    const validStatuses = ['pending', 'processing', 'completed', 'failed'];
    if (!validStatuses.includes(status)) {
      throw createError(`Invalid status. Use: ${validStatuses.join(', ')}`, 400);
    }

    const countResult = await query(
      `SELECT COUNT(*) AS total FROM lc_presentations WHERE status = $1`,
      [status]
    );

    const result = await query(
      `SELECT
         lp.id, lp.lc_number, lp.client_name, lp.applicant, lp.beneficiary,
         lp.status, lp.overall_risk_score, lp.stp_candidate,
         lp.created_at, lp.updated_at,
         COUNT(f.id) AS total_findings,
         COUNT(f.id) FILTER (WHERE f.severity = 'critical' AND f.status = 'open') AS open_critical,
         COUNT(f.id) FILTER (WHERE f.severity = 'moderate' AND f.status = 'open') AS open_moderate,
         COUNT(d.id) AS document_count
       FROM lc_presentations lp
       LEFT JOIN findings f ON f.presentation_id = lp.id
       LEFT JOIN documents d ON d.presentation_id = lp.id
       WHERE lp.status = $1
       GROUP BY lp.id
       ORDER BY lp.overall_risk_score DESC NULLS LAST, lp.created_at ASC
       LIMIT $2 OFFSET $3`,
      [status, parseInt(limit, 10), parseInt(offset, 10)]
    );

    res.json({
      success: true,
      total:   parseInt(countResult.rows[0].total, 10),
      limit:   parseInt(limit, 10),
      offset:  parseInt(offset, 10),
      queue:   result.rows,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/validations/:presentationId/summary
// Machine-readable summary for dashboard widgets
// ---------------------------------------------------------------------------
router.get(
  '/:presentationId/summary',
  authenticate,
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;

    const [presResult, findingsResult, docsResult] = await Promise.all([
      query(
        `SELECT id, lc_number, status, overall_risk_score, stp_candidate, created_at, updated_at
         FROM lc_presentations WHERE id = $1`,
        [presentationId]
      ),
      query(
        `SELECT severity, status, COUNT(*) AS count
         FROM findings WHERE presentation_id = $1
         GROUP BY severity, status`,
        [presentationId]
      ),
      query(
        `SELECT document_type, extraction_status, COUNT(*) AS count
         FROM documents WHERE presentation_id = $1
         GROUP BY document_type, extraction_status`,
        [presentationId]
      ),
    ]);

    if (presResult.rows.length === 0) {
      throw createError(`Presentation ${presentationId} not found.`, 404);
    }

    res.json({
      success:      true,
      presentation: presResult.rows[0],
      findings:     findingsResult.rows,
      documents:    docsResult.rows,
    });
  })
);

module.exports = router;
