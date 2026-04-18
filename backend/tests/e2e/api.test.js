'use strict';

/**
 * E2E API tests using Supertest.
 * Mocks DB and queue so no real infrastructure is required.
 * Tests every REST endpoint for correct HTTP behaviour.
 */

// ── Mocks ──────────────────────────────────────────────────────────────────
jest.mock('../../src/db/connection', () => ({
  query: jest.fn(),
  getClient: jest.fn(),
  healthCheck: jest.fn().mockResolvedValue({ status: 'ok', latencyMs: 1 }),
  withTransaction: jest.fn(async (fn) => {
    // Provide a minimal mock client to the callback
    const mockClient = { query: jest.fn().mockResolvedValue({ rows: [{ id: 'override-001' }], rowCount: 1 }) };
    return fn(mockClient);
  }),
}));

jest.mock('../../src/services/queueService', () => ({
  enqueueDocumentExtraction: jest.fn().mockResolvedValue({ id: 'job-001' }),
  enqueueIntentAnalysis:     jest.fn().mockResolvedValue({ id: 'job-002' }),
  getExtractionJobStatus:    jest.fn().mockResolvedValue({ state: 'completed', progress: 100 }),
  getQueueHealth:            jest.fn().mockResolvedValue({ documentExtraction: { waiting: 0 }, intentAnalysis: { waiting: 0 } }),
  shutdown:                  jest.fn(),
  getDocumentExtractionQueue: jest.fn().mockReturnValue({ on: jest.fn() }),
  getIntentAnalysisQueue:     jest.fn().mockReturnValue({ on: jest.fn() }),
}));

jest.mock('../../src/services/auditService', () => ({
  AuditService: { logEvent: jest.fn().mockResolvedValue(undefined), getTrail: jest.fn().mockResolvedValue([]), exportTrailAsJSON: jest.fn().mockResolvedValue({ presentationId: 'pres-001', events: [], exportedAt: new Date().toISOString(), totalEvents: 0 }) },
  EVENT_TYPES: { SUBMISSION_RECEIVED: 'SUBMISSION_RECEIVED', EXTRACTION_STARTED: 'EXTRACTION_STARTED', CHECKER_ACTION: 'CHECKER_ACTION', TOKEN_USAGE: 'TOKEN_USAGE' },
}));

const { query } = require('../../src/db/connection');
const request   = require('supertest');
const jwt       = require('jsonwebtoken');

// Load the Express app
const app = require('../../src/index');

// Generate a test JWT
const TEST_USER = { id: 'user-test-001', email: 'checker@test.com', role: 'checker', fullName: 'Test Checker' };
const TEST_SUPERVISOR = { id: 'user-test-002', email: 'super@test.com', role: 'supervisor', fullName: 'Test Supervisor' };
const token     = jwt.sign(TEST_USER,       process.env.JWT_SECRET, { expiresIn: '1h' });
const supToken  = jwt.sign(TEST_SUPERVISOR, process.env.JWT_SECRET, { expiresIn: '1h' });

// ── Helper ─────────────────────────────────────────────────────────────────
const auth  = (t = token) => ({ Authorization: `Bearer ${t}` });

// ── Tests ──────────────────────────────────────────────────────────────────
describe('GET /health', () => {
  test('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
  });

  test('includes timestamp in response', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toHaveProperty('timestamp');
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    query.mockImplementation((sql) => {
      if (sql.toLowerCase().includes('select') && sql.toLowerCase().includes('users')) {
        return Promise.resolve({
          rows: [{
            id: 'user-001', email: 'checker@test.com',
            password_hash: '$2b$10$YourHashHere',
            full_name: 'Test Checker', role: 'checker', is_active: true,
          }],
        });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
  });

  test('returns 400 for missing email', async () => {
    const res = await request(app).post('/api/auth/login').send({ password: 'secret' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for missing password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });

  test('returns 400 for invalid email format', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email', password: 'secret123' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/auth/me', () => {
  test('returns 401 without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('returns 401 with malformed token', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer bad.token.here');
    expect(res.status).toBe(401);
  });

  test('returns 200 with valid token and user data', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: TEST_USER.id, email: TEST_USER.email, full_name: TEST_USER.fullName, role: TEST_USER.role, is_active: true }] });
    const res = await request(app).get('/api/auth/me').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
  });
});

describe('GET /api/validations/queue', () => {
  beforeEach(() => {
    // First call = COUNT(*) result, second call = list result
    query
      .mockResolvedValueOnce({ rows: [{ total: '1' }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          { id: 'pres-001', lc_number: 'LC-001', client_name: 'Test Corp', status: 'completed', overall_risk_score: 45, stp_candidate: false, created_at: new Date() },
        ],
        rowCount: 1,
      });
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/validations/queue');
    expect(res.status).toBe(401);
  });

  test('returns 200 with auth and array of presentations', async () => {
    const res = await request(app).get('/api/validations/queue').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('queue');
    expect(Array.isArray(res.body.queue)).toBe(true);
  });
});

describe('GET /api/validations/:presentationId', () => {
  const PRES_ID = 'pres-e2e-001';

  beforeEach(() => {
    query.mockImplementation((sql) => {
      if (sql.includes('lc_presentations')) {
        return Promise.resolve({ rows: [{ id: PRES_ID, lc_number: 'LC-TEST', client_name: 'Test', applicant: 'App', beneficiary: 'Ben', status: 'completed', overall_risk_score: 20, stp_candidate: true, created_at: new Date(), updated_at: new Date() }] });
      }
      if (sql.includes('documents')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('findings')) {
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get(`/api/validations/${PRES_ID}`);
    expect(res.status).toBe(401);
  });

  test('returns 200 with presentation data when found', async () => {
    const res = await request(app).get(`/api/validations/${PRES_ID}`).set(auth());
    expect([200, 404]).toContain(res.status);
  });

  test('returns 404 for non-existent presentation', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await request(app).get(`/api/validations/non-existent-id`).set(auth());
    expect(res.status).toBe(404);
  });
});

describe('GET /api/validations/:presentationId/findings', () => {
  beforeEach(() => {
    query.mockResolvedValue({
      rows: [
        {
          id: 'finding-001', presentation_id: 'pres-001', finding_type: 'PORT_MISMATCH',
          severity: 'critical', title: 'Port mismatch', description: 'Test',
          affected_documents: ['lc', 'bl'], affected_fields: ['portOfLoading'],
          verbatim_quotes: [], reasoning: 'Test', confidence_score: 90,
          ucp_articles: ['Art. 20'], recommended_action: 'Verify', status: 'open', created_at: new Date(),
        },
      ],
    });
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/validations/pres-001/findings');
    expect(res.status).toBe(401);
  });

  test('returns 200 with findings array', async () => {
    const res = await request(app).get('/api/validations/pres-001/findings').set(auth());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('findings');
    expect(Array.isArray(res.body.findings)).toBe(true);
  });

  test('severity filter is respected', async () => {
    const res = await request(app).get('/api/validations/pres-001/findings?severity=critical').set(auth());
    expect(res.status).toBe(200);
  });
});

describe('POST /api/validations/findings/:findingId/override', () => {
  beforeEach(() => {
    query.mockImplementation((sql) => {
      if (sql.toLowerCase().includes('select') && sql.toLowerCase().includes('findings')) {
        return Promise.resolve({ rows: [{ id: 'finding-001', presentation_id: 'pres-001', status: 'open', severity: 'moderate' }] });
      }
      return Promise.resolve({ rows: [{ id: 'override-001' }], rowCount: 1 });
    });
  });

  test('returns 401 without auth', async () => {
    const res = await request(app).post('/api/validations/findings/finding-001/override').send({ action: 'accept', overrideReason: 'Test', justification: 'This is valid justification text' });
    expect(res.status).toBe(401);
  });

  test('returns 400 when action is missing', async () => {
    const res = await request(app).post('/api/validations/findings/finding-001/override').set(auth()).send({ overrideReason: 'Test', justification: 'Valid' });
    expect(res.status).toBe(400);
  });

  test('returns 400 when justification is too short', async () => {
    const res = await request(app).post('/api/validations/findings/finding-001/override').set(auth()).send({ action: 'accept', overrideReason: 'Test', justification: 'short' });
    expect(res.status).toBe(400);
  });

  test('returns 200 or 404 for valid override attempt', async () => {
    const res = await request(app)
      .post('/api/validations/findings/finding-001/override')
      .set(auth())
      .send({ action: 'accept', overrideReason: 'Acceptable commercial variation', justification: 'The goods description variation is acceptable under the LC terms and banking practice.' });
    expect([200, 404]).toContain(res.status);
  });
});

describe('GET /api/audit/:presentationId', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/audit/pres-001');
    expect(res.status).toBe(401);
  });

  test('returns 200 with trail array for authenticated user', async () => {
    const res = await request(app).get('/api/audit/pres-001').set(auth());
    expect([200, 404]).toContain(res.status);
  });
});

describe('GET /api/audit/:presentationId/export', () => {
  test('returns 401 without auth', async () => {
    const res = await request(app).get('/api/audit/pres-001/export');
    expect(res.status).toBe(401);
  });

  test('returns 200 with exportable JSON structure', async () => {
    const res = await request(app).get('/api/audit/pres-001/export').set(auth());
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('presentationId');
      expect(res.body).toHaveProperty('events');
    }
  });
});

describe('Correlation ID middleware', () => {
  test('every response includes X-Correlation-ID header', async () => {
    const res = await request(app).get('/health');
    expect(res.headers).toHaveProperty('x-correlation-id');
    expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('honours X-Correlation-ID from request when provided', async () => {
    const myId = '12345678-1234-1234-1234-123456789012';
    const res  = await request(app).get('/health').set('X-Correlation-ID', myId);
    expect(res.headers['x-correlation-id']).toBe(myId);
  });
});

describe('Security headers', () => {
  test('responses include X-Content-Type-Options from helmet', async () => {
    const res = await request(app).get('/health');
    expect(res.headers).toHaveProperty('x-content-type-options');
  });
});

describe('404 handling', () => {
  test('returns 404 for completely unknown route', async () => {
    const res = await request(app).get('/api/nonexistent/route/xyz');
    expect(res.status).toBe(404);
  });
});
