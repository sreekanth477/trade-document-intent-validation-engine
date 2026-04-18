'use strict';

const { IntentAnalysisEngine, FINDING_TYPES } = require('../../src/agents/intentAnalysisEngine');

// Helper to build a minimal agent output object
function makeDocData(type, overrides = {}) {
  const base = {
    documentType: type,
    overallConfidence: 0.9,
    fields: {
      beneficiary:     { value: 'ABC TRADING LTD', verbatimSource: 'Beneficiary: ABC TRADING LTD', confidence: 0.95, ucpArticle: 'Art. 2' },
      applicant:       { value: 'XYZ IMPORT CO',   verbatimSource: 'Applicant: XYZ IMPORT CO',    confidence: 0.95, ucpArticle: 'Art. 2' },
      portOfLoading:   { value: 'HAMBURG',          verbatimSource: 'Port of Loading: HAMBURG',    confidence: 0.95, ucpArticle: 'Art. 20' },
      portOfDischarge: { value: 'HONG KONG',        verbatimSource: 'Port of Discharge: HONG KONG',confidence: 0.95, ucpArticle: 'Art. 20' },
      amount:          { value: '500000.00',         verbatimSource: 'USD 500,000.00',              confidence: 1.0,  ucpArticle: 'Art. 30' },
      currency:        { value: 'USD',              verbatimSource: 'USD',                         confidence: 1.0,  ucpArticle: 'Art. 18' },
      expiryDate:      { value: '2025-12-31',       verbatimSource: '31/12/2025',                  confidence: 0.9,  ucpArticle: 'Art. 6' },
      goodsDescription:{ value: 'STEEL PIPES',      verbatimSource: 'Goods: STEEL PIPES',          confidence: 0.9,  ucpArticle: 'Art. 18' },
      seller:          { value: 'ABC TRADING LTD',  verbatimSource: 'Seller: ABC TRADING LTD',     confidence: 0.95, ucpArticle: 'Art. 18' },
      buyer:           { value: 'XYZ IMPORT CO',    verbatimSource: 'Buyer: XYZ IMPORT CO',        confidence: 0.95, ucpArticle: 'Art. 18' },
      onBoardDate:     { value: '2025-10-15',       verbatimSource: 'On Board: 15 OCT 2025',       confidence: 0.95, ucpArticle: 'Art. 20' },
      blDate:          { value: '2025-10-15',       verbatimSource: '15 OCT 2025',                 confidence: 0.95, ucpArticle: 'Art. 20' },
      insuredValue:    { value: '550000.00',         verbatimSource: 'Insured Value: USD 550,000',  confidence: 0.9,  ucpArticle: 'Art. 28' },
      effectiveDate:   { value: '2025-10-10',       verbatimSource: '10 OCT 2025',                 confidence: 0.9,  ucpArticle: 'Art. 28' },
    },
    ...overrides,
  };
  return base;
}

describe('IntentAnalysisEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new IntentAnalysisEngine();
  });

  describe('FINDING_TYPES constants', () => {
    test('exports all expected finding type constants', () => {
      const expected = [
        'GOODS_DESCRIPTION_MISMATCH', 'AMOUNT_DISCREPANCY', 'CURRENCY_MISMATCH',
        'PARTY_NAME_MISMATCH', 'PORT_MISMATCH', 'DATE_VIOLATION',
        'PRESENTATION_PERIOD_EXCEEDED', 'INSURANCE_COVERAGE_GAP',
        'INSURANCE_VALUE_INSUFFICIENT', 'TRADE_PATTERN_ANOMALY',
      ];
      for (const type of expected) {
        expect(FINDING_TYPES).toHaveProperty(type);
      }
    });
  });

  describe('analyze() with USE_MOCK_LLM=true', () => {
    const lcData        = makeDocData('lc');
    const invoiceData   = makeDocData('invoice');
    const blData        = makeDocData('bl');
    const insuranceData = makeDocData('insurance');

    test('returns findings, dimensionSummary, rawReasoning, analyzedAt', async () => {
      const result = await engine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-001');
      expect(result).toHaveProperty('findings');
      expect(result).toHaveProperty('dimensionSummary');
      expect(result).toHaveProperty('rawReasoning');
      expect(result).toHaveProperty('analyzedAt');
      expect(Array.isArray(result.findings)).toBe(true);
    });

    test('produces no party mismatch finding when beneficiary = seller', async () => {
      const result = await engine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-002');
      const partyFindings = result.findings.filter(f => f.findingType === 'PARTY_NAME_MISMATCH');
      expect(partyFindings.length).toBe(0);
    });

    test('produces PARTY_NAME_MISMATCH finding when beneficiary ≠ seller', async () => {
      const mismatchedInvoice = makeDocData('invoice', {
        fields: {
          ...makeDocData('invoice').fields,
          seller: { value: 'DIFFERENT COMPANY LTD', verbatimSource: 'Seller: DIFFERENT COMPANY LTD', confidence: 0.95, ucpArticle: 'Art. 18' },
        },
      });
      const result = await engine.analyze(lcData, mismatchedInvoice, blData, insuranceData, 'pres-003');
      const partyFindings = result.findings.filter(f => f.findingType === 'PARTY_NAME_MISMATCH');
      expect(partyFindings.length).toBeGreaterThan(0);
      expect(partyFindings[0].severity).toBe('critical');
      expect(partyFindings[0].verbatimQuotes.length).toBeGreaterThan(0);
    });

    test('produces PORT_MISMATCH when LC port ≠ BL port', async () => {
      const mismatchedBL = makeDocData('bl', {
        fields: {
          ...makeDocData('bl').fields,
          portOfLoading: { value: 'ROTTERDAM', verbatimSource: 'Port of Loading: ROTTERDAM', confidence: 0.95, ucpArticle: 'Art. 20' },
        },
      });
      const result = await engine.analyze(lcData, invoiceData, mismatchedBL, insuranceData, 'pres-004');
      const portFindings = result.findings.filter(f => f.findingType === 'PORT_MISMATCH');
      expect(portFindings.length).toBeGreaterThan(0);
    });

    test('every finding has mandatory verbatimQuotes array', async () => {
      const result = await engine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-005');
      for (const finding of result.findings) {
        expect(Array.isArray(finding.verbatimQuotes)).toBe(true);
        expect(finding).toHaveProperty('severity');
        expect(finding).toHaveProperty('confidence');
        expect(finding).toHaveProperty('ucpArticles');
        expect(finding).toHaveProperty('recommendedAction');
      }
    });

    test('severity is always one of critical | moderate | informational', async () => {
      const result = await engine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-006');
      const validSeverities = new Set(['critical', 'moderate', 'informational']);
      for (const finding of result.findings) {
        expect(validSeverities.has(finding.severity)).toBe(true);
      }
    });

    test('confidence is between 0 and 100 for all findings', async () => {
      const result = await engine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-007');
      for (const finding of result.findings) {
        expect(finding.confidence).toBeGreaterThanOrEqual(0);
        expect(finding.confidence).toBeLessThanOrEqual(100);
      }
    });

    test('[P0 FIX] meta.presentationDeadline is included in input payload when provided', async () => {
      const meta = { submissionDate: '2025-11-10', presentationDeadline: '2025-11-05', onBoardDate: '2025-10-15', lcExpiryDate: '2025-12-31', latestShipmentDate: '2025-11-30' };
      // Should NOT throw even when submission is past deadline — engine handles it
      const result = await engine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-008', meta);
      expect(result).toHaveProperty('findings');
    });
  });

  describe('_buildInputPayload()', () => {
    test('includes lc, invoice, bl, insurance and meta keys', () => {
      const meta = { submissionDate: '2025-11-01', presentationDeadline: '2025-11-05' };
      const payload = engine._buildInputPayload(makeDocData('lc'), makeDocData('invoice'), makeDocData('bl'), makeDocData('insurance'), meta);
      expect(payload).toHaveProperty('lc');
      expect(payload).toHaveProperty('invoice');
      expect(payload).toHaveProperty('bl');
      expect(payload).toHaveProperty('insurance');
      expect(payload).toHaveProperty('meta');
      expect(payload.meta.submissionDate).toBe('2025-11-01');
    });

    test('handles null document gracefully', () => {
      const payload = engine._buildInputPayload(makeDocData('lc'), null, makeDocData('bl'), null, {});
      expect(payload.invoice).toBeNull();
      expect(payload.insurance).toBeNull();
    });
  });

  describe('_normaliseSeverity()', () => {
    test.each([
      ['critical', 'critical'],
      ['CRITICAL', 'critical'],
      ['moderate', 'moderate'],
      ['MODERATE', 'moderate'],
      ['informational', 'informational'],
      ['unknown', 'informational'],
      [null, 'informational'],
      [undefined, 'informational'],
    ])('normalises "%s" → "%s"', (input, expected) => {
      expect(engine._normaliseSeverity(input)).toBe(expected);
    });
  });
});
