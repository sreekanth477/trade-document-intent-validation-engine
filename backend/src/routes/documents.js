'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');

const { authenticate }         = require('../middleware/auth');
const { asyncHandler, createError } = require('../middleware/errorHandler');
const { query }                = require('../db/connection');
const { enqueueDocumentExtraction } = require('../services/queueService');
const { AuditService, EVENT_TYPES } = require('../services/auditService');
const { DocumentProcessor }    = require('../services/documentProcessor');
const logger                   = require('../utils/logger');

const router = express.Router();

// ---------------------------------------------------------------------------
// Multer configuration
// ---------------------------------------------------------------------------

const UPLOAD_DIR      = process.env.UPLOAD_DIR      || path.join(process.cwd(), 'uploads');
const MAX_FILE_SIZE   = parseInt(process.env.MAX_FILE_SIZE, 10)   || 52428800; // 50 MB
const MAX_FILES       = parseInt(process.env.MAX_FILES_PER_REQUEST, 10) || 20;
const ALLOWED_MIMES   = ['application/pdf', 'image/tiff', 'image/png', 'image/jpeg'];
const ALLOWED_EXTENSIONS = ['.pdf', '.tif', '.tiff', '.png', '.jpg', '.jpeg'];

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organise uploads by date for easier management
    const dateDir = path.join(UPLOAD_DIR, new Date().toISOString().slice(0, 10));
    fs.mkdirSync(dateDir, { recursive: true });
    cb(null, dateDir);
  },
  filename: (req, file, cb) => {
    // UUID-based filename to prevent collisions and path traversal
    const ext      = path.extname(file.originalname).toLowerCase();
    const safeName = `${uuidv4()}${ext}`;
    cb(null, safeName);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIMES.includes(file.mimetype) || ALLOWED_EXTENSIONS.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed: ${file.mimetype}. Allowed: PDF, TIFF, PNG, JPEG`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
});

// ---------------------------------------------------------------------------
// POST /api/documents/upload
// ---------------------------------------------------------------------------
router.post(
  '/upload',
  authenticate,
  upload.array('documents', MAX_FILES),
  asyncHandler(async (req, res) => {
    const { presentationId, lcNumber, clientName, applicant, beneficiary } = req.body;
    const files = req.files;

    if (!files || files.length === 0) {
      throw createError('No files uploaded. Please attach at least one document.', 400);
    }

    const userId   = req.user.id;
    const userName = req.user.fullName || req.user.email;

    // Resolve or create the LC presentation
    let presId = presentationId;

    if (!presId) {
      // Create a new presentation record
      const presResult = await query(
        `INSERT INTO lc_presentations
           (lc_number, client_name, applicant, beneficiary, status, submitted_by)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         RETURNING id`,
        [lcNumber || null, clientName || null, applicant || null, beneficiary || null, userId]
      );
      presId = presResult.rows[0].id;

      await AuditService.logEvent(presId, EVENT_TYPES.SUBMISSION_RECEIVED, {
        lcNumber, clientName, applicant, beneficiary, fileCount: files.length,
      }, userId, userName, req.ip);
    }

    // Use DocumentProcessor for classification
    const processor = new DocumentProcessor();

    const uploadedDocs = [];

    for (const file of files) {
      // Determine document type: from body param, or auto-classify
      let documentType = 'other';

      if (req.body[`type_${file.fieldname}`]) {
        documentType = req.body[`type_${file.fieldname}`];
      } else if (req.body.documentTypes) {
        // Accept JSON array of types in the same order as files
        try {
          const types = JSON.parse(req.body.documentTypes);
          const idx   = files.indexOf(file);
          if (types[idx]) documentType = types[idx];
        } catch { /* ignore parse errors */ }
      }

      // Validate document type
      const VALID_TYPES = ['lc', 'invoice', 'bl', 'insurance', 'other'];
      if (!VALID_TYPES.includes(documentType)) documentType = 'other';

      // Insert document record
      const docResult = await query(
        `INSERT INTO documents
           (presentation_id, document_type, filename, original_name, file_path,
            file_size_bytes, mime_type, extraction_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
         RETURNING id`,
        [
          presId,
          documentType,
          file.filename,
          file.originalname,
          file.path,
          file.size,
          file.mimetype,
        ]
      );

      const documentId = docResult.rows[0].id;

      await AuditService.logEvent(presId, EVENT_TYPES.DOCUMENT_UPLOADED, {
        documentId, documentType, fileName: file.originalname, fileSize: file.size,
      }, userId, userName, req.ip);

      // Enqueue extraction job
      await enqueueDocumentExtraction(documentId, presId, documentType, file.path);

      uploadedDocs.push({
        documentId,
        documentType,
        originalName: file.originalname,
        fileSize:     file.size,
        status:       'pending',
      });
    }

    logger.info('Documents uploaded and queued', {
      presentationId: presId,
      fileCount: files.length,
      userId,
    });

    res.status(202).json({
      success:        true,
      message:        `${files.length} document(s) uploaded and queued for extraction.`,
      presentationId: presId,
      documents:      uploadedDocs,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/documents/:presentationId
// ---------------------------------------------------------------------------
router.get(
  '/:presentationId',
  authenticate,
  asyncHandler(async (req, res) => {
    const { presentationId } = req.params;

    const result = await query(
      `SELECT
         d.id, d.document_type, d.filename, d.original_name,
         d.file_size_bytes, d.mime_type, d.ocr_confidence,
         d.extraction_status, d.extraction_error, d.page_count, d.created_at,
         CASE WHEN d.extraction_status = 'completed'
              THEN d.extracted_data
              ELSE NULL
         END AS extracted_data
       FROM documents d
       WHERE d.presentation_id = $1
       ORDER BY d.created_at ASC`,
      [presentationId]
    );

    if (result.rows.length === 0) {
      // Check if presentation exists at all
      const presResult = await query(
        `SELECT id FROM lc_presentations WHERE id = $1`,
        [presentationId]
      );
      if (presResult.rows.length === 0) {
        throw createError(`Presentation ${presentationId} not found.`, 404);
      }
    }

    res.json({
      success:        true,
      presentationId,
      count:          result.rows.length,
      documents:      result.rows,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/documents/:documentId/status
// ---------------------------------------------------------------------------
router.get(
  '/:documentId/status',
  authenticate,
  asyncHandler(async (req, res) => {
    const { documentId } = req.params;

    const result = await query(
      `SELECT
         d.id, d.document_type, d.original_name, d.extraction_status,
         d.extraction_error, d.ocr_confidence, d.page_count, d.created_at,
         d.presentation_id
       FROM documents d
       WHERE d.id = $1`,
      [documentId]
    );

    if (result.rows.length === 0) {
      throw createError(`Document ${documentId} not found.`, 404);
    }

    const doc = result.rows[0];

    // Get queue job status
    let queueStatus = null;
    try {
      const { getExtractionJobStatus } = require('../services/queueService');
      queueStatus = await getExtractionJobStatus(documentId);
    } catch { /* queue might not be initialised yet */ }

    res.json({
      success:     true,
      document:    doc,
      queueStatus,
    });
  })
);

// ---------------------------------------------------------------------------
// DELETE /api/documents/:documentId  (admin only)
// ---------------------------------------------------------------------------
router.delete(
  '/:documentId',
  authenticate,
  asyncHandler(async (req, res) => {
    // Only admins may delete documents
    if (!['admin'].includes(req.user.role)) {
      throw createError('Only administrators may delete documents.', 403);
    }

    const { documentId } = req.params;

    const docResult = await query(
      `SELECT file_path, presentation_id FROM documents WHERE id = $1`,
      [documentId]
    );

    if (docResult.rows.length === 0) {
      throw createError(`Document ${documentId} not found.`, 404);
    }

    const { file_path, presentation_id } = docResult.rows[0];

    // Remove the physical file
    if (fs.existsSync(file_path)) {
      fs.unlinkSync(file_path);
    }

    await query(`DELETE FROM documents WHERE id = $1`, [documentId]);

    await AuditService.logEvent(presentation_id, 'DOCUMENT_DELETED', {
      documentId, filePath: file_path,
    }, req.user.id, req.user.fullName || req.user.email, req.ip);

    res.json({ success: true, message: 'Document deleted.' });
  })
);

module.exports = router;
