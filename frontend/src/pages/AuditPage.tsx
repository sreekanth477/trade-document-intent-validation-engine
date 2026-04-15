import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Download,
  Loader2,
  AlertCircle,
  Upload,
  FileSearch,
  CheckCircle2,
  RotateCcw,
  ArrowUpCircle,
  Shield,
  User,
  Settings,
  Clock,
} from 'lucide-react';
import { getAuditTrail, exportAuditTrail } from '../api/client';
import type { AuditEvent } from '../types';

const EVENT_CONFIG: Record<
  string,
  { icon: React.ElementType; label: string; iconClass: string }
> = {
  presentation_created: {
    icon: Upload,
    label: 'Presentation Created',
    iconClass: 'bg-blue-100 text-blue-700',
  },
  document_uploaded: {
    icon: Upload,
    label: 'Document Uploaded',
    iconClass: 'bg-blue-100 text-blue-700',
  },
  analysis_started: {
    icon: FileSearch,
    label: 'Analysis Started',
    iconClass: 'bg-purple-100 text-purple-700',
  },
  analysis_completed: {
    icon: CheckCircle2,
    label: 'Analysis Completed',
    iconClass: 'bg-green-100 text-green-700',
  },
  finding_accepted: {
    icon: CheckCircle2,
    label: 'Finding Accepted',
    iconClass: 'bg-green-100 text-green-700',
  },
  finding_overridden: {
    icon: RotateCcw,
    label: 'Finding Overridden',
    iconClass: 'bg-amber-100 text-amber-700',
  },
  finding_escalated: {
    icon: ArrowUpCircle,
    label: 'Finding Escalated',
    iconClass: 'bg-red-100 text-red-700',
  },
  status_changed: {
    icon: Settings,
    label: 'Status Changed',
    iconClass: 'bg-gray-100 text-gray-600',
  },
  user_action: {
    icon: User,
    label: 'User Action',
    iconClass: 'bg-indigo-100 text-indigo-700',
  },
  compliance_review: {
    icon: Shield,
    label: 'Compliance Review',
    iconClass: 'bg-teal-100 text-teal-700',
  },
};

function getEventConfig(eventType: string) {
  return (
    EVENT_CONFIG[eventType] ?? {
      icon: Clock,
      label: eventType
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      iconClass: 'bg-gray-100 text-gray-600',
    }
  );
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function EventDataTable({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k]) => !['id', 'presentationId'].includes(k));
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      {entries.map(([key, val]) => (
        <div key={key} className="flex gap-2">
          <dt className="text-xs font-medium text-gray-500 capitalize min-w-0 shrink-0">
            {key.replace(/_/g, ' ')}:
          </dt>
          <dd className="text-xs text-gray-700 break-all">
            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AuditEventNode({ event, isLast }: { event: AuditEvent; isLast: boolean }) {
  const config = getEventConfig(event.eventType);
  const EventIcon = config.icon;

  return (
    <div className="relative flex gap-4">
      {/* Vertical line */}
      {!isLast && (
        <div className="absolute left-5 top-10 bottom-0 w-0.5 bg-gray-200" />
      )}

      {/* Icon node */}
      <div
        className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${config.iconClass} ring-4 ring-white`}
      >
        <EventIcon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 pb-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold text-gray-900">{config.label}</p>
          <time className="text-xs text-gray-400 shrink-0">
            {formatDateTime(event.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 text-xs text-gray-500">
          By{' '}
          <span className="font-medium text-gray-700">
            {event.userName || event.userId}
          </span>
        </p>
        {Object.keys(event.eventData ?? {}).length > 0 && (
          <div className="mt-2 rounded-md border border-gray-100 bg-gray-50 p-3">
            <EventDataTable data={event.eventData} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AuditPage() {
  const { presentationId } = useParams<{ presentationId: string }>();
  const navigate = useNavigate();

  const { data: events, isLoading, isError } = useQuery({
    queryKey: ['audit', presentationId],
    queryFn: () => getAuditTrail(presentationId!),
    enabled: !!presentationId,
  });

  async function handleExport() {
    try {
      const blob = await exportAuditTrail(presentationId!);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-trail-${presentationId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // Handle gracefully — user will see nothing happened
      console.error('Export failed');
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-4rem)] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <AlertCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
        <h2 className="text-lg font-semibold text-gray-900">Failed to load audit trail</h2>
        <button onClick={() => navigate(-1)} className="btn-primary mt-6">
          Go back
        </button>
      </div>
    );
  }

  const auditEvents = events ?? [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate(-1)}
            className="mb-2 flex items-center gap-1 text-sm text-gray-500 hover:text-blue-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </button>
          <h1 className="text-xl font-bold text-gray-900">Audit Trail</h1>
          <p className="text-sm text-gray-500">
            Presentation ID:{' '}
            <span className="font-mono text-gray-700">{presentationId}</span>
          </p>
        </div>
        <button
          onClick={handleExport}
          className="btn-secondary"
          disabled={auditEvents.length === 0}
        >
          <Download className="h-4 w-4" />
          Export JSON
        </button>
      </div>

      {/* Event count */}
      {auditEvents.length > 0 && (
        <p className="mb-6 text-sm text-gray-500">
          {auditEvents.length} event{auditEvents.length !== 1 ? 's' : ''} recorded
        </p>
      )}

      {/* Timeline */}
      {auditEvents.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-16 text-gray-400">
          <Clock className="mb-3 h-10 w-10" />
          <p className="text-sm font-medium">No audit events recorded yet</p>
        </div>
      ) : (
        <div className="card p-6">
          <div>
            {auditEvents.map((event, idx) => (
              <AuditEventNode
                key={event.id}
                event={event}
                isLast={idx === auditEvents.length - 1}
              />
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      <p className="mt-6 text-center text-xs text-gray-400">
        All audit events are immutable and tamper-evident. Times shown in local timezone.
      </p>
    </div>
  );
}
