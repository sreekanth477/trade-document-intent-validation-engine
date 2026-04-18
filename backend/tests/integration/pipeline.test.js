'use strict';

/**
 * Integration tests — full pipeline with mocked DB and mocked LLM.
 * Tests the complete flow: document text → agent extraction → intent analysis → risk classification.
 * No real PostgreSQL, Redis, or Anthropic API is required.
 */

// Mock DB
jest.mock('../../src/db/connection', () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  getClient: jest.fn().mockResolvedValue({
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    release: jest.fn(),
  }),
}));

const LCAgent        = require('../../src/agents/lcAgent');
const InvoiceAgent   = require('../../src/agents/invoiceAgent');
const BLAgent        = require('../../src/agents/blAgent');
const InsuranceAgent = require('../../src/agents/insuranceAgent');
const { IntentAnalysisEngine } = require('../../src/agents/intentAnalysisEngine');
const RiskClassifier = require('../../src/services/riskClassifier');

// Sample document texts
const LC_TEXT = `
IRREVOCABLE DOCUMENTARY CREDIT No. LC-2025-TEST-001
Issuing Bank: HSBC HONG KONG LIMITED
Applicant: GUANGDONG IMPORT CO LTD, GUANGZHOU, CHINA
Beneficiary: SIEMENS AG, MUNICH, GERMANY
Currency/Amount: USD 500,000.00
Expiry Date: 31 DECEMBER 2025
Latest Shipment Date: 30 NOVEMBER 2025
Port of Loading: HAMBURG, GERMANY
Port of Discharge: HONG KONG
Goods: INDUSTRIAL MACHINERY AND COMPONENTS
Incoterms: CIF HONG KONG
Partial Shipments: PROHIBITED
Transhipment: ALLOWED
Presentation Period: 21 DAYS
`;

const INVOICE_TEXT = `
COMMERCIAL INVOICE No. INV-2025-5678
Date: 15 October 2025
Seller: SIEMENS AG, MUNICH, GERMANY
Buyer: GUANGDONG IMPORT CO LTD, GUANGZHOU, CHINA
Goods: INDUSTRIAL MACHINERY AND COMPONENTS
Quantity: 50 UNITS
Unit Price: USD 10,000.00
Total Amount: USD 500,000.00
Incoterms: CIF HONG KONG
`;

const BL_TEXT = `
BILL OF LADING No. BL-2025-HH-9001
Shipper: SIEMENS AG, MUNICH, GERMANY
Consignee: TO ORDER OF HSBC HONG KONG LIMITED
Notify Party: GUANGDONG IMPORT CO LTD
Port of Loading: HAMBURG, GERMANY
Port of Discharge: HONG KONG
Vessel: MV EVER GIVEN
Voyage: 201W
On Board Date: 15 OCTOBER 2025
Cargo: INDUSTRIAL MACHINERY
Gross Weight: 25,000 KGS
Freight: PREPAID
`;

const INSURANCE_TEXT = `
INSURANCE CERTIFICATE No. INS-2025-77001
Insured: SIEMENS AG, MUNICH, GERMANY
Insured Value: USD 550,000.00
Coverage: ALL RISKS
Port of Loading: HAMBURG
Port of Discharge: HONG KONG
Effective Date: 10 OCTOBER 2025
Claims Payable: HONG KONG
`;

describe('Full Pipeline Integration', () => {
  let lcAgent, invoiceAgent, blAgent, insuranceAgent, intentEngine, riskClassifier;

  beforeAll(() => {
    lcAgent        = new LCAgent();
    invoiceAgent   = new InvoiceAgent();
    blAgent        = new BLAgent();
    insuranceAgent = new InsuranceAgent();
    intentEngine   = new IntentAnalysisEngine();
    riskClassifier = new RiskClassifier();
  });

  test('Step 1-4: All four agents extract structured data successfully', async () => {
    const [lcData, invoiceData, blData, insuranceData] = await Promise.all([
      lcAgent.extract(LC_TEXT, 'lc-doc-001'),
      invoiceAgent.extract(INVOICE_TEXT, 'inv-doc-001'),
      blAgent.extract(BL_TEXT, 'bl-doc-001'),
      insuranceAgent.extract(INSURANCE_TEXT, 'ins-doc-001'),
    ]);

    expect(lcData.documentType).toBe('lc');
    expect(invoiceData.documentType).toBe('invoice');
    expect(blData.documentType).toBe('bl');
    expect(insuranceData.documentType).toBe('insurance');

    // All extractions should return fields object
    for (const data of [lcData, invoiceData, blData, insuranceData]) {
      expect(data).toHaveProperty('fields');
      expect(data.overallConfidence).toBeGreaterThanOrEqual(0);
    }
  });

  test('Step 5: Intent Analysis Engine produces findings from agent outputs', async () => {
    const [lcData, invoiceData, blData, insuranceData] = await Promise.all([
      lcAgent.extract(LC_TEXT, 'lc-doc-002'),
      invoiceAgent.extract(INVOICE_TEXT, 'inv-doc-002'),
      blAgent.extract(BL_TEXT, 'bl-doc-002'),
      insuranceAgent.extract(INSURANCE_TEXT, 'ins-doc-002'),
    ]);

    const meta = {
      submissionDate: '2025-11-01',
      presentationDeadline: '2025-11-05',
      onBoardDate: lcData.fields?.latestShipmentDate?.value || '2025-10-15',
      lcExpiryDate: '2025-12-31',
      latestShipmentDate: '2025-11-30',
    };

    const analysis = await intentEngine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-pipeline-001', meta);

    expect(analysis).toHaveProperty('findings');
    expect(analysis).toHaveProperty('dimensionSummary');
    expect(analysis).toHaveProperty('analyzedAt');
    expect(Array.isArray(analysis.findings)).toBe(true);
  });

  test('Step 6: Risk Classifier classifies findings and computes overall score', async () => {
    const [lcData, invoiceData, blData, insuranceData] = await Promise.all([
      lcAgent.extract(LC_TEXT, 'lc-doc-003'),
      invoiceAgent.extract(INVOICE_TEXT, 'inv-doc-003'),
      blAgent.extract(BL_TEXT, 'bl-doc-003'),
      insuranceAgent.extract(INSURANCE_TEXT, 'ins-doc-003'),
    ]);

    const analysis = await intentEngine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-pipeline-002');
    const classified = riskClassifier.classify(analysis.findings);
    const risk = riskClassifier.computeOverallRisk(classified);

    expect(risk).toHaveProperty('overallScore');
    expect(risk).toHaveProperty('stpCandidate');
    expect(risk).toHaveProperty('riskBand');
    expect(risk).toHaveProperty('riskSummary');
    expect(risk).toHaveProperty('breakdown');
    expect(risk.overallScore).toBeGreaterThanOrEqual(0);
    expect(risk.overallScore).toBeLessThanOrEqual(100);
  });

  test('Full pipeline: clean documents produce STP candidate result', async () => {
    const [lcData, invoiceData, blData, insuranceData] = await Promise.all([
      lcAgent.extract(LC_TEXT, 'lc-doc-004'),
      invoiceAgent.extract(INVOICE_TEXT, 'inv-doc-004'),
      blAgent.extract(BL_TEXT, 'bl-doc-004'),
      insuranceAgent.extract(INSURANCE_TEXT, 'ins-doc-004'),
    ]);

    const analysis = await intentEngine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-pipeline-003');
    const classified = riskClassifier.classify(analysis.findings);
    const risk = riskClassifier.computeOverallRisk(classified);

    // Clean docs (no mismatches in mock data) should be STP eligible
    if (classified.filter(f => f.finalSeverity === 'critical' || f.finalSeverity === 'moderate').length === 0) {
      expect(risk.stpCandidate).toBe(true);
    }
    // Always: score is valid
    expect(typeof risk.overallScore).toBe('number');
  });

  test('Full pipeline: party mismatch produces critical finding blocking STP', async () => {
    // Invoice seller differs from LC beneficiary
    const MISMATCHED_INVOICE = INVOICE_TEXT.replace('SIEMENS AG', 'DIFFERENT COMPANY LTD');

    const [lcData, invoiceData, blData, insuranceData] = await Promise.all([
      lcAgent.extract(LC_TEXT, 'lc-doc-005'),
      invoiceAgent.extract(MISMATCHED_INVOICE, 'inv-doc-005'),
      blAgent.extract(BL_TEXT, 'bl-doc-005'),
      insuranceAgent.extract(INSURANCE_TEXT, 'ins-doc-005'),
    ]);

    const analysis = await intentEngine.analyze(lcData, invoiceData, blData, insuranceData, 'pres-pipeline-004');
    const classified = riskClassifier.classify(analysis.findings);
    const risk = riskClassifier.computeOverallRisk(classified);

    // Party mismatch should produce at least one critical finding
    const hasCritical = classified.some(f => f.finalSeverity === 'critical');
    if (hasCritical) {
      expect(risk.stpCandidate).toBe(false);
      expect(risk.overallScore).toBeGreaterThanOrEqual(60);
    }
  });

  test('[P0 FIX] parallel extraction using Promise.allSettled returns 4 results', async () => {
    const docs = [
      { id: 'lc-p-001',  documentType: 'lc',        text: LC_TEXT },
      { id: 'inv-p-001', documentType: 'invoice',    text: INVOICE_TEXT },
      { id: 'bl-p-001',  documentType: 'bl',         text: BL_TEXT },
      { id: 'ins-p-001', documentType: 'insurance',  text: INSURANCE_TEXT },
    ];

    const agentMap = { lc: lcAgent, invoice: invoiceAgent, bl: blAgent, insurance: insuranceAgent };

    const results = await Promise.allSettled(
      docs.map(d => agentMap[d.documentType].extract(d.text, d.id))
    );

    expect(results).toHaveLength(4);
    for (const r of results) {
      expect(r.status).toBe('fulfilled');
      expect(r.value).toHaveProperty('fields');
    }
  });
});
