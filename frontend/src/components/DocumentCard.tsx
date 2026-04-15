import React, { useState } from 'react';
import {
  FileText,
  Ship,
  ShieldCheck,
  Receipt,
  FileQuestion,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { Document, DocumentType, DocumentStatus } from '../types';

interface Props {
  document: Document;
}

const TYPE_CONFIG: Record<
  DocumentType,
  { label: string; icon: React.ElementType; iconClass: string }
> = {
  lc: {
    label: 'Letter of Credit',
    icon: ShieldCheck,
    iconClass: 'bg-blue-100 text-blue-700',
  },
  invoice: {
    label: 'Commercial Invoice',
    icon: Receipt,
    iconClass: 'bg-purple-100 text-purple-700',
  },
  bl: {
    label: 'Bill of Lading',
    icon: Ship,
    iconClass: 'bg-teal-100 text-teal-700',
  },
  insurance: {
    label: 'Insurance Certificate',
    icon: FileText,
    iconClass: 'bg-green-100 text-green-700',
  },
  other: {
    label: 'Other Document',
    icon: FileQuestion,
    iconClass: 'bg-gray-100 text-gray-600',
  },
};

const STATUS_CONFIG: Record<
  DocumentStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  pending: { label: 'Pending', icon: Clock, className: 'text-gray-500' },
  processing: { label: 'Processing', icon: Loader2, className: 'text-blue-600' },
  completed: { label: 'Extracted', icon: CheckCircle2, className: 'text-green-600' },
  failed: { label: 'Failed', icon: XCircle, className: 'text-red-600' },
};

function OcrBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 90 ? 'bg-green-500' : pct >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="mt-2">
      <div className="mb-0.5 flex items-center justify-between text-xs text-gray-500">
        <span>OCR confidence</span>
        <span className="font-medium">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function FieldTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (entries.length === 0) return <p className="text-xs text-gray-400">No extracted fields.</p>;
  return (
    <dl className="divide-y divide-gray-100">
      {entries.map(([key, val]) => (
        <div key={key} className="flex gap-3 py-1.5">
          <dt className="w-36 shrink-0 text-xs font-medium text-gray-500 capitalize">
            {key.replace(/_/g, ' ')}
          </dt>
          <dd className="min-w-0 text-xs text-gray-800 break-words">
            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function DocumentCard({ document: doc }: Props) {
  const [expanded, setExpanded] = useState(false);

  const type = TYPE_CONFIG[doc.documentType] ?? TYPE_CONFIG.other;
  const status = STATUS_CONFIG[doc.extractionStatus] ?? STATUS_CONFIG.pending;
  const TypeIcon = type.icon;
  const StatusIcon = status.icon;
  const hasData = Object.keys(doc.extractedData ?? {}).length > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start gap-3 p-4">
        {/* Type icon */}
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${type.iconClass}`}
        >
          <TypeIcon className="h-5 w-5" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              {type.label}
            </p>
            <span
              className={`flex items-center gap-1 text-xs font-medium ${status.className}`}
            >
              <StatusIcon
                className={`h-3.5 w-3.5 ${doc.extractionStatus === 'processing' ? 'animate-spin' : ''}`}
              />
              {status.label}
            </span>
          </div>
          <p
            className="mt-0.5 truncate text-sm font-medium text-gray-900"
            title={doc.originalName}
          >
            {doc.originalName}
          </p>

          {doc.extractionStatus === 'completed' && doc.ocrConfidence > 0 && (
            <OcrBar confidence={doc.ocrConfidence} />
          )}
        </div>
      </div>

      {/* Expand extracted fields */}
      {doc.extractionStatus === 'completed' && hasData && (
        <>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex w-full items-center justify-between border-t border-gray-100 px-4 py-2.5 text-xs font-medium text-blue-700 hover:bg-blue-50 transition-colors"
          >
            <span>View extracted fields</span>
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>

          {expanded && (
            <div className="border-t border-gray-100 px-4 pb-4 pt-2">
              <FieldTable data={doc.extractedData} />
            </div>
          )}
        </>
      )}

      {doc.extractionStatus === 'failed' && (
        <div className="border-t border-red-100 bg-red-50 px-4 py-2.5 text-xs text-red-700">
          Extraction failed. Document may be unreadable or corrupted.
        </div>
      )}
    </div>
  );
}
