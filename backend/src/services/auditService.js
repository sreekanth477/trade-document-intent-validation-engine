'use strict';

const { query } = require('../db/connection');
const logger    = require('../utils/logger');

// ---------------------------------------------------------------------------
// Audit Trail Service
// All events are written as immutable append-only records.
// No updates or deletes are ever issued to the audit_trail table.
// ---------------------------------------------------------------------------

const EVENT_TYPES = {
  SUBMISSION_RECEIVED:    'SUBMISSION_RECEIVED',
  EXTRACTION_STARTED:     'EXTRACTION_STARTED',
  EXTRACTION_COMPLETED:   'EXTRACTION_COMPLETED',
  EXTRACTION_FAILED:      'EXTRACTION_FAILED',
  ANALYSIS_STARTED:       'ANALYSIS_STARTED',
  ANALYSIS_COMPLETED:     'ANALYSIS_COMPLETED',
  ANALYSIS_FAILED:        'ANALYSIS_FAILED',
  FINDING_CREATED:        'FINDING_CREATED',
  CHECKER_ACTION:         'CHECKER_ACTION',
  OVERRIDE_RECORDED:      'OVERRIDE_RECORDED',
  SUPERVISOR_APPROVED:    'SUPERVISOR_APPROVED',
  SUPERVISOR_REJECTED:    'SUPERVISOR_REJECTED',
  FINAL_DISPOSITION:      'FINAL_DISPOSITION',
  EXPORT_REQUESTED:       'EXPORT_REQUESTED',
  STATUS_CHANGED:         'STATUS_CHANGED',
  DOCUMENT_UPLOADED:      'DOCUMENT_UPLOADED',
  CLASSIFICATION_UPDATED: 'CLASSIFICATION_UPDATED',
};

class AuditService {
  /**
   * Log an immutable audit event.
   * @param {string}      presentationId - UUID of the LC presentation
   * @param {string}      eventType      - One of EVENT_TYPES
   * @param {object}      eventData      - Structured event payload (JSONB)
   * @param {string|null} userId         - UUID of acting user (null for system)
   * @param {string|null} userName       - Display name of acting user
   * @param {string|null} ipAddress      - Client IP address if available
   * @returns {Promise<object>}           - Created audit record
   */
  async logEvent(presentationId, eventType, eventData = {}, userId = null, userName = null, ipAddress = null) {
    try {
      const result = await query(
        `INSERT INTO audit_trail
           (presentation_id, event_type, event_data, user_id, user_name, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          presentationId || null,
          eventType,
          JSON.stringify(eventData),
          userId || null,
          userName || null,
          ipAddress || null,
        ]
      );

      const record = result.rows[0];
      logger.debug('AuditService: event logged', {
        auditId:        record.id,
        presentationId,
        eventType,
        userId,
      });
      return record;
    } catch (err) {
      // Audit failures must never silently swallow - log error but don't crash pipeline
      logger.error('AuditService: failed to log event', {
        presentationId,
        eventType,
        error: err.message,
      });
      // Re-throw so callers can decide whether to fail hard
      throw err;
    }
  }

  /**
   * Get the complete audit trail for a presentation, ordered chronologically.
   * @param {string} presentationId
   * @returns {Promise<Array<object>>}
   */
  async getTrail(presentationId) {
    const result = await query(
      `SELECT
         id,
         presentation_id,
         event_type,
         event_data,
         user_id,
         user_name,
         ip_address,
         created_at
       FROM audit_trail
       WHERE presentation_id = $1
       ORDER BY created_at ASC`,
      [presentationId]
    );
    return result.rows;
  }

  /**
   * Get audit events for a specific event type within a presentation.
   * @param {string} presentationId
   * @param {string} eventType
   * @returns {Promise<Array<object>>}
   */
  async getEventsByType(presentationId, eventType) {
    const result = await query(
      `SELECT * FROM audit_trail
       WHERE presentation_id = $1 AND event_type = $2
       ORDER BY created_at ASC`,
      [presentationId, eventType]
    );
    return result.rows;
  }

  /**
   * Export the full audit trail for a presentation as a structured JSON object.
   * Suitable for regulatory reporting or archival.
   * @param {string} presentationId
   * @returns {Promise<object>}
   */
  async exportTrailAsJSON(presentationId) {
    const events = await this.getTrail(presentationId);

    // Get presentation summary
    const presResult = await query(
      `SELECT
         id, lc_number, client_name, applicant, beneficiary,
         status, overall_risk_score, stp_candidate, created_at, updated_at
       FROM lc_presentations
       WHERE id = $1`,
      [presentationId]
    );

    const presentation = presResult.rows[0] || null;

    return {
      exportedAt:     new Date().toISOString(),
      presentationId,
      presentation,
      eventCount:     events.length,
      firstEvent:     events.length > 0 ? events[0].created_at : null,
      lastEvent:      events.length > 0 ? events[events.length - 1].created_at : null,
      events: events.map(e => ({
        id:             e.id,
        eventType:      e.event_type,
        eventData:      e.event_data,
        userId:         e.user_id,
        userName:       e.user_name,
        ipAddress:      e.ip_address,
        timestamp:      e.created_at,
      })),
    };
  }

  /**
   * Get audit statistics for a presentation.
   * @param {string} presentationId
   * @returns {Promise<object>}
   */
  async getStatistics(presentationId) {
    const result = await query(
      `SELECT
         event_type,
         COUNT(*) AS count,
         MIN(created_at) AS first_occurrence,
         MAX(created_at) AS last_occurrence
       FROM audit_trail
       WHERE presentation_id = $1
       GROUP BY event_type
       ORDER BY MIN(created_at)`,
      [presentationId]
    );

    return {
      presentationId,
      eventBreakdown: result.rows,
    };
  }

  /**
   * Get recent system-wide audit events (for admin dashboard).
   * @param {number} limit
   * @param {number} offset
   * @returns {Promise<Array<object>>}
   */
  async getRecentEvents(limit = 50, offset = 0) {
    const result = await query(
      `SELECT
         at.id,
         at.presentation_id,
         lp.lc_number,
         at.event_type,
         at.user_name,
         at.created_at
       FROM audit_trail at
       LEFT JOIN lc_presentations lp ON lp.id = at.presentation_id
       ORDER BY at.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return result.rows;
  }
}

module.exports = { AuditService: new AuditService(), EVENT_TYPES, AuditServiceClass: AuditService };
