import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDropzone, FileRejection } from 'react-dropzone';
import {
  Upload,
  X,
  FileText,
  CheckCircle2,
  AlertCircle,
  CloudUpload,
  ChevronDown,
} from 'lucide-react';
import { uploadDocuments } from '../api/client';
import type { DocumentType } from '../types';

interface UploadFile {
  file: File;
  id: string;
  detectedType: DocumentType;
  error?: string;
}

const DOCUMENT_TYPE_OPTIONS: { value: DocumentType; label: string }[] = [
  { value: 'lc', label: 'Letter of Credit' },
  { value: 'invoice', label: 'Commercial Invoice' },
  { value: 'bl', label: 'Bill of Lading' },
  { value: 'insurance', label: 'Insurance Certificate' },
  { value: 'other', label: 'Other Document' },
];

const ACCEPTED_TYPES = {
  'application/pdf': ['.pdf'],
  'image/tiff': ['.tif', '.tiff'],
  'image/jpeg': ['.jpg', '.jpeg'],
};

function detectDocumentType(filename: string): DocumentType {
  const name = filename.toLowerCase();
  if (name.includes('lc') || name.includes('letter') || name.includes('credit')) return 'lc';
  if (name.includes('invoice') || name.includes('inv')) return 'invoice';
  if (
    name.includes('bl') ||
    name.includes('bill') ||
    name.includes('lading') ||
    name.includes('bod')
  )
    return 'bl';
  if (name.includes('insur') || name.includes('cert')) return 'insurance';
  return 'other';
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let uidCounter = 0;
function uid() {
  return `upload-${++uidCounter}-${Date.now()}`;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [rejections, setRejections] = useState<string[]>([]);

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      setRejections(
        rejected.map(
          (r) =>
            `${r.file.name}: ${r.errors.map((e) => e.message).join(', ')}`,
        ),
      );

      const remaining = 20 - files.length;
      const toAdd = accepted.slice(0, remaining).map((file) => ({
        file,
        id: uid(),
        detectedType: detectDocumentType(file.name),
      }));
      setFiles((prev) => [...prev, ...toAdd]);
    },
    [files.length],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: ACCEPTED_TYPES,
    maxFiles: 20,
    maxSize: 50 * 1024 * 1024, // 50 MB per file
    disabled: isUploading,
  });

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function updateType(id: string, type: DocumentType) {
    setFiles((prev) =>
      prev.map((f) => (f.id === id ? { ...f, detectedType: type } : f)),
    );
  }

  async function handleUpload() {
    if (files.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    setUploadProgress(0);

    try {
      const result = await uploadDocuments(
        files.map((f) => f.file),
        (pct) => setUploadProgress(pct),
      );
      navigate(`/review/${result.presentationId}`, { replace: true });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setUploadError(msg);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Page header */}
      <div className="mb-6 flex items-center gap-3">
        <Upload className="h-6 w-6 text-blue-700" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Upload LC Presentation</h1>
          <p className="text-sm text-gray-500">
            Upload up to 20 trade documents (PDF, TIFF, JPEG) for automated examination.
          </p>
        </div>
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-10 text-center transition-colors ${
          isDragActive
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 bg-white hover:border-blue-400 hover:bg-gray-50'
        } ${isUploading ? 'pointer-events-none opacity-50' : ''}`}
      >
        <input {...getInputProps()} />
        <CloudUpload
          className={`mx-auto mb-3 h-12 w-12 ${isDragActive ? 'text-blue-500' : 'text-gray-300'}`}
        />
        {isDragActive ? (
          <p className="text-base font-semibold text-blue-600">Drop files here…</p>
        ) : (
          <>
            <p className="text-base font-medium text-gray-700">
              Drag &amp; drop files here, or{' '}
              <span className="text-blue-700 underline underline-offset-2">browse</span>
            </p>
            <p className="mt-1 text-sm text-gray-400">
              PDF, TIFF, JPEG &bull; Max 50 MB per file &bull; Up to 20 files
            </p>
          </>
        )}
      </div>

      {/* Rejection errors */}
      {rejections.length > 0 && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <p className="mb-1 text-sm font-semibold text-red-700">
            Some files could not be added:
          </p>
          <ul className="list-inside list-disc space-y-0.5">
            {rejections.map((r, i) => (
              <li key={i} className="text-xs text-red-600">
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* File list */}
      {files.length > 0 && (
        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">
              {files.length} file{files.length !== 1 ? 's' : ''} selected
            </h2>
            <button
              type="button"
              onClick={() => setFiles([])}
              disabled={isUploading}
              className="text-xs text-gray-400 hover:text-red-600 disabled:opacity-40"
            >
              Clear all
            </button>
          </div>

          <div className="space-y-2">
            {files.map((f) => (
              <div
                key={f.id}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 shadow-sm"
              >
                <FileText className="h-5 w-5 shrink-0 text-blue-600" />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {f.file.name}
                  </p>
                  <p className="text-xs text-gray-400">{formatFileSize(f.file.size)}</p>
                </div>

                {/* Type selector */}
                <div className="relative shrink-0">
                  <select
                    value={f.detectedType}
                    onChange={(e) => updateType(f.id, e.target.value as DocumentType)}
                    disabled={isUploading}
                    className="h-8 appearance-none rounded-md border border-gray-300 bg-white pl-2 pr-7 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40"
                  >
                    {DOCUMENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                </div>

                <button
                  type="button"
                  onClick={() => removeFile(f.id)}
                  disabled={isUploading}
                  className="shrink-0 text-gray-300 hover:text-red-500 disabled:opacity-40"
                  title="Remove file"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload progress */}
      {uploadProgress !== null && (
        <div className="mt-5">
          <div className="mb-1.5 flex items-center justify-between text-sm">
            <span className="font-medium text-gray-700">Uploading…</span>
            <span className="text-gray-500">{uploadProgress}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-300"
              style={{ width: `${uploadProgress}%` }}
            />
          </div>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="mt-4 flex items-start gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{uploadError}</p>
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => navigate('/')}
          disabled={isUploading}
          className="btn-secondary"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleUpload}
          disabled={files.length === 0 || isUploading}
          className="btn-primary"
        >
          {isUploading ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Uploading…
            </>
          ) : (
            <>
              <Upload className="h-4 w-4" />
              Submit for Examination
            </>
          )}
        </button>
      </div>

      {/* Guidance */}
      <div className="mt-8 rounded-lg border border-blue-100 bg-blue-50 p-5">
        <h3 className="mb-2 text-sm font-semibold text-blue-800">Document requirements</h3>
        <ul className="space-y-1 text-sm text-blue-700">
          <li>• Each LC presentation should include the Letter of Credit and all presented documents</li>
          <li>• Ensure documents are legible — minimum 200 DPI for scanned files</li>
          <li>• Correct the detected document type if the automatic detection is wrong</li>
          <li>• Password-protected files must be unlocked before upload</li>
        </ul>
      </div>
    </div>
  );
}
