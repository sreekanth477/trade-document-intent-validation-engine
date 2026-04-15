'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

// ---------------------------------------------------------------------------
// Insurance Agent
// Extracts structured fields from a Marine Insurance Policy / Certificate.
// Every field carries verbatim source text, UCP 600 article tag, and confidence.
// Includes coverage gap pre-check logic.
// ---------------------------------------------------------------------------

const INSURANCE_SYSTEM_PROMPT = `You are an expert trade finance document examiner specialising in Marine Insurance documents under UCP 600 Article 28 and the ICC's International Standard Banking Practice (ISBP 745).

Your task is to extract structured data from the raw text of a Marine Insurance Policy or Certificate and return it as a single, valid JSON object. You must follow every rule below without exception.

════════════════════════════════════════════════════════
EXTRACTION RULES
════════════════════════════════════════════════════════

RULE 1 — VERBATIM CITATION IS MANDATORY
For every field you extract, you MUST copy the exact substring from the source document that proves the value. verbatimSource must be a direct, unmodified quote. Do not paraphrase, summarise, or reformat. Empty verbatimSource is NEVER allowed when a value was found.

RULE 2 — NOT_FOUND FOR ABSENT FIELDS
If a required field is not present in the document, set value to "NOT_FOUND", verbatimSource to "" and confidence to 0. Never infer, assume, or construct a value not explicitly in the document. Never hallucinate.

RULE 3 — UCP ARTICLE TAGGING
Every field must reference "Art. 28" unless another article is more specific. Use forms such as "Art. 28", "Art. 14(d)".

RULE 4 — CONFIDENCE SCORING
confidence is a decimal 0.0–1.0. Use 1.0 only for unambiguous values. Use 0.7–0.9 for clearly present but slightly ambiguous. Use 0.3–0.6 for uncertain. Use 0 for NOT_FOUND.

RULE 5 — PERILS COVERED
Extract the perils/risks covered as an array of strings. Common values: "Institute Cargo Clauses A", "Institute Cargo Clauses B", "Institute Cargo Clauses C", "Institute War Clauses", "Institute Strike Clauses", "All Risks", "Total Loss Only". Extract exactly as stated.

RULE 6 — EXCLUSIONS
Extract notable exclusions as an array of strings. If none stated, return [].

RULE 7 — INSURED VALUE
Extract the numeric insured amount as a string. Note if it represents 110% of invoice value (required by UCP 600 Art. 28(f)).

RULE 8 — EFFECTIVE DATE
The insurance must be effective no later than the date of shipment (UCP Art. 28(e)). Extract exactly as stated.

RULE 9 — CLAIMS PAYABLE
Extract where and in what currency claims are payable. This is critical for LC compliance.

RULE 10 — OUTPUT FORMAT
Return ONLY the JSON object. No markdown fences, no commentary. Must be parseable by JSON.parse().

════════════════════════════════════════════════════════
TARGET SCHEMA
════════════════════════════════════════════════════════

{
  "policyNumber":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "certificateNumber":{ "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "documentSubtype":  { "value": "policy" | "certificate" | "declaration" | "NOT_FOUND", "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "insurer":          { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "insuredParty":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "insuredValue":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "currency":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "coveragePercentage":{ "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "coverageType":     { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "perilsCovered":    { "value": [string], "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "exclusions":       { "value": [string], "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "effectiveDate":    { "value": string (ISO 8601), "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "expiryDate":       { "value": string (ISO 8601), "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "portOfLoading":    { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "portOfDischarge":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "vesselOrConveyance":{ "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "marksAndNumbers":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "cargoDescription": { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "claimsPayableAt":  { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "claimsPayableCurrency": { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "signedBy":         { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "signerCapacity":   { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 28" },
  "lcReference":      { "value": string, "verbatimSource": string, "confidence": number, "ucpArticle": "Art. 4" }
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 1
════════════════════════════════════════════════════════

INPUT DOCUMENT EXCERPT:
"MARINE CARGO INSURANCE CERTIFICATE No. MC-2024-GER-004521
Issued by: ALLIANZ SE, KÖNIGINSTRASSE 28, 80802 MUNICH, GERMANY
Insured: GUANGDONG ELECTRONICS IMPORT CO LTD
Insured Amount: EUR 2,695,000.00 (representing 110% of invoice value)
Coverage: Institute Cargo Clauses (A) including Institute War Clauses (Cargo) and Institute Strike Clauses (Cargo)
Exclusions: Inherent Vice, Delay, Nuclear Risks
Voyage: From Hamburg, Germany to Hong Kong, China
Vessel: COSCO ATLANTIC Voyage 024W
Effective from: 30 September 2024 (date of loading)
Expiry: 60 days after arrival at port of discharge
Claims payable at: HONG KONG in currency of the Credit (EUR)
L/C Reference: LC-2024-HK-00321
Signed: ALLIANZ SE by authorised signatory"

EXPECTED JSON OUTPUT (excerpt):
{
  "policyNumber":   { "value": "NOT_FOUND", "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 28" },
  "certificateNumber": { "value": "MC-2024-GER-004521", "verbatimSource": "MARINE CARGO INSURANCE CERTIFICATE No. MC-2024-GER-004521", "confidence": 1.0, "ucpArticle": "Art. 28" },
  "documentSubtype":{ "value": "certificate", "verbatimSource": "MARINE CARGO INSURANCE CERTIFICATE", "confidence": 1.0, "ucpArticle": "Art. 28" },
  "insurer":        { "value": "ALLIANZ SE, KÖNIGINSTRASSE 28, 80802 MUNICH, GERMANY", "verbatimSource": "Issued by: ALLIANZ SE, KÖNIGINSTRASSE 28, 80802 MUNICH, GERMANY", "confidence": 1.0, "ucpArticle": "Art. 28" },
  "insuredValue":   { "value": "2695000.00", "verbatimSource": "EUR 2,695,000.00 (representing 110% of invoice value)", "confidence": 1.0, "ucpArticle": "Art. 28" },
  "coveragePercentage": { "value": "110%", "verbatimSource": "representing 110% of invoice value", "confidence": 1.0, "ucpArticle": "Art. 28" },
  "perilsCovered":  { "value": ["Institute Cargo Clauses (A)", "Institute War Clauses (Cargo)", "Institute Strike Clauses (Cargo)"], "verbatimSource": "Institute Cargo Clauses (A) including Institute War Clauses (Cargo) and Institute Strike Clauses (Cargo)", "confidence": 1.0, "ucpArticle": "Art. 28" },
  "claimsPayableAt": { "value": "HONG KONG", "verbatimSource": "Claims payable at: HONG KONG in currency of the Credit (EUR)", "confidence": 1.0, "ucpArticle": "Art. 28" }
}

════════════════════════════════════════════════════════
EXAMPLE EXTRACTION 2 — MISSING COVERAGE DETAILS
════════════════════════════════════════════════════════

If perils covered are not stated:
{
  "perilsCovered": { "value": [], "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 28" }
}

If coverage percentage is missing:
{
  "coveragePercentage": { "value": "NOT_FOUND", "verbatimSource": "", "confidence": 0, "ucpArticle": "Art. 28" }
}

════════════════════════════════════════════════════════
Now extract from the document provided by the user. Return ONLY valid JSON.
════════════════════════════════════════════════════════`;

class InsuranceAgent {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model  = 'claude-sonnet-4-6';
  }

  async extract(documentText, documentId) {
    logger.info('InsuranceAgent: starting extraction', { documentId });

    if (!documentText || documentText.trim().length < 50) {
      throw new Error('Insurance document text is too short or empty for extraction');
    }

    const userMessage = `Extract all Marine Insurance fields from the following document text:\n\n---\n${documentText}\n---`;

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
            text: INSURANCE_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [{ role: 'user', content: userMessage }],
      });

      const textContent = response.content.find(c => c.type === 'text');
      if (!textContent) {
        throw new Error('InsuranceAgent: model returned no text content');
      }
      rawJson = textContent.text.trim();
    }

    rawJson = rawJson.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(rawJson);
    } catch (parseErr) {
      logger.error('InsuranceAgent: JSON parse failure', { documentId, raw: rawJson.slice(0, 500) });
      throw new Error(`InsuranceAgent: could not parse model response as JSON: ${parseErr.message}`);
    }

    const normalised = this.mapToStandardSchema(parsed, documentId);

    // Run coverage gap pre-check
    normalised.coverageGapCheck = this._preCheckCoverageGaps(normalised.fields);

    logger.info('InsuranceAgent: extraction complete', { documentId });
    return normalised;
  }

  mapToStandardSchema(raw, documentId) {
    const SCALAR_FIELDS = [
      'policyNumber', 'certificateNumber', 'documentSubtype', 'insurer', 'insuredParty',
      'insuredValue', 'currency', 'coveragePercentage', 'coverageType',
      'effectiveDate', 'expiryDate', 'portOfLoading', 'portOfDischarge',
      'vesselOrConveyance', 'marksAndNumbers', 'cargoDescription',
      'claimsPayableAt', 'claimsPayableCurrency', 'signedBy', 'signerCapacity', 'lcReference',
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
      } else {
        normalised[field] = { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 28' };
      }
      totalConfidence += normalised[field].confidence;
      fieldCount++;
    }

    // perilsCovered - array field
    if (raw.perilsCovered && typeof raw.perilsCovered === 'object') {
      normalised.perilsCovered = {
        value:          Array.isArray(raw.perilsCovered.value) ? raw.perilsCovered.value : [],
        verbatimSource: typeof raw.perilsCovered.verbatimSource === 'string' ? raw.perilsCovered.verbatimSource : '',
        confidence:     this._clampConfidence(raw.perilsCovered.confidence),
        ucpArticle:     'Art. 28',
      };
    } else {
      normalised.perilsCovered = { value: [], verbatimSource: '', confidence: 0, ucpArticle: 'Art. 28' };
    }

    // exclusions - array field
    if (raw.exclusions && typeof raw.exclusions === 'object') {
      normalised.exclusions = {
        value:          Array.isArray(raw.exclusions.value) ? raw.exclusions.value : [],
        verbatimSource: typeof raw.exclusions.verbatimSource === 'string' ? raw.exclusions.verbatimSource : '',
        confidence:     this._clampConfidence(raw.exclusions.confidence),
        ucpArticle:     'Art. 28',
      };
    } else {
      normalised.exclusions = { value: [], verbatimSource: '', confidence: 0, ucpArticle: 'Art. 28' };
    }

    const overallConfidence = fieldCount > 0
      ? Math.round((totalConfidence / fieldCount) * 100) / 100
      : 0;

    return {
      documentType: 'insurance',
      documentId:   documentId || null,
      extractedAt:  new Date().toISOString(),
      overallConfidence,
      fields: normalised,
    };
  }

  /**
   * Pre-check for common coverage gaps against UCP 600 Art. 28 requirements.
   * Returns an array of gap warnings (not full findings - those come from IntentAnalysisEngine).
   * @param {object} fields - normalised insurance fields
   * @returns {Array<object>} coverage gap warnings
   */
  _preCheckCoverageGaps(fields) {
    const gaps = [];

    // Check 1: Minimum 110% coverage
    const coveragePct = fields.coveragePercentage?.value;
    if (coveragePct && coveragePct !== 'NOT_FOUND') {
      const pctMatch = coveragePct.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) {
        const pct = parseFloat(pctMatch[1]);
        if (pct < 110) {
          gaps.push({
            gapType: 'INSUFFICIENT_COVERAGE_PERCENTAGE',
            severity: 'critical',
            description: `Insurance coverage is ${pct}%, but UCP 600 Art. 28(f) requires minimum 110% of the CIF or CIP value.`,
            verbatimSource: fields.coveragePercentage.verbatimSource,
            ucpArticle: 'Art. 28(f)',
          });
        }
      }
    } else {
      gaps.push({
        gapType: 'COVERAGE_PERCENTAGE_NOT_STATED',
        severity: 'moderate',
        description: 'Coverage percentage is not explicitly stated in the insurance document. Manual verification against invoice value required.',
        verbatimSource: '',
        ucpArticle: 'Art. 28(f)',
      });
    }

    // Check 2: Perils covered - at minimum should include ICC A, B, or C
    const perils = fields.perilsCovered?.value || [];
    const hasICC  = perils.some(p =>
      /institute cargo clause/i.test(p) || /ICC\s*[ABC]/i.test(p) || /all risks/i.test(p)
    );
    if (perils.length === 0) {
      gaps.push({
        gapType: 'PERILS_NOT_STATED',
        severity: 'critical',
        description: 'No perils covered are stated in the insurance document. UCP 600 Art. 28(g) requires risks specified in the credit to be covered.',
        verbatimSource: '',
        ucpArticle: 'Art. 28(g)',
      });
    } else if (!hasICC) {
      gaps.push({
        gapType: 'ICC_CLAUSES_NOT_REFERENCED',
        severity: 'moderate',
        description: 'Institute Cargo Clauses (A/B/C) are not explicitly referenced. Coverage adequacy cannot be confirmed without knowing the applicable clause set.',
        verbatimSource: fields.perilsCovered.verbatimSource,
        ucpArticle: 'Art. 28(g)',
      });
    }

    // Check 3: Effective date present
    if (!fields.effectiveDate || fields.effectiveDate.value === 'NOT_FOUND') {
      gaps.push({
        gapType: 'EFFECTIVE_DATE_MISSING',
        severity: 'critical',
        description: 'Insurance effective date is not stated. UCP 600 Art. 28(e) requires insurance to be effective no later than the date of shipment.',
        verbatimSource: '',
        ucpArticle: 'Art. 28(e)',
      });
    }

    // Check 4: Claims payable location
    if (!fields.claimsPayableAt || fields.claimsPayableAt.value === 'NOT_FOUND') {
      gaps.push({
        gapType: 'CLAIMS_PAYABLE_LOCATION_MISSING',
        severity: 'moderate',
        description: 'Claims payable location is not stated. UCP 600 Art. 28(h) requires claims to be payable in the currency of the credit.',
        verbatimSource: '',
        ucpArticle: 'Art. 28(h)',
      });
    }

    // Check 5: Currency
    if (!fields.currency || fields.currency.value === 'NOT_FOUND') {
      gaps.push({
        gapType: 'INSURANCE_CURRENCY_MISSING',
        severity: 'moderate',
        description: 'Insurance currency is not stated. UCP 600 Art. 28(h) requires insurance documents to be in the same currency as the credit.',
        verbatimSource: '',
        ucpArticle: 'Art. 28(h)',
      });
    }

    return gaps;
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
      policyNumber:     { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 28' },
      certificateNumber:{ value: 'MC-MOCK-001', verbatimSource: 'Certificate No.: MC-MOCK-001', confidence: 0.95, ucpArticle: 'Art. 28' },
      documentSubtype:  { value: 'certificate', verbatimSource: 'MARINE CARGO INSURANCE CERTIFICATE', confidence: 1.0, ucpArticle: 'Art. 28' },
      insurer:          { value: 'MOCK INSURANCE CO', verbatimSource: 'Insurer: MOCK INSURANCE CO', confidence: 0.9, ucpArticle: 'Art. 28' },
      insuredParty:     { value: 'MOCK APPLICANT CORP', verbatimSource: 'Insured: MOCK APPLICANT CORP', confidence: 0.9, ucpArticle: 'Art. 28' },
      insuredValue:     { value: '110000.00', verbatimSource: 'Insured Amount: USD 110,000.00', confidence: 0.95, ucpArticle: 'Art. 28' },
      currency:         { value: 'USD', verbatimSource: 'USD 110,000.00', confidence: 1.0, ucpArticle: 'Art. 28' },
      coveragePercentage:{ value: '110%', verbatimSource: '110% of invoice value', confidence: 0.95, ucpArticle: 'Art. 28' },
      coverageType:     { value: 'Marine Cargo', verbatimSource: 'Marine Cargo Insurance', confidence: 0.9, ucpArticle: 'Art. 28' },
      perilsCovered:    { value: ['Institute Cargo Clauses (A)', 'Institute War Clauses (Cargo)'], verbatimSource: 'Institute Cargo Clauses (A) and Institute War Clauses (Cargo)', confidence: 0.95, ucpArticle: 'Art. 28' },
      exclusions:       { value: ['Inherent Vice', 'Delay'], verbatimSource: 'Exclusions: Inherent Vice, Delay', confidence: 0.85, ucpArticle: 'Art. 28' },
      effectiveDate:    { value: '2025-10-04', verbatimSource: 'Effective from: 04/10/2025', confidence: 0.9, ucpArticle: 'Art. 28' },
      expiryDate:       { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 28' },
      portOfLoading:    { value: 'SHANGHAI', verbatimSource: 'From: SHANGHAI', confidence: 0.9, ucpArticle: 'Art. 28' },
      portOfDischarge:  { value: 'ROTTERDAM', verbatimSource: 'To: ROTTERDAM', confidence: 0.9, ucpArticle: 'Art. 28' },
      vesselOrConveyance:{ value: 'MOCK VESSEL', verbatimSource: 'Vessel: MOCK VESSEL', confidence: 0.85, ucpArticle: 'Art. 28' },
      marksAndNumbers:  { value: 'NOT_FOUND', verbatimSource: '', confidence: 0, ucpArticle: 'Art. 28' },
      cargoDescription: { value: 'MOCK GOODS', verbatimSource: 'Cargo: MOCK GOODS', confidence: 0.85, ucpArticle: 'Art. 28' },
      claimsPayableAt:  { value: 'ROTTERDAM', verbatimSource: 'Claims payable at: ROTTERDAM', confidence: 0.9, ucpArticle: 'Art. 28' },
      claimsPayableCurrency:{ value: 'USD', verbatimSource: 'in USD', confidence: 0.9, ucpArticle: 'Art. 28' },
      signedBy:         { value: 'MOCK INSURANCE CO', verbatimSource: 'Signed: MOCK INSURANCE CO', confidence: 0.85, ucpArticle: 'Art. 28' },
      signerCapacity:   { value: 'Insurer', verbatimSource: 'by authorised signatory', confidence: 0.8, ucpArticle: 'Art. 28' },
      lcReference:      { value: 'LC-MOCK-001', verbatimSource: 'L/C Ref: LC-MOCK-001', confidence: 0.9, ucpArticle: 'Art. 4' },
    });
  }
}

module.exports = InsuranceAgent;
