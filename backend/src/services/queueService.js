'use strict';

const Bull   = require('bull');
const logger = require('../utils/logger');
const { query } = require('../db/connection');

// ---------------------------------------------------------------------------
// Queue Service
// Two Bull queues backed by Redis:
//  1. document-extraction  - processes individual documents through their agent
//  2. intent-analysis      - runs Intent Analysis Engine when all docs are ready
// ---------------------------------------------------------------------------

let documentExtractionQueue = null;
let intentAnalysisQueue     = null;

// -----------------------------------------------------------------------
// Queue factory (lazy-initialised so Redis isn't required at module load)
// -----------------------------------------------------------------------

function createQueue(name) {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  return new Bull(name, redisUrl, {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
    settings: {
      lockDuration: 60000,   // 60 s - enough for LLM calls
      stalledInterval: 30000,
      maxStalledCount: 1,
    },
  });
}

function getDocumentExtractionQueue() {
  if (!documentExtractionQueue) {
    documentExtractionQueue = createQueue('document-extraction');
    _attachDocumentExtractionHandlers(documentExtractionQueue);
  }
  return documentExtractionQueue;
}

function getIntentAnalysisQueue() {
  if (!intentAnalysisQueue) {
    intentAnalysisQueue = createQueue('intent-analysis');
    _attachIntentAnalysisHandlers(intentAnalysisQueue);
  }
  return intentAnalysisQueue;
}

// -----------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------

/**
 * Enqueue a document extraction job.
 * @param {string} documentId      - UUID of the document record
 * @param {string} presentationId  - UUID of the parent presentation
 * @param {string} documentType    - 'lc' | 'invoice' | 'bl' | 'insurance' | 'other'
 * @param {string} filePath        - Absolute path to the uploaded file
 * @param {number} [priority=0]    - Higher number = higher priority
 * @returns {Promise<Bull.Job>}
 */
async function enqueueDocumentExtraction(documentId, presentationId, documentType, filePath, priority = 0) {
  const queue = getDocumentExtractionQueue();
  const job = await queue.add(
    { documentId, presentationId, documentType, filePath },
    { priority, jobId: `extract-${documentId}` }
  );
  logger.info('QueueService: document extraction enqueued', { jobId: job.id, documentId, documentType });
  return job;
}

/**
 * Enqueue an intent analysis job (triggered after all documents extracted).
 * @param {string} presentationId
 * @returns {Promise<Bull.Job>}
 */
async function enqueueIntentAnalysis(presentationId) {
  const queue = getIntentAnalysisQueue();
  const job = await queue.add(
    { presentationId },
    { jobId: `analysis-${presentationId}` }
  );
  logger.info('QueueService: intent analysis enqueued', { jobId: job.id, presentationId });
  return job;
}

/**
 * Get the current status of a document extraction job.
 * @param {string} documentId
 * @returns {Promise<object|null>}
 */
async function getExtractionJobStatus(documentId) {
  const queue = getDocumentExtractionQueue();
  const job   = await queue.getJob(`extract-${documentId}`);
  if (!job) return null;
  const state = await job.getState();
  return { jobId: job.id, state, progress: job.progress(), data: job.data, failedReason: job.failedReason };
}

/**
 * Get queue health metrics for the health-check endpoint.
 * @returns {Promise<object>}
 */
async function getQueueHealth() {
  const eq = getDocumentExtractionQueue();
  const aq = getIntentAnalysisQueue();

  const [eqCounts, aqCounts] = await Promise.all([
    eq.getJobCounts(),
    aq.getJobCounts(),
  ]);

  return {
    documentExtraction: eqCounts,
    intentAnalysis:     aqCounts,
  };
}

/**
 * Gracefully shut down both queues.
 */
async function shutdown() {
  const promises = [];
  if (documentExtractionQueue) promises.push(documentExtractionQueue.close());
  if (intentAnalysisQueue)     promises.push(intentAnalysisQueue.close());
  await Promise.all(promises);
  logger.info('QueueService: all queues closed');
}

// -----------------------------------------------------------------------
// Job Handlers
// -----------------------------------------------------------------------

function _attachDocumentExtractionHandlers(queue) {
  queue.process(async (job) => {
    const { documentId, presentationId, documentType, filePath } = job.data;
    logger.info('QueueService: processing document extraction', { jobId: job.id, documentId, documentType });

    // Update DB: extraction_status -> 'processing'
    await query(
      `UPDATE documents SET extraction_status = 'processing' WHERE id = $1`,
      [documentId]
    );
    job.progress(5);

    let extractedData;
    try {
      // Dynamically require DocumentProcessor to avoid circular deps at module load
      const { DocumentProcessor } = require('./documentProcessor');
      const processor = new DocumentProcessor();
      extractedData = await processor.extractDocument(documentId, documentType, filePath, job);
    } catch (err) {
      logger.error('QueueService: extraction failed', { documentId, error: err.message });

      await query(
        `UPDATE documents SET extraction_status = 'failed', extraction_error = $1 WHERE id = $2`,
        [err.message, documentId]
      );

      const { AuditService, EVENT_TYPES } = require('./auditService');
      await AuditService.logEvent(presentationId, EVENT_TYPES.EXTRACTION_FAILED, {
        documentId, documentType, error: err.message,
      });

      throw err; // Causes Bull to retry
    }

    // Update DB: extraction_status -> 'completed'
    await query(
      `UPDATE documents
       SET extraction_status = 'completed',
           extracted_data = $1,
           ocr_confidence = $2
       WHERE id = $3`,
      [
        JSON.stringify(extractedData),
        extractedData.overallConfidence || null,
        documentId,
      ]
    );
    job.progress(95);

    const { AuditService, EVENT_TYPES } = require('./auditService');
    await AuditService.logEvent(presentationId, EVENT_TYPES.EXTRACTION_COMPLETED, {
      documentId, documentType, confidence: extractedData.overallConfidence,
    });

    // Check if all documents in this presentation are now extracted
    await _checkAndTriggerAnalysis(presentationId);

    job.progress(100);
    return { documentId, success: true };
  });

  queue.on('failed', (job, err) => {
    logger.error('QueueService: extraction job permanently failed', {
      jobId:      job.id,
      documentId: job.data.documentId,
      error:      err.message,
    });
  });

  queue.on('stalled', (job) => {
    logger.warn('QueueService: extraction job stalled', { jobId: job.id });
  });
}

function _attachIntentAnalysisHandlers(queue) {
  queue.process(async (job) => {
    const { presentationId } = job.data;
    logger.info('QueueService: processing intent analysis', { jobId: job.id, presentationId });

    // Update presentation status -> 'processing'
    await query(
      `UPDATE lc_presentations SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [presentationId]
    );

    const { AuditService, EVENT_TYPES } = require('./auditService');
    await AuditService.logEvent(presentationId, EVENT_TYPES.ANALYSIS_STARTED, { presentationId });
    job.progress(5);

    let analysisResult;
    try {
      const { DocumentProcessor } = require('./documentProcessor');
      const processor = new DocumentProcessor();
      analysisResult = await processor.runIntentAnalysis(presentationId, job);
    } catch (err) {
      logger.error('QueueService: intent analysis failed', { presentationId, error: err.message });

      await query(
        `UPDATE lc_presentations SET status = 'failed', updated_at = NOW() WHERE id = $1`,
        [presentationId]
      );

      await AuditService.logEvent(presentationId, EVENT_TYPES.ANALYSIS_FAILED, {
        presentationId, error: err.message,
      });

      throw err;
    }

    await AuditService.logEvent(presentationId, EVENT_TYPES.ANALYSIS_COMPLETED, {
      findingCount:  analysisResult.findingCount,
      overallScore:  analysisResult.overallScore,
      stpCandidate:  analysisResult.stpCandidate,
    });

    job.progress(100);
    return { presentationId, success: true };
  });

  queue.on('failed', (job, err) => {
    logger.error('QueueService: analysis job permanently failed', {
      jobId:          job.id,
      presentationId: job.data.presentationId,
      error:          err.message,
    });
  });

  queue.on('stalled', (job) => {
    logger.warn('QueueService: analysis job stalled', { jobId: job.id });
  });
}

async function _checkAndTriggerAnalysis(presentationId) {
  // Use pg advisory lock to prevent race condition when multiple extraction
  // jobs complete simultaneously and both try to trigger analysis
  const { getClient } = require('../db/connection');
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // hashtext() produces a stable integer from the UUID string
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [presentationId]);

    const countResult = await client.query(
      `SELECT
         COUNT(*) FILTER (WHERE extraction_status NOT IN ('completed', 'failed')) AS pending_count,
         COUNT(*) FILTER (WHERE document_type IN ('lc', 'invoice', 'bl', 'insurance') AND extraction_status = 'completed') AS required_completed_count,
         COUNT(*) FILTER (WHERE document_type IN ('lc', 'invoice', 'bl', 'insurance')) AS required_count
       FROM documents
       WHERE presentation_id = $1`,
      [presentationId]
    );

    const { pending_count, required_completed_count } = countResult.rows[0];

    logger.info('QueueService: checking analysis trigger', {
      presentationId,
      pendingCount: parseInt(pending_count, 10),
      requiredCompleted: parseInt(required_completed_count, 10),
    });

    if (parseInt(pending_count, 10) === 0 && parseInt(required_completed_count, 10) >= 2) {
      // Check if analysis job already queued/running to prevent duplicates
      const queue = getIntentAnalysisQueue();
      const existingJob = await queue.getJob(`analysis-${presentationId}`);
      if (!existingJob) {
        logger.info('QueueService: triggering intent analysis', { presentationId });
        await enqueueIntentAnalysis(presentationId);
      } else {
        logger.info('QueueService: analysis already queued, skipping', { presentationId });
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('QueueService: error in _checkAndTriggerAnalysis', { presentationId, error: err.message });
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  getDocumentExtractionQueue,
  getIntentAnalysisQueue,
  enqueueDocumentExtraction,
  enqueueIntentAnalysis,
  getExtractionJobStatus,
  getQueueHealth,
  shutdown,
};
