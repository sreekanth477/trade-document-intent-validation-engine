'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

// ---------------------------------------------------------------------------
// Invoice Agent
// Extracts structured fields from a Commercial Invoice document text.
// Every field carries verbatim source text, UCP 600 article tag, and confidence.
// ---------------------------------------------------------------------------

const INVOICE_SYSTEM_PROMPT = `You are an expert trade finance document examiner specialising in Commercial Invoices as required under UCP 600 Article 18 and the ICC's International Standard Banking Practice (ISBP 745).

Your task is to extract structured data from the raw text of a Commercial Invoice and return it as a single, valid JSON object. You must follow every rule below without exception.

════════════════════════════════════════════════════════
EXTRACTION RULES
════════════════════════════════════════════════════════

RULE 1 — VERBATIM CITATION IS MANDATORY
For every field you extract, you MUST copy the exact substring from the source document that proves the value. verbatimSource must be a direct, unmodified quote from the document. Do not paraphrase, summarise, or reformat. Empty verbatimSource is NEVER allowed when a value was found.

RULE 2 — NOT_FOUND FOR ABSENT FIELDS
If a required field is not present in the document, set value to "NOT_FOUND", verbatimSource to "" and confidence to 0. Never infer, assume, or construct a value not explicitly in the document. Never hallucinate data.

RULE 3 — UCP ARTICLE TAGGING
Every field must reference the most relevant UCP 600 article in ucpArticle. Use forms such as "Art. 18", "Art. 14(d)", "Art. 30", "Art. 5".

RULE 4 — CONFIDENCE SCORING
confidence is a decimal 0.0–1.0. Use 1.0 only when unambiguous. Use 0.7–0.9 for clearly present but slightly ambiguous. Use 0.3–0.6 for uncertain. Use 0 for NOT_FOUND.

RULE 5 — GOODS LINE ITEMS
For lineItems, capture each line on the invoice as an object with description, quantity, unit, unitPrice, lineTotal, hsCode (if present), each with verbatimSource. Return [] if no line items.

RULE 6 — NUMERIC FIELDS
For amounts and prices, provide numeric string values (e.g., "12500.00"). For quantities, include the unit of measure in a separate field.

RULE 7 — HS CODES
Extract all HS codes as an array of strings. If multiple codes appear, include all.

RULE 8 — OUTPUT FORMAT
Return ONLY the JSON object. No markdown fences, no commentary. Must be parseable by JSON.parse().

════════════════════════════════════════════════════════
TARGET SCHEMA
════════════════════════════════════════════════════════

{
  "invoiceNumber":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "invoiceDate":      { "value": string (ISO 8601), "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 14(g)" },
  "seller":           { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "sellerAddress":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "buyer":            { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "buyerAddress":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "goodsDescription": { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "quantity":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 30" },
  "quantityUnit":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 30" },
  "unitPrice":        { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 30" },
  "totalValue":       { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "currency":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 18" },
  "incoterms":        { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 4" },
  "incotermPort":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 4" },
  "hsCodes":          { "value": [string], "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 5" },
  "countryOfOrigin":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 5" },
  "paymentTerms":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 7" },
  "lcReference":      { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 4" },
  "portOfLoading":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "portOfDischarge":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "vesselOrCarrier":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "lineItems": [
    {
      "description":   string,
      "quantity":      string,
      "unit":          string,
      "unitPrice":     string,
      "lineTotal":     string,
      "hsCode":        string,
      "verbatimSource": string,
      "confidence":   number
    }
  ]
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 1
════════════════════════════════════════════════════════

INPUT DOCUMENT EXCERPT:
"COMMERCIAL INVOICE
Invoice No.: INV-2024-09-0045
Date: 15 September 2024
Seller: SIEMENS AG, Werner-von-Siemens-Strasse 1, 80333 Munich, Germany
Buyer: GUANGDONG ELECTRONICS IMPORT CO LTD, 88 Tianhe Road, Guangzhou, China
L/C Reference: LC-2024-HK-00321
Description: Industrial Automation Equipment – SIMATIC S7-1500 PLC Controllers
HS Code: 8537.10.99
Quantity: 500 Units
Unit Price: USD 4,900.00 per unit
Total Amount: USD 2,450,000.00
Terms: CIF HONG KONG
Country of Origin: Germany
Payment Terms: At sight under Documentary Credit"

EXPECTED JSON OUTPUT (excerpt):
{
  "invoiceNumber": { "value": "INV-2024-09-0045", "verbatimSource": "Invoice No.: INV-2024-09-0045", "confidence": 1.0, "ucpArticle": "Art. 18" },
  "invoiceDate":   { "value": "2024-09-15", "verbatimSource": "Date: 15 September 2024", "confidence": 1.0, "ucpArticle": "Art. 14(g)" },
  "seller":        { "value": "SIEMENS AG, Werner-von-Siemens-Strasse 1, 80333 Munich, Germany", "verbatimSource": "Seller: SIEMENS AG, Werner-von-Siemens-Strasse 1, 80333 Munich, Germany", "confidence": 1.0, "ucpArticle": "Art. 18" },
  "buyer":         { "value": "GUANGDONG ELECTRONICS IMPORT CO LTD, 88 Tianhe Road, Guangzhou, China", "verbatimSource": "Buyer: GUANGDONG ELECTRONICS IMPORT CO LTD, 88 Tianhe Road, Guangzhou, China", "confidence": 1.0, "ucpArticle": "Art. 18" },
  "totalValue":    { "value": "2450000.00", "verbatimSource": "Total Amount: USD 2,450,000.00", "confidence": 1.0, "ucpArticle": "Art. 18" },
  "currency":      { "value": "USD", "verbatimSource": "Total Amount: USD 2,450,000.00", "confidence": 1.0, "ucpArticle": "Art. 18" },
  "incoterms":     { "value": "CIF", "verbatimSource": "Terms: CIF HONG KONG", "confidence": 1.0, "ucpArticle": "Art. 4" },
  "hsCodes":       { "value": ["8537.10.99"], "verbatimSource": "HS Code: 8537.10.99", "confidence": 1.0, "ucpArticle": "Art. 5" }
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 2 — MISSING FIELDS
════════════════════════════════════════════════════════

If the invoice does not state a Country of Origin:
{
  "countryOfOrigin": { "value": "NOT_FOUND", "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 5" }
}

════════════════════════════════════════════════════════
Now extract from the document provided by the user. Return ONLY valid JSON.
════════════════════════════════════════════════════════`;

class InvoiceAgent {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model  = 'claude-sonnet-4-6';
  }

  /**
   * Extract structured invoice data from raw document text.
   * @param {string} documentText - Raw text extracted from the invoice PDF
   * @param {string} documentId   - UUID of the document record
   * @returns {Promise<object>}   - Validated, normalised extraction result
   */
  async extract(documentText, documentId) {
    logger.info('InvoiceAgent: starting extraction', { documentId });

    if (!documentText || documentText.trim().length < 50) {
      throw new Error('Invoice document text is too short or empty for extraction');
    }

    const userMessage = `Extract all Commercial Invoice fields from the following document text:\n\n---\n${documentText}\n---`;

    let rawJson;

    if (process.env.USE_MOCK_LLM === 'true') {
      rawJson = this._getMockExtraction();
    } else {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: [
          {
            type: 'text',
            text: INVOICE_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent) {
        throw new Error('InvoiceAgent: model returned no text content');
      }
      rawJson = textContent.text.trim();
    }

    rawJson = rawJson.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseErr) {
      logger.error('InvoiceAgent: JSON parse failure', { documentId, raw: rawJson.slice(0, 500) });
      throw new Error(`InvoiceAgent: could not parse model response as JSON: ${parseErr.message}`);
    }

    logger.info('InvoiceAgent: extraction complete', { documentId });
    return this.mapToStandardSchema(parsed, documentId);
  }

  mapToStandardSchema(raw, documentId) {
    const SCALAR_FIELDS = [
      'invoiceNumber', 'invoiceDate', 'seller', 'sellerAddress', 'buyer', 'buyerAddress',
      'goodsDescription', 'quantity', 'quantityUnit', 'unitPrice', 'totalValue',
      'currency', 'incoterms', 'incotermPort', 'countryOfOrigin', 'paymentTerms',
      'lcReference', 'portOfLoading', 'portOfDischarge', 'vesselOrCarrier',
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
        normalised[field] = { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: '' };
      }
      totalConfidence += normalised[field].confidence;
      fieldCount++;
    }

    // hsCodes - array field
    if (raw.hsCodes && typeof raw.hsCodes === 'object' && !Array.isArray(raw.hsCodes)) {
      normalised.hsCodes = {
        value:          Array.isArray(raw.hsCodes.value) ? raw.hsCodes.value : [],
        verbatimSource: typeof raw.hsCodes.verbatimSource === 'string' ? raw.hsCodes.verbatimSource : '',
        confidence:     this._clampConfidence(raw.hsCodes.confidence),
        ucpArticle:     typeof raw.hsCodes.ucpArticle === 'string' ? raw.hsCodes.ucpArticle : 'Art. 5',
      };
    } else {
      normalised.hsCodes = { value: [], verbatimSource: '', confidence: 0, ucpArticle: 'Art. 5' };
    }

    // lineItems
    normalised.lineItems = Array.isArray(raw.lineItems)
      ? raw.lineItems.map(item => ({
          description:    this._sanitiseValue(item.description),
          quantity:       this._sanitiseValue(item.quantity),
          unit:           this._sanitiseValue(item.unit),
          unitPrice:      this._sanitiseValue(item.unitPrice),
          lineTotal:      this._sanitiseValue(item.lineTotal),
          hsCode:         this._sanitiseValue(item.hsCode),
          verbatimSource: typeof item.verbatimSource === 'string' ? item.verbatimSource : '',
          confidence:     this._clampConfidence(item.confidence),
        }))
      : [];

    const overallConfidence = fieldCount > 0
      ? Math.round((totalConfidence / fieldCount) * 100) / 100
      : 0;

    return {
      documentType: 'invoice',
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

  _getMockExtraction() {
    return JSON.stringify({
      invoiceNumber:   { value: 'INV-MOCK-001', verbatimSource: 'Invoice No.: INV-MOCK-001', confidence: 0.95, ucpArticle: 'Art. 18' },
      invoiceDate:     { value: '2025-10-01', verbatimSource: 'Date: 01/10/2025', confidence: 0.9, ucpArticle: 'Art. 14(g)' },
      seller:          { value: 'MOCK BENEFICIARY LTD', verbatimSource: 'Seller: MOCK BENEFICIARY LTD', confidence: 0.9, ucpArticle: 'Art. 18' },
      sellerAddress:   { value: '123 Trade St, Export City', verbatimSource: '123 Trade St, Export City', confidence: 0.85, ucpArticle: 'Art. 18' },
      buyer:           { value: 'MOCK APPLICANT CORP', verbatimSource: 'Buyer: MOCK APPLICANT CORP', confidence: 0.9, ucpArticle: 'Art. 18' },
      buyerAddress:    { value: '456 Import Ave, City', verbatimSource: '456 Import Ave, City', confidence: 0.85, ucpArticle: 'Art. 18' },
      goodsDescription:{ value: 'MOCK GOODS', verbatimSource: 'Description: MOCK GOODS', confidence: 0.85, ucpArticle: 'Art. 18' },
      quantity:        { value: '1000', verbatimSource: 'Quantity: 1000', confidence: 0.9, ucpArticle: 'Art. 30' },
      quantityUnit:    { value: 'UNITS', verbatimSource: '1000 UNITS', confidence: 0.9, ucpArticle: 'Art. 30' },
      unitPrice:       { value: '100.00', verbatimSource: 'Unit Price: USD 100.00', confidence: 0.9, ucpArticle: 'Art. 30' },
      totalValue:      { value: '100000.00', verbatimSource: 'Total: USD 100,000.00', confidence: 1.0, ucpArticle: 'Art. 18' },
      currency:        { value: 'USD', verbatimSource: 'USD 100,000.00', confidence: 1.0, ucpArticle: 'Art. 18' },
      incoterms:       { value: 'CIF', verbatimSource: 'CIF ROTTERDAM', confidence: 0.95, ucpArticle: 'Art. 4' },
      incotermPort:    { value: 'ROTTERDAM', verbatimSource: 'CIF ROTTERDAM', confidence: 0.9, ucpArticle: 'Art. 4' },
      hsCodes:         { value: ['6204.42.00'], verbatimSource: 'HS: 6204.42.00', confidence: 0.85, ucpArticle: 'Art. 5' },
      countryOfOrigin: { value: 'CHINA', verbatimSource: 'Country of Origin: CHINA', confidence: 0.9, ucpArticle: 'Art. 5' },
      paymentTerms:    { value: 'At sight under LC', verbatimSource: 'Payment: At sight under LC', confidence: 0.85, ucpArticle: 'Art. 7' },
      lcReference:     { value: 'LC-MOCK-001', verbatimSource: 'L/C No.: LC-MOCK-001', confidence: 0.9, ucpArticle: 'Art. 4' },
      portOfLoading:   { value: 'SHANGHAI', verbatimSource: 'Port of Loading: SHANGHAI', confidence: 0.9, ucpArticle: 'Art. 20' },
      portOfDischarge: { value: 'ROTTERDAM', verbatimSource: 'Port of Discharge: ROTTERDAM', confidence: 0.9, ucpArticle: 'Art. 20' },
      vesselOrCarrier: { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 20' },
      lineItems: [],
    });
  }
}

module.exports = InvoiceAgent;
