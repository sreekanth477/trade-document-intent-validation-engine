'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../utils/logger');

// ---------------------------------------------------------------------------
// Tool definition for structured output via Anthropic Tool Use API
// ---------------------------------------------------------------------------
const RECORD_FINDINGS_TOOL = {
  name: 'record_findings',
  description: 'Record all cross-document validation findings after completing the full 6-dimension analysis. Call this ONCE after reasoning through all dimensions.',
  input_schema: {
    type: 'object',
    properties: {
      findings: {
        type: 'array',
        description: 'List of all validation findings discovered across the 6 dimensions',
        items: {
          type: 'object',
          properties: {
            findingType:       { type: 'string', description: 'One of the defined FINDING_TYPES constants' },
            severity:          { type: 'string', enum: ['critical', 'moderate', 'informational'] },
            title:             { type: 'string', description: 'Short, clear title of the discrepancy' },
            description:       { type: 'string', description: 'Detailed description of what was found and why it matters' },
            affectedDocuments: { type: 'array', items: { type: 'string', enum: ['lc', 'invoice', 'bl', 'insurance'] } },
            affectedFields:    { type: 'array', items: { type: 'string' } },
            verbatimQuotes: {
              type: 'array',
              description: 'MANDATORY: exact text from source documents proving this finding',
              items: {
                type: 'object',
                properties: {
                  document: { type: 'string', enum: ['lc', 'invoice', 'bl', 'insurance', 'meta'] },
                  field:    { type: 'string' },
                  text:     { type: 'string', description: 'Exact verbatim text from the document' },
                },
                required: ['document', 'field', 'text'],
              },
            },
            reasoning:         { type: 'string', description: 'Explanation of the reasoning behind this finding' },
            confidence:        { type: 'number', minimum: 0, maximum: 100 },
            ucpArticles:       { type: 'array', items: { type: 'string' }, description: 'Relevant UCP 600 articles e.g. ["Art. 14(d)", "Art. 18"]' },
            recommendedAction: { type: 'string' },
          },
          required: ['findingType', 'severity', 'title', 'description', 'affectedDocuments', 'verbatimQuotes', 'confidence', 'ucpArticles', 'recommendedAction'],
        },
      },
      dimensionSummary: {
        type: 'object',
        properties: {
          commercialCoherence:  { type: 'object', properties: { status: { type: 'string', enum: ['pass', 'fail', 'warning'] }, findingCount: { type: 'number' } }, required: ['status', 'findingCount'] },
          partyResolution:      { type: 'object', properties: { status: { type: 'string', enum: ['pass', 'fail', 'warning'] }, findingCount: { type: 'number' } }, required: ['status', 'findingCount'] },
          logisticsFeasibility: { type: 'object', properties: { status: { type: 'string', enum: ['pass', 'fail', 'warning'] }, findingCount: { type: 'number' } }, required: ['status', 'findingCount'] },
          coverageAlignment:    { type: 'object', properties: { status: { type: 'string', enum: ['pass', 'fail', 'warning'] }, findingCount: { type: 'number' } }, required: ['status', 'findingCount'] },
          temporalCoherence:    { type: 'object', properties: { status: { type: 'string', enum: ['pass', 'fail', 'warning'] }, findingCount: { type: 'number' } }, required: ['status', 'findingCount'] },
          tradePatternAnomaly:  { type: 'object', properties: { status: { type: 'string', enum: ['pass', 'fail', 'warning'] }, findingCount: { type: 'number' } }, required: ['status', 'findingCount'] },
        },
        required: ['commercialCoherence', 'partyResolution', 'logisticsFeasibility', 'coverageAlignment', 'temporalCoherence', 'tradePatternAnomaly'],
      },
    },
    required: ['findings', 'dimensionSummary'],
  },
};

// ---------------------------------------------------------------------------
// Intent Analysis Engine
// The core cross-document reasoning agent. Takes structured JSON from all 4
// extraction agents and reasons through 6 validation dimensions to produce
// a list of structured findings, each with verbatim citations.
// ---------------------------------------------------------------------------

const INTENT_ANALYSIS_SYSTEM_PROMPT = `You are a senior trade finance compliance examiner and fraud analyst with 20 years of experience in documentary credit examination under UCP 600. You have deep expertise in detecting discrepancies, fraud patterns, and anomalies across trade documents.

You will receive structured extracted data from four trade documents:
1. Letter of Credit (LC)
2. Commercial Invoice
3. Bill of Lading (BL)
4. Insurance Certificate/Policy

Your task is to perform a comprehensive cross-document analysis across SIX validation dimensions and produce a structured list of findings. Each finding must be grounded in verbatim field values from the input data.

════════════════════════════════════════════════════════
CRITICAL INSTRUCTIONS
════════════════════════════════════════════════════════

INSTRUCTION 1 — CHAIN-OF-THOUGHT REASONING (MANDATORY)
Before emitting any finding, explicitly reason through each dimension. Show your work. Write "DIMENSION [N] ANALYSIS:" followed by your step-by-step reasoning. Only after completing all 6 dimensions should you output the FINDINGS JSON block.

INSTRUCTION 2 — VERBATIM CITATION IS MANDATORY FOR EVERY FINDING
Every finding MUST include verbatimQuotes: an array of objects, each containing:
  - document: which document the quote comes from ("lc", "invoice", "bl", "insurance")
  - field: the field name
  - text: the EXACT verbatim text from the input JSON (copy from verbatimSource)
Do NOT create or invent quotes. If you cannot cite verbatim evidence, you CANNOT create a finding. A finding with no verbatim evidence is a hallucination and is strictly forbidden.

INSTRUCTION 3 — DISTINGUISH DEFINITIVE FROM JUDGMENT-CALL
Use severity "critical" for clear, unambiguous discrepancies (value mismatch, date violation, missing required document).
Use severity "moderate" for discrepancies requiring judgment (unusual but not necessarily wrong, partial data, plausible explanations exist).
Use severity "informational" for observations, recommendations, or borderline items.

INSTRUCTION 4 — UCP 600 ARTICLE REFERENCES
Every finding must cite the specific UCP 600 article(s) that the discrepancy violates or relates to. Use short form: "Art. 14(d)", "Art. 18", "Art. 20", "Art. 28".

INSTRUCTION 5 — NOT_FOUND FIELDS
If a field has value "NOT_FOUND", treat this as a potentially missing required document element. Assess whether the missing field is required by UCP 600 and raise a finding accordingly.

INSTRUCTION 6 — CONFIDENCE SCORE
Assign a confidence score 0–100 to each finding reflecting your certainty that this is a genuine issue:
  - 90–100: Mathematical certainty (e.g., amounts don't match, dates are impossible)
  - 70–89: Strong evidence but some ambiguity
  - 50–69: Moderate evidence, alternative explanations exist
  - Below 50: Speculative; only include if severity is critical

════════════════════════════════════════════════════════
SIX VALIDATION DIMENSIONS
════════════════════════════════════════════════════════

DIMENSION 1 — COMMERCIAL COHERENCE
Examine whether the goods/services described across all documents are consistent and non-conflicting.
- Does the invoice goods description match the LC goods description exactly? (UCP Art. 18 requires exact match)
- Does the BL cargo description align with the invoice (may use general terms per Art. 14(e), but must not conflict)?
- Does the insurance cargo description align with the invoice?
- Are HS codes consistent with the stated goods description?
- Is the unit price commercially plausible for the stated goods?
- Are quantities consistent across documents?
- Are weights and measures plausible for the stated goods and quantity?

DIMENSION 2 — PARTY AND ENTITY RESOLUTION
Examine whether all named parties are consistent and correctly identified across documents.
- Does the invoice seller match the LC beneficiary? (UCP Art. 18: invoice must be issued by beneficiary)
- Does the invoice buyer match the LC applicant? (UCP Art. 18: invoice must name applicant)
- Does the BL consignee align with the LC instructions?
- Does the BL notify party align with the LC applicant or as instructed?
- Does the insured party align with the expected party (usually applicant or beneficiary per trade terms)?
- Are entity names consistent (allowing for minor formatting differences but no substantive differences)?
- Are addresses in the correct countries per UCP Art. 14(j)?

DIMENSION 3 — LOGISTICS FEASIBILITY
Examine whether the physical logistics are coherent and plausible.
- Does the BL port of loading match the LC port of loading? (UCP Art. 20)
- Does the BL port of discharge match the LC port of discharge? (UCP Art. 20)
- Does the invoice port of loading/discharge match the BL?
- Is the on-board date on or before the LC latest shipment date? (UCP Art. 20)
- Is the on-board date before or on the BL date?
- Is the BL date within the presentation period after the on-board date? (UCP Art. 14(c): max 21 days)
- Is the shipment date plausible given the voyage distance and vessel type?
- Are transhipment terms consistent between the LC and BL?
- Does the vessel name/voyage appear on the insurance?

DIMENSION 4 — COVERAGE ALIGNMENT
Examine whether the insurance coverage adequately covers the cargo for the stated voyage.
- Is the insurance currency the same as the LC currency? (UCP Art. 28(h))
- Is the insured value at least 110% of the CIF invoice value? (UCP Art. 28(f))
- Does the insurance cover the correct port-to-port route?
- Does the insurance effective date predate or equal the shipment date? (UCP Art. 28(e))
- Are the perils covered at least as broad as required by the LC?
- Are there exclusions that would leave the cargo unprotected?
- Is claims payable location accessible to the entitled party?
- Does insurance cargo description match invoice goods?

DIMENSION 5 — TEMPORAL COHERENCE
Examine whether all dates form a logically and legally compliant timeline.
- Invoice date must not post-date the BL date (goods not yet shipped cannot be invoiced after shipment in most trade contexts)
- On-board date must not post-date the LC latest shipment date
- Insurance effective date must be on or before the shipment date
- BL date must be on or before the LC expiry date
- Presentation period: BL on-board date + 21 days must not exceed the LC expiry date
- Are any dates suspicious (e.g., weekend dates for banking documents, dates in the future)?
- Are dates internally consistent within each document?

PRESENTATION PERIOD DEADLINE CHECK (MANDATORY):
The input includes meta.submissionDate (today's date) and meta.presentationDeadline (onBoardDate + 21 days).
If meta.presentationDeadline is not null and meta.submissionDate > meta.presentationDeadline, raise a CRITICAL finding:
- findingType: "PRESENTATION_PERIOD_EXCEEDED"
- title: "Documents Presented Outside 21-Day Presentation Period"
- ucpArticles: ["Art. 14(c)"]
- verbatimQuotes: include the onBoardDate from the BL and the submissionDate from meta

DIMENSION 6 — TRADE PATTERN ANOMALY
Examine the overall trade for statistically unusual or potentially suspicious patterns.
- Is the trade route commercially logical (are origin and destination countries consistent with stated goods)?
- Is the currency combination unusual for this trade corridor?
- Are the Incoterms consistent across all documents, and are they appropriate for the mode of transport?
- Does the insured value vs invoice value ratio suggest over-invoicing?
- Are there any round-number amounts that suggest fabrication (exact round numbers in complex international trade are rare)?
- Is the goods description vague in ways that could facilitate misrepresentation?
- Are the parties' countries consistent with known trade flows for this commodity?
- Are there any signs of circular trading (applicant and beneficiary in same jurisdiction, related addresses)?
- Are insurance and BL ports consistent, or does the insurance cover a different route?

════════════════════════════════════════════════════════
REPORTING INSTRUCTIONS
════════════════════════════════════════════════════════

After completing ALL six dimension analyses above, call the record_findings tool ONCE with:
1. findings: every discrepancy you identified, each with mandatory verbatimQuotes
2. dimensionSummary: pass/fail/warning for each of the 6 dimensions

Do NOT call record_findings before completing all dimensions.
Do NOT call record_findings more than once.
A finding with empty verbatimQuotes will be discarded — always cite exact source text.`;

// ---------------------------------------------------------------------------
// Finding type constants
// ---------------------------------------------------------------------------
const FINDING_TYPES = {
  GOODS_DESCRIPTION_MISMATCH: 'GOODS_DESCRIPTION_MISMATCH',
  AMOUNT_DISCREPANCY: 'AMOUNT_DISCREPANCY',
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
  PARTY_NAME_MISMATCH: 'PARTY_NAME_MISMATCH',
  PORT_MISMATCH: 'PORT_MISMATCH',
  DATE_VIOLATION: 'DATE_VIOLATION',
  PRESENTATION_PERIOD_EXCEEDED: 'PRESENTATION_PERIOD_EXCEEDED',
  SHIPMENT_DATE_EXCEEDED: 'SHIPMENT_DATE_EXCEEDED',
  LC_EXPIRY_VIOLATION: 'LC_EXPIRY_VIOLATION',
  INSURANCE_COVERAGE_GAP: 'INSURANCE_COVERAGE_GAP',
  INSURANCE_VALUE_INSUFFICIENT: 'INSURANCE_VALUE_INSUFFICIENT',
  INSURANCE_ROUTE_MISMATCH: 'INSURANCE_ROUTE_MISMATCH',
  INCOTERMS_INCONSISTENCY: 'INCOTERMS_INCONSISTENCY',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  CLAUSED_BL: 'CLAUSED_BL',
  TRANSHIPMENT_VIOLATION: 'TRANSHIPMENT_VIOLATION',
  PARTIAL_SHIPMENT_VIOLATION: 'PARTIAL_SHIPMENT_VIOLATION',
  TRADE_PATTERN_ANOMALY: 'TRADE_PATTERN_ANOMALY',
  OVER_INVOICING_INDICATOR: 'OVER_INVOICING_INDICATOR',
  QUANTITY_WEIGHT_IMPLAUSIBILITY: 'QUANTITY_WEIGHT_IMPLAUSIBILITY',
};

class IntentAnalysisEngine {
  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.model  = 'claude-sonnet-4-6';
  }

  /**
   * Perform cross-document analysis across all 6 dimensions.
   * @param {object} lcData        - Normalised output from LCAgent
   * @param {object} invoiceData   - Normalised output from InvoiceAgent
   * @param {object} blData        - Normalised output from BLAgent
   * @param {object} insuranceData - Normalised output from InsuranceAgent
   * @param {string} presentationId - UUID for logging
   * @param {object} meta          - Presentation deadline metadata
   * @returns {Promise<object>} - { findings, dimensionSummary, rawReasoning }
   */
  async analyze(lcData, invoiceData, blData, insuranceData, presentationId, meta = {}) {
    logger.info('IntentAnalysisEngine: starting cross-document analysis', { presentationId });

    // Build the structured input payload for the model
    const inputPayload = this._buildInputPayload(lcData, invoiceData, blData, insuranceData, meta);

    const userMessage = `Perform a complete cross-document validation analysis on the following extracted trade document data. Work through all 6 dimensions step by step, then call the record_findings tool.

EXTRACTED DOCUMENT DATA:
${JSON.stringify(inputPayload, null, 2)}`;

    let modelResponse;
    let rawReasoning = '';

    if (process.env.USE_MOCK_LLM === 'true') {
      modelResponse = this._getMockAnalysis(lcData, invoiceData, blData, insuranceData);
      // In mock mode, fall through to the text-based parsing below
      const startIdx = modelResponse.indexOf('FINDINGS_JSON_START');
      rawReasoning = startIdx > -1 ? modelResponse.substring(0, startIdx).trim() : modelResponse;
      const parsed = this._extractAndParseFindings(modelResponse, presentationId);
      logger.info('IntentAnalysisEngine: analysis complete (mock)', { presentationId, findingCount: parsed.findings.length });
      return {
        findings:         parsed.findings,
        dimensionSummary: parsed.dimensionSummary,
        rawReasoning,
        analyzedAt:       new Date().toISOString(),
      };
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 16000,
      thinking: {
        type: 'enabled',
        budget_tokens: 8000,
      },
      tools: [RECORD_FINDINGS_TOOL],
      tool_choice: { type: 'any' }, // force the model to call record_findings
      system: [
        {
          type: 'text',
          text: INTENT_ANALYSIS_SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: userMessage }],
    });

    // Extract thinking blocks for audit trail
    const thinkingBlocks = response.content.filter(b => b.type === 'thinking');
    rawReasoning = thinkingBlocks.map(b => b.thinking).join('\n\n---\n\n');

    // Extract tool use result — structured and schema-validated by the API
    const toolUseBlock = response.content.find(b => b.type === 'tool_use' && b.name === 'record_findings');
    if (!toolUseBlock) {
      // Fallback: try text content parsing if tool use not triggered
      const textBlock = response.content.find(b => b.type === 'text');
      logger.warn('IntentAnalysisEngine: tool_use not found, attempting text fallback', { presentationId });
      modelResponse = textBlock?.text || '';
      const parsed = this._extractAndParseFindings(modelResponse, presentationId);
      return {
        findings:         parsed.findings,
        dimensionSummary: parsed.dimensionSummary,
        rawReasoning,
        analyzedAt:       new Date().toISOString(),
      };
    }

    // Tool use succeeded — input is already a validated JS object
    const parsed = {
      findings: toolUseBlock.input.findings || [],
      dimensionSummary: toolUseBlock.input.dimensionSummary || {},
    };

    // Log token usage
    if (response.usage) {
      logger.info('IntentAnalysisEngine: token usage', {
        presentationId,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens || 0,
        thinkingTokens: response.usage.thinking_tokens || 0,
      });
    }

    // Normalise findings (same validation as before)
    parsed.findings = parsed.findings.map((f) => ({
      findingType:       f.findingType || 'UNKNOWN',
      severity:          this._normaliseSeverity(f.severity),
      title:             f.title || 'Unnamed Finding',
      description:       f.description || '',
      affectedDocuments: Array.isArray(f.affectedDocuments) ? f.affectedDocuments : [],
      affectedFields:    Array.isArray(f.affectedFields) ? f.affectedFields : [],
      verbatimQuotes:    Array.isArray(f.verbatimQuotes) ? f.verbatimQuotes.map(q => ({ document: q.document || '', field: q.field || '', text: q.text || '' })) : [],
      reasoning:         f.reasoning || '',
      confidence:        Math.min(100, Math.max(0, parseInt(f.confidence, 10) || 50)),
      ucpArticles:       Array.isArray(f.ucpArticles) ? f.ucpArticles : [],
      recommendedAction: f.recommendedAction || '',
    }));

    logger.info('IntentAnalysisEngine: analysis complete', {
      presentationId,
      findingCount: parsed.findings.length,
    });

    return {
      findings: parsed.findings,
      dimensionSummary: parsed.dimensionSummary,
      rawReasoning,
      analyzedAt: new Date().toISOString(),
    };
  }

  /**
   * Build a clean, compact input payload for the model.
   * Flattens each document's fields for easier model consumption.
   */
  _buildInputPayload(lcData, invoiceData, blData, insuranceData, meta = {}) {
    const flattenDoc = (data) => {
      if (!data || !data.fields) return {};
      const out = {};
      for (const [key, entry] of Object.entries(data.fields)) {
        if (entry && typeof entry === 'object') {
          out[key] = {
            value:          entry.value,
            verbatimSource: entry.verbatimSource,
            confidence:     entry.confidence,
            ucpArticle:     entry.ucpArticle,
          };
          // Preserve array values
          if (Array.isArray(entry.value)) {
            out[key].value = entry.value;
          }
        }
      }
      return out;
    };

    return {
      lc:        lcData        ? { overallConfidence: lcData.overallConfidence,        fields: flattenDoc(lcData) }        : null,
      invoice:   invoiceData   ? { overallConfidence: invoiceData.overallConfidence,   fields: flattenDoc(invoiceData) }   : null,
      bl:        blData        ? { overallConfidence: blData.overallConfidence,         fields: flattenDoc(blData) }         : null,
      insurance: insuranceData ? { overallConfidence: insuranceData.overallConfidence, fields: flattenDoc(insuranceData) } : null,
      meta: {
        submissionDate:      meta.submissionDate      || null,
        presentationDeadline: meta.presentationDeadline || null,
        onBoardDate:         meta.onBoardDate         || null,
        lcExpiryDate:        meta.lcExpiryDate        || null,
        latestShipmentDate:  meta.latestShipmentDate  || null,
      },
    };
  }

  /**
   * Extract and parse the FINDINGS JSON block from model response.
   */
  _extractAndParseFindings(responseText, presentationId) {
    const startMarker = 'FINDINGS_JSON_START';
    const endMarker   = 'FINDINGS_JSON_END';

    const startIdx = responseText.indexOf(startMarker);
    const endIdx   = responseText.indexOf(endMarker);

    if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
      logger.error('IntentAnalysisEngine: could not find FINDINGS_JSON markers in response', {
        presentationId,
        responseLength: responseText.length,
        responseSnippet: responseText.slice(-500),
      });
      // Attempt to recover by searching for a JSON block directly
      const jsonMatch = responseText.match(/\{[\s\S]*"findings"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch {
          // fall through to throw
        }
      }
      throw new Error('IntentAnalysisEngine: could not locate FINDINGS_JSON block in model response');
    }

    const jsonStr = responseText
      .substring(startIdx + startMarker.length, endIdx)
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      logger.error('IntentAnalysisEngine: JSON parse failure', {
        presentationId,
        jsonStr: jsonStr.slice(0, 500),
      });
      throw new Error(`IntentAnalysisEngine: could not parse findings JSON: ${parseErr.message}`);
    }

    // Normalise and validate findings
    parsed.findings = (parsed.findings || []).map((f, idx) => ({
      findingType:       f.findingType        || 'UNKNOWN',
      severity:          this._normaliseSeverity(f.severity),
      title:             f.title              || 'Unnamed Finding',
      description:       f.description        || '',
      affectedDocuments: Array.isArray(f.affectedDocuments) ? f.affectedDocuments : [],
      affectedFields:    Array.isArray(f.affectedFields)    ? f.affectedFields    : [],
      verbatimQuotes:    Array.isArray(f.verbatimQuotes)    ? f.verbatimQuotes.map(q => ({
        document: q.document || '',
        field:    q.field    || '',
        text:     q.text     || '',
      })) : [],
      reasoning:         f.reasoning          || '',
      confidence:        Math.min(100, Math.max(0, parseInt(f.confidence, 10) || 50)),
      ucpArticles:       Array.isArray(f.ucpArticles) ? f.ucpArticles : [],
      recommendedAction: f.recommendedAction  || '',
    }));

    if (!parsed.dimensionSummary) {
      parsed.dimensionSummary = {};
    }

    return parsed;
  }

  _normaliseSeverity(raw) {
    if (!raw) return 'informational';
    const s = String(raw).toLowerCase();
    if (s === 'critical')      return 'critical';
    if (s === 'moderate')      return 'moderate';
    return 'informational';
  }

  // -------------------------------------------------------------------------
  // Mock analysis for testing without Anthropic API
  // -------------------------------------------------------------------------
  _getMockAnalysis(lcData, invoiceData, blData, insuranceData) {
    const lcFields  = lcData?.fields        || {};
    const invFields = invoiceData?.fields   || {};
    const blFields  = blData?.fields        || {};
    const insFields = insuranceData?.fields || {};

    const findings = [];

    // Mock finding 1: Check if invoice seller matches LC beneficiary
    const lcBeneficiary    = lcFields.beneficiary?.value  || 'NOT_FOUND';
    const invoiceSeller    = invFields.seller?.value      || 'NOT_FOUND';
    if (
      lcBeneficiary !== 'NOT_FOUND' &&
      invoiceSeller !== 'NOT_FOUND' &&
      lcBeneficiary.toUpperCase() !== invoiceSeller.toUpperCase()
    ) {
      findings.push({
        findingType: 'PARTY_NAME_MISMATCH',
        severity: 'critical',
        title: 'Invoice Seller Does Not Match LC Beneficiary',
        description: `The invoice is issued by "${invoiceSeller}" but the LC names "${lcBeneficiary}" as the beneficiary. UCP 600 Art. 18(a)(i) requires the commercial invoice to appear to have been issued by the beneficiary.`,
        affectedDocuments: ['lc', 'invoice'],
        affectedFields: ['beneficiary', 'seller'],
        verbatimQuotes: [
          { document: 'lc',      field: 'beneficiary', text: lcFields.beneficiary?.verbatimSource  || lcBeneficiary },
          { document: 'invoice', field: 'seller',       text: invFields.seller?.verbatimSource      || invoiceSeller },
        ],
        reasoning: 'Direct name comparison shows the invoice issuer and LC beneficiary are different entities.',
        confidence: 95,
        ucpArticles: ['Art. 18(a)(i)'],
        recommendedAction: 'Obtain corrected invoice issued by the LC beneficiary, or obtain waiver from the applicant and issuing bank.',
      });
    }

    // Mock finding 2: Check port alignment
    const lcPortLoading  = lcFields.portOfLoading?.value  || 'NOT_FOUND';
    const blPortLoading  = blFields.portOfLoading?.value  || 'NOT_FOUND';
    if (
      lcPortLoading !== 'NOT_FOUND' &&
      blPortLoading !== 'NOT_FOUND' &&
      lcPortLoading.toUpperCase() !== blPortLoading.toUpperCase()
    ) {
      findings.push({
        findingType: 'PORT_MISMATCH',
        severity: 'critical',
        title: 'Bill of Lading Port of Loading Does Not Match LC',
        description: `The BL shows port of loading as "${blPortLoading}" but the LC requires "${lcPortLoading}". UCP 600 Art. 20(a)(iv) requires the BL to indicate shipment from the port of loading stated in the credit.`,
        affectedDocuments: ['lc', 'bl'],
        affectedFields: ['portOfLoading'],
        verbatimQuotes: [
          { document: 'lc', field: 'portOfLoading', text: lcFields.portOfLoading?.verbatimSource || lcPortLoading },
          { document: 'bl', field: 'portOfLoading', text: blFields.portOfLoading?.verbatimSource || blPortLoading },
        ],
        reasoning: 'The port of loading in the BL does not match the port stipulated in the LC.',
        confidence: 90,
        ucpArticles: ['Art. 20(a)(iv)'],
        recommendedAction: 'Verify whether the actual loading port is the correct one and obtain a corrected BL if required. If an amendment to the LC is needed, process it immediately.',
      });
    }

    // Mock finding 3: insurance coverage
    if (insFields.coveragePercentage?.value === 'NOT_FOUND') {
      findings.push({
        findingType: 'INSURANCE_VALUE_INSUFFICIENT',
        severity: 'moderate',
        title: 'Insurance Coverage Percentage Not Determinable',
        description: 'The insurance document does not explicitly state the coverage percentage. UCP 600 Art. 28(f) requires insurance to cover at least 110% of the CIF or CIP value. Manual verification required.',
        affectedDocuments: ['insurance'],
        affectedFields: ['coveragePercentage', 'insuredValue'],
        verbatimQuotes: [
          { document: 'insurance', field: 'insuredValue', text: insFields.insuredValue?.verbatimSource || 'Not found' },
        ],
        reasoning: 'Coverage percentage field returned NOT_FOUND. Cannot confirm 110% minimum coverage compliance.',
        confidence: 65,
        ucpArticles: ['Art. 28(f)'],
        recommendedAction: 'Request confirmation from insurer that coverage equals 110% of invoice value, or calculate manually using insured value and invoice total.',
      });
    }

    return `DIMENSION 1 ANALYSIS: Mock analysis - checking commercial coherence.
DIMENSION 2 ANALYSIS: Checking party resolution. ${lcBeneficiary !== invoiceSeller ? 'Party mismatch detected.' : 'Parties appear consistent.'}
DIMENSION 3 ANALYSIS: Checking logistics. ${lcPortLoading !== blPortLoading ? 'Port mismatch detected.' : 'Ports appear consistent.'}
DIMENSION 4 ANALYSIS: Checking insurance coverage alignment.
DIMENSION 5 ANALYSIS: Checking temporal coherence.
DIMENSION 6 ANALYSIS: Checking for trade pattern anomalies.

FINDINGS_JSON_START
${JSON.stringify({
  findings,
  dimensionSummary: {
    commercialCoherence:  { status: 'pass', findingCount: 0 },
    partyResolution:      { status: findings.some(f => f.findingType === 'PARTY_NAME_MISMATCH') ? 'fail' : 'pass', findingCount: findings.filter(f => f.findingType === 'PARTY_NAME_MISMATCH').length },
    logisticsFeasibility: { status: findings.some(f => f.findingType === 'PORT_MISMATCH') ? 'fail' : 'pass', findingCount: findings.filter(f => f.findingType === 'PORT_MISMATCH').length },
    coverageAlignment:    { status: 'warning', findingCount: findings.filter(f => f.findingType === 'INSURANCE_VALUE_INSUFFICIENT').length },
    temporalCoherence:    { status: 'pass', findingCount: 0 },
    tradePatternAnomaly:  { status: 'pass', findingCount: 0 },
  },
}, null, 2)}
FINDINGS_JSON_END`;
  }
}

module.exports = { IntentAnalysisEngine, FINDING_TYPES };
