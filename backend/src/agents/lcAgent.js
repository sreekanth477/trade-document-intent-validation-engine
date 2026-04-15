'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

// ---------------------------------------------------------------------------
// LC Agent
// Extracts structured fields from a Letter of Credit document text.
// Every extracted field carries verbatim source text and a UCP 600 article tag.
// ---------------------------------------------------------------------------

const LC_SYSTEM_PROMPT = `You are an expert trade finance document examiner specialising in Letters of Credit under UCP 600 (ICC Publication No. 600, 2007 Revision).

Your task is to extract structured data from the raw text of a Letter of Credit document and return it as a single, valid JSON object. You must follow every rule below without exception.

════════════════════════════════════════════════════════
EXTRACTION RULES
════════════════════════════════════════════════════════

RULE 1 — VERBATIM CITATION IS MANDATORY
For every field you extract, you MUST copy the exact substring from the source document that proves the value. This verbatimSource must be a direct quote — no paraphrasing, no summarising, no reformatting. If the document says "Beneficiary: ACME TRADING CO LTD, HONG KONG" then verbatimSource must be exactly "Beneficiary: ACME TRADING CO LTD, HONG KONG". Partial quotes that still uniquely identify the value are acceptable. Empty verbatimSource is NEVER allowed when a value was found.

RULE 2 — NOT_FOUND FOR ABSENT FIELDS
If a required field is not present in the document, set value to the string "NOT_FOUND" and verbatimSource to "" and confidence to 0. Never infer, assume, or construct a value that is not explicitly stated in the document text. Never hallucinate data.

RULE 3 — UCP ARTICLE TAGGING
Every field must reference the most relevant UCP 600 article in the ucpArticle property. Use the short form such as "Art. 6", "Art. 14(d)", "Art. 18", etc.

RULE 4 — CONFIDENCE SCORING
confidence is a decimal from 0.0 to 1.0 reflecting your certainty that you have correctly identified and transcribed the value. Use 1.0 only when the text is unambiguous and you are certain. Use 0.7-0.9 for clearly present but slightly ambiguous values. Use 0.3-0.6 when the value appears to be present but formatting or context creates uncertainty. Use 0 when NOT_FOUND.

RULE 5 — ARRAYS AND COMPLEX FIELDS
For documentRequirements and specialConditions, return an array of objects, each with { item, verbatimSource, ucpArticle, confidence }. If none found, return [].

RULE 6 — DATES
Normalise dates to ISO 8601 format (YYYY-MM-DD) in the value field, but preserve the original text in verbatimSource.

RULE 7 — AMOUNTS
In amount, provide a numeric value (as a string to avoid floating-point issues). In currency, provide the ISO 4217 three-letter code.

RULE 8 — OUTPUT FORMAT
Return ONLY the JSON object. No markdown, no commentary, no explanation before or after. The response must be parseable by JSON.parse() with no pre-processing.

════════════════════════════════════════════════════════
TARGET SCHEMA
════════════════════════════════════════════════════════

{
  "lcNumber":            { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 6" },
  "applicant":           { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 2" },
  "beneficiary":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 2" },
  "issuingBank":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 7" },
  "advisingBank":        { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 9" },
  "lcType":              { "value": "irrevocable" | "revocable" | "transferable" | "standby" | "NOT_FOUND", "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 3" },
  "currency":            { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "amount":              { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 30" },
  "amountTolerance":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 30" },
  "expiryDate":          { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 6" },
  "expiryPlace":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 6" },
  "shipmentPeriod":      { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "latestShipmentDate":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "portOfLoading":       { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "portOfDischarge":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "goodsDescription":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "incoterms":           { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 4" },
  "partialShipments":    { "value": "allowed" | "prohibited" | "NOT_FOUND", "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 31" },
  "transhipment":        { "value": "allowed" | "prohibited" | "NOT_FOUND", "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "presentationPeriod":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 14(c)" },
  "availableWith":       { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 6" },
  "availableBy":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 6" },
  "documentRequirements": [
    { "item": string, "verbatimSource": string, "ucpArticle": string, "confidence": number }
  ],
  "specialConditions": [
    { "item": string, "verbatimSource": string, "ucpArticle": string, "confidence": number }
  ],
  "applicableUCPArticles": [string]
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 1
════════════════════════════════════════════════════════

INPUT DOCUMENT EXCERPT:
"IRREVOCABLE DOCUMENTARY CREDIT No. LC-2024-HK-00321
Issuing Bank: HSBC HONG KONG LIMITED, 1 QUEEN'S ROAD CENTRAL, HONG KONG
Applicant: GUANGDONG ELECTRONICS IMPORT CO LTD, 88 TIANHE ROAD, GUANGZHOU, CHINA
Beneficiary: SIEMENS AG, WERNER-VON-SIEMENS-STRASSE 1, 80333 MUNICH, GERMANY
Currency/Amount: EUR 2,450,000.00 (TWO MILLION FOUR HUNDRED FIFTY THOUSAND EUROS)
Tolerance: +/- 5%
Expiry Date: 15 MARCH 2025 at the counters of the Issuing Bank in Hong Kong
Latest Shipment Date: 20 FEBRUARY 2025
Port of Loading: HAMBURG, GERMANY
Port of Discharge: HONG KONG
Partial Shipments: PROHIBITED
Transhipment: ALLOWED
Goods: INDUSTRIAL AUTOMATION EQUIPMENT AND COMPONENTS AS PER PROFORMA INVOICE NO. PI-2024-0089"

EXPECTED JSON OUTPUT (excerpt):
{
  "lcNumber":    { "value": "LC-2024-HK-00321", "verbatimSource": "No. LC-2024-HK-00321", "confidence": 1.0, "ucpArticle": "Art. 6" },
  "issuingBank": { "value": "HSBC HONG KONG LIMITED, 1 QUEEN'S ROAD CENTRAL, HONG KONG", "verbatimSource": "Issuing Bank: HSBC HONG KONG LIMITED, 1 QUEEN'S ROAD CENTRAL, HONG KONG", "confidence": 1.0, "ucpArticle": "Art. 7" },
  "applicant":   { "value": "GUANGDONG ELECTRONICS IMPORT CO LTD, 88 TIANHE ROAD, GUANGZHOU, CHINA", "verbatimSource": "Applicant: GUANGDONG ELECTRONICS IMPORT CO LTD, 88 TIANHE ROAD, GUANGZHOU, CHINA", "confidence": 1.0, "ucpArticle": "Art. 2" },
  "beneficiary": { "value": "SIEMENS AG, WERNER-VON-SIEMENS-STRASSE 1, 80333 MUNICH, GERMANY", "verbatimSource": "Beneficiary: SIEMENS AG, WERNER-VON-SIEMENS-STRASSE 1, 80333 MUNICH, GERMANY", "confidence": 1.0, "ucpArticle": "Art. 2" },
  "currency":    { "value": "EUR", "verbatimSource": "Currency/Amount: EUR 2,450,000.00", "confidence": 1.0, "ucpArticle": "Art. 18" },
  "amount":      { "value": "2450000.00", "verbatimSource": "EUR 2,450,000.00 (TWO MILLION FOUR HUNDRED FIFTY THOUSAND EUROS)", "confidence": 1.0, "ucpArticle": "Art. 30" },
  "amountTolerance": { "value": "+/- 5%", "verbatimSource": "Tolerance: +/- 5%", "confidence": 1.0, "ucpArticle": "Art. 30" },
  "expiryDate":  { "value": "2025-03-15", "verbatimSource": "Expiry Date: 15 MARCH 2025 at the counters of the Issuing Bank in Hong Kong", "confidence": 1.0, "ucpArticle": "Art. 6" },
  "partialShipments": { "value": "prohibited", "verbatimSource": "Partial Shipments: PROHIBITED", "confidence": 1.0, "ucpArticle": "Art. 31" },
  "transhipment": { "value": "allowed", "verbatimSource": "Transhipment: ALLOWED", "confidence": 1.0, "ucpArticle": "Art. 20" }
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 2 — MISSING FIELDS
════════════════════════════════════════════════════════

INPUT DOCUMENT EXCERPT:
"DOCUMENTARY CREDIT
Issuing Bank: STANDARD CHARTERED BANK (SINGAPORE) LIMITED
Applicant: SOUTHEAST ASIA COMMODITIES PTE LTD
Amount: USD 875,000
Expiry: 30/06/2025 Singapore"

EXPECTED JSON OUTPUT (showing NOT_FOUND handling):
{
  "beneficiary": { "value": "NOT_FOUND", "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 2" },
  "advisingBank": { "value": "NOT_FOUND", "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 9" },
  "latestShipmentDate": { "value": "NOT_FOUND", "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 20" },
  "partialShipments": { "value": "NOT_FOUND", "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 31" }
}

════════════════════════════════════════════════════════
Now extract from the document provided by the user. Return ONLY valid JSON.
════════════════════════════════════════════════════════`;

class LCAgent {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model  = 'claude-sonnet-4-6';
  }

  /**
   * Extract structured LC data from raw document text.
   * @param {string} documentText - Raw text extracted from the LC PDF
   * @param {string} documentId   - UUID of the document record (for logging)
   * @returns {Promise<object>}   - Validated, normalised extraction result
   */
  async extract(documentText, documentId) {
    logger.info('LCAgent: starting extraction', { documentId });

    if (!documentText || documentText.trim().length < 50) {
      throw new Error('LC document text is too short or empty for extraction');
    }

    const userMessage = `Extract all Letter of Credit fields from the following document text:\n\n---\n${documentText}\n---`;

    let rawJson;

    if (process.env.USE_MOCK_LLM === 'true') {
      rawJson = this._getMockExtraction(documentText);
    } else {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: LC_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' }, // prompt caching for system prompt
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent) {
        throw new Error('LCAgent: model returned no text content');
      }

      rawJson = textContent.text.trim();
    }

    // Strip markdown code fences if model adds them despite instructions
    rawJson = rawJson.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseErr) {
      logger.error('LCAgent: JSON parse failure', { documentId, raw: rawJson.slice(0, 500) });
      throw new Error(`LCAgent: could not parse model response as JSON: ${parseErr.message}`);
    }

    logger.info('LCAgent: extraction complete', { documentId });
    return this.mapToStandardSchema(parsed, documentId);
  }

  /**
   * Validates and normalises raw extraction from the model.
   * Ensures every field conforms to the expected shape.
   * @param {object} raw        - Parsed JSON from model
   * @param {string} documentId - For logging context
   * @returns {object}          - Normalised extraction with metadata
   */
  mapToStandardSchema(raw, documentId) {
    const SCALAR_FIELDS = [
      'lcNumber', 'applicant', 'beneficiary', 'issuingBank', 'advisingBank',
      'lcType', 'currency', 'amount', 'amountTolerance', 'expiryDate',
      'expiryPlace', 'shipmentPeriod', 'latestShipmentDate', 'portOfLoading',
      'portOfDischarge', 'goodsDescription', 'incoterms', 'partialShipments',
      'transhipment', 'presentationPeriod', 'availableWith', 'availableBy',
    ];

    const normalised = {};
    let totalConfidence = 0;
    let fieldCount = 0;

    for (const field of SCALAR_FIELDS) {
      const entry = raw[field];
      if (entry && typeof entry === 'object') {
        normalised[field] = {
          value:          this._sanitiseValue(entry.value),
          verbatimSource: typeof entry.verbatimSource === 'string' ? entry.verbatimSource : '',
          confidence:     this._clampConfidence(entry.confidence),
          ucpArticle:     typeof entry.ucpArticle === 'string' ? entry.ucpArticle : '',
        };
      } else {
        normalised[field] = {
          value: 'NOT_FOUND',
          verbatimSource: '',
          confidence: 0,
          ucpArticle: '',
        };
      }
      totalConfidence += normalised[field].confidence;
      fieldCount++;
    }

    // Array fields
    normalised.documentRequirements = Array.isArray(raw.documentRequirements)
      ? raw.documentRequirements.map(r => ({
          item:          this._sanitiseValue(r.item),
          verbatimSource: typeof r.verbatimSource === 'string' ? r.verbatimSource : '',
          ucpArticle:    typeof r.ucpArticle === 'string' ? r.ucpArticle : '',
          confidence:    this._clampConfidence(r.confidence),
        }))
      : [];

    normalised.specialConditions = Array.isArray(raw.specialConditions)
      ? raw.specialConditions.map(r => ({
          item:          this._sanitiseValue(r.item),
          verbatimSource: typeof r.verbatimSource === 'string' ? r.verbatimSource : '',
          ucpArticle:    typeof r.ucpArticle === 'string' ? r.ucpArticle : '',
          confidence:    this._clampConfidence(r.confidence),
        }))
      : [];

    normalised.applicableUCPArticles = Array.isArray(raw.applicableUCPArticles)
      ? raw.applicableUCPArticles.filter(a => typeof a === 'string')
      : [];

    // Metadata
    const overallConfidence = fieldCount > 0
      ? Math.round((totalConfidence / fieldCount) * 100) / 100
      : 0;

    return {
      documentType: 'lc',
      documentId:   documentId || null,
      extractedAt:  new Date().toISOString(),
      overallConfidence,
      fields: normalised,
    };
  }

  _sanitiseValue(val) {
    if (val === null || val === undefined) return 'NOT_FOUND';
    const str = String(val).trim();
    return str.length === 0 ? 'NOT_FOUND' : str;
  }

  _clampConfidence(val) {
    const n = parseFloat(val);
    if (isNaN(n)) return 0;
    return Math.min(1, Math.max(0, n));
  }

  _getMockExtraction(text) {
    // Minimal mock for testing without Anthropic API
    return JSON.stringify({
      lcNumber:           { value: 'LC-MOCK-001', verbatimSource: 'LC-MOCK-001', confidence: 0.9, ucpArticle: 'Art. 6' },
      applicant:          { value: 'MOCK APPLICANT CORP', verbatimSource: 'Applicant: MOCK APPLICANT CORP', confidence: 0.9, ucpArticle: 'Art. 2' },
      beneficiary:        { value: 'MOCK BENEFICIARY LTD', verbatimSource: 'Beneficiary: MOCK BENEFICIARY LTD', confidence: 0.9, ucpArticle: 'Art. 2' },
      issuingBank:        { value: 'MOCK ISSUING BANK', verbatimSource: 'Issuing Bank: MOCK ISSUING BANK', confidence: 0.9, ucpArticle: 'Art. 7' },
      advisingBank:       { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 9' },
      lcType:             { value: 'irrevocable', verbatimSource: 'IRREVOCABLE', confidence: 0.95, ucpArticle: 'Art. 3' },
      currency:           { value: 'USD', verbatimSource: 'USD', confidence: 1.0, ucpArticle: 'Art. 18' },
      amount:             { value: '100000.00', verbatimSource: 'USD 100,000.00', confidence: 1.0, ucpArticle: 'Art. 30' },
      amountTolerance:    { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 30' },
      expiryDate:         { value: '2025-12-31', verbatimSource: '31/12/2025', confidence: 0.9, ucpArticle: 'Art. 6' },
      expiryPlace:        { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 6' },
      shipmentPeriod:     { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 20' },
      latestShipmentDate: { value: '2025-11-30', verbatimSource: '30/11/2025', confidence: 0.85, ucpArticle: 'Art. 20' },
      portOfLoading:      { value: 'SHANGHAI', verbatimSource: 'Port of Loading: SHANGHAI', confidence: 0.95, ucpArticle: 'Art. 20' },
      portOfDischarge:    { value: 'ROTTERDAM', verbatimSource: 'Port of Discharge: ROTTERDAM', confidence: 0.95, ucpArticle: 'Art. 20' },
      goodsDescription:   { value: 'MOCK GOODS', verbatimSource: 'Goods: MOCK GOODS', confidence: 0.85, ucpArticle: 'Art. 18' },
      incoterms:          { value: 'CIF ROTTERDAM', verbatimSource: 'CIF ROTTERDAM', confidence: 0.9, ucpArticle: 'Art. 4' },
      partialShipments:   { value: 'prohibited', verbatimSource: 'Partial Shipments: NOT ALLOWED', confidence: 0.9, ucpArticle: 'Art. 31' },
      transhipment:       { value: 'allowed', verbatimSource: 'Transhipment: ALLOWED', confidence: 0.9, ucpArticle: 'Art. 20' },
      presentationPeriod: { value: '21 days', verbatimSource: '21 days after date of shipment', confidence: 0.85, ucpArticle: 'Art. 14(c)' },
      availableWith:      { value: 'ANY BANK', verbatimSource: 'Available with: ANY BANK', confidence: 0.85, ucpArticle: 'Art. 6' },
      availableBy:        { value: 'NEGOTIATION', verbatimSource: 'by Negotiation', confidence: 0.85, ucpArticle: 'Art. 6' },
      documentRequirements: [],
      specialConditions: [],
      applicableUCPArticles: ['Art. 6', 'Art. 14', 'Art. 18', 'Art. 20'],
    });
  }
}

module.exports = LCAgent;
