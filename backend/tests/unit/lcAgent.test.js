'use strict';

const LCAgent = require('../../src/agents/lcAgent');

describe('LCAgent', () => {
  let agent;

  beforeEach(() => {
    agent = new LCAgent();
  });

  // ─────────────────────────────────────────────
  // extract() — mock mode
  // ─────────────────────────────────────────────
  describe('extract() with USE_MOCK_LLM=true', () => {
    test('returns structured extraction result with documentType = lc', async () => {
      const result = await agent.extract('IRREVOCABLE DOCUMENTARY CREDIT No. LC-TEST-001\nIssuing Bank: TEST BANK\nApplicant: TEST APPLICANT\nBeneficiary: TEST BENEFICIARY\nAmount: USD 100,000\nExpiry: 31/12/2025', 'doc-001');
      expect(result).toHaveProperty('documentType', 'lc');
      expect(result).toHaveProperty('fields');
      expect(result).toHaveProperty('overallConfidence');
      expect(result).toHaveProperty('extractedAt');
    });

    test('all required scalar fields are present in output', async () => {
      const result = await agent.extract('IRREVOCABLE DOCUMENTARY CREDIT\nAmount: USD 50,000\nExpiry: 01/06/2025\nBeneficiary: ABC CORP', 'doc-002');
      const requiredFields = ['lcNumber', 'applicant', 'beneficiary', 'issuingBank', 'currency', 'amount', 'expiryDate', 'portOfLoading', 'portOfDischarge', 'goodsDescription'];
      for (const f of requiredFields) {
        expect(result.fields).toHaveProperty(f);
        expect(result.fields[f]).toHaveProperty('value');
        expect(result.fields[f]).toHaveProperty('verbatimSource');
        expect(result.fields[f]).toHaveProperty('confidence');
        expect(result.fields[f]).toHaveProperty('ucpArticle');
      }
    });

    test('throws if document text is too short', async () => {
      await expect(agent.extract('short', 'doc-003')).rejects.toThrow(/too short/i);
    });

    test('throws if document text is empty', async () => {
      await expect(agent.extract('', 'doc-004')).rejects.toThrow();
    });

    test('overallConfidence is a number between 0 and 1', async () => {
      const result = await agent.extract('IRREVOCABLE DOCUMENTARY CREDIT\nAmount: USD 50,000\nExpiry: 01/06/2025\nBeneficiary: ABC CORP', 'doc-005');
      expect(typeof result.overallConfidence).toBe('number');
      expect(result.overallConfidence).toBeGreaterThanOrEqual(0);
      expect(result.overallConfidence).toBeLessThanOrEqual(1);
    });
  });

  // ─────────────────────────────────────────────
  // mapToStandardSchema()
  // ─────────────────────────────────────────────
  describe('mapToStandardSchema()', () => {
    test('normalises missing fields to NOT_FOUND with confidence 0', () => {
      const result = agent.mapToStandardSchema({}, 'doc-006');
      expect(result.fields.lcNumber.value).toBe('NOT_FOUND');
      expect(result.fields.lcNumber.confidence).toBe(0);
    });

    test('clamps confidence above 1 to 1', () => {
      const raw = { lcNumber: { value: 'LC-001', verbatimSource: 'LC-001', confidence: 5.0, ucpArticle: 'Art. 6' } };
      const result = agent.mapToStandardSchema(raw, 'doc-007');
      expect(result.fields.lcNumber.confidence).toBe(1);
    });

    test('clamps confidence below 0 to 0', () => {
      const raw = { lcNumber: { value: 'LC-001', verbatimSource: 'LC-001', confidence: -0.5, ucpArticle: 'Art. 6' } };
      const result = agent.mapToStandardSchema(raw, 'doc-008');
      expect(result.fields.lcNumber.confidence).toBe(0);
    });

    test('null value is converted to NOT_FOUND', () => {
      const raw = { beneficiary: { value: null, verbatimSource: '', confidence: 0, ucpArticle: 'Art. 2' } };
      const result = agent.mapToStandardSchema(raw, 'doc-009');
      expect(result.fields.beneficiary.value).toBe('NOT_FOUND');
    });

    test('documentRequirements and specialConditions default to empty arrays', () => {
      const result = agent.mapToStandardSchema({}, 'doc-010');
      expect(Array.isArray(result.fields.documentRequirements)).toBe(true);
      expect(Array.isArray(result.fields.specialConditions)).toBe(true);
    });

    test('valid full extraction is preserved correctly', () => {
      const raw = {
        lcNumber:    { value: 'LC-2024-001', verbatimSource: 'No. LC-2024-001', confidence: 1.0, ucpArticle: 'Art. 6' },
        beneficiary: { value: 'SIEMENS AG', verbatimSource: 'Beneficiary: SIEMENS AG', confidence: 0.98, ucpArticle: 'Art. 2' },
        amount:      { value: '2450000.00', verbatimSource: 'EUR 2,450,000.00', confidence: 1.0, ucpArticle: 'Art. 30' },
      };
      const result = agent.mapToStandardSchema(raw, 'doc-011');
      expect(result.fields.lcNumber.value).toBe('LC-2024-001');
      expect(result.fields.beneficiary.value).toBe('SIEMENS AG');
      expect(result.fields.amount.value).toBe('2450000.00');
      expect(result.documentType).toBe('lc');
    });
  });
});
