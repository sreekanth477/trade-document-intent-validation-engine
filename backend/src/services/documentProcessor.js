'use strict';

const fs   = require('fs');
const path = require('path');
const pdf  = require('pdf-parse');

const logger = require('../utils/logger');
const { query, withTransaction } = require('../db/connection');
const { AuditService, EVENT_TYPES } = require('./auditService');
const RiskClassifier = require('./riskClassifier');

const LCAgent        = require('../agents/lcAgent');
const InvoiceAgent   = require('../agents/invoiceAgent');
const BLAgent        = require('../agents/blAgent');
const InsuranceAgent = require('../agents/insuranceAgent');
const { IntentAnalysisEngine } = require('../agents/intentAnalysisEngine');

// ---------------------------------------------------------------------------
// Document Processor
// Orchestrates the full pipeline for a trade document presentation:
// 1. Extract text from PDF
// 2. Route to appropriate extraction agent
// 3. When all docs are ready, run Intent Analysis Engine
// 4. Run Risk Classifier
// 5. Persist findings to DB
// 6. Update presentation status
// ---------------------------------------------------------------------------

class DocumentProcessor {
  constructor() {
    this.lcAgent        = new LCAgent();
    this.invoiceAgent   = new InvoiceAgent();
    this.blAgent        = new BLAgent();
    this.insuranceAgent = new InsuranceAgent();
    this.intentEngine   = new IntentAnalysisEngine();
    this.riskClassifier = new RiskClassifier();
  }

  // -------------------------------------------------------------------------
  // Step 1 + 2: Extract text from PDF and route to agent
  // -------------------------------------------------------------------------

  /**
   * Extract a single document: read PDF, extract text, run the right agent.
   * @param {string} documentId
   * @param {string} documentType
   * @param {string} filePath
   * @param {object|null} job - Bull job (for progress reporting), optional
   * @returns {Promise<object>} - Agent extraction result
   */
  async extractDocument(documentId, documentType, filePath, job = null) {
    logger.info('DocumentProcessor: extracting document', { documentId, documentType, filePath });

    // Get presentation ID for audit logging
    const docRecord = await query(
      `SELECT presentation_id, original_name FROM documents WHERE id = $1`,
      [documentId]
    );
    const presentationId = docRecord.rows[0]?.presentation_id;
    const originalName   = docRecord.rows[0]?.original_name;

    await AuditService.logEvent(presentationId, EVENT_TYPES.EXTRACTION_STARTED, {
      documentId, documentType, fileName: originalName,
    });

    if (job) job.progress(10);

    // Extract text from PDF
    const documentText = await this._extractTextFromPDF(filePath);
    if (job) job.progress(25);

    // Route to appropriate extraction agent
    let extractedData;
    switch (documentType) {
      case 'lc':
        extractedData = await this.lcAgent.extract(documentText, documentId);
        break;
      case 'invoice':
        extractedData = await this.invoiceAgent.extract(documentText, documentId);
        break;
      case 'bl':
        extractedData = await this.blAgent.extract(documentText, documentId);
        break;
      case 'insurance':
        extractedData = await this.insuranceAgent.extract(documentText, documentId);
        break;
      default:
        // For 'other' document types, store the raw text only
        extractedData = {
          documentType: 'other',
          documentId,
          extractedAt: new Date().toISOString(),
          overallConfidence: 0.5,
          rawText: documentText.substring(0, 5000), // store first 5000 chars
          fields: {},
        };
    }

    if (job) job.progress(85);
    return extractedData;
  }

  // -------------------------------------------------------------------------
  // Step 3-6: Cross-document analysis pipeline
  // -------------------------------------------------------------------------

  /**
   * Run the full intent analysis pipeline for a presentation.
   * Loads all extracted documents from DB, runs Intent Engine + Risk Classifier.
   * @param {string} presentationId
   * @param {object|null} job - Bull job for progress
   * @returns {Promise<object>} - { findingCount, overallScore, stpCandidate }
   */
  async runIntentAnalysis(presentationId, job = null) {
    logger.info('DocumentProcessor: running intent analysis', { presentationId });

    if (job) job.progress(10);

    // Load all extracted documents
    const docsResult = await query(
      `SELECT id, document_type, extracted_data, extraction_status
       FROM documents
       WHERE presentation_id = $1 AND extraction_status = 'completed'`,
      [presentationId]
    );

    const docs = docsResult.rows;
    if (docs.length === 0) {
      throw new Error(`No completed documents found for presentation ${presentationId}`);
    }

    // Map documents by type (use first found of each type)
    const docMap = {};
    for (const doc of docs) {
      if (!docMap[doc.document_type]) {
        docMap[doc.document_type] = doc.extracted_data;
      }
    }

    const lcData        = docMap['lc']        || null;
    const invoiceData   = docMap['invoice']   || null;
    const blData        = docMap['bl']        || null;
    const insuranceData = docMap['insurance'] || null;

    if (job) job.progress(20);

    // Run Intent Analysis Engine
    const analysisResult = await this.intentEngine.analyze(
      lcData, invoiceData, blData, insuranceData, presentationId
    );
    if (job) job.progress(60);

    // Run Risk Classifier
    const classifiedFindings = this.riskClassifier.classify(analysisResult.findings || []);
    const overallRisk = this.riskClassifier.computeOverallRisk(classifiedFindings);
    if (job) job.progress(75);

    // Persist findings and update presentation
    await withTransaction(async (client) => {
      // Insert each finding
      for (const finding of classifiedFindings) {
        const insertResult = await client.query(
          `INSERT INTO findings
             (presentation_id, finding_type, severity, title, description,
              affected_documents, affected_fields, verbatim_quotes, reasoning,
              confidence_score, ucp_articles, recommended_action, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'open')
           RETURNING id`,
          [
            presentationId,
            finding.findingType,
            finding.finalSeverity || finding.severity,
            finding.title,
            finding.description,
            finding.affectedDocuments || [],
            finding.affectedFields    || [],
            JSON.stringify(finding.verbatimQuotes || []),
            finding.reasoning || null,
            finding.finalConfidence || finding.confidence || 50,
            finding.ucpArticles || [],
            finding.recommendedAction || null,
          ]
        );

        const findingId = insertResult.rows[0].id;

        // Log each finding creation in audit trail
        await AuditService.logEvent(presentationId, EVENT_TYPES.FINDING_CREATED, {
          findingId,
          findingType: finding.findingType,
          severity:    finding.finalSeverity || finding.severity,
          title:       finding.title,
        });
      }

      // Update presentation with overall risk
      await client.query(
        `UPDATE lc_presentations
         SET status = 'completed',
             overall_risk_score = $1,
             stp_candidate = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [overallRisk.overallScore, overallRisk.stpCandidate, presentationId]
      );
    });

    if (job) job.progress(95);

    logger.info('DocumentProcessor: analysis pipeline complete', {
      presentationId,
      findingCount:  classifiedFindings.length,
      overallScore:  overallRisk.overallScore,
      stpCandidate:  overallRisk.stpCandidate,
    });

    return {
      findingCount:    classifiedFindings.length,
      overallScore:    overallRisk.overallScore,
      stpCandidate:    overallRisk.stpCandidate,
      riskBand:        overallRisk.riskBand,
      dimensionSummary: analysisResult.dimensionSummary,
    };
  }

  // -------------------------------------------------------------------------
  // Document type classifier
  // Heuristic-based classifier for when document type is not user-specified
  // -------------------------------------------------------------------------

  /**
   * Classify a document as lc/invoice/bl/insurance/other based on text content.
   * @param {string} text - Extracted document text (first 3000 chars is enough)
   * @returns {string} document type
   */
  classifyDocumentType(text) {
    const sample = text.substring(0, 3000).toLowerCase();

    // Letter of Credit indicators
    const lcScore = this._countMatches(sample, [
      'letter of credit', 'documentary credit', 'irrevocable credit',
      'ucp 600', 'issuing bank', 'beneficiary', 'expiry date', 'available by',
    ]);

    // Invoice indicators
    const invoiceScore = this._countMatches(sample, [
      'commercial invoice', 'invoice no', 'invoice number', 'seller', 'buyer',
      'unit price', 'total amount', 'hs code', 'country of origin',
    ]);

    // Bill of Lading indicators
    const blScore = this._countMatches(sample, [
      'bill of lading', 'b/l no', 'b/l number', 'shipper', 'consignee',
      'notify party', 'port of loading', 'port of discharge', 'vessel', 'voyage',
      'shipped on board', 'freight', 'carrier',
    ]);

    // Insurance indicators
    const insuranceScore = this._countMatches(sample, [
      'insurance', 'policy', 'certificate of insurance', 'insured', 'insurer',
      'premium', 'coverage', 'perils', 'claims payable', 'underwriter',
      'institute cargo clauses',
    ]);

    const scores = { lc: lcScore, invoice: invoiceScore, bl: blScore, insurance: insuranceScore };
    const maxScore = Math.max(...Object.values(scores));

    if (maxScore === 0) return 'other';

    return Object.keys(scores).find(k => scores[k] === maxScore) || 'other';
  }

  _countMatches(text, terms) {
    return terms.filter(term => text.includes(term)).length;
  }

  // -------------------------------------------------------------------------
  // PDF text extraction
  // -------------------------------------------------------------------------

  /**
   * Extract raw text from a PDF file using pdf-parse.
   * @param {string} filePath - Absolute path to PDF
   * @returns {Promise<string>} - Extracted text
   */
  async _extractTextFromPDF(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`PDF file not found: ${filePath}`);
    }

    const ext = path.extname(filePath).toLowerCase();

    // If it's not a PDF (e.g., a plain text test file), read directly
    if (ext !== '.pdf') {
      logger.warn('DocumentProcessor: non-PDF file, reading as text', { filePath, ext });
      return fs.readFileSync(filePath, 'utf8');
    }

    const dataBuffer = fs.readFileSync(filePath);

    try {
      const data = await pdf(dataBuffer, {
        // Options for pdf-parse
        max: 0, // no page limit
      });

      if (!data.text || data.text.trim().length < 20) {
        throw new Error('PDF appears to contain no extractable text (may be image-based). OCR required.');
      }

      logger.info('DocumentProcessor: PDF text extracted', {
        filePath,
        pageCount: data.numpages,
        textLength: data.text.length,
      });

      return data.text;
    } catch (err) {
      if (err.message.includes('no extractable text')) throw err;
      logger.error('DocumentProcessor: pdf-parse error', { filePath, error: err.message });
      throw new Error(`Failed to extract text from PDF: ${err.message}`);
    }
  }

  /**
   * Get page count for a PDF (for storing in documents table).
   * @param {string} filePath
   * @returns {Promise<number|null>}
   */
  async getPDFPageCount(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      if (path.extname(filePath).toLowerCase() !== '.pdf') return null;
      const data = await pdf(fs.readFileSync(filePath));
      return data.numpages || null;
    } catch {
      return null;
    }
  }
}

module.exports = { DocumentProcessor };
