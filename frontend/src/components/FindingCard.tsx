import React, { useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  ArrowUpCircle,
  RotateCcw,
  Quote,
  BookOpen,
  Lightbulb,
} from 'lucide-react';
import type { Finding, Severity, FindingStatus, DocumentType } from '../types';

interface Props {
  finding: Finding;
  onAction: (action: 'accept' | 'override' | 'escalate', findingId: string) => void;
}

const SEVERITY_CONFIG: Record<
  Severity,
  { badge: string; border: string; icon: React.ElementType; label: string }
> = {
  critical: {
    badge: 'badge-critical',
    border: 'border-l-red-500',
    icon: AlertCircle,
    label: 'Critical',
  },
  moderate: {
    badge: 'badge-moderate',
    border: 'border-l-amber-400',
    icon: AlertTriangle,
    label: 'Moderate',
  },
  informational: {
    badge: 'badge-informational',
    border: 'border-l-blue-400',
    icon: Info,
    label: 'Informational',
  },
};

const STATUS_LABELS: Record<FindingStatus, string> = {
  open: 'Open',
  accepted: 'Accepted',
  overridden: 'Overridden',
  escalated: 'Escalated',
};

const STATUS_CLASSES: Record<FindingStatus, string> = {
  open: 'bg-gray-100 text-gray-600',
  accepted: 'bg-green-100 text-green-700',
  overridden: 'bg-amber-100 text-amber-700',
  escalated: 'bg-red-100 text-red-700',
};

const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  lc: 'LC',
  invoice: 'Invoice',
  bl: 'Bill of Lading',
  insurance: 'Insurance',
  other: 'Other',
};

function ConfidencePill({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 85 ? 'bg-green-100 text-green-700' : pct >= 65 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>
      {pct}% confidence
    </span>
  );
}

function CollapsibleSection({
  title,
  icon: Icon,
  children,
  defaultOpen = false,
}: {
  title: string;
  icon: React.ElementType;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-gray-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <Icon className="h-3.5 w-3.5" />
          {title}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

export default function FindingCard({ finding, onAction }: Props) {
  const sev = SEVERITY_CONFIG[finding.severity];
  const SevIcon = sev.icon;
  const isActioned = finding.status !== 'open';

  return (
    <div
      className={`card overflow-hidden border-l-4 ${sev.border} ${isActioned ? 'opacity-70' : ''}`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={sev.badge}>
            <SevIcon className="mr-1 h-3 w-3" />
            {sev.label}
          </span>
          <ConfidencePill score={finding.confidenceScore} />
          {finding.ucpArticles.length > 0 &&
            finding.ucpArticles.map((art) => (
              <span
                key={art}
                className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
              >
                UCP {art}
              </span>
            ))}
        </div>

        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASSES[finding.status]}`}>
          {STATUS_LABELS[finding.status]}
        </span>
      </div>

      {/* Title & description */}
      <div className="px-4 pb-3">
        <h3 className="text-sm font-semibold text-gray-900">{finding.title}</h3>
        <p className="mt-1 text-sm text-gray-600 leading-relaxed">{finding.description}</p>
      </div>

      {/* Affected docs & fields */}
      <div className="flex flex-wrap gap-4 border-t border-gray-100 px-4 py-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
            Affected documents
          </p>
          <div className="flex flex-wrap gap-1">
            {finding.affectedDocuments.map((d) => (
              <span
                key={d}
                className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700"
              >
                {DOC_TYPE_LABELS[d] ?? d}
              </span>
            ))}
          </div>
        </div>
        {finding.affectedFields.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">
              Affected fields
            </p>
            <div className="flex flex-wrap gap-1">
              {finding.affectedFields.map((f) => (
                <span
                  key={f}
                  className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs text-gray-700"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Verbatim evidence */}
      {finding.verbatimQuotes.length > 0 && (
        <CollapsibleSection title="Verbatim Evidence" icon={Quote} defaultOpen={true}>
          <div className="space-y-3">
            {finding.verbatimQuotes.map((q, idx) => (
              <div key={idx} className="rounded-md border border-gray-200 bg-gray-50">
                <div className="flex items-center gap-2 border-b border-gray-200 px-3 py-1.5">
                  <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                    {DOC_TYPE_LABELS[q.document] ?? q.document}
                  </span>
                  <span className="font-mono text-xs text-gray-500">{q.field}</span>
                </div>
                <blockquote className="px-3 py-2.5">
                  <p className="font-mono text-xs text-gray-800 leading-relaxed whitespace-pre-wrap">
                    &ldquo;{q.text}&rdquo;
                  </p>
                </blockquote>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Reasoning */}
      <CollapsibleSection title="Reasoning" icon={BookOpen}>
        <p className="text-sm text-gray-600 leading-relaxed">{finding.reasoning}</p>
      </CollapsibleSection>

      {/* Recommended action */}
      <CollapsibleSection title="Recommended Action" icon={Lightbulb} defaultOpen={true}>
        <p className="text-sm text-gray-700 leading-relaxed">{finding.recommendedAction}</p>
      </CollapsibleSection>

      {/* Action buttons */}
      {!isActioned && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 bg-gray-50 px-4 py-3">
          <button
            onClick={() => onAction('accept', finding.id)}
            className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 transition-colors"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Accept
          </button>
          <button
            onClick={() => onAction('override', finding.id)}
            className="inline-flex items-center gap-1.5 rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Override
          </button>
          <button
            onClick={() => onAction('escalate', finding.id)}
            className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 transition-colors"
          >
            <ArrowUpCircle className="h-3.5 w-3.5" />
            Escalate
          </button>
        </div>
      )}

      {isActioned && (
        <div className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-400">
          This finding has been {finding.status}. No further action required.
        </div>
      )}
    </div>
  );
}
