import React from 'react';
import type { LCPresentation, Finding, Severity } from '../types';

interface Props {
  presentation: LCPresentation;
}

const SEVERITY_ORDER: Severity[] = ['critical', 'moderate', 'informational'];

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'CRITICAL',
  moderate: 'MODERATE',
  informational: 'INFORMATIONAL',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function groupBySeverity(findings: Finding[]): Record<Severity, Finding[]> {
  return {
    critical: findings.filter((f) => f.severity === 'critical'),
    moderate: findings.filter((f) => f.severity === 'moderate'),
    informational: findings.filter((f) => f.severity === 'informational'),
  };
}

function FindingSection({ finding, index }: { finding: Finding; index: number }) {
  return (
    <div className="mb-6 border border-gray-300 p-4">
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className="font-bold text-gray-900">
          [{SEVERITY_LABELS[finding.severity]}] Finding {index + 1}: {finding.title}
        </span>
        {finding.ucpArticles.length > 0 && (
          <span className="shrink-0 text-xs text-gray-500">
            UCP 600 Art. {finding.ucpArticles.join(', ')}
          </span>
        )}
      </div>

      <p className="mb-3 text-sm text-gray-700">{finding.description}</p>

      {finding.verbatimQuotes.length > 0 && (
        <div className="mb-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
            Documentary Evidence:
          </p>
          {finding.verbatimQuotes.map((q, i) => (
            <div key={i} className="mb-1.5 border-l-2 border-gray-400 pl-3">
              <p className="text-xs font-medium text-gray-600">
                {q.document.toUpperCase()} — {q.field}:
              </p>
              <p className="font-mono text-xs text-gray-800 italic">&ldquo;{q.text}&rdquo;</p>
            </div>
          ))}
        </div>
      )}

      <div className="mb-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Recommended Action:
        </p>
        <p className="text-sm text-gray-700">{finding.recommendedAction}</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
        <span>
          Status: <strong>{finding.status.toUpperCase()}</strong>
        </span>
        <span>Confidence: {Math.round(finding.confidenceScore * 100)}%</span>
        <span>Type: {finding.findingType}</span>
      </div>
    </div>
  );
}

export default function DiscrepancyReport({ presentation }: Props) {
  const grouped = groupBySeverity(presentation.findings);
  const totalFindings = presentation.findings.length;

  return (
    <div className="bg-white font-serif text-sm text-gray-900" id="discrepancy-report">
      {/* Letterhead */}
      <div className="mb-8 border-b-2 border-gray-800 pb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold uppercase tracking-widest text-gray-900">
              Trade Finance Operations
            </h1>
            <p className="text-sm text-gray-600">
              Documentary Credits Examination Department
            </p>
          </div>
          <div className="text-right text-xs text-gray-500">
            <p>CONFIDENTIAL</p>
            <p>INTERNAL USE ONLY</p>
          </div>
        </div>
      </div>

      {/* Report title */}
      <div className="mb-6 border border-gray-800 p-4">
        <h2 className="mb-1 text-center text-lg font-bold uppercase tracking-wide">
          Documentary Discrepancy Examination Report
        </h2>
        <p className="text-center text-xs text-gray-500">
          Generated: {formatDateTime(new Date().toISOString())}
        </p>
      </div>

      {/* Presentation details */}
      <div className="mb-6">
        <h3 className="mb-2 border-b border-gray-400 pb-1 text-sm font-bold uppercase tracking-wide">
          1. Presentation Details
        </h3>
        <table className="w-full border-collapse text-sm">
          <tbody>
            {[
              ['LC Reference Number', presentation.lcNumber],
              ['Applicant', presentation.applicant],
              ['Beneficiary', presentation.beneficiary],
              ['Client', presentation.clientName],
              ['Date of Presentation', formatDate(presentation.createdAt)],
              ['Overall Risk Score', `${presentation.overallRiskScore} / 100`],
              [
                'STP Eligible',
                presentation.stpCandidate ? 'Yes — No blocking discrepancies' : 'No — Manual review required',
              ],
            ].map(([label, value]) => (
              <tr key={label} className="border border-gray-200">
                <td className="w-48 bg-gray-50 px-3 py-1.5 font-semibold text-gray-700">
                  {label}
                </td>
                <td className="px-3 py-1.5 text-gray-900">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Summary */}
      <div className="mb-6">
        <h3 className="mb-2 border-b border-gray-400 pb-1 text-sm font-bold uppercase tracking-wide">
          2. Discrepancy Summary
        </h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-800 text-white">
              <th className="px-3 py-2 text-left font-semibold">Severity</th>
              <th className="px-3 py-2 text-center font-semibold">Count</th>
              <th className="px-3 py-2 text-left font-semibold">Action Required</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border border-gray-200 bg-red-50">
              <td className="px-3 py-1.5 font-semibold text-red-800">Critical</td>
              <td className="px-3 py-1.5 text-center font-bold">{grouped.critical.length}</td>
              <td className="px-3 py-1.5 text-red-800">Must be resolved before acceptance</td>
            </tr>
            <tr className="border border-gray-200 bg-amber-50">
              <td className="px-3 py-1.5 font-semibold text-amber-800">Moderate</td>
              <td className="px-3 py-1.5 text-center font-bold">{grouped.moderate.length}</td>
              <td className="px-3 py-1.5 text-amber-800">Review and document override</td>
            </tr>
            <tr className="border border-gray-200 bg-blue-50">
              <td className="px-3 py-1.5 font-semibold text-blue-800">Informational</td>
              <td className="px-3 py-1.5 text-center font-bold">{grouped.informational.length}</td>
              <td className="px-3 py-1.5 text-blue-800">For information only</td>
            </tr>
            <tr className="border border-gray-200 font-bold">
              <td className="px-3 py-1.5">Total</td>
              <td className="px-3 py-1.5 text-center">{totalFindings}</td>
              <td className="px-3 py-1.5"></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Detailed findings */}
      <div className="mb-6">
        <h3 className="mb-4 border-b border-gray-400 pb-1 text-sm font-bold uppercase tracking-wide">
          3. Detailed Discrepancy Findings
        </h3>

        {SEVERITY_ORDER.map((severity) => {
          const items = grouped[severity];
          if (items.length === 0) return null;
          return (
            <div key={severity} className="mb-6">
              <h4 className="mb-3 text-sm font-bold uppercase text-gray-700">
                {SEVERITY_LABELS[severity]} ({items.length})
              </h4>
              {items.map((f, i) => (
                <FindingSection key={f.id} finding={f} index={i} />
              ))}
            </div>
          );
        })}

        {totalFindings === 0 && (
          <p className="text-sm text-gray-500 italic">
            No discrepancies identified. Presentation is clear for processing.
          </p>
        )}
      </div>

      {/* Documents examined */}
      <div className="mb-6">
        <h3 className="mb-2 border-b border-gray-400 pb-1 text-sm font-bold uppercase tracking-wide">
          4. Documents Examined
        </h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-300 px-3 py-1.5 text-left font-semibold">
                Document Type
              </th>
              <th className="border border-gray-300 px-3 py-1.5 text-left font-semibold">
                Filename
              </th>
              <th className="border border-gray-300 px-3 py-1.5 text-center font-semibold">
                Extraction Status
              </th>
              <th className="border border-gray-300 px-3 py-1.5 text-center font-semibold">
                OCR Confidence
              </th>
            </tr>
          </thead>
          <tbody>
            {presentation.documents.map((doc) => (
              <tr key={doc.id} className="border border-gray-200">
                <td className="border border-gray-200 px-3 py-1.5 capitalize">
                  {doc.documentType === 'bl' ? 'Bill of Lading' : doc.documentType}
                </td>
                <td className="border border-gray-200 px-3 py-1.5 font-mono text-xs">
                  {doc.originalName}
                </td>
                <td className="border border-gray-200 px-3 py-1.5 text-center capitalize">
                  {doc.extractionStatus}
                </td>
                <td className="border border-gray-200 px-3 py-1.5 text-center">
                  {doc.ocrConfidence > 0
                    ? `${Math.round(doc.ocrConfidence * 100)}%`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Signature block */}
      <div className="mt-10 border-t-2 border-gray-800 pt-4">
        <div className="grid grid-cols-2 gap-8">
          <div>
            <p className="mb-6 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Examined by (Checker)
            </p>
            <div className="border-b border-gray-400 pb-1"></div>
            <p className="mt-1 text-xs text-gray-500">Name / Signature / Date</p>
          </div>
          <div>
            <p className="mb-6 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Authorised by (Supervisor)
            </p>
            <div className="border-b border-gray-400 pb-1"></div>
            <p className="mt-1 text-xs text-gray-500">Name / Signature / Date</p>
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-gray-400">
          This report was generated by the Trade Document Intent Validation Engine.
          All findings are subject to manual review and override per bank policy.
          UCP 600 (ICC Publication No. 600) applies unless otherwise stated.
        </p>
      </div>
    </div>
  );
}
