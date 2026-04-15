import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  ArrowRight,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { LCPresentation, PresentationStatus } from '../types';

interface Props {
  presentations: LCPresentation[];
  isLoading?: boolean;
}

function riskColor(score: number): string {
  if (score <= 30) return 'text-green-700 bg-green-50 ring-green-600/20';
  if (score <= 60) return 'text-amber-700 bg-amber-50 ring-amber-600/20';
  return 'text-red-700 bg-red-50 ring-red-600/20';
}

function riskLabel(score: number): string {
  if (score <= 30) return 'Low';
  if (score <= 60) return 'Medium';
  return 'High';
}

const STATUS_CONFIG: Record<
  PresentationStatus,
  { label: string; icon: React.ElementType; className: string }
> = {
  pending: {
    label: 'Pending',
    icon: Clock,
    className: 'text-gray-600 bg-gray-100',
  },
  processing: {
    label: 'Processing',
    icon: Loader2,
    className: 'text-blue-600 bg-blue-50',
  },
  completed: {
    label: 'Completed',
    icon: CheckCircle2,
    className: 'text-green-700 bg-green-50',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    className: 'text-red-700 bg-red-50',
  },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ReviewQueue({ presentations, isLoading }: Props) {
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (presentations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <CheckCircle2 className="mb-3 h-10 w-10" />
        <p className="text-sm font-medium">No presentations in the queue</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead>
          <tr className="bg-gray-50">
            {[
              'LC Number',
              'Client / Beneficiary',
              'Status',
              'Risk Score',
              'Findings',
              'Received',
              '',
            ].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 bg-white">
          {presentations.map((p) => {
            const critical = p.findings.filter((f) => f.severity === 'critical').length;
            const moderate = p.findings.filter((f) => f.severity === 'moderate').length;
            const info = p.findings.filter((f) => f.severity === 'informational').length;
            const status = STATUS_CONFIG[p.status];
            const StatusIcon = status.icon;

            return (
              <tr
                key={p.id}
                className="cursor-pointer hover:bg-blue-50/40 transition-colors"
                onClick={() => navigate(`/review/${p.id}`)}
              >
                {/* LC Number */}
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="font-mono text-sm font-semibold text-gray-900">
                    {p.lcNumber}
                  </div>
                  {p.stpCandidate && (
                    <span className="mt-0.5 inline-flex items-center rounded-full bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-700">
                      STP
                    </span>
                  )}
                </td>

                {/* Client */}
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">{p.clientName}</div>
                  <div className="text-xs text-gray-500 truncate max-w-[200px]">
                    {p.beneficiary}
                  </div>
                </td>

                {/* Status */}
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}
                  >
                    <StatusIcon
                      className={`h-3.5 w-3.5 ${p.status === 'processing' ? 'animate-spin' : ''}`}
                    />
                    {status.label}
                  </span>
                </td>

                {/* Risk score */}
                <td className="whitespace-nowrap px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${riskColor(p.overallRiskScore)}`}
                  >
                    {p.overallRiskScore}
                    <span className="opacity-70">/ {riskLabel(p.overallRiskScore)}</span>
                  </span>
                </td>

                {/* Findings breakdown */}
                <td className="whitespace-nowrap px-4 py-3">
                  <div className="flex items-center gap-2">
                    {critical > 0 && (
                      <span className="flex items-center gap-0.5 text-xs font-semibold text-red-700">
                        <AlertCircle className="h-3.5 w-3.5" />
                        {critical}
                      </span>
                    )}
                    {moderate > 0 && (
                      <span className="flex items-center gap-0.5 text-xs font-semibold text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {moderate}
                      </span>
                    )}
                    {info > 0 && (
                      <span className="flex items-center gap-0.5 text-xs font-semibold text-blue-700">
                        <Info className="h-3.5 w-3.5" />
                        {info}
                      </span>
                    )}
                    {critical === 0 && moderate === 0 && info === 0 && (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </div>
                </td>

                {/* Date */}
                <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                  {formatDate(p.createdAt)}
                </td>

                {/* Action */}
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      navigate(`/review/${p.id}`);
                    }}
                    className="inline-flex items-center gap-1 rounded-md bg-blue-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-800 transition-colors"
                  >
                    Review
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
