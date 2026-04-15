'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

// ---------------------------------------------------------------------------
// Bill of Lading Agent
// Extracts structured fields from a Bill of Lading document text.
// Every field carries verbatim source text, UCP 600 article tag, and confidence.
// Includes port validation against UN/LOCODE format patterns.
// ---------------------------------------------------------------------------

// UN/LOCODE pattern: 2-letter country code + 3-char location code
const LOCODE_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}$/;

const BL_SYSTEM_PROMPT = `You are an expert trade finance document examiner specialising in Bills of Lading under UCP 600 Articles 19–27 and the ICC's International Standard Banking Practice (ISBP 745).

Your task is to extract structured data from the raw text of a Bill of Lading document and return it as a single, valid JSON object. You must follow every rule below without exception.

════════════════════════════════════════════════════════
EXTRACTION RULES
════════════════════════════════════════════════════════

RULE 1 — VERBATIM CITATION IS MANDATORY
For every field you extract, you MUST copy the exact substring from the source document that proves the value. verbatimSource must be a direct, unmodified quote. Do not paraphrase, summarise, or reformat. Empty verbatimSource is NEVER allowed when a value was found.

RULE 2 — NOT_FOUND FOR ABSENT FIELDS
If a required field is not present in the document, set value to "NOT_FOUND", verbatimSource to "" and confidence to 0. Never infer, assume, or construct a value not explicitly in the document. Never hallucinate.

RULE 3 — UCP ARTICLE TAGGING
Every field must reference the most relevant UCP 600 article in ucpArticle. Use forms such as "Art. 20", "Art. 14(d)", "Art. 27".

RULE 4 — CONFIDENCE SCORING
confidence is a decimal 0.0–1.0. Use 1.0 only for unambiguous values. Use 0.7–0.9 for clearly present but slightly ambiguous. Use 0.3–0.6 for uncertain. Use 0 for NOT_FOUND.

RULE 5 — ON-BOARD DATE vs BL DATE
Distinguish carefully between the BL issue date and the on-board date (which is the date of shipment under UCP 600 Art. 20). If there is an on-board notation with a separate date, that is the shipment date. If the BL is already an on-board BL without a separate notation, the BL date itself is the shipment date.

RULE 6 — CONTAINER NUMBERS
Extract all container numbers as an array of strings. If none, return [].

RULE 7 — FREIGHT TERMS
Identify whether freight is prepaid or collect. Note any superimposed clauses.

RULE 8 — CLEAN BL CHECK
Note if there are any clauses declaring defective condition of goods or packaging (Art. 27). Set isClean to false if such clauses exist.

RULE 9 — PORTS
Extract port names exactly as stated. Also attempt to extract or infer UN/LOCODE if stated.

RULE 10 — OUTPUT FORMAT
Return ONLY the JSON object. No markdown fences, no commentary. Must be parseable by JSON.parse().

════════════════════════════════════════════════════════
TARGET SCHEMA
════════════════════════════════════════════════════════

{
  "blNumber":           { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "blDate":             { "value": string (ISO 8601), "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "onBoardDate":        { "value": string (ISO 8601), "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "shipper":            { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 14(i)" },
  "consignee":          { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 14(j)" },
  "notifyParty":        { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 14(j)" },
  "carrier":            { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "vesselName":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "voyageNumber":       { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "portOfLoading":      { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20", "locode": string },
  "portOfDischarge":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20", "locode": string },
  "placeOfReceipt":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 19" },
  "placeOfDelivery":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 19" },
  "cargoDescription":   { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 14(e)" },
  "grossWeight":        { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "grossWeightUnit":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "measurement":        { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "numberOfPackages":   { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "packageType":        { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "containerNumbers":   { "value": [string], "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "sealNumbers":        { "value": [string], "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "freightTerms":       { "value": "prepaid" | "collect" | "NOT_FOUND", "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 26" },
  "isClean":            { "value": boolean, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 27" },
  "clauseRemarks":      { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 27" },
  "numberOfOriginals":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 17" },
  "signedBy":           { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" },
  "signatoryCapacity":  { "value": "carrier" | "agent" | "master" | "owner" | "NOT_FOUND", "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 20" }
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 1
════════════════════════════════════════════════════════

INPUT DOCUMENT EXCERPT:
"BILL OF LADING No. BL-2024-SHA-00891
Carrier: COSCO SHIPPING LINES CO LTD
Vessel: COSCO ATLANTIC    Voyage: 024W
Shipper: SIEMENS AG, WERNER-VON-SIEMENS-STRASSE 1, MUNICH, GERMANY
Consignee: TO ORDER OF HSBC HONG KONG LIMITED
Notify Party: GUANGDONG ELECTRONICS IMPORT CO LTD, GUANGZHOU, CHINA
Port of Loading: SHANGHAI, CHINA
Port of Discharge: HONG KONG, CHINA
Description: INDUSTRIAL AUTOMATION EQUIPMENT – 500 UNITS SIMATIC S7-1500 PLC CONTROLLERS
Gross Weight: 12,500 KGS    Measurement: 65.5 CBM
Containers: COSU1234567/8 COSU2345678/9
Freight: PREPAID
Date of Issue: 01 October 2024
Shipped on Board: 30 September 2024
Signed for the Carrier COSCO SHIPPING LINES CO LTD by their Agent: COSCO (HK) SHIPPING CO LTD
Number of originals: THREE (3)"

EXPECTED JSON OUTPUT (excerpt):
{
  "blNumber":     { "value": "BL-2024-SHA-00891", "verbatimSource": "BILL OF LADING No. BL-2024-SHA-00891", "confidence": 1.0, "ucpArticle": "Art. 20" },
  "blDate":       { "value": "2024-10-01", "verbatimSource": "Date of Issue: 01 October 2024", "confidence": 1.0, "ucpArticle": "Art. 20" },
  "onBoardDate":  { "value": "2024-09-30", "verbatimSource": "Shipped on Board: 30 September 2024", "confidence": 1.0, "ucpArticle": "Art. 20" },
  "vesselName":   { "value": "COSCO ATLANTIC", "verbatimSource": "Vessel: COSCO ATLANTIC", "confidence": 1.0, "ucpArticle": "Art. 20" },
  "freightTerms": { "value": "prepaid", "verbatimSource": "Freight: PREPAID", "confidence": 1.0, "ucpArticle": "Art. 26" },
  "isClean":      { "value": true, "verbatimSource": "No clauses declaring defective condition found", "confidence": 0.9, "ucpArticle": "Art. 27" },
  "containerNumbers": { "value": ["COSU1234567", "COSU2345678"], "verbatimSource": "Containers: COSU1234567/8 COSU2345678/9", "confidence": 0.95, "ucpArticle": "Art. 20" }
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 2 — CLAUSED BL
════════════════════════════════════════════════════════

If the BL contains "2 CARTONS DAMAGED PRIOR TO LOADING":
{
  "isClean": { "value": false, "verbatimSource": "2 CARTONS DAMAGED PRIOR TO LOADING", "confidence": 1.0, "ucpArticle": "Art. 27" },
  "clauseRemarks": { "value": "2 CARTONS DAMAGED PRIOR TO LOADING", "verbatimSource": "2 CARTONS DAMAGED PRIOR TO LOADING", "confidence": 1.0, "ucpArticle": "Art. 27" }
}

════════════════════════════════════════════════════════
Now extract from the document provided by the user. Return ONLY valid JSON.
════════════════════════════════════════════════════════`;

// Common port name to UN/LOCODE mapping for validation
const PORT_LOCODE_HINTS = {
  'SHANGHAI': 'CNSHA', 'HONG KONG': 'HKHKG', 'SINGAPORE': 'SGSIN',
  'ROTTERDAM': 'NLRTM', 'HAMBURG': 'DEHAM', 'ANTWERP': 'BEANR',
  'LOS ANGELES': 'USLAX', 'LONG BEACH': 'USLGB', 'NEW YORK': 'USNYC',
  'DUBAI': 'AEDXB', 'JEBEL ALI': 'AEJEA', 'BUSAN': 'KRPUS',
  'YOKOHAMA': 'JPYOK', 'TOKYO': 'JPTYO', 'MUMBAI': 'INBOM',
  'CHENNAI': 'INMAA', 'COLOMBO': 'LKCMB', 'KLANG': 'MYPKG',
  'TANJUNG PELEPAS': 'MYLYP', 'GUANGZHOU': 'CNGZU', 'SHENZHEN': 'CNSZX',
  'TIANJIN': 'CNTXG', 'QINGDAO': 'CNTAO', 'NINGBO': 'CNNBO',
};

class BLAgent {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model  = 'claude-sonnet-4-6';
  }

  async extract(documentText, documentId) {
    logger.info('BLAgent: starting extraction', { documentId });

    if (!documentText || documentText.trim().length < 50) {
      throw new Error('BL document text is too short or empty for extraction');
    }

    const userMessage = `Extract all Bill of Lading fields from the following document text:\n\n---\n${documentText}\n---`;

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
            text: BL_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent) {
        throw new Error('BLAgent: model returned no text content');
      }
      rawJson = textContent.text.trim();
    }

    rawJson = rawJson.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseErr) {
      logger.error('BLAgent: JSON parse failure', { documentId, raw: rawJson.slice(0, 500) });
      throw new Error(`BLAgent: could not parse model response as JSON: ${parseErr.message}`);
    }

    const normalised = this.mapToStandardSchema(parsed, documentId);

    // Port validation
    normalised.portValidation = this._validatePorts(normalised.fields);

    logger.info('BLAgent: extraction complete', { documentId });
    return normalised;
  }

  mapToStandardSchema(raw, documentId) {
    const SCALAR_FIELDS = [
      'blNumber', 'blDate', 'onBoardDate', 'shipper', 'consignee', 'notifyParty',
      'carrier', 'vesselName', 'voyageNumber', 'portOfLoading', 'portOfDischarge',
      'placeOfReceipt', 'placeOfDelivery', 'cargoDescription', 'grossWeight',
      'grossWeightUnit', 'measurement', 'numberOfPackages', 'packageType',
      'freightTerms', 'clauseRemarks', 'numberOfOriginals', 'signedBy', 'signatoryCapacity',
    ];

    const normalised = {};
    let totalConfidence = 0;
    let fieldCount = 0;

    for (const field of SCALAR_FIELDS) {
      const entry = raw[field];
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        normalised[field] = {
          value:          this._sanitiseValue(entry.value),
          verbatimSource: typeof entry.verbatimSource === 'string' ? entry.verbatimSource : '',
          confidence:     this._clampConfidence(entry.confidence),
          ucpArticle:     typeof entry.ucpArticle === 'string' ? entry.ucpArticle : '',
        };
        // Preserve locode if present
        if (entry.locode) normalised[field].locode = entry.locode;
      } else {
        normalised[field] = { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: '' };
      }
      totalConfidence += normalised[field].confidence;
      fieldCount++;
    }

    // isClean - boolean field
    if (raw.isClean && typeof raw.isClean === 'object') {
      normalised.isClean = {
        value:          typeof raw.isClean.value === 'boolean' ? raw.isClean.value : true,
        verbatimSource: typeof raw.isClean.verbatimSource === 'string' ? raw.isClean.verbatimSource : '',
        confidence:     this._clampConfidence(raw.isClean.confidence),
        ucpArticle:     'Art. 27',
      };
    } else {
      normalised.isClean = { value: true, verbatimSource: '', confidence: 0.5, ucpArticle: 'Art. 27' };
    }

    // containerNumbers
    if (raw.containerNumbers && typeof raw.containerNumbers === 'object') {
      normalised.containerNumbers = {
        value:          Array.isArray(raw.containerNumbers.value) ? raw.containerNumbers.value : [],
        verbatimSource: typeof raw.containerNumbers.verbatimSource === 'string' ? raw.containerNumbers.verbatimSource : '',
        confidence:     this._clampConfidence(raw.containerNumbers.confidence),
        ucpArticle:     'Art. 20',
      };
    } else {
      normalised.containerNumbers = { value: [], verbatimSource: '', confidence: 0, ucpArticle: 'Art. 20' };
    }

    // sealNumbers
    if (raw.sealNumbers && typeof raw.sealNumbers === 'object') {
      normalised.sealNumbers = {
        value:          Array.isArray(raw.sealNumbers.value) ? raw.sealNumbers.value : [],
        verbatimSource: typeof raw.sealNumbers.verbatimSource === 'string' ? raw.sealNumbers.verbatimSource : '',
        confidence:     this._clampConfidence(raw.sealNumbers.confidence),
        ucpArticle:     'Art. 20',
      };
    } else {
      normalised.sealNumbers = { value: [], verbatimSource: '', confidence: 0, ucpArticle: 'Art. 20' };
    }

    const overallConfidence = fieldCount > 0
      ? Math.round((totalConfidence / fieldCount) * 100) / 100
      : 0;

    return {
      documentType: 'bl',
      documentId:   documentId || null,
      extractedAt:  new Date().toISOString(),
      overallConfidence,
      fields: normalised,
    };
  }

  /**
   * Validate extracted port names against UN/LOCODE format hints.
   * @param {object} fields - normalised fields
   * @returns {object} validation result
   */
  _validatePorts(fields) {
    const results = {};

    for (const portField of ['portOfLoading', 'portOfDischarge', 'placeOfReceipt', 'placeOfDelivery']) {
      const portEntry = fields[portField];
      if (!portEntry || portEntry.value === 'NOT_FOUND') {
        results[portField] = { valid: null, locode: null, note: 'Port not found in document' };
        continue;
      }

      const portName = portEntry.value.toUpperCase().trim();
      const locode   = portEntry.locode || PORT_LOCODE_HINTS[portName] || null;

      let valid = null;
      let note  = '';

      if (locode) {
        valid = LOCODE_PATTERN.test(locode);
        note  = valid
          ? `Matched UN/LOCODE: ${locode}`
          : `Extracted LOCODE "${locode}" does not conform to UN/LOCODE format (2+3 chars)`;
      } else {
        note = 'UN/LOCODE not determinable from document; manual verification recommended';
      }

      results[portField] = { valid, locode, portName, note };
    }

    return results;
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
      blNumber:         { value: 'BL-MOCK-001', verbatimSource: 'B/L No.: BL-MOCK-001', confidence: 0.95, ucpArticle: 'Art. 20' },
      blDate:           { value: '2025-10-05', verbatimSource: 'Date of Issue: 05/10/2025', confidence: 0.9, ucpArticle: 'Art. 20' },
      onBoardDate:      { value: '2025-10-04', verbatimSource: 'Shipped on Board: 04/10/2025', confidence: 0.95, ucpArticle: 'Art. 20' },
      shipper:          { value: 'MOCK BENEFICIARY LTD', verbatimSource: 'Shipper: MOCK BENEFICIARY LTD', confidence: 0.9, ucpArticle: 'Art. 14(i)' },
      consignee:        { value: 'TO ORDER OF MOCK ISSUING BANK', verbatimSource: 'Consignee: TO ORDER OF MOCK ISSUING BANK', confidence: 0.9, ucpArticle: 'Art. 14(j)' },
      notifyParty:      { value: 'MOCK APPLICANT CORP', verbatimSource: 'Notify: MOCK APPLICANT CORP', confidence: 0.9, ucpArticle: 'Art. 14(j)' },
      carrier:          { value: 'MOCK CARRIER LINE', verbatimSource: 'Carrier: MOCK CARRIER LINE', confidence: 0.9, ucpArticle: 'Art. 20' },
      vesselName:       { value: 'MOCK VESSEL', verbatimSource: 'Vessel: MOCK VESSEL', confidence: 0.9, ucpArticle: 'Art. 20' },
      voyageNumber:     { value: '001E', verbatimSource: 'Voyage: 001E', confidence: 0.9, ucpArticle: 'Art. 20' },
      portOfLoading:    { value: 'SHANGHAI', verbatimSource: 'Port of Loading: SHANGHAI', confidence: 0.95, ucpArticle: 'Art. 20', locode: 'CNSHA' },
      portOfDischarge:  { value: 'ROTTERDAM', verbatimSource: 'Port of Discharge: ROTTERDAM', confidence: 0.95, ucpArticle: 'Art. 20', locode: 'NLRTM' },
      placeOfReceipt:   { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 19' },
      placeOfDelivery:  { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 19' },
      cargoDescription: { value: 'MOCK GOODS', verbatimSource: 'Description: MOCK GOODS', confidence: 0.85, ucpArticle: 'Art. 14(e)' },
      grossWeight:      { value: '10000', verbatimSource: 'Gross Weight: 10,000 KGS', confidence: 0.9, ucpArticle: 'Art. 20' },
      grossWeightUnit:  { value: 'KGS', verbatimSource: '10,000 KGS', confidence: 0.95, ucpArticle: 'Art. 20' },
      measurement:      { value: '50 CBM', verbatimSource: 'Measurement: 50 CBM', confidence: 0.9, ucpArticle: 'Art. 20' },
      numberOfPackages: { value: '100', verbatimSource: '100 CARTONS', confidence: 0.9, ucpArticle: 'Art. 20' },
      packageType:      { value: 'CARTONS', verbatimSource: '100 CARTONS', confidence: 0.9, ucpArticle: 'Art. 20' },
      containerNumbers: { value: ['MOCK1234567'], verbatimSource: 'Container: MOCK1234567', confidence: 0.9, ucpArticle: 'Art. 20' },
      sealNumbers:      { value: ['SEAL001'], verbatimSource: 'Seal: SEAL001', confidence: 0.85, ucpArticle: 'Art. 20' },
      freightTerms:     { value: 'prepaid', verbatimSource: 'Freight: PREPAID', confidence: 0.95, ucpArticle: 'Art. 26' },
      isClean:          { value: true, verbatimSource: 'Clean On Board', confidence: 0.9, ucpArticle: 'Art. 27' },
      clauseRemarks:    { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 27' },
      numberOfOriginals:{ value: 'THREE (3)', verbatimSource: 'No. of Originals: THREE (3)', confidence: 0.95, ucpArticle: 'Art. 17' },
      signedBy:         { value: 'MOCK SHIPPING AGENT', verbatimSource: 'Signed by: MOCK SHIPPING AGENT', confidence: 0.9, ucpArticle: 'Art. 20' },
      signatoryCapacity:{ value: 'agent', verbatimSource: 'as Agent for the Carrier', confidence: 0.9, ucpArticle: 'Art. 20' },
    });
  }
}

module.exports = BLAgent;
