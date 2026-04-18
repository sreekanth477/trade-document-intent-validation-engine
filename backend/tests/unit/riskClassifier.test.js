'use strict';

const RiskClassifier = require('../../src/services/riskClassifier');

describe('RiskClassifier', () => {
  let classifier;

  beforeEach(() => {
    classifier = new RiskClassifier();
  });

  // ─────────────────────────────────────────────
  // classify()
  // ─────────────────────────────────────────────
  describe('classify()', () => {
    test('returns empty array for non-array input', () => {
      expect(classifier.classify(null)).toEqual([]);
      expect(classifier.classify(undefined)).toEqual([]);
      expect(classifier.classify('bad')).toEqual([]);
    });

    test('always-critical: PARTY_NAME_MISMATCH is forced to critical regardless of model severity', () => {
      const findings = [{ findingType: 'PARTY_NAME_MISMATCH', severity: 'moderate', confidence: 90, verbatimQuotes: [{ document: 'lc', field: 'beneficiary', text: 'ABC Ltd' }], affectedDocuments: ['lc', 'invoice'], affectedFields: ['beneficiary'], title: 'Party mismatch', description: 'mismatch' }];
      const result = classifier.classify(findings);
      expect(result[0].finalSeverity).toBe('critical');
      expect(result[0].severityOverridden).toBe(true);
    });

    test('always-critical: AMOUNT_DISCREPANCY is forced to critical', () => {
      const findings = [{ findingType: 'AMOUNT_DISCREPANCY', severity: 'informational', confidence: 70, verbatimQuotes: [], affectedDocuments: ['lc'], affectedFields: ['amount'], title: 'Amount', description: 'test' }];
      const result = classifier.classify(findings);
      expect(result[0].finalSeverity).toBe('critical');
    });

    test('always-critical: title pattern "beneficiary mismatch" forces critical', () => {
      const findings = [{ findingType: 'GOODS_DESCRIPTION_MISMATCH', severity: 'moderate', confidence: 85, title: 'Beneficiary Mismatch Detected', description: 'test', verbatimQuotes: [], affectedDocuments: ['lc'], affectedFields: [] }];
      const result = classifier.classify(findings);
      expect(result[0].finalSeverity).toBe('critical');
    });

    test('low-confidence critical is downgraded to moderate', () => {
      const findings = [{ findingType: 'GOODS_DESCRIPTION_MISMATCH', severity: 'critical', confidence: 30, title: 'Goods mismatch', description: 'uncertain', verbatimQuotes: [{ document: 'lc', field: 'goodsDescription', text: 'Steel pipes' }], affectedDocuments: ['lc'], affectedFields: ['goodsDescription'] }];
      const result = classifier.classify(findings);
      expect(result[0].finalSeverity).toBe('moderate');
    });

    test('confidence score is penalised when verbatimQuotes is empty', () => {
      const findings = [{ findingType: 'PORT_MISMATCH', severity: 'moderate', confidence: 80, title: 'Port mismatch', description: 'test', verbatimQuotes: [], affectedDocuments: ['lc', 'bl'], affectedFields: ['portOfLoading'] }];
      const result = classifier.classify(findings);
      expect(result[0].finalConfidence).toBeLessThan(80);
    });

    test('confidence score is boosted when 3+ documents are affected', () => {
      const findings = [{ findingType: 'INCOTERMS_INCONSISTENCY', severity: 'moderate', confidence: 70, title: 'Incoterms', description: 'test', verbatimQuotes: [{ document: 'lc', field: 'incoterms', text: 'CIF' }], affectedDocuments: ['lc', 'invoice', 'bl'], affectedFields: ['incoterms'] }];
      const result = classifier.classify(findings);
      expect(result[0].finalConfidence).toBeGreaterThan(70);
    });

    test('adds finalSeverity, finalConfidence, severityOverridden, originalSeverity to every finding', () => {
      const findings = [{ findingType: 'TRADE_PATTERN_ANOMALY', severity: 'informational', confidence: 55, title: 'Trade anomaly', description: 'test', verbatimQuotes: [], affectedDocuments: ['lc'], affectedFields: [] }];
      const result = classifier.classify(findings);
      expect(result[0]).toHaveProperty('finalSeverity');
      expect(result[0]).toHaveProperty('finalConfidence');
      expect(result[0]).toHaveProperty('severityOverridden');
      expect(result[0]).toHaveProperty('originalSeverity', 'informational');
    });
  });

  // ─────────────────────────────────────────────
  // computeOverallRisk()
  // ─────────────────────────────────────────────
  describe('computeOverallRisk()', () => {
    test('returns low risk and STP candidate for empty findings', () => {
      const result = classifier.computeOverallRisk([]);
      expect(result.overallScore).toBe(0);
      expect(result.stpCandidate).toBe(true);
      expect(result.riskBand).toBe('LOW');
    });

    test('[P0 FIX] a single moderate finding disqualifies STP', () => {
      const findings = classifier.classify([{ findingType: 'PORT_MISMATCH', severity: 'moderate', confidence: 75, title: 'Port mismatch', description: 'test', verbatimQuotes: [{ document: 'bl', field: 'portOfLoading', text: 'Hamburg' }], affectedDocuments: ['lc', 'bl'], affectedFields: ['portOfLoading'] }]);
      const result = classifier.computeOverallRisk(findings);
      expect(result.stpCandidate).toBe(false);
    });

    test('[P0 FIX] zero findings of any kind allows STP', () => {
      const result = classifier.computeOverallRisk([]);
      expect(result.stpCandidate).toBe(true);
    });

    test('one critical finding floors overall score at >= 60', () => {
      const findings = classifier.classify([{ findingType: 'LC_EXPIRY_VIOLATION', severity: 'critical', confidence: 95, title: 'Expiry violation', description: 'test', verbatimQuotes: [{ document: 'lc', field: 'expiryDate', text: '2024-01-01' }], affectedDocuments: ['lc', 'bl'], affectedFields: ['expiryDate'] }]);
      const result = classifier.computeOverallRisk(findings);
      expect(result.overallScore).toBeGreaterThanOrEqual(60);
      expect(result.stpCandidate).toBe(false);
    });

    test('two critical findings produce CRITICAL risk band', () => {
      const mkCritical = (type) => ({ findingType: type, severity: 'critical', confidence: 90, title: type, description: 'test', verbatimQuotes: [{ document: 'lc', field: 'x', text: 'y' }], affectedDocuments: ['lc'], affectedFields: ['amount'] });
      const findings = classifier.classify([mkCritical('AMOUNT_DISCREPANCY'), mkCritical('PARTY_NAME_MISMATCH')]);
      const result = classifier.computeOverallRisk(findings);
      expect(result.riskBand).toBe('CRITICAL');
    });

    test('riskSummary mentions "Not STP eligible: moderate findings" when disqualified by moderate', () => {
      const findings = classifier.classify([{ findingType: 'INCOTERMS_INCONSISTENCY', severity: 'moderate', confidence: 75, title: 'Incoterms mismatch', description: 'test', verbatimQuotes: [{ document: 'lc', field: 'incoterms', text: 'CIF' }], affectedDocuments: ['lc'], affectedFields: ['incoterms'] }]);
      const result = classifier.computeOverallRisk(findings);
      expect(result.riskSummary.toLowerCase()).toMatch(/not stp eligible|moderate/);
    });

    test('breakdown counts are accurate', () => {
      const raw = [
        { findingType: 'AMOUNT_DISCREPANCY',  severity: 'critical',      confidence: 90, title: 'A', description: 'x', verbatimQuotes: [{ document: 'lc', field: 'amount', text: '100' }], affectedDocuments: ['lc'], affectedFields: ['amount'] },
        { findingType: 'PORT_MISMATCH',        severity: 'moderate',      confidence: 75, title: 'B', description: 'x', verbatimQuotes: [{ document: 'bl', field: 'portOfLoading', text: 'X' }], affectedDocuments: ['bl'], affectedFields: ['portOfLoading'] },
        { findingType: 'TRADE_PATTERN_ANOMALY',severity: 'informational', confidence: 55, title: 'C', description: 'x', verbatimQuotes: [], affectedDocuments: ['lc'], affectedFields: [] },
      ];
      const findings = classifier.classify(raw);
      const result = classifier.computeOverallRisk(findings);
      expect(result.breakdown.totalFindings).toBe(3);
      expect(result.breakdown.critical).toBeGreaterThanOrEqual(1);
      expect(result.breakdown.informational).toBeGreaterThanOrEqual(1);
    });
  });
});
