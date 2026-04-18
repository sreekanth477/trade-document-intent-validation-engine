'use strict';

// Mock the DB connection so audit tests don't need a real PostgreSQL instance
jest.mock('../../src/db/connection', () => ({
  query: jest.fn(),
}));

const { query } = require('../../src/db/connection');
const { AuditService, EVENT_TYPES } = require('../../src/services/auditService');

describe('AuditService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: simulate a successful INSERT returning an audit record row
    query.mockResolvedValue({ rows: [{ id: 'audit-test-001', created_at: new Date() }], rowCount: 1 });
  });

  describe('EVENT_TYPES', () => {
    test('contains all 11 expected event types including TOKEN_USAGE', () => {
      const expected = [
        'SUBMISSION_RECEIVED', 'EXTRACTION_STARTED', 'EXTRACTION_COMPLETED',
        'EXTRACTION_FAILED', 'ANALYSIS_STARTED', 'ANALYSIS_COMPLETED',
        'FINDING_CREATED', 'CHECKER_ACTION', 'SUPERVISOR_APPROVED',
        'FINAL_DISPOSITION', 'TOKEN_USAGE',
      ];
      for (const type of expected) {
        expect(EVENT_TYPES).toHaveProperty(type);
        expect(typeof EVENT_TYPES[type]).toBe('string');
      }
    });
  });

  describe('logEvent()', () => {
    test('calls query with correct table and columns', async () => {
      await AuditService.logEvent('pres-001', EVENT_TYPES.SUBMISSION_RECEIVED, { fileName: 'test.pdf' }, 'user-001', 'John Smith');
      expect(query).toHaveBeenCalledTimes(1);
      const [sql] = query.mock.calls[0];
      expect(sql.toLowerCase()).toContain('audit_trail');
      expect(sql.toLowerCase()).toContain('insert');
    });

    test('calls query even without optional userId/userName', async () => {
      await AuditService.logEvent('pres-002', EVENT_TYPES.ANALYSIS_STARTED, {});
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('passes eventData as JSON-serialisable value', async () => {
      const eventData = { findingCount: 3, score: 75 };
      await AuditService.logEvent('pres-003', EVENT_TYPES.ANALYSIS_COMPLETED, eventData);
      const [, params] = query.mock.calls[0];
      // eventData should appear somewhere in the params (as JSON string or object)
      const paramsStr = JSON.stringify(params);
      expect(paramsStr).toContain('findingCount');
    });
  });

  describe('getTrail()', () => {
    test('queries audit_trail filtered by presentation_id', async () => {
      query.mockResolvedValueOnce({ rows: [{ event_type: 'SUBMISSION_RECEIVED', created_at: new Date() }] });
      const trail = await AuditService.getTrail('pres-004');
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params] = query.mock.calls[0];
      expect(sql.toLowerCase()).toContain('audit_trail');
      expect(params).toContain('pres-004');
    });
  });

  describe('exportTrailAsJSON()', () => {
    test('returns a structured object with presentationId and events', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { id: 'evt-1', event_type: 'SUBMISSION_RECEIVED', event_data: {}, user_name: 'System', created_at: new Date() },
          { id: 'evt-2', event_type: 'EXTRACTION_COMPLETED', event_data: { confidence: 0.92 }, user_name: 'System', created_at: new Date() },
        ],
      });
      const exported = await AuditService.exportTrailAsJSON('pres-005');
      expect(exported).toHaveProperty('presentationId', 'pres-005');
      expect(exported).toHaveProperty('events');
      expect(Array.isArray(exported.events)).toBe(true);
      expect(exported.events.length).toBe(2);
    });
  });
});
